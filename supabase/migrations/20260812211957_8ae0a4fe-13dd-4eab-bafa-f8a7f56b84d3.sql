-- 1. Reversible imports: tag every row an import creates
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.field_sources ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS people_import_batch_idx ON public.people(import_batch_id);
CREATE INDEX IF NOT EXISTS households_import_batch_idx ON public.households(import_batch_id);
CREATE INDEX IF NOT EXISTS donations_import_batch_idx ON public.donations(import_batch_id);
CREATE INDEX IF NOT EXISTS interactions_import_batch_idx ON public.interactions(import_batch_id);
CREATE INDEX IF NOT EXISTS field_sources_import_batch_idx ON public.field_sources(import_batch_id);

-- 2. Soft delete
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS people_not_deleted_idx ON public.people(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS donations_not_deleted_idx ON public.donations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_not_deleted_idx ON public.events(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_not_deleted_idx ON public.tasks(deleted_at) WHERE deleted_at IS NULL;

-- 3. Audit trail
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  actor_id uuid,
  actor_email text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read the change history" ON public.audit_log
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS audit_log_record_idx ON public.audit_log(table_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log(created_at DESC);

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
$$;

REVOKE ALL ON FUNCTION public.record_audit() FROM anon, authenticated;

DROP TRIGGER IF EXISTS people_audit ON public.people;
CREATE TRIGGER people_audit AFTER INSERT OR UPDATE OR DELETE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();
DROP TRIGGER IF EXISTS donations_audit ON public.donations;
CREATE TRIGGER donations_audit AFTER INSERT OR UPDATE OR DELETE ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();
DROP TRIGGER IF EXISTS events_audit ON public.events;
CREATE TRIGGER events_audit AFTER INSERT OR UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();
DROP TRIGGER IF EXISTS tasks_audit ON public.tasks;
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();
DROP TRIGGER IF EXISTS campaigns_audit ON public.campaigns;
CREATE TRIGGER campaigns_audit AFTER INSERT OR UPDATE OR DELETE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();
DROP TRIGGER IF EXISTS grants_audit ON public.grants;
CREATE TRIGGER grants_audit AFTER INSERT OR UPDATE OR DELETE ON public.grants
  FOR EACH ROW EXECUTE FUNCTION public.record_audit();

-- 4. Undo an import: one transaction, removes only what that import created
CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.undo_import(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_import(uuid) TO authenticated;