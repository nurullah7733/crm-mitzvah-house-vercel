import { supabase } from "@/integrations/supabase/client";
import { personName } from "@/lib/names";
import type { ReviewPerson } from "@/lib/review-merge";

/**
 * Everything we know about a contact already on file, gathered in one go so the
 * reviewer can recognise the person instead of guessing from a name and a score.
 */
export type FullRecord = {
  person: ReviewPerson & Record<string, unknown>;
  name: string;
  phones: { value: string; label: string; primary: boolean }[];
  emails: { value: string; label: string; primary: boolean }[];
  address: string | null;
  household: { id: string; name: string; address: string | null } | null;
  householdMembers: { id: string; name: string; relationship: string | null }[];
  birthDate: string | null;
  giving: { count: number; lifetime: number; lastAmount: number | null; lastDate: string | null };
  recentGifts: { id: string; amount: number; date: string; campaign: string | null }[];
  events: { id: string; name: string; date: string; status: string }[];
  notes: { id: string; date: string; text: string; type: string }[];
  noteCount: number;
  tags: string[];
  programs: string[];
};

function methodRows(
  rows: {
    kind: string;
    value: string;
    method_type: string | null;
    label: string | null;
    is_primary: boolean;
  }[],
  kind: string,
  fallback: string | null,
) {
  const list = rows
    .filter((m) => m.kind === kind)
    .map((m) => ({ value: m.value, label: m.label || m.method_type || "", primary: m.is_primary }));
  if (list.length === 0 && fallback) return [{ value: fallback, label: "", primary: true }];
  return list;
}

/** Load the complete stored record for one contact. */
export async function fetchFullRecord(personId: string): Promise<FullRecord> {
  const { data: person, error } = await supabase
    .from("people")
    .select("*")
    .eq("id", personId)
    .single();
  if (error) throw error;

  const [methods, gifts, regs, notes] = await Promise.all([
    supabase
      .from("contact_methods")
      .select("kind, value, method_type, label, is_primary")
      .eq("person_id", personId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("donations")
      .select("id, amount, date, campaign")
      .eq("person_id", personId)
      .is("deleted_at", null)
      .order("date", { ascending: false }),
    supabase
      .from("registrations")
      .select("id, status, events(id, name, date)")
      .eq("person_id", personId)
      .limit(50),
    supabase
      .from("interactions")
      .select("id, date, text, type")
      .eq("person_id", personId)
      .order("date", { ascending: false })
      .limit(50),
  ]);

  let household: FullRecord["household"] = null;
  let householdMembers: FullRecord["householdMembers"] = [];
  if (person.household_id) {
    const [{ data: h }, { data: members }] = await Promise.all([
      supabase
        .from("households")
        .select("id, name, address")
        .eq("id", person.household_id)
        .maybeSingle(),
      supabase
        .from("people")
        .select("id, display_name, first_name, last_name, household_relationship")
        .eq("household_id", person.household_id)
        .is("deleted_at", null),
    ]);
    household = h ? { id: h.id, name: h.name, address: h.address ?? null } : null;
    householdMembers = (members ?? [])
      .filter((m) => m.id !== personId)
      .map((m) => ({
        id: m.id,
        name: personName(m),
        relationship: m.household_relationship ?? null,
      }));
  }

  const giftRows = (gifts.data ?? []).map((g) => ({
    id: g.id,
    amount: Number(g.amount ?? 0),
    date: g.date as string,
    campaign: g.campaign ?? null,
  }));
  const noteRows = (notes.data ?? []).map((n) => ({
    id: n.id,
    date: n.date as string,
    text: n.text ?? "",
    type: n.type as string,
  }));

  return {
    person: person as FullRecord["person"],
    name: personName(person),
    phones: methodRows(methods.data ?? [], "phone", person.phone ?? null),
    emails: methodRows(methods.data ?? [], "email", person.email ?? null),
    address: household?.address ?? null,
    household,
    householdMembers,
    birthDate: person.birth_date ?? null,
    giving: {
      count: giftRows.length,
      lifetime: giftRows.reduce((sum, g) => sum + g.amount, 0),
      lastAmount: giftRows[0]?.amount ?? null,
      lastDate: giftRows[0]?.date ?? null,
    },
    recentGifts: giftRows.slice(0, 5),
    events: (regs.data ?? [])
      .map((r) => {
        const e = r.events as unknown as { id: string; name: string; date: string } | null;
        return e ? { id: e.id, name: e.name, date: e.date, status: r.status as string } : null;
      })
      .filter((e): e is { id: string; name: string; date: string; status: string } => e !== null)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 6),
    notes: noteRows.slice(0, 4),
    noteCount: noteRows.length,
    tags: (person.tags ?? []) as string[],
    programs: (person.programs ?? []) as string[],
  };
}
