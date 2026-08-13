-- Mitzvah House CRM — complete public-schema export
-- Generated 2026-08-13 00:47 UTC from the live database catalogs (Supabase/Postgres).
-- Run top to bottom on an empty Postgres 15+/Supabase database to recreate the schema.
-- Contains NO data and NO secrets. auth/storage schemas are Supabase-managed and not included.

-- ======================================================================
-- EXTENSIONS
-- ======================================================================
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ======================================================================
-- ENUM TYPES
-- ======================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'marketing', 'va');

-- ======================================================================
-- TABLES
-- ======================================================================
CREATE TABLE public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  actor_id uuid,
  actor_email text,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  goal_amount numeric,
  status text DEFAULT 'active'::text NOT NULL,
  start_date date,
  end_date date,
  event_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.donations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  date date DEFAULT CURRENT_DATE NOT NULL,
  campaign text,
  method text,
  source text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  campaign_id uuid,
  grant_id uuid,
  import_batch_id uuid,
  deleted_at timestamp with time zone
);

CREATE TABLE public.events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  date date NOT NULL,
  "time" time without time zone,
  location text,
  program text,
  capacity integer,
  staff_lead text,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone
);

CREATE TABLE public.field_sources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid NOT NULL,
  field_name text NOT NULL,
  source text NOT NULL,
  recorded_date date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  import_batch_id uuid
);

CREATE TABLE public.grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  funder_id uuid NOT NULL,
  program_officer_id uuid,
  amount_requested numeric,
  amount_awarded numeric,
  stage text DEFAULT 'researching'::text NOT NULL,
  application_deadline date,
  report_deadline date,
  renewal_deadline date,
  restricted_program text,
  campaign_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.households (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  address text,
  phone text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  import_batch_id uuid,
  billing_address text,
  address_line2 text,
  address_line3 text,
  city text,
  state text,
  postal_code text,
  county text
);

CREATE TABLE public.import_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  filename text NOT NULL,
  import_date date DEFAULT CURRENT_DATE NOT NULL,
  uploaded_by text,
  total_rows integer DEFAULT 0 NOT NULL,
  matched_rows integer DEFAULT 0 NOT NULL,
  new_rows integer DEFAULT 0 NOT NULL,
  ambiguous_rows integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'imported'::text NOT NULL,
  mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_credentials (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  credentials jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integration_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  kind text DEFAULT 'test'::text NOT NULL,
  ok boolean DEFAULT false NOT NULL,
  message text,
  actor_email text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  purpose text,
  status text DEFAULT 'not_connected'::text NOT NULL,
  last_sync_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.interactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid NOT NULL,
  type text NOT NULL,
  date date DEFAULT CURRENT_DATE NOT NULL,
  text text,
  author text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  import_batch_id uuid
);

