-- M2-I2: atomic begin/resume and authoritative staging completion only.

ALTER TABLE public.import_batches
  ADD COLUMN resumable_identity text;

CREATE UNIQUE INDEX import_batches_active_resumable_identity_unique
  ON public.import_batches(resumable_identity)
  WHERE resumable_identity IS NOT NULL
    AND status IN ('staging','ready','processing','needs_attention');

COMMENT ON COLUMN public.import_batches.resumable_identity IS
  'Server-derived identity for one active resumable import. Historical batches remain null.';

-- Replace legacy authenticated-wide mutation policies with the established
-- active-staff role contract. Service-role access continues to bypass RLS.
DROP POLICY IF EXISTS "Staff full access" ON public.import_batches;
CREATE POLICY "Active staff can view import batches" ON public.import_batches
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can create import batches" ON public.import_batches
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can update import batches" ON public.import_batches
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can delete import batches" ON public.import_batches
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );

DROP POLICY IF EXISTS "Authenticated staff can view import row outcomes" ON public.import_row_outcomes;
DROP POLICY IF EXISTS "Authenticated staff can create import row outcomes" ON public.import_row_outcomes;
DROP POLICY IF EXISTS "Authenticated staff can update import row outcomes" ON public.import_row_outcomes;
DROP POLICY IF EXISTS "Authenticated staff can delete import row outcomes" ON public.import_row_outcomes;
CREATE POLICY "Active staff can view import row outcomes" ON public.import_row_outcomes
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can create import row outcomes" ON public.import_row_outcomes
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can update import row outcomes" ON public.import_row_outcomes
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );
CREATE POLICY "Active staff can delete import row outcomes" ON public.import_row_outcomes
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  );

