-- M2-H5: bind the atomic person/household merge to both person snapshots.

DROP FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid);

CREATE FUNCTION public.merge_people_with_households(
  _surviving_id uuid,
  _merged_id uuid,
  _field_values jsonb,
  _merge_households boolean,
  _expected_surviving_household_id uuid,
  _expected_merged_household_id uuid,
  _expected_surviving_person jsonb,
  _expected_merged_person jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor public.people%ROWTYPE;
  v_merged public.people%ROWTYPE;
  v_surviving_household_id uuid;
  v_other_household_id uuid;
  v_key text;
  v_expected jsonb;
  v_current jsonb;
  v_allowed text[] := ARRAY[
    'display_name','first_name','last_name','email','phone','role','contact_type',
    'owner','met_source','met_date','birth_date','household_id','tags','programs'
  ];
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different contacts to merge';
  END IF;
  IF jsonb_typeof(_expected_surviving_person) <> 'object'
     OR jsonb_typeof(_expected_merged_person) <> 'object' THEN
    RAISE EXCEPTION 'MERGE_EXPECTED_PERSON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.people WHERE id IN (_surviving_id, _merged_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_survivor FROM public.people WHERE id = _surviving_id AND deleted_at IS NULL;
  SELECT * INTO v_merged FROM public.people WHERE id = _merged_id AND deleted_at IS NULL;
  IF v_survivor.id IS NULL OR v_merged.id IS NULL THEN RAISE EXCEPTION 'A contact changed before merge'; END IF;

  -- Validate both complete editable snapshots before person, household, or audit writes.
  FOR v_key IN SELECT unnest(v_allowed) LOOP
    IF NOT (_expected_surviving_person ? v_key) OR NOT (_expected_merged_person ? v_key) THEN
      RAISE EXCEPTION 'MERGE_EXPECTED_PERSON_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    v_expected := _expected_surviving_person->v_key;
    v_current := to_jsonb(v_survivor)->v_key;
    IF v_current IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'MERGE_STALE_PERSON' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('person_id',_surviving_id,'field',v_key,'expected',v_expected,'current',v_current)::text;
    END IF;
    v_expected := _expected_merged_person->v_key;
    v_current := to_jsonb(v_merged)->v_key;
    IF v_current IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'MERGE_STALE_PERSON' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('person_id',_merged_id,'field',v_key,'expected',v_expected,'current',v_current)::text;
    END IF;
  END LOOP;

  IF v_survivor.household_id IS DISTINCT FROM _expected_surviving_household_id
     OR v_merged.household_id IS DISTINCT FROM _expected_merged_household_id THEN
    RAISE EXCEPTION 'REVIEW_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.households
  WHERE id IN (v_survivor.household_id, v_merged.household_id) ORDER BY id FOR UPDATE;

  v_surviving_household_id := COALESCE(NULLIF(_field_values->>'household_id', '')::uuid, v_survivor.household_id);
  v_other_household_id := CASE
    WHEN v_survivor.household_id IS NOT NULL AND v_survivor.household_id <> v_surviving_household_id THEN v_survivor.household_id
    WHEN v_merged.household_id IS NOT NULL AND v_merged.household_id <> v_surviving_household_id THEN v_merged.household_id
    ELSE NULL END;
  IF _merge_households AND (v_surviving_household_id IS NULL OR v_other_household_id IS NULL) THEN
    RAISE EXCEPTION 'HOUSEHOLD_MERGE_TARGET_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.merge_people(_surviving_id, _merged_id, _field_values);
  IF _merge_households THEN
    PERFORM public.merge_households(v_surviving_household_id, v_other_household_id, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('person_id', _surviving_id, 'households_merged', _merge_households,
    'household_id', v_surviving_household_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid,jsonb,jsonb) TO authenticated, service_role;