CREATE TABLE public.merge_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  surviving_person_id uuid,
  merged_person_id uuid NOT NULL,
  merged_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  performed_by uuid,
  performed_by_email text,
  moved_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.met_source_options (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.people (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  first_name text,
  last_name text,
  phone text,
  email text,
  household_id uuid,
  role text DEFAULT 'Adult'::text NOT NULL,
  birth_date date,
  owner text,
  lifetime_giving numeric(12,2) DEFAULT 0 NOT NULL,
  this_year_giving numeric(12,2) DEFAULT 0 NOT NULL,
  last_gift_amount numeric(12,2),
  last_gift_date date,
  last_activity_date date,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  programs text[] DEFAULT '{}'::text[] NOT NULL,
  met_source text,
  met_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_type text DEFAULT 'individual'::text NOT NULL,
  display_name text,
  parent_org_id uuid,
  import_batch_id uuid,
  deleted_at timestamp with time zone,
  notes text,
  school text,
  anniversary_date date
);

CREATE TABLE public.program_options (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  status text DEFAULT 'registered'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.review_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid,
  filename text,
  reason text NOT NULL,
  row_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  candidate_person_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  resolution_note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.staff_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  role app_role DEFAULT 'va'::app_role NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tag_options (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  category text DEFAULT 'general'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid,
  text text NOT NULL,
  due_date date,
  owner text,
  priority text,
  status text DEFAULT 'upcoming'::text NOT NULL,
  completion_note text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  grant_id uuid,
  completed_at timestamp with time zone,
  deleted_at timestamp with time zone
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.yahrzeits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid NOT NULL,
  deceased_name text NOT NULL,
  relationship text,
  hebrew_month integer NOT NULL,
  hebrew_day integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ======================================================================
-- PRIMARY KEYS / UNIQUE / CHECK / FOREIGN KEYS
-- ======================================================================
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);
ALTER TABLE public.donations ADD CONSTRAINT donations_pkey PRIMARY KEY (id);
ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
ALTER TABLE public.field_sources ADD CONSTRAINT field_sources_pkey PRIMARY KEY (id);
ALTER TABLE public.grants ADD CONSTRAINT grants_pkey PRIMARY KEY (id);
ALTER TABLE public.households ADD CONSTRAINT households_pkey PRIMARY KEY (id);
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);
ALTER TABLE public.integration_credentials ADD CONSTRAINT integration_credentials_pkey PRIMARY KEY (id);
ALTER TABLE public.integration_events ADD CONSTRAINT integration_events_pkey PRIMARY KEY (id);
ALTER TABLE public.integrations ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);
ALTER TABLE public.interactions ADD CONSTRAINT interactions_pkey PRIMARY KEY (id);
ALTER TABLE public.merge_log ADD CONSTRAINT merge_log_pkey PRIMARY KEY (id);
ALTER TABLE public.met_source_options ADD CONSTRAINT met_source_options_pkey PRIMARY KEY (id);
ALTER TABLE public.people ADD CONSTRAINT people_pkey PRIMARY KEY (id);
ALTER TABLE public.program_options ADD CONSTRAINT program_options_pkey PRIMARY KEY (id);
ALTER TABLE public.registrations ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);
ALTER TABLE public.review_queue ADD CONSTRAINT review_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_pkey PRIMARY KEY (id);
ALTER TABLE public.tag_options ADD CONSTRAINT tag_options_pkey PRIMARY KEY (id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.yahrzeits ADD CONSTRAINT yahrzeits_pkey PRIMARY KEY (id);
ALTER TABLE public.integration_credentials ADD CONSTRAINT integration_credentials_provider_key UNIQUE (provider);
ALTER TABLE public.met_source_options ADD CONSTRAINT met_source_options_label_key UNIQUE (label);
ALTER TABLE public.registrations ADD CONSTRAINT registrations_event_id_person_id_key UNIQUE (event_id, person_id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'active'::text, 'completed'::text, 'archived'::text])));
ALTER TABLE public.grants ADD CONSTRAINT grants_stage_check CHECK ((stage = ANY (ARRAY['researching'::text, 'loi_submitted'::text, 'applied'::text, 'awarded'::text, 'declined'::text, 'reporting_due'::text, 'reported'::text, 'renewal_eligible'::text])));
ALTER TABLE public.interactions ADD CONSTRAINT interactions_type_check CHECK ((type = ANY (ARRAY['note'::text, 'call'::text, 'donation'::text, 'event'::text, 'volunteer'::text, 'form'::text])));
ALTER TABLE public.people ADD CONSTRAINT people_contact_type_check CHECK ((contact_type = ANY (ARRAY['individual'::text, 'organization'::text, 'foundation'::text])));
ALTER TABLE public.people ADD CONSTRAINT people_role_check CHECK ((role = ANY (ARRAY['Adult'::text, 'Child'::text])));
ALTER TABLE public.registrations ADD CONSTRAINT registrations_status_check CHECK ((status = ANY (ARRAY['registered'::text, 'attended'::text, 'no_show'::text])));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'overdue'::text, 'done'::text])));
ALTER TABLE public.yahrzeits ADD CONSTRAINT yahrzeits_hebrew_day_check CHECK (((hebrew_day >= 1) AND (hebrew_day <= 30)));
ALTER TABLE public.yahrzeits ADD CONSTRAINT yahrzeits_hebrew_month_check CHECK (((hebrew_month >= 1) AND (hebrew_month <= 13)));
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE public.donations ADD CONSTRAINT donations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.donations ADD CONSTRAINT donations_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE SET NULL;
ALTER TABLE public.donations ADD CONSTRAINT donations_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.donations ADD CONSTRAINT donations_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE public.field_sources ADD CONSTRAINT field_sources_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.field_sources ADD CONSTRAINT field_sources_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE public.grants ADD CONSTRAINT grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.grants ADD CONSTRAINT grants_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES people(id) ON DELETE RESTRICT;
ALTER TABLE public.grants ADD CONSTRAINT grants_program_officer_id_fkey FOREIGN KEY (program_officer_id) REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE public.households ADD CONSTRAINT households_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE public.merge_log ADD CONSTRAINT merge_log_surviving_person_id_fkey FOREIGN KEY (surviving_person_id) REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE public.people ADD CONSTRAINT people_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL;
ALTER TABLE public.people ADD CONSTRAINT people_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.people ADD CONSTRAINT people_parent_org_id_fkey FOREIGN KEY (parent_org_id) REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE public.review_queue ADD CONSTRAINT review_queue_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.yahrzeits ADD CONSTRAINT yahrzeits_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;

