-- Removed rows are invisible to reads now, which means an app UPDATE that sets
-- deleted_at can no longer see the row it just wrote back. Route archiving
-- through one function instead. The admin-only trigger still fires, so the
-- permission rule is unchanged.
CREATE OR REPLACE FUNCTION public.archive_records(_table text, _ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF _table NOT IN ('people', 'donations', 'events', 'tasks') THEN
    RAISE EXCEPTION 'Records of this kind cannot be archived here';
  END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now() WHERE id = ANY($1) AND deleted_at IS NULL',
    _table
  ) USING _ids;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_records(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_records(text, uuid[]) TO authenticated, service_role;