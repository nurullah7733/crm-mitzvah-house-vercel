ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_import_batch_idx ON public.tasks(import_batch_id);
CREATE INDEX IF NOT EXISTS registrations_import_batch_idx ON public.registrations(import_batch_id);

CREATE OR REPLACE FUNCTION public.undo_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _people int; _households int; _donations int; _interactions int; _sources int; _review int;
  _methods int; _tasks int; _regs int; _kept_people int; _kept_households int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can undo an import';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

  -- Existing contacts this import only updated: they stay, because they were
  -- already on file before the import ran.
  SELECT count(DISTINCT fs.person_id) INTO _kept_people
    FROM public.field_sources fs
    JOIN public.people p ON p.id = fs.person_id
   WHERE fs.import_batch_id = _batch_id
     AND (p.import_batch_id IS NULL OR p.import_batch_id <> _batch_id);

  DELETE FROM public.field_sources WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _sources = ROW_COUNT;

  DELETE FROM public.interactions WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _interactions = ROW_COUNT;

  DELETE FROM public.donations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _donations = ROW_COUNT;

  DELETE FROM public.contact_methods WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _methods = ROW_COUNT;

  DELETE FROM public.registrations WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _regs = ROW_COUNT;

  DELETE FROM public.tasks WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _tasks = ROW_COUNT;

  DELETE FROM public.review_queue WHERE batch_id = _batch_id;
  GET DIAGNOSTICS _review = ROW_COUNT;

  -- Everything hanging off a contact this import created.
  DELETE FROM public.contact_methods WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.field_sources WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.interactions WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.donations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.tasks WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.registrations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.yahrzeits WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);

  DELETE FROM public.people WHERE import_batch_id = _batch_id;
  GET DIAGNOSTICS _people = ROW_COUNT;

  -- Households this import created, unless someone from before still lives there.
  DELETE FROM public.interactions
   WHERE household_id IN (
     SELECT h.id FROM public.households h
      WHERE h.import_batch_id = _batch_id
        AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id));

  DELETE FROM public.households h
   WHERE h.import_batch_id = _batch_id
     AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.household_id = h.id);
  GET DIAGNOSTICS _households = ROW_COUNT;

  SELECT count(*) INTO _kept_households
    FROM public.households h
   WHERE h.import_batch_id = _batch_id;

  UPDATE public.import_batches SET status = 'reverted' WHERE id = _batch_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('import_batches', _batch_id, 'import_undone', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                       'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
                       'contact_methods', _methods, 'tasks', _tasks, 'registrations', _regs,
                       'kept_existing_people', _kept_people, 'kept_households', _kept_households));

  PERFORM set_config('app.privileged_op', 'off', true);

  RETURN jsonb_build_object('people', _people, 'households', _households, 'donations', _donations,
                            'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
                            'contact_methods', _methods, 'tasks', _tasks, 'registrations', _regs,
                            'kept_existing_people', _kept_people, 'kept_households', _kept_households);
END;
$$;

REVOKE ALL ON FUNCTION public.undo_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_import(uuid) TO authenticated;