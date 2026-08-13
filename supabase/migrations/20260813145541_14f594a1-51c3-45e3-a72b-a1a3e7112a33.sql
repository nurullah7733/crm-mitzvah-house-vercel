ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_user_id_key ON public.staff_members(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_email_key ON public.staff_members(lower(email));