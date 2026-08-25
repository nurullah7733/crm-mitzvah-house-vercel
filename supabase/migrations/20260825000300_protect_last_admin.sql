-- Serialize protected statements before PostgreSQL takes the UPDATE/DELETE
-- statement through its row work and AFTER validation.
CREATE FUNCTION public.lock_effective_admin_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(684221, 1);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_effective_admin_changes()
  FROM PUBLIC, anon, authenticated;

-- Keep at least one login-capable administrator. This is enforced by triggers,
-- rather than RLS, so privileged/service_role writes cannot bypass it.
CREATE FUNCTION public.enforce_effective_admin_remains()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_count integer;
BEGIN
  SELECT count(DISTINCT u.id)
  INTO v_admin_count
  FROM auth.users u
  WHERE EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.staff_members sm
    WHERE sm.active
      AND sm.role = 'admin'
      AND (
        sm.user_id = u.id
        OR lower(sm.email) = lower(u.email)
      )
  );

  IF v_admin_count = 0 THEN
    RAISE EXCEPTION 'The last active administrator cannot be removed or demoted'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_effective_admin_remains()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS staff_members_last_admin_lock ON public.staff_members;
CREATE TRIGGER staff_members_last_admin_lock
BEFORE UPDATE OF role, active, user_id, email OR DELETE ON public.staff_members
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_effective_admin_changes();

DROP TRIGGER IF EXISTS staff_members_last_admin_guard ON public.staff_members;
CREATE TRIGGER staff_members_last_admin_guard
AFTER UPDATE OF role, active, user_id, email OR DELETE ON public.staff_members
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_effective_admin_remains();

DROP TRIGGER IF EXISTS user_roles_last_admin_lock ON public.user_roles;
CREATE TRIGGER user_roles_last_admin_lock
BEFORE UPDATE OF user_id, role OR DELETE ON public.user_roles
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_effective_admin_changes();

DROP TRIGGER IF EXISTS user_roles_last_admin_guard ON public.user_roles;
CREATE TRIGGER user_roles_last_admin_guard
AFTER UPDATE OF user_id, role OR DELETE ON public.user_roles
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_effective_admin_remains();

COMMENT ON FUNCTION public.enforce_effective_admin_remains() IS
  'Rejects staff/role mutations that would leave no login-capable admin.';

-- Database half of staff deactivation. Auth banning intentionally remains in
-- the server after this transaction commits successfully.
CREATE FUNCTION public.deactivate_staff_member(_staff_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id
  INTO v_user_id
  FROM public.staff_members
  WHERE id = _staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.staff_members
  SET active = false
  WHERE id = _staff_id;

  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id;
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_staff_member(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_staff_member(uuid)
  TO service_role;

COMMENT ON FUNCTION public.deactivate_staff_member(uuid) IS
  'Atomically deactivates a staff row and removes its roles. Internal service-role operation; Auth banning occurs afterward.';
