import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseImportDate, resolveImportDonationDate } from "@/lib/import-dates";
import { allocateRegistrationCents, amountToCents, centsToAmount } from "@/lib/import-normalization";
import {
  donationAmountAfterRegistrationFee,
  donationImportFingerprint,
  type RowValues,
} from "@/lib/import-mapping";
import { matchEventByName, type EventOption } from "@/lib/import-links";
import { recordAttendance } from "@/lib/gift-events";
import { resolveCampaignId } from "@/lib/campaigns";
import { buildActivityPlan, type ActivityEventDecision } from "@/lib/import-activity-plan";
import type { RegistrationPaymentConflictContext } from "@/lib/registration-payment-conflict";
import { must } from "@/lib/app-errors";
import {
  compareRecords,
  hasConflict,
  incomingPatch,
  incomingPerson,
  type CompareKey,
  type FieldComparison,
  type ReviewPerson,
} from "@/lib/review-merge";

const isoDate = (raw: string | undefined | null) => parseImportDate(raw);

const today = () => new Date().toISOString().slice(0, 10);

/** Everything a one-tap merge created, so it can be undone right after. */
export type QuickMergeResult = {
  itemId: string;
  personId: string;
  personName: string;
  before: Partial<Record<CompareKey, string | null>>;
  filledFields: number;
  donationId: string | null;
  registrationId: string | null;
  /** An RSVP we upgraded to Attended, so undo can put the old status back. */
  upgradedRegistration?: { id: string; status: string | null };
  interactionIds: string[];
  addedActivity: string[];
  undoToken: Json;
};

type ResolvedMergePayload = {
  event: Json;
  donation: Json;
  note: Json;
  donationAmount: number;
};

function h2PatchContract(
  contract: "quick" | "manual",
  patch: Partial<Record<CompareKey, string | null>>,
  expected: Partial<Record<CompareKey, string | null>>,
) {
  const expectedForPatch = Object.fromEntries(
    Object.keys(patch).map((key) => [key, expected[key as CompareKey] ?? null]),
  );
  return { __h2_contract: contract, __h2_values: patch, __h2_expected: expectedForPatch };
}

/** Resolve imported activity on the client; SQL only applies this already-decided payload. */
export async function resolveReviewMergePayload(
  row: RowValues,
  source: string,
  batchId: string | null,
): Promise<ResolvedMergePayload> {
  if ((row.amount ?? "").trim() && amountToCents(row.amount) === null)
    throw new Error("The donation amount is invalid or ambiguous and must be corrected first.");
  if ((row.date ?? "").trim() && !parseImportDate(row.date))
    throw new Error("The donation date is invalid or ambiguous and must be corrected first.");
  let eventDecision: ActivityEventDecision = { kind: "ignore" };
  if ((row.event_name ?? "").trim() && row.activity_event_ignored !== "true") {
    const { data: events } = await supabase
      .from("events")
      .select("id, name, date, registration_fee")
      .is("deleted_at", null);
    const options = (events ?? []) as EventOption[];
    const match = options.find((event) => event.id === row.activity_event_id)
      ?? matchEventByName(row.event_name!, options);
    if (match) {
      eventDecision = { kind: "attend", id: match.id, registrationFee: Number(match.registration_fee ?? 0) };
    } else eventDecision = { kind: "unresolved" };
  }
  const plan = buildActivityPlan({ row, effectiveDate: row.activity_effective_date ?? today(), eventDecision });
  if (plan.blockingIssues.length) throw new Error(plan.blockingIssues[0]);
  const donationAmount = centsToAmount(plan.netDonationCents);
  const event: Json = plan.attendanceIntent && plan.eventId
    ? {
        event_id: plan.eventId,
        ...(plan.grossPaymentCents !== null && plan.grossPaymentCents > 0
          ? { fee_amount: centsToAmount(plan.registrationFeeCents), payment_amount: centsToAmount(plan.grossPaymentCents) }
          : {}),
      }
    : null;
  let donation: Json = null;
  if (plan.donationIntent && plan.donationDate) {
    donation = {
      amount: donationAmount,
      date: plan.donationDate,
      campaign_name: plan.campaignName,
      event_id: plan.donationEventId,
      source,
      notes: plan.notes,
      import_batch_id: batchId,
      import_fingerprint: plan.fingerprint,
      external_transaction_id: plan.sourceTransactionId,
      external_transaction_id_key: plan.sourceTransactionIdentity,
      transaction_source_system: plan.sourceSystem,
      transaction_object_type: plan.transactionObjectType,
    };
  }
  const noteText = [row.notes, row.person_notes ? `Note: ${row.person_notes}` : ""]
    .filter(Boolean)
    .join(" · ");
  const note =
    noteText && !plan.donationIntent
      ? { text: noteText, date: today(), author: "Import review" }
      : null;
  return { event, donation, note, donationAmount };
}

