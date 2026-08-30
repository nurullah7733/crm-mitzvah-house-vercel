-- M2-I3: batch lease and atomic row claim/reclaim only.

CREATE OR REPLACE FUNCTION public.protect_import_batch_lease_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
    OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
    OR NEW.last_heartbeat_at IS DISTINCT FROM OLD.last_heartbeat_at
    OR (OLD.status = 'ready' AND NEW.status = 'processing')
  ) AND COALESCE(current_setting('app.import_batch_lease_mutation',true),'') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_import_batch_lease_metadata ON public.import_batches;
CREATE TRIGGER protect_import_batch_lease_metadata
BEFORE UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.protect_import_batch_lease_metadata();

CREATE OR REPLACE FUNCTION public.claim_import_batch(
  _batch_id uuid,
  _lease_owner uuid,
  _lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  IF _lease_owner IS NULL OR _lease_seconds NOT BETWEEN 15 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_INVALID';
  END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF v_batch.status NOT IN ('ready','processing') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_LEASABLE';
  END IF;
  IF v_batch.lease_owner IS NOT NULL
     AND v_batch.lease_owner IS DISTINCT FROM _lease_owner
     AND v_batch.lease_expires_at > v_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_HELD';
  END IF;
  PERFORM set_config('app.import_batch_lease_mutation','on',true);
  UPDATE public.import_batches SET
    status = 'processing',
    started_at = CASE WHEN status = 'ready' THEN COALESCE(started_at,v_now) ELSE started_at END,
    lease_owner = _lease_owner,
    lease_expires_at = v_now + make_interval(secs => _lease_seconds),
    last_heartbeat_at = v_now
  WHERE id = _batch_id
  RETURNING * INTO v_batch;
  PERFORM set_config('app.import_batch_lease_mutation','off',true);
  RETURN jsonb_build_object(
    'batch_id',v_batch.id,'status',v_batch.status,'lease_owner',v_batch.lease_owner,
    'lease_expires_at',v_batch.lease_expires_at,'last_heartbeat_at',v_batch.last_heartbeat_at,
    'started_at',v_batch.started_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_import_batch(
  _batch_id uuid,
  _lease_owner uuid,
  _lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  IF _lease_owner IS NULL OR _lease_seconds NOT BETWEEN 15 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_INVALID';
  END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF v_batch.status <> 'processing' OR v_batch.lease_owner IS DISTINCT FROM _lease_owner
     OR v_batch.lease_expires_at IS NULL OR v_batch.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_LOST';
  END IF;
  PERFORM set_config('app.import_batch_lease_mutation','on',true);
  UPDATE public.import_batches SET
    lease_expires_at = v_now + make_interval(secs => _lease_seconds),
    last_heartbeat_at = v_now
  WHERE id = _batch_id RETURNING * INTO v_batch;
  PERFORM set_config('app.import_batch_lease_mutation','off',true);
  RETURN jsonb_build_object('batch_id',v_batch.id,'lease_owner',v_batch.lease_owner,
    'lease_expires_at',v_batch.lease_expires_at,'last_heartbeat_at',v_batch.last_heartbeat_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_import_batch(
  _batch_id uuid,
  _lease_owner uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF _lease_owner IS NULL OR v_batch.lease_owner IS DISTINCT FROM _lease_owner THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_LOST';
  END IF;
  PERFORM set_config('app.import_batch_lease_mutation','on',true);
  UPDATE public.import_batches SET lease_owner = NULL,lease_expires_at = NULL
  WHERE id = _batch_id;
  PERFORM set_config('app.import_batch_lease_mutation','off',true);
  RETURN jsonb_build_object('batch_id',_batch_id,'released',true,'status',v_batch.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_import_claim_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
    OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
    OR NEW.claimed_by IS DISTINCT FROM OLD.claimed_by
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
    OR (OLD.outcome = 'pending' AND NEW.outcome = 'processing')
  ) AND COALESCE(current_setting('app.import_claim_mutation',true),'') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_CLAIM_TOKEN_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_import_claim_metadata ON public.import_row_outcomes;
CREATE TRIGGER protect_import_claim_metadata
BEFORE UPDATE ON public.import_row_outcomes
FOR EACH ROW EXECUTE FUNCTION public.protect_import_claim_metadata();

CREATE OR REPLACE FUNCTION public.claim_import_rows(
  _batch_id uuid,
  _lease_owner uuid,
  _max_rows integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_claims jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  IF _lease_owner IS NULL OR _max_rows NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_INVALID';
  END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF v_batch.status <> 'processing' OR v_batch.lease_owner IS DISTINCT FROM _lease_owner
     OR v_batch.lease_expires_at IS NULL OR v_batch.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_LEASE_LOST';
  END IF;

  PERFORM set_config('app.import_claim_mutation','on',true);
  WITH candidates AS (
    SELECT o.id,o.outcome = 'processing' AS reclaimed,s.physical_row_number,
      s.id AS staged_row_id,s.raw_cells,s.source_columns,s.mapping,s.normalized_values
    FROM public.import_row_outcomes o
    JOIN public.import_staged_rows s ON s.id = o.staged_row_id AND s.batch_id = o.batch_id
    WHERE o.batch_id = _batch_id AND (
      o.outcome = 'pending'
      OR (o.outcome = 'processing' AND o.lease_expires_at IS NOT NULL AND o.lease_expires_at <= v_now)
    )
    ORDER BY s.physical_row_number,o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT _max_rows
  ), claimed AS (
    UPDATE public.import_row_outcomes o SET
      outcome = 'processing',attempt_count = o.attempt_count + 1,
      claim_token = gen_random_uuid(),claimed_by = _lease_owner,claimed_at = v_now,
      lease_expires_at = v_batch.lease_expires_at
    FROM candidates c WHERE o.id = c.id
    RETURNING o.id AS outcome_id,o.row_number,o.attempt_count,o.claim_token,o.claimed_by,
      o.claimed_at,o.lease_expires_at,c.reclaimed,c.physical_row_number,c.staged_row_id,
      c.raw_cells,c.source_columns,c.mapping,c.normalized_values
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'outcome_id',outcome_id,'row_number',row_number,'attempt_count',attempt_count,
    'claim_token',claim_token,'claimed_by',claimed_by,'claimed_at',claimed_at,
    'lease_expires_at',lease_expires_at,'reclaimed',reclaimed,
    'physical_row_number',physical_row_number,'staged_row_id',staged_row_id,
    'raw_cells',raw_cells,'source_columns',source_columns,'mapping',mapping,
    'normalized_values',normalized_values
  ) ORDER BY physical_row_number,outcome_id),'[]'::jsonb) INTO v_claims FROM claimed;
  PERFORM set_config('app.import_claim_mutation','off',true);
  RETURN v_claims;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_import_row_claim(
  _batch_id uuid,
  _outcome_id uuid,
  _staged_row_id uuid,
  _claim_token uuid,
  _claimed_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  PERFORM 1 FROM public.import_row_outcomes
  WHERE id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id
    AND outcome = 'processing' AND claim_token = _claim_token AND claimed_by = _claimed_by
    AND lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_CLAIM_LOST'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_import_batch(uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_import_batch(uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_import_batch(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_import_rows(uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_import_row_claim(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_import_claim_metadata() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_import_batch_lease_metadata() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_import_batch(uuid,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_import_batch(uuid,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_import_batch(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_import_rows(uuid,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_import_row_claim(uuid,uuid,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.protect_import_claim_metadata() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_import_batch_lease_metadata() TO service_role;
