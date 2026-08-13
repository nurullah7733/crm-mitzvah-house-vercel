-- 1. Contact methods: many phones / emails per contact -----------------------
CREATE TABLE public.contact_methods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'phone',
  value text NOT NULL,
  method_type text NOT NULL DEFAULT 'Mobile',
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  import_batch_id uuid REFERENCES public.import_batches(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_methods TO authenticated;
GRANT ALL ON public.contact_methods TO service_role;

ALTER TABLE public.contact_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff full access" ON public.contact_methods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_contact_methods_updated_at
  BEFORE UPDATE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_contact_methods_person ON public.contact_methods (person_id);
CREATE INDEX idx_contact_methods_kind ON public.contact_methods (kind);
CREATE INDEX idx_contact_methods_value_trgm ON public.contact_methods USING gin (value gin_trgm_ops);
CREATE INDEX idx_contact_methods_digits ON public.contact_methods (
  RIGHT(REGEXP_REPLACE(value, '\D', '', 'g'), 10)
);

-- Validation of the small vocabularies, as a trigger (not a CHECK) ------------
CREATE OR REPLACE FUNCTION public.contact_methods_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'A contact method must be a phone or an email';
  END IF;
  IF NEW.kind = 'email' THEN
    NEW.value := LOWER(TRIM(NEW.value));
    NEW.method_type := COALESCE(NULLIF(TRIM(NEW.method_type), ''), 'Personal');
  ELSE
    NEW.value := TRIM(NEW.value);
    NEW.method_type := COALESCE(NULLIF(TRIM(NEW.method_type), ''), 'Mobile');
  END IF;
  IF NEW.value = '' THEN
    RAISE EXCEPTION 'A contact method needs a value';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contact_methods_validate
  BEFORE INSERT OR UPDATE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_validate();

-- Keep people.phone / people.email pointing at the primary -------------------
CREATE OR REPLACE FUNCTION public.sync_primary_contact_method(_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_email text;
BEGIN
  IF _person_id IS NULL THEN RETURN; END IF;

  SELECT value INTO v_phone FROM public.contact_methods
   WHERE person_id = _person_id AND kind = 'phone'
   ORDER BY is_primary DESC, created_at ASC LIMIT 1;

  SELECT value INTO v_email FROM public.contact_methods
   WHERE person_id = _person_id AND kind = 'email'
   ORDER BY is_primary DESC, created_at ASC LIMIT 1;

  UPDATE public.people
     SET phone = COALESCE(v_phone, phone),
         email = COALESCE(v_email, email)
   WHERE id = _person_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.contact_methods_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only one primary per kind.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.is_primary THEN
    UPDATE public.contact_methods
       SET is_primary = false
     WHERE person_id = NEW.person_id AND kind = NEW.kind AND id <> NEW.id AND is_primary;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_primary_contact_method(OLD.person_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_primary_contact_method(NEW.person_id);
  IF TG_OP = 'UPDATE' AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    PERFORM public.sync_primary_contact_method(OLD.person_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contact_methods_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_after_change();

CREATE TRIGGER contact_methods_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();

-- Backfill: existing single values become the primary ------------------------
INSERT INTO public.contact_methods (person_id, kind, value, method_type, is_primary)
SELECT id, 'phone', TRIM(phone), 'Mobile', true
  FROM public.people
 WHERE COALESCE(TRIM(phone), '') <> '';

INSERT INTO public.contact_methods (person_id, kind, value, method_type, is_primary)
SELECT id, 'email', LOWER(TRIM(email)), 'Personal', true
  FROM public.people
 WHERE COALESCE(TRIM(email), '') <> '';

-- 2. Thank-you / receipt tracking on donations ------------------------------
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS thank_you_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thank_you_sent_date date,
  ADD COLUMN IF NOT EXISTS receipt_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_sent_date date;

CREATE INDEX IF NOT EXISTS idx_donations_thank_you ON public.donations (thank_you_sent, date DESC);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS donation_id uuid REFERENCES public.donations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_donation ON public.tasks (donation_id);

-- 3. Duplicate detection across every phone / email -------------------------
CREATE OR REPLACE FUNCTION public.find_duplicate_people()
 RETURNS TABLE(person_a uuid, person_b uuid, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT id,
           LOWER(TRIM(COALESCE(display_name, CONCAT_WS(' ', first_name, last_name)))) AS name,
           household_id, created_at
      FROM public.people
     WHERE deleted_at IS NULL
  ),
  emails AS (
    SELECT p.id, LOWER(TRIM(p.email)) AS email, p.created_at
      FROM public.people p WHERE p.deleted_at IS NULL AND COALESCE(TRIM(p.email), '') <> ''
    UNION
    SELECT cm.person_id, LOWER(TRIM(cm.value)), p.created_at
      FROM public.contact_methods cm JOIN public.people p ON p.id = cm.person_id
     WHERE cm.kind = 'email' AND p.deleted_at IS NULL AND COALESCE(TRIM(cm.value), '') <> ''
  ),
  phones AS (
    SELECT p.id, RIGHT(REGEXP_REPLACE(COALESCE(p.phone, ''), '\D', '', 'g'), 10) AS phone, p.created_at
      FROM public.people p WHERE p.deleted_at IS NULL
    UNION
    SELECT cm.person_id, RIGHT(REGEXP_REPLACE(cm.value, '\D', '', 'g'), 10), p.created_at
      FROM public.contact_methods cm JOIN public.people p ON p.id = cm.person_id
     WHERE cm.kind = 'phone' AND p.deleted_at IS NULL
  ),
  pairs AS (
    SELECT a.id AS person_a, b.id AS person_b, 'Same email address' AS reason
      FROM emails a JOIN emails b ON a.email = b.email AND a.id <> b.id AND a.created_at <= b.created_at
     WHERE a.id < b.id OR a.created_at < b.created_at
    UNION ALL
    SELECT a.id, b.id, 'Same phone number'
      FROM phones a JOIN phones b ON a.phone = b.phone AND a.id <> b.id
     WHERE LENGTH(a.phone) >= 7 AND (a.id < b.id OR a.created_at < b.created_at)
    UNION ALL
    SELECT a.id, b.id, 'Same name in the same household'
      FROM live a JOIN live b
        ON a.name = b.name AND a.household_id IS NOT DISTINCT FROM b.household_id
       AND a.created_at < b.created_at
     WHERE COALESCE(a.name, '') <> '' AND a.household_id IS NOT NULL
  )
  SELECT person_a, person_b, MIN(reason) AS reason
    FROM pairs
   WHERE person_a <> person_b
   GROUP BY person_a, person_b
   LIMIT 200
$function$;

-- 4. Merging repoints every phone / email onto the surviving contact ---------
CREATE OR REPLACE FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_surviving_before jsonb;
  v_surviving_after jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different contacts to merge';
  END IF;

  SELECT to_jsonb(p) INTO v_snapshot FROM public.people p WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Contact to merge no longer exists'; END IF;
  SELECT to_jsonb(p) INTO v_surviving_before FROM public.people p WHERE id = _surviving_id;
  IF v_surviving_before IS NULL THEN
    RAISE EXCEPTION 'Surviving contact no longer exists';
  END IF;

  UPDATE public.donations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('donations', v_n);

  UPDATE public.interactions SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('interactions', v_n);

  DELETE FROM public.registrations r
   WHERE r.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.registrations s
                  WHERE s.person_id = _surviving_id AND s.event_id = r.event_id);
  UPDATE public.registrations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations', v_n);

  UPDATE public.tasks SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);

  UPDATE public.field_sources SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('field_sources', v_n);

  UPDATE public.yahrzeits SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('yahrzeits', v_n);

  -- Phones and emails move across, minus anything the survivor already has.
  DELETE FROM public.contact_methods m
   WHERE m.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.contact_methods s
                  WHERE s.person_id = _surviving_id AND s.kind = m.kind
                    AND LOWER(TRIM(s.value)) = LOWER(TRIM(m.value)));
  UPDATE public.contact_methods
     SET person_id = _surviving_id, is_primary = false
   WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('contact_methods', v_n);

  UPDATE public.grants SET funder_id = _surviving_id WHERE funder_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_funder', v_n);

  UPDATE public.grants SET program_officer_id = _surviving_id WHERE program_officer_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_officer', v_n);

  UPDATE public.people SET parent_org_id = _surviving_id WHERE parent_org_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('child_contacts', v_n);

  IF _field_values IS NOT NULL AND _field_values <> '{}'::jsonb THEN
    UPDATE public.people p SET
      first_name    = COALESCE(_field_values->>'first_name', p.first_name),
      last_name     = COALESCE(_field_values->>'last_name', p.last_name),
      display_name  = COALESCE(_field_values->>'display_name', p.display_name),
      email         = COALESCE(_field_values->>'email', p.email),
      phone         = COALESCE(_field_values->>'phone', p.phone),
      role          = COALESCE(_field_values->>'role', p.role),
      contact_type  = COALESCE(_field_values->>'contact_type', p.contact_type),
      owner         = COALESCE(_field_values->>'owner', p.owner),
      met_source    = COALESCE(_field_values->>'met_source', p.met_source),
      notes         = COALESCE(_field_values->>'notes', p.notes),
      school        = COALESCE(_field_values->>'school', p.school),
      met_date      = COALESCE((_field_values->>'met_date')::date, p.met_date),
      birth_date    = COALESCE((_field_values->>'birth_date')::date, p.birth_date),
      anniversary_date = COALESCE((_field_values->>'anniversary_date')::date, p.anniversary_date),
      household_id  = COALESCE((_field_values->>'household_id')::uuid, p.household_id),
      tags          = CASE WHEN _field_values ? 'tags'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'tags'))
                           ELSE p.tags END,
      programs      = CASE WHEN _field_values ? 'programs'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'programs'))
                           ELSE p.programs END
    WHERE p.id = _surviving_id;
  END IF;

  DELETE FROM public.people WHERE id = _merged_id;

  -- Make sure the survivor still has one primary phone and one primary email.
  UPDATE public.contact_methods c SET is_primary = true
   WHERE c.person_id = _surviving_id
     AND NOT EXISTS (SELECT 1 FROM public.contact_methods x
                      WHERE x.person_id = _surviving_id AND x.kind = c.kind AND x.is_primary)
     AND c.id = (SELECT y.id FROM public.contact_methods y
                  WHERE y.person_id = _surviving_id AND y.kind = c.kind
                  ORDER BY y.created_at LIMIT 1);

  PERFORM public.recalc_person_totals(_surviving_id);

  SELECT to_jsonb(p) INTO v_surviving_after FROM public.people p WHERE id = _surviving_id;

  INSERT INTO public.merge_log (surviving_person_id, merged_person_id, merged_snapshot, performed_by, performed_by_email, moved_counts)
  VALUES (_surviving_id, _merged_id, v_snapshot, auth.uid(), NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), v_counts);

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _surviving_id, 'merged', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object(
      'surviving_before', v_surviving_before,
      'surviving_after', v_surviving_after,
      'merged_away', v_snapshot,
      'moved_counts', v_counts));

  RETURN _surviving_id;
