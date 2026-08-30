-- M2-H5: a manual comparison is stale when any field shown by the dialog changed,
-- even when the incoming patch would only fill a different blank field.

CREATE OR REPLACE FUNCTION public.resolve_review_manual_merge(
  _item_id uuid, _person_id uuid, _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[], _source text DEFAULT 'Import review',
  _batch_id uuid DEFAULT NULL, _event jsonb DEFAULT NULL, _donation jsonb DEFAULT NULL,
  _note jsonb DEFAULT NULL, _existing_before jsonb DEFAULT '{}'::jsonb,
  _incoming jsonb DEFAULT '{}'::jsonb, _surviving_after jsonb DEFAULT '{}'::jsonb,
  _choices jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_review public.review_queue%ROWTYPE;
  v_person public.people%ROWTYPE;
  v_kind text;
  v_key text;
  v_expected jsonb := COALESCE(_person_patch->'__h2_expected', '{}'::jsonb);
  v_protected text[] := ARRAY[
    'first_name','last_name','display_name','email','phone','role','birth_date',
    'anniversary_date','school','notes','met_source'
  ];
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
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

  IF jsonb_typeof(v_expected) <> 'object' THEN
    RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_person FROM public.people
  WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That contact no longer exists'; END IF;
  -- Validate the entire immutable dialog snapshot before the shared core can
  -- update a person, apply activity, write audit history, or finalize review.
  FOREACH v_key IN ARRAY v_protected LOOP
    IF NOT (v_expected ? v_key) THEN
      RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
    END IF;
    IF to_jsonb(v_person)->v_key IS DISTINCT FROM v_expected->v_key THEN
      RAISE EXCEPTION 'REVIEW_STALE_PERSON' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'field', v_key, 'expected', v_expected->v_key,
          'current', to_jsonb(v_person)->v_key
        )::text;
    END IF;
  END LOOP;

  v_result := public.resolve_review_merge_core(
    $1,$2,'merged','Manual duplicate review merge',$3,$4,$5,$6,$7,$8,$9
  );
  PERFORM public.log_import_review_merge($1,$2,$10,$11,$12,$13);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_manual_merge(
  uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_manual_merge(
  uuid,uuid,jsonb,text[],text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) TO authenticated, service_role;
