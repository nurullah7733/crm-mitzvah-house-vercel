import { supabase } from "@/integrations/supabase/client";
import { addContactMethods, type MethodDraft } from "@/lib/contact-methods";
import { guard, mustWrite } from "@/lib/app-errors";
import { resolveCampaignId } from "@/lib/campaigns";
import {
  addressKey,
  composeAddress,
  roleFromRow,
  donationImportFingerprint,
  splitName,
  type RowValues,
} from "@/lib/import-mapping";

function isoDate(raw: string | undefined | null) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

/** The person's name as it reads on an imported row. */
export function rowDisplayName(row: RowValues) {
  const n = splitName(row);
  const first = [n.first, n.middle].filter(Boolean).join(" ").trim();
  const last = [n.last, n.suffix].filter(Boolean).join(" ").trim();
  return {
    first,
    last,
    surname: n.last.trim(),
    display: [first, last].filter(Boolean).join(" ").trim(),
  };
}

/** The address written on an imported row, as one readable block. */
export function rowAddress(row: RowValues) {
  return composeAddress(row);
}

export type ReviewQueueItem = {
  id: string;
  filename: string | null;
  batch_id: string | null;
  row_data: RowValues;
};

/**
 * The household at this address: reuse one if we already have it (including an
 * address-only record), otherwise create it and tag it to the import so undoing
 * the import takes it away again.
 */
export async function ensureHouseholdAtAddress(
  address: string | null,
  name: string,
  batchId: string | null,
): Promise<string | null> {
  const key = addressKey(address);
  if (key) {
    const { data: existing } = await supabase.from("households").select("id, address").limit(1000);
    const hit = (existing ?? []).find((h) => addressKey(h.address) === key);
    if (hit) {
      await mustWrite(
        supabase
          .from("households")
          .update({ status: "active" } as never)
          .eq("id", hit.id),
        "The household couldn't be reopened.",
      );
      return hit.id;
    }
  }
  const { data: created, error } = await supabase
    .from("households")
    .insert({ name: name || "New household", address, import_batch_id: batchId } as never)
    .select("id")
    .single();
  if (error) throw error;
  return created?.id ?? null;
}

/**
 * Save an imported row as a brand-new contact. Everything created here is tagged
 * with the import it came from, so "Undo this import" removes it too.
 */
export async function createPersonFromRow(
  item: ReviewQueueItem,
  opts: { householdId?: string | null; relationship?: string | null; note: string },
): Promise<{ personId: string; name: string }> {
  const row = item.row_data ?? {};
  const { first, last, display } = rowDisplayName(row);
  if (!first && !last) throw new Error("This row has no name, so it can't be saved as a contact.");
  const batchId = item.batch_id ?? null;

  const { data: created, error } = await supabase
    .from("people")
    .insert({
      first_name: first || null,
      last_name: last || null,
      display_name: display || null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      birth_date: isoDate(row.birth_date),
      anniversary_date: isoDate(row.anniversary_date),
      school: row.school ?? null,
      notes: row.person_notes ?? null,
      met_source: row.met_source ?? null,
      role: roleFromRow({
        ...(row.role ? { role: row.role } : {}),
        ...(row.age ? { age: row.age } : {}),
        ...(row.birth_date ? { birth_date: row.birth_date } : {}),
      }),
      household_id: opts.householdId ?? null,
      ...(opts.relationship ? { household_relationship: opts.relationship } : {}),
      import_batch_id: batchId,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const personId = created!.id as string;

  const methods: MethodDraft[] = [
    ...(row.phones ?? []).map((m, i) => ({
      kind: "phone" as const,
      value: m.value,
      method_type: m.method_type,
      is_primary: i === 0,
    })),
    ...(row.emails ?? []).map((m, i) => ({
      kind: "email" as const,
      value: m.value,
      method_type: m.method_type,
      is_primary: i === 0,
    })),
  ];
  if (methods.length > 0)
    await addContactMethods(personId, methods, {
      existing: [],
      ...(batchId ? { importBatchId: batchId } : {}),
    });

  const source = `${item.filename ?? "Import"} review, ${today()}`;
  const fieldNames = [
    "email",
    "phone",
    "address",
    "birth_date",
    "anniversary_date",
    "school",
    "met_source",
  ] as const;
  const sources = fieldNames
    .filter((f) => (f === "address" ? Boolean(rowAddress(row)) : Boolean(row[f])))
    .map((f) => ({
      person_id: personId,
      field_name: f,
      source,
      recorded_date: today(),
      import_batch_id: batchId,
    }));
  if (sources.length > 0)
    await guard(supabase.from("field_sources").insert(sources as never), {
      area: "import",
      action: "Record where these details came from",
      fallback: "The details saved, but we couldn't record where they came from.",
    });

  const amount = Number(String(row.amount ?? "").replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(amount) && amount > 0) {
    const giftDate = isoDate(row.date) ?? today();
    await mustWrite(
      supabase.from("donations").insert({
        person_id: personId,
        amount,
        date: giftDate,
        campaign_id: await resolveCampaignId(row.campaign),
        source,
        notes: row.notes ?? null,
        import_batch_id: batchId,
        import_fingerprint: donationImportFingerprint(row, amount, giftDate),
      } as never),
      "The gift couldn't be saved.",
    );
  } else {
    const noteText = [row.notes, row.person_notes ? `Note: ${row.person_notes}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (noteText)
      await guard(
        supabase.from("interactions").insert({
          person_id: personId,
          type: "form",
          date: today(),
          text: noteText,
          author: "Import review",
          import_batch_id: batchId,
        } as never),
        {
          area: "import",
          action: "Save the note",
          fallback: "The contact saved, but the note didn't.",
        },
      );
  }

  const { error: logError } = await supabase.rpc("log_review_decision", {
    _item_id: item.id,
    _decision: "created",
    _reason: opts.note,
    _person_id: personId,
  });
  if (logError) throw logError;

  return { personId, name: display };
}
