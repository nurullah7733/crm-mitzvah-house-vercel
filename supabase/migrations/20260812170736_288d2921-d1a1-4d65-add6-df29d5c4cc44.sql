CREATE TABLE public.connection_check (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, status TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now());
GRANT SELECT ON public.connection_check TO anon;
GRANT SELECT ON public.connection_check TO authenticated;
GRANT ALL ON public.connection_check TO service_role;
ALTER TABLE public.connection_check ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view connection check" ON public.connection_check FOR SELECT USING (true);
INSERT INTO public.connection_check (status) VALUES ('connected');