-- M2-H3: stale-safe household correction, membership, merge, and address coordination.

CREATE OR REPLACE FUNCTION public.household_address_key(_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    CASE
      WHEN length(regexp_replace(
        regexp_replace(lower(coalesce(_address, '')), '\m(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|apartment|apt|unit|suite|ste)\M', '', 'g'),
        '[^a-z0-9]+', '', 'g')) >= 6
      THEN regexp_replace(
        regexp_replace(lower(coalesce(_address, '')), '\m(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|apartment|apt|unit|suite|ste)\M', '', 'g'),
        '[^a-z0-9]+', '', 'g')
      ELSE ''
    END,
    ''
  )
$$;

CREATE OR REPLACE FUNCTION public.resolve_household_at_address(
  _name text,
  _address text,
  _phone text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _status text DEFAULT 'active',
  _batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.household_address_key(_address);
  v_household public.households%ROWTYPE;
  v_reused boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'HOUSEHOLD_ADDRESS_REQUIRED' USING ERRCODE = 'P0001'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('household-address:' || v_key, 0));
  SELECT * INTO v_household FROM public.households h
  WHERE public.household_address_key(h.address) = v_key
  ORDER BY h.created_at, h.id LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    v_reused := true;
  ELSE
    INSERT INTO public.households(name, address, phone, notes, status, import_batch_id)
    VALUES (COALESCE(NULLIF(btrim(_name), ''), 'Household'), NULLIF(btrim(_address), ''),
      NULLIF(btrim(_phone), ''), NULLIF(btrim(_notes), ''), COALESCE(NULLIF(_status, ''), 'active'), _batch_id)
    RETURNING * INTO v_household;
  END IF;
  RETURN jsonb_build_object('household_id', v_household.id, 'reused', v_reused, 'name', v_household.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.mutate_household_membership(
  _person_id uuid,
  _expected_household_id uuid,
  _intent text,
  _target_household_id uuid DEFAULT NULL,
  _relationship text DEFAULT NULL,
  _new_household jsonb DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person public.people%ROWTYPE;
  v_target_id uuid;
  v_resolved jsonb;
  v_relationship text := NULLIF(btrim(_relationship), '');
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _intent NOT IN ('link', 'unlink', 'create') THEN RAISE EXCEPTION 'HOUSEHOLD_INTENT_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF v_relationship IS NOT NULL AND v_relationship NOT IN ('Spouse','Child','Parent','Sibling','Other') THEN
    RAISE EXCEPTION 'HOUSEHOLD_RELATIONSHIP_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_person FROM public.people WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That contact no longer exists'; END IF;
  IF v_person.household_id IS DISTINCT FROM _expected_household_id THEN
    RAISE EXCEPTION 'REVIEW_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
  END IF;

  IF _intent = 'unlink' THEN
    v_target_id := NULL;
    v_relationship := NULL;
  ELSIF _intent = 'link' THEN
    v_target_id := _target_household_id;
    PERFORM 1 FROM public.households WHERE id = v_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001'; END IF;
  ELSE
    IF public.household_address_key(_new_household->>'address') IS NULL THEN
      INSERT INTO public.households(name,address,phone,notes,status,import_batch_id)
      VALUES (COALESCE(NULLIF(btrim(_new_household->>'name'),''),'Household'),
        NULLIF(btrim(_new_household->>'address'),''),NULLIF(btrim(_new_household->>'phone'),''),
        NULLIF(btrim(_new_household->>'notes'),''),COALESCE(NULLIF(_new_household->>'status',''),'active'),
        NULLIF(_new_household->>'batch_id','')::uuid)
      RETURNING id INTO v_target_id;
    ELSE
      v_resolved := public.resolve_household_at_address(
        _new_household->>'name', _new_household->>'address', _new_household->>'phone',
        _new_household->>'notes', COALESCE(_new_household->>'status', 'active'),
        NULLIF(_new_household->>'batch_id', '')::uuid);
      v_target_id := (v_resolved->>'household_id')::uuid;
    END IF;
  END IF;

  UPDATE public.people SET household_id = v_target_id, household_relationship = v_relationship
  WHERE id = _person_id;
  IF NULLIF(btrim(_note), '') IS NOT NULL THEN
    INSERT INTO public.interactions(person_id, type, date, text, author)
    VALUES (_person_id, 'note', current_date, btrim(_note), 'Household correction');
  END IF;
  INSERT INTO public.audit_log(table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _person_id, 'household_membership_changed', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('from_household_id', _expected_household_id, 'to_household_id', v_target_id,
      'relationship', v_relationship, 'intent', _intent));
  RETURN jsonb_build_object('person_id', _person_id, 'household_id', v_target_id, 'relationship', v_relationship,
    'household_reused', COALESCE((v_resolved->>'reused')::boolean, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_households_transactional(_household_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF COALESCE(cardinality(_household_ids), 0) = 0 THEN RETURN 0; END IF;
  PERFORM 1 FROM public.households WHERE id = ANY(_household_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.households WHERE id = ANY(_household_ids)) <> cardinality(_household_ids) THEN
    RAISE EXCEPTION 'HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.people WHERE household_id = ANY(_household_ids) ORDER BY id FOR UPDATE;
  UPDATE public.people SET household_id = NULL, household_relationship = NULL
  WHERE household_id = ANY(_household_ids);
  DELETE FROM public.households WHERE id = ANY(_household_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_people_with_households(
  _surviving_id uuid,
  _merged_id uuid,
  _field_values jsonb DEFAULT '{}'::jsonb,
  _merge_households boolean DEFAULT false,
  _expected_surviving_household_id uuid DEFAULT NULL,
  _expected_merged_household_id uuid DEFAULT NULL
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
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different contacts to merge';
  END IF;
  PERFORM 1 FROM public.people WHERE id IN (_surviving_id, _merged_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_survivor FROM public.people WHERE id = _surviving_id AND deleted_at IS NULL;
  SELECT * INTO v_merged FROM public.people WHERE id = _merged_id AND deleted_at IS NULL;
  IF v_survivor.id IS NULL OR v_merged.id IS NULL THEN RAISE EXCEPTION 'A contact changed before merge'; END IF;
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

CREATE OR REPLACE FUNCTION public.resolve_review_household_card(_household jsonb, _members jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid := NULLIF(_household->>'id', '')::uuid;
  v_member jsonb;
  v_review public.review_queue%ROWTYPE;
  v_person public.people%ROWTYPE;
  v_person_id uuid;
  v_saved integer := 0;
  v_left integer := 0;
  v_group_key text;
  v_group_address text;
  v_address_key text;
  v_relationship text;
  v_resolved jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF jsonb_array_length(COALESCE(_members, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- Lock every review and existing person deterministically before any write.
  PERFORM 1 FROM public.review_queue q
  WHERE q.id IN (SELECT (m->>'item_id')::uuid FROM jsonb_array_elements(_members) m)
  ORDER BY q.id FOR UPDATE;
  PERFORM 1 FROM public.people p
  WHERE p.id IN (SELECT NULLIF(m->>'person_id', '')::uuid FROM jsonb_array_elements(_members) m
                 WHERE NULLIF(m->>'person_id', '') IS NOT NULL)
  ORDER BY p.id FOR UPDATE;

  FOR v_member IN SELECT value FROM jsonb_array_elements(_members) LOOP
    SELECT * INTO v_review FROM public.review_queue WHERE id = (v_member->>'item_id')::uuid;
    IF v_review.id IS NULL OR v_review.status <> 'pending' THEN
      RAISE EXCEPTION 'REVIEW_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
    END IF;
    IF v_group_key IS NULL THEN
      v_group_key := NULLIF(v_review.row_data->>'_group_key', '');
      v_group_address := NULLIF(v_review.row_data->>'_group_address', '');
      IF v_group_key IS NULL THEN RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001'; END IF;
    ELSIF v_review.row_data->>'_group_key' IS DISTINCT FROM v_group_key
       OR v_review.row_data->>'_group_address' IS DISTINCT FROM v_group_address THEN
      RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_member->>'action' NOT IN ('same','related','separate','discard','later') THEN
      RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_relationship := NULLIF(btrim(v_member->>'relationship'), '');
    IF v_relationship IS NOT NULL AND v_relationship NOT IN ('Spouse','Child','Parent','Sibling','Other') THEN
      RAISE EXCEPTION 'HOUSEHOLD_RELATIONSHIP_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_member->>'action' = 'related' AND v_relationship IS NULL THEN
      RAISE EXCEPTION 'HOUSEHOLD_RELATIONSHIP_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_member->>'action' = 'same' THEN
      v_person_id := NULLIF(v_member->>'person_id', '')::uuid;
      IF v_person_id IS NULL OR NOT (v_person_id = ANY(v_review.candidate_person_ids)) THEN
        RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
      END IF;
      SELECT * INTO v_person FROM public.people WHERE id = v_person_id AND deleted_at IS NULL;
      IF v_person.id IS NULL THEN RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001'; END IF;
      IF v_person.household_id IS DISTINCT FROM NULLIF(v_member->>'expected_household_id', '')::uuid THEN
        RAISE EXCEPTION 'REVIEW_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
      END IF;
      IF COALESCE(v_member->'person_patch'->>'__h2_contract', '') <> 'manual' THEN
        RAISE EXCEPTION 'REVIEW_INVALID_PATCH_CONTRACT' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  v_address_key := public.household_address_key(v_group_address);
  IF public.household_address_key(_household->>'address') IS DISTINCT FROM v_address_key THEN
    RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_household_id IS NOT NULL THEN
    PERFORM 1 FROM public.households WHERE id = v_household_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001'; END IF;
    IF public.household_address_key((SELECT address FROM public.households WHERE id = v_household_id)) IS DISTINCT FROM v_address_key
       AND NOT EXISTS (SELECT 1 FROM public.people p
         WHERE p.id IN (SELECT NULLIF(m->>'person_id','')::uuid FROM jsonb_array_elements(_members) m)
           AND p.household_id = v_household_id) THEN
      RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.households SET status = 'active' WHERE id = v_household_id;
  ELSIF COALESCE((_household->>'create')::boolean, false) THEN
    v_resolved := public.resolve_household_at_address(_household->>'name', v_group_address, NULL, NULL,
      'active', NULLIF(_household->>'batch_id', '')::uuid);
    v_household_id := (v_resolved->>'household_id')::uuid;
  END IF;
  IF v_household_id IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_members) m WHERE m->>'action' = 'related'
  ) THEN
    RAISE EXCEPTION 'REVIEW_HOUSEHOLD_TARGET_INVALID' USING ERRCODE = 'P0001';
  END IF;

  FOR v_member IN SELECT value FROM jsonb_array_elements(_members) LOOP
    IF v_member->>'action' = 'later' THEN
      PERFORM public.transition_review_status((v_member->>'item_id')::uuid, 'pending', 'skipped',
        'Left for later from the address card');
      v_left := v_left + 1;
    ELSIF v_member->>'action' = 'discard' THEN
      PERFORM public.log_review_decision((v_member->>'item_id')::uuid, 'discarded',
        'Discarded while reviewing this address group', NULL);
      v_saved := v_saved + 1;
    ELSIF v_member->>'action' = 'same' THEN
      v_person_id := (v_member->>'person_id')::uuid;
      PERFORM public.resolve_review_merge_core((v_member->>'item_id')::uuid, v_person_id, 'merged',
        'Same person from household review', v_member->'person_patch',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_member->'traceable_fields','[]'::jsonb))),
        COALESCE(v_member->>'source','Import household review'), NULLIF(v_member->>'batch_id','')::uuid,
        NULLIF(v_member->'event','null'::jsonb), NULLIF(v_member->'donation','null'::jsonb),
        NULLIF(v_member->'note','null'::jsonb));
      IF v_household_id IS NOT NULL THEN
        UPDATE public.people SET household_id = v_household_id,
          household_relationship = COALESCE(NULLIF(v_member->>'relationship',''), household_relationship)
        WHERE id = v_person_id;
      END IF;
      v_saved := v_saved + 1;
    ELSIF v_member->>'action' IN ('related','separate') THEN
      INSERT INTO public.people(first_name,last_name,display_name,email,phone,role,birth_date,anniversary_date,
        school,notes,met_source,household_id,household_relationship,import_batch_id)
      VALUES (v_member#>>'{person,first_name}',v_member#>>'{person,last_name}',v_member#>>'{person,display_name}',
        v_member#>>'{person,email}',v_member#>>'{person,phone}',COALESCE(v_member#>>'{person,role}','Adult'),
        NULLIF(v_member#>>'{person,birth_date}','')::date,NULLIF(v_member#>>'{person,anniversary_date}','')::date,
        v_member#>>'{person,school}',v_member#>>'{person,notes}',v_member#>>'{person,met_source}',
        CASE WHEN v_member->>'action'='related' THEN v_household_id ELSE NULL END,
        CASE WHEN v_member->>'action'='related' THEN NULLIF(v_member->>'relationship','') ELSE NULL END,
        NULLIF(v_member->>'batch_id','')::uuid) RETURNING id INTO v_person_id;
      INSERT INTO public.contact_methods(person_id,kind,value,method_type,is_primary,import_batch_id)
      SELECT v_person_id,m->>'kind',m->>'value',m->>'method_type',COALESCE((m->>'is_primary')::boolean,false),
        NULLIF(v_member->>'batch_id','')::uuid FROM jsonb_array_elements(COALESCE(v_member->'contact_methods','[]'::jsonb)) m
      WHERE NULLIF(m->>'value','') IS NOT NULL;
      PERFORM public.resolve_review_merge_core((v_member->>'item_id')::uuid,v_person_id,'created',
        COALESCE(v_member->>'reason','Created from household review'),'{}'::jsonb,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_member->'traceable_fields','[]'::jsonb))),
        COALESCE(v_member->>'source','Import household review'),NULLIF(v_member->>'batch_id','')::uuid,
        NULLIF(v_member->'event','null'::jsonb),NULLIF(v_member->'donation','null'::jsonb),NULLIF(v_member->'note','null'::jsonb));
      v_saved := v_saved + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('household_id',v_household_id,'saved',v_saved,'left',v_left);
END;
$$;

REVOKE ALL ON FUNCTION public.household_address_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.household_address_key(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_household_at_address(text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_household_at_address(text,text,text,text,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mutate_household_membership(uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_household_membership(uuid,uuid,text,uuid,text,jsonb,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_households_transactional(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_households_transactional(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_review_household_card(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_household_card(jsonb,jsonb) TO authenticated, service_role;
