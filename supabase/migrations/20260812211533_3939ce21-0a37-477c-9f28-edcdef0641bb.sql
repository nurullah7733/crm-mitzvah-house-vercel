-- Recompute one contact's giving figures from the underlying records
CREATE OR REPLACE FUNCTION public.recalc_person_totals(_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lifetime numeric := 0;
  v_year numeric := 0;
  v_last_amount numeric;
  v_last_date date;
  v_last_interaction date;
BEGIN
  IF _person_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0),
         COALESCE(SUM(amount) FILTER (WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0),
         MAX(date)
    INTO v_lifetime, v_year, v_last_date
    FROM public.donations
   WHERE person_id = _person_id;

  IF v_last_date IS NOT NULL THEN
    SELECT amount INTO v_last_amount
      FROM public.donations
     WHERE person_id = _person_id AND date = v_last_date
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  SELECT MAX(date) INTO v_last_interaction
    FROM public.interactions
   WHERE person_id = _person_id;

  UPDATE public.people
     SET lifetime_giving = v_lifetime,
         this_year_giving = v_year,
         last_gift_amount = v_last_amount,
         last_gift_date = v_last_date,
         last_activity_date = GREATEST(COALESCE(v_last_date, v_last_interaction), COALESCE(v_last_interaction, v_last_date))
   WHERE id = _person_id;
END;
$$;

-- Trigger glue for donations
CREATE OR REPLACE FUNCTION public.donations_refresh_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS donations_refresh_totals ON public.donations;
CREATE TRIGGER donations_refresh_totals
AFTER INSERT OR UPDATE OR DELETE ON public.donations
FOR EACH ROW EXECUTE FUNCTION public.donations_refresh_totals();

-- Trigger glue for interactions (last activity only)
CREATE OR REPLACE FUNCTION public.interactions_refresh_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS interactions_refresh_totals ON public.interactions;
CREATE TRIGGER interactions_refresh_totals
AFTER INSERT OR UPDATE OR DELETE ON public.interactions
FOR EACH ROW EXECUTE FUNCTION public.interactions_refresh_totals();

-- Admin-only full rebuild
CREATE OR REPLACE FUNCTION public.recalculate_all_giving_totals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can recalculate totals';
  END IF;

  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_person_totals(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_all_giving_totals() TO authenticated;

-- One-time backfill so existing figures match the donation history
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
  END LOOP;
END $$;