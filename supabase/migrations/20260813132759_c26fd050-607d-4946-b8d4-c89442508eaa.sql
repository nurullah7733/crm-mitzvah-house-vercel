ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS donations_event_id_idx ON public.donations(event_id);