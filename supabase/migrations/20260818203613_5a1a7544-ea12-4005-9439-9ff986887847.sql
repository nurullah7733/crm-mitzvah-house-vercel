-- ---------------------------------------------------------------------------
-- 1. Merging contacts must not throw away the better event outcome.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registration_status_rank(_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(trim(coalesce(_status, '')))
           WHEN 'attended' THEN 3
           WHEN 'no_show'  THEN 2
           ELSE 1
         END
$$;

REVOKE ALL ON FUNCTION public.registration_status_rank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_status_rank(text) TO authenticated, service_role;

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

  PERFORM set_config('app.privileged_op', 'on', true);

  SELECT to_jsonb(p) INTO v_snapshot FROM public.people p WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Contact to merge no longer exists'; END IF;
  SELECT to_jsonb(p) INTO v_surviving_before FROM public.people p WHERE id = _surviving_id;
  IF v_surviving_before IS NULL THEN
    RAISE EXCEPTION 'Surviving contact no longer exists';
  END IF;

  -- Gifts: drop an exact duplicate the losing record carried, keep everything else.
  DELETE FROM public.donations d
   WHERE d.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.donations s
                  WHERE s.person_id = _surviving_id
                    AND s.amount = d.amount
                    AND s.date = d.date
                    AND COALESCE(s.campaign, '') = COALESCE(d.campaign, '')
                    AND s.deleted_at IS NULL)
     AND d.deleted_at IS NULL;
  UPDATE public.donations SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('donations', v_n);

  UPDATE public.interactions SET person_id = _surviving_id WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('interactions', v_n);

  -- Event sign-ups: when both records were signed up for the same event, keep the
  -- stronger outcome (attended beats no show, which beats merely registered) so a
  -- merge can never quietly lose the fact that someone actually turned up.
  UPDATE public.registrations s
     SET status = r.status
    FROM public.registrations r
   WHERE r.person_id = _merged_id
     AND s.person_id = _surviving_id
     AND s.event_id = r.event_id
     AND public.registration_status_rank(r.status) > public.registration_status_rank(s.status);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations_upgraded', v_n);

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

  -- Phones and emails: skip any the surviving record already has, move the rest.
  DELETE FROM public.contact_methods m
   WHERE m.person_id = _merged_id
     AND EXISTS (SELECT 1 FROM public.contact_methods s
                  WHERE s.person_id = _surviving_id
                    AND s.kind = m.kind
                    AND lower(trim(s.value)) = lower(trim(m.value)));
  UPDATE public.contact_methods SET person_id = _surviving_id, is_primary = false WHERE person_id = _merged_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('contact_methods', v_n);

  -- The losing record goes first, so no value written below can collide with it.
  DELETE FROM public.people WHERE id = _merged_id;

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
      household_relationship = COALESCE(_field_values->>'household_relationship', p.household_relationship),
      tags          = CASE WHEN _field_values ? 'tags'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'tags'))
                           ELSE p.tags END,
      programs      = CASE WHEN _field_values ? 'programs'
                           THEN ARRAY(SELECT jsonb_array_elements_text(_field_values->'programs'))
                           ELSE p.programs END
    WHERE p.id = _surviving_id;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 2. Soft delete becomes structural: reads can no longer see removed rows,
--    whether or not the query remembered to filter. Writes are unchanged, so
--    the "Restore" action in Change history (which clears deleted_at) still
--    works, and admin-only deletion triggers still apply.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff full access" ON public.people;
CREATE POLICY "Staff read active contacts" ON public.people FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Staff add contacts" ON public.people FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff change contacts" ON public.people FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff remove contacts" ON public.people FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff full access" ON public.donations;
CREATE POLICY "Staff read active gifts" ON public.donations FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Staff add gifts" ON public.donations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff change gifts" ON public.donations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff remove gifts" ON public.donations FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff full access" ON public.events;
CREATE POLICY "Staff read active events" ON public.events FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Staff add events" ON public.events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff change events" ON public.events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff remove events" ON public.events FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff full access" ON public.tasks;
CREATE POLICY "Staff read active tasks" ON public.tasks FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "Staff add tasks" ON public.tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff change tasks" ON public.tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff remove tasks" ON public.tasks FOR DELETE TO authenticated USING (true);

COMMENT ON COLUMN public.people.deleted_at IS 'Soft delete. Enforced by the SELECT policy: removed rows are invisible to app reads regardless of query filters.';
COMMENT ON COLUMN public.donations.deleted_at IS 'Soft delete. Enforced by the SELECT policy.';
COMMENT ON COLUMN public.events.deleted_at IS 'Soft delete. Enforced by the SELECT policy.';
COMMENT ON COLUMN public.tasks.deleted_at IS 'Soft delete. Enforced by the SELECT policy.';