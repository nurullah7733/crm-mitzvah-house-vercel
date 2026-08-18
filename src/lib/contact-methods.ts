import { supabase } from "@/integrations/supabase/client";
import { normalizeEmail } from "@/lib/proper-case";

export type MethodKind = "phone" | "email";

export type ContactMethod = {
  id: string;
  person_id: string;
  kind: string;
  value: string;
  method_type: string;
  label: string | null;
  is_primary: boolean;
};

export const PHONE_TYPES = ["Mobile", "Home", "Work", "Other"] as const;
export const EMAIL_TYPES = ["Personal", "Work", "Other"] as const;

export function typesFor(kind: MethodKind): readonly string[] {
  return kind === "phone" ? PHONE_TYPES : EMAIL_TYPES;
}

/** Digits only, last ten, for comparing two phone numbers. */
export function phoneKey(value: string | null | undefined) {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

export function methodKey(kind: MethodKind, value: string) {
  return kind === "phone" ? `phone:${phoneKey(value)}` : `email:${normalizeEmail(value)}`;
}

/** A new phone or email being entered before it has been saved. */
export type MethodDraft = {
  id?: string;
  kind: MethodKind;
  value: string;
  method_type: string;
  is_primary: boolean;
};

export function emptyDraft(kind: MethodKind, isPrimary = false): MethodDraft {
  return {
    kind,
    value: "",
    method_type: kind === "phone" ? "Mobile" : "Personal",
    is_primary: isPrimary,
  };
}

export function sortMethods(rows: readonly ContactMethod[]) {
  return [...rows].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.value.localeCompare(b.value),
  );
}

export async function fetchContactMethods(personId: string) {
  const { data, error } = await supabase
    .from("contact_methods")
    .select("id, person_id, kind, value, method_type, label, is_primary")
    .eq("person_id", personId)
    .order("is_primary", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ContactMethod[];
}

/**
 * Add phones and emails to a contact, skipping anything already on file.
 * The first phone and first email become the primary when the contact has none.
 */
export async function addContactMethods(
  personId: string,
  drafts: readonly MethodDraft[],
  options: { importBatchId?: string | null; existing?: readonly ContactMethod[] } = {},
) {
  const existing = options.existing ?? (await fetchContactMethods(personId));
  const seen = new Set(existing.map((m) => methodKey(m.kind as MethodKind, m.value)));
  const hasPrimary: Record<MethodKind, boolean> = {
    phone: existing.some((m) => m.kind === "phone" && m.is_primary),
    email: existing.some((m) => m.kind === "email" && m.is_primary),
  };

  const rows: Record<string, unknown>[] = [];
  for (const d of drafts) {
    const value = d.kind === "email" ? normalizeEmail(d.value) : d.value.trim();
    if (!value) continue;
    const key = methodKey(d.kind, value);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const primary = d.is_primary || !hasPrimary[d.kind];
    if (primary) hasPrimary[d.kind] = true;
    rows.push({
      person_id: personId,
      kind: d.kind,
      value,
      method_type: d.method_type || (d.kind === "phone" ? "Mobile" : "Personal"),
      is_primary: primary,
      ...(options.importBatchId ? { import_batch_id: options.importBatchId } : {}),
    });
  }
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("contact_methods").insert(rows as never);
  if (error) throw error;
  return rows.length;
}

/** Ensure the single phone / email a contact was created with is also in the list. */
export async function seedPrimaryMethods(
  personId: string,
  values: { phone?: string | null; email?: string | null },
  importBatchId?: string | null,
) {
  const drafts: MethodDraft[] = [];
  if ((values.phone ?? "").trim())
    drafts.push({
      kind: "phone",
      value: values.phone!.trim(),
      method_type: "Mobile",
      is_primary: true,
    });
  if ((values.email ?? "").trim())
    drafts.push({
      kind: "email",
      value: values.email!.trim(),
      method_type: "Personal",
      is_primary: true,
    });
  if (drafts.length === 0) return;
  await addContactMethods(personId, drafts, { importBatchId: importBatchId ?? null, existing: [] });
}
