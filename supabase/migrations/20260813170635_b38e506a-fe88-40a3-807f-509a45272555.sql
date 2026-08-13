CREATE OR REPLACE FUNCTION public.merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_surviving jsonb;
  v_moved integer := 0;
  v_key text;
  v_allowed text[] := ARRAY['name','address','address_line2','address_line3','city','state','postal_code','county','billing_address','phone','notes'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different households to merge';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

  SELECT to_jsonb(h) INTO v_snapshot FROM public.households h WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Household to merge no longer exists'; END IF;
  SELECT to_jsonb(h) INTO v_surviving FROM public.households h WHERE id = _surviving_id;
  IF v_surviving IS NULL THEN RAISE EXCEPTION 'Surviving household no longer exists'; END IF;

  UPDATE public.people SET household_id = _surviving_id WHERE household_id = _merged_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(_field_values, '{}'::jsonb)) LOOP
    IF v_key = ANY(v_allowed) THEN
      EXECUTE format('UPDATE public.households SET %I = $1 WHERE id = $2', v_key)
        USING NULLIF(_field_values ->> v_key, ''), _surviving_id;
    END IF;
  END LOOP;

  DELETE FROM public.households WHERE id = _merged_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES (
    'households',
    _surviving_id,
    'merge',
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    jsonb_build_object('merged_household', v_snapshot, 'surviving_before', v_surviving, 'members_moved', v_moved)
  );

  RETURN _surviving_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_households(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_households(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_households(uuid, uuid, jsonb) TO service_role;