-- Manual comparison reuses Block 5B's activity/finalization implementation.
-- A PostgreSQL function call is one statement transaction: if the required
-- merge snapshot below fails, every write made by the nested core is rolled back.
CREATE OR REPLACE FUNCTION public.resolve_review_manual_merge(
  _item_id uuid,
  _person_id uuid,
  _person_patch jsonb DEFAULT '{}'::jsonb,
  _traceable_fields text[] DEFAULT '{}'::text[],
  _source text DEFAULT 'Import review',
  _batch_id uuid DEFAULT NULL,
  _event jsonb DEFAULT NULL,
  _donation jsonb DEFAULT NULL,
  _note jsonb DEFAULT NULL,
  _existing_before jsonb DEFAULT '{}'::jsonb,
  _incoming jsonb DEFAULT '{}'::jsonb,
  _surviving_after jsonb DEFAULT '{}'::jsonb,
  _choices jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- This core locks/validates the review and person, patches the person, records
  -- best-effort provenance, applies activity, and finalizes the review + audit.
  v_result := public.resolve_review_quick_merge(
    _item_id, _person_id, _person_patch, _traceable_fields, _source, _batch_id,
    _event, _donation, _note
  );

  -- Required manual-merge snapshot; deliberately outside any exception handler.
  PERFORM public.log_import_review_merge(
    _item_id, _person_id, _existing_before, _incoming, _surviving_after, _choices
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_review_manual_merge(
  uuid, uuid, jsonb, text[], text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_review_manual_merge(
  uuid, uuid, jsonb, text[], text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated, service_role;
