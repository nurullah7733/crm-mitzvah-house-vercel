CREATE FUNCTION public.resolve_review_household_card(
  _household jsonb,
  _members jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid := NULLIF(_household->>'id', '')::uuid;
  v_member jsonb;
  v_person_id uuid;
  v_saved integer := 0;
  v_left integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required';
  END IF;

  IF v_household_id IS NOT NULL THEN
    PERFORM 1 FROM public.households WHERE id = v_household_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That household no longer exists'; END IF;
    UPDATE public.households SET status = 'active' WHERE id = v_household_id;
  ELSIF COALESCE((_household->>'create')::boolean, false) THEN
    INSERT INTO public.households (name, address, import_batch_id, status)
    VALUES (
      COALESCE(NULLIF(_household->>'name', ''), 'Household'),
      NULLIF(_household->>'address', ''),
      NULLIF(_household->>'batch_id', '')::uuid,
      'active'
    ) RETURNING id INTO v_household_id;
  END IF;

  FOR v_member IN SELECT value FROM jsonb_array_elements(COALESCE(_members, '[]'::jsonb))
  LOOP
    PERFORM 1 FROM public.review_queue
    WHERE id = (v_member->>'item_id')::uuid AND status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A review item was already resolved'; END IF;

    IF v_member->>'action' = 'later' THEN
      UPDATE public.review_queue
      SET status = 'skipped', resolution_note = 'Left for later from the address card'
      WHERE id = (v_member->>'item_id')::uuid AND status = 'pending';
      v_left := v_left + 1;

    ELSIF v_member->>'action' = 'discard' THEN
      PERFORM public.log_review_decision(
        (v_member->>'item_id')::uuid, 'discarded',
        'Discarded while reviewing this address group', NULL
      );
      v_saved := v_saved + 1;

    ELSIF v_member->>'action' = 'same' THEN
      v_person_id := (v_member->>'person_id')::uuid;
      IF v_household_id IS NOT NULL THEN
        UPDATE public.people SET
          household_id = v_household_id,
          household_relationship = CASE
            WHEN v_member ? 'relationship' THEN NULLIF(v_member->>'relationship', '')
            ELSE household_relationship
          END
        WHERE id = v_person_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'That contact no longer exists'; END IF;
      END IF;
      PERFORM public.resolve_review_merge_core(
        (v_member->>'item_id')::uuid, v_person_id, 'merged',
        'Same person from household review',
        COALESCE(v_member->'person_patch', '{}'::jsonb),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_member->'traceable_fields', '[]'::jsonb))),
        COALESCE(v_member->>'source', 'Import household review'),
        NULLIF(v_member->>'batch_id', '')::uuid,
        NULLIF(v_member->'event', 'null'::jsonb),
        NULLIF(v_member->'donation', 'null'::jsonb),
        NULLIF(v_member->'note', 'null'::jsonb)
      );
      v_saved := v_saved + 1;

    ELSIF v_member->>'action' IN ('related', 'separate') THEN
      INSERT INTO public.people (
        first_name, last_name, display_name, email, phone, role, birth_date,
        anniversary_date, school, notes, met_source, household_id,
        household_relationship, import_batch_id
      ) VALUES (
        v_member#>>'{person,first_name}', v_member#>>'{person,last_name}',
        v_member#>>'{person,display_name}', v_member#>>'{person,email}',
        v_member#>>'{person,phone}', COALESCE(v_member#>>'{person,role}', 'Adult'),
        NULLIF(v_member#>>'{person,birth_date}', '')::date,
        NULLIF(v_member#>>'{person,anniversary_date}', '')::date,
        v_member#>>'{person,school}', v_member#>>'{person,notes}',
        v_member#>>'{person,met_source}',
        CASE WHEN v_member->>'action' = 'related' THEN v_household_id ELSE NULL END,
        CASE WHEN v_member->>'action' = 'related' THEN NULLIF(v_member->>'relationship', '') ELSE NULL END,
        NULLIF(v_member->>'batch_id', '')::uuid
      ) RETURNING id INTO v_person_id;

      INSERT INTO public.contact_methods
        (person_id, kind, value, method_type, is_primary, import_batch_id)
      SELECT v_person_id, method->>'kind', method->>'value', method->>'method_type',
        COALESCE((method->>'is_primary')::boolean, false), NULLIF(v_member->>'batch_id', '')::uuid
      FROM jsonb_array_elements(COALESCE(v_member->'contact_methods', '[]'::jsonb)) method
      WHERE NULLIF(method->>'value', '') IS NOT NULL;

      PERFORM public.resolve_review_merge_core(
        (v_member->>'item_id')::uuid, v_person_id, 'created',
        COALESCE(v_member->>'reason', 'Created from household review'),
        '{}'::jsonb,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_member->'traceable_fields', '[]'::jsonb))),
        COALESCE(v_member->>'source', 'Import household review'),
        NULLIF(v_member->>'batch_id', '')::uuid,
        NULLIF(v_member->'event', 'null'::jsonb),
        NULLIF(v_member->'donation', 'null'::jsonb),
        NULLIF(v_member->'note', 'null'::jsonb)
      );
      v_saved := v_saved + 1;
    ELSE
      RAISE EXCEPTION 'Unknown household review action';
    END IF;
  END LOOP;

  RETURN jsonb_build_object('household_id', v_household_id, 'saved', v_saved, 'left', v_left);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_household_card(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_household_card(jsonb, jsonb) TO authenticated, service_role;
