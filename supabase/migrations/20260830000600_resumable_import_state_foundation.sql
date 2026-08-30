-- M2-I1: durable resumable-import state foundation only.

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS orchestration_context jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.import_batches ALTER COLUMN status SET DEFAULT 'staging';

-- `imported` remains accepted as the historical spelling of `completed`.
-- NOT VALID preserves any unknown historical value without permitting it on
-- newly inserted or updated batches.
ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_resumable_status_valid
    CHECK (status IN ('staging','ready','processing','needs_attention','completed','reverted','imported'))
    NOT VALID,
  ADD CONSTRAINT import_batches_orchestration_context_object
    CHECK (jsonb_typeof(orchestration_context) = 'object') NOT VALID;

COMMENT ON COLUMN public.import_batches.orchestration_context IS
  'Versioned, non-secret snapshot of approved import decisions required to reproduce planning after interruption.';
COMMENT ON COLUMN public.import_batches.lease_owner IS
  'Reserved for a later resumable-import claimant. M2-I1 defines storage only and does not implement leasing.';

ALTER TABLE public.import_row_outcomes
  DROP CONSTRAINT IF EXISTS import_row_outcomes_outcome_valid;

ALTER TABLE public.import_row_outcomes
  ADD COLUMN IF NOT EXISTS staged_row_id uuid,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.import_staged_rows
  ADD CONSTRAINT import_staged_rows_id_batch_unique UNIQUE (id, batch_id);

ALTER TABLE public.import_row_outcomes
  ADD CONSTRAINT import_row_outcomes_outcome_valid
    CHECK (outcome IN ('pending','processing','created','matched','flagged','failed')),
  ADD CONSTRAINT import_row_outcomes_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  ADD CONSTRAINT import_row_outcomes_result_object
    CHECK (jsonb_typeof(result) = 'object'),
  ADD CONSTRAINT import_row_outcomes_staged_batch_fkey
    FOREIGN KEY (staged_row_id, batch_id)
    REFERENCES public.import_staged_rows(id, batch_id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT import_row_outcomes_terminal_completion
    CHECK (
      (outcome IN ('pending','processing') AND completed_at IS NULL)
      OR
      (outcome IN ('created','matched','flagged','failed') AND completed_at IS NOT NULL)
    ) NOT VALID;

CREATE UNIQUE INDEX import_row_outcomes_staged_row_unique
  ON public.import_row_outcomes(staged_row_id)
  WHERE staged_row_id IS NOT NULL;

COMMENT ON COLUMN public.import_row_outcomes.staged_row_id IS
  'Immutable staged source row for this outcome. Nullable only for historical outcomes created before M2-I1.';
COMMENT ON COLUMN public.import_row_outcomes.claim_token IS
  'Reserved for later atomic row claiming. M2-I1 does not issue or validate claim tokens.';
COMMENT ON COLUMN public.import_row_outcomes.result IS
  'Structured terminal result for later resume-state reconstruction.';

-- The active importer still logs a failed CRM statement separately. Keep that
-- contract, but make failure a fully described terminal I1 outcome.
CREATE OR REPLACE FUNCTION public.record_import_row_failure(
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
  v_message text := COALESCE(NULLIF(btrim(_message), ''), 'Import row failed');
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
  IF NOT FOUND THEN RAISE EXCEPTION 'That import batch no longer exists'; END IF;

  INSERT INTO public.import_row_outcomes(
    batch_id,row_number,row_data,outcome,person_id,review_queue_id,message,
    completed_at,last_error,result
  ) VALUES (
    _batch_id,_row_number,COALESCE(_row_data, '{}'::jsonb),'failed',NULL,NULL,v_message,
    now(),v_message,jsonb_build_object('error', v_message)
  )
  ON CONFLICT (batch_id,row_number) DO UPDATE SET
    row_data = EXCLUDED.row_data,
    outcome = 'failed',
    person_id = NULL,
    review_queue_id = NULL,
    message = EXCLUDED.message,
    completed_at = now(),
    last_error = EXCLUDED.last_error,
    result = EXCLUDED.result
  WHERE public.import_row_outcomes.outcome IN ('pending','processing','failed')
  RETURNING id INTO v_outcome_id;

  IF v_outcome_id IS NULL THEN
    SELECT outcome INTO v_existing_outcome FROM public.import_row_outcomes
    WHERE batch_id = _batch_id AND row_number = _row_number;
    RAISE EXCEPTION 'Import row already has final outcome: %', v_existing_outcome;
  END IF;
  RETURN v_outcome_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid,integer,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_import_row_failure(uuid,integer,jsonb,text) TO authenticated, service_role;
