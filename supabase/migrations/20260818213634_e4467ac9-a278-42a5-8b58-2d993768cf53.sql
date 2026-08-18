REVOKE ALL ON FUNCTION public.donations_fill_fingerprint() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donations_sync_timeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.donations_fill_fingerprint() TO service_role;
GRANT EXECUTE ON FUNCTION public.donations_sync_timeline() TO service_role;