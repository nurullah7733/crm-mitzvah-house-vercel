import { supabase } from "@/integrations/supabase/client";

/**
 * Donations used to carry a free-text `campaign` column alongside `campaign_id`,
 * so the same fact lived in two places and new gifts only filled one of them.
 * The text column is gone: anything that arrives as a name (imports, quick add)
 * is resolved to a real campaign row here.
 */
const cache = new Map<string, string | null>();

/** Tests and long-lived sessions can drop the memoised lookups. */
export function resetCampaignCache() {
  cache.clear();
}

export async function resolveCampaignId(name?: string | null): Promise<string | null> {
  const clean = (name ?? "").toString().trim();
  if (!clean) return null;
  const key = clean.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const { data: found } = await supabase
    .from("campaigns")
    .select("id")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();
  let id = found?.id ?? null;
  if (!id) {
    const { data: created } = await supabase
      .from("campaigns")
      .insert({ name: clean, status: "active" })
      .select("id")
      .single();
    id = created?.id ?? null;
  }
  cache.set(key, id);
  return id;
}

/** The campaign name on a donation row selected with `campaigns(name)`. */
export function campaignLabel(
  row: { campaigns?: { name: string | null } | null } | null | undefined,
): string | null {
  return row?.campaigns?.name ?? null;
}
