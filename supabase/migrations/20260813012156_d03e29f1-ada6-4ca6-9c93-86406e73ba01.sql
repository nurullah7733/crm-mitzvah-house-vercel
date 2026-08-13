-- =========================================================
-- 1. Drop the leftover connection test table (and its open read policy)
-- =========================================================
DROP TABLE IF EXISTS public.connection_check CASCADE;

-- =========================================================
-- 2. Soft-deleted gifts must not count toward giving totals
-- =========================================================
CREATE OR REPLACE FUNCTION public.recalc_person_totals(_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
   WHERE person_id = _person_id
     AND deleted_at IS NULL;

  IF v_last_date IS NOT NULL THEN
    SELECT amount INTO v_last_amount
      FROM public.donations
     WHERE person_id = _person_id AND date = v_last_date AND deleted_at IS NULL
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
$$;

-- A soft delete or restore must refresh the donor's totals too.
CREATE OR REPLACE FUNCTION public.donations_refresh_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- =========================================================
-- 3. A real admin check, and admins on file
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
       OR EXISTS (
         SELECT 1 FROM public.staff_members s
          WHERE s.active
            AND s.role = 'admin'
            AND lower(s.email) = lower(NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''))
       )
     )
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Register existing signed-up admin staff as admins so roles are not decorative.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
  FROM auth.users u
  JOIN public.staff_members s
    ON lower(s.email) = lower(u.email) AND s.active AND s.role = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- =========================================================
