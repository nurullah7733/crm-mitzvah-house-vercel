-- 1. Shared app settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in staff can read settings" ON public.app_settings;
CREATE POLICY "Signed-in staff can read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can add settings" ON public.app_settings;
CREATE POLICY "Admins can add settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can change settings" ON public.app_settings;
CREATE POLICY "Admins can change settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value)
VALUES ('renewal_outreach', jsonb_build_object('min_total_giving', 0, 'min_prior_years', 1))
ON CONFLICT (key) DO NOTHING;

-- 2. Renewal / LYBUNT / SYBUNT report, always computed live from the gift ledger
CREATE OR REPLACE FUNCTION public.lapsed_donors(
  _mode text DEFAULT 'lapsed',
  _min_total numeric DEFAULT NULL,
  _min_prior_years integer DEFAULT NULL,
  _limit integer DEFAULT 500
)
RETURNS TABLE(
  person_id uuid,
  name text,
  owner text,
  email text,
  phone text,
  lifetime_total numeric,
  prior_years integer,
  gave_last_year boolean,
  last_gift_amount numeric,
  last_gift_date date,
  last_gift_year integer,
  score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE(_min_total, (value->>'min_total_giving')::numeric, 0) AS min_total,
      COALESCE(_min_prior_years, (value->>'min_prior_years')::int, 1) AS min_years
      FROM public.app_settings WHERE key = 'renewal_outreach'
  ),
  fallback AS (
    SELECT COALESCE((SELECT min_total FROM cfg), COALESCE(_min_total, 0)) AS min_total,
           COALESCE((SELECT min_years FROM cfg), COALESCE(_min_prior_years, 1)) AS min_years
  ),
  this_year AS (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y),
  gifts AS (
    SELECT d.person_id, d.amount, d.date, EXTRACT(YEAR FROM d.date)::int AS gift_year
      FROM public.donations d
      JOIN public.people p ON p.id = d.person_id
     WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL
  ),
  rolled AS (
    SELECT g.person_id,
           SUM(g.amount) AS lifetime_total,
           COUNT(DISTINCT g.gift_year) FILTER (WHERE g.gift_year < (SELECT y FROM this_year)) AS prior_years,
           BOOL_OR(g.gift_year = (SELECT y FROM this_year)) AS gave_this_year,
           BOOL_OR(g.gift_year = (SELECT y FROM this_year) - 1) AS gave_last_year,
           MAX(g.date) AS last_gift_date
      FROM gifts g
     GROUP BY g.person_id
  ),
  eligible AS (
    SELECT r.*,
           (SELECT amount FROM public.donations d2
             WHERE d2.person_id = r.person_id AND d2.date = r.last_gift_date AND d2.deleted_at IS NULL
             ORDER BY d2.created_at DESC NULLS LAST LIMIT 1) AS last_gift_amount
      FROM rolled r, fallback f
     WHERE r.gave_this_year IS NOT TRUE
       AND r.prior_years >= f.min_years
       AND r.lifetime_total >= f.min_total
  )
  SELECT e.person_id,
         COALESCE(p.display_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS name,
         p.owner,
         p.email,
         p.phone,
         ROUND(e.lifetime_total, 2) AS lifetime_total,
         e.prior_years::int,
         COALESCE(e.gave_last_year, false) AS gave_last_year,
         ROUND(e.last_gift_amount, 2) AS last_gift_amount,
         e.last_gift_date,
         EXTRACT(YEAR FROM e.last_gift_date)::int AS last_gift_year,
         -- consistency counts as much as size: each prior year of giving is
         -- worth as much as $500 of lifetime support
         ROUND((e.prior_years * 500) + LEAST(e.lifetime_total, 25000), 2) AS score
    FROM eligible e
    JOIN public.people p ON p.id = e.person_id
   WHERE CASE lower(COALESCE(_mode, 'lapsed'))
            WHEN 'lybunt' THEN COALESCE(e.gave_last_year, false)
            WHEN 'sybunt' THEN NOT COALESCE(e.gave_last_year, false)
            ELSE true
          END
   ORDER BY score DESC, e.last_gift_date DESC NULLS LAST
   LIMIT COALESCE(_limit, 500)
$function$;

REVOKE ALL ON FUNCTION public.lapsed_donors(text, numeric, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lapsed_donors(text, numeric, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.lapsed_donors(text, numeric, integer, integer) TO authenticated;

-- 3. January 1 refresh of stored year-to-date totals
CREATE OR REPLACE FUNCTION public.recalc_all_totals_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0; r record;
BEGIN
  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalc_all_totals_internal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_all_totals_internal() FROM anon;
REVOKE ALL ON FUNCTION public.recalc_all_totals_internal() FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('new-year-giving-totals-reset')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'new-year-giving-totals-reset');
    PERFORM cron.schedule('new-year-giving-totals-reset', '5 0 1 1 *',
      $cron$SELECT public.recalc_all_totals_internal();$cron$);
  END IF;
END $$;