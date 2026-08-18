-- Restoring has the same problem as archiving: the row being restored is
-- invisible to reads while deleted_at is set, so a plain UPDATE matches nothing.
CREATE OR REPLACE FUNCTION public.restore_records(_table text, _ids uuid[])
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
    RAISE EXCEPTION 'Records of this kind cannot be restored here';
  END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET deleted_at = NULL WHERE id = ANY($1) AND deleted_at IS NOT NULL',
    _table
  ) USING _ids;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_records(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_records(text, uuid[]) TO authenticated, service_role;