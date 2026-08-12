-- HOUSEHOLDS
CREATE TABLE public.households (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- PEOPLE
CREATE TABLE public.people (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  household_id UUID REFERENCES public.households(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'Adult' CHECK (role IN ('Adult','Child')),
  birth_date DATE,
  owner TEXT,
  lifetime_giving NUMERIC(12,2) NOT NULL DEFAULT 0,
  this_year_giving NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_gift_amount NUMERIC(12,2),
  last_gift_date DATE,
  last_activity_date DATE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  programs TEXT[] NOT NULL DEFAULT '{}',
  met_source TEXT,
  met_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX people_household_id_idx ON public.people(household_id);
CREATE INDEX people_last_name_idx ON public.people(last_name);

-- DONATIONS
CREATE TABLE public.donations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  campaign TEXT,
  method TEXT,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX donations_person_id_idx ON public.donations(person_id);
CREATE INDEX donations_date_idx ON public.donations(date DESC);

-- EVENTS
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME,
  location TEXT,
  program TEXT,
  capacity INTEGER,
  staff_lead TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX events_date_idx ON public.events(date DESC);

-- REGISTRATIONS
CREATE TABLE public.registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','attended','no_show')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (event_id, person_id)
);
CREATE INDEX registrations_person_id_idx ON public.registrations(person_id);

-- INTERACTIONS
CREATE TABLE public.interactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note','call','donation','event','volunteer','form')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  text TEXT,
  author TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX interactions_person_id_date_idx ON public.interactions(person_id, date DESC);

-- TASKS
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID REFERENCES public.people(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  due_date DATE,
  owner TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','overdue','done')),
  completion_note TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX tasks_person_id_idx ON public.tasks(person_id);

-- YAHRZEITS
CREATE TABLE public.yahrzeits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  deceased_name TEXT NOT NULL,
  relationship TEXT,
  hebrew_month INTEGER NOT NULL CHECK (hebrew_month BETWEEN 1 AND 13),
  hebrew_day INTEGER NOT NULL CHECK (hebrew_day BETWEEN 1 AND 30),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX yahrzeits_person_id_idx ON public.yahrzeits(person_id);

-- FIELD SOURCES
CREATE TABLE public.field_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  source TEXT NOT NULL,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX field_sources_person_field_idx ON public.field_sources(person_id, field_name);

-- MET SOURCE OPTIONS
CREATE TABLE public.met_source_options (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- GRANTS (staff-only tool: authenticated staff get full access, no anon access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yahrzeits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.met_source_options TO authenticated;
GRANT ALL ON public.households TO service_role;
GRANT ALL ON public.people TO service_role;
GRANT ALL ON public.donations TO service_role;
GRANT ALL ON public.events TO service_role;
GRANT ALL ON public.registrations TO service_role;
GRANT ALL ON public.interactions TO service_role;
GRANT ALL ON public.tasks TO service_role;
GRANT ALL ON public.yahrzeits TO service_role;
GRANT ALL ON public.field_sources TO service_role;
GRANT ALL ON public.met_source_options TO service_role;

-- RLS
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yahrzeits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.met_source_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff full access" ON public.households FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.people FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.donations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.registrations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.interactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.yahrzeits FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.field_sources FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff full access" ON public.met_source_options FOR ALL TO authenticated USING (true) WITH CHECK (true);