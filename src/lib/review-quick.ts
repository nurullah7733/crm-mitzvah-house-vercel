import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseImportDate } from "@/lib/import-dates";
import {
  donationAmountAfterRegistrationFee,
  donationImportFingerprint,
  type RowValues,
} from "@/lib/import-mapping";
import { matchEventByName, type EventOption } from "@/lib/import-links";
import { recordAttendance } from "@/lib/gift-events";
import { resolveCampaignId } from "@/lib/campaigns";
import { guard, must } from "@/lib/app-errors";
import {
  compareRecords,
  hasConflict,
  incomingPatch,
  incomingPerson,
  type CompareKey,
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
};

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
  const created: Pick<
    QuickMergeResult,
    "donationId" | "registrationId" | "upgradedRegistration" | "interactionIds" | "addedActivity"
  > = {
    donationId: null,
    registrationId: null,
    interactionIds: [],
    addedActivity: [],
  };
  const paymentAmount = Number(String(row.amount ?? "").replace(/[^0-9.-]/g, ""));
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
      eventFee = Math.min(
        Math.max(Number(match.registration_fee ?? 0), 0),
        Number.isFinite(paymentAmount) ? paymentAmount : 0,
      );
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
      const giftDate = isoDate(row.date) ?? today();
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
  const paymentAmount = Number(String(item.row_data.amount ?? "").replace(/[^0-9.-]/g, ""));
  let event: Json = null;
  let eventFee = 0;
  if ((item.row_data.event_name ?? "").trim()) {
    const { data: events } = await supabase
      .from("events")
      .select("id, name, date, registration_fee")
      .is("deleted_at", null);
    const match = matchEventByName(item.row_data.event_name!, (events ?? []) as EventOption[]);
    if (match) {
      const positivePayment =
        Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : 0;
      eventFee = Math.min(Math.max(Number(match.registration_fee ?? 0), 0), positivePayment);
      event = {
        event_id: match.id,
        fee_amount: eventFee,
        payment_amount: Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : null,
      };
    }
  }

  const donationAmount = donationAmountAfterRegistrationFee(paymentAmount, eventFee);
  let donation: Json = null;
  if (
    (item.row_data.amount ?? "").toString().trim() &&
    Number.isFinite(donationAmount) &&
    donationAmount > 0
  ) {
    const giftDate = isoDate(item.row_data.date) ?? today();
    donation = {
      amount: donationAmount,
      date: giftDate,
      campaign_id: await resolveCampaignId(item.row_data.campaign),
      source,
      notes: item.row_data.notes ?? null,
      import_batch_id: item.batch_id ?? null,
      import_fingerprint: donationImportFingerprint(item.row_data, donationAmount, giftDate),
    };
  }
  const noteText = [
    item.row_data.notes,
    item.row_data.person_notes ? `Note: ${item.row_data.person_notes}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const note =
    noteText && !(item.row_data.amount ?? "").toString().trim()
      ? { text: noteText, date: today(), author: "Import review" }
      : null;

  const { data, error } = await supabase.rpc("resolve_review_quick_merge", {
    _item_id: item.id,
    _person_id: existing.id,
    _person_patch: patch,
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
  };
}

/** Put things back the way they were, right after a one-tap merge. */
export async function undoQuickMerge(result: QuickMergeResult) {
  if (Object.keys(result.before).length > 0) {
    await guard(
      supabase
        .from("people")
        .update(result.before as never)
        .eq("id", result.personId),
      { area: "import", action: "Undo the update" },
    );
  }
  if (result.donationId)
    await guard(supabase.from("donations").delete().eq("id", result.donationId), {
      area: "import",
      action: "Undo the gift",
    });
  if (result.registrationId)
    await guard(supabase.from("registrations").delete().eq("id", result.registrationId), {
      area: "import",
      action: "Undo the attendance",
    });
  if (result.upgradedRegistration)
    await guard(
      supabase
        .from("registrations")
        .update({ status: result.upgradedRegistration.status ?? "registered" } as never)
        .eq("id", result.upgradedRegistration.id),
      { area: "import", action: "Undo the update" },
    );
  for (const id of result.interactionIds)
    await guard(supabase.from("interactions").delete().eq("id", id), {
      area: "import",
      action: "Undo the timeline note",
    });
  await guard(
    supabase
      .from("review_queue")
      .update({ status: "pending", resolution_note: "One-tap update undone" } as never)
      .eq("id", result.itemId),
    { area: "import", action: "Undo the update" },
  );
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