CREATE OR REPLACE FUNCTION public.protect_import_staged_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.physical_row_number IS DISTINCT FROM OLD.physical_row_number
    OR NEW.raw_cells IS DISTINCT FROM OLD.raw_cells
    OR NEW.source_columns IS DISTINCT FROM OLD.source_columns
    OR NEW.mapping IS DISTINCT FROM OLD.mapping
    OR NEW.normalized_values IS DISTINCT FROM OLD.normalized_values
  THEN
    RAISE EXCEPTION 'Staged import source data is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_or_resume_import_batch(
  _filename text,
  _raw_file_hash text,
  _source_data_hash text,
  _selected_sheet_name text,
  _selected_sheet_index integer,
  _header_row_number integer,
  _header_mode text,
  _source_structure jsonb,
  _source_system text,
  _source_system_confidence text,
  _transaction_object_type text,
  _mapping jsonb,
  _expected_total_rows integer,
  _matched_rows integer,
  _new_rows integer,
  _ambiguous_rows integer,
  _orchestration_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity text;
  v_batch public.import_batches%ROWTYPE;
  v_created boolean := false;
  v_staged_count integer;
  v_outcome_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED';
  END IF;
  IF NULLIF(btrim(_raw_file_hash), '') IS NULL
     OR NULLIF(btrim(_source_data_hash), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_IDENTITY_REQUIRED';
  END IF;
  IF _expected_total_rows IS NULL OR _expected_total_rows < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_ROW_COUNT_INVALID';
  END IF;
  IF jsonb_typeof(COALESCE(_mapping, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(_orchestration_context, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_CONTEXT_INVALID';
  END IF;

  v_identity := md5(concat_ws('|',
    lower(btrim(_raw_file_hash)), lower(btrim(_source_data_hash)),
    COALESCE(_selected_sheet_index::text, ''), COALESCE(_selected_sheet_name, ''),
    COALESCE(_header_row_number::text, ''), COALESCE(_header_mode, '')
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_identity, 0));

  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE resumable_identity = v_identity
    AND status IN ('staging','ready','processing','needs_attention')
  FOR UPDATE;

  IF FOUND THEN
    IF v_batch.total_rows IS DISTINCT FROM _expected_total_rows
       OR v_batch.raw_file_hash IS DISTINCT FROM _raw_file_hash
       OR v_batch.source_data_hash IS DISTINCT FROM _source_data_hash
       OR v_batch.selected_sheet_name IS DISTINCT FROM _selected_sheet_name
       OR v_batch.selected_sheet_index IS DISTINCT FROM _selected_sheet_index
       OR v_batch.header_row_number IS DISTINCT FROM _header_row_number
       OR v_batch.header_mode IS DISTINCT FROM _header_mode
       OR v_batch.source_structure IS DISTINCT FROM _source_structure
       OR v_batch.source_system IS DISTINCT FROM _source_system
       OR v_batch.source_system_confidence IS DISTINCT FROM _source_system_confidence
       OR v_batch.transaction_object_type IS DISTINCT FROM _transaction_object_type
       OR v_batch.mapping IS DISTINCT FROM COALESCE(_mapping, '{}'::jsonb)
       OR (v_batch.orchestration_context - 'effective_date') IS DISTINCT FROM
          (COALESCE(_orchestration_context, '{}'::jsonb) - 'effective_date')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_RESUME_CONTEXT_CONFLICT';
    END IF;
  ELSE
    INSERT INTO public.import_batches(
      filename,uploaded_by,total_rows,matched_rows,new_rows,ambiguous_rows,status,
      raw_file_hash,source_data_hash,selected_sheet_name,selected_sheet_index,
      header_row_number,header_mode,source_structure,source_system,
      source_system_confidence,transaction_object_type,mapping,
      orchestration_context,resumable_identity
    ) VALUES (
      _filename,auth.uid()::text,_expected_total_rows,COALESCE(_matched_rows,0),
      COALESCE(_new_rows,0),COALESCE(_ambiguous_rows,0),'staging',
      _raw_file_hash,_source_data_hash,_selected_sheet_name,_selected_sheet_index,
      _header_row_number,_header_mode,_source_structure,_source_system,
      _source_system_confidence,_transaction_object_type,COALESCE(_mapping,'{}'::jsonb),
      COALESCE(_orchestration_context,'{}'::jsonb),v_identity
    ) RETURNING * INTO v_batch;
    v_created := true;
  END IF;

  SELECT count(*) INTO v_staged_count FROM public.import_staged_rows WHERE batch_id = v_batch.id;
  SELECT count(*) INTO v_outcome_count FROM public.import_row_outcomes WHERE batch_id = v_batch.id;
  RETURN jsonb_build_object(
    'created',v_created,'resumed',NOT v_created,'batch_id',v_batch.id,
    'status',v_batch.status,'resumable_identity',v_identity,
    'expected_rows',v_batch.total_rows,'staged_rows',v_staged_count,'outcomes',v_outcome_count,
    'orchestration_context',v_batch.orchestration_context
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_import_rows(
  _batch_id uuid,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_row jsonb;
  v_existing public.import_staged_rows%ROWTYPE;
  v_staged_id uuid;
  v_row_number integer;
  v_outcome_staged_id uuid;
  v_outcome_state text;
  v_inserted integer := 0;
  v_reused integer := 0;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_ROWS_INVALID';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF v_batch.status NOT IN ('staging','ready') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_STATE_INVALID';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows)
  LOOP
    v_row_number := (v_row->>'row_number')::integer;
    IF v_row_number IS NULL OR v_row_number <= 0 OR (v_row->>'physical_row_number')::integer <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_ROW_INVALID';
    END IF;
    SELECT * INTO v_existing FROM public.import_staged_rows
    WHERE batch_id = _batch_id AND physical_row_number = (v_row->>'physical_row_number')::integer
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing.raw_cells IS DISTINCT FROM COALESCE(v_row->'raw_cells','null'::jsonb)
         OR v_existing.source_columns IS DISTINCT FROM COALESCE(v_row->'source_columns','null'::jsonb)
         OR v_existing.mapping IS DISTINCT FROM COALESCE(v_row->'mapping','null'::jsonb)
         OR v_existing.normalized_values IS DISTINCT FROM COALESCE(v_row->'normalized_values','{}'::jsonb)
      THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_CONFLICT'; END IF;
      v_staged_id := v_existing.id;
      v_reused := v_reused + 1;
    ELSE
      IF v_batch.status <> 'staging' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_ALREADY_FINALIZED';
      END IF;
      INSERT INTO public.import_staged_rows(batch_id,physical_row_number,raw_cells,source_columns,mapping,normalized_values)
      VALUES (_batch_id,(v_row->>'physical_row_number')::integer,v_row->'raw_cells',v_row->'source_columns',v_row->'mapping',COALESCE(v_row->'normalized_values','{}'::jsonb))
      RETURNING id INTO v_staged_id;
      v_inserted := v_inserted + 1;
    END IF;

    v_outcome_staged_id := NULL;
    v_outcome_state := NULL;
    SELECT staged_row_id,outcome INTO v_outcome_staged_id,v_outcome_state
    FROM public.import_row_outcomes WHERE batch_id = _batch_id AND row_number = v_row_number FOR UPDATE;
    IF FOUND THEN
      IF v_outcome_staged_id IS DISTINCT FROM v_staged_id OR v_outcome_state <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_OUTCOME_CONFLICT';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.import_row_outcomes WHERE staged_row_id = v_staged_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAGING_OUTCOME_CONFLICT';
      END IF;
      INSERT INTO public.import_row_outcomes(batch_id,row_number,staged_row_id,row_data,outcome)
      VALUES (_batch_id,v_row_number,v_staged_id,COALESCE(v_row->'normalized_values','{}'::jsonb),'pending');
    END IF;
  END LOOP;
  SELECT count(*) INTO v_total FROM public.import_staged_rows WHERE batch_id = _batch_id;
  RETURN jsonb_build_object('batch_id',_batch_id,'inserted',v_inserted,'reused',v_reused,'staged_rows',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_import_staging(
  _batch_id uuid,
  _expected_resumable_identity text,
  _expected_mapping jsonb,
  _expected_orchestration_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_staged integer;
  v_outcomes integer;
  v_bound integer;
  v_pending integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'marketing') OR public.has_role(auth.uid(), 'va')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_STAFF_REQUIRED'; END IF;
  SELECT * INTO v_batch FROM public.import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_BATCH_NOT_FOUND'; END IF;
  IF v_batch.status NOT IN ('staging','ready') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_FINALIZE_STATE_INVALID';
  END IF;
  IF v_batch.resumable_identity IS DISTINCT FROM _expected_resumable_identity
     OR v_batch.mapping IS DISTINCT FROM COALESCE(_expected_mapping,'{}'::jsonb)
     OR v_batch.orchestration_context IS DISTINCT FROM COALESCE(_expected_orchestration_context,'{}'::jsonb)
  THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMPORT_RESUME_CONTEXT_CONFLICT'; END IF;

  SELECT count(*) INTO v_staged FROM public.import_staged_rows WHERE batch_id = _batch_id;
  SELECT count(*) INTO v_outcomes FROM public.import_row_outcomes WHERE batch_id = _batch_id;
  SELECT count(*) INTO v_bound FROM public.import_row_outcomes o
    JOIN public.import_staged_rows s ON s.id = o.staged_row_id AND s.batch_id = o.batch_id
    WHERE o.batch_id = _batch_id;
  SELECT count(*) INTO v_pending FROM public.import_row_outcomes WHERE batch_id = _batch_id AND outcome = 'pending';
  IF v_staged <> v_batch.total_rows OR v_outcomes <> v_batch.total_rows
     OR v_bound <> v_batch.total_rows OR v_pending <> v_batch.total_rows THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format(
      'IMPORT_STAGING_INCOMPLETE expected=%s staged=%s outcomes=%s bound=%s pending=%s',
      v_batch.total_rows,v_staged,v_outcomes,v_bound,v_pending);
  END IF;
  IF v_batch.status = 'staging' THEN
    UPDATE public.import_batches SET status = 'ready' WHERE id = _batch_id;
  END IF;
  RETURN jsonb_build_object('batch_id',_batch_id,'status','ready','expected_rows',v_batch.total_rows,'staged_rows',v_staged,'outcomes',v_outcomes);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_or_resume_import_batch(text,text,text,text,integer,integer,text,jsonb,text,text,text,jsonb,integer,integer,integer,integer,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stage_import_rows(uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_import_staging(uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_or_resume_import_batch(text,text,text,text,integer,integer,text,jsonb,text,text,text,jsonb,integer,integer,integer,integer,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_import_rows(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_import_staging(uuid,text,jsonb,jsonb) TO authenticated, service_role;