END;
$function$;

-- 5. Undoing an import also removes the phones / emails it added -------------
CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _people int; _households int; _donations int; _interactions int; _sources int; _review int; _methods int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  DELETE FROM public.contact_methods WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _methods = ROW_COUNT;

  DELETE FROM public.field_sources WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _sources = ROW_COUNT;

  DELETE FROM public.interactions WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _interactions = ROW_COUNT;

  DELETE FROM public.donations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _donations = ROW_COUNT;

  DELETE FROM public.review_queue WHERE batch_id = _batch_id;
  GET DIAGNOSTICS _review = ROW_COUNT;

  DELETE FROM public.field_sources WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.interactions WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.donations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.tasks WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.registrations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.yahrzeits WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);

  DELETE FROM public.people WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _people = ROW_COUNT;

  DELETE FROM public.households h
   WHERE h.import_batch_id = _batch_id
     AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id);
  GET DIAGNOSTICS _households = ROW_COUNT;

  UPDATE public.import_batches SET status = 'reverted' WHERE id = _batch_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('import_batches', _batch_id, 'import_undone', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                       'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
                       'contact_methods', _methods));

  RETURN jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                            'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
                            'contact_methods', _methods);
END;
$function$;

-- 6. Search covers every stored phone and email ------------------------------
CREATE OR REPLACE FUNCTION public.search_people(_q text, _limit integer DEFAULT 200)
 RETURNS TABLE(person_id uuid, reason text, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH q AS (SELECT lower(trim(coalesce(_q, ''))) AS t),
src AS (
  SELECT p.id, 'Name' AS k,
         coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name)) AS lbl,
         concat_ws(' ', p.display_name, p.first_name, p.last_name) AS txt
    FROM public.people p WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Email', p.email, p.email FROM public.people p
   WHERE p.deleted_at IS NULL AND p.email IS NOT NULL
  UNION ALL
  SELECT p.id, 'Phone', p.phone, p.phone FROM public.people p
   WHERE p.deleted_at IS NULL AND p.phone IS NOT NULL
  UNION ALL
  SELECT cm.person_id,
         CASE WHEN cm.kind = 'email' THEN 'Email' ELSE 'Phone' END,
         cm.method_type || ': ' || cm.value,
         cm.value
    FROM public.contact_methods cm
    JOIN public.people p ON p.id = cm.person_id
   WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Tag', tg, tg FROM public.people p, unnest(p.tags) tg WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Program', pr, pr FROM public.people p, unnest(p.programs) pr WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Where we met', p.met_source, p.met_source FROM public.people p
   WHERE p.deleted_at IS NULL AND p.met_source IS NOT NULL
  UNION ALL
  SELECT p.id, 'School', p.school, p.school FROM public.people p
   WHERE p.deleted_at IS NULL AND p.school IS NOT NULL
  UNION ALL
  SELECT p.id, 'Household', h.name,
         concat_ws(' ', h.name, h.address, h.address_line2, h.city, h.state, h.postal_code, h.county)
    FROM public.people p JOIN public.households h ON h.id = p.household_id
   WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT r.person_id, 'Attended', e.name, e.name
    FROM public.registrations r JOIN public.events e ON e.id = r.event_id
   WHERE e.deleted_at IS NULL
  UNION ALL
  SELECT d.person_id, 'Campaign', c.name, c.name
    FROM public.donations d JOIN public.campaigns c ON c.id = d.campaign_id
   WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT d.person_id, 'Gift source', coalesce(d.campaign, d.source),
         concat_ws(' ', d.campaign, d.source, d.method)
    FROM public.donations d WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT i.person_id, 'Note', left(i.text, 90), i.text
    FROM public.interactions i WHERE i.text IS NOT NULL
  UNION ALL
  SELECT t.person_id, 'Task', left(t.text, 90), t.text
    FROM public.tasks t WHERE t.person_id IS NOT NULL AND t.deleted_at IS NULL
  UNION ALL
  SELECT g.funder_id, 'Grant', g.name, g.name FROM public.grants g
  UNION ALL
  SELECT g.program_officer_id, 'Grant', g.name, g.name
    FROM public.grants g WHERE g.program_officer_id IS NOT NULL
  UNION ALL
  SELECT p.id, 'Notes', left(p.notes, 90), p.notes FROM public.people p
   WHERE p.deleted_at IS NULL AND p.notes IS NOT NULL
),
scored AS (
  SELECT s.id, s.k, s.lbl,
         (lower(s.txt) LIKE (SELECT t FROM q) || '%') AS prefix,
         CASE
           WHEN lower(s.txt) = (SELECT t FROM q) THEN 1.0
           WHEN lower(s.txt) LIKE '%' || (SELECT t FROM q) || '%' THEN 0.9
           ELSE greatest(
             similarity(lower(s.txt), (SELECT t FROM q)),
             word_similarity((SELECT t FROM q), lower(s.txt)),
             0.35
           )
         END::real AS sc
    FROM src s, q
   WHERE s.txt IS NOT NULL AND length(q.t) >= 2
     AND (
       lower(s.txt) LIKE '%' || q.t || '%'
       OR word_similarity(q.t, lower(s.txt)) > 0.5
       OR (
         length(q.t) >= 4
         AND EXISTS (
           SELECT 1 FROM unnest(regexp_split_to_array(lower(s.txt), '[^a-z0-9]+')) w
            WHERE length(w) >= 3
              AND levenshtein_less_equal(q.t, w, 2) <= CASE WHEN length(q.t) <= 5 THEN 1 ELSE 2 END
         )
       )
     )
),
best AS (
  SELECT id, k, lbl, sc, prefix,
         row_number() OVER (
           PARTITION BY id
           ORDER BY (CASE WHEN prefix THEN 0 ELSE 1 END), sc DESC,
                    (CASE WHEN k = 'Name' THEN 0 ELSE 1 END)
         ) AS rn
    FROM scored
)
SELECT id AS person_id,
       CASE WHEN k = 'Name' THEN 'Name: ' || coalesce(lbl, '') ELSE k || ': ' || coalesce(lbl, '') END AS reason,
       sc AS score
  FROM best
 WHERE rn = 1
 ORDER BY (CASE WHEN prefix THEN 0 ELSE 1 END), sc DESC, lbl
 LIMIT coalesce(_limit, 200)
