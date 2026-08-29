import { resolveImportDonationDate } from "@/lib/import-dates";
import { donationImportFingerprintFromCents, type RowValues } from "@/lib/import-mapping";
import { allocateRegistrationCents, amountToCents } from "@/lib/import-normalization";
import { parseExternalTransactionId } from "@/lib/external-transaction-id";

export type ActivityEventDecision =
  | { kind: "attend"; id: string; registrationFee: number }
  | { kind: "gift_only"; id: string; registrationFee?: number }
  | { kind: "ignore" }
  | { kind: "unresolved" };

export type ActivityPlan = {
  owner: "main" | "partner" | null;
  donationIntent: boolean;
  grossPaymentCents: number | null;
  registrationFeeCents: number;
  netDonationCents: number;
  donationDate: string | null;
  campaignName: string | null;
  eventDecision: ActivityEventDecision;
  eventId: string | null;
  attendanceIntent: boolean;
  donationEventId: string | null;
  notes: string | null;
  sourceOccurrence: string | null;
  sourceTransactionId: string | null;
  fingerprint: string | null;
  blockingIssues: string[];
};

export function chooseActivityEventDecision({
  explicitEvent,
  nearbyEvent,
  nearbyDecision,
}: {
  explicitEvent: { id: string; registration_fee?: number | null } | null;
  nearbyEvent: { id: string; registration_fee?: number | null } | null;
  nearbyDecision?: "attended" | "gift_only" | "skip" | undefined;
}): ActivityEventDecision {
  if (explicitEvent)
    return {
      kind: "attend",
      id: explicitEvent.id,
      registrationFee: Number(explicitEvent.registration_fee ?? 0),
    };
  if (nearbyDecision === "attended" && nearbyEvent)
    return {
      kind: "attend",
      id: nearbyEvent.id,
      registrationFee: Number(nearbyEvent.registration_fee ?? 0),
    };
  if (nearbyDecision === "gift_only" && nearbyEvent)
    return { kind: "gift_only", id: nearbyEvent.id };
  return { kind: "ignore" };
}

export function buildActivityPlan({
  row,
  effectiveDate,
  eventDecision,
  owner = "main",
  sourceOccurrence = null,
}: {
  row: RowValues;
  effectiveDate: string;
  eventDecision?: ActivityEventDecision;
  owner?: ActivityPlan["owner"];
  sourceOccurrence?: string | null;
}): ActivityPlan {
  const hasAmount = Boolean((row.amount ?? "").trim());
  const grossPaymentCents = amountToCents(row.amount);
  const decision = eventDecision ?? ((row.event_name ?? "").trim() ? { kind: "unresolved" } : { kind: "ignore" });
  const attendanceIntent = decision.kind === "attend";
  const eventId = decision.kind === "attend" || decision.kind === "gift_only" ? decision.id : null;
  const fee = decision.kind === "attend" ? decision.registrationFee : 0;
  const allocated = allocateRegistrationCents(grossPaymentCents ?? 0, fee);
  const donationDate = hasAmount ? resolveImportDonationDate(row.date, effectiveDate) : null;
  const netDonationCents = Math.max(allocated.donationCents, 0);
  const donationIntent = hasAmount && grossPaymentCents !== null && grossPaymentCents > 0 && netDonationCents > 0;
  const blockingIssues: string[] = [];
  if (hasAmount && grossPaymentCents === null) blockingIssues.push("The donation amount is invalid or ambiguous.");
  if (hasAmount && !donationDate) blockingIssues.push("The donation date is invalid or ambiguous.");
  if (decision.kind === "unresolved") blockingIssues.push("The event attendance value must be linked, created, or ignored.");
  const transaction = parseExternalTransactionId(row.transaction_id);
  const sourceTransactionId = transaction.status === "valid" ? transaction.storedValue : null;
  const unsafeTransaction = row.normalization_issues?.find(
    (issue) => issue.field === "transaction_id" && issue.status === "unsafe",
  );
  if (unsafeTransaction) blockingIssues.push(unsafeTransaction.message);
  return {
    owner,
    donationIntent,
    grossPaymentCents,
    registrationFeeCents: allocated.feeCents,
    netDonationCents,
    donationDate,
    campaignName: (row.campaign ?? "").trim() || null,
    eventDecision: decision,
    eventId,
    attendanceIntent,
    donationEventId: eventId,
    notes: (row.notes ?? "").trim() || null,
    sourceOccurrence,
    sourceTransactionId,
    fingerprint: donationIntent && donationDate
      ? donationImportFingerprintFromCents(row, netDonationCents, donationDate)
      : null,
    blockingIssues,
  };
}
