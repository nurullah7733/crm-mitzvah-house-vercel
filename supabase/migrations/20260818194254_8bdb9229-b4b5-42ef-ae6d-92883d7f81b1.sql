ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS import_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS donations_import_fingerprint_unique
  ON public.donations (import_fingerprint)
  WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_person_unique
  ON public.registrations (event_id, person_id);

CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _people int := 0; _households int := 0; _donations int := 0; _interactions int := 0;
  _sources int := 0; _review int := 0; _methods int := 0; _tasks int := 0; _regs int := 0;
  _kept_people int := 0; _kept_households int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can undo an import';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.import_batches WHERE id = _batch_id) THEN
    RAISE EXCEPTION 'Import batch not found';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

  SELECT count(DISTINCT fs.person_id) INTO _kept_people
    FROM public.field_sources fs
    JOIN public.people p ON p.id = fs.person_id
   WHERE fs.import_batch_id = _batch_id
     AND (p.import_batch_id IS NULL OR p.import_batch_id <> _batch_id);

  DELETE FROM public.review_queue WHERE batch_id = _batch_id;
  GET DIAGNOSTICS _review = ROW_COUNT;

  DELETE FROM public.registrations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _regs = ROW_COUNT;

  DELETE FROM public.tasks WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _tasks = ROW_COUNT;

  DELETE FROM public.donations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _donations = ROW_COUNT;

  DELETE FROM public.interactions WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _interactions = ROW_COUNT;

  DELETE FROM public.contact_methods WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _methods = ROW_COUNT;

  DELETE FROM public.field_sources WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _sources = ROW_COUNT;

  DELETE FROM public.registrations
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.tasks
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.donations
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.interactions
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.contact_methods
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.field_sources
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.yahrzeits
   WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);

  DELETE FROM public.people WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _people = ROW_COUNT;

  DELETE FROM public.interactions
   WHERE household_id IN (
     SELECT h.id FROM public.households h
      WHERE h.import_batch_id = _batch_id
        AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id)
   );

  DELETE FROM public.households h
   WHERE h.import_batch_id = _batch_id
     AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id);
  GET DIAGNOSTICS _households = ROW_COUNT;

  SELECT count(*) INTO _kept_households
    FROM public.households h
   WHERE h.import_batch_id = _batch_id;

  UPDATE public.import_batches SET status = 'reverted' WHERE id = _batch_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES (
    'import_batches', _batch_id, 'import_undone', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    jsonb_build_object(
      'people', _people, 'households', _households, 'donations', _donations,
      'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
      'contact_methods', _methods, 'tasks', _tasks, 'registrations', _regs,
      'kept_existing_people', _kept_people, 'kept_households', _kept_households
    )
  );

  PERFORM set_config('app.privileged_op', 'off', true);

  RETURN jsonb_build_object(
    'people', _people, 'households', _households, 'donations', _donations,
    'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
    'contact_methods', _methods, 'tasks', _tasks, 'registrations', _regs,
    'kept_existing_people', _kept_people, 'kept_households', _kept_households
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_import(uuid) TO authenticated, service_role;