import { supabase } from "@/integrations/supabase/client";
import { personName } from "@/lib/names";

/** A gift of the same amount on the same day, sitting on a *different* contact. */
export type OtherContactGift = {
  id: string;
  personId: string;
  name: string;
  campaign: string | null;
};

/**
 * Every duplicate check we had was keyed on person_id, so if person-matching
 * failed and a second contact was created, the same gift landed there and passed
 * every guard. This looks for the gift itself — same amount, same date — on any
 * other contact, so it can be flagged instead of silently created.
 */
export async function findGiftsOnOtherContacts(
  amount: number,
  date: string,
  excludePersonIds: (string | null | undefined)[] = [],
): Promise<OtherContactGift[]> {
  if (!Number.isFinite(amount) || amount <= 0 || !date) return [];
  const skip = new Set(excludePersonIds.filter(Boolean) as string[]);
  const { data, error } = await supabase
    .from("donations")
    .select("id, person_id, campaigns(name), people(display_name, first_name, last_name)")
    .eq("amount", amount)
    .eq("date", date)
    .is("deleted_at", null)
    .limit(10);
  if (error) return [];
  return (data ?? [])
    .filter((g) => !skip.has(g.person_id))
    .map((g) => ({
      id: g.id,
      personId: g.person_id,
      name: personName(g.people),
      campaign: g.campaigns?.name ?? null,
    }));
}

/** Plain-language reason for parking a row that looks like this. */
export function sameGiftElsewhereReason(amount: number, date: string, others: OtherContactGift[]) {
  const names = others.map((o) => o.name).join(", ");
  return `A $${amount.toLocaleString()} gift on ${date} is already recorded for ${names}. Is this the same gift on a second contact record?`;
}
