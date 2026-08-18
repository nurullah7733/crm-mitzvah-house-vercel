-- Manual gifts get the same duplicate protection imports have: a stable
-- fingerprint (donor identity + date + amount + campaign) that the existing
-- unique index donations_import_fingerprint_unique enforces.
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

  -- Same order and shape as the importer's donor key, so an imported gift and a
  -- hand-typed one for the same donor produce the same fingerprint.
  IF COALESCE(trim(v_person.email), '') <> '' THEN
    v_donor := 'email:' || lower(trim(v_person.email));
  ELSIF length(v_digits) >= 7 THEN
    v_donor := 'phone:' || right(v_digits, 10);
  ELSIF v_name <> '' THEN
    v_donor := 'name:' || v_name;
  ELSE
    RETURN NEW;
  END IF;

  v_campaign := lower(regexp_replace(COALESCE(trim(NEW.campaign), ''), '\s+', ' ', 'g'));

  NEW.import_fingerprint := concat_ws('|',
    v_donor,
    NEW.date::text,
    to_char(NEW.amount, 'FM9999999990.00'),
    v_campaign
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.donations_fill_fingerprint() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.donations_fill_fingerprint() FROM anon;
REVOKE ALL ON FUNCTION public.donations_fill_fingerprint() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.donations_fill_fingerprint() TO service_role;

DROP TRIGGER IF EXISTS donations_fill_fingerprint_before_insert ON public.donations;
CREATE TRIGGER donations_fill_fingerprint_before_insert
BEFORE INSERT ON public.donations
FOR EACH ROW EXECUTE FUNCTION public.donations_fill_fingerprint();

COMMENT ON COLUMN public.donations.import_fingerprint IS
  'Donor identity + date + amount + campaign. Filled automatically for every gift (imported or hand-entered) and enforced unique, so the same gift cannot be recorded twice.';