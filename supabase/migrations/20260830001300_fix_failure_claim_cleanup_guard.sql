-- M2-I5 fix: finalize_claimed_import_row_failure (as deployed by 20260830001200) clears
-- claim_token/claimed_by/claimed_at/lease_expires_at in its terminal UPDATE, but those four
-- columns — plus attempt_count and the pending->processing transition — are protected by
-- the protect_import_claim_metadata trigger (20260830000800), which raises
-- IMPORT_CLAIM_TOKEN_REQUIRED for any UPDATE touching them unless
-- current_setting('app.import_claim_mutation', true) = 'on'. The deployed function never
-- set that flag, so LIVE re-verification found claim -> finalize_claimed_import_row_failure
-- always raising IMPORT_CLAIM_TOKEN_REQUIRED — the row stayed `processing` and could never
-- reach `failed`. Neither 20260830001000, 20260830001100 nor 20260830001200 is edited here.
--
-- Fix: wrap only the trusted terminal UPDATE in the same on/off pattern
-- claim_import_rows already uses for its own protected-column writes. Every validation
-- above it — staff auth, batch/outcome row locking, the already-finalized short-circuit,
-- and the full stale-worker check (batch status, batch lease owner/expiry, outcome status,
-- claim_token, claimed_by, outcome lease expiry) — runs first, unchanged, with the guard
-- still off, so a stale worker is rejected exactly as before and never reaches the flag.
CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure(
  _batch_id uuid,
  _outcome_id uuid,
  _staged_row_id uuid,
  _claim_token uuid,
  _claimed_by uuid,
  _message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_outcome public.import_row_outcomes%ROWTYPE;
  v_message text := COALESCE(NULLIF(btrim(_message),''),'Import row failed');
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  SELECT * INTO v_outcome FROM public.import_row_outcomes
    WHERE id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id FOR UPDATE;
  IF v_batch.id IS NULL OR v_outcome.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_LOST';
  END IF;
  IF v_outcome.outcome IN ('created','matched','flagged','failed') THEN
    RETURN jsonb_build_object(
      'already_finalized',true,'outcome',v_outcome.outcome,'outcome_id',v_outcome.id,
      'person_id',v_outcome.person_id,'review_queue_id',v_outcome.review_queue_id,
      'completed_at',v_outcome.completed_at,'result',v_outcome.result
    );
  END IF;
  IF v_batch.status <> 'processing' OR v_batch.lease_owner IS DISTINCT FROM _claimed_by
     OR v_batch.lease_expires_at IS NULL OR v_batch.lease_expires_at <= clock_timestamp()
     OR v_outcome.outcome <> 'processing' OR v_outcome.claim_token IS DISTINCT FROM _claim_token
     OR v_outcome.claimed_by IS DISTINCT FROM _claimed_by
     OR v_outcome.lease_expires_at IS NULL OR v_outcome.lease_expires_at <= clock_timestamp()
  THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_LOST'; END IF;
  v_result := jsonb_build_object('terminal_outcome','failed','error',v_message);
  -- Only this trusted internal UPDATE — already past every validation above — may touch the
  -- protected claim columns. is_local=true (the third set_config arg) scopes the flag to
  -- this transaction, so it can never leak into any other concurrent claim/finalize call,
  -- and a rollback here reverts it automatically along with the UPDATE itself.
  PERFORM set_config('app.import_claim_mutation','on',true);
  UPDATE public.import_row_outcomes SET
    outcome = 'failed', person_id = NULL, review_queue_id = NULL,
    message = v_message, completed_at = clock_timestamp(), last_error = v_message, result = v_result,
    claim_token = NULL, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
  WHERE id = v_outcome.id;
  PERFORM set_config('app.import_claim_mutation','off',true);
  RETURN jsonb_build_object('already_finalized',false,'outcome','failed','outcome_id',v_outcome.id,'result',v_result);
END;
$$;
