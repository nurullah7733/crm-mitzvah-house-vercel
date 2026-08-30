-- M2-I4: claimed-row CRM execution and terminal outcome are one transaction.

ALTER TABLE public.review_queue
  ADD COLUMN import_outcome_id uuid REFERENCES public.import_row_outcomes(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX review_queue_import_outcome_unique
  ON public.review_queue(import_outcome_id)
  WHERE import_outcome_id IS NOT NULL;

COMMENT ON COLUMN public.review_queue.import_outcome_id IS
  'Durable one-to-one binding for an import outcome finalized as review-required.';

CREATE OR REPLACE FUNCTION public.execute_claimed_import_row(
  _batch_id uuid,
  _outcome_id uuid,
  _staged_row_id uuid,
  _claim_token uuid,
  _claimed_by uuid,
  _execution jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_outcome public.import_row_outcomes%ROWTYPE;
  v_staged public.import_staged_rows%ROWTYPE;
  v_kind text := COALESCE(_execution->>'kind', '');
  v_terminal text;
  v_crm jsonb;
  v_review_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;

  -- Lock in the same batch -> outcome order used by claiming. The locks remain
  -- held through CRM execution and terminal finalization, so lease expiry in
  -- the middle of this transaction cannot admit an overlapping executor.
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  SELECT * INTO v_outcome FROM public.import_row_outcomes
    WHERE id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id
    FOR UPDATE;
  SELECT * INTO v_staged FROM public.import_staged_rows
    WHERE id = _staged_row_id AND batch_id = _batch_id;
  IF v_batch.id IS NULL OR v_outcome.id IS NULL OR v_staged.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_LOST';
  END IF;

  -- A stale replay after a committed response loss is an authoritative read,
  -- never another CRM execution. Token/lease expiry is intentionally irrelevant.
  IF v_outcome.outcome IN ('created','matched','flagged','failed') THEN
    RETURN jsonb_build_object(
      'already_finalized',true,'outcome',v_outcome.outcome,'outcome_id',v_outcome.id,
      'person_id',v_outcome.person_id,'review_queue_id',v_outcome.review_queue_id,
      'completed_at',v_outcome.completed_at,'result',v_outcome.result
    ) || CASE WHEN jsonb_typeof(v_outcome.result) = 'object' THEN v_outcome.result ELSE '{}'::jsonb END;
  END IF;

  IF v_batch.status <> 'processing'
     OR v_batch.lease_owner IS DISTINCT FROM _claimed_by
     OR v_batch.lease_expires_at IS NULL OR v_batch.lease_expires_at <= clock_timestamp()
     OR v_outcome.outcome <> 'processing'
     OR v_outcome.claim_token IS DISTINCT FROM _claim_token
     OR v_outcome.claimed_by IS DISTINCT FROM _claimed_by
     OR v_outcome.lease_expires_at IS NULL OR v_outcome.lease_expires_at <= clock_timestamp()
  THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_LOST'; END IF;

  IF v_kind = 'direct' THEN
    v_terminal := _execution->>'terminal_outcome';
    IF v_terminal IS NULL OR v_terminal NOT IN ('created','matched') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_EXECUTION_INVALID';
    END IF;
    v_crm := public.resolve_import_row(
      COALESCE(_execution->'person','{}'::jsonb),
      COALESCE(_execution->'household','{"action":"none"}'::jsonb),
      COALESCE(_execution->'contact_methods','[]'::jsonb),
      COALESCE(_execution->'labels','{}'::jsonb),
      COALESCE(_execution->'provenance','[]'::jsonb),
      _batch_id,
      COALESCE(_execution->'spouse','{"action":"skip"}'::jsonb),
      COALESCE(_execution->'children','[]'::jsonb),
      COALESCE(_execution->'activity','{}'::jsonb)
    );
    IF NULLIF(v_crm->>'person_id','') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_EXECUTION_NO_PERSON';
    END IF;
    v_result := v_crm || jsonb_build_object('terminal_outcome',v_terminal);
    UPDATE public.import_row_outcomes SET
      outcome = v_terminal, person_id = (v_crm->>'person_id')::uuid,
      review_queue_id = NULL, message = NULL, completed_at = clock_timestamp(),
      last_error = NULL, result = v_result
    WHERE id = v_outcome.id;
    RETURN v_crm || jsonb_build_object(
      'already_finalized',false,'outcome',v_terminal,'outcome_id',v_outcome.id,
      'completed_at',(SELECT completed_at FROM public.import_row_outcomes WHERE id = v_outcome.id),
      'result',v_result
    );
  ELSIF v_kind = 'review' THEN
    IF NULLIF(btrim(_execution#>>'{review,reason}'),'') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_EXECUTION_INVALID';
    END IF;
    SELECT id INTO v_review_id FROM public.review_queue
      WHERE import_outcome_id = v_outcome.id FOR UPDATE;
    IF v_review_id IS NULL THEN
      INSERT INTO public.review_queue(
        batch_id,filename,reason,row_data,candidate_person_ids,status,import_outcome_id
      ) VALUES (
        _batch_id,_execution#>>'{review,filename}',_execution#>>'{review,reason}',
        COALESCE(_execution#>'{review,row_data}','{}'::jsonb),
        ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
          COALESCE(_execution#>'{review,candidate_person_ids}','[]'::jsonb)
        )),
        'pending',v_outcome.id
      ) RETURNING id INTO v_review_id;
    END IF;
    v_result := jsonb_build_object(
      'terminal_outcome','flagged','review_queue_id',v_review_id,
      'reason',_execution#>>'{review,reason}'
    );
    UPDATE public.import_row_outcomes SET
      outcome = 'flagged', person_id = NULL, review_queue_id = v_review_id,
      message = COALESCE(NULLIF(_execution->>'message',''),_execution#>>'{review,reason}'),
      completed_at = clock_timestamp(), last_error = NULL, result = v_result
    WHERE id = v_outcome.id;
    RETURN jsonb_build_object(
      'already_finalized',false,'outcome','flagged','outcome_id',v_outcome.id,
      'review_queue_id',v_review_id,'result',v_result
    );
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_EXECUTION_INVALID';
END;
$$;

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
  UPDATE public.import_row_outcomes SET outcome = 'failed',person_id = NULL,review_queue_id = NULL,
    message = v_message,completed_at = clock_timestamp(),last_error = v_message,result = v_result
  WHERE id = v_outcome.id;
  RETURN jsonb_build_object('already_finalized',false,'outcome','failed','outcome_id',v_outcome.id,'result',v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.execute_claimed_import_row(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_claimed_import_row_failure(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_claimed_import_row(uuid,uuid,uuid,uuid,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_claimed_import_row_failure(uuid,uuid,uuid,uuid,uuid,text) TO authenticated, service_role;
