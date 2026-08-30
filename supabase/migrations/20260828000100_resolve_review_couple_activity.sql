-- Resolve a couple activity review in one transaction. The existing import RPC
-- remains the owner of person, household, contact, and activity primitives.
CREATE FUNCTION public.resolve_review_couple_activity(
  _item_id uuid,
  _owner text,
  _main jsonb,
  _partner jsonb,
  _row jsonb,
  _activity jsonb DEFAULT '{}'::jsonb,
  _labels jsonb DEFAULT '{}'::jsonb,
  _batch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_main jsonb;
  v_partner jsonb;
  v_household jsonb := '{"action":"none"}'::jsonb;
  v_household_id uuid;
  v_main_id uuid;
  v_partner_id uuid;
  v_result jsonb;
  v_address text := NULLIF(btrim(_row->>'address'), '');
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _owner NOT IN ('main', 'partner') THEN RAISE EXCEPTION 'An explicit activity owner is required'; END IF;
  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN RAISE EXCEPTION 'That review item was already resolved'; END IF;
  IF COALESCE(v_review.row_data->'review_context'->>'kind', '') <> 'couple_activity_owner'
    THEN RAISE EXCEPTION 'This review item is not a couple activity review'; END IF;

  v_main_id := NULLIF(_main->>'resolved_person_id', '')::uuid;
  v_partner_id := NULLIF(_partner->>'resolved_person_id', '')::uuid;
  IF v_main_id IS DISTINCT FROM NULLIF(v_review.row_data->'review_context'->'main_claim'->>'resolved_person_id', '')::uuid
    OR v_partner_id IS DISTINCT FROM NULLIF(v_review.row_data->'review_context'->'partner_claim'->>'resolved_person_id', '')::uuid
    THEN RAISE EXCEPTION 'Couple identity context changed; review this row again'; END IF;
  IF _main->>'first_name' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'first_name'
    OR _main->>'last_name' IS DISTINCT FROM v_review.row_data->'review_context'->'main_claim'->>'last_name'
    OR _partner->>'first_name' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'first_name'
    OR _partner->>'last_name' IS DISTINCT FROM v_review.row_data->'review_context'->'partner_claim'->>'last_name'
    THEN RAISE EXCEPTION 'Couple claim context changed; review this row again'; END IF;
  v_main := jsonb_build_object(
    'action', CASE WHEN v_main_id IS NULL THEN 'create' ELSE 'update' END,
    'id', v_main_id,
    'values', jsonb_build_object('first_name', _main->>'first_name', 'last_name', _main->>'last_name',
      'display_name', concat_ws(' ', _main->>'first_name', _main->>'last_name'), 'email', _main->>'email', 'phone', _main->>'phone', 'role', 'Adult')
  );
  v_partner := jsonb_build_object(
    'action', CASE WHEN v_partner_id IS NULL THEN 'create' ELSE 'update' END,
    'id', v_partner_id,
    'values', jsonb_build_object('first_name', _partner->>'first_name', 'last_name', _partner->>'last_name',
      'display_name', concat_ws(' ', _partner->>'first_name', _partner->>'last_name'), 'email', _partner->>'email', 'phone', _partner->>'phone', 'role', 'Adult')
  );

  IF v_main_id IS NOT NULL THEN SELECT household_id INTO v_household_id FROM public.people WHERE id = v_main_id AND deleted_at IS NULL FOR UPDATE; END IF;
  IF v_partner_id IS NOT NULL THEN
    IF v_household_id IS NULL THEN SELECT household_id INTO v_household_id FROM public.people WHERE id = v_partner_id AND deleted_at IS NULL FOR UPDATE;
    ELSIF v_household_id IS DISTINCT FROM (SELECT household_id FROM public.people WHERE id = v_partner_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Both people already belong to different households';
    END IF;
  END IF;
  IF v_household_id IS NULL THEN
    IF v_address IS NOT NULL THEN
      SELECT id INTO v_household_id FROM public.households
      WHERE regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_address), '[^a-z0-9]', '', 'g')
      ORDER BY id LIMIT 1 FOR UPDATE;
    END IF;
    IF v_household_id IS NULL THEN
      INSERT INTO public.households (name, address, status, import_batch_id)
      VALUES (concat_ws(' ', _main->>'last_name', 'household'), v_address, 'active', _batch_id)
      RETURNING id INTO v_household_id;
    END IF;
  END IF;
  v_household := jsonb_build_object('action', 'use', 'id', v_household_id);

  v_result := public.resolve_import_row(
    v_main, v_household, '[]'::jsonb,
    CASE WHEN _owner = 'main' THEN _labels ELSE '{}'::jsonb END,
    '[]'::jsonb, _batch_id,
    jsonb_build_object(
      'action', CASE WHEN v_partner_id IS NULL THEN 'create' ELSE 'update' END,
      'id', v_partner_id,
      'values', v_partner->'values',
      'contact_methods', jsonb_build_array(),
      'household_relationship', 'Spouse'
    ), '[]'::jsonb,
    CASE WHEN _owner = 'main' THEN _activity ELSE '{}'::jsonb END
  );
  IF _owner = 'partner' THEN
    PERFORM public.apply_import_activity_core((v_result->>'spouse_id')::uuid,
      COALESCE(_activity->'registrations', '[]'::jsonb),
      NULLIF(_activity->'donation', 'null'::jsonb), NULLIF(_activity->'note', 'null'::jsonb), _batch_id);
    UPDATE public.people p SET
      tags = p.tags || COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(_labels->'tags', '[]'::jsonb))), '{}'::text[]),
      programs = p.programs || COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(_labels->'programs', '[]'::jsonb))), '{}'::text[])
    WHERE p.id = (v_result->>'spouse_id')::uuid;
  END IF;
  PERFORM public.log_review_decision(_item_id, 'created', 'Couple activity assigned to ' || _owner, CASE WHEN _owner = 'main' THEN (v_result->>'person_id')::uuid ELSE (v_result->>'spouse_id')::uuid END);
  RETURN v_result || jsonb_build_object('activity_owner', _owner);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_couple_activity(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_couple_activity(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) TO authenticated, service_role;