-- ======================================================================
-- INDEXES (constraint-backed indexes omitted)
-- ======================================================================
CREATE INDEX audit_log_created_idx ON public.audit_log USING btree (created_at DESC);
CREATE INDEX audit_log_record_idx ON public.audit_log USING btree (table_name, record_id, created_at DESC);
CREATE INDEX campaigns_name_trgm ON public.campaigns USING gin (lower(COALESCE(name, ''::text)) gin_trgm_ops);
CREATE INDEX donations_campaign_id_idx ON public.donations USING btree (campaign_id);
CREATE INDEX donations_date_idx ON public.donations USING btree (date DESC);
CREATE INDEX donations_grant_id_idx ON public.donations USING btree (grant_id);
CREATE INDEX donations_import_batch_idx ON public.donations USING btree (import_batch_id);
CREATE INDEX donations_not_deleted_idx ON public.donations USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX donations_person_id_idx ON public.donations USING btree (person_id);
CREATE INDEX idx_donations_campaign_id ON public.donations USING btree (campaign_id);
CREATE INDEX idx_donations_grant_id ON public.donations USING btree (grant_id);
CREATE INDEX events_date_idx ON public.events USING btree (date DESC);
CREATE INDEX events_name_trgm ON public.events USING gin (lower(COALESCE(name, ''::text)) gin_trgm_ops);
CREATE INDEX events_not_deleted_idx ON public.events USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX field_sources_import_batch_idx ON public.field_sources USING btree (import_batch_id);
CREATE INDEX field_sources_person_field_idx ON public.field_sources USING btree (person_id, field_name);
CREATE INDEX field_sources_person_id_idx ON public.field_sources USING btree (person_id, field_name);
CREATE INDEX grants_application_deadline_idx ON public.grants USING btree (application_deadline);
CREATE INDEX grants_campaign_id_idx ON public.grants USING btree (campaign_id);
CREATE INDEX grants_funder_id_idx ON public.grants USING btree (funder_id);
CREATE INDEX grants_name_trgm ON public.grants USING gin (lower(COALESCE(name, ''::text)) gin_trgm_ops);
CREATE INDEX grants_report_deadline_idx ON public.grants USING btree (report_deadline);
CREATE INDEX grants_stage_idx ON public.grants USING btree (stage);
CREATE INDEX idx_grants_funder_id ON public.grants USING btree (funder_id);
CREATE INDEX idx_grants_stage ON public.grants USING btree (stage);
CREATE INDEX households_address_trgm ON public.households USING gin (lower(COALESCE(address, ''::text)) gin_trgm_ops);
CREATE INDEX households_import_batch_idx ON public.households USING btree (import_batch_id);
CREATE INDEX households_name_trgm ON public.households USING gin (lower(COALESCE(name, ''::text)) gin_trgm_ops);
CREATE INDEX integration_events_provider_created_idx ON public.integration_events USING btree (provider, created_at DESC);
CREATE INDEX interactions_import_batch_idx ON public.interactions USING btree (import_batch_id);
CREATE INDEX interactions_person_id_date_idx ON public.interactions USING btree (person_id, date DESC);
CREATE INDEX interactions_person_id_idx ON public.interactions USING btree (person_id, date DESC);
CREATE INDEX interactions_text_trgm ON public.interactions USING gin (lower(COALESCE(text, ''::text)) gin_trgm_ops);
CREATE INDEX idx_people_contact_type ON public.people USING btree (contact_type);
CREATE INDEX idx_people_parent_org_id ON public.people USING btree (parent_org_id);
CREATE INDEX people_birth_date_idx ON public.people USING btree (birth_date);
CREATE INDEX people_contact_type_idx ON public.people USING btree (contact_type);
CREATE INDEX people_display_name_idx ON public.people USING btree (lower(display_name));
CREATE INDEX people_display_name_trgm ON public.people USING gin (lower(COALESCE(display_name, ''::text)) gin_trgm_ops);
CREATE INDEX people_email_idx ON public.people USING btree (lower(email));
CREATE INDEX people_email_trgm ON public.people USING gin (lower(COALESCE(email, ''::text)) gin_trgm_ops);
CREATE INDEX people_first_name_trgm ON public.people USING gin (lower(COALESCE(first_name, ''::text)) gin_trgm_ops);
CREATE INDEX people_household_id_idx ON public.people USING btree (household_id);
CREATE INDEX people_import_batch_idx ON public.people USING btree (import_batch_id);
CREATE INDEX people_last_activity_date_idx ON public.people USING btree (last_activity_date);
CREATE INDEX people_last_name_idx ON public.people USING btree (last_name);
CREATE INDEX people_last_name_trgm ON public.people USING gin (lower(COALESCE(last_name, ''::text)) gin_trgm_ops);
CREATE INDEX people_not_deleted_idx ON public.people USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX people_parent_org_id_idx ON public.people USING btree (parent_org_id);
CREATE INDEX people_phone_idx ON public.people USING btree (phone);
CREATE INDEX people_programs_gin ON public.people USING gin (programs);
CREATE INDEX people_tags_gin ON public.people USING gin (tags);
CREATE INDEX registrations_event_id_idx ON public.registrations USING btree (event_id);
CREATE INDEX registrations_person_id_idx ON public.registrations USING btree (person_id);
CREATE INDEX review_queue_status_idx ON public.review_queue USING btree (status);
CREATE INDEX idx_tasks_grant_id ON public.tasks USING btree (grant_id);
CREATE INDEX tasks_completed_at_idx ON public.tasks USING btree (completed_at DESC);
CREATE INDEX tasks_not_deleted_idx ON public.tasks USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX tasks_person_id_idx ON public.tasks USING btree (person_id);
CREATE INDEX tasks_status_due_idx ON public.tasks USING btree (status, due_date);
CREATE INDEX tasks_text_trgm ON public.tasks USING gin (lower(COALESCE(text, ''::text)) gin_trgm_ops);
CREATE INDEX yahrzeits_person_id_idx ON public.yahrzeits USING btree (person_id);