$function$;

-- 7. Marking a thank-you sent keeps the gift, its task and the timeline in step
CREATE OR REPLACE FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d record;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT d.*, COALESCE(p.display_name, CONCAT_WS(' ', p.first_name, p.last_name)) AS donor
    INTO v_d
    FROM public.donations d LEFT JOIN public.people p ON p.id = d.person_id
   WHERE d.id = _donation_id;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;

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

    IF v_d.person_id IS NOT NULL AND NOT COALESCE(v_d.thank_you_sent, false) THEN
      INSERT INTO public.interactions (person_id, type, date, text, author)
      VALUES (v_d.person_id, 'note', CURRENT_DATE,
              'Thank-you letter sent for $' || TRIM(TO_CHAR(v_d.amount, 'FM999999999.00')) || ' gift',
              NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''));
    END IF;
  ELSE
    UPDATE public.donations
       SET thank_you_sent = false, thank_you_sent_date = NULL
     WHERE id = _donation_id;
  END IF;
END;
$$;

-- Completing the thank-you task ticks the gift too.
CREATE OR REPLACE FUNCTION public.tasks_sync_thank_you()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.donation_id IS NOT NULL AND NEW.status = 'done' AND COALESCE(OLD.status, '') <> 'done' THEN
    PERFORM public.mark_thank_you_sent(NEW.donation_id, true);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_sync_thank_you
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_thank_you();