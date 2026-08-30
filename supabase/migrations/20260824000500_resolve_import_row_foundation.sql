-- First normal-import row transaction boundary. Identity and household
-- matching are deliberately absent: every action and target ID is resolved by
-- the client before this function is called.
CREATE FUNCTION public.resolve_import_row(
  _person jsonb,
  _household jsonb DEFAULT '{"action":"none"}'::jsonb,
  _contact_methods jsonb DEFAULT '[]'::jsonb,
  _labels jsonb DEFAULT '{}'::jsonb,
  _provenance jsonb DEFAULT '[]'::jsonb,
  _batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_action text := _person->>'action';
  v_household_action text := COALESCE(_household->>'action', 'none');
  v_person_values jsonb := COALESCE(_person->'values', '{}'::jsonb);
  v_household_values jsonb := COALESCE(_household->'values', '{}'::jsonb);
  v_person public.people%ROWTYPE;
  v_person_id uuid;
  v_household_id uuid;
  v_method jsonb;
  v_method_value text;
  v_method_key text;
  v_is_primary boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required';
  END IF;

  IF v_person_action NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Unknown person import action';
  END IF;
  IF v_household_action NOT IN ('none', 'use', 'create', 'update') THEN
    RAISE EXCEPTION 'Unknown household import action';
  END IF;

  -- An update target is client-resolved. Lock and validate it before making
  -- any household or contact write for this row.
  IF v_person_action = 'update' THEN
    v_person_id := NULLIF(_person->>'id', '')::uuid;
    SELECT * INTO v_person
    FROM public.people
    WHERE id = v_person_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That imported contact no longer exists';
    END IF;
    v_household_id := v_person.household_id;
  END IF;

  IF v_household_action IN ('use', 'update') THEN
    v_household_id := NULLIF(_household->>'id', '')::uuid;
    PERFORM 1 FROM public.households WHERE id = v_household_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That imported household no longer exists';
    END IF;

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
    INSERT INTO public.households (
      name, address, address_line2, city, state, postal_code, status, import_batch_id
    ) VALUES (
      v_household_values->>'name',
      v_household_values->>'address',
      v_household_values->>'address_line2',
      v_household_values->>'city',
      v_household_values->>'state',
      v_household_values->>'postal_code',
      COALESCE(v_household_values->>'status', 'active'),
      _batch_id
    )
    RETURNING id INTO v_household_id;
  END IF;

  IF v_person_action = 'create' THEN
    INSERT INTO public.people (
      first_name, last_name, display_name, email, phone, birth_date,
      anniversary_date, met_source, school, notes, household_id,
      household_relationship, role, tags, programs, import_batch_id
    ) VALUES (
      v_person_values->>'first_name',
      v_person_values->>'last_name',
      v_person_values->>'display_name',
      v_person_values->>'email',
      v_person_values->>'phone',
      NULLIF(v_person_values->>'birth_date', '')::date,
      NULLIF(v_person_values->>'anniversary_date', '')::date,
      v_person_values->>'met_source',
      v_person_values->>'school',
      v_person_values->>'notes',
      v_household_id,
      v_person_values->>'household_relationship',
      COALESCE(v_person_values->>'role', 'Adult'),
      CASE WHEN v_person_values ? 'tags'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_person_values->'tags'))
        ELSE '{}'::text[] END,
      CASE WHEN v_person_values ? 'programs'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_person_values->'programs'))
        ELSE '{}'::text[] END,
      _batch_id
    )
    RETURNING id INTO v_person_id;
  ELSE
    -- Only keys supplied in the already-resolved patch are applied.
    UPDATE public.people SET
      first_name = CASE WHEN v_person_values ? 'first_name' THEN v_person_values->>'first_name' ELSE first_name END,
      last_name = CASE WHEN v_person_values ? 'last_name' THEN v_person_values->>'last_name' ELSE last_name END,
      display_name = CASE WHEN v_person_values ? 'display_name' THEN v_person_values->>'display_name' ELSE display_name END,
      email = CASE WHEN v_person_values ? 'email' THEN v_person_values->>'email' ELSE email END,
      phone = CASE WHEN v_person_values ? 'phone' THEN v_person_values->>'phone' ELSE phone END,
      birth_date = CASE WHEN v_person_values ? 'birth_date' THEN NULLIF(v_person_values->>'birth_date', '')::date ELSE birth_date END,
      anniversary_date = CASE WHEN v_person_values ? 'anniversary_date' THEN NULLIF(v_person_values->>'anniversary_date', '')::date ELSE anniversary_date END,
      met_source = CASE WHEN v_person_values ? 'met_source' THEN v_person_values->>'met_source' ELSE met_source END,
      school = CASE WHEN v_person_values ? 'school' THEN v_person_values->>'school' ELSE school END,
      notes = CASE WHEN v_person_values ? 'notes' THEN v_person_values->>'notes' ELSE notes END,
      role = CASE WHEN v_person_values ? 'role' THEN v_person_values->>'role' ELSE role END,
      household_id = CASE WHEN v_household_action <> 'none' THEN v_household_id ELSE household_id END,
      household_relationship = CASE
        WHEN v_person_values ? 'household_relationship'
          THEN v_person_values->>'household_relationship'
        ELSE household_relationship
      END
    WHERE id = v_person_id;
  END IF;

  -- Resolved bulk labels append without replacing stored labels. This mirrors
  -- normalizeLabel: trim, lowercase, and collapse whitespace for comparison.
  UPDATE public.people p SET
    tags = p.tags || ARRAY(
      SELECT incoming.label
      FROM jsonb_array_elements_text(COALESCE(_labels->'tags', '[]'::jsonb)) AS incoming(label)
      WHERE NULLIF(btrim(incoming.label), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM unnest(p.tags) current_label
          WHERE regexp_replace(lower(btrim(current_label)), '\s+', ' ', 'g') =
                regexp_replace(lower(btrim(incoming.label)), '\s+', ' ', 'g')
        )
    ),
    programs = p.programs || ARRAY(
      SELECT incoming.label
      FROM jsonb_array_elements_text(COALESCE(_labels->'programs', '[]'::jsonb)) AS incoming(label)
      WHERE NULLIF(btrim(incoming.label), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM unnest(p.programs) current_label
          WHERE regexp_replace(lower(btrim(current_label)), '\s+', ' ', 'g') =
                regexp_replace(lower(btrim(incoming.label)), '\s+', ' ', 'g')
        )
    )
  WHERE p.id = v_person_id;

  -- Insert sequentially so earlier methods in this payload participate in the
  -- same normalized duplicate check as methods already stored on the person.
  FOR v_method IN
    SELECT value FROM jsonb_array_elements(COALESCE(_contact_methods, '[]'::jsonb))
  LOOP
    v_method_value := CASE
      WHEN v_method->>'kind' = 'email' THEN lower(btrim(v_method->>'value'))
      ELSE btrim(v_method->>'value')
    END;
    IF NULLIF(v_method_value, '') IS NULL THEN CONTINUE; END IF;

    v_method_key := CASE
      WHEN v_method->>'kind' = 'email' THEN v_method_value
      WHEN length(regexp_replace(v_method_value, '\D', '', 'g')) >= 7
        THEN right(regexp_replace(v_method_value, '\D', '', 'g'), 10)
      ELSE NULL
    END;

    IF v_method_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.contact_methods cm
      WHERE cm.person_id = v_person_id
        AND cm.kind = v_method->>'kind'
        AND CASE
          WHEN cm.kind = 'email' THEN lower(btrim(cm.value))
          ELSE right(regexp_replace(cm.value, '\D', '', 'g'), 10)
        END = v_method_key
    ) THEN
      CONTINUE;
    END IF;

    v_is_primary := COALESCE((v_method->>'is_primary')::boolean, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.contact_methods cm
        WHERE cm.person_id = v_person_id
          AND cm.kind = v_method->>'kind'
          AND cm.is_primary
      );

    INSERT INTO public.contact_methods (
      person_id, kind, value, method_type, is_primary, import_batch_id
    ) VALUES (
      v_person_id,
      v_method->>'kind',
      v_method_value,
      COALESCE(NULLIF(v_method->>'method_type', ''),
        CASE WHEN v_method->>'kind' = 'phone' THEN 'Mobile' ELSE 'Personal' END),
      v_is_primary,
      _batch_id
    );
  END LOOP;

  -- Import provenance has historically been non-blocking metadata. Keep that
  -- behavior isolated; failures here do not hide failures in required writes.
  IF jsonb_array_length(COALESCE(_provenance, '[]'::jsonb)) > 0 THEN
    BEGIN
      INSERT INTO public.field_sources (
        person_id, field_name, source, recorded_date, import_batch_id
      )
      SELECT
        v_person_id,
        entry->>'field_name',
        entry->>'source',
        COALESCE(NULLIF(entry->>'recorded_date', '')::date, current_date),
        _batch_id
      FROM jsonb_array_elements(_provenance) entry;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'person_id', v_person_id,
    'household_id', v_household_id,
    'person_created', v_person_action = 'create',
    'household_created', v_household_action = 'create'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_import_row(jsonb, jsonb, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_import_row(jsonb, jsonb, jsonb, jsonb, jsonb, uuid)
  TO authenticated, service_role;
