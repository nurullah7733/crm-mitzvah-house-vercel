-- 1. Shared household emails are normal. Detect duplicates on email, never forbid them.
DROP INDEX IF EXISTS public.people_email_unique;
CREATE INDEX IF NOT EXISTS people_email_lookup
  ON public.people (email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- 2. Relationship inside a household (spouse / child / parent / sibling / other).
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS household_relationship text;

-- 3. Imported gifts: one row per person + amount + date + campaign.
CREATE UNIQUE INDEX IF NOT EXISTS donations_import_unique
  ON public.donations (person_id, amount, date, COALESCE(campaign, ''))
  WHERE import_batch_id IS NOT NULL AND deleted_at IS NULL;

-- 4. Merge: move history, delete the losing record, THEN write chosen values,
--    so a shared email can never collide mid-merge.
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

REVOKE ALL ON FUNCTION public.merge_people(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid, jsonb) TO authenticated;

-- 5. Report which contacts have giving totals that disagree with their gift ledger.
CREATE OR REPLACE FUNCTION public.giving_total_mismatches()
 RETURNS TABLE(person_id uuid, stored_lifetime numeric, actual_lifetime numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT p.id,
         p.lifetime_giving,
         COALESCE((SELECT SUM(d.amount) FROM public.donations d
                    WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
    FROM public.people p
   WHERE p.deleted_at IS NULL
     AND p.lifetime_giving IS DISTINCT FROM
         COALESCE((SELECT SUM(d.amount) FROM public.donations d
                    WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
$function$;

REVOKE ALL ON FUNCTION public.giving_total_mismatches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.giving_total_mismatches() TO authenticated;