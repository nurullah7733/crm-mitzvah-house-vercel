ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.households
  DROP CONSTRAINT IF EXISTS households_status_check;
ALTER TABLE public.households
  ADD CONSTRAINT households_status_check CHECK (status IN ('active', 'address_only'));

CREATE INDEX IF NOT EXISTS households_status_idx ON public.households (status);

ALTER TABLE public.interactions ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE;
ALTER TABLE public.interactions
  DROP CONSTRAINT IF EXISTS interactions_subject_check;
ALTER TABLE public.interactions
  ADD CONSTRAINT interactions_subject_check CHECK (person_id IS NOT NULL OR household_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS interactions_household_idx ON public.interactions (household_id, date DESC);

CREATE OR REPLACE FUNCTION public.interactions_refresh_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.person_id IS NOT NULL THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.person_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.interactions_refresh_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interactions_refresh_totals() TO service_role;