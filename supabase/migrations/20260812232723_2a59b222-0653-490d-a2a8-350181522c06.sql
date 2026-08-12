-- 1. merge_people: also write both original records into the audit trail
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

-- 2. Record a review decision, with the reviewer's reason, in the change history
CREATE OR REPLACE FUNCTION public.log_review_decision(
  _item_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _person_id uuid DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _decision NOT IN ('merged', 'edited', 'kept_both', 'discarded', 'created') THEN
    RAISE EXCEPTION 'Unknown review decision';
  END IF;
  IF _decision = 'discarded' AND COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a short reason for discarding this row';
  END IF;

  SELECT to_jsonb(r) INTO v_row FROM public.review_queue r WHERE id = _item_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;

  v_status := CASE WHEN _decision = 'discarded' THEN 'dismissed' ELSE 'resolved' END;

  UPDATE public.review_queue
     SET status = v_status,
         resolution_note = COALESCE(NULLIF(TRIM(_reason), ''), _decision)
   WHERE id = _item_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('review_queue', _item_id, 'review_' || _decision, auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('reason', _reason, 'person_id', _person_id, 'queued_row', v_row));
END;
$function$;

-- 3. Duplicate pairs already in the database
CREATE OR REPLACE FUNCTION public.find_duplicate_people()
 RETURNS TABLE (person_a uuid, person_b uuid, reason text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT id, LOWER(TRIM(email)) AS email,
           RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 10) AS phone,
           LOWER(TRIM(COALESCE(display_name, CONCAT_WS(' ', first_name, last_name)))) AS name,
           household_id, created_at
      FROM public.people
     WHERE deleted_at IS NULL
  ),
  pairs AS (
    SELECT a.id AS person_a, b.id AS person_b, 'Same email address' AS reason
      FROM live a JOIN live b ON a.email = b.email AND a.created_at < b.created_at
     WHERE COALESCE(a.email, '') <> ''
    UNION ALL
    SELECT a.id, b.id, 'Same phone number'
      FROM live a JOIN live b ON a.phone = b.phone AND a.created_at < b.created_at
     WHERE LENGTH(a.phone) >= 7
    UNION ALL
    SELECT a.id, b.id, 'Same name in the same household'
      FROM live a JOIN live b
        ON a.name = b.name AND a.household_id IS NOT DISTINCT FROM b.household_id
       AND a.created_at < b.created_at
     WHERE COALESCE(a.name, '') <> '' AND a.household_id IS NOT NULL
  )
  SELECT person_a, person_b, MIN(reason) AS reason
    FROM pairs
   GROUP BY person_a, person_b
   LIMIT 200
$function$;

REVOKE ALL ON FUNCTION public.find_duplicate_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_duplicate_people() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_review_decision(uuid, text, text, uuid) TO authenticated;