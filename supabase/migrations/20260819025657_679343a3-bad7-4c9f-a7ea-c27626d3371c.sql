CREATE TABLE public.activity_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_options TO authenticated;
GRANT ALL ON public.activity_options TO service_role;

ALTER TABLE public.activity_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in staff manage quick activities"
  ON public.activity_options FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO public.activity_options (label) VALUES
  ('Wrapped tefillin'),
  ('Dropped off Shabbat package'),
  ('Dropped off holiday package'),
  ('Dropped off meal');