-- ======================================================================
-- DATA API GRANTS
-- NOTE: `anon` currently holds table-level grants on every table. Nothing is
-- actually readable by anon because every policy is scoped `TO authenticated`,
-- but the grants are wider than they need to be (see known-issues.md).
-- ======================================================================
GRANT SELECT, DELETE, UPDATE, INSERT ON public.audit_log TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.audit_log TO authenticated;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.audit_log TO service_role;
GRANT SELECT, INSERT, DELETE, UPDATE ON public.campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO service_role;
GRANT DELETE, SELECT, UPDATE, INSERT ON public.donations TO anon;
GRANT DELETE, INSERT, UPDATE, SELECT ON public.donations TO authenticated;
GRANT INSERT, DELETE, UPDATE, SELECT ON public.donations TO service_role;
GRANT UPDATE, SELECT, DELETE, INSERT ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.events TO service_role;
GRANT DELETE, SELECT, INSERT, UPDATE ON public.field_sources TO anon;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.field_sources TO authenticated;
GRANT INSERT, UPDATE, SELECT, DELETE ON public.field_sources TO service_role;
GRANT INSERT, UPDATE, SELECT, DELETE ON public.grants TO anon;
GRANT UPDATE, SELECT, INSERT, DELETE ON public.grants TO authenticated;
GRANT UPDATE, SELECT, DELETE, INSERT ON public.grants TO service_role;
GRANT UPDATE, INSERT, SELECT, DELETE ON public.households TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.import_batches TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT DELETE, SELECT, INSERT, UPDATE ON public.import_batches TO service_role;
GRANT UPDATE, SELECT, INSERT, DELETE ON public.integration_credentials TO anon;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.integration_credentials TO authenticated;
GRANT SELECT, INSERT, DELETE, UPDATE ON public.integration_credentials TO service_role;
GRANT UPDATE, DELETE, INSERT, SELECT ON public.integration_events TO anon;
GRANT INSERT, UPDATE, SELECT, DELETE ON public.integration_events TO authenticated;
GRANT SELECT, UPDATE, INSERT, DELETE ON public.integration_events TO service_role;
GRANT SELECT, DELETE, INSERT, UPDATE ON public.integrations TO anon;
GRANT INSERT, DELETE, SELECT, UPDATE ON public.integrations TO authenticated;
GRANT UPDATE, DELETE, INSERT, SELECT ON public.integrations TO service_role;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.interactions TO anon;
GRANT SELECT, DELETE, UPDATE, INSERT ON public.interactions TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.interactions TO service_role;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.merge_log TO anon;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.merge_log TO authenticated;
GRANT UPDATE, SELECT, INSERT, DELETE ON public.merge_log TO service_role;
GRANT DELETE, SELECT, UPDATE, INSERT ON public.met_source_options TO anon;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.met_source_options TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.met_source_options TO service_role;
GRANT INSERT, UPDATE, SELECT, DELETE ON public.people TO anon;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.people TO authenticated;
GRANT DELETE, SELECT, INSERT, UPDATE ON public.people TO service_role;
GRANT SELECT, DELETE, UPDATE, INSERT ON public.program_options TO anon;
GRANT UPDATE, DELETE, SELECT, INSERT ON public.program_options TO authenticated;
GRANT UPDATE, SELECT, INSERT, DELETE ON public.program_options TO service_role;
GRANT SELECT, DELETE, UPDATE, INSERT ON public.registrations TO anon;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.registrations TO authenticated;
GRANT SELECT, INSERT, DELETE, UPDATE ON public.registrations TO service_role;
GRANT SELECT, UPDATE, INSERT, DELETE ON public.review_queue TO anon;
GRANT INSERT, SELECT, DELETE, UPDATE ON public.review_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_queue TO service_role;
GRANT INSERT, SELECT, DELETE, UPDATE ON public.staff_members TO anon;
GRANT SELECT, DELETE, INSERT, UPDATE ON public.staff_members TO authenticated;
GRANT UPDATE, INSERT, DELETE, SELECT ON public.staff_members TO service_role;
GRANT UPDATE, INSERT, SELECT, DELETE ON public.tag_options TO anon;
GRANT INSERT, UPDATE, DELETE, SELECT ON public.tag_options TO authenticated;
GRANT DELETE, SELECT, UPDATE, INSERT ON public.tag_options TO service_role;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.tasks TO anon;
GRANT SELECT, UPDATE, DELETE, INSERT ON public.tasks TO authenticated;
GRANT UPDATE, SELECT, INSERT, DELETE ON public.tasks TO service_role;
GRANT DELETE, SELECT, INSERT, UPDATE ON public.user_roles TO anon;
GRANT SELECT, DELETE, UPDATE, INSERT ON public.user_roles TO authenticated;
GRANT UPDATE, INSERT, SELECT, DELETE ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yahrzeits TO anon;
GRANT SELECT, DELETE, UPDATE, INSERT ON public.yahrzeits TO authenticated;
GRANT INSERT, UPDATE, SELECT, DELETE ON public.yahrzeits TO service_role;