-- 4. Remove all not-signed-in (anon) table access
-- =========================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- App functions are never callable by a visitor who is not signed in.
REVOKE EXECUTE ON FUNCTION public.merge_people(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_import(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_people(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_duplicate_people() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tag_program_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_person_totals(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_giving_totals() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_audit_log() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_review_decision(uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_import_review_merge(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_import(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_people(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_duplicate_people() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tag_program_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_all_giving_totals() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_audit_log() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_review_decision(uuid, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_import_review_merge(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- =========================================================
-- 5. Change-history purge: admin only, plus a nightly schedule
-- =========================================================
CREATE OR REPLACE FUNCTION public.purge_audit_log_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer := 0;
BEGIN
  DELETE FROM public.audit_log WHERE created_at < now() - interval '2 months';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_audit_log_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_audit_log_internal() TO service_role;

CREATE OR REPLACE FUNCTION public.purge_old_audit_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can clear the change history';
  END IF;
  RETURN public.purge_audit_log_internal();
END;
$$;

DO $do$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $cmd$SELECT cron.unschedule('purge-audit-log')$cmd$;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    EXECUTE $cmd$SELECT cron.schedule('purge-audit-log', '15 3 * * *', 'SELECT public.purge_audit_log_internal();')$cmd$;
  END IF;
END
$do$;

-- =========================================================
-- 6. Make roles real
-- =========================================================
-- Admins can assign and remove roles; everyone signed in can read them.
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Staff list: readable by all staff, editable by admins only.
DROP POLICY IF EXISTS "Staff full access" ON public.staff_members;
DROP POLICY IF EXISTS "Staff can read the staff list" ON public.staff_members;
DROP POLICY IF EXISTS "Admins manage staff" ON public.staff_members;
CREATE POLICY "Staff can read the staff list" ON public.staff_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage staff" ON public.staff_members
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Integration status rows: readable by staff, changed by admins only.
DROP POLICY IF EXISTS "Staff full access" ON public.integrations;
DROP POLICY IF EXISTS "Staff can read integrations" ON public.integrations;
DROP POLICY IF EXISTS "Admins manage integrations" ON public.integrations;
CREATE POLICY "Staff can read integrations" ON public.integrations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage integrations" ON public.integrations
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Deleting or archiving a record is admin-only.
CREATE OR REPLACE FUNCTION public.enforce_admin_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.privileged_op', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only an admin can permanently remove records';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can delete or archive records';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_admin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.privileged_op', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can permanently remove records';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS people_admin_archive ON public.people;
CREATE TRIGGER people_admin_archive BEFORE UPDATE OR DELETE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();
DROP TRIGGER IF EXISTS donations_admin_archive ON public.donations;
CREATE TRIGGER donations_admin_archive BEFORE UPDATE OR DELETE ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();
DROP TRIGGER IF EXISTS events_admin_archive ON public.events;
CREATE TRIGGER events_admin_archive BEFORE UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();
DROP TRIGGER IF EXISTS tasks_admin_archive ON public.tasks;
CREATE TRIGGER tasks_admin_archive BEFORE UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();
DROP TRIGGER IF EXISTS households_admin_delete ON public.households;
CREATE TRIGGER households_admin_delete BEFORE DELETE ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();
DROP TRIGGER IF EXISTS campaigns_admin_delete ON public.campaigns;
CREATE TRIGGER campaigns_admin_delete BEFORE DELETE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();
DROP TRIGGER IF EXISTS grants_admin_delete ON public.grants;
CREATE TRIGGER grants_admin_delete BEFORE DELETE ON public.grants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();

-- Merging is a reviewer's job, so it runs as a privileged operation.
CREATE OR REPLACE FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  PERFORM set_config('app.privileged_op', 'on', true);

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

  BEGIN
    UPDATE public.contact_methods SET person_id = _surviving_id WHERE person_id = _merged_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('contact_methods', v_n);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

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

  PERFORM set_config('app.privileged_op', 'off', true);

  RETURN _surviving_id;
END;
$function$;

-- Undoing an import is admin-only, and runs as a privileged operation.
CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _people int; _households int; _donations int; _interactions int; _sources int; _review int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can undo an import';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

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

  PERFORM set_config('app.privileged_op', 'off', true);

  RETURN jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                            'interactions', _interactions, 'field_sources', _sources, 'review_items', _review);
END;
$function$;

-- Recalculating totals stays admin-only but uses the shared admin check.
CREATE OR REPLACE FUNCTION public.recalculate_all_giving_totals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can recalculate totals';
  END IF;

  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- =========================================================
-- 7. Valid values for status and lifecycle fields
-- =========================================================
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('upcoming', 'overdue', 'done'));

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('registered', 'attended', 'no_show'));

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('planning', 'active', 'completed', 'archived'));

ALTER TABLE public.grants DROP CONSTRAINT IF EXISTS grants_stage_check;
ALTER TABLE public.grants ADD CONSTRAINT grants_stage_check
  CHECK (stage IN ('researching', 'LOI submitted', 'applied', 'awarded', 'declined',
                   'reporting due', 'reported', 'renewal eligible'));

ALTER TABLE public.interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('note', 'call', 'donation', 'event', 'volunteer', 'form'));

ALTER TABLE public.people DROP CONSTRAINT IF EXISTS people_contact_type_check;
ALTER TABLE public.people ADD CONSTRAINT people_contact_type_check
  CHECK (contact_type IN ('individual', 'organization', 'foundation'));

ALTER TABLE public.people DROP CONSTRAINT IF EXISTS people_role_check;
ALTER TABLE public.people ADD CONSTRAINT people_role_check
  CHECK (role IN ('Adult', 'Child'));

-- =========================================================
-- 8. Normalise email and phone at storage time
-- =========================================================
-- The change-history recorder must not assume every table has an archive column.
CREATE OR REPLACE FUNCTION public.record_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changes jsonb := '{}'::jsonb;
  _key text;
  _action text;
  _record_id uuid;
  _old_deleted text;
  _new_deleted text;
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
    _old_deleted := to_jsonb(OLD) ->> 'deleted_at';
    _new_deleted := to_jsonb(NEW) ->> 'deleted_at';
    IF _old_deleted IS NULL AND _new_deleted IS NOT NULL THEN
      _action := 'deleted';
    ELSIF _old_deleted IS NOT NULL AND _new_deleted IS NULL THEN
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
$$;

CREATE OR REPLACE FUNCTION public.normalize_person_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := NULLIF(lower(TRIM(NEW.email)), '');
  NEW.phone := NULLIF(REGEXP_REPLACE(COALESCE(NEW.phone, ''), '\D', '', 'g'), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS people_normalize_identity ON public.people;
CREATE TRIGGER people_normalize_identity BEFORE INSERT OR UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.normalize_person_identity();

CREATE OR REPLACE FUNCTION public.normalize_contact_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'email' THEN
    NEW.value := NULLIF(lower(TRIM(NEW.value)), '');
  ELSE
    NEW.value := NULLIF(REGEXP_REPLACE(COALESCE(NEW.value, ''), '\D', '', 'g'), '');
  END IF;
  IF NEW.value IS NULL THEN
    RAISE EXCEPTION 'A phone number or email address cannot be blank';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_methods_normalize ON public.contact_methods;
CREATE TRIGGER contact_methods_normalize BEFORE INSERT OR UPDATE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.normalize_contact_method();

-- Bring existing rows in line before the unique index goes on.
UPDATE public.people
   SET email = NULLIF(lower(TRIM(email)), ''),
       phone = NULLIF(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), '')
 WHERE email IS DISTINCT FROM NULLIF(lower(TRIM(email)), '')
    OR phone IS DISTINCT FROM NULLIF(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), '');

UPDATE public.contact_methods
   SET value = CASE WHEN kind = 'email' THEN lower(TRIM(value))
                    ELSE REGEXP_REPLACE(value, '\D', '', 'g') END
 WHERE value IS NOT NULL;

DROP INDEX IF EXISTS public.people_email_unique;
CREATE UNIQUE INDEX people_email_unique
  ON public.people (email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- =========================================================
-- 9. Integration credentials move into encrypted vault storage
-- =========================================================
ALTER TABLE public.integration_credentials
  ADD COLUMN IF NOT EXISTS vault_secret_id uuid,
  ADD COLUMN IF NOT EXISTS masked_hint text,
  ADD COLUMN IF NOT EXISTS credential_keys text[] NOT NULL DEFAULT '{}';

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.integration_credentials WHERE credentials <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Plaintext credentials present; migrate them to the vault before dropping the column';
  END IF;
END
$do$;

ALTER TABLE public.integration_credentials DROP COLUMN IF EXISTS credentials;

CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_provider_key
  ON public.integration_credentials (provider);

CREATE OR REPLACE FUNCTION public.save_integration_credentials(
  _provider text,
  _credentials jsonb,
  _primary_field text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := 'integration:' || _provider;
  v_primary text;
  v_hint text;
BEGIN
  SELECT vault_secret_id INTO v_id FROM public.integration_credentials WHERE provider = _provider;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(_credentials::text, v_name, 'Integration credentials for ' || _provider);
  ELSE
    PERFORM vault.update_secret(v_id, _credentials::text, v_name, 'Integration credentials for ' || _provider);
  END IF;

  v_primary := _credentials ->> _primary_field;
  v_hint := CASE WHEN COALESCE(v_primary, '') = '' THEN NULL ELSE '•••• ' || right(v_primary, 4) END;

  INSERT INTO public.integration_credentials (provider, vault_secret_id, masked_hint, credential_keys, updated_at)
  VALUES (_provider, v_id, v_hint, ARRAY(SELECT jsonb_object_keys(_credentials)), now())
  ON CONFLICT (provider) DO UPDATE
    SET vault_secret_id = v_id,
        masked_hint = v_hint,
        credential_keys = ARRAY(SELECT jsonb_object_keys(_credentials)),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_integration_credentials(_provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_secret
    FROM public.integration_credentials c
    JOIN vault.decrypted_secrets s ON s.id = c.vault_secret_id
   WHERE c.provider = _provider;
  IF v_secret IS NULL THEN RETURN '{}'::jsonb; END IF;
  RETURN v_secret::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_integration_credentials(_provider text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT vault_secret_id INTO v_id FROM public.integration_credentials WHERE provider = _provider;
  DELETE FROM public.integration_credentials WHERE provider = _provider;
  IF v_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_integration_credentials(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_integration_credentials(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_integration_credentials(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_integration_credentials(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_integration_credentials(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_integration_credentials(text) TO service_role;

-- =========================================================
-- 10. Self-correct every existing giving total
-- =========================================================
DO $do$
DECLARE r record;
BEGIN
  PERFORM set_config('app.privileged_op', 'on', true);
  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
  END LOOP;
  PERFORM set_config('app.privileged_op', 'off', true);
END
$do$;