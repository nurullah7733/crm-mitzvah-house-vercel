REVOKE EXECUTE ON FUNCTION public.mark_thank_you_sent(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mark_thank_you_sent(uuid, boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_primary_contact_method(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sync_primary_contact_method(uuid) TO authenticated, service_role;