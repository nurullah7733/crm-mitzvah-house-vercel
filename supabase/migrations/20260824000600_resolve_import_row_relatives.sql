-- Shared person mutation for the already-resolved main person and relatives.
CREATE FUNCTION public.apply_import_person_core(
  _intent jsonb,
  _household_id uuid,
  _link_household boolean,
  _batch_id uuid,
  _default_role text,
  _default_relationship text,
  _entity text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text := COALESCE(_intent->>'action', 'skip');
  v_values jsonb := COALESCE(_intent->'values', '{}'::jsonb);
  v_person public.people%ROWTYPE;
  v_person_id uuid;
BEGIN
  IF v_action = 'skip' THEN RETURN NULL; END IF;
  IF v_action NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Unknown imported person action';
  END IF;

  IF v_action = 'update' THEN
    v_person_id := NULLIF(_intent->>'id', '')::uuid;
    SELECT * INTO v_person
    FROM public.people
    WHERE id = v_person_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      IF _entity = 'contact' THEN
        RAISE EXCEPTION 'That imported contact no longer exists';
      ELSIF _entity = 'spouse' THEN
        RAISE EXCEPTION 'That selected spouse no longer exists';
      ELSE
        RAISE EXCEPTION 'That selected child no longer exists';
      END IF;
    END IF;

    UPDATE public.people SET
      first_name = CASE WHEN v_values ? 'first_name' THEN v_values->>'first_name' ELSE first_name END,
      last_name = CASE WHEN v_values ? 'last_name' THEN v_values->>'last_name' ELSE last_name END,
      display_name = CASE WHEN v_values ? 'display_name' THEN v_values->>'display_name' ELSE display_name END,
      email = CASE WHEN v_values ? 'email' THEN v_values->>'email' ELSE email END,
      phone = CASE WHEN v_values ? 'phone' THEN v_values->>'phone' ELSE phone END,
      birth_date = CASE WHEN v_values ? 'birth_date' THEN NULLIF(v_values->>'birth_date', '')::date ELSE birth_date END,
      anniversary_date = CASE WHEN v_values ? 'anniversary_date' THEN NULLIF(v_values->>'anniversary_date', '')::date ELSE anniversary_date END,
      met_source = CASE WHEN v_values ? 'met_source' THEN v_values->>'met_source' ELSE met_source END,
      school = CASE WHEN v_values ? 'school' THEN v_values->>'school' ELSE school END,
      notes = CASE WHEN v_values ? 'notes' THEN v_values->>'notes' ELSE notes END,
      role = CASE WHEN v_values ? 'role' THEN v_values->>'role' ELSE role END,
      tags = CASE WHEN v_values ? 'tags'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_values->'tags')) ELSE tags END,
      programs = CASE WHEN v_values ? 'programs'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_values->'programs')) ELSE programs END,
      household_id = CASE WHEN _link_household THEN _household_id ELSE household_id END,
      household_relationship = CASE
        WHEN v_values ? 'household_relationship' THEN v_values->>'household_relationship'
        WHEN _link_household AND _default_relationship IS NOT NULL THEN _default_relationship
        ELSE household_relationship
      END
    WHERE id = v_person_id;
  ELSE
    INSERT INTO public.people (
      first_name, last_name, display_name, email, phone, birth_date,
      anniversary_date, met_source, school, notes, household_id,
      household_relationship, role, tags, programs, import_batch_id
    ) VALUES (
      v_values->>'first_name', v_values->>'last_name', v_values->>'display_name',
      v_values->>'email', v_values->>'phone', NULLIF(v_values->>'birth_date', '')::date,
      NULLIF(v_values->>'anniversary_date', '')::date, v_values->>'met_source',
      v_values->>'school', v_values->>'notes',
      CASE WHEN _link_household THEN _household_id ELSE NULL END,
      COALESCE(v_values->>'household_relationship', _default_relationship),
      COALESCE(v_values->>'role', _default_role),
      CASE WHEN v_values ? 'tags'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_values->'tags')) ELSE '{}'::text[] END,
      CASE WHEN v_values ? 'programs'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_values->'programs')) ELSE '{}'::text[] END,
      _batch_id
    )
    RETURNING id INTO v_person_id;
  END IF;

  RETURN v_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_import_person_core(
  jsonb, uuid, boolean, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_import_person_core(
  jsonb, uuid, boolean, uuid, text, text, text
) TO service_role;

-- Shared normalized contact-method insertion. Children do not call this helper
-- because the current normal importer does not import child contact methods.
CREATE FUNCTION public.apply_import_contact_methods_core(
  _person_id uuid,
  _methods jsonb,
  _batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method jsonb;
  v_value text;
  v_key text;
  v_is_primary boolean;
BEGIN
  FOR v_method IN SELECT value FROM jsonb_array_elements(COALESCE(_methods, '[]'::jsonb))
  LOOP
    v_value := CASE WHEN v_method->>'kind' = 'email'
      THEN lower(btrim(v_method->>'value')) ELSE btrim(v_method->>'value') END;
    IF NULLIF(v_value, '') IS NULL THEN CONTINUE; END IF;
    v_key := CASE
      WHEN v_method->>'kind' = 'email' THEN v_value
      WHEN length(regexp_replace(v_value, '\D', '', 'g')) >= 7
        THEN right(regexp_replace(v_value, '\D', '', 'g'), 10)
      ELSE NULL
    END;
    IF v_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.contact_methods cm
      WHERE cm.person_id = _person_id AND cm.kind = v_method->>'kind'
        AND CASE WHEN cm.kind = 'email' THEN lower(btrim(cm.value))
          ELSE right(regexp_replace(cm.value, '\D', '', 'g'), 10) END = v_key
    ) THEN CONTINUE; END IF;
    v_is_primary := COALESCE((v_method->>'is_primary')::boolean, false)
      OR NOT EXISTS (SELECT 1 FROM public.contact_methods cm
        WHERE cm.person_id = _person_id AND cm.kind = v_method->>'kind' AND cm.is_primary);
    INSERT INTO public.contact_methods
      (person_id, kind, value, method_type, is_primary, import_batch_id)
    VALUES (
      _person_id, v_method->>'kind', v_value,
      COALESCE(NULLIF(v_method->>'method_type', ''),
        CASE WHEN v_method->>'kind' = 'phone' THEN 'Mobile' ELSE 'Personal' END),
      v_is_primary, _batch_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_import_contact_methods_core(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_import_contact_methods_core(uuid, jsonb, uuid)
  TO service_role;

DROP FUNCTION public.resolve_import_row(jsonb, jsonb, jsonb, jsonb, jsonb, uuid);

CREATE FUNCTION public.resolve_import_row(
  _person jsonb,
  _household jsonb DEFAULT '{"action":"none"}'::jsonb,
  _contact_methods jsonb DEFAULT '[]'::jsonb,
  _labels jsonb DEFAULT '{}'::jsonb,
  _provenance jsonb DEFAULT '[]'::jsonb,
  _batch_id uuid DEFAULT NULL,
  _spouse jsonb DEFAULT '{"action":"skip"}'::jsonb,
  _children jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_action text := COALESCE(_household->>'action', 'none');
  v_household_values jsonb := COALESCE(_household->'values', '{}'::jsonb);
  v_person_id uuid;
  v_household_id uuid;
  v_spouse_id uuid;
  v_child jsonb;
  v_child_id uuid;
  v_child_ids jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF COALESCE(_person->>'action', '') NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Unknown person import action';
  END IF;
  IF v_household_action NOT IN ('none', 'use', 'create', 'update') THEN
    RAISE EXCEPTION 'Unknown household import action';
  END IF;

  -- Lock the main update target before any row write.
  IF _person->>'action' = 'update' THEN
    v_person_id := public.apply_import_person_core(
      _person, NULL, false, _batch_id, 'Adult', NULL, 'contact'
    );
    SELECT household_id INTO v_household_id FROM public.people WHERE id = v_person_id;
  END IF;

  IF v_household_action IN ('use', 'update') THEN
    v_household_id := NULLIF(_household->>'id', '')::uuid;
    PERFORM 1 FROM public.households WHERE id = v_household_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That imported household no longer exists'; END IF;
    IF v_household_action = 'update' THEN
      UPDATE public.households SET
        name = CASE WHEN v_household_values ? 'name' THEN v_household_values->>'name' ELSE name END,
        address = CASE WHEN v_household_values ? 'address' THEN v_household_values->>'address' ELSE address END,
        address_line2 = CASE WHEN v_household_values ? 'address_line2' THEN v_household_values->>'address_line2' ELSE address_line2 END,
        city = CASE WHEN v_household_values ? 'city' THEN v_household_values->>'city' ELSE city END,
        state = CASE WHEN v_household_values ? 'state' THEN v_household_values->>'state' ELSE state END,
        postal_code = CASE WHEN v_household_values ? 'postal_code' THEN v_household_values->>'postal_code' ELSE postal_code END,
        status = CASE WHEN v_household_values ? 'status' THEN v_household_values->>'status' ELSE status END
      WHERE id = v_household_id;
    END IF;
  ELSIF v_household_action = 'create' THEN
    INSERT INTO public.households
      (name, address, address_line2, city, state, postal_code, status, import_batch_id)
    VALUES (
      v_household_values->>'name', v_household_values->>'address',
      v_household_values->>'address_line2', v_household_values->>'city',
      v_household_values->>'state', v_household_values->>'postal_code',
      COALESCE(v_household_values->>'status', 'active'), _batch_id
    ) RETURNING id INTO v_household_id;
  END IF;

  IF _person->>'action' = 'create' THEN
    v_person_id := public.apply_import_person_core(
      _person, v_household_id, v_household_action <> 'none', _batch_id,
      'Adult', NULL, 'contact'
    );
  ELSIF v_household_action <> 'none' THEN
    UPDATE public.people SET household_id = v_household_id WHERE id = v_person_id;
  END IF;

  -- Main labels append without replacing stored values.
  UPDATE public.people p SET
    tags = p.tags || ARRAY(SELECT incoming.label
      FROM jsonb_array_elements_text(COALESCE(_labels->'tags', '[]'::jsonb)) AS incoming(label)
      WHERE NULLIF(btrim(incoming.label), '') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(p.tags) current_label WHERE
          regexp_replace(lower(btrim(current_label)), '\s+', ' ', 'g') =
          regexp_replace(lower(btrim(incoming.label)), '\s+', ' ', 'g'))),
    programs = p.programs || ARRAY(SELECT incoming.label
      FROM jsonb_array_elements_text(COALESCE(_labels->'programs', '[]'::jsonb)) AS incoming(label)
      WHERE NULLIF(btrim(incoming.label), '') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(p.programs) current_label WHERE
          regexp_replace(lower(btrim(current_label)), '\s+', ' ', 'g') =
          regexp_replace(lower(btrim(incoming.label)), '\s+', ' ', 'g')))
  WHERE p.id = v_person_id;
  PERFORM public.apply_import_contact_methods_core(v_person_id, _contact_methods, _batch_id);

  IF COALESCE(_spouse->>'action', 'skip') <> 'skip'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(_children, '[]'::jsonb)) child
       WHERE COALESCE(child->>'action', 'skip') <> 'skip'
     ) THEN
    IF v_household_id IS NULL THEN
      RAISE EXCEPTION 'Imported relatives require a resolved household';
    END IF;
  END IF;

  v_spouse_id := public.apply_import_person_core(
    _spouse, v_household_id, true, _batch_id, 'Adult', 'Spouse', 'spouse'
  );
  IF v_spouse_id IS NOT NULL THEN
    PERFORM public.apply_import_contact_methods_core(
      v_spouse_id, COALESCE(_spouse->'contact_methods', '[]'::jsonb), _batch_id
    );
  END IF;

  FOR v_child IN SELECT value FROM jsonb_array_elements(COALESCE(_children, '[]'::jsonb))
  LOOP
    IF COALESCE(v_child->>'action', 'skip') = 'skip' THEN CONTINUE; END IF;
    v_child_id := public.apply_import_person_core(
      v_child, v_household_id, true, _batch_id, 'Child', 'Child', 'child'
    );
    v_child_ids := v_child_ids || jsonb_build_array(v_child_id);
  END LOOP;

  -- Provenance remains the sole intentionally best-effort row write.
  IF jsonb_array_length(COALESCE(_provenance, '[]'::jsonb)) > 0 THEN
    BEGIN
      INSERT INTO public.field_sources
        (person_id, field_name, source, recorded_date, import_batch_id)
      SELECT v_person_id, entry->>'field_name', entry->>'source',
        COALESCE(NULLIF(entry->>'recorded_date', '')::date, current_date), _batch_id
      FROM jsonb_array_elements(_provenance) entry;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'person_id', v_person_id, 'household_id', v_household_id,
    'spouse_id', v_spouse_id, 'child_ids', v_child_ids,
    'person_created', _person->>'action' = 'create',
    'household_created', v_household_action = 'create'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_import_row(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_import_row(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb
) TO authenticated, service_role;
