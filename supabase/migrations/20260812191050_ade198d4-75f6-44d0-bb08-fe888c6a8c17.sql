-- Campaigns
CREATE TABLE public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  goal_amount numeric,
  status text NOT NULL DEFAULT 'active',
  start_date date,
  end_date date,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_status_check CHECK (status IN ('planning','active','completed','archived'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Contact type support on people
ALTER TABLE public.people
  ADD COLUMN contact_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN display_name text,
  ADD COLUMN parent_org_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  ADD CONSTRAINT people_contact_type_check CHECK (contact_type IN ('individual','organization','foundation'));
ALTER TABLE public.people ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE public.people ALTER COLUMN last_name DROP NOT NULL;

UPDATE public.people
SET display_name = NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '');

CREATE OR REPLACE FUNCTION public.sync_person_display_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_type = 'individual' THEN
    NEW.display_name := NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');
  ELSIF NEW.display_name IS NULL OR TRIM(NEW.display_name) = '' THEN
    NEW.display_name := NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER people_sync_display_name
BEFORE INSERT OR UPDATE OF first_name, last_name, display_name, contact_type ON public.people
FOR EACH ROW EXECUTE FUNCTION public.sync_person_display_name();

CREATE INDEX idx_people_contact_type ON public.people(contact_type);
CREATE INDEX idx_people_parent_org_id ON public.people(parent_org_id);

-- Grants
CREATE TABLE public.grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  funder_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  program_officer_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  amount_requested numeric,
  amount_awarded numeric,
  stage text NOT NULL DEFAULT 'researching',
  application_deadline date,
  report_deadline date,
  renewal_deadline date,
  restricted_program text,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grants_stage_check CHECK (stage IN ('researching','loi_submitted','applied','awarded','declined','reporting_due','reported','renewal_eligible'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grants TO authenticated;
GRANT ALL ON public.grants TO service_role;
ALTER TABLE public.grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff full access" ON public.grants FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_grants_funder_id ON public.grants(funder_id);
CREATE INDEX idx_grants_stage ON public.grants(stage);

-- Donation links
ALTER TABLE public.donations
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN grant_id uuid REFERENCES public.grants(id) ON DELETE SET NULL;
CREATE INDEX idx_donations_campaign_id ON public.donations(campaign_id);
CREATE INDEX idx_donations_grant_id ON public.donations(grant_id);

-- Task link to grants (for deadline tasks later)
ALTER TABLE public.tasks
  ADD COLUMN grant_id uuid REFERENCES public.grants(id) ON DELETE CASCADE;
CREATE INDEX idx_tasks_grant_id ON public.tasks(grant_id);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_grants_updated_at BEFORE UPDATE ON public.grants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();