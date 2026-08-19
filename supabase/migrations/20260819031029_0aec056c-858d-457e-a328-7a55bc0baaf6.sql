-- 1. Yahrzeit sunset rule
ALTER TABLE public.yahrzeits
  ADD COLUMN IF NOT EXISTS death_date date,
  ADD COLUMN IF NOT EXISTS death_after_sunset boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_sunset_review boolean NOT NULL DEFAULT false;

-- Existing rows predate the sunset question: flag them for staff review.
UPDATE public.yahrzeits SET needs_sunset_review = true WHERE created_at < now();

-- 2. Substantiation flags on gifts
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS goods_or_services_provided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS goods_or_services_description text;

-- 3. Issued documents (generation separate from delivery)
CREATE TABLE IF NOT EXISTS public.issued_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('tax_statement', 'acknowledgment')),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tax_year integer,
  donation_id uuid REFERENCES public.donations(id) ON DELETE CASCADE,
  gift_ids uuid[] NOT NULL DEFAULT '{}',
  gift_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  delivery_method text NOT NULL DEFAULT 'printed'
    CHECK (delivery_method IN ('printed', 'email', 'text', 'constant_contact')),
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  delivery_note text,
  delivered_at timestamp with time zone,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  issued_by uuid,
  issued_by_email text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.issued_documents TO authenticated;
GRANT ALL ON public.issued_documents TO service_role;

ALTER TABLE public.issued_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read issued documents"
  ON public.issued_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can create issued documents"
  ON public.issued_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can update issued documents"
  ON public.issued_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS issued_documents_statement_year_uniq
  ON public.issued_documents (person_id, tax_year)
  WHERE kind = 'tax_statement' AND status = 'issued';
CREATE INDEX IF NOT EXISTS issued_documents_person_idx ON public.issued_documents (person_id);
CREATE INDEX IF NOT EXISTS issued_documents_donation_idx ON public.issued_documents (donation_id);

CREATE TRIGGER update_issued_documents_updated_at
  BEFORE UPDATE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Issue a year-end tax statement
CREATE OR REPLACE FUNCTION public.issue_tax_statement(
  _person_id uuid,
  _tax_year integer,
  _delivery_method text DEFAULT 'printed'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_doc_id uuid;
  v_ids uuid[];
  v_count integer;
  v_total numeric;
  v_gift uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _tax_year IS NULL THEN RAISE EXCEPTION 'Pick a tax year'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  SELECT COALESCE(array_agg(d.id ORDER BY d.date), '{}'), COUNT(*), COALESCE(SUM(d.amount), 0)
    INTO v_ids, v_count, v_total
    FROM public.donations d
   WHERE d.person_id = _person_id
     AND d.deleted_at IS NULL
     AND EXTRACT(YEAR FROM d.date) = _tax_year;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No gifts recorded for that contact in %', _tax_year;
  END IF;

  -- Re-issuing replaces the previous statement for that year.
  UPDATE public.issued_documents
     SET status = 'void'
   WHERE kind = 'tax_statement' AND person_id = _person_id
     AND tax_year = _tax_year AND status = 'issued';

  INSERT INTO public.issued_documents
    (kind, person_id, tax_year, gift_ids, gift_count, total_amount,
     delivery_method, delivery_status, issued_by, issued_by_email)
  VALUES ('tax_statement', _person_id, _tax_year, v_ids, v_count, v_total,
          COALESCE(_delivery_method, 'printed'),
          CASE WHEN COALESCE(_delivery_method, 'printed') = 'printed' THEN 'delivered' ELSE 'pending' END,
          auth.uid(), v_actor)
  RETURNING id INTO v_doc_id;

  IF COALESCE(_delivery_method, 'printed') = 'printed' THEN
    UPDATE public.issued_documents SET delivered_at = now() WHERE id = v_doc_id;
  END IF;

  -- The statement IS the receipt for every gift it covers.
  FOREACH v_gift IN ARRAY v_ids LOOP
    PERFORM public.mark_receipt_sent(v_gift, true);
  END LOOP;

  INSERT INTO public.interactions (person_id, type, date, text, author, source_kind, source_id)
  VALUES (_person_id, 'note', CURRENT_DATE,
          _tax_year || ' tax statement issued — ' || v_count || ' gift(s), '
            || public.money_text(v_total),
          v_actor, 'tax_statement', v_doc_id)
  ON CONFLICT (source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
  DO NOTHING;

  RETURN v_doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_tax_statement(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_tax_statement(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_tax_statement(uuid, integer, text) TO service_role;

-- 5. Void a statement (fully reversible)
CREATE OR REPLACE FUNCTION public.void_tax_statement(_document_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_gift uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_doc FROM public.issued_documents WHERE id = _document_id;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'That document no longer exists'; END IF;

  UPDATE public.issued_documents
     SET status = 'void', delivery_status = 'pending', delivered_at = NULL
   WHERE id = _document_id;

  IF v_doc.kind = 'tax_statement' THEN
    FOREACH v_gift IN ARRAY v_doc.gift_ids LOOP
      PERFORM public.mark_receipt_sent(v_gift, false);
    END LOOP;
  END IF;

  DELETE FROM public.interactions
   WHERE source_kind IN ('tax_statement', 'acknowledgment') AND source_id = _document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.void_tax_statement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_tax_statement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_tax_statement(uuid) TO service_role;

-- 6. Record an acknowledgment letter for one gift
CREATE OR REPLACE FUNCTION public.issue_acknowledgment(
  _donation_id uuid,
  _delivery_method text DEFAULT 'printed'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d record;
  v_actor text;
  v_doc_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO v_d FROM public.donations WHERE id = _donation_id AND deleted_at IS NULL;
  IF v_d IS NULL THEN RAISE EXCEPTION 'That gift no longer exists'; END IF;
  IF v_d.person_id IS NULL THEN RAISE EXCEPTION 'That gift is not linked to a contact yet'; END IF;

  v_actor := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', '');

  INSERT INTO public.issued_documents
    (kind, person_id, donation_id, gift_ids, gift_count, total_amount,
     delivery_method, delivery_status, delivered_at, issued_by, issued_by_email)
  VALUES ('acknowledgment', v_d.person_id, _donation_id, ARRAY[_donation_id], 1, v_d.amount,
          COALESCE(_delivery_method, 'printed'),
          CASE WHEN COALESCE(_delivery_method, 'printed') = 'printed' THEN 'delivered' ELSE 'pending' END,
          CASE WHEN COALESCE(_delivery_method, 'printed') = 'printed' THEN now() ELSE NULL END,
          auth.uid(), v_actor)
  RETURNING id INTO v_doc_id;

  -- Generating the letter is what marks the thank-you as sent.
  PERFORM public.mark_thank_you_sent(_donation_id, true);

  RETURN v_doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_acknowledgment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_acknowledgment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_acknowledgment(uuid, text) TO service_role;

-- 7. Record delivery separately from generation (future email/text channels)
CREATE OR REPLACE FUNCTION public.record_document_delivery(
  _document_id uuid,
  _delivery_method text,
  _delivery_status text DEFAULT 'delivered',
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  UPDATE public.issued_documents
     SET delivery_method = COALESCE(_delivery_method, delivery_method),
         delivery_status = COALESCE(_delivery_status, delivery_status),
         delivery_note = COALESCE(_note, delivery_note),
         delivered_at = CASE WHEN COALESCE(_delivery_status, '') = 'delivered' THEN now() ELSE NULL END
   WHERE id = _document_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'That document no longer exists'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_document_delivery(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_document_delivery(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_document_delivery(uuid, text, text, text) TO service_role;