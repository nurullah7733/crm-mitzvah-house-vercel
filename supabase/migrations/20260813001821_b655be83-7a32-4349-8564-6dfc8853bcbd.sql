CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE INDEX IF NOT EXISTS people_display_name_trgm ON public.people USING gin (lower(coalesce(display_name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS people_first_name_trgm ON public.people USING gin (lower(coalesce(first_name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS people_last_name_trgm ON public.people USING gin (lower(coalesce(last_name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS people_email_trgm ON public.people USING gin (lower(coalesce(email, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS people_tags_gin ON public.people USING gin (tags);
CREATE INDEX IF NOT EXISTS people_programs_gin ON public.people USING gin (programs);
CREATE INDEX IF NOT EXISTS households_name_trgm ON public.households USING gin (lower(coalesce(name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS households_address_trgm ON public.households USING gin (lower(coalesce(address, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS events_name_trgm ON public.events USING gin (lower(coalesce(name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS campaigns_name_trgm ON public.campaigns USING gin (lower(coalesce(name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS grants_name_trgm ON public.grants USING gin (lower(coalesce(name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS interactions_text_trgm ON public.interactions USING gin (lower(coalesce(text, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tasks_text_trgm ON public.tasks USING gin (lower(coalesce(text, '')) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_people(_q text, _limit integer DEFAULT 200)
RETURNS TABLE(person_id uuid, reason text, score real)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

GRANT EXECUTE ON FUNCTION public.search_people(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.tag_program_counts()
RETURNS TABLE(kind text, label text, contacts bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 'tag' AS kind, tg AS label, count(*) AS contacts
    FROM public.people p, unnest(p.tags) tg
   WHERE p.deleted_at IS NULL AND coalesce(trim(tg), '') <> ''
   GROUP BY tg
  UNION ALL
  SELECT 'program', pr, count(*)
    FROM public.people p, unnest(p.programs) pr
   WHERE p.deleted_at IS NULL AND coalesce(trim(pr), '') <> ''
   GROUP BY pr
   ORDER BY kind, contacts DESC, label
$function$;

GRANT EXECUTE ON FUNCTION public.tag_program_counts() TO authenticated;