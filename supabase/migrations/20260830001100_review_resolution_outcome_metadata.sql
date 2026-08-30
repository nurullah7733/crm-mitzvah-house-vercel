-- M2-I5 fix: forward-only corrections found by LIVE QA against the already-applied
-- 20260830001000_review_failure_retry_safety.sql. That migration is not edited here —
-- these are new CREATE OR REPLACE definitions layered on top of it.
--
-- (1) finalize_claimed_import_row_failure left claim_token/claimed_by/claimed_at/
--     lease_expires_at populated on the row it just marked `failed`, so
--     retry_failed_import_row's own "no residual claim" guard rejected every real retry
--     with IMPORT_ROW_STATE_CHANGED. claim -> fail -> retry always failed.
-- (2) sync_import_review_resolution_metadata was defined but never called from any
--     review-resolution path, so import_row_outcomes.result never recorded how an
--     import-linked review was resolved.
-- (3) that same function had no staff-role check, unlike every other I3-I5 RPC.

-- Fix 1: clear transient claim ownership once a claim is finalized as failed. Everything
-- above the UPDATE — the staff check, the already-finalized short-circuit, and the
-- stale-worker validation (batch/outcome status, claim_token, claimed_by, lease
-- expiry) — is unchanged, so a stale worker is still rejected before it can reach this
-- UPDATE. attempt_count, completed_at, last_error and result are preserved exactly as
-- before; only the active claim fields are released now that the claim is over.
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
  UPDATE public.import_row_outcomes SET
    outcome = 'failed', person_id = NULL, review_queue_id = NULL,
    message = v_message, completed_at = clock_timestamp(), last_error = v_message, result = v_result,
    claim_token = NULL, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
  WHERE id = v_outcome.id;
  RETURN jsonb_build_object('already_finalized',false,'outcome','failed','outcome_id',v_outcome.id,'result',v_result);
END;
$$;

-- Fix 3: sync_import_review_resolution_metadata is internal-only — it exists to be called
-- from log_review_decision in the same transaction as a review resolution, never invoked
-- directly by a client. Add the same staff-role check every other I3-I5 RPC has (checked
-- before any read or write), and follow the project's existing convention for
-- internal-only helpers (see resolve_review_merge_core): revoke direct `authenticated`
-- EXECUTE and grant only to `service_role`. A SECURITY DEFINER function called from
-- another SECURITY DEFINER function's body runs as that function's owner, so the nested
-- call from log_review_decision is unaffected by this revoke.
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
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED';
  END IF;

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

REVOKE ALL ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) TO service_role;

-- Fix 2: wire the sync into the one place every active review-resolution path already
-- converges on. resolve_review_quick_merge, resolve_review_manual_merge, and
-- resolve_review_create all call resolve_review_merge_core, which calls
-- log_review_decision; resolve_review_couple_activity and resolve_review_household_card
-- (per-member "same"/"related"/"separate"/"discard" actions) call resolve_review_merge_core
-- or log_review_decision directly. So log_review_decision is the single shared core for
-- every terminal decision (merged/kept_both/created/discarded) — this is the only edit
-- needed to cover all of them, run in the same transaction as the resolution itself, with
-- no second write from the browser.
--
-- Every M2-H stale/validation guard (REVIEW_STALE_PERSON, REVIEW_INVALID_PATCH_CONTRACT,
-- REVIEW_DEDICATED_ACTION_REQUIRED, etc.) lives in the calling RPCs, before they ever reach
-- log_review_decision, so none of that is touched here. The existing
-- `IF v_review.status <> 'pending' THEN RAISE 'REVIEW_ALREADY_FINALIZED'` check already
-- guards this function's entire body, including the new call below, so a repeated
-- resolution still cannot run it a second time — no duplicate or overwritten metadata.
-- Reviews with import_outcome_id NULL (non-import reviews) are skipped entirely.
CREATE OR REPLACE FUNCTION public.log_review_decision(
  _item_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _person_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.review_queue%ROWTYPE;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION 'Active staff access required'; END IF;
  IF _decision NOT IN ('merged', 'edited', 'kept_both', 'discarded', 'created') THEN
    RAISE EXCEPTION 'Unknown review decision';
  END IF;
  IF _decision = 'discarded' AND COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a short reason for discarding this row';
  END IF;

  SELECT * INTO v_review FROM public.review_queue WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;
  IF v_review.status <> 'pending' THEN
    RAISE EXCEPTION 'REVIEW_ALREADY_FINALIZED' USING ERRCODE = 'P0001';
  END IF;
  v_status := CASE WHEN _decision = 'discarded' THEN 'dismissed' ELSE 'resolved' END;
  UPDATE public.review_queue SET
    status = v_status,
    resolution_note = COALESCE(NULLIF(btrim(_reason), ''), _decision)
  WHERE id = _item_id;
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('review_queue', _item_id, 'review_' || _decision, auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('reason', _reason, 'person_id', _person_id, 'queued_row', to_jsonb(v_review)));

  IF v_review.import_outcome_id IS NOT NULL THEN
    PERFORM public.sync_import_review_resolution_metadata(_item_id, _decision, _reason, _person_id, '{}'::jsonb);
  END IF;
END;
$$;