-- ======================================================================
-- ROW LEVEL SECURITY — enable
-- ======================================================================
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.met_source_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yahrzeits ENABLE ROW LEVEL SECURITY;

-- ======================================================================
-- ROW LEVEL SECURITY — policies (verbatim)
-- ======================================================================
CREATE POLICY 'Staff can read the change history' ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY 'Staff full access' ON public.campaigns AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.donations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.events AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.field_sources AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.grants AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.households AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.import_batches AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.integrations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.interactions AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff can read merge log' ON public.merge_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY 'Staff full access' ON public.met_source_options AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.people AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.program_options AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.registrations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.review_queue AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.staff_members AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.tag_options AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Staff full access' ON public.tasks AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY 'Authenticated staff can read roles' ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY 'Staff full access' ON public.yahrzeits AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ======================================================================
-- FUNCTIONS (project-owned; extension functions omitted)
-- ======================================================================
CREATE OR REPLACE FUNCTION public.donations_refresh_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_duplicate_people()
 RETURNS TABLE(person_a uuid, person_b uuid, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT id, LOWER(TRIM(email)) AS email,
           RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 10) AS phone,
           LOWER(TRIM(COALESCE(display_name, CONCAT_WS(' ', first_name, last_name)))) AS name,
           household_id, created_at
      FROM public.people
     WHERE deleted_at IS NULL
  ),
  pairs AS (
    SELECT a.id AS person_a, b.id AS person_b, 'Same email address' AS reason
      FROM live a JOIN live b ON a.email = b.email AND a.created_at < b.created_at
     WHERE COALESCE(a.email, '') <> ''
    UNION ALL
    SELECT a.id, b.id, 'Same phone number'
      FROM live a JOIN live b ON a.phone = b.phone AND a.created_at < b.created_at
     WHERE LENGTH(a.phone) >= 7
    UNION ALL
    SELECT a.id, b.id, 'Same name in the same household'
      FROM live a JOIN live b
        ON a.name = b.name AND a.household_id IS NOT DISTINCT FROM b.household_id
       AND a.created_at < b.created_at
     WHERE COALESCE(a.name, '') <> '' AND a.household_id IS NOT NULL
  )
  SELECT person_a, person_b, MIN(reason) AS reason
    FROM pairs
   GROUP BY person_a, person_b
   LIMIT 200
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$
;

