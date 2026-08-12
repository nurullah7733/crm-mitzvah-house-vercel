CREATE TYPE public.app_role AS ENUM ('admin','marketing','va');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated staff can read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'va',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_members TO authenticated;
GRANT ALL ON public.staff_members TO service_role;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.staff_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.program_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_options TO authenticated;
GRANT ALL ON public.program_options TO service_role;
ALTER TABLE public.program_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.program_options FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.tag_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tag_options TO authenticated;
GRANT ALL ON public.tag_options TO service_role;
ALTER TABLE public.tag_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.tag_options FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  purpose text,
  status text NOT NULL DEFAULT 'not_connected',
  last_sync_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.integrations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  import_date date NOT NULL DEFAULT CURRENT_DATE,
  uploaded_by text,
  total_rows integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  new_rows integer NOT NULL DEFAULT 0,
  ambiguous_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'imported',
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.import_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.import_batches(id) ON DELETE CASCADE,
  filename text,
  reason text NOT NULL,
  row_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_person_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_queue TO authenticated;
GRANT ALL ON public.review_queue TO service_role;
ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.review_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX review_queue_status_idx ON public.review_queue (status);

INSERT INTO public.program_options (label) VALUES
 ('Mitzvah Kitchen'),('Jewish Heritage Clubs'),('Shabbat programs'),('Hospital hospitality'),
 ('Mitzvah Bus'),('Chanukah events'),('Matzah campaign'),('Mezuzah campaign'),
 ('Volunteer opportunities'),('Community events'),('Fundraising');

INSERT INTO public.tag_options (label, category) VALUES
 ('Donor','general'),('Major donor','general'),('Volunteer','general'),('Board','general'),
 ('Newsletter','general'),('Do not email','general'),('Needs follow-up','general'),
 ('Shabbat regular','general'),('New contact','general'),('Lapsed','general');

INSERT INTO public.integrations (name, purpose, status, last_sync_at) VALUES
 ('Donorbox','Donations in','not_connected',NULL),
 ('Stripe','Donations in','not_connected',NULL),
 ('Constant Contact','Two-way email sync','not_connected',NULL),
 ('WordPress','Registrations in','not_connected',NULL),
 ('Cognito Forms','Registrations in','not_connected',NULL),
 ('QuickBooks','Bookkeeping out','not_connected',NULL),
 ('Salesforce','One-time historical import','not_connected',NULL),
 ('CSV / Excel / Google Sheets','Import and export','connected',now());
