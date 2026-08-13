-- Revoke EXECUTE from PUBLIC and anon on all SECURITY DEFINER functions in public schema
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- Trigger functions and internal helpers must not be directly callable by signed-in users
REVOKE ALL ON FUNCTION public.contact_methods_after_change() FROM authenticated;
REVOKE ALL ON FUNCTION public.donations_refresh_totals() FROM authenticated;
REVOKE ALL ON FUNCTION public.interactions_refresh_totals() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_admin_archive() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_admin_delete() FROM authenticated;
REVOKE ALL ON FUNCTION public.tasks_sync_thank_you() FROM authenticated;
REVOKE ALL ON FUNCTION public.record_audit() FROM authenticated;
REVOKE ALL ON FUNCTION public.recalc_person_totals(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.purge_audit_log_internal() FROM authenticated;
REVOKE ALL ON FUNCTION public.sync_primary_contact_method(uuid) FROM authenticated;