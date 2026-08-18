-- integration_credentials and integration_events are back-office tables that
-- hold secret provider credentials and sync logs. Every legitimate read/write
-- goes through SECURITY DEFINER functions or the trusted server-side role.
-- Make that intent explicit instead of relying on "no policies exist".

REVOKE ALL ON public.integration_credentials FROM anon, authenticated;
REVOKE ALL ON public.integration_events FROM anon, authenticated;
GRANT ALL ON public.integration_credentials TO service_role;
GRANT ALL ON public.integration_events TO service_role;

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to integration credentials" ON public.integration_credentials;
CREATE POLICY "No direct access to integration credentials"
  ON public.integration_credentials
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Trusted server role manages integration credentials" ON public.integration_credentials;
CREATE POLICY "Trusted server role manages integration credentials"
  ON public.integration_credentials
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "No direct access to integration events" ON public.integration_events;
CREATE POLICY "No direct access to integration events"
  ON public.integration_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Trusted server role manages integration events" ON public.integration_events;
CREATE POLICY "Trusted server role manages integration events"
  ON public.integration_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.integration_credentials IS
  'Provider credentials. No direct client access: reachable only through save/get/delete_integration_credentials or the trusted server role.';
COMMENT ON TABLE public.integration_events IS
  'Integration sync log. No direct client access: written and read only by trusted server-side code.';
