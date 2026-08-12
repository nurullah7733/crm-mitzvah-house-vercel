ALTER TABLE public.households ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS school text;