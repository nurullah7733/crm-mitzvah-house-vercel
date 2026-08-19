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

  PERFORM set_config('app.privileged_op', 'on', true);

  SELECT to_jsonb(p) INTO v_snapshot FROM public.people p WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Contact to merge no longer exists'; END IF;
  SELECT to_jsonb(p) INTO v_surviving_before FROM public.people p WHERE id = _surviving_id;
  IF v_surviving_before IS NULL THEN RAISE EXCEPTION 'Surviving contact no longer exists'; END IF;

  DELETE FROM public.donations d
   WHERE d.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.donations s
                  WHERE s.person_id = _surviving_id
                    AND s.amount = d.amount
                    AND s.date = d.date
                    AND s.campaign_id IS NOT DISTINCT FROM d.campaign_id
                    AND s.deleted_at IS NULL)
     AND d.deleted_at IS NULL;
  UPDATE public.donations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('donations', v_n);

  UPDATE public.interactions SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('interactions', v_n);

  UPDATE public.registrations s SET status = r.status
    FROM public.registrations r
   WHERE r.person_id = _merged_id AND s.person_id = _surviving_id AND s.event_id = r.event_id
     AND public.registration_status_rank(r.status) > public.registration_status_rank(s.status);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations_upgraded', v_n);

  DELETE FROM public.registrations r
   WHERE r.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.registrations s WHERE s.person_id = _surviving_id AND s.event_id = r.event_id);
  UPDATE public.registrations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations', v_n);

  UPDATE public.tasks SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);
  UPDATE public.field_sources SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('field_sources', v_n);
  UPDATE public.yahrzeits SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('yahrzeits', v_n);
  UPDATE public.grants SET funder_id = _surviving_id WHERE funder_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_funder', v_n);
  UPDATE public.grants SET program_officer_id = _surviving_id WHERE program_officer_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_officer', v_n);
  UPDATE public.people SET parent_org_id = _surviving_id WHERE parent_org_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('child_contacts', v_n);

  DELETE FROM public.contact_methods m
   WHERE m.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.contact_methods s
                  WHERE s.person_id = _surviving_id AND s.kind = m.kind
                    AND lower(trim(s.value)) = lower(trim(m.value)));
  UPDATE public.contact_methods SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('contact_methods', v_n);
  UPDATE public.pledges SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('pledges', v_n);

  UPDATE public.people s SET
    display_name = COALESCE(NULLIF(_field_values->>'display_name',''), s.display_name),
    first_name = COALESCE(NULLIF(_field_values->>'first_name',''), s.first_name),
    last_name = COALESCE(NULLIF(_field_values->>'last_name',''), s.last_name),
    email = COALESCE(NULLIF(_field_values->>'email',''), s.email),
    phone = COALESCE(NULLIF(_field_values->>'phone',''), s.phone),
    role = COALESCE(NULLIF(_field_values->>'role',''), s.role),
    contact_type = COALESCE(NULLIF(_field_values->>'contact_type',''), s.contact_type),
    owner = COALESCE(NULLIF(_field_values->>'owner',''), s.owner),
    met_source = COALESCE(NULLIF(_field_values->>'met_source',''), s.met_source),
    met_date = COALESCE((_field_values->>'met_date')::date, s.met_date),
    birth_date = COALESCE((_field_values->>'birth_date')::date, s.birth_date),
    household_id = COALESCE((_field_values->>'household_id')::uuid, s.household_id),
    tags = CASE WHEN _field_values ? 'tags' THEN ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(_field_values->'tags') x) ELSE s.tags END,
    programs = CASE WHEN _field_values ? 'programs' THEN ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(_field_values->'programs') x) ELSE s.programs END
  WHERE s.id = _surviving_id;

  SELECT to_jsonb(p) INTO v_surviving_after FROM public.people p WHERE id = _surviving_id;
  DELETE FROM public.people WHERE id = _merged_id;

  INSERT INTO public.merge_log (surviving_person_id, merged_person_id, merged_snapshot, performed_by, performed_by_email, moved_counts)
  VALUES (_surviving_id, _merged_id, v_snapshot, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), v_counts);
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _surviving_id, 'merge', auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
    jsonb_build_object('merged_person', v_snapshot, 'surviving_before', v_surviving_before, 'surviving_after', v_surviving_after, 'moved_counts', v_counts));

  PERFORM public.recalc_person_totals(_surviving_id);
  RETURN _surviving_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_people(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid, jsonb) TO authenticated, service_role;