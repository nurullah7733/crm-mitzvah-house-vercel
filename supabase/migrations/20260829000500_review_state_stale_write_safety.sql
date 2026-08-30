-- M2-H2: review state, stale person-write, and transactional quick-undo safety.

CREATE OR REPLACE FUNCTION public.log_review_decision(
  _item_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _person_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _decision NOT IN ('merged', 'edited', 'kept_both', 'discarded', 'created') THEN
    RAISE EXCEPTION 'Unknown review decision';
  END IF;
  IF _decision = 'discarded' AND COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a short reason for discarding this row';
  END IF;

  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN
    RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED' USING ERRCODE = 'P0001';
  END IF;
  v_status := CASE WHEN _decision = 'discarded' THEN 'dismissed' ELSE 'resolved' END;
  UPDATE public.review_queue SET
    status = v_status,
    resolution_note = COALESCE(NULLIF(btrim(_reason), ''), _decision)
  WHERE id = _item_id;
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('review_queue', _item_id, 'review_' || _decision, auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('reason', _reason, 'person_id', _person_id, 'queued_row', to_jsonb(v_review)));
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_review_status(
  _item_id uuid,
  _expected_status text,
  _next_status text,
  _note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_review public.review_queue%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status IS DISTINCT FROM _expected_status THEN
    RAISE EXCEPTION 'REVIEW_STALE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  IF NOT ((_expected_status = 'pending' AND _next_status = 'skipped')
       OR (_expected_status IN ('skipped', 'dismissed') AND _next_status = 'pending')) THEN
    RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.review_queue SET status = _next_status, resolution_note = NULLIF(btrim(_note), '')
  WHERE id = _item_id;
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('review_queue', _item_id, 'review_status_transition', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('from', _expected_status, 'to', _next_status, 'note', _note));
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_review_merge_core(
  _item_id uuid, _person_id uuid, _decision text, _reason text,
  _person_patch jsonb DEFAULT '{}'::jsonb, _traceable_fields text[] DEFAULT '{}'::text[],
  _source text DEFAULT 'Import review', _batch_id uuid DEFAULT NULL,
  _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL, _note jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_person public.people%ROWTYPE;
  v_patch jsonb := CASE WHEN _person_patch ? '__h2_values' THEN COALESCE(_person_patch->'__h2_values', '{}'::jsonb) ELSE _person_patch END;
  v_expected jsonb := CASE WHEN _person_patch ? '__h2_expected' THEN COALESCE(_person_patch->'__h2_expected', '{}'::jsonb) ELSE '{}'::jsonb END;
  v_contract text := COALESCE(_person_patch->>'__h2_contract', 'internal');
  v_allowed text[] := ARRAY['display_name','first_name','last_name','email','phone','role','birth_date','anniversary_date','school','notes','met_source'];
  v_key text;
  v_person_before jsonb := '{}'::jsonb;
  v_person_after jsonb := '{}'::jsonb;
  v_activity jsonb;
  v_registration_before jsonb;
  v_registration_after jsonb;
  v_donation_after jsonb;
  v_note_after jsonb;
  v_registration_id uuid;
  v_donation_id uuid;
  v_note_id uuid;
  v_review_kind text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED' USING ERRCODE = 'P0001'; END IF;
  v_review_kind := COALESCE(v_review.row_data->'review_context'->>'kind', '');
  IF v_contract IN ('quick', 'manual') AND v_review_kind IN (
    'transaction_contradiction', 'legacy_transaction', 'soft_deleted_transaction', 'transaction_concurrency_conflict'
  ) THEN RAISE EXCEPTION 'REVIEW_TRANSACTION_ACTION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF v_contract IN ('quick', 'manual')
     AND cardinality(v_review.candidate_person_ids) > 0
     AND NOT (_person_id = ANY(v_review.candidate_person_ids)) THEN
    RAISE EXCEPTION 'REVIEW_TARGET_NOT_CANDIDATE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_person FROM public.people WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That contact no longer exists'; END IF;

  IF v_contract IN ('quick', 'manual') THEN
    IF jsonb_typeof(v_patch) <> 'object' OR jsonb_typeof(v_expected) <> 'object' THEN
      RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_patch) LOOP
      IF NOT (v_key = ANY(v_allowed)) OR NOT (v_expected ? v_key) THEN
        RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
      END IF;
      IF to_jsonb(v_person)->v_key IS DISTINCT FROM v_expected->v_key THEN
        RAISE EXCEPTION 'REVIEW_STALE_PERSON' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('field', v_key, 'expected', v_expected->v_key, 'current', to_jsonb(v_person)->v_key)::text;
      END IF;
      v_person_before := v_person_before || jsonb_build_object(v_key, to_jsonb(v_person)->v_key);
      v_person_after := v_person_after || jsonb_build_object(v_key, v_patch->v_key);
    END LOOP;
  END IF;

  UPDATE public.people SET
    display_name = CASE WHEN v_patch ? 'display_name' THEN v_patch->>'display_name' ELSE display_name END,
    first_name = CASE WHEN v_patch ? 'first_name' THEN v_patch->>'first_name' ELSE first_name END,
    last_name = CASE WHEN v_patch ? 'last_name' THEN v_patch->>'last_name' ELSE last_name END,
    email = CASE WHEN v_patch ? 'email' THEN v_patch->>'email' ELSE email END,
    phone = CASE WHEN v_patch ? 'phone' THEN v_patch->>'phone' ELSE phone END,
    role = CASE WHEN v_patch ? 'role' THEN v_patch->>'role' ELSE role END,
    birth_date = CASE WHEN v_patch ? 'birth_date' THEN NULLIF(v_patch->>'birth_date', '')::date ELSE birth_date END,
    anniversary_date = CASE WHEN v_patch ? 'anniversary_date' THEN NULLIF(v_patch->>'anniversary_date', '')::date ELSE anniversary_date END,
    school = CASE WHEN v_patch ? 'school' THEN v_patch->>'school' ELSE school END,
    notes = CASE WHEN v_patch ? 'notes' THEN v_patch->>'notes' ELSE notes END,
    met_source = CASE WHEN v_patch ? 'met_source' THEN v_patch->>'met_source' ELSE met_source END
  WHERE id = _person_id;

  IF cardinality(_traceable_fields) > 0 THEN BEGIN
    INSERT INTO public.field_sources (person_id, field_name, source, recorded_date, import_batch_id)
    SELECT _person_id, field_name, _source, current_date, _batch_id FROM unnest(_traceable_fields) field_name;
  EXCEPTION WHEN OTHERS THEN NULL; END; END IF;

  IF _event IS NOT NULL THEN
    SELECT to_jsonb(r) INTO v_registration_before FROM public.registrations r
    WHERE r.event_id = (_event->>'event_id')::uuid AND r.person_id = _person_id FOR UPDATE;
  END IF;
  v_activity := public.apply_import_activity_core(
    _person_id, CASE WHEN _event IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(_event) END,
    _donation, _note, _batch_id);
  v_registration_id := NULLIF(v_activity->>'registration_id', '')::uuid;
  v_donation_id := NULLIF(v_activity->>'donation_id', '')::uuid;
  v_note_id := NULLIF(v_activity->>'note_id', '')::uuid;
  IF v_registration_id IS NOT NULL THEN SELECT to_jsonb(r) INTO v_registration_after FROM public.registrations r WHERE id = v_registration_id; END IF;
  IF v_donation_id IS NOT NULL THEN SELECT to_jsonb(d) INTO v_donation_after FROM public.donations d WHERE id = v_donation_id; END IF;
  IF v_note_id IS NOT NULL THEN SELECT to_jsonb(i) INTO v_note_after FROM public.interactions i WHERE id = v_note_id; END IF;
  PERFORM public.log_review_decision(_item_id, _decision, _reason, _person_id);
  RETURN jsonb_build_object(
    'person_id', _person_id,
    'event_name', CASE WHEN _event IS NULL THEN NULL ELSE (SELECT name FROM public.events WHERE id = (_event->>'event_id')::uuid) END,
    'undo_token', jsonb_build_object(
      'person_id', _person_id, 'person_before', v_person_before, 'person_after', v_person_after,
      'registration_before', v_registration_before, 'registration_after', v_registration_after,
      'donation_after', v_donation_after, 'note_after', v_note_after)
  ) || v_activity;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge(
  _item_id uuid, _person_id uuid, _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[], _source text DEFAULT 'Import quick update',
  _batch_id uuid DEFAULT NULL, _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL, _note jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(_person_patch->>'__h2_contract', '') <> 'quick' THEN
    RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
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
DECLARE v_result jsonb;
BEGIN
  IF COALESCE(_person_patch->>'__h2_contract', '') <> 'manual' THEN
    RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
  END IF;
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

CREATE OR REPLACE FUNCTION public.undo_review_quick_merge(
  _item_id uuid, _person_id uuid, _undo_token jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review public.review_queue%ROWTYPE; v_person public.people%ROWTYPE; v_key text;
  v_before jsonb := COALESCE(_undo_token->'person_before','{}'::jsonb);
  v_after jsonb := COALESCE(_undo_token->'person_after','{}'::jsonb);
  v_expected jsonb; v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'marketing') OR public.has_role(auth.uid(),'va'))
    THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND OR v_review.status <> 'resolved' THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  IF NULLIF(_undo_token->>'person_id','')::uuid IS DISTINCT FROM _person_id THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_person FROM public.people WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_after) LOOP
    IF to_jsonb(v_person)->v_key IS DISTINCT FROM v_after->v_key THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  IF _undo_token->'donation_after' IS NOT NULL AND _undo_token->'donation_after' <> 'null'::jsonb THEN
    SELECT to_jsonb(d) INTO v_current FROM public.donations d WHERE id = (_undo_token#>>'{donation_after,id}')::uuid FOR UPDATE;
    IF v_current IS DISTINCT FROM _undo_token->'donation_after' THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF _undo_token->'registration_after' IS NOT NULL AND _undo_token->'registration_after' <> 'null'::jsonb THEN
    SELECT to_jsonb(r) INTO v_current FROM public.registrations r WHERE id = (_undo_token#>>'{registration_after,id}')::uuid FOR UPDATE;
    IF v_current IS DISTINCT FROM _undo_token->'registration_after' THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF _undo_token->'note_after' IS NOT NULL AND _undo_token->'note_after' <> 'null'::jsonb THEN
    SELECT to_jsonb(i) INTO v_current FROM public.interactions i WHERE id = (_undo_token#>>'{note_after,id}')::uuid FOR UPDATE;
    IF v_current IS DISTINCT FROM _undo_token->'note_after' THEN RAISE EXCEPTION 'REVIEW_STALE_UNDO' USING ERRCODE = 'P0001'; END IF;
  END IF;
  UPDATE public.people SET
    display_name=CASE WHEN v_before?'display_name' THEN v_before->>'display_name' ELSE display_name END,
    first_name=CASE WHEN v_before?'first_name' THEN v_before->>'first_name' ELSE first_name END,
    last_name=CASE WHEN v_before?'last_name' THEN v_before->>'last_name' ELSE last_name END,
    email=CASE WHEN v_before?'email' THEN v_before->>'email' ELSE email END,
    phone=CASE WHEN v_before?'phone' THEN v_before->>'phone' ELSE phone END,
    role=CASE WHEN v_before?'role' THEN v_before->>'role' ELSE role END,
    birth_date=CASE WHEN v_before?'birth_date' THEN NULLIF(v_before->>'birth_date','')::date ELSE birth_date END,
    anniversary_date=CASE WHEN v_before?'anniversary_date' THEN NULLIF(v_before->>'anniversary_date','')::date ELSE anniversary_date END,
    school=CASE WHEN v_before?'school' THEN v_before->>'school' ELSE school END,
    notes=CASE WHEN v_before?'notes' THEN v_before->>'notes' ELSE notes END,
    met_source=CASE WHEN v_before?'met_source' THEN v_before->>'met_source' ELSE met_source END
  WHERE id=_person_id;
  IF _undo_token->'donation_after' IS NOT NULL AND _undo_token->'donation_after' <> 'null'::jsonb THEN
    DELETE FROM public.donations WHERE id=(_undo_token#>>'{donation_after,id}')::uuid;
  END IF;
  IF _undo_token->'note_after' IS NOT NULL AND _undo_token->'note_after' <> 'null'::jsonb THEN
    DELETE FROM public.interactions WHERE id=(_undo_token#>>'{note_after,id}')::uuid;
  END IF;
  IF _undo_token->'registration_after' IS NOT NULL AND _undo_token->'registration_after' <> 'null'::jsonb THEN
    IF _undo_token->'registration_before' IS NULL OR _undo_token->'registration_before'='null'::jsonb THEN
      DELETE FROM public.registrations WHERE id=(_undo_token#>>'{registration_after,id}')::uuid;
    ELSE
      UPDATE public.registrations SET status=_undo_token#>>'{registration_before,status}',
        fee_amount=(_undo_token#>>'{registration_before,fee_amount}')::numeric,
        payment_amount=NULLIF(_undo_token#>>'{registration_before,payment_amount}','')::numeric
      WHERE id=(_undo_token#>>'{registration_after,id}')::uuid;
    END IF;
  END IF;
  UPDATE public.review_queue SET status='pending', resolution_note='One-tap update undone safely' WHERE id=_item_id;
  INSERT INTO public.audit_log(table_name,record_id,action,actor_id,actor_email,changes)
  VALUES('review_queue',_item_id,'review_quick_merge_undone',auth.uid(),
    NULLIF(current_setting('request.jwt.claims',true)::jsonb->>'email',''),jsonb_build_object('undo_token',_undo_token));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_review_status(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_review_status(uuid,text,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.undo_review_quick_merge(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_review_quick_merge(uuid,uuid,jsonb) TO authenticated, service_role;
