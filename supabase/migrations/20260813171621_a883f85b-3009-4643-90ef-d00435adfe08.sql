-- 1. Timeline entries remember what created them, so an undo can remove exactly that entry.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

COMMENT ON COLUMN public.interactions.source_kind IS
  'What wrote this entry: donation_gift, donation_thank_you, donation_receipt, event_attendance, task_completion.';

-- 2. Link existing entries back to their records, best effort, before enforcing uniqueness.
WITH i AS (
  SELECT id, person_id, date,
         row_number() OVER (PARTITION BY person_id, date ORDER BY created_at, id) rn
    FROM public.interactions
   WHERE type = 'donation' AND source_kind IS NULL AND text LIKE 'Gift of $%'
), d AS (
  SELECT id, person_id, date,
         row_number() OVER (PARTITION BY person_id, date ORDER BY created_at, id) rn
    FROM public.donations
   WHERE deleted_at IS NULL
)
UPDATE public.interactions t
   SET source_kind = 'donation_gift', source_id = d.id
  FROM i JOIN d ON d.person_id = i.person_id AND d.date = i.date AND d.rn = i.rn
 WHERE t.id = i.id;

WITH i AS (
  SELECT id, person_id, row_number() OVER (PARTITION BY person_id ORDER BY created_at, id) rn
    FROM public.interactions
   WHERE source_kind IS NULL AND text LIKE 'Thank-you letter sent%'
), d AS (
  SELECT id, person_id, row_number() OVER (PARTITION BY person_id ORDER BY created_at, id) rn
    FROM public.donations
   WHERE deleted_at IS NULL AND thank_you_sent
)
UPDATE public.interactions t
   SET source_kind = 'donation_thank_you', source_id = d.id
  FROM i JOIN d ON d.person_id = i.person_id AND d.rn = i.rn
 WHERE t.id = i.id;

WITH cand AS (
  SELECT i.id AS iid, r.id AS rid, i.created_at
    FROM public.interactions i
    JOIN public.events e ON i.text = 'Attended ' || e.name
    JOIN public.registrations r ON r.event_id = e.id AND r.person_id = i.person_id
   WHERE i.source_kind IS NULL
), pick AS (
  SELECT DISTINCT ON (rid) rid, iid FROM cand ORDER BY rid, created_at, iid
)
UPDATE public.interactions t
   SET source_kind = 'event_attendance', source_id = pick.rid
  FROM pick
 WHERE t.id = pick.iid;

-- Clear any duplicate links a fuzzy match may have produced.
WITH dupes AS (
  SELECT id, row_number() OVER (PARTITION BY source_kind, source_id ORDER BY created_at, id) rn
    FROM public.interactions
   WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
)
UPDATE public.interactions t SET source_kind = NULL, source_id = NULL
  FROM dupes WHERE t.id = dupes.id AND dupes.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS interactions_source_unique
  ON public.interactions (source_kind, source_id)
  WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS interactions_source_id_idx ON public.interactions (source_id);

