-- M2-I5: safe retry/reset for failed import rows without reopening terminal success or stale review state.

CREATE OR REPLACE FUNCTION public.retry_failed_import_row(
  _batch_id uuid,
  _outcome_id uuid,
  _staged_row_id uuid,
  _expected_attempt_count integer DEFAULT NULL,
  _expected_last_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_outcome public.import_row_outcomes%ROWTYPE;
  v_review public.review_queue%ROWTYPE;
  v_result jsonb;
  v_retry_count integer;
  v_last_error text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  SELECT * INTO v_outcome FROM public.import_row_outcomes
    WHERE id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id
    FOR UPDATE;

  IF v_batch.id IS NULL OR v_outcome.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  IF v_batch.status <> 'processing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  -- Row lock is held via the `FOR UPDATE` selects above; a retry may only reopen
  -- an outcome that is currently terminally failed.
  IF v_outcome.outcome = 'failed' THEN
    NULL;
  ELSE
    IF v_outcome.outcome IN ('created', 'matched') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_NOT_RETRYABLE';
    END IF;
    IF v_outcome.outcome = 'flagged' OR v_outcome.review_queue_id IS NOT NULL THEN
      SELECT * INTO v_review FROM public.review_queue WHERE id = v_outcome.review_queue_id FOR UPDATE;
      IF v_review.id IS NOT NULL AND v_review.status = 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_REVIEW_UNRESOLVED';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_NOT_RETRYABLE';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_NOT_RETRYABLE';
  END IF;

  IF _expected_attempt_count IS NOT NULL AND v_outcome.attempt_count IS DISTINCT FROM _expected_attempt_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  IF _expected_last_error IS NOT NULL AND COALESCE(v_outcome.last_error, '') IS DISTINCT FROM _expected_last_error THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  IF v_outcome.claim_token IS NOT NULL OR v_outcome.claimed_by IS NOT NULL OR v_outcome.lease_expires_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  v_result := COALESCE(v_outcome.result, '{}'::jsonb);
  v_last_error := COALESCE(v_outcome.last_error, 'Import row failed');
  v_retry_count := COALESCE((v_result->>'retry_count')::int, 0) + 1;
  v_result := v_result || jsonb_build_object(
    'previous_outcome', 'failed',
    'retrying', true,
    'retry_count', v_retry_count,
    'last_error', v_last_error,
    'last_completed_at', v_outcome.completed_at,
    'terminal_outcome', NULL
  );

  UPDATE public.import_row_outcomes SET
    outcome = 'pending',
    person_id = NULL,
    review_queue_id = NULL,
    message = NULL,
    completed_at = NULL,
    claim_token = NULL,
    claimed_by = NULL,
    claimed_at = NULL,
    lease_expires_at = NULL,
    last_error = v_last_error,
    result = v_result
  WHERE id = v_outcome.id;

  RETURN jsonb_build_object(
    'outcome', 'pending',
    'outcome_id', v_outcome.id,
    'batch_id', _batch_id,
    'staged_row_id', _staged_row_id,
    'attempt_count', v_outcome.attempt_count,
    'retry_count', v_retry_count,
    'last_error', v_last_error,
    'result', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_import_row(uuid,uuid,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_failed_import_row(uuid,uuid,uuid,integer,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_import_review_resolution_metadata(
  _review_id uuid,
  _decision text,
  _reason text,
  _person_id uuid,
  _resolution_result jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_outcome public.import_row_outcomes%ROWTYPE;
  v_result jsonb;
BEGIN
  IF _review_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_review FROM public.review_queue WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That review item no longer exists';
  END IF;

  IF v_review.import_outcome_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_outcome FROM public.import_row_outcomes
    WHERE id = v_review.import_outcome_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_STATE_CHANGED';
  END IF;

  v_result := COALESCE(v_outcome.result, '{}'::jsonb);
  v_result := v_result || jsonb_build_object(
    'review_resolution', jsonb_build_object(
      'status', 'resolved',
      'review_id', v_review.id,
      'decision', _decision,
      'reason', COALESCE(NULLIF(btrim(_reason), ''), _decision),
      'resolved_at', clock_timestamp(),
      'person_id', _person_id,
      'resolution_result', COALESCE(_resolution_result, '{}'::jsonb)
    )
  );

  UPDATE public.import_row_outcomes SET
    result = v_result,
    message = COALESCE(NULLIF(btrim(_reason), ''), v_outcome.message),
    last_error = NULL
  WHERE id = v_outcome.id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) TO authenticated, service_role;
