ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS processed_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flagged_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_final_counts_nonnegative
  CHECK (processed_rows >= 0 AND created_rows >= 0 AND matched_rows >= 0 AND flagged_rows >= 0 AND failed_rows >= 0);

CREATE TABLE public.import_row_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  row_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL DEFAULT 'processing',
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  review_queue_id uuid REFERENCES public.review_queue(id) ON DELETE SET NULL,
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT import_row_outcomes_row_number_positive CHECK (row_number > 0),
  CONSTRAINT import_row_outcomes_outcome_valid CHECK (outcome IN ('processing', 'created', 'matched', 'flagged', 'failed')),
  CONSTRAINT import_row_outcomes_batch_row_unique UNIQUE (batch_id, row_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_row_outcomes TO authenticated;
GRANT ALL ON public.import_row_outcomes TO service_role;

ALTER TABLE public.import_row_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view import row outcomes"
ON public.import_row_outcomes FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated staff can create import row outcomes"
ON public.import_row_outcomes FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated staff can update import row outcomes"
ON public.import_row_outcomes FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated staff can delete import row outcomes"
ON public.import_row_outcomes FOR DELETE TO authenticated
USING (true);

CREATE TRIGGER update_import_row_outcomes_updated_at
BEFORE UPDATE ON public.import_row_outcomes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX import_row_outcomes_batch_outcome_idx
ON public.import_row_outcomes (batch_id, outcome);

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_fee numeric(12,2);

ALTER TABLE public.events
  ADD CONSTRAINT events_registration_fee_nonnegative
  CHECK (registration_fee IS NULL OR registration_fee >= 0);

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_amount numeric(12,2);

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_fee_amount_nonnegative
  CHECK (fee_amount >= 0),
  ADD CONSTRAINT registrations_payment_amount_nonnegative
  CHECK (payment_amount IS NULL OR payment_amount >= 0),
  ADD CONSTRAINT registrations_fee_not_above_payment
  CHECK (payment_amount IS NULL OR fee_amount <= payment_amount);

CREATE INDEX registrations_event_revenue_idx
ON public.registrations (event_id, fee_amount)
WHERE fee_amount > 0;

COMMENT ON COLUMN public.events.registration_fee IS
  'Standard event registration fee. When an event-linked payment is imported, this portion is event revenue rather than a tax-deductible donation.';
COMMENT ON COLUMN public.registrations.fee_amount IS
  'The portion of the received payment allocated to event registration revenue.';
COMMENT ON COLUMN public.registrations.payment_amount IS
  'The original total event-linked payment before any excess is recorded as a donation.';
COMMENT ON TABLE public.import_row_outcomes IS
  'One durable outcome per source spreadsheet row, used to prove reconciliation and expose interrupted or failed imports.';