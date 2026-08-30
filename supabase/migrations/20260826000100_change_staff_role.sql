-- Keep the staff directory role and effective database role in sync. PostgreSQL
-- runs a function call in one transaction, so the existing last-admin triggers
-- roll the staff update back if removing the linked admin role is rejected.
CREATE FUNCTION public.change_staff_role(
  _staff_id uuid,
  _role public.app_role
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF _role NOT IN ('admin'::public.app_role, 'marketing'::public.app_role, 'va'::public.app_role) THEN
    RAISE EXCEPTION 'Invalid staff role' USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO v_user_id
  FROM public.staff_members
  WHERE id = _staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That staff member no longer exists' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.staff_members
  SET role = _role
  WHERE id = _staff_id;

  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, _role);
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.change_staff_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_staff_role(uuid, public.app_role)
  TO service_role;

COMMENT ON FUNCTION public.change_staff_role(uuid, public.app_role) IS
  'Atomically updates a staff row and its linked database role. Internal service-role operation.';
