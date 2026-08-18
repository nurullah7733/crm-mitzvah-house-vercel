-- 1) Fingerprint trigger: take the campaign name from the campaigns table.
CREATE OR REPLACE FUNCTION public.donations_fill_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_person record;
  v_donor text;
  v_name text;
  v_digits text;
  v_campaign text;
BEGIN
  IF NEW.import_fingerprint IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.person_id IS NULL OR NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.email, p.phone, p.first_name, p.last_name, p.display_name
    INTO v_person
    FROM public.people p
   WHERE p.id = NEW.person_id;
  IF v_person IS NULL THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(v_person.phone, ''), '\D', '', 'g');
  v_name := lower(trim(COALESCE(
    NULLIF(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''),
    v_person.display_name,
    ''
  )));

  IF COALESCE(trim(v_person.email), '') <> '' THEN
    v_donor := 'email:' || lower(trim(v_person.email));
  ELSIF length(v_digits) >= 7 THEN
    v_donor := 'phone:' || right(v_digits, 10);
  ELSIF v_name <> '' THEN
    v_donor := 'name:' || v_name;
  ELSE
    RETURN NEW;
  END IF;

  SELECT lower(regexp_replace(COALESCE(trim(c.name), ''), '\s+', ' ', 'g'))
    INTO v_campaign
    FROM public.campaigns c
   WHERE c.id = NEW.campaign_id;
  v_campaign := COALESCE(v_campaign, '');

  NEW.import_fingerprint := concat_ws('|',
    v_donor,
    NEW.date::text,
    to_char(NEW.amount, 'FM9999999990.00'),
    v_campaign
  );
  RETURN NEW;
END;
$function$;

-- 2) Timeline trigger: label the gift with its campaign record's name.
CREATE OR REPLACE FUNCTION public.donations_sync_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_text text;
  v_campaign text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.interactions
     WHERE source_id = OLD.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    RETURN OLD;
  END IF;

  SELECT NULLIF(TRIM(c.name), '') INTO v_campaign
    FROM public.campaigns c WHERE c.id = NEW.campaign_id;

  v_text := 'Gift of ' || public.money_text(NEW.amount)
            || COALESCE(' — ' || v_campaign, '')
            || COALESCE(' · ' || NULLIF(TRIM(NEW.notes), ''), '');

  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.interactions
     WHERE source_id = NEW.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    UPDATE public.tasks
       SET deleted_at = now()
     WHERE donation_id = NEW.id AND deleted_at IS NULL;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
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
$function$;

-- 3) Search: drop the free-text campaign branch, keep source and method.
CREATE OR REPLACE FUNCTION public.search_people(_q text, _limit integer DEFAULT 200)
 RETURNS TABLE(person_id uuid, reason text, score real)
 LANGUAGE sql
 STABLE
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
  SELECT d.person_id, 'Gift source', d.source, concat_ws(' ', d.source, d.method)
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

-- 4) Nothing left reads the text column: drop it.
ALTER TABLE public.donations DROP COLUMN IF EXISTS campaign;