import { supabase } from "@/integrations/supabase/client";
import { addressKey } from "@/lib/import-mapping";
import { mustWrite } from "@/lib/app-errors";

/** A short, human-readable name for a household that only has an address. */
export function nameFromAddress(address: string) {
  const first = address
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return (first || address).trim().slice(0, 80) || "New address";
}

export type HouseholdMatch = { id: string; name: string; address: string | null; status: string };

/** Find an existing household at the same street address, address-only ones included. */
export async function findHouseholdAtAddress(address: string): Promise<HouseholdMatch | null> {
  const key = addressKey(address);
  if (!key) return null;
  const { data } = await supabase
    .from("households")
    .select("id, name, address, status")
    .limit(1000);
  for (const h of data ?? []) {
    if (addressKey(h.address) === key) return h as HouseholdMatch;
  }
  return null;
}

/** The follow-up task every address-only household gets, so nobody forgets to knock again. */
export async function createFindOutWhoTask(address: string, owner?: string | null) {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  await mustWrite(
    supabase.from("tasks").insert({
      text: `Find out who lives at ${nameFromAddress(address)}`,
      due_date: due.toISOString().slice(0, 10),
      owner: owner?.trim() || null,
      priority: "Normal",
      status: "upcoming",
      notes: address,
    }),
    "The follow-up task couldn't be created.",
  );
}