-- 3. Plain-language money for timeline text.
CREATE OR REPLACE FUNCTION public.money_text(_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '$' || TRIM(TO_CHAR(COALESCE(_amount, 0), 'FM9,999,999,990.00'))
$$;

-- 4. Thank-you letters: mark and unmark reverse each other completely.
CREATE OR REPLACE FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d record;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_d FROM public.donations WHERE id = _donation_id;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  IF _sent THEN
    UPDATE public.donations
       SET thank_you_sent = true,
           thank_you_sent_date = COALESCE(thank_you_sent_date, CURRENT_DATE)
     WHERE id = _donation_id;

    UPDATE public.tasks
       SET status = 'done',
           completed_at = COALESCE(completed_at, now()),
           completion_note = COALESCE(completion_note, 'Thank-you letter sent')
     WHERE donation_id = _donation_id AND status <> 'done' AND deleted_at IS NULL;

    IF v_d.person_id IS NOT NULL AND v_d.deleted_at IS NULL THEN
      INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
      VALUES (v_d.person_id, 'note', CURRENT_DATE,
              'Thank-you letter sent for ' || public.money_text(v_d.amount) || ' gift',
              v_actor, 'donation_thank_you', _donation_id)
      ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING;
    END IF;
  ELSE
    UPDATE public.donations
       SET thank_you_sent = false, thank_you_sent_date = NULL
     WHERE id = _donation_id;

    -- Put the reminder back on the task list.
    UPDATE public.tasks
       SET status = 'upcoming',
           completed_at = NULL,
           completion_note = NULL
     WHERE donation_id = _donation_id AND status = 'done' AND deleted_at IS NULL;

    -- And take the activity entry back out of the person's history.
    DELETE FROM public.interactions
     WHERE source_kind = 'donation_thank_you' AND source_id = _donation_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_thank_you_sent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_thank_you_sent(uuid, boolean) TO authenticated, service_role;

-- 5. Receipts behave the same way, with their own activity entry.
CREATE OR REPLACE FUNCTION public.mark_receipt_sent(_donation_id uuid, _sent boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d record;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_d FROM public.donations WHERE id = _donation_id;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  IF _sent THEN
    UPDATE public.donations
       SET receipt_sent = true,
           receipt_sent_date = COALESCE(receipt_sent_date, CURRENT_DATE)
     WHERE id = _donation_id;

    IF v_d.person_id IS NOT NULL AND v_d.deleted_at IS NULL THEN
      INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
      VALUES (v_d.person_id, 'note', CURRENT_DATE,
              'Tax receipt sent for ' || public.money_text(v_d.amount) || ' gift',
              v_actor, 'donation_receipt', _donation_id)
      ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING;
    END IF;
  ELSE
    UPDATE public.donations
       SET receipt_sent = false, receipt_sent_date = NULL
     WHERE id = _donation_id;

    DELETE FROM public.interactions
     WHERE source_kind = 'donation_receipt' AND source_id = _donation_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_receipt_sent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_receipt_sent(uuid, boolean) TO authenticated, service_role;

-- 6. Tasks: completing or reopening a thank-you task keeps the gift in step, and
--    reopening any task removes the activity entry that completing it created.
CREATE OR REPLACE FUNCTION public.tasks_sync_thank_you()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_before boolean := COALESCE(OLD.status, '') = 'done';
  v_done_now boolean := NEW.status = 'done';
BEGIN
  -- Reopening or archiving a task removes the activity entry it wrote.
  IF (v_done_before AND NOT v_done_now)
     OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    DELETE FROM public.interactions
     WHERE source_kind = 'task_completion' AND source_id = NEW.id;
  END IF;

  IF NEW.donation_id IS NOT NULL
     AND COALESCE(current_setting('mh.reversing', true), '') <> 'on' THEN
    PERFORM set_config('mh.reversing', 'on', true);
    IF v_done_now AND NOT v_done_before AND NEW.deleted_at IS NULL THEN
      PERFORM public.mark_thank_you_sent(NEW.donation_id, true);
    ELSIF v_done_before AND NOT v_done_now THEN
      PERFORM public.mark_thank_you_sent(NEW.donation_id, false);
    END IF;
    PERFORM set_config('mh.reversing', 'off', true);
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Event attendance: the timeline entry and the registration are one and the same.
CREATE OR REPLACE FUNCTION public.registrations_sync_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.interactions
     WHERE source_kind = 'event_attendance' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name, date INTO v_event FROM public.events WHERE id = NEW.event_id;

  IF LOWER(TRIM(COALESCE(NEW.status, ''))) = 'attended' THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
    VALUES (NEW.person_id, 'event', COALESCE(v_event.date, CURRENT_DATE),
            'Attended ' || COALESCE(v_event.name, 'an event'), NULL,
            'event_attendance', NEW.id)
    ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET person_id = EXCLUDED.person_id,
                  date = EXCLUDED.date,
                  text = EXCLUDED.text;
  ELSE
    DELETE FROM public.interactions
     WHERE source_kind = 'event_attendance' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registrations_sync_timeline ON public.registrations;
CREATE TRIGGER registrations_sync_timeline
AFTER INSERT OR UPDATE OR DELETE ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.registrations_sync_timeline();

-- 8. Gifts: one timeline entry per gift, written and reversed by the database.
CREATE OR REPLACE FUNCTION public.donations_sync_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.interactions
     WHERE source_id = OLD.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    RETURN OLD;
  END IF;

  v_text := 'Gift of ' || public.money_text(NEW.amount)
            || COALESCE(' — ' || NULLIF(TRIM(NEW.campaign), ''), '')
            || COALESCE(' · ' || NULLIF(TRIM(NEW.notes), ''), '');

  IF NEW.deleted_at IS NOT NULL THEN
    -- Archived gift: history, campaign and event totals, and the automatic
    -- thank-you reminder all come back out.
    DELETE FROM public.interactions
     WHERE source_id = NEW.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    UPDATE public.tasks
       SET deleted_at = now()
     WHERE donation_id = NEW.id AND deleted_at IS NULL;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
    -- Restored gift: put its reminder back too.
    UPDATE public.tasks SET deleted_at = NULL WHERE donation_id = NEW.id AND deleted_at IS NOT NULL;
  END IF;

  IF NEW.person_id IS NOT NULL THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id, import_batch_id)
    VALUES (NEW.person_id, 'donation', NEW.date, v_text, NULL, 'donation_gift', NEW.id, NEW.import_batch_id)
    ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET person_id = EXCLUDED.person_id,
                  date = EXCLUDED.date,
                  text = EXCLUDED.text;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS donations_sync_timeline ON public.donations;
CREATE TRIGGER donations_sync_timeline
AFTER INSERT OR UPDATE OR DELETE ON public.donations
FOR EACH ROW EXECUTE FUNCTION public.donations_sync_timeline();