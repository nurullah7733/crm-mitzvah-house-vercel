-- Mitzvah House CRM — complete public-schema export
-- Generated 2026-08-18 19:50 UTC with pg_dump --schema-only --schema=public
-- from the live Lovable Cloud (Postgres 17) database.
-- Run top to bottom on an empty Supabase/Postgres database to recreate the schema.
-- Includes tables, enums, functions, triggers, indexes, RLS policies and GRANTs.
-- Contains NO data and NO secrets. The auth/storage/vault schemas are platform-managed
-- and intentionally not included; roles (anon, authenticated, service_role) are assumed to exist.

--
--

\restrict ySumauDSQtuqfnt9fCrjYSKQnZ34PMCodySbsHG7oTffjO4zrrxaoaZOykXo5db

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';

--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'marketing',
    'va'
);

--
-- Name: contact_methods_after_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contact_methods_after_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Only one primary per kind.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.is_primary THEN
    UPDATE public.contact_methods
       SET is_primary = false
     WHERE person_id = NEW.person_id AND kind = NEW.kind AND id <> NEW.id AND is_primary;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_primary_contact_method(OLD.person_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_primary_contact_method(NEW.person_id);
  IF TG_OP = 'UPDATE' AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    PERFORM public.sync_primary_contact_method(OLD.person_id);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: contact_methods_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contact_methods_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'A contact method must be a phone or an email';
  END IF;
  IF NEW.kind = 'email' THEN
    NEW.value := LOWER(TRIM(NEW.value));
    NEW.method_type := COALESCE(NULLIF(TRIM(NEW.method_type), ''), 'Personal');
  ELSE
    NEW.value := TRIM(NEW.value);
    NEW.method_type := COALESCE(NULLIF(TRIM(NEW.method_type), ''), 'Mobile');
  END IF;
  IF NEW.value = '' THEN
    RAISE EXCEPTION 'A contact method needs a value';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: delete_integration_credentials(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_integration_credentials(_provider text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: donations_refresh_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donations_refresh_totals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: donations_sync_timeline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donations_sync_timeline() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_text text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.interactions
     WHERE source_id = OLD.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    RETURN OLD;
  END IF;

  v_text := 'Gift of ' || public.money_text(NEW.amount)
            || COALESCE(' — ' || NULLIF(TRIM(NEW.campaign), ''), '')
            || COALESCE(' · ' || NULLIF(TRIM(NEW.notes), ''), '');

  IF NEW.deleted_at IS NOT NULL THEN
    -- Archived gift: history, campaign and event totals, and the automatic
    -- thank-you reminder all come back out.
    DELETE FROM public.interactions
     WHERE source_id = NEW.id
       AND source_kind IN ('donation_gift', 'donation_thank_you', 'donation_receipt');
    UPDATE public.tasks
       SET deleted_at = now()
     WHERE donation_id = NEW.id AND deleted_at IS NULL;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
    -- Restored gift: put its reminder back too.
    UPDATE public.tasks SET deleted_at = NULL WHERE donation_id = NEW.id AND deleted_at IS NOT NULL;
  END IF;

  IF NEW.person_id IS NOT NULL THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id, import_batch_id)
    VALUES (NEW.person_id, 'donation', NEW.date, v_text, NULL, 'donation_gift', NEW.id, NEW.import_batch_id)
    ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET person_id = EXCLUDED.person_id,
                  date = EXCLUDED.date,
                  text = EXCLUDED.text;
  END IF;

  RETURN NULL;
END;
$$;

--
-- Name: enforce_admin_archive(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_admin_archive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: enforce_admin_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_admin_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: find_duplicate_people(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_duplicate_people() RETURNS TABLE(person_a uuid, person_b uuid, reason text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH live AS (
    SELECT id,
           LOWER(TRIM(COALESCE(display_name, CONCAT_WS(' ', first_name, last_name)))) AS name,
           household_id, created_at
      FROM public.people
     WHERE deleted_at IS NULL
  ),
  emails AS (
    SELECT p.id, LOWER(TRIM(p.email)) AS email, p.created_at
      FROM public.people p WHERE p.deleted_at IS NULL AND COALESCE(TRIM(p.email), '') <> ''
    UNION
    SELECT cm.person_id, LOWER(TRIM(cm.value)), p.created_at
      FROM public.contact_methods cm JOIN public.people p ON p.id = cm.person_id
     WHERE cm.kind = 'email' AND p.deleted_at IS NULL AND COALESCE(TRIM(cm.value), '') <> ''
  ),
  phones AS (
    SELECT p.id, RIGHT(REGEXP_REPLACE(COALESCE(p.phone, ''), '\D', '', 'g'), 10) AS phone, p.created_at
      FROM public.people p WHERE p.deleted_at IS NULL
    UNION
    SELECT cm.person_id, RIGHT(REGEXP_REPLACE(cm.value, '\D', '', 'g'), 10), p.created_at
      FROM public.contact_methods cm JOIN public.people p ON p.id = cm.person_id
     WHERE cm.kind = 'phone' AND p.deleted_at IS NULL
  ),
  pairs AS (
    SELECT a.id AS person_a, b.id AS person_b, 'Same email address' AS reason
      FROM emails a JOIN emails b ON a.email = b.email AND a.id <> b.id AND a.created_at <= b.created_at
     WHERE a.id < b.id OR a.created_at < b.created_at
    UNION ALL
    SELECT a.id, b.id, 'Same phone number'
      FROM phones a JOIN phones b ON a.phone = b.phone AND a.id <> b.id
     WHERE LENGTH(a.phone) >= 7 AND (a.id < b.id OR a.created_at < b.created_at)
    UNION ALL
    SELECT a.id, b.id, 'Same name in the same household'
      FROM live a JOIN live b
        ON a.name = b.name AND a.household_id IS NOT DISTINCT FROM b.household_id
       AND a.created_at < b.created_at
     WHERE COALESCE(a.name, '') <> '' AND a.household_id IS NOT NULL
  )
  SELECT person_a, person_b, MIN(reason) AS reason
    FROM pairs
   WHERE person_a <> person_b
   GROUP BY person_a, person_b
   LIMIT 200
$$;

--
-- Name: get_integration_credentials(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_integration_credentials(_provider text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: giving_total_mismatches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.giving_total_mismatches() RETURNS TABLE(person_id uuid, stored_lifetime numeric, actual_lifetime numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT p.id,
         p.lifetime_giving,
         COALESCE((SELECT SUM(d.amount) FROM public.donations d
                    WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
    FROM public.people p
   WHERE p.deleted_at IS NULL
     AND p.lifetime_giving IS DISTINCT FROM
         COALESCE((SELECT SUM(d.amount) FROM public.donations d
                    WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
$$;

--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

--
-- Name: interactions_refresh_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.interactions_refresh_totals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.person_id IS NOT NULL THEN
    PERFORM public.recalc_person_totals(NEW.person_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.person_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      PERFORM public.recalc_person_totals(OLD.person_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: lapsed_donors(text, numeric, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lapsed_donors(_mode text DEFAULT 'lapsed'::text, _min_total numeric DEFAULT NULL::numeric, _min_prior_years integer DEFAULT NULL::integer, _limit integer DEFAULT 500) RETURNS TABLE(person_id uuid, name text, owner text, email text, phone text, lifetime_total numeric, prior_years integer, gave_last_year boolean, last_gift_amount numeric, last_gift_date date, last_gift_year integer, score numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $_$
  WITH cfg AS (
    SELECT
      COALESCE(_min_total, (value->>'min_total_giving')::numeric, 0) AS min_total,
      COALESCE(_min_prior_years, (value->>'min_prior_years')::int, 1) AS min_years
      FROM public.app_settings WHERE key = 'renewal_outreach'
  ),
  fallback AS (
    SELECT COALESCE((SELECT min_total FROM cfg), COALESCE(_min_total, 0)) AS min_total,
           COALESCE((SELECT min_years FROM cfg), COALESCE(_min_prior_years, 1)) AS min_years
  ),
  this_year AS (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y),
  gifts AS (
    SELECT d.person_id, d.amount, d.date, EXTRACT(YEAR FROM d.date)::int AS gift_year
      FROM public.donations d
      JOIN public.people p ON p.id = d.person_id
     WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL
  ),
  rolled AS (
    SELECT g.person_id,
           SUM(g.amount) AS lifetime_total,
           COUNT(DISTINCT g.gift_year) FILTER (WHERE g.gift_year < (SELECT y FROM this_year)) AS prior_years,
           BOOL_OR(g.gift_year = (SELECT y FROM this_year)) AS gave_this_year,
           BOOL_OR(g.gift_year = (SELECT y FROM this_year) - 1) AS gave_last_year,
           MAX(g.date) AS last_gift_date
      FROM gifts g
     GROUP BY g.person_id
  ),
  eligible AS (
    SELECT r.*,
           (SELECT amount FROM public.donations d2
             WHERE d2.person_id = r.person_id AND d2.date = r.last_gift_date AND d2.deleted_at IS NULL
             ORDER BY d2.created_at DESC NULLS LAST LIMIT 1) AS last_gift_amount
      FROM rolled r, fallback f
     WHERE r.gave_this_year IS NOT TRUE
       AND r.prior_years >= f.min_years
       AND r.lifetime_total >= f.min_total
  )
  SELECT e.person_id,
         COALESCE(p.display_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS name,
         p.owner,
         p.email,
         p.phone,
         ROUND(e.lifetime_total, 2) AS lifetime_total,
         e.prior_years::int,
         COALESCE(e.gave_last_year, false) AS gave_last_year,
         ROUND(e.last_gift_amount, 2) AS last_gift_amount,
         e.last_gift_date,
         EXTRACT(YEAR FROM e.last_gift_date)::int AS last_gift_year,
         -- consistency counts as much as size: each prior year of giving is
         -- worth as much as $500 of lifetime support
         ROUND((e.prior_years * 500) + LEAST(e.lifetime_total, 25000), 2) AS score
    FROM eligible e
    JOIN public.people p ON p.id = e.person_id
   WHERE CASE lower(COALESCE(_mode, 'lapsed'))
            WHEN 'lybunt' THEN COALESCE(e.gave_last_year, false)
            WHEN 'sybunt' THEN NOT COALESCE(e.gave_last_year, false)
            ELSE true
          END
   ORDER BY score DESC, e.last_gift_date DESC NULLS LAST
   LIMIT COALESCE(_limit, 500)
$_$;

--
-- Name: log_import_review_merge(uuid, uuid, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: log_review_decision(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_review_decision(_item_id uuid, _decision text, _reason text DEFAULT NULL::text, _person_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: mark_receipt_sent(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_receipt_sent(_donation_id uuid, _sent boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_d record;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_d FROM public.donations WHERE id = _donation_id;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  IF _sent THEN
    UPDATE public.donations
       SET receipt_sent = true,
           receipt_sent_date = COALESCE(receipt_sent_date, CURRENT_DATE)
     WHERE id = _donation_id;

    IF v_d.person_id IS NOT NULL AND v_d.deleted_at IS NULL THEN
      INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
      VALUES (v_d.person_id, 'note', CURRENT_DATE,
              'Tax receipt sent for ' || public.money_text(v_d.amount) || ' gift',
              v_actor, 'donation_receipt', _donation_id)
      ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING;
    END IF;
  ELSE
    UPDATE public.donations
       SET receipt_sent = false, receipt_sent_date = NULL
     WHERE id = _donation_id;

    DELETE FROM public.interactions
     WHERE source_kind = 'donation_receipt' AND source_id = _donation_id;
  END IF;
END;
$$;

--
-- Name: mark_thank_you_sent(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_d record;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_d FROM public.donations WHERE id = _donation_id;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  IF _sent THEN
    UPDATE public.donations
       SET thank_you_sent = true,
           thank_you_sent_date = COALESCE(thank_you_sent_date, CURRENT_DATE)
     WHERE id = _donation_id;

    UPDATE public.tasks
       SET status = 'done',
           completed_at = COALESCE(completed_at, now()),
           completion_note = COALESCE(completion_note, 'Thank-you letter sent')
     WHERE donation_id = _donation_id AND status <> 'done' AND deleted_at IS NULL;

    IF v_d.person_id IS NOT NULL AND v_d.deleted_at IS NULL THEN
      INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
      VALUES (v_d.person_id, 'note', CURRENT_DATE,
              'Thank-you letter sent for ' || public.money_text(v_d.amount) || ' gift',
              v_actor, 'donation_thank_you', _donation_id)
      ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING;
    END IF;
  ELSE
    UPDATE public.donations
       SET thank_you_sent = false, thank_you_sent_date = NULL
     WHERE id = _donation_id;

    -- Put the reminder back on the task list.
    UPDATE public.tasks
       SET status = 'upcoming',
           completed_at = NULL,
           completion_note = NULL
     WHERE donation_id = _donation_id AND status = 'done' AND deleted_at IS NULL;

    -- And take the activity entry back out of the person's history.
    DELETE FROM public.interactions
     WHERE source_kind = 'donation_thank_you' AND source_id = _donation_id;
  END IF;
END;
$$;

--
-- Name: merge_households(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_snapshot jsonb;
  v_surviving jsonb;
  v_moved integer := 0;
  v_key text;
  v_allowed text[] := ARRAY['name','address','address_line2','address_line3','city','state','postal_code','county','billing_address','phone','notes'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF _surviving_id IS NULL OR _merged_id IS NULL OR _surviving_id = _merged_id THEN
    RAISE EXCEPTION 'Pick two different households to merge';
  END IF;

  PERFORM set_config('app.privileged_op', 'on', true);

  SELECT to_jsonb(h) INTO v_snapshot FROM public.households h WHERE id = _merged_id;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Household to merge no longer exists'; END IF;
  SELECT to_jsonb(h) INTO v_surviving FROM public.households h WHERE id = _surviving_id;
  IF v_surviving IS NULL THEN RAISE EXCEPTION 'Surviving household no longer exists'; END IF;

  UPDATE public.people SET household_id = _surviving_id WHERE household_id = _merged_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(_field_values, '{}'::jsonb)) LOOP
    IF v_key = ANY(v_allowed) THEN
      EXECUTE format('UPDATE public.households SET %I = $1 WHERE id = $2', v_key)
        USING NULLIF(_field_values ->> v_key, ''), _surviving_id;
    END IF;
  END LOOP;

  DELETE FROM public.households WHERE id = _merged_id;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES (
    'households',
    _surviving_id,
    'merge',
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    jsonb_build_object('merged_household', v_snapshot, 'surviving_before', v_surviving, 'members_moved', v_moved)
  );

  RETURN _surviving_id;
END;
$_$;

--
-- Name: merge_people(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: money_text(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.money_text(_amount numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
  SELECT '$' || TRIM(TO_CHAR(COALESCE(_amount, 0), 'FM9,999,999,990.00'))
$_$;

--
-- Name: normalize_contact_method(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_contact_method() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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

--
-- Name: normalize_person_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_person_identity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.email := NULLIF(lower(TRIM(NEW.email)), '');
  NEW.phone := NULLIF(REGEXP_REPLACE(COALESCE(NEW.phone, ''), '\D', '', 'g'), '');
  RETURN NEW;
END;
$$;

--
-- Name: purge_audit_log_internal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_audit_log_internal() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_deleted integer := 0;
BEGIN
  DELETE FROM public.audit_log WHERE created_at < now() - interval '2 months';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

--
-- Name: purge_old_audit_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_audit_log() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can clear the change history';
  END IF;
  RETURN public.purge_audit_log_internal();
END;
$$;

--
-- Name: recalc_all_totals_internal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_all_totals_internal() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_count integer := 0; r record;
BEGIN
  FOR r IN SELECT id FROM public.people LOOP
    PERFORM public.recalc_person_totals(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

--
-- Name: recalc_person_totals(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_person_totals(_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: recalculate_all_giving_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_all_giving_totals() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: record_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: registrations_sync_timeline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrations_sync_timeline() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_event record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.interactions
     WHERE source_kind = 'event_attendance' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name, date INTO v_event FROM public.events WHERE id = NEW.event_id;

  IF LOWER(TRIM(COALESCE(NEW.status, ''))) = 'attended' THEN
    INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
    VALUES (NEW.person_id, 'event', COALESCE(v_event.date, CURRENT_DATE),
            'Attended ' || COALESCE(v_event.name, 'an event'), NULL,
            'event_attendance', NEW.id)
    ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET person_id = EXCLUDED.person_id,
                  date = EXCLUDED.date,
                  text = EXCLUDED.text;
  ELSE
    DELETE FROM public.interactions
     WHERE source_kind = 'event_attendance' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: save_integration_credentials(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_integration_credentials(_provider text, _credentials jsonb, _primary_field text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

--
-- Name: search_people(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_people(_q text, _limit integer DEFAULT 200) RETURNS TABLE(person_id uuid, reason text, score real)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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
  SELECT cm.person_id,
         CASE WHEN cm.kind = 'email' THEN 'Email' ELSE 'Phone' END,
         cm.method_type || ': ' || cm.value,
         cm.value
    FROM public.contact_methods cm
    JOIN public.people p ON p.id = cm.person_id
   WHERE p.deleted_at IS NULL
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
$$;

--
-- Name: sync_person_display_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_person_display_name() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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

--
-- Name: sync_primary_contact_method(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_primary_contact_method(_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_phone text;
  v_email text;
BEGIN
  IF _person_id IS NULL THEN RETURN; END IF;

  SELECT value INTO v_phone FROM public.contact_methods
   WHERE person_id = _person_id AND kind = 'phone'
   ORDER BY is_primary DESC, created_at ASC LIMIT 1;

  SELECT value INTO v_email FROM public.contact_methods
   WHERE person_id = _person_id AND kind = 'email'
   ORDER BY is_primary DESC, created_at ASC LIMIT 1;

  UPDATE public.people
     SET phone = COALESCE(v_phone, phone),
         email = COALESCE(v_email, email)
   WHERE id = _person_id;
END;
$$;

--
-- Name: tag_program_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tag_program_counts() RETURNS TABLE(kind text, label text, contacts bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: tasks_sync_thank_you(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_sync_thank_you() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_done_before boolean := COALESCE(OLD.status, '') = 'done';
  v_done_now boolean := NEW.status = 'done';
BEGIN
  -- Reopening or archiving a task removes the activity entry it wrote.
  IF (v_done_before AND NOT v_done_now)
     OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    DELETE FROM public.interactions
     WHERE source_kind = 'task_completion' AND source_id = NEW.id;
  END IF;

  IF NEW.donation_id IS NOT NULL
     AND COALESCE(current_setting('mh.reversing', true), '') <> 'on' THEN
    PERFORM set_config('mh.reversing', 'on', true);
    IF v_done_now AND NOT v_done_before AND NEW.deleted_at IS NULL THEN
      PERFORM public.mark_thank_you_sent(NEW.donation_id, true);
    ELSIF v_done_before AND NOT v_done_now THEN
      PERFORM public.mark_thank_you_sent(NEW.donation_id, false);
    END IF;
    PERFORM set_config('mh.reversing', 'off', true);
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: undo_import(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_import(_batch_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
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

  DELETE FROM public.registrations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.tasks WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.donations WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.interactions WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.contact_methods WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.field_sources WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);
  DELETE FROM public.yahrzeits WHERE person_id IN (SELECT id FROM public.people WHERE import_batch_id = _batch_id);

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

  SELECT count(*) INTO _kept_households FROM public.households h WHERE h.import_batch_id = _batch_id;
  UPDATE public.import_batches SET status = 'reverted' WHERE id = _batch_id;
  PERFORM set_config('app.privileged_op', 'off', true);

  RETURN jsonb_build_object(
    'people', _people, 'households', _households, 'donations', _donations,
    'interactions', _interactions, 'field_sources', _sources, 'review_items', _review,
    'contact_methods', _methods, 'tasks', _tasks, 'registrations', _regs,
    'kept_existing_people', _kept_people, 'kept_households', _kept_households
  );
END;
$$;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'active'::text, 'completed'::text, 'archived'::text])))
);

--
-- Name: contact_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    kind text DEFAULT 'phone'::text NOT NULL,
    value text NOT NULL,
    method_type text DEFAULT 'Mobile'::text NOT NULL,
    label text,
    is_primary boolean DEFAULT false NOT NULL,
    import_batch_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: donations; Type: TABLE; Schema: public; Owner: -
--

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
    deleted_at timestamp with time zone,
    thank_you_sent boolean DEFAULT false NOT NULL,
    thank_you_sent_date date,
    receipt_sent boolean DEFAULT false NOT NULL,
    receipt_sent_date date,
    event_id uuid,
    import_fingerprint text
);

--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: field_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    field_name text NOT NULL,
    source text NOT NULL,
    recorded_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    import_batch_id uuid
);

--
-- Name: grants; Type: TABLE; Schema: public; Owner: -
--

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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grants_stage_check CHECK ((stage = ANY (ARRAY['researching'::text, 'LOI submitted'::text, 'applied'::text, 'awarded'::text, 'declined'::text, 'reporting due'::text, 'reported'::text, 'renewal eligible'::text])))
);

--
-- Name: households; Type: TABLE; Schema: public; Owner: -
--

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
    county text,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT households_status_check CHECK ((status = ANY (ARRAY['active'::text, 'address_only'::text])))
);

--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: integration_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vault_secret_id uuid,
    masked_hint text,
    credential_keys text[] DEFAULT '{}'::text[] NOT NULL
);

--
-- Name: integration_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    kind text DEFAULT 'test'::text NOT NULL,
    ok boolean DEFAULT false NOT NULL,
    message text,
    actor_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    purpose text,
    status text DEFAULT 'not_connected'::text NOT NULL,
    last_sync_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    type text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    text text,
    author text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    import_batch_id uuid,
    source_kind text,
    source_id uuid,
    household_id uuid,
    CONSTRAINT interactions_subject_check CHECK (((person_id IS NOT NULL) OR (household_id IS NOT NULL))),
    CONSTRAINT interactions_type_check CHECK ((type = ANY (ARRAY['note'::text, 'call'::text, 'donation'::text, 'event'::text, 'volunteer'::text, 'form'::text])))
);

--
-- Name: COLUMN interactions.source_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.interactions.source_kind IS 'What wrote this entry: donation_gift, donation_thank_you, donation_receipt, event_attendance, task_completion.';

--
-- Name: merge_log; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: met_source_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.met_source_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

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
    anniversary_date date,
    household_relationship text,
    gender text,
    mailing_preference text,
    CONSTRAINT people_contact_type_check CHECK ((contact_type = ANY (ARRAY['individual'::text, 'organization'::text, 'foundation'::text]))),
    CONSTRAINT people_gender_check CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['male'::text, 'female'::text])))),
    CONSTRAINT people_mailing_preference_check CHECK (((mailing_preference IS NULL) OR (mailing_preference = ANY (ARRAY['household'::text, 'own'::text])))),
    CONSTRAINT people_role_check CHECK ((role = ANY (ARRAY['Adult'::text, 'Child'::text])))
);

--
-- Name: program_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    person_id uuid NOT NULL,
    status text DEFAULT 'registered'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    import_batch_id uuid,
    CONSTRAINT registrations_status_check CHECK ((status = ANY (ARRAY['registered'::text, 'attended'::text, 'no_show'::text])))
);

--
-- Name: review_queue; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: staff_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role public.app_role DEFAULT 'va'::public.app_role NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

--
-- Name: tag_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

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
    deleted_at timestamp with time zone,
    donation_id uuid,
    import_batch_id uuid,
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'overdue'::text, 'done'::text])))
);

--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: yahrzeits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.yahrzeits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    deceased_name text NOT NULL,
    relationship text,
    hebrew_month integer NOT NULL,
    hebrew_day integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT yahrzeits_hebrew_day_check CHECK (((hebrew_day >= 1) AND (hebrew_day <= 30))),
    CONSTRAINT yahrzeits_hebrew_month_check CHECK (((hebrew_month >= 1) AND (hebrew_month <= 13)))
);

--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

--
-- Name: contact_methods contact_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_methods
    ADD CONSTRAINT contact_methods_pkey PRIMARY KEY (id);

--
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);

--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

--
-- Name: field_sources field_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_sources
    ADD CONSTRAINT field_sources_pkey PRIMARY KEY (id);

--
-- Name: grants grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grants
    ADD CONSTRAINT grants_pkey PRIMARY KEY (id);

--
-- Name: households households_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_pkey PRIMARY KEY (id);

--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);

--
-- Name: integration_credentials integration_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_pkey PRIMARY KEY (id);

--
-- Name: integration_credentials integration_credentials_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_provider_key UNIQUE (provider);

--
-- Name: integration_events integration_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_pkey PRIMARY KEY (id);

--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);

--
-- Name: interactions interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_pkey PRIMARY KEY (id);

--
-- Name: merge_log merge_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_log
    ADD CONSTRAINT merge_log_pkey PRIMARY KEY (id);

--
-- Name: met_source_options met_source_options_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.met_source_options
    ADD CONSTRAINT met_source_options_label_key UNIQUE (label);

--
-- Name: met_source_options met_source_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.met_source_options
    ADD CONSTRAINT met_source_options_pkey PRIMARY KEY (id);

--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);

--
-- Name: program_options program_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_options
    ADD CONSTRAINT program_options_pkey PRIMARY KEY (id);

--
-- Name: registrations registrations_event_id_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_event_id_person_id_key UNIQUE (event_id, person_id);

--
-- Name: registrations registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);

--
-- Name: review_queue review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_queue
    ADD CONSTRAINT review_queue_pkey PRIMARY KEY (id);

--
-- Name: staff_members staff_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_members
    ADD CONSTRAINT staff_members_pkey PRIMARY KEY (id);

--
-- Name: tag_options tag_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_options
    ADD CONSTRAINT tag_options_pkey PRIMARY KEY (id);

--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

--
-- Name: yahrzeits yahrzeits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yahrzeits
    ADD CONSTRAINT yahrzeits_pkey PRIMARY KEY (id);

--
-- Name: audit_log_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_created_idx ON public.audit_log USING btree (created_at DESC);

--
-- Name: audit_log_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_record_idx ON public.audit_log USING btree (table_name, record_id, created_at DESC);

--
-- Name: campaigns_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_name_trgm ON public.campaigns USING gin (lower(COALESCE(name, ''::text)) public.gin_trgm_ops);

--
-- Name: donations_campaign_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_campaign_id_idx ON public.donations USING btree (campaign_id);

--
-- Name: donations_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_date_idx ON public.donations USING btree (date DESC);

--
-- Name: donations_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_event_id_idx ON public.donations USING btree (event_id);

--
-- Name: donations_grant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_grant_id_idx ON public.donations USING btree (grant_id);

--
-- Name: donations_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_import_batch_idx ON public.donations USING btree (import_batch_id);

--
-- Name: donations_import_fingerprint_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donations_import_fingerprint_unique ON public.donations USING btree (import_fingerprint) WHERE ((import_fingerprint IS NOT NULL) AND (deleted_at IS NULL));

--
-- Name: donations_import_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donations_import_unique ON public.donations USING btree (person_id, amount, date, COALESCE(campaign, ''::text)) WHERE ((import_batch_id IS NOT NULL) AND (deleted_at IS NULL));

--
-- Name: donations_not_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_not_deleted_idx ON public.donations USING btree (deleted_at) WHERE (deleted_at IS NULL);

--
-- Name: donations_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_person_id_idx ON public.donations USING btree (person_id);

--
-- Name: events_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_date_idx ON public.events USING btree (date DESC);

--
-- Name: events_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_name_trgm ON public.events USING gin (lower(COALESCE(name, ''::text)) public.gin_trgm_ops);

--
-- Name: events_not_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_not_deleted_idx ON public.events USING btree (deleted_at) WHERE (deleted_at IS NULL);

--
-- Name: field_sources_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_sources_import_batch_idx ON public.field_sources USING btree (import_batch_id);

--
-- Name: field_sources_person_field_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_sources_person_field_idx ON public.field_sources USING btree (person_id, field_name);

--
-- Name: field_sources_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_sources_person_id_idx ON public.field_sources USING btree (person_id, field_name);

--
-- Name: grants_application_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_application_deadline_idx ON public.grants USING btree (application_deadline);

--
-- Name: grants_campaign_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_campaign_id_idx ON public.grants USING btree (campaign_id);

--
-- Name: grants_funder_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_funder_id_idx ON public.grants USING btree (funder_id);

--
-- Name: grants_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_name_trgm ON public.grants USING gin (lower(COALESCE(name, ''::text)) public.gin_trgm_ops);

--
-- Name: grants_report_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_report_deadline_idx ON public.grants USING btree (report_deadline);

--
-- Name: grants_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grants_stage_idx ON public.grants USING btree (stage);

--
-- Name: households_address_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_address_trgm ON public.households USING gin (lower(COALESCE(address, ''::text)) public.gin_trgm_ops);

--
-- Name: households_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_import_batch_idx ON public.households USING btree (import_batch_id);

--
-- Name: households_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_name_trgm ON public.households USING gin (lower(COALESCE(name, ''::text)) public.gin_trgm_ops);

--
-- Name: households_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_status_idx ON public.households USING btree (status);

--
-- Name: idx_contact_methods_digits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_methods_digits ON public.contact_methods USING btree ("right"(regexp_replace(value, '\D'::text, ''::text, 'g'::text), 10));

--
-- Name: idx_contact_methods_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_methods_kind ON public.contact_methods USING btree (kind);

--
-- Name: idx_contact_methods_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_methods_person ON public.contact_methods USING btree (person_id);

--
-- Name: idx_contact_methods_value_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_methods_value_trgm ON public.contact_methods USING gin (value public.gin_trgm_ops);

--
-- Name: idx_donations_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations_campaign_id ON public.donations USING btree (campaign_id);

--
-- Name: idx_donations_grant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations_grant_id ON public.donations USING btree (grant_id);

--
-- Name: idx_donations_thank_you; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_donations_thank_you ON public.donations USING btree (thank_you_sent, date DESC);

--
-- Name: idx_grants_funder_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grants_funder_id ON public.grants USING btree (funder_id);

--
-- Name: idx_grants_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grants_stage ON public.grants USING btree (stage);

--
-- Name: idx_people_contact_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_people_contact_type ON public.people USING btree (contact_type);

--
-- Name: idx_people_parent_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_people_parent_org_id ON public.people USING btree (parent_org_id);

--
-- Name: idx_tasks_donation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_donation ON public.tasks USING btree (donation_id);

--
-- Name: idx_tasks_grant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_grant_id ON public.tasks USING btree (grant_id);

--
-- Name: integration_events_provider_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_events_provider_created_idx ON public.integration_events USING btree (provider, created_at DESC);

--
-- Name: interactions_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_household_idx ON public.interactions USING btree (household_id, date DESC);

--
-- Name: interactions_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_import_batch_idx ON public.interactions USING btree (import_batch_id);

--
-- Name: interactions_person_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_person_id_date_idx ON public.interactions USING btree (person_id, date DESC);

--
-- Name: interactions_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_person_id_idx ON public.interactions USING btree (person_id, date DESC);

--
-- Name: interactions_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_source_id_idx ON public.interactions USING btree (source_id);

--
-- Name: interactions_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interactions_source_unique ON public.interactions USING btree (source_kind, source_id) WHERE ((source_kind IS NOT NULL) AND (source_id IS NOT NULL));

--
-- Name: interactions_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interactions_text_trgm ON public.interactions USING gin (lower(COALESCE(text, ''::text)) public.gin_trgm_ops);

--
-- Name: people_birth_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_birth_date_idx ON public.people USING btree (birth_date);

--
-- Name: people_contact_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_contact_type_idx ON public.people USING btree (contact_type);

--
-- Name: people_display_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_display_name_idx ON public.people USING btree (lower(display_name));

--
-- Name: people_display_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_display_name_trgm ON public.people USING gin (lower(COALESCE(display_name, ''::text)) public.gin_trgm_ops);

--
-- Name: people_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_email_idx ON public.people USING btree (lower(email));

--
-- Name: people_email_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_email_lookup ON public.people USING btree (email) WHERE ((email IS NOT NULL) AND (deleted_at IS NULL));

--
-- Name: people_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_email_trgm ON public.people USING gin (lower(COALESCE(email, ''::text)) public.gin_trgm_ops);

--
-- Name: people_first_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_first_name_trgm ON public.people USING gin (lower(COALESCE(first_name, ''::text)) public.gin_trgm_ops);

--
-- Name: people_household_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_household_id_idx ON public.people USING btree (household_id);

--
-- Name: people_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_import_batch_idx ON public.people USING btree (import_batch_id);

--
-- Name: people_last_activity_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_last_activity_date_idx ON public.people USING btree (last_activity_date);

--
-- Name: people_last_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_last_name_idx ON public.people USING btree (last_name);

--
-- Name: people_last_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_last_name_trgm ON public.people USING gin (lower(COALESCE(last_name, ''::text)) public.gin_trgm_ops);

--
-- Name: people_not_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_not_deleted_idx ON public.people USING btree (deleted_at) WHERE (deleted_at IS NULL);

--
-- Name: people_parent_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_parent_org_id_idx ON public.people USING btree (parent_org_id);

--
-- Name: people_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_phone_idx ON public.people USING btree (phone);

--
-- Name: people_programs_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_programs_gin ON public.people USING gin (programs);

--
-- Name: people_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_tags_gin ON public.people USING gin (tags);

--
-- Name: registrations_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_event_id_idx ON public.registrations USING btree (event_id);

--
-- Name: registrations_event_person_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX registrations_event_person_unique ON public.registrations USING btree (event_id, person_id);

--
-- Name: registrations_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_import_batch_idx ON public.registrations USING btree (import_batch_id);

--
-- Name: registrations_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_person_id_idx ON public.registrations USING btree (person_id);

--
-- Name: review_queue_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_queue_status_idx ON public.review_queue USING btree (status);

--
-- Name: staff_members_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_members_email_key ON public.staff_members USING btree (lower(email));

--
-- Name: staff_members_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_members_user_id_key ON public.staff_members USING btree (user_id) WHERE (user_id IS NOT NULL);

--
-- Name: tasks_completed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_completed_at_idx ON public.tasks USING btree (completed_at DESC);

--
-- Name: tasks_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_import_batch_idx ON public.tasks USING btree (import_batch_id);

--
-- Name: tasks_not_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_not_deleted_idx ON public.tasks USING btree (deleted_at) WHERE (deleted_at IS NULL);

--
-- Name: tasks_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_person_id_idx ON public.tasks USING btree (person_id);

--
-- Name: tasks_status_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_status_due_idx ON public.tasks USING btree (status, due_date);

--
-- Name: tasks_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_text_trgm ON public.tasks USING gin (lower(COALESCE(text, ''::text)) public.gin_trgm_ops);

--
-- Name: yahrzeits_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX yahrzeits_person_id_idx ON public.yahrzeits USING btree (person_id);

--
-- Name: campaigns campaigns_admin_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER campaigns_admin_delete BEFORE DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();

--
-- Name: campaigns campaigns_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER campaigns_audit AFTER INSERT OR DELETE OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: contact_methods contact_methods_after_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_methods_after_change AFTER INSERT OR DELETE OR UPDATE ON public.contact_methods FOR EACH ROW EXECUTE FUNCTION public.contact_methods_after_change();

--
-- Name: contact_methods contact_methods_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_methods_audit AFTER INSERT OR DELETE OR UPDATE ON public.contact_methods FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: contact_methods contact_methods_normalize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_methods_normalize BEFORE INSERT OR UPDATE ON public.contact_methods FOR EACH ROW EXECUTE FUNCTION public.normalize_contact_method();

--
-- Name: contact_methods contact_methods_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_methods_validate BEFORE INSERT OR UPDATE ON public.contact_methods FOR EACH ROW EXECUTE FUNCTION public.contact_methods_validate();

--
-- Name: donations donations_admin_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_admin_archive BEFORE DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();

--
-- Name: donations donations_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_audit AFTER INSERT OR DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: donations donations_refresh_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_refresh_totals AFTER INSERT OR DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.donations_refresh_totals();

--
-- Name: donations donations_sync_timeline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_sync_timeline AFTER INSERT OR DELETE OR UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.donations_sync_timeline();

--
-- Name: events events_admin_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_admin_archive BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();

--
-- Name: events events_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_audit AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: grants grants_admin_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER grants_admin_delete BEFORE DELETE ON public.grants FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();

--
-- Name: grants grants_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER grants_audit AFTER INSERT OR DELETE OR UPDATE ON public.grants FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: households households_admin_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER households_admin_delete BEFORE DELETE ON public.households FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete();

--
-- Name: interactions interactions_refresh_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER interactions_refresh_totals AFTER INSERT OR DELETE OR UPDATE ON public.interactions FOR EACH ROW EXECUTE FUNCTION public.interactions_refresh_totals();

--
-- Name: people people_admin_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_admin_archive BEFORE DELETE OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();

--
-- Name: people people_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_audit AFTER INSERT OR DELETE OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: people people_normalize_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_normalize_identity BEFORE INSERT OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.normalize_person_identity();

--
-- Name: people people_sync_display_name; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_sync_display_name BEFORE INSERT OR UPDATE OF first_name, last_name, display_name, contact_type ON public.people FOR EACH ROW EXECUTE FUNCTION public.sync_person_display_name();

--
-- Name: registrations registrations_sync_timeline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER registrations_sync_timeline AFTER INSERT OR DELETE OR UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION public.registrations_sync_timeline();

--
-- Name: tasks tasks_admin_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_admin_archive BEFORE DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_archive();

--
-- Name: tasks tasks_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_audit AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.record_audit();

--
-- Name: tasks tasks_sync_thank_you; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_sync_thank_you AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_thank_you();

--
-- Name: app_settings update_app_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: campaigns update_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: contact_methods update_contact_methods_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_contact_methods_updated_at BEFORE UPDATE ON public.contact_methods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: grants update_grants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_grants_updated_at BEFORE UPDATE ON public.grants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: integration_credentials update_integration_credentials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_integration_credentials_updated_at BEFORE UPDATE ON public.integration_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: campaigns campaigns_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

--
-- Name: contact_methods contact_methods_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_methods
    ADD CONSTRAINT contact_methods_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id);

--
-- Name: contact_methods contact_methods_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_methods
    ADD CONSTRAINT contact_methods_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: donations donations_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;

--
-- Name: donations donations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

--
-- Name: donations donations_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.grants(id) ON DELETE SET NULL;

--
-- Name: donations donations_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: donations donations_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: field_sources field_sources_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_sources
    ADD CONSTRAINT field_sources_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: field_sources field_sources_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_sources
    ADD CONSTRAINT field_sources_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: grants grants_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grants
    ADD CONSTRAINT grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;

--
-- Name: grants grants_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grants
    ADD CONSTRAINT grants_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.people(id) ON DELETE RESTRICT;

--
-- Name: grants grants_program_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grants
    ADD CONSTRAINT grants_program_officer_id_fkey FOREIGN KEY (program_officer_id) REFERENCES public.people(id) ON DELETE SET NULL;

--
-- Name: households households_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: interactions interactions_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;

--
-- Name: interactions interactions_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: interactions interactions_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: merge_log merge_log_surviving_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_log
    ADD CONSTRAINT merge_log_surviving_person_id_fkey FOREIGN KEY (surviving_person_id) REFERENCES public.people(id) ON DELETE SET NULL;

--
-- Name: people people_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE SET NULL;

--
-- Name: people people_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: people people_parent_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_parent_org_id_fkey FOREIGN KEY (parent_org_id) REFERENCES public.people(id) ON DELETE SET NULL;

--
-- Name: registrations registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

--
-- Name: registrations registrations_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: registrations registrations_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: review_queue review_queue_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_queue
    ADD CONSTRAINT review_queue_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.grants(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;

--
-- Name: tasks tasks_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: yahrzeits yahrzeits_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yahrzeits
    ADD CONSTRAINT yahrzeits_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

--
-- Name: app_settings Admins can add settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can add settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin());

--
-- Name: app_settings Admins can change settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can change settings" ON public.app_settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: integrations Admins manage integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage integrations" ON public.integrations TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: user_roles Admins manage roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage roles" ON public.user_roles TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: staff_members Admins manage staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage staff" ON public.staff_members TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

--
-- Name: user_roles Authenticated staff can read roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated staff can read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);

--
-- Name: app_settings Signed-in staff can read settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Signed-in staff can read settings" ON public.app_settings FOR SELECT TO authenticated USING (true);

--
-- Name: integrations Staff can read integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read integrations" ON public.integrations FOR SELECT TO authenticated USING (true);

--
-- Name: merge_log Staff can read merge log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read merge log" ON public.merge_log FOR SELECT TO authenticated USING (true);

--
-- Name: audit_log Staff can read the change history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read the change history" ON public.audit_log FOR SELECT TO authenticated USING (true);

--
-- Name: staff_members Staff can read the staff list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read the staff list" ON public.staff_members FOR SELECT TO authenticated USING (true);

--
-- Name: campaigns Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.campaigns TO authenticated USING (true) WITH CHECK (true);

--
-- Name: contact_methods Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.contact_methods TO authenticated USING (true) WITH CHECK (true);

--
-- Name: donations Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.donations TO authenticated USING (true) WITH CHECK (true);

--
-- Name: events Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.events TO authenticated USING (true) WITH CHECK (true);

--
-- Name: field_sources Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.field_sources TO authenticated USING (true) WITH CHECK (true);

--
-- Name: grants Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.grants TO authenticated USING (true) WITH CHECK (true);

--
-- Name: households Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.households TO authenticated USING (true) WITH CHECK (true);

--
-- Name: import_batches Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.import_batches TO authenticated USING (true) WITH CHECK (true);

--
-- Name: interactions Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.interactions TO authenticated USING (true) WITH CHECK (true);

--
-- Name: met_source_options Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.met_source_options TO authenticated USING (true) WITH CHECK (true);

--
-- Name: people Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.people TO authenticated USING (true) WITH CHECK (true);

--
-- Name: program_options Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.program_options TO authenticated USING (true) WITH CHECK (true);

--
-- Name: registrations Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.registrations TO authenticated USING (true) WITH CHECK (true);

--
-- Name: review_queue Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.review_queue TO authenticated USING (true) WITH CHECK (true);

--
-- Name: tag_options Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.tag_options TO authenticated USING (true) WITH CHECK (true);

--
-- Name: tasks Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.tasks TO authenticated USING (true) WITH CHECK (true);

--
-- Name: yahrzeits Staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff full access" ON public.yahrzeits TO authenticated USING (true) WITH CHECK (true);

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: donations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: field_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grants ENABLE ROW LEVEL SECURITY;

--
-- Name: households; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: merge_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merge_log ENABLE ROW LEVEL SECURITY;

--
-- Name: met_source_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.met_source_options ENABLE ROW LEVEL SECURITY;

--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: program_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_options ENABLE ROW LEVEL SECURITY;

--
-- Name: registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_options ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: yahrzeits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.yahrzeits ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO sandbox_exec;

--
-- Name: FUNCTION contact_methods_after_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contact_methods_after_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.contact_methods_after_change() TO service_role;

--
-- Name: FUNCTION contact_methods_validate(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.contact_methods_validate() TO anon;
GRANT ALL ON FUNCTION public.contact_methods_validate() TO authenticated;
GRANT ALL ON FUNCTION public.contact_methods_validate() TO service_role;

--
-- Name: FUNCTION delete_integration_credentials(_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_integration_credentials(_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_integration_credentials(_provider text) TO service_role;

--
-- Name: FUNCTION donations_refresh_totals(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.donations_refresh_totals() FROM PUBLIC;
GRANT ALL ON FUNCTION public.donations_refresh_totals() TO service_role;

--
-- Name: FUNCTION donations_sync_timeline(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.donations_sync_timeline() FROM PUBLIC;
GRANT ALL ON FUNCTION public.donations_sync_timeline() TO service_role;

--
-- Name: FUNCTION enforce_admin_archive(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_admin_archive() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_admin_archive() TO service_role;

--
-- Name: FUNCTION enforce_admin_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_admin_delete() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_admin_delete() TO service_role;

--
-- Name: FUNCTION find_duplicate_people(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_duplicate_people() FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_duplicate_people() TO authenticated;
GRANT ALL ON FUNCTION public.find_duplicate_people() TO service_role;

--
-- Name: FUNCTION get_integration_credentials(_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_integration_credentials(_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_integration_credentials(_provider text) TO service_role;

--
-- Name: FUNCTION giving_total_mismatches(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.giving_total_mismatches() FROM PUBLIC;
GRANT ALL ON FUNCTION public.giving_total_mismatches() TO authenticated;
GRANT ALL ON FUNCTION public.giving_total_mismatches() TO service_role;

--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;

--
-- Name: FUNCTION interactions_refresh_totals(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.interactions_refresh_totals() FROM PUBLIC;
GRANT ALL ON FUNCTION public.interactions_refresh_totals() TO service_role;

--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;

--
-- Name: FUNCTION lapsed_donors(_mode text, _min_total numeric, _min_prior_years integer, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lapsed_donors(_mode text, _min_total numeric, _min_prior_years integer, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lapsed_donors(_mode text, _min_total numeric, _min_prior_years integer, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.lapsed_donors(_mode text, _min_total numeric, _min_prior_years integer, _limit integer) TO service_role;

--
-- Name: FUNCTION log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.log_import_review_merge(_item_id uuid, _person_id uuid, _existing_before jsonb, _incoming jsonb, _surviving_after jsonb, _choices jsonb) TO service_role;

--
-- Name: FUNCTION log_review_decision(_item_id uuid, _decision text, _reason text, _person_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_review_decision(_item_id uuid, _decision text, _reason text, _person_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_review_decision(_item_id uuid, _decision text, _reason text, _person_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.log_review_decision(_item_id uuid, _decision text, _reason text, _person_id uuid) TO service_role;

--
-- Name: FUNCTION mark_receipt_sent(_donation_id uuid, _sent boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_receipt_sent(_donation_id uuid, _sent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_receipt_sent(_donation_id uuid, _sent boolean) TO authenticated;
GRANT ALL ON FUNCTION public.mark_receipt_sent(_donation_id uuid, _sent boolean) TO service_role;

--
-- Name: FUNCTION mark_thank_you_sent(_donation_id uuid, _sent boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean) TO authenticated;
GRANT ALL ON FUNCTION public.mark_thank_you_sent(_donation_id uuid, _sent boolean) TO service_role;

--
-- Name: FUNCTION merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.merge_households(_surviving_id uuid, _merged_id uuid, _field_values jsonb) TO service_role;

--
-- Name: FUNCTION merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.merge_people(_surviving_id uuid, _merged_id uuid, _field_values jsonb) TO service_role;

--
-- Name: FUNCTION money_text(_amount numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.money_text(_amount numeric) TO anon;
GRANT ALL ON FUNCTION public.money_text(_amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.money_text(_amount numeric) TO service_role;

--
-- Name: FUNCTION normalize_contact_method(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_contact_method() TO anon;
GRANT ALL ON FUNCTION public.normalize_contact_method() TO authenticated;
GRANT ALL ON FUNCTION public.normalize_contact_method() TO service_role;

--
-- Name: FUNCTION normalize_person_identity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_person_identity() TO anon;
GRANT ALL ON FUNCTION public.normalize_person_identity() TO authenticated;
GRANT ALL ON FUNCTION public.normalize_person_identity() TO service_role;

--
-- Name: FUNCTION purge_audit_log_internal(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_audit_log_internal() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_audit_log_internal() TO service_role;

--
-- Name: FUNCTION purge_old_audit_log(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_old_audit_log() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_old_audit_log() TO authenticated;
GRANT ALL ON FUNCTION public.purge_old_audit_log() TO service_role;

--
-- Name: FUNCTION recalc_all_totals_internal(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalc_all_totals_internal() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recalc_all_totals_internal() TO service_role;

--
-- Name: FUNCTION recalc_person_totals(_person_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalc_person_totals(_person_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recalc_person_totals(_person_id uuid) TO service_role;

--
-- Name: FUNCTION recalculate_all_giving_totals(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalculate_all_giving_totals() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recalculate_all_giving_totals() TO authenticated;
GRANT ALL ON FUNCTION public.recalculate_all_giving_totals() TO service_role;

--
-- Name: FUNCTION record_audit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_audit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_audit() TO service_role;

--
-- Name: FUNCTION registrations_sync_timeline(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrations_sync_timeline() FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrations_sync_timeline() TO service_role;

--
-- Name: FUNCTION save_integration_credentials(_provider text, _credentials jsonb, _primary_field text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_integration_credentials(_provider text, _credentials jsonb, _primary_field text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_integration_credentials(_provider text, _credentials jsonb, _primary_field text) TO service_role;

--
-- Name: FUNCTION search_people(_q text, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.search_people(_q text, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_people(_q text, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_people(_q text, _limit integer) TO service_role;

--
-- Name: FUNCTION sync_person_display_name(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_person_display_name() TO service_role;

--
-- Name: FUNCTION sync_primary_contact_method(_person_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_primary_contact_method(_person_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_primary_contact_method(_person_id uuid) TO service_role;

--
-- Name: FUNCTION tag_program_counts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tag_program_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tag_program_counts() TO authenticated;
GRANT ALL ON FUNCTION public.tag_program_counts() TO service_role;

--
-- Name: FUNCTION tasks_sync_thank_you(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tasks_sync_thank_you() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tasks_sync_thank_you() TO service_role;

--
-- Name: FUNCTION undo_import(_batch_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.undo_import(_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.undo_import(_batch_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.undo_import(_batch_id uuid) TO service_role;

--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;

--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT,INSERT ON TABLE public.app_settings TO sandbox_exec;

--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.audit_log TO sandbox_exec;

--
-- Name: TABLE campaigns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.campaigns TO authenticated;
GRANT ALL ON TABLE public.campaigns TO service_role;
GRANT SELECT,INSERT ON TABLE public.campaigns TO sandbox_exec;

--
-- Name: TABLE contact_methods; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_methods TO authenticated;
GRANT ALL ON TABLE public.contact_methods TO service_role;
GRANT SELECT,INSERT ON TABLE public.contact_methods TO sandbox_exec;

--
-- Name: TABLE donations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.donations TO authenticated;
GRANT ALL ON TABLE public.donations TO service_role;
GRANT SELECT,INSERT ON TABLE public.donations TO sandbox_exec;

--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;
GRANT SELECT,INSERT ON TABLE public.events TO sandbox_exec;

--
-- Name: TABLE field_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_sources TO authenticated;
GRANT ALL ON TABLE public.field_sources TO service_role;
GRANT SELECT,INSERT ON TABLE public.field_sources TO sandbox_exec;

--
-- Name: TABLE grants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.grants TO authenticated;
GRANT ALL ON TABLE public.grants TO service_role;
GRANT SELECT,INSERT ON TABLE public.grants TO sandbox_exec;

--
-- Name: TABLE households; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.households TO authenticated;
GRANT ALL ON TABLE public.households TO service_role;
GRANT SELECT,INSERT ON TABLE public.households TO sandbox_exec;

--
-- Name: TABLE import_batches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.import_batches TO authenticated;
GRANT ALL ON TABLE public.import_batches TO service_role;
GRANT SELECT,INSERT ON TABLE public.import_batches TO sandbox_exec;

--
-- Name: TABLE integration_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_credentials TO authenticated;
GRANT ALL ON TABLE public.integration_credentials TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_credentials TO sandbox_exec;

--
-- Name: TABLE integration_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_events TO authenticated;
GRANT ALL ON TABLE public.integration_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_events TO sandbox_exec;

--
-- Name: TABLE integrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integrations TO authenticated;
GRANT ALL ON TABLE public.integrations TO service_role;
GRANT SELECT,INSERT ON TABLE public.integrations TO sandbox_exec;

--
-- Name: TABLE interactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.interactions TO authenticated;
GRANT ALL ON TABLE public.interactions TO service_role;
GRANT SELECT,INSERT ON TABLE public.interactions TO sandbox_exec;

--
-- Name: TABLE merge_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merge_log TO authenticated;
GRANT ALL ON TABLE public.merge_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.merge_log TO sandbox_exec;

--
-- Name: TABLE met_source_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.met_source_options TO authenticated;
GRANT ALL ON TABLE public.met_source_options TO service_role;
GRANT SELECT,INSERT ON TABLE public.met_source_options TO sandbox_exec;

--
-- Name: TABLE people; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.people TO authenticated;
GRANT ALL ON TABLE public.people TO service_role;
GRANT SELECT,INSERT ON TABLE public.people TO sandbox_exec;

--
-- Name: TABLE program_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.program_options TO authenticated;
GRANT ALL ON TABLE public.program_options TO service_role;
GRANT SELECT,INSERT ON TABLE public.program_options TO sandbox_exec;

--
-- Name: TABLE registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.registrations TO authenticated;
GRANT ALL ON TABLE public.registrations TO service_role;
GRANT SELECT,INSERT ON TABLE public.registrations TO sandbox_exec;

--
-- Name: TABLE review_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.review_queue TO authenticated;
GRANT ALL ON TABLE public.review_queue TO service_role;
GRANT SELECT,INSERT ON TABLE public.review_queue TO sandbox_exec;

--
-- Name: TABLE staff_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_members TO authenticated;
GRANT ALL ON TABLE public.staff_members TO service_role;
GRANT SELECT,INSERT ON TABLE public.staff_members TO sandbox_exec;

--
-- Name: TABLE tag_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tag_options TO authenticated;
GRANT ALL ON TABLE public.tag_options TO service_role;
GRANT SELECT,INSERT ON TABLE public.tag_options TO sandbox_exec;

--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;
GRANT SELECT,INSERT ON TABLE public.tasks TO sandbox_exec;

--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT,INSERT ON TABLE public.user_roles TO sandbox_exec;

--
-- Name: TABLE yahrzeits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.yahrzeits TO authenticated;
GRANT ALL ON TABLE public.yahrzeits TO service_role;
GRANT SELECT,INSERT ON TABLE public.yahrzeits TO sandbox_exec;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO sandbox_exec;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO sandbox_exec;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
--

\unrestrict ySumauDSQtuqfnt9fCrjYSKQnZ34PMCodySbsHG7oTffjO4zrrxaoaZOykXo5db