/** Complete a reviewer-directed merge through one atomic database boundary. */
export async function manualMerge(
  item: { id: string; filename: string | null; row_data: RowValues; batch_id?: string | null },
  personId: string,
  fields: FieldComparison[],
  choices: Partial<Record<CompareKey, "existing" | "incoming">>,
  audit: { existingBefore: Json; survivingAfter: Json },
) {
  const source = `${item.filename ?? "Import"} review`;
  const { patch, changedFields } = incomingPatch(fields, choices);
  const traceableFields = changedFields.filter((key) =>
    ["email", "phone", "school", "notes"].includes(key),
  );
  const { event, donation, note } = await resolveReviewMergePayload(
    item.row_data,
    source,
    item.batch_id ?? null,
  );
  const { error } = await supabase.rpc("resolve_review_manual_merge", {
    _item_id: item.id,
    _person_id: personId,
    _person_patch: h2PatchContract("manual", patch, audit.existingBefore as Partial<Record<CompareKey, string | null>>),
    _traceable_fields: traceableFields,
    _source: source,
    _batch_id: item.batch_id ?? null,
    _event: event,
    _donation: donation,
    _note: note,
    _existing_before: audit.existingBefore,
    _incoming: item.row_data,
    _surviving_after: audit.survivingAfter,
    _choices: choices,
  });
  if (error) throw error;
  return changedFields.length;
}

/** Create a separate contact, its imported activity, and its review decision atomically. */
export async function createReviewPerson(
  item: { id: string; filename: string | null; row_data: RowValues; batch_id?: string | null },
  incoming: Record<CompareKey, string | null>,
  householdId: string | null,
) {
  const source = `${item.filename ?? "Import"} review`;
  const { event, donation, note } = await resolveReviewMergePayload(
    item.row_data,
    source,
    item.batch_id ?? null,
  );
  const { data, error } = await supabase.rpc("resolve_review_create", {
    _item_id: item.id,
    _person: { ...incoming, household_id: householdId },
    _source: source,
    _batch_id: item.batch_id ?? null,
    _event: event,
    _donation: donation,
    _note: note,
  });
  if (error) throw error;
  if (!data) throw new Error("The new contact didn't come back from the database.");
  return data;
}

/**
 * Add the extra activity sitting on an imported row — an event registration,
 * a gift, or a written note — to a contact we already have. Anything already
 * on file is skipped, so the same row can never add the same thing twice.
 */
