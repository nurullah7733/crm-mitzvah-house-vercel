-- M2-F corrective definition: campaigns has no soft-delete column.
CREATE OR REPLACE FUNCTION public.apply_import_activity_core(
  _person_id uuid,
  _registrations jsonb DEFAULT '[]'::jsonb,
  _donation jsonb DEFAULT NULL,
  _note jsonb DEFAULT NULL,
  _batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incoming jsonb;
  v_registration public.registrations%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_created boolean;
  v_inserted_count integer;
  v_upgraded boolean;
  v_previous text;
  v_incoming_payment numeric;
  v_incoming_fee numeric;
  v_donation_id uuid;
  v_donation_created boolean := false;
  v_note_id uuid;
  v_campaign_id uuid;
  v_campaign_name text;
  v_campaign_key text;
  v_first jsonb;
BEGIN
  FOR v_incoming IN SELECT value FROM jsonb_array_elements(COALESCE(_registrations, '[]'::jsonb)) LOOP
    v_created := false;
    v_incoming_payment := NULLIF(v_incoming->>'payment_amount', '')::numeric;
    v_incoming_fee := NULLIF(v_incoming->>'fee_amount', '')::numeric;

    INSERT INTO public.registrations
      (event_id, person_id, status, import_batch_id, fee_amount, payment_amount)
    VALUES ((v_incoming->>'event_id')::uuid, _person_id, 'attended', _batch_id,
      COALESCE(v_incoming_fee, 0), v_incoming_payment)
    ON CONFLICT (event_id, person_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    v_created := v_inserted_count > 0;

    SELECT * INTO v_registration FROM public.registrations
    WHERE event_id = (v_incoming->>'event_id')::uuid AND person_id = _person_id
    FOR UPDATE;
    v_previous := v_registration.status;
    v_upgraded := NOT v_created AND COALESCE(lower(v_registration.status), '') <> 'attended';

    IF NOT v_created THEN
      IF v_incoming_payment IS NOT NULL AND v_registration.payment_amount IS NOT NULL
         AND v_incoming_payment <> v_registration.payment_amount THEN
        RAISE EXCEPTION 'Registration payment conflict: existing %, incoming %',
          v_registration.payment_amount, v_incoming_payment
          USING ERRCODE = 'P0001', HINT = 'Resolve the registration payment explicitly in review.';
      END IF;
      UPDATE public.registrations SET
        status = 'attended',
        payment_amount = CASE WHEN payment_amount IS NULL THEN v_incoming_payment ELSE payment_amount END,
        fee_amount = CASE
          WHEN payment_amount IS NULL AND v_incoming_payment IS NOT NULL THEN COALESCE(v_incoming_fee, fee_amount)
          ELSE fee_amount
        END
      WHERE id = v_registration.id;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'registration_id', v_registration.id,
      'registration_created', v_created,
      'registration_upgraded', v_upgraded,
      'registration_previous_status', v_previous,
      'event_id', (v_incoming->>'event_id')::uuid));
  END LOOP;

  IF _donation IS NOT NULL THEN
    v_campaign_name := NULLIF(btrim(_donation->>'campaign_name'), '');
    IF v_campaign_name IS NOT NULL THEN
      v_campaign_key := regexp_replace(lower(v_campaign_name), '\s+', ' ', 'g');
      PERFORM pg_advisory_xact_lock(hashtextextended('campaign:' || v_campaign_key, 0));
      SELECT id INTO v_campaign_id FROM public.campaigns
      WHERE regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_campaign_key
      ORDER BY id LIMIT 1;
      IF v_campaign_id IS NULL THEN
        INSERT INTO public.campaigns (name, status) VALUES (v_campaign_name, 'active')
        RETURNING id INTO v_campaign_id;
      END IF;
    ELSE
      v_campaign_id := NULLIF(_donation->>'campaign_id', '')::uuid;
    END IF;

    SELECT id INTO v_donation_id FROM public.donations
    WHERE deleted_at IS NULL AND (
      (NULLIF(_donation->>'import_fingerprint', '') IS NOT NULL
       AND import_fingerprint = _donation->>'import_fingerprint')
      OR (NULLIF(_donation->>'import_fingerprint', '') IS NULL
          AND person_id = _person_id AND amount = (_donation->>'amount')::numeric
          AND date = (_donation->>'date')::date
          AND campaign_id IS NOT DISTINCT FROM v_campaign_id))
    LIMIT 1;

    IF v_donation_id IS NULL THEN
      INSERT INTO public.donations
        (person_id, amount, date, campaign_id, event_id, source, notes,
         import_batch_id, import_fingerprint, external_transaction_id)
      VALUES (_person_id, (_donation->>'amount')::numeric, (_donation->>'date')::date,
        v_campaign_id, NULLIF(_donation->>'event_id', '')::uuid, _donation->>'source',
        _donation->>'notes', NULLIF(_donation->>'import_batch_id', '')::uuid,
        NULLIF(_donation->>'import_fingerprint', ''), NULLIF(_donation->>'external_transaction_id', ''))
      ON CONFLICT (import_fingerprint) WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL
      DO NOTHING RETURNING id INTO v_donation_id;
      v_donation_created := v_donation_id IS NOT NULL;
      IF v_donation_id IS NULL AND NULLIF(_donation->>'import_fingerprint', '') IS NOT NULL THEN
        SELECT id INTO v_donation_id FROM public.donations
        WHERE import_fingerprint = _donation->>'import_fingerprint' AND deleted_at IS NULL LIMIT 1;
      END IF;
      IF v_donation_id IS NULL THEN RAISE EXCEPTION 'Donation insert failed without a resolvable duplicate'; END IF;
    END IF;
  END IF;

  IF _note IS NOT NULL THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, import_batch_id)
    SELECT _person_id, 'form', (_note->>'date')::date, _note->>'text', _note->>'author', _batch_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.interactions WHERE person_id = _person_id AND type = 'form'
        AND date = (_note->>'date')::date AND text = _note->>'text' AND deleted_at IS NULL)
    RETURNING id INTO v_note_id;
  END IF;

  v_first := v_results->0;
  RETURN jsonb_build_object(
    'registrations', v_results,
    'registration_id', v_first->'registration_id',
    'registration_created', COALESCE((v_first->>'registration_created')::boolean, false),
    'registration_upgraded', COALESCE((v_first->>'registration_upgraded')::boolean, false),
    'registration_previous_status', v_first->'registration_previous_status',
    'donation_id', CASE WHEN v_donation_created THEN to_jsonb(v_donation_id) ELSE 'null'::jsonb END,
    'donation_created', v_donation_created,
    'note_id', to_jsonb(v_note_id), 'note_created', v_note_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_import_activity_core(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_import_activity_core(uuid, jsonb, jsonb, jsonb, uuid)
  TO service_role;


