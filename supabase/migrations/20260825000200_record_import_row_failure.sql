-- Failure logging is intentionally a separate statement from resolve_import_row:
-- a record written inside the failed CRM transaction would be rolled back too.
CREATE FUNCTION public.record_import_row_failure(
  _batch_id uuid,
  _row_number integer,
  _row_data jsonb,
  _message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outcome_id uuid;
  v_existing_outcome text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required';
  END IF;

  IF _row_number IS NULL OR _row_number <= 0 THEN
    RAISE EXCEPTION 'Import row number must be positive';
  END IF;

  PERFORM 1 FROM public.import_batches WHERE id = _batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That import batch no longer exists';
  END IF;

  INSERT INTO public.import_row_outcomes (
    batch_id,
    row_number,
    row_data,
    outcome,
    person_id,
    review_queue_id,
    message
  ) VALUES (
    _batch_id,
    _row_number,
    COALESCE(_row_data, '{}'::jsonb),
    'failed',
    NULL,
    NULL,
    COALESCE(NULLIF(btrim(_message), ''), 'Import row failed')
  )
  ON CONFLICT (batch_id, row_number) DO UPDATE SET
    row_data = EXCLUDED.row_data,
    outcome = 'failed',
    person_id = NULL,
    review_queue_id = NULL,
    message = EXCLUDED.message
  -- Retrying failure logging is safe, but never replace a successful or
  -- reviewer-routed final outcome with a failure.
  WHERE public.import_row_outcomes.outcome IN ('processing', 'failed')
  RETURNING id INTO v_outcome_id;

  IF v_outcome_id IS NULL THEN
    SELECT outcome INTO v_existing_outcome
    FROM public.import_row_outcomes
    WHERE batch_id = _batch_id AND row_number = _row_number;
    RAISE EXCEPTION 'Import row already has final outcome: %', v_existing_outcome;
  END IF;

  RETURN v_outcome_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) IS
  'Called only after resolve_import_row fails. Records a durable failed outcome in a separate transaction for retry and debugging.';
