-- M2-I6: authoritative import progress and batch finalization.
--
-- Audit finding: the only two places that ever wrote import_batches.status /
-- processed_rows / created_rows / matched_rows / flagged_rows / failed_rows /
-- completed_at were both in the browser (the main import-run finalize block and I5's
-- finalizeBatchAfterRetries), each computing its own "reconciliation" from a client-side
-- SELECT and writing it directly. Nothing server-side ever verified that count against
-- durable import_row_outcomes rows, and finalizeBatchAfterRetries in particular set
-- status='completed' unconditionally once its own local retry list emptied, with no
-- check for flagged rows or any other outstanding work. A reload, a second tab, or a
-- crashed browser mid-import had no way to learn the truth except by re-deriving it
-- itself, and nothing stopped a stale/buggy client from writing a false "completed".
--
-- This migration adds:
--   1. import_batch_progress(_batch_id) — read-only, always-live authoritative counts
--      derived from import_row_outcomes. Callable at any checkpoint, including after a
--      reload, without touching import_batches at all.
--   2. reconcile_import_batch(_batch_id) — the only path allowed to advance
--      import_batches into a terminal status. Row-locks the batch, recomputes progress
--      fresh, and only ever writes when every expected row has reached a terminal
--      outcome; otherwise it returns the true incomplete state and writes nothing.
--   3. protect_import_batch_final_state — a trigger guarding processed_rows/
--      created_rows/matched_rows/flagged_rows/failed_rows/completed_at and any status
--      transition into ('completed','needs_attention'), the same way
--      protect_import_batch_lease_metadata already guards lease fields. Only
--      reconcile_import_batch may write these now.

CREATE OR REPLACE FUNCTION public.import_batch_progress(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_total integer;
  v_pending integer;
  v_processing_active integer;
  v_processing_reclaimable integer;
  v_created integer;
  v_matched integer;
  v_flagged integer;
  v_failed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE outcome = 'pending'),
    count(*) FILTER (WHERE outcome = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at > v_now),
    count(*) FILTER (WHERE outcome = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= v_now)),
    count(*) FILTER (WHERE outcome = 'created'),
    count(*) FILTER (WHERE outcome = 'matched'),
    count(*) FILTER (WHERE outcome = 'flagged'),
    count(*) FILTER (WHERE outcome = 'failed')
  INTO v_total, v_pending, v_processing_active, v_processing_reclaimable, v_created, v_matched, v_flagged, v_failed
  FROM public.import_row_outcomes
  WHERE batch_id = _batch_id;

  RETURN jsonb_build_object(
    'batch_id', _batch_id,
    'total_rows', v_total,
    'pending_count', v_pending,
    'processing_count', v_processing_active + v_processing_reclaimable,
    'processing_active_count', v_processing_active,
    'processing_reclaimable_count', v_processing_reclaimable,
    'created_count', v_created,
    'matched_count', v_matched,
    'flagged_count', v_flagged,
    'failed_count', v_failed,
    'terminal_count', v_created + v_matched + v_flagged + v_failed,
    'completed_count', v_created + v_matched + v_flagged + v_failed,
    'incomplete', (v_pending + v_processing_active + v_processing_reclaimable) > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_batch_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_batch_progress(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_import_batch_final_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.processed_rows IS DISTINCT FROM OLD.processed_rows
    OR NEW.created_rows IS DISTINCT FROM OLD.created_rows
    OR NEW.matched_rows IS DISTINCT FROM OLD.matched_rows
    OR NEW.flagged_rows IS DISTINCT FROM OLD.flagged_rows
    OR NEW.failed_rows IS DISTINCT FROM OLD.failed_rows
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'needs_attention'))
  ) AND COALESCE(current_setting('app.import_batch_reconcile_mutation', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_RECONCILE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_import_batch_final_state ON public.import_batches;
CREATE TRIGGER protect_import_batch_final_state
BEFORE UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.protect_import_batch_final_state();

REVOKE ALL ON FUNCTION public.protect_import_batch_final_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_import_batch_final_state() TO service_role;

-- The only path allowed to move a batch into a terminal status. Safe to call repeatedly
-- and from concurrent callers: it takes the same `FOR UPDATE` lock on the batch row that
-- claim_import_rows / execute_claimed_import_row / finalize_claimed_import_row_failure
-- already take before writing an outcome, so a reconciliation call can never observe a
-- partially-written "last row" — it either runs entirely before that writer's commit
-- (and correctly reports incomplete) or entirely after it (and sees the committed
-- terminal outcome). A second, redundant call re-derives the identical result and
-- re-writes the same values — no special-casing needed for concurrent finalization.
CREATE OR REPLACE FUNCTION public.reconcile_import_batch(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_progress jsonb;
  v_bound integer;
  v_final_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;

  -- A reverted or pre-resumable-import ("imported") batch is not reopened or reconciled.
  IF v_batch.status IN ('reverted', 'imported') THEN
    RETURN jsonb_build_object(
      'batch_id', v_batch.id, 'status', v_batch.status, 'reconciled', false,
      'reason', 'IMPORT_BATCH_NOT_RECONCILABLE'
    );
  END IF;

  v_progress := public.import_batch_progress(_batch_id);
  SELECT count(*) INTO v_bound FROM public.import_row_outcomes WHERE batch_id = _batch_id;

  -- Every expected row must have a durable outcome before this batch can be judged at
  -- all — staging may still be in progress.
  IF v_batch.total_rows IS NULL OR v_bound <> v_batch.total_rows THEN
    RETURN jsonb_build_object(
      'batch_id', v_batch.id, 'status', v_batch.status, 'reconciled', false,
      'reason', 'IMPORT_STAGING_INCOMPLETE', 'progress', v_progress
    );
  END IF;

  -- Any row still pending, or processing (whether its claim lease is still active or has
  -- expired and is merely reclaimable), is not terminal. The batch stays exactly as it
  -- is — no snapshot write, no status change — so a stale caller can never force
  -- completion out from under genuinely outstanding work. import_batch_progress remains
  -- the live, correct source for a reloading browser in the meantime.
  IF (v_progress->>'incomplete')::boolean THEN
    RETURN jsonb_build_object(
      'batch_id', v_batch.id, 'status', v_batch.status, 'reconciled', false,
      'reason', 'IMPORT_ROWS_INCOMPLETE', 'progress', v_progress
    );
  END IF;

  v_final_status := CASE
    WHEN (v_progress->>'failed_count')::integer > 0 THEN 'needs_attention'
    WHEN (v_progress->>'flagged_count')::integer > 0 THEN 'needs_attention'
    ELSE 'completed'
  END;

  PERFORM set_config('app.import_batch_reconcile_mutation', 'on', true);
  UPDATE public.import_batches SET
    processed_rows = (v_progress->>'terminal_count')::integer,
    created_rows = (v_progress->>'created_count')::integer,
    matched_rows = (v_progress->>'matched_count')::integer,
    flagged_rows = (v_progress->>'flagged_count')::integer,
    failed_rows = (v_progress->>'failed_count')::integer,
    status = v_final_status,
    completed_at = COALESCE(v_batch.completed_at, clock_timestamp())
  WHERE id = v_batch.id;
  PERFORM set_config('app.import_batch_reconcile_mutation', 'off', true);

  RETURN jsonb_build_object(
    'batch_id', v_batch.id, 'status', v_final_status, 'reconciled', true, 'progress', v_progress
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_import_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_import_batch(uuid) TO authenticated, service_role;
