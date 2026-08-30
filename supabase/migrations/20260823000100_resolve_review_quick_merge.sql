CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge(
  _item_id uuid,
  _person_id uuid,
  _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[],
  _source text DEFAULT 'Import quick update',
  _batch_id uuid DEFAULT NULL,
  _event jsonb DEFAULT NULL,
  _donation jsonb DEFAULT NULL,
  _note jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_registration public.registrations%ROWTYPE;
  v_registration_id uuid;
  v_registration_created boolean := false;
  v_registration_upgraded boolean := false;
  v_previous_status text;
  v_donation_id uuid;
  v_donation_created boolean := false;
  v_note_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required';
  END IF;

  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN RAISE EXCEPTION 'That review item was already resolved'; END IF;
  PERFORM 1 FROM public.people WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That contact no longer exists'; END IF;

  UPDATE public.people SET
    display_name = CASE WHEN _person_patch ? 'display_name' THEN _person_patch->>'display_name' ELSE display_name END,
    first_name = CASE WHEN _person_patch ? 'first_name' THEN _person_patch->>'first_name' ELSE first_name END,
    last_name = CASE WHEN _person_patch ? 'last_name' THEN _person_patch->>'last_name' ELSE last_name END,
    email = CASE WHEN _person_patch ? 'email' THEN _person_patch->>'email' ELSE email END,
    phone = CASE WHEN _person_patch ? 'phone' THEN _person_patch->>'phone' ELSE phone END,
    role = CASE WHEN _person_patch ? 'role' THEN _person_patch->>'role' ELSE role END,
    birth_date = CASE WHEN _person_patch ? 'birth_date' THEN (_person_patch->>'birth_date')::date ELSE birth_date END,
    anniversary_date = CASE WHEN _person_patch ? 'anniversary_date' THEN (_person_patch->>'anniversary_date')::date ELSE anniversary_date END,
    school = CASE WHEN _person_patch ? 'school' THEN _person_patch->>'school' ELSE school END,
    notes = CASE WHEN _person_patch ? 'notes' THEN _person_patch->>'notes' ELSE notes END,
    met_source = CASE WHEN _person_patch ? 'met_source' THEN _person_patch->>'met_source' ELSE met_source END
  WHERE id = _person_id;

  -- Provenance has always been best-effort. A provenance failure must not undo required CRM data.
  IF cardinality(_traceable_fields) > 0 THEN
    BEGIN
      INSERT INTO public.field_sources (person_id, field_name, source, recorded_date, import_batch_id)
      SELECT _person_id, field_name, _source, current_date, _batch_id
      FROM unnest(_traceable_fields) AS field_name;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF _event IS NOT NULL THEN
    SELECT * INTO v_registration
    FROM public.registrations
    WHERE event_id = (_event->>'event_id')::uuid AND person_id = _person_id
    FOR UPDATE;
    IF FOUND THEN
      v_registration_id := v_registration.id;
      v_previous_status := v_registration.status;
      v_registration_upgraded := COALESCE(lower(v_registration.status), '') <> 'attended';
      UPDATE public.registrations SET
        status = 'attended',
        fee_amount = COALESCE((_event->>'fee_amount')::numeric, fee_amount),
        payment_amount = CASE WHEN _event ? 'payment_amount' THEN (_event->>'payment_amount')::numeric ELSE payment_amount END
      WHERE id = v_registration.id;
    ELSE
      INSERT INTO public.registrations
        (event_id, person_id, status, import_batch_id, fee_amount, payment_amount)
      VALUES
        ((_event->>'event_id')::uuid, _person_id, 'attended', _batch_id,
         COALESCE((_event->>'fee_amount')::numeric, 0), (_event->>'payment_amount')::numeric)
      RETURNING id INTO v_registration_id;
      v_registration_created := true;
    END IF;
  END IF;

  IF _donation IS NOT NULL THEN
    SELECT id INTO v_donation_id FROM public.donations
    WHERE deleted_at IS NULL AND (
      (NULLIF(_donation->>'import_fingerprint', '') IS NOT NULL
       AND import_fingerprint = _donation->>'import_fingerprint')
      OR (person_id = _person_id
          AND amount = (_donation->>'amount')::numeric
          AND date = (_donation->>'date')::date
          AND campaign_id IS NOT DISTINCT FROM NULLIF(_donation->>'campaign_id', '')::uuid)
    ) LIMIT 1;
    IF v_donation_id IS NULL THEN
      INSERT INTO public.donations
        (person_id, amount, date, campaign_id, source, notes, import_batch_id, import_fingerprint)
      VALUES
        (_person_id, (_donation->>'amount')::numeric, (_donation->>'date')::date,
         NULLIF(_donation->>'campaign_id', '')::uuid, _donation->>'source', _donation->>'notes',
         NULLIF(_donation->>'import_batch_id', '')::uuid, NULLIF(_donation->>'import_fingerprint', ''))
      ON CONFLICT (import_fingerprint)
        WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL
        DO NOTHING
      RETURNING id INTO v_donation_id;
      v_donation_created := v_donation_id IS NOT NULL;
      IF v_donation_id IS NULL AND NULLIF(_donation->>'import_fingerprint', '') IS NOT NULL THEN
        SELECT id INTO v_donation_id FROM public.donations
        WHERE import_fingerprint = _donation->>'import_fingerprint' AND deleted_at IS NULL
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF _note IS NOT NULL THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, import_batch_id)
    VALUES (_person_id, 'form', (_note->>'date')::date, _note->>'text', _note->>'author', _batch_id)
    RETURNING id INTO v_note_id;
  END IF;

  PERFORM public.log_review_decision(
    _item_id,
    'merged',
    'Same person — contact updated in one tap, no conflicting fields',
    _person_id
  );

  RETURN jsonb_build_object(
    'registration_id', v_registration_id,
    'registration_created', v_registration_created,
    'registration_upgraded', v_registration_upgraded,
    'registration_previous_status', v_previous_status,
    'event_name', CASE WHEN _event IS NULL THEN NULL ELSE (SELECT name FROM public.events WHERE id = (_event->>'event_id')::uuid) END,
    'donation_id', CASE WHEN v_donation_created THEN v_donation_id ELSE NULL END,
    'donation_created', v_donation_created,
    'note_id', v_note_id,
    'note_created', v_note_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_quick_merge(uuid, uuid, jsonb, text[], text, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_quick_merge(uuid, uuid, jsonb, text[], text, uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
