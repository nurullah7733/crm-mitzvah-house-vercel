CREATE TABLE public.integration_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL UNIQUE,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.integration_credentials TO service_role;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only trusted server code (service role) may touch credentials.

CREATE TRIGGER update_integration_credentials_updated_at
BEFORE UPDATE ON public.integration_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.integration_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'test',
  ok boolean NOT NULL DEFAULT false,
  message text,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.integration_events TO service_role;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: surfaced to staff through a server function only.

CREATE INDEX integration_events_provider_created_idx ON public.integration_events (provider, created_at DESC);

CREATE OR REPLACE FUNCTION public.purge_old_audit_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  DELETE FROM public.audit_log WHERE created_at < now() - interval '2 months';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_audit_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_audit_log() TO authenticated;