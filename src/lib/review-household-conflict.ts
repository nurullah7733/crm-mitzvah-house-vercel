import { supabase } from "@/integrations/supabase/client";

export type HouseholdConflictContext = {
  kind: "household_conflict";
  main_person_id: string;
  partner_person_id: string;
  main_household_id: string | null;
  partner_household_id: string | null;
  main_household_name?: string | null;
  partner_household_name?: string | null;
  main_name: string;
  partner_name: string;
};

export function householdConflictContext(row: Record<string, unknown> | null | undefined) {
  const value = row?.["review_context"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Partial<HouseholdConflictContext>;
  if (
    context.kind !== "household_conflict" ||
    typeof context.main_person_id !== "string" ||
    typeof context.partner_person_id !== "string"
  )
    return null;
  return {
    kind: "household_conflict" as const,
    main_person_id: context.main_person_id,
    partner_person_id: context.partner_person_id,
    main_household_id: context.main_household_id ?? null,
    partner_household_id: context.partner_household_id ?? null,
    main_household_name: context.main_household_name ?? null,
    partner_household_name: context.partner_household_name ?? null,
    main_name: context.main_name ?? "Person A",
    partner_name: context.partner_name ?? "Person B",
  } satisfies HouseholdConflictContext;
}

/** Resolve only the review decision; this intentionally performs no CRM writes. */
export async function keepCurrentHouseholds(itemId: string) {
  const { error } = await supabase.rpc("log_review_decision", {
    _item_id: itemId,
    _decision: "kept_both",
    _reason: "Kept both people in their current households; no household change applied.",
  });
  if (error) throw error;
}
