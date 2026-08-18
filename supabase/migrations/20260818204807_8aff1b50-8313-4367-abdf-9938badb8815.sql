CREATE TABLE public.pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency = ANY (ARRAY['one_time','monthly','quarterly','annual'])),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','paused','completed','lapsed'])),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days >= 0),
  notes text,
  external_ref text,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pledges TO authenticated;
GRANT ALL ON public.pledges TO service_role;

ALTER TABLE public.pledges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read pledges" ON public.pledges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can add pledges" ON public.pledges
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can edit pledges" ON public.pledges
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete pledges" ON public.pledges
  FOR DELETE TO authenticated USING (public.is_admin());

CREATE TRIGGER update_pledges_updated_at
  BEFORE UPDATE ON public.pledges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX pledges_person_idx ON public.pledges (person_id);
CREATE INDEX pledges_status_idx ON public.pledges (status);
-- A Donorbox (or other) recurring plan maps to exactly one pledge, so a later
-- sync attaches each month's gift instead of creating a new pledge every time.
CREATE UNIQUE INDEX pledges_external_ref_key ON public.pledges (external_ref)
  WHERE external_ref IS NOT NULL;

-- A received gift can pay toward a pledge. The money still lives in donations
-- once, so giving totals are unchanged.
ALTER TABLE public.donations
  ADD COLUMN pledge_id uuid REFERENCES public.pledges(id) ON DELETE SET NULL;
CREATE INDEX donations_pledge_idx ON public.donations (pledge_id);

-- Pledges whose next expected payment is overdue by more than the grace period.
CREATE OR REPLACE FUNCTION public.pledges_missing_payments()
RETURNS TABLE (
  pledge_id uuid,
  person_id uuid,
  name text,
  amount numeric,
  frequency text,
  last_gift_date date,
  expected_date date,
  days_late integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.id,
      p.person_id,
      COALESCE(pe.display_name, concat_ws(' ', pe.first_name, pe.last_name)) AS name,
      p.amount,
      p.frequency,
      p.grace_days,
      p.start_date,
      p.end_date,
      (
        SELECT max(d.date) FROM public.donations d
        WHERE d.pledge_id = p.id AND d.deleted_at IS NULL
      ) AS last_gift_date
    FROM public.pledges p
    JOIN public.people pe ON pe.id = p.person_id AND pe.deleted_at IS NULL
    WHERE p.status = 'active'
      AND p.frequency <> 'one_time'
      AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
  ), expected AS (
    SELECT
      b.*,
      COALESCE(b.last_gift_date, b.start_date)
        + CASE b.frequency
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'quarterly' THEN interval '3 months'
            ELSE interval '1 year'
          END AS expected_ts
    FROM base b
  )
  SELECT
    e.id,
    e.person_id,
    e.name,
    e.amount,
    e.frequency,
    e.last_gift_date,
    e.expected_ts::date,
    (CURRENT_DATE - e.expected_ts::date)::integer
  FROM expected e
  WHERE e.expected_ts::date + e.grace_days < CURRENT_DATE
  ORDER BY e.expected_ts;
$$;

REVOKE ALL ON FUNCTION public.pledges_missing_payments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pledges_missing_payments() TO authenticated, service_role;