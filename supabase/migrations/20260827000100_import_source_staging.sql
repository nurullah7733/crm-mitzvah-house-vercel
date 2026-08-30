-- M2-B: preserve the immutable source representation before canonical import processing.
-- Existing batches remain valid; every new column is nullable for backward compatibility.
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS raw_file_hash text,
  ADD COLUMN IF NOT EXISTS source_data_hash text,
  ADD COLUMN IF NOT EXISTS selected_sheet_name text,
  ADD COLUMN IF NOT EXISTS selected_sheet_index integer,
  ADD COLUMN IF NOT EXISTS header_row_number integer,
  ADD COLUMN IF NOT EXISTS header_mode text,
  ADD COLUMN IF NOT EXISTS source_structure jsonb;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_selected_sheet_index_nonnegative
    CHECK (selected_sheet_index IS NULL OR selected_sheet_index >= 0),
  ADD CONSTRAINT import_batches_header_row_number_positive
    CHECK (header_row_number IS NULL OR header_row_number > 0),
  ADD CONSTRAINT import_batches_header_mode_valid
    CHECK (header_mode IS NULL OR header_mode IN ('detected', 'manual', 'none'));

CREATE INDEX IF NOT EXISTS import_batches_raw_file_hash_idx
  ON public.import_batches (raw_file_hash)
  WHERE raw_file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_batches_source_data_hash_idx
  ON public.import_batches (source_data_hash)
  WHERE source_data_hash IS NOT NULL;

CREATE TABLE public.import_staged_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  physical_row_number integer NOT NULL CHECK (physical_row_number > 0),
  raw_cells jsonb NOT NULL,
  source_columns jsonb NOT NULL,
  mapping jsonb NOT NULL,
  normalized_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT import_staged_rows_batch_physical_row_unique
    UNIQUE (batch_id, physical_row_number)
);

CREATE INDEX import_staged_rows_batch_idx ON public.import_staged_rows (batch_id);

CREATE FUNCTION public.protect_import_staged_source()
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
  THEN
    RAISE EXCEPTION 'Staged import source data is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_import_staged_source
BEFORE UPDATE ON public.import_staged_rows
FOR EACH ROW EXECUTE FUNCTION public.protect_import_staged_source();

ALTER TABLE public.import_staged_rows ENABLE ROW LEVEL SECURITY;

-- Raw uploads contain sensitive source data. Only signed-in active CRM staff may read or write it.
CREATE POLICY "Active staff can view import staged rows"
ON public.import_staged_rows FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'marketing')
  OR public.has_role(auth.uid(), 'va')
);

CREATE POLICY "Active staff can create import staged rows"
ON public.import_staged_rows FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'marketing')
  OR public.has_role(auth.uid(), 'va')
);

CREATE POLICY "Active staff can update import staged rows"
ON public.import_staged_rows FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'marketing')
  OR public.has_role(auth.uid(), 'va')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'marketing')
  OR public.has_role(auth.uid(), 'va')
);

CREATE POLICY "Active staff can delete import staged rows"
ON public.import_staged_rows FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'marketing')
  OR public.has_role(auth.uid(), 'va')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_staged_rows TO authenticated;
GRANT ALL ON public.import_staged_rows TO service_role;
REVOKE ALL ON FUNCTION public.protect_import_staged_source() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_import_staged_source() TO authenticated, service_role;

COMMENT ON TABLE public.import_staged_rows IS
  'Immutable source cells plus the mapping and normalized row used by an import batch.';
COMMENT ON COLUMN public.import_batches.raw_file_hash IS
  'SHA-256 of the uploaded file bytes.';
COMMENT ON COLUMN public.import_batches.source_data_hash IS
  'Order-independent SHA-256 of normalized worksheet names and cell data.';
