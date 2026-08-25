import { mustWrite } from "@/lib/app-errors";
import { supabase } from "@/integrations/supabase/client";
import { addressKey } from "@/lib/import-mapping";
import type { Json } from "@/integrations/supabase/types";

/** Link first: a review item must not be finalized when its household write failed. */
export async function linkHouseholdBeforeFinalize<T>(
  write: PromiseLike<{ error: { message?: string } | null }>,
  finalize: () => Promise<T>,
): Promise<T> {
  await mustWrite(write, "The contact couldn't be linked to the household.");
  return finalize();
}

export type HouseholdReviewMember = Record<string, Json | undefined> & {
  action: "same" | "related" | "separate" | "discard" | "later";
  item_id: string;
};

/** Address matching remains client-side; the returned target is only applied inside the RPC. */
export async function findHouseholdIdAtAddress(address: string | null) {
  const key = addressKey(address);
  if (!key) return null;
  const { data, error } = await supabase.from("households").select("id, address").limit(1000);
  if (error) throw error;
  return (data ?? []).find((household) => addressKey(household.address) === key)?.id ?? null;
}

/** Apply every decision on one address card through one PostgreSQL transaction. */
export async function applyHouseholdReviewCard(
  household: {
    id: string | null;
    create: boolean;
    name: string;
    address: string | null;
    batch_id: string | null;
  },
  members: HouseholdReviewMember[],
) {
  const { data, error } = await supabase.rpc("resolve_review_household_card", {
    _household: household,
    _members: members,
  });
  if (error) throw error;
  return data as { household_id: string | null; saved: number; left: number };
}
