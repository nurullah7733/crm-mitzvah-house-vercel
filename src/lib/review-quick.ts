import { supabase } from "@/integrations/supabase/client";
import { parseImportDate } from "@/lib/import-dates";
import { donationImportFingerprint, type RowValues } from "@/lib/import-mapping";
import { matchEventByName, type EventOption } from "@/lib/import-links";
import { recordAttendance } from "@/lib/gift-events";
import { resolveCampaignId } from "@/lib/campaigns";
import { guard } from "@/lib/app-errors";
import {
  applyIncoming,
  compareRecords,
  hasConflict,
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
async function addRowActivity(
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

  if ((row.event_name ?? "").trim()) {
    const { data: events } = await supabase
      .from("events")
      .select("id, name, date")
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
      });
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
    const amount = Number(String(row.amount).replace(/[^0-9.-]/g, ""));
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
        const { data: gift } = await supabase
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
          .single();
        created.donationId = gift?.id ?? null;
        if (gift?.id) created.addedActivity.push(`a $${amount.toLocaleString()} gift`);
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
  const filledFields = await applyIncoming(existing.id, fields, {}, source, item.batch_id ?? null);
  const activity = await addRowActivity(existing.id, item.row_data, source, item.batch_id ?? null);

  const { error } = await supabase.rpc("log_review_decision", {
    _item_id: item.id,
    _decision: "merged",
    _reason: "Same person — contact updated in one tap, no conflicting fields",
    _person_id: existing.id,
  });
  if (error) throw error;

  return {
    itemId: item.id,
    personId: existing.id,
    personName: existingName,
    before,
    filledFields,
    ...activity,
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
