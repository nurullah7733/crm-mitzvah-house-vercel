ALTER TABLE public.people ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS mailing_preference text;

ALTER TABLE public.people DROP CONSTRAINT IF EXISTS people_gender_check;
ALTER TABLE public.people ADD CONSTRAINT people_gender_check CHECK (gender IS NULL OR gender IN ('male','female'));

ALTER TABLE public.people DROP CONSTRAINT IF EXISTS people_mailing_preference_check;
ALTER TABLE public.people ADD CONSTRAINT people_mailing_preference_check CHECK (mailing_preference IS NULL OR mailing_preference IN ('household','own'));