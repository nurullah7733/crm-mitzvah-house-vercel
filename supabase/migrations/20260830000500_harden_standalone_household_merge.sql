-- M2-H5: stale-safe and staff-only standalone household merge.

CREATE OR REPLACE FUNCTION public.merge_households(
  _surviving_id uuid,
  _merged_id uuid,
  _field_values jsonb,
  _expected_surviving_household jsonb,
  _expected_merged_household jsonb,
  _expected_surviving_members jsonb,
  _expected_merged_members jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_surviving public.households%ROWTYPE;
  v_merged public.households%ROWTYPE;
  v_surviving_snapshot jsonb;
  v_merged_snapshot jsonb;
  v_expected_members jsonb;
  v_current_members jsonb;
  v_expected_member_ids uuid[];
  v_moved integer := 0;
  v_key text;
  v_allowed constant text[] := ARRAY[
    'name','address','address_line2','address_line3','city','state','postal_code',
    'county','billing_address','phone','notes'
  ];
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'marketing') OR
    public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required' USING ERRCODE = '42501';
  END IF;

  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different households to merge' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(COALESCE(_expected_surviving_members, 'null'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(_expected_merged_members, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'MERGE_STALE_HOUSEHOLD_MEMBERSHIP' USING ERRCODE = 'P0001';
  END IF;

  -- A consistent order prevents two opposite merge attempts from deadlocking.
  PERFORM 1 FROM public.households
  WHERE id IN (_surviving_id, _merged_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_surviving FROM public.households WHERE id = _surviving_id;
  SELECT * INTO v_merged FROM public.households WHERE id = _merged_id;
  IF NOT FOUND OR v_surviving.id IS NULL OR v_merged.id IS NULL
     OR v_surviving.status IS DISTINCT FROM 'active'
     OR v_merged.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'MERGE_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
  END IF;

  v_surviving_snapshot := jsonb_build_object(
    'id', v_surviving.id, 'status', v_surviving.status, 'name', v_surviving.name,
    'address', v_surviving.address, 'address_line2', v_surviving.address_line2,
    'address_line3', v_surviving.address_line3, 'city', v_surviving.city,
    'state', v_surviving.state, 'postal_code', v_surviving.postal_code,
    'county', v_surviving.county, 'billing_address', v_surviving.billing_address,
    'phone', v_surviving.phone, 'notes', v_surviving.notes
  );
  v_merged_snapshot := jsonb_build_object(
    'id', v_merged.id, 'status', v_merged.status, 'name', v_merged.name,
    'address', v_merged.address, 'address_line2', v_merged.address_line2,
    'address_line3', v_merged.address_line3, 'city', v_merged.city,
    'state', v_merged.state, 'postal_code', v_merged.postal_code,
    'county', v_merged.county, 'billing_address', v_merged.billing_address,
    'phone', v_merged.phone, 'notes', v_merged.notes
  );

  IF v_surviving_snapshot IS DISTINCT FROM _expected_surviving_household
     OR v_merged_snapshot IS DISTINCT FROM _expected_merged_household THEN
    RAISE EXCEPTION 'MERGE_STALE_HOUSEHOLD' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg((member->>'id')::uuid), ARRAY[]::uuid[])
  INTO v_expected_member_ids
  FROM jsonb_array_elements(_expected_surviving_members || _expected_merged_members) member;

  PERFORM 1 FROM public.people
  WHERE id = ANY(v_expected_member_ids) OR household_id IN (_surviving_id, _merged_id)
  ORDER BY id
  FOR UPDATE;

  SELECT COALESCE(jsonb_agg(member ORDER BY member->>'id'), '[]'::jsonb)
  INTO v_expected_members
  FROM (
    SELECT jsonb_build_object(
      'id', member->>'id',
      'household_id', member->>'household_id',
      'household_relationship', member->'household_relationship',
      'deleted_at', member->'deleted_at'
    ) AS member
    FROM jsonb_array_elements(_expected_surviving_members || _expected_merged_members) member
  ) expected;

  SELECT COALESCE(jsonb_agg(member ORDER BY member->>'id'), '[]'::jsonb)
  INTO v_current_members
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'household_id', p.household_id,
      'household_relationship', p.household_relationship,
      'deleted_at', p.deleted_at
    ) AS member
    FROM public.people p
    WHERE p.household_id IN (_surviving_id, _merged_id)
       OR p.id = ANY(v_expected_member_ids)
  ) current_state;

  IF v_current_members IS DISTINCT FROM v_expected_members THEN
    RAISE EXCEPTION 'MERGE_STALE_HOUSEHOLD_MEMBERSHIP' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(_field_values, '{}'::jsonb)) LOOP
    IF v_key = ANY(v_allowed) THEN
      EXECUTE format('UPDATE public.households SET %I = $1 WHERE id = $2', v_key)
      USING NULLIF(_field_values->>v_key, ''), _surviving_id;
    END IF;
  END LOOP;

  UPDATE public.people SET household_id = _surviving_id WHERE household_id = _merged_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  DELETE FROM public.households WHERE id = _merged_id;

  INSERT INTO public.audit_log(table_name, record_id, action, actor_id, actor_email, changes)
  VALUES (
    'households', _surviving_id, 'merge', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object(
      'merged_household', to_jsonb(v_merged),
      'surviving_before', to_jsonb(v_surviving),
      'members_moved', v_moved
    )
  );

  RETURN _surviving_id;
END;
$$;

-- The historical three-argument function remains callable by owner-executed H3
-- functions, but is no longer a client API.
REVOKE ALL ON FUNCTION public.merge_households(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_households(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_households(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated, service_role;
