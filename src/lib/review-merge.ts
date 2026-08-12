import { supabase } from "@/integrations/supabase/client";
import { splitName, roleFromRow, type RowValues } from "@/lib/import-mapping";

/** A person as the review screen needs it. */
export type ReviewPerson = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  birth_date: string | null;
  anniversary_date: string | null;
  school: string | null;
  notes: string | null;
  met_source: string | null;
  household_id: string | null;
  lifetime_giving: number | string | null;
};

/** People columns the reviewer can compare and choose between. */
export const COMPARE_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "display_name", label: "Name shown" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "role", label: "Adult / child" },
  { key: "birth_date", label: "Birth date" },
  { key: "anniversary_date", label: "Anniversary" },
  { key: "school", label: "School" },
  { key: "notes", label: "Notes" },
  { key: "met_source", label: "Where we met" },
] as const;

export type CompareKey = (typeof COMPARE_FIELDS)[number]["key"];

/** Turn a queued spreadsheet row into the people columns it would write. */
export function incomingPerson(row: RowValues): Record<CompareKey, string | null> {
  const base = splitName(row);
  const first = [base.first, base.middle].filter(Boolean).join(" ").trim();
  const last = [base.last, base.suffix].filter(Boolean).join(" ").trim();
  const clean = (v: string | undefined | null) => {
    const s = (v ?? "").trim();
    return s === "" ? null : s;
  };
  return {
    first_name: clean(first),
    last_name: clean(last),
    display_name: clean([first, last].filter(Boolean).join(" ")),
    email: clean(row.email),
    phone: clean(row.phone),
    role: roleFromRow(row),
    birth_date: clean(row.birth_date),
    anniversary_date: clean(row.anniversary_date),
    school: clean(row.school),
    notes: clean(row.person_notes ?? row.notes),
    met_source: clean(row.met_source),
  };
}

export type FieldState = "same" | "fill" | "conflict" | "empty";

export type FieldComparison = {
  key: CompareKey;
  label: string;
  existing: string | null;
  incoming: string | null;
  state: FieldState;
};

function norm(v: string | null) {
  return (v ?? "").trim().toLowerCase();
}

/**
 * Compare a stored contact with an incoming row.
 * "fill" means the incoming value adds something we don't have — those are
 * applied automatically. Only "conflict" needs a person to decide.
 */
export function compareRecords(
  existing: ReviewPerson,
  incoming: Record<CompareKey, string | null>,
): FieldComparison[] {
  return COMPARE_FIELDS.map(({ key, label }) => {
    const a = (existing[key] ?? null) as string | null;
    const b = incoming[key];
    let state: FieldState = "empty";
    if (norm(a) && norm(b)) state = norm(a) === norm(b) ? "same" : "conflict";
    else if (!norm(a) && norm(b)) state = "fill";
    else if (norm(a) && !norm(b)) state = "same";
    return { key, label, existing: a, incoming: b, state };
  });
}

export function hasConflict(fields: FieldComparison[]) {
  return fields.some((f) => f.state === "conflict");
}

/**
 * Apply an incoming row onto a stored contact. Blanks are always filled in;
 * conflicting fields only change when the reviewer chose the incoming value.
 */
export async function applyIncoming(
  personId: string,
  fields: FieldComparison[],
  choices: Partial<Record<CompareKey, "existing" | "incoming">>,
  source: string,
) {
  const patch: Record<string, string | null> = {};
  const changedFields: string[] = [];
  for (const f of fields) {
    if (f.state === "fill" || (f.state === "conflict" && choices[f.key] === "incoming")) {
      patch[f.key] = f.incoming;
      changedFields.push(f.key);
    }
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("people").update(patch as never).eq("id", personId);
    if (error) throw error;
  }
  const traceable = changedFields.filter((k) => ["email", "phone", "school", "notes"].includes(k));
  if (traceable.length > 0) {
    await supabase.from("field_sources").insert(
      traceable.map((field_name) => ({
        person_id: personId,
        field_name,
        source,
        recorded_date: new Date().toISOString().slice(0, 10),
      })),
    );
  }
  return changedFields.length;
}

/** Save an incoming row as a brand-new contact ("keep both"). */
export async function createFromIncoming(
  incoming: Record<CompareKey, string | null>,
  householdId: string | null,
  source: string,
) {
  const { data, error } = await supabase
    .from("people")
    .insert({
      first_name: incoming.first_name,
      last_name: incoming.last_name,
      display_name: incoming.display_name,
      email: incoming.email,
      phone: incoming.phone,
      role: incoming.role ?? "Adult",
      birth_date: incoming.birth_date,
      anniversary_date: incoming.anniversary_date,
      school: incoming.school,
      notes: incoming.notes,
      met_source: incoming.met_source,
      household_id: householdId,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (data?.id && incoming.email) {
    await supabase.from("field_sources").insert({
      person_id: data.id,
      field_name: "email",
      source,
      recorded_date: new Date().toISOString().slice(0, 10),
    });
  }
  return data?.id ?? null;
}

export function showValue(v: string | null) {
  return v && v.trim() ? v : "—";
}