CREATE OR REPLACE FUNCTION public.interactions_refresh_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _person_id, 'review_merged', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object(
      'review_item_id', _item_id,
      'existing_before', _existing_before,
      'incoming_row', _incoming,
      'surviving_after', _surviving_after,
      'field_choices', _choices
    ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_review_decision(_item_id uuid, _decision text, _reason text DEFAULT NULL::text, _person_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _decision NOT IN ('merged', 'edited', 'kept_both', 'discarded', 'created') THEN
    RAISE EXCEPTION 'Unknown review decision';
  END IF;
  IF _decision = 'discarded' AND COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a short reason for discarding this row';
  END IF;

  SELECT to_jsonb(r) INTO v_row FROM public.review_queue r WHERE id = _item_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'That review item no longer exists'; END IF;

  v_status := CASE WHEN _decision = 'discarded' THEN 'dismissed' ELSE 'resolved' END;

  UPDATE public.review_queue
     SET status = v_status,
         resolution_note = COALESCE(NULLIF(TRIM(_reason), ''), _decision)
   WHERE id = _item_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('review_queue', _item_id, 'review_' || _decision, auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object('reason', _reason, 'person_id', _person_id, 'queued_row', v_row));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_surviving_before jsonb;
  v_surviving_after jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different contacts to merge';
  END IF;

  SELECT to_jsonb(p) INTO v_snapshot FROM public.people p WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Contact to merge no longer exists'; END IF;
  SELECT to_jsonb(p) INTO v_surviving_before FROM public.people p WHERE id = _surviving_id;
  IF v_surviving_before IS NULL THEN
    RAISE EXCEPTION 'Surviving contact no longer exists';
  END IF;

  UPDATE public.donations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('donations', v_n);

  UPDATE public.interactions SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('interactions', v_n);

  DELETE FROM public.registrations r
   WHERE r.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.registrations s
                  WHERE s.person_id = _surviving_id AND s.event_id = r.event_id);
  UPDATE public.registrations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations', v_n);

  UPDATE public.tasks SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);

  UPDATE public.field_sources SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('field_sources', v_n);

  UPDATE public.yahrzeits SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('yahrzeits', v_n);

  UPDATE public.grants SET funder_id = _surviving_id WHERE funder_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_funder', v_n);

  UPDATE public.grants SET program_officer_id = _surviving_id WHERE program_officer_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('grants_officer', v_n);

  UPDATE public.people SET parent_org_id = _surviving_id WHERE parent_org_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('child_contacts', v_n);

  IF _field_values IS NOT NULL AND _field_values <> '{}'::jsonb THEN
    UPDATE public.people p SET
      first_name    = COALESCE(_field_values->>'first_name', p.first_name),
      last_name     = COALESCE(_field_values->>'last_name', p.last_name),
      display_name  = COALESCE(_field_values->>'display_name', p.display_name),
      email         = COALESCE(_field_values->>'email', p.email),
      phone         = COALESCE(_field_values->>'phone', p.phone),
      role          = COALESCE(_field_values->>'role', p.role),
      contact_type  = COALESCE(_field_values->>'contact_type', p.contact_type),
      owner         = COALESCE(_field_values->>'owner', p.owner),
      met_source    = COALESCE(_field_values->>'met_source', p.met_source),
      notes         = COALESCE(_field_values->>'notes', p.notes),
      school        = COALESCE(_field_values->>'school', p.school),
      met_date      = COALESCE((_field_values->>'met_date')::date, p.met_date),
      birth_date    = COALESCE((_field_values->>'birth_date')::date, p.birth_date),
      anniversary_date = COALESCE((_field_values->>'anniversary_date')::date, p.anniversary_date),
      household_id  = COALESCE((_field_values->>'household_id')::uuid, p.household_id),
      tags          = CASE WHEN _field_values ? 'tags'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'tags'))
                           ELSE p.tags END,
      programs      = CASE WHEN _field_values ? 'programs'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'programs'))
                           ELSE p.programs END
    WHERE p.id = _surviving_id;
  END IF;

  DELETE FROM public.people WHERE id = _merged_id;

  PERFORM public.recalc_person_totals(_surviving_id);

  SELECT to_jsonb(p) INTO v_surviving_after FROM public.people p WHERE id = _surviving_id;

  INSERT INTO public.merge_log (surviving_person_id, merged_person_id, merged_snapshot, performed_by, performed_by_email, moved_counts)
  VALUES (_surviving_id, _merged_id, v_snapshot, auth.uid(), NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), v_counts);

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _surviving_id, 'merged', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object(
      'surviving_before', v_surviving_before,
      'surviving_after', v_surviving_after,
      'merged_away', v_snapshot,
      'moved_counts', v_counts));

  RETURN _surviving_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_old_audit_log()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  DELETE FROM public.audit_log WHERE created_at < now() - interval '2 months';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_person_totals(_person_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lifetime numeric := 0;
  v_year numeric := 0;
  v_last_amount numeric;
  v_last_date date;
  v_last_interaction date;
BEGIN
  IF _person_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0),
         COALESCE(SUM(amount) FILTER (WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0),
         MAX(date)
    INTO v_lifetime, v_year, v_last_date
    FROM public.donations
   WHERE person_id = _person_id;

  IF v_last_date IS NOT NULL THEN
    SELECT amount INTO v_last_amount
      FROM public.donations
     WHERE person_id = _person_id AND date = v_last_date
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  SELECT MAX(date) INTO v_last_interaction
    FROM public.interactions
   WHERE person_id = _person_id;

  UPDATE public.people
     SET lifetime_giving = v_lifetime,
         this_year_giving = v_year,
         last_gift_amount = v_last_amount,
         last_gift_date = v_last_date,
         last_activity_date = GREATEST(COALESCE(v_last_date, v_last_interaction), COALESCE(v_last_interaction, v_last_date))
   WHERE id = _person_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_all_giving_totals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can recalculate totals';
  END IF;

  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _changes jsonb := '{}'::jsonb;
  _key text;
  _action text;
  _record_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _action := 'created';
    _record_id := NEW.id;
    _changes := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    _record_id := NEW.id;
    IF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      _action := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      _action := 'restored';
    ELSE
      _action := 'edited';
    END IF;
    FOR _key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF to_jsonb(NEW) -> _key IS DISTINCT FROM to_jsonb(OLD) -> _key THEN
        _changes := _changes || jsonb_build_object(
          _key, jsonb_build_object('from', to_jsonb(OLD) -> _key, 'to', to_jsonb(NEW) -> _key)
        );
      END IF;
    END LOOP;
  ELSE
    _action := 'removed';
    _record_id := OLD.id;
    _changes := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES (
    TG_TABLE_NAME,
    _record_id,
    _action,
    auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    _changes
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_people(_q text, _limit integer DEFAULT 200)
 RETURNS TABLE(person_id uuid, reason text, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH q AS (SELECT lower(trim(coalesce(_q, ''))) AS t),
src AS (
  SELECT p.id, 'Name' AS k,
         coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name)) AS lbl,
         concat_ws(' ', p.display_name, p.first_name, p.last_name) AS txt
    FROM public.people p WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Email', p.email, p.email FROM public.people p
   WHERE p.deleted_at IS NULL AND p.email IS NOT NULL
  UNION ALL
  SELECT p.id, 'Phone', p.phone, p.phone FROM public.people p
   WHERE p.deleted_at IS NULL AND p.phone IS NOT NULL
  UNION ALL
  SELECT p.id, 'Tag', tg, tg FROM public.people p, unnest(p.tags) tg WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Program', pr, pr FROM public.people p, unnest(p.programs) pr WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT p.id, 'Where we met', p.met_source, p.met_source FROM public.people p
   WHERE p.deleted_at IS NULL AND p.met_source IS NOT NULL
  UNION ALL
  SELECT p.id, 'School', p.school, p.school FROM public.people p
   WHERE p.deleted_at IS NULL AND p.school IS NOT NULL
  UNION ALL
  SELECT p.id, 'Household', h.name,
         concat_ws(' ', h.name, h.address, h.address_line2, h.city, h.state, h.postal_code, h.county)
    FROM public.people p JOIN public.households h ON h.id = p.household_id
   WHERE p.deleted_at IS NULL
  UNION ALL
  SELECT r.person_id, 'Attended', e.name, e.name
    FROM public.registrations r JOIN public.events e ON e.id = r.event_id
   WHERE e.deleted_at IS NULL
  UNION ALL
  SELECT d.person_id, 'Campaign', c.name, c.name
    FROM public.donations d JOIN public.campaigns c ON c.id = d.campaign_id
   WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT d.person_id, 'Gift source', coalesce(d.campaign, d.source),
         concat_ws(' ', d.campaign, d.source, d.method)
    FROM public.donations d WHERE d.deleted_at IS NULL
  UNION ALL
  SELECT i.person_id, 'Note', left(i.text, 90), i.text
    FROM public.interactions i WHERE i.text IS NOT NULL
  UNION ALL
  SELECT t.person_id, 'Task', left(t.text, 90), t.text
    FROM public.tasks t WHERE t.person_id IS NOT NULL AND t.deleted_at IS NULL
  UNION ALL
  SELECT g.funder_id, 'Grant', g.name, g.name FROM public.grants g
  UNION ALL
  SELECT g.program_officer_id, 'Grant', g.name, g.name
    FROM public.grants g WHERE g.program_officer_id IS NOT NULL
  UNION ALL
  SELECT p.id, 'Notes', left(p.notes, 90), p.notes FROM public.people p
   WHERE p.deleted_at IS NULL AND p.notes IS NOT NULL
),
scored AS (
  SELECT s.id, s.k, s.lbl,
         (lower(s.txt) LIKE (SELECT t FROM q) || '%') AS prefix,
         CASE
           WHEN lower(s.txt) = (SELECT t FROM q) THEN 1.0
           WHEN lower(s.txt) LIKE '%' || (SELECT t FROM q) || '%' THEN 0.9
           ELSE greatest(
             similarity(lower(s.txt), (SELECT t FROM q)),
             word_similarity((SELECT t FROM q), lower(s.txt)),
             0.35
           )
         END::real AS sc
    FROM src s, q
   WHERE s.txt IS NOT NULL AND length(q.t) >= 2
     AND (
       lower(s.txt) LIKE '%' || q.t || '%'
       OR word_similarity(q.t, lower(s.txt)) > 0.5
       OR (
         length(q.t) >= 4
         AND EXISTS (
           SELECT 1 FROM unnest(regexp_split_to_array(lower(s.txt), '[^a-z0-9]+')) w
            WHERE length(w) >= 3
              AND levenshtein_less_equal(q.t, w, 2) <= CASE WHEN length(q.t) <= 5 THEN 1 ELSE 2 END
         )
       )
     )
),
best AS (
  SELECT id, k, lbl, sc, prefix,
         row_number() OVER (
           PARTITION BY id
           ORDER BY (CASE WHEN prefix THEN 0 ELSE 1 END), sc DESC,
                    (CASE WHEN k = 'Name' THEN 0 ELSE 1 END)
         ) AS rn
    FROM scored
)
SELECT id AS person_id,
       CASE WHEN k = 'Name' THEN 'Name: ' || coalesce(lbl, '') ELSE k || ': ' || coalesce(lbl, '') END AS reason,
       sc AS score
  FROM best
 WHERE rn = 1
 ORDER BY (CASE WHEN prefix THEN 0 ELSE 1 END), sc DESC, lbl
 LIMIT coalesce(_limit, 200)
$function$
;

CREATE OR REPLACE FUNCTION public.sync_person_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_type = 'individual' THEN
    NEW.display_name := NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');
  ELSIF NEW.display_name IS NULL OR TRIM(NEW.display_name) = '' THEN
    NEW.display_name := NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tag_program_counts()
 RETURNS TABLE(kind text, label text, contacts bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'tag' AS kind, tg AS label, count(*) AS contacts
    FROM public.people p, unnest(p.tags) tg
   WHERE p.deleted_at IS NULL AND coalesce(trim(tg), '') <> ''
   GROUP BY tg
  UNION ALL
  SELECT 'program', pr, count(*)
    FROM public.people p, unnest(p.programs) pr
   WHERE p.deleted_at IS NULL AND coalesce(trim(pr), '') <> ''
   GROUP BY pr
   ORDER BY kind, contacts DESC, label
$function$
;

CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _people int; _households int; _donations int; _interactions int; _sources int; _review int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  DELETE FROM public.field_sources WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _sources = ROW_COUNT;

  DELETE FROM public.interactions WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _interactions = ROW_COUNT;

  DELETE FROM public.donations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _donations = ROW_COUNT;

  DELETE FROM public.review_queue WHERE batch_id = _batch_id;
  GET DIAGNOSTICS _review = ROW_COUNT;

  DELETE FROM public.field_sources WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.interactions WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.donations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.tasks WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.registrations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.yahrzeits WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);

  DELETE FROM public.people WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _people = ROW_COUNT;

  DELETE FROM public.households h
   WHERE h.import_batch_id = _batch_id
     AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id);
  GET DIAGNOSTICS _households = ROW_COUNT;

  UPDATE public.import_batches SET status = 'reverted' WHERE id = _batch_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('import_batches', _batch_id, 'import_undone', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                       'interactions', _interactions, 'field_sources', _sources, 'review_items', _review));

  RETURN jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                            'interactions', _interactions, 'field_sources', _sources, 'review_items', _review);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

