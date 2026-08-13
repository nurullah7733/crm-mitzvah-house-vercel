-- These are trigger functions: they only ever run automatically from the
-- tables they are attached to, so nothing should be able to call them
-- through the API. Match the lockdown every other trigger function here has.
REVOKE ALL ON FUNCTION public.donations_sync_timeline() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrations_sync_timeline() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.donations_sync_timeline() TO service_role;
GRANT EXECUTE ON FUNCTION public.registrations_sync_timeline() TO service_role;