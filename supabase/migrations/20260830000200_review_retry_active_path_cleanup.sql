-- M2-H4: keep dedicated review kinds out of generic actions and prevent the
-- couple activity-owner flow from replaying stale contact fields.

CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge(
  _item_id uuid, _person_id uuid, _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[], _source text DEFAULT 'Import quick update',
  _batch_id uuid DEFAULT NULL, _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL, _note jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind text;
BEGIN
  IF COALESCE(_person_patch->>'__h2_contract', '') <> 'quick' THEN
    RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(row_data->'review_context'->>'kind', '') INTO v_kind
  FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_kind IN ('registration_payment_conflict','couple_activity_owner','household_conflict') THEN
    RAISE EXCEPTION 'REVIEW_DEDICATED_ACTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.resolve_review_merge_core($1,$2,'merged','Same person — contact updated in one tap, no conflicting fields',$3,$4,$5,$6,$7,$8,$9);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_review_manual_merge(
  _item_id uuid, _person_id uuid, _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[], _source text DEFAULT 'Import review',
  _batch_id uuid DEFAULT NULL, _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL,
  _note jsonb DEFAULT NULL, _existing_before jsonb DEFAULT '{}'::jsonb,
  _incoming jsonb DEFAULT '{}'::jsonb, _surviving_after jsonb DEFAULT '{}'::jsonb,
  _choices jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_review public.review_queue%ROWTYPE; v_kind text;
BEGIN
  IF COALESCE(_person_patch->>'__h2_contract', '') <> 'manual' THEN
    RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  v_kind := COALESCE(v_review.row_data->'review_context'->>'kind', '');
  IF v_kind IN ('couple_activity_owner','household_conflict') THEN
    RAISE EXCEPTION 'REVIEW_DEDICATED_ACTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_kind = 'registration_payment_conflict' AND NOT (
    _choices->>'activity_resolution' = 'keep_existing_registration_payment_skip_incoming_activity'
    AND _person_id = NULLIF(v_review.row_data->'review_context'->>'person_id', '')::uuid
    AND _event IS NULL AND _donation IS NULL AND _note IS NULL
  ) THEN RAISE EXCEPTION 'REVIEW_DEDICATED_ACTION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_result := public.resolve_review_merge_core($1,$2,'merged','Manual duplicate review merge',$3,$4,$5,$6,$7,$8,$9);
  PERFORM public.log_import_review_merge($1,$2,$10,$11,$12,$13);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_review_create(
  _item_id uuid, _person jsonb, _source text DEFAULT 'Import review', _batch_id uuid DEFAULT NULL,
  _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL, _note jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_review public.review_queue%ROWTYPE; v_person_id uuid; v_kind text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'marketing') OR public.has_role(auth.uid(),'va'))
    THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED' USING ERRCODE = 'P0001'; END IF;
  v_kind := COALESCE(v_review.row_data->'review_context'->>'kind','');
  IF v_kind IN ('transaction_contradiction','legacy_transaction','soft_deleted_transaction','transaction_concurrency_conflict')
    THEN RAISE EXCEPTION 'REVIEW_TRANSACTION_ACTION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF v_kind IN ('registration_payment_conflict','couple_activity_owner','household_conflict')
    THEN RAISE EXCEPTION 'REVIEW_DEDICATED_ACTION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.people (first_name,last_name,display_name,email,phone,role,birth_date,anniversary_date,school,notes,met_source,household_id,import_batch_id)
  VALUES (_person->>'first_name',_person->>'last_name',_person->>'display_name',_person->>'email',_person->>'phone',COALESCE(_person->>'role','Adult'),
    NULLIF(_person->>'birth_date','')::date,NULLIF(_person->>'anniversary_date','')::date,_person->>'school',_person->>'notes',_person->>'met_source',NULLIF(_person->>'household_id','')::uuid,_batch_id)
  RETURNING id INTO v_person_id;
  PERFORM public.resolve_review_merge_core(_item_id,v_person_id,'kept_both','Saved as a separate contact','{}'::jsonb,
    CASE WHEN NULLIF(_person->>'email','') IS NULL THEN '{}'::text[] ELSE ARRAY['email']::text[] END,
    _source,_batch_id,_event,_donation,_note);
  RETURN v_person_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_review_couple_activity(
  _item_id uuid, _owner text, _main jsonb, _partner jsonb, _row jsonb,
  _activity jsonb DEFAULT '{}'::jsonb, _labels jsonb DEFAULT '{}'::jsonb,
  _batch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review public.review_queue%ROWTYPE; v_main jsonb; v_partner jsonb;
  v_household jsonb := '{"action":"none"}'::jsonb; v_household_id uuid;
  v_main_household_id uuid; v_partner_household_id uuid; v_main_id uuid; v_partner_id uuid;
  v_result jsonb; v_resolved jsonb; v_address text := NULLIF(btrim(_row->>'address'), '');
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va'))
    THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _owner NOT IN ('main', 'partner') THEN RAISE EXCEPTION 'An explicit activity owner is required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(v_review.row_data->'review_context'->>'kind', '') <> 'couple_activity_owner'
    THEN RAISE EXCEPTION 'This review item is not a couple activity review'; END IF;

  v_main_id := NULLIF(_main->>'resolved_person_id', '')::uuid;
  v_partner_id := NULLIF(_partner->>'resolved_person_id', '')::uuid;
  IF v_main_id IS DISTINCT FROM NULLIF(v_review.row_data->'review_context'->'main_claim'->>'resolved_person_id', '')::uuid
    OR v_partner_id IS DISTINCT FROM NULLIF(v_review.row_data->'review_context'->'partner_claim'->>'resolved_person_id', '')::uuid
    THEN RAISE EXCEPTION 'Couple identity context changed; review this row again'; END IF;
  IF _main->>'first_name' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'first_name'
    OR _main->>'last_name' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'last_name'
    OR _main->>'email' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'email'
    OR _main->>'phone' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'phone'
    OR _partner->>'first_name' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'first_name'
    OR _partner->>'last_name' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'last_name'
    OR _partner->>'email' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'email'
    OR _partner->>'phone' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'phone'
    THEN RAISE EXCEPTION 'Couple claim context changed; review this row again'; END IF;

  v_main := jsonb_build_object('action', CASE WHEN v_main_id IS NULL THEN 'create' ELSE 'update' END, 'id', v_main_id,
    'values', CASE WHEN v_main_id IS NULL THEN jsonb_build_object('first_name',_main->>'first_name','last_name',_main->>'last_name',
      'display_name',concat_ws(' ',_main->>'first_name',_main->>'last_name'),'email',_main->>'email','phone',_main->>'phone','role','Adult') ELSE '{}'::jsonb END);
  v_partner := jsonb_build_object('action', CASE WHEN v_partner_id IS NULL THEN 'create' ELSE 'update' END, 'id', v_partner_id,
    'values', CASE WHEN v_partner_id IS NULL THEN jsonb_build_object('first_name',_partner->>'first_name','last_name',_partner->>'last_name',
      'display_name',concat_ws(' ',_partner->>'first_name',_partner->>'last_name'),'email',_partner->>'email','phone',_partner->>'phone','role','Adult') ELSE '{}'::jsonb END);

  IF v_main_id IS NOT NULL THEN SELECT household_id INTO v_main_household_id FROM public.people WHERE id=v_main_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The main contact no longer exists'; END IF; END IF;
  IF v_partner_id IS NOT NULL THEN SELECT household_id INTO v_partner_household_id FROM public.people WHERE id=v_partner_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The partner contact no longer exists'; END IF; END IF;
  IF v_main_household_id IS NOT NULL AND v_partner_household_id IS NOT NULL AND v_main_household_id <> v_partner_household_id
    THEN RAISE EXCEPTION 'Both people already belong to different households'; END IF;
  v_household_id := COALESCE(v_main_household_id, v_partner_household_id);
  IF v_household_id IS NULL AND public.household_address_key(v_address) IS NOT NULL THEN
    v_resolved := public.resolve_household_at_address(concat_ws(' ',_main->>'last_name','household'),v_address,NULL,NULL,'active',_batch_id);
    v_household_id := (v_resolved->>'household_id')::uuid;
  END IF;
  IF v_household_id IS NULL THEN
    INSERT INTO public.households(name,address,status,import_batch_id)
    VALUES(concat_ws(' ',_main->>'last_name','household'),v_address,'active',_batch_id) RETURNING id INTO v_household_id;
  END IF;
  v_household := jsonb_build_object('action','use','id',v_household_id);

  v_result := public.resolve_import_row(v_main,v_household,'[]'::jsonb,
    CASE WHEN _owner='main' THEN _labels ELSE '{}'::jsonb END,'[]'::jsonb,_batch_id,
    jsonb_build_object('action',CASE WHEN v_partner_id IS NULL THEN 'create' ELSE 'update' END,'id',v_partner_id,
      'values',v_partner->'values','contact_methods',jsonb_build_array(),'household_relationship','Spouse'),
    '[]'::jsonb,CASE WHEN _owner='main' THEN _activity ELSE '{}'::jsonb END);
  IF _owner='partner' THEN
    PERFORM public.apply_import_activity_core((v_result->>'spouse_id')::uuid,COALESCE(_activity->'registrations','[]'::jsonb),
      NULLIF(_activity->'donation','null'::jsonb),NULLIF(_activity->'note','null'::jsonb),_batch_id);
    UPDATE public.people p SET
      tags=p.tags||ARRAY(SELECT incoming.label FROM jsonb_array_elements_text(COALESCE(_labels->'tags','[]'::jsonb)) incoming(label)
        WHERE NULLIF(btrim(incoming.label),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(p.tags) current_label WHERE regexp_replace(lower(btrim(current_label)),'\s+',' ','g')=regexp_replace(lower(btrim(incoming.label)),'\s+',' ','g'))),
      programs=p.programs||ARRAY(SELECT incoming.label FROM jsonb_array_elements_text(COALESCE(_labels->'programs','[]'::jsonb)) incoming(label)
        WHERE NULLIF(btrim(incoming.label),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(p.programs) current_label WHERE regexp_replace(lower(btrim(current_label)),'\s+',' ','g')=regexp_replace(lower(btrim(incoming.label)),'\s+',' ','g')))
    WHERE p.id=(v_result->>'spouse_id')::uuid;
  END IF;
  PERFORM public.log_review_decision(_item_id,'created','Couple activity assigned to '||_owner,
    CASE WHEN _owner='main' THEN (v_result->>'person_id')::uuid ELSE (v_result->>'spouse_id')::uuid END);
  RETURN v_result||jsonb_build_object('activity_owner',_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_quick_merge(uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_quick_merge(uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_review_manual_merge(uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_manual_merge(uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_review_create(uuid,jsonb,text,uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_create(uuid,jsonb,text,uuid,jsonb,jsonb,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_review_couple_activity(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_couple_activity(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid) TO authenticated, service_role;
