import { amountToCents, centsToAmount } from "@/lib/import-normalization";
import { allocateRegistrationCents } from "@/lib/import-normalization";
import type { RowValues } from "@/lib/import-mapping";

export type RegistrationPaymentConflict = {
  kind: "registration_payment_conflict";
  existingPaymentCents: number;
  incomingPaymentCents: number;
  reason: string;
};

export type RegistrationPaymentConflictContext = {
  kind: "registration_payment_conflict";
  person_id: string;
  registration_id: string | null;
  event_id: string;
  event_name: string;
  existing_payment_cents: number;
  incoming_payment_cents: number;
  fee_cents: number;
  planned_net_donation_cents: number;
  donation_fingerprint: string | null;
};

export function isRegistrationPaymentConflict(
  row: Record<string, unknown> | null | undefined,
  reason: string | null | undefined,
) {
  const context = row?.["review_context"] as Record<string, unknown> | undefined;
  return context?.["kind"] === "registration_payment_conflict" ||
    /^registration payment conflict:/i.test((reason ?? "").trim());
}

export function registrationPaymentConflictContext(
  row: RowValues & { review_context?: unknown },
  reason: string,
  fallback?: {
    personId?: string | null | undefined;
    registrationId?: string | null | undefined;
    eventId?: string | null | undefined;
    eventName?: string | null | undefined;
    feeAmount?: string | number | null | undefined;
  },
): RegistrationPaymentConflictContext | null {
  const raw = row.review_context as Partial<RegistrationPaymentConflictContext> | undefined;
  if (raw?.kind === "registration_payment_conflict" && raw.person_id && raw.event_id &&
      Number.isSafeInteger(raw.existing_payment_cents) && Number.isSafeInteger(raw.incoming_payment_cents) &&
      Number.isSafeInteger(raw.fee_cents) && Number.isSafeInteger(raw.planned_net_donation_cents)) {
    return {
      kind: "registration_payment_conflict",
      person_id: raw.person_id,
      registration_id: raw.registration_id ?? null,
      event_id: raw.event_id,
      event_name: raw.event_name ?? "Event",
      existing_payment_cents: raw.existing_payment_cents!,
      incoming_payment_cents: raw.incoming_payment_cents!,
      fee_cents: raw.fee_cents!,
      planned_net_donation_cents: raw.planned_net_donation_cents!,
      donation_fingerprint: raw.donation_fingerprint ?? null,
    };
  }
  if (!isRegistrationPaymentConflict(row as Record<string, unknown>, reason)) return null;
  const amounts = reason.match(
    /existing \$((?:\([\d,]+(?:\.\d{1,2})?\))|(?:[\d,]+(?:\.\d{1,2})?)), incoming \$((?:\([\d,]+(?:\.\d{1,2})?\))|(?:[\d,]+(?:\.\d{1,2})?))/i,
  );
  const existing = amountToCents(amounts?.[1]);
  const incoming = amountToCents(amounts?.[2] ?? row.amount);
  const fee = amountToCents(fallback?.feeAmount) ?? 0;
  const personId = fallback?.personId ?? null;
  const eventId = fallback?.eventId ?? row.activity_event_id ?? null;
  if (!personId || !eventId || existing === null || incoming === null) return null;
  return {
    kind: "registration_payment_conflict",
    person_id: personId,
    registration_id: fallback?.registrationId ?? null,
    event_id: eventId,
    event_name: fallback?.eventName ?? row.event_name ?? "Event",
    existing_payment_cents: existing,
    incoming_payment_cents: incoming,
    fee_cents: allocateRegistrationCents(incoming, centsToAmount(fee)).feeCents,
    planned_net_donation_cents: allocateRegistrationCents(incoming, centsToAmount(fee)).donationCents,
    donation_fingerprint: null,
  };
}

function dollars(cents: number) {
  return centsToAmount(cents).toFixed(2);
}

/**
 * Compare a stored registration payment with the canonical gross payment from
 * ActivityPlan. A missing incoming payment never changes stored payment data.
 */
export function findRegistrationPaymentConflict(
  existingPayment: string | number | null | undefined,
  incomingGrossPaymentCents: number | null,
): RegistrationPaymentConflict | null {
  if (incomingGrossPaymentCents === null) return null;
  const existingPaymentCents = amountToCents(existingPayment);
  if (existingPaymentCents === null || existingPaymentCents === incomingGrossPaymentCents)
    return null;
  return {
    kind: "registration_payment_conflict",
    existingPaymentCents,
    incomingPaymentCents: incomingGrossPaymentCents,
    reason: `Registration payment conflict: existing $${dollars(existingPaymentCents)}, incoming $${dollars(incomingGrossPaymentCents)}.`,
  };
}
