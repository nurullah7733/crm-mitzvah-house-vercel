ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
UPDATE public.tasks SET completed_at = created_at WHERE status = 'done' AND completed_at IS NULL;