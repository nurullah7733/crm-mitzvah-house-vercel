CREATE INDEX IF NOT EXISTS people_display_name_idx ON public.people (lower(display_name));
CREATE INDEX IF NOT EXISTS people_email_idx ON public.people (lower(email));
CREATE INDEX IF NOT EXISTS people_phone_idx ON public.people (phone);
CREATE INDEX IF NOT EXISTS people_household_id_idx ON public.people (household_id);
CREATE INDEX IF NOT EXISTS people_parent_org_id_idx ON public.people (parent_org_id);
CREATE INDEX IF NOT EXISTS people_contact_type_idx ON public.people (contact_type);
CREATE INDEX IF NOT EXISTS people_last_activity_date_idx ON public.people (last_activity_date);
CREATE INDEX IF NOT EXISTS people_birth_date_idx ON public.people (birth_date);

CREATE INDEX IF NOT EXISTS donations_person_id_idx ON public.donations (person_id);
CREATE INDEX IF NOT EXISTS donations_date_idx ON public.donations (date DESC);
CREATE INDEX IF NOT EXISTS donations_campaign_id_idx ON public.donations (campaign_id);
CREATE INDEX IF NOT EXISTS donations_grant_id_idx ON public.donations (grant_id);

CREATE INDEX IF NOT EXISTS interactions_person_id_idx ON public.interactions (person_id, date DESC);
CREATE INDEX IF NOT EXISTS tasks_person_id_idx ON public.tasks (person_id);
CREATE INDEX IF NOT EXISTS tasks_status_due_idx ON public.tasks (status, due_date);
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON public.tasks (completed_at DESC);
CREATE INDEX IF NOT EXISTS registrations_event_id_idx ON public.registrations (event_id);
CREATE INDEX IF NOT EXISTS registrations_person_id_idx ON public.registrations (person_id);
CREATE INDEX IF NOT EXISTS yahrzeits_person_id_idx ON public.yahrzeits (person_id);
CREATE INDEX IF NOT EXISTS field_sources_person_id_idx ON public.field_sources (person_id, field_name);

CREATE INDEX IF NOT EXISTS grants_funder_id_idx ON public.grants (funder_id);
CREATE INDEX IF NOT EXISTS grants_campaign_id_idx ON public.grants (campaign_id);
CREATE INDEX IF NOT EXISTS grants_stage_idx ON public.grants (stage);
CREATE INDEX IF NOT EXISTS grants_application_deadline_idx ON public.grants (application_deadline);
CREATE INDEX IF NOT EXISTS grants_report_deadline_idx ON public.grants (report_deadline);
CREATE INDEX IF NOT EXISTS events_date_idx ON public.events (date DESC);
CREATE INDEX IF NOT EXISTS review_queue_status_idx ON public.review_queue (status);