-- ======================================================================
-- TRIGGERS
-- ======================================================================
CREATE TRIGGER campaigns_audit AFTER INSERT OR DELETE OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION record_audit();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER donations_audit AFTER INSERT OR DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION record_audit();
CREATE TRIGGER donations_refresh_totals AFTER INSERT OR DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION donations_refresh_totals();
CREATE TRIGGER events_audit AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION record_audit();
CREATE TRIGGER grants_audit AFTER INSERT OR DELETE OR UPDATE ON public.grants FOR EACH ROW EXECUTE FUNCTION record_audit();
CREATE TRIGGER update_grants_updated_at BEFORE UPDATE ON public.grants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_integration_credentials_updated_at BEFORE UPDATE ON public.integration_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER interactions_refresh_totals AFTER INSERT OR DELETE OR UPDATE ON public.interactions FOR EACH ROW EXECUTE FUNCTION interactions_refresh_totals();
CREATE TRIGGER people_audit AFTER INSERT OR DELETE OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION record_audit();
CREATE TRIGGER people_sync_display_name BEFORE INSERT OR UPDATE OF first_name, last_name, display_name, contact_type ON public.people FOR EACH ROW EXECUTE FUNCTION sync_person_display_name();
CREATE TRIGGER tasks_audit AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION record_audit();

-- ======================================================================
-- VIEWS
-- ======================================================================
-- none: this project defines no views

