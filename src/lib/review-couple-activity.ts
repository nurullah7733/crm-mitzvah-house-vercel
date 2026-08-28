import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { RowValues } from "@/lib/import-mapping";
import { resolveReviewMergePayload } from "@/lib/review-quick";

function labels(raw: string | undefined) {
  return (raw ?? "")
    .split(/[,;|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export type CoupleActivityContext = {
  kind: "couple_activity_owner";
  main_claim: {
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
    resolved_person_id?: string | null;
  };
  partner_claim: {
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
    resolved_person_id?: string | null;
  };
  activity: Record<string, unknown>;
};

export function coupleActivityContext(row: Record<string, unknown> | null | undefined) {
  const value = row?.["review_context"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Partial<CoupleActivityContext>;
  if (
    context.kind !== "couple_activity_owner" ||
    !context.main_claim ||
    !context.partner_claim ||
    !context.activity
  )
    return null;
  return context as CoupleActivityContext;
}

export async function resolveCoupleActivity(
  itemId: string,
  owner: "main" | "partner",
  context: CoupleActivityContext,
  row: RowValues,
  batchId: string | null = null,
) {
  const source = "Import couple activity review";
  const { event, donation, note } = await resolveReviewMergePayload(row, source, batchId);
  const { data, error } = await supabase.rpc("resolve_review_couple_activity", {
    _item_id: itemId,
    _owner: owner,
    _main: context.main_claim as unknown as Json,
    _partner: context.partner_claim as unknown as Json,
    _row: row as unknown as Json,
    _activity: { event, donation, note } as Json,
    _labels: { tags: labels(row.tags), programs: labels(row.programs) } as Json,
    _batch_id: batchId,
  });
  if (error) throw error;
  return data;
}

export async function setAsideCoupleActivity(itemId: string) {
  const { error } = await supabase
    .from("review_queue")
    .update({ status: "skipped", resolution_note: "Set aside from couple activity review" })
    .eq("id", itemId);
  if (error) throw error;
}