export async function processReviewRowActivity(
  personId: string,
  row: RowValues,
  source: string,
  batchId: string | null,
) {
  if (Date.now() >= 0)
    throw new Error(
      "LEGACY_UNSAFE_HELPER_DISABLED: use resolve_review_quick_merge or resolve_review_manual_merge.",
    );
  if ((row.amount ?? "").trim() && amountToCents(row.amount) === null)
    throw new Error("The donation amount is invalid or ambiguous and must be corrected first.");
  if ((row.date ?? "").trim() && !parseImportDate(row.date))
    throw new Error("The donation date is invalid or ambiguous and must be corrected first.");
  const created: Pick<
    QuickMergeResult,
    "donationId" | "registrationId" | "upgradedRegistration" | "interactionIds" | "addedActivity"
  > = {
    donationId: null,
    registrationId: null,
    interactionIds: [],
    addedActivity: [],
  };
  const paymentCents = amountToCents(row.amount);
  const paymentAmount = paymentCents === null ? Number.NaN : centsToAmount(paymentCents);
  let eventFee = 0;

  if ((row.event_name ?? "").trim()) {
    const { data: events } = await supabase
      .from("events")
      .select("id, name, date, registration_fee")
      .is("deleted_at", null);
    const match = matchEventByName(row.event_name!, (events ?? []) as EventOption[]);
    if (match) {
      const { data: before } = await supabase
        .from("registrations")
        .select("id, status")
        .eq("event_id", match.id)
        .eq("person_id", personId)
        .limit(1);
      const existing = before?.[0];
      // One shared attendance function: an existing Invited/Registered row is
      // upgraded to Attended rather than skipped.
      await recordAttendance({
        personId,
        eventId: match.id,
        eventName: match.name,
        eventDate: (match as { date?: string | null }).date ?? null,
        importBatchId: batchId,
        feeAmount: Math.min(
          Math.max(Number(match.registration_fee ?? 0), 0),
          Number.isFinite(paymentAmount) ? paymentAmount : 0,
        ),
        paymentAmount: Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : null,
      });
      eventFee = centsToAmount(allocateRegistrationCents(paymentCents ?? 0, Number(match.registration_fee ?? 0)).feeCents);
      if (!existing) {
        const { data: reg } = await supabase
          .from("registrations")
          .select("id")
          .eq("event_id", match.id)
          .eq("person_id", personId)
          .limit(1);
        // Only a registration this step created may be removed on undo.
        created.registrationId = reg?.[0]?.id ?? null;
        created.addedActivity.push(`attendance at ${match.name}`);
      } else if ((existing.status ?? "").trim().toLowerCase() !== "attended") {
        created.upgradedRegistration = { id: existing.id, status: existing.status ?? null };
        created.addedActivity.push(`attendance at ${match.name}`);
      }
    }
  }

  if ((row.amount ?? "").toString().trim()) {
    const amount = donationAmountAfterRegistrationFee(paymentAmount, eventFee);
    if (Number.isFinite(amount) && amount > 0) {
      const giftDate = resolveImportDonationDate(row.date, today());
      if (!giftDate) throw new Error("The donation date must be corrected first.");
      const fingerprint = donationImportFingerprint(row, amount, giftDate);
      const campaignId = await resolveCampaignId(row.campaign);
      const check = supabase
        .from("donations")
        .select("id")
        .eq("person_id", personId)
        .eq("amount", amount)
        .eq("date", giftDate)
        .is("deleted_at", null);
      const { data: existingGift } = await (
        campaignId ? check.eq("campaign_id", campaignId) : check.is("campaign_id", null)
      ).limit(1);
      const { data: fingerprintGift } = fingerprint
        ? await supabase
            .from("donations")
            .select("id")
            .eq("import_fingerprint", fingerprint)
            .is("deleted_at", null)
            .limit(1)
        : { data: [] };
      if (!existingGift?.length && !fingerprintGift?.length) {
        const gift = await must(
          supabase
            .from("donations")
            .insert({
              person_id: personId,
              amount,
              date: giftDate,
              campaign_id: campaignId,
              source,
              notes: row.notes ?? null,
              import_batch_id: batchId,
              import_fingerprint: fingerprint,
            } as never)
            .select("id")
            .single(),
          "The donation",
        );
        created.donationId = gift.id;
        created.addedActivity.push(`a $${amount.toLocaleString()} gift`);
      }
    }
  }

  const noteText = [row.notes, row.person_notes ? `Note: ${row.person_notes}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (noteText && !created.donationId && !(row.amount ?? "").toString().trim()) {
    const { data: note } = await supabase
      .from("interactions")
      .insert({
        person_id: personId,
        type: "form",
        date: today(),
        text: noteText,
        author: "Import review",
        import_batch_id: batchId,
      } as never)
      .select("id")
      .single();
    if (note?.id) {
      created.interactionIds.push(note.id);
      created.addedActivity.push("a note");
    }
  }

  return created;
}

/**
 * "Same person — update contact": fill blanks on the stored contact from the
 * incoming row, add its new activity, and leave every value we already have
 * exactly as it was. Refuses to run when the two records disagree.
 */
export async function quickMerge(
  item: { id: string; filename: string | null; row_data: RowValues; batch_id?: string | null },
  existing: ReviewPerson,
  existingName: string,
): Promise<QuickMergeResult> {
  const incoming = incomingPerson(item.row_data);
  const fields = compareRecords(existing, incoming);
  if (hasConflict(fields))
    throw new Error("This row disagrees with what we have — open it and decide.");

  const before: Partial<Record<CompareKey, string | null>> = {};
  for (const f of fields) if (f.state === "fill") before[f.key] = f.existing ?? null;

  const source = `${item.filename ?? "Import"} quick update`;
  const { patch, changedFields } = incomingPatch(fields, {});
  const traceableFields = changedFields.filter((key) =>
    ["email", "phone", "school", "notes"].includes(key),
  );
  const { event, donation, note, donationAmount } = await resolveReviewMergePayload(
    item.row_data,
    source,
    item.batch_id ?? null,
  );

  const { data, error } = await supabase.rpc("resolve_review_quick_merge", {
    _item_id: item.id,
    _person_id: existing.id,
    _person_patch: h2PatchContract("quick", patch, existing),
    _traceable_fields: traceableFields,
    _source: source,
    _batch_id: item.batch_id ?? null,
    _event: event,
    _donation: donation,
    _note: note,
  });
  if (error) throw error;
  const result = (data ?? {}) as Record<string, unknown>;
  const addedActivity: string[] = [];
  if (result["registration_created"] || result["registration_upgraded"])
    addedActivity.push(`attendance at ${String(result["event_name"] ?? "the event")}`);
  if (result["donation_created"]) addedActivity.push(`a $${donationAmount.toLocaleString()} gift`);
  if (result["note_created"]) addedActivity.push("a note");

  return {
    itemId: item.id,
    personId: existing.id,
    personName: existingName,
    before,
    filledFields: changedFields.length,
    donationId: (result["donation_id"] as string | null) ?? null,
    registrationId: result["registration_created"]
      ? ((result["registration_id"] as string | null) ?? null)
      : null,
    ...(result["registration_upgraded"] && result["registration_id"]
      ? {
          upgradedRegistration: {
            id: result["registration_id"] as string,
            status: (result["registration_previous_status"] as string | null) ?? null,
          },
        }
      : {}),
    interactionIds: result["note_id"] ? [result["note_id"] as string] : [],
    addedActivity,
    undoToken: (result["undo_token"] as Json) ?? null,
  };
}

/** Resolve an activity-payment conflict without applying any activity from the row. */
export async function keepExistingRegistrationPayment(
  item: { id: string; filename: string | null; row_data: RowValues; batch_id?: string | null },
  existing: ReviewPerson,
  context: RegistrationPaymentConflictContext,
) {
  const incoming = incomingPerson(item.row_data);
  const fields = compareRecords(existing, incoming);
  if (hasConflict(fields))
    throw new Error("This row also has contact details that disagree. Resolve those separately first.");
  const { patch, changedFields } = incomingPatch(fields, {});
  const traceableFields = changedFields.filter((key) =>
    ["email", "phone", "school", "notes"].includes(key),
  );
  const source = `${item.filename ?? "Import"} review — kept existing registration payment`;
  const { data, error } = await supabase.rpc("resolve_review_manual_merge", {
    _item_id: item.id,
    _person_id: existing.id,
    _person_patch: h2PatchContract("manual", patch, existing),
    _traceable_fields: traceableFields,
    _source: source,
    _batch_id: item.batch_id ?? null,
    _event: null,
    _donation: null,
    _note: null,
    _existing_before: existing,
    _incoming: item.row_data,
    _surviving_after: { ...existing, ...patch },
    _choices: {
      activity_resolution: "keep_existing_registration_payment_skip_incoming_activity",
      registration_payment_conflict: context,
    },
  });
  if (error) throw error;
  return { data, changedFields: changedFields.length };
}

/** Put things back the way they were, right after a one-tap merge. */
export async function undoQuickMerge(result: QuickMergeResult) {
  const { error } = await supabase.rpc("undo_review_quick_merge", {
    _item_id: result.itemId,
    _person_id: result.personId,
    _undo_token: result.undoToken,
  });
  if (error) throw error;
}

export async function transitionReviewStatus(
  itemId: string,
  expectedStatus: "pending" | "skipped" | "dismissed",
  nextStatus: "pending" | "skipped",
  note: string,
) {
  const { error } = await supabase.rpc("transition_review_status", {
    _item_id: itemId,
    _expected_status: expectedStatus,
    _next_status: nextStatus,
    _note: note,
  });
  if (error) throw error;
}

/** Throw an incoming row away with a short reason on the record. */
export async function discardRow(itemId: string, reason: string, personId?: string | null) {
  const { error } = await supabase.rpc("log_review_decision", {
    _item_id: itemId,
    _decision: "discarded",
    _reason: reason,
    ...(personId ? { _person_id: personId } : {}),
  });
  if (error) throw error;
}
