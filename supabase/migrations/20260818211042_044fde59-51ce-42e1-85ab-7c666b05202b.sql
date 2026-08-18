CREATE TABLE public.app_error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'error' CHECK (level IN ('error','warning')),
  area text,
  action text,
  message text NOT NULL,
  detail text,
  path text,
  user_agent text,
  user_id uuid,
  user_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_error_log_occurred_at_idx ON public.app_error_log (occurred_at DESC);

GRANT SELECT ON public.app_error_log TO authenticated;
GRANT ALL ON public.app_error_log TO service_role;

ALTER TABLE public.app_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read the error log"
  ON public.app_error_log FOR SELECT TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.app_error_log IS 'Server-side record of failures staff hit in the app. Written only by the server (service_role); readable by admins.';

CREATE OR REPLACE FUNCTION public.cleanup_app_error_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.app_error_log WHERE occurred_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_app_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_app_error_log() TO service_role;