-- M2-I7: minimal discovery for an interrupted or attention-needing import batch.
--
-- Audit finding: nothing durable ever told the browser "you have unfinished work."
-- sessionStorage only remembers the file-picker/mapping UI selections (see the
-- mh-import-draft key), never the batch id, and the main execution loop has a strict
-- `claimedRow.row_number === index + 1` assertion that throws immediately the moment
-- any earlier row is already terminal — so today, re-uploading the same file to resume
-- a partially-completed batch crashes on the very first claim. This migration adds only
-- the read the client needs to discover that unfinished work exists at all; the loop
-- fix itself is client-side (import_batch_progress and reconcile_import_batch from I6
-- already provide everything else needed once a batch id is known).
--
-- find_active_import_batch() returns the single most recent batch that is not yet
-- terminal-closed (staging/ready/processing/needs_attention), tagged with a `kind` so
-- the client never mislabels a needs_attention batch (review/failure work already
-- finished executing) as "still processing". completed/reverted/imported batches are
-- never offered. This is deliberately not a history/dashboard — Past Imports already
-- lists recent batches for that.
CREATE OR REPLACE FUNCTION public.find_active_import_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;

  SELECT * INTO v_batch FROM public.import_batches
  WHERE status IN ('staging', 'ready', 'processing', 'needs_attention')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'batch_id', v_batch.id,
    'filename', v_batch.filename,
    'status', v_batch.status,
    'kind', CASE WHEN v_batch.status = 'needs_attention' THEN 'needs_attention' ELSE 'resumable' END,
    'total_rows', v_batch.total_rows,
    'raw_file_hash', v_batch.raw_file_hash,
    'source_data_hash', v_batch.source_data_hash,
    'created_at', v_batch.created_at,
    'progress', public.import_batch_progress(v_batch.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.find_active_import_batch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_active_import_batch() TO authenticated, service_role;
