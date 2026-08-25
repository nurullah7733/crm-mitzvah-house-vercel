-- Preserve the complete main-person/household/relative transaction as an
-- internal foundation, then compose required resolved activity around it.
ALTER FUNCTION public.resolve_import_row(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb
) RENAME TO resolve_import_row_foundation_core;

REVOKE ALL ON FUNCTION public.resolve_import_row_foundation_core(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_import_row_foundation_core(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb
) TO service_role;

CREATE FUNCTION public.resolve_import_row(
  _person jsonb,
  _household jsonb DEFAULT '{"action":"none"}'::jsonb,
  _contact_methods jsonb DEFAULT '[]'::jsonb,
  _labels jsonb DEFAULT '{}'::jsonb,
  _provenance jsonb DEFAULT '[]'::jsonb,
  _batch_id uuid DEFAULT NULL,
  _spouse jsonb DEFAULT '{"action":"skip"}'::jsonb,
  _children jsonb DEFAULT '[]'::jsonb,
  _activity jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_foundation jsonb;
  v_activity jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'marketing')
    OR public.has_role(auth.uid(), 'va')
  ) THEN
    RAISE EXCEPTION 'Active staff access required';
  END IF;

  v_foundation := public.resolve_import_row_foundation_core(
    _person,
    _household,
    _contact_methods,
    _labels,
    _provenance,
    _batch_id,
    _spouse,
    _children
  );

  -- All event/campaign/date/amount/fingerprint decisions are already resolved
  -- by the client. Pass every resolved registration through unchanged.
  v_activity := public.apply_import_activity_core(
    (v_foundation->>'person_id')::uuid,
    COALESCE(_activity->'registrations', '[]'::jsonb),
    NULLIF(_activity->'donation', 'null'::jsonb),
    NULLIF(_activity->'note', 'null'::jsonb),
    _batch_id
  );

  -- No exception boundary surrounds activity: any required activity failure
  -- aborts this statement and every foundation write made by the nested call.
  RETURN v_foundation || v_activity;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_import_row(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_import_row(
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) TO authenticated, service_role;
