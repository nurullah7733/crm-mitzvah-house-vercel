import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Renewal outreach ("lapsed") donors.
 *
 * Lapsed means: gave at least once in a prior calendar year, and has given
 * nothing so far this calendar year. It is always computed live from the gift
 * ledger in the database, so it is correct on January 1 — it never depends on
 * the stored this_year_giving column.
 *
 * Views:
 *  - lapsed: everyone who gave before and not yet this year
 *  - lybunt: gave LAST year but unfortunately not this year
 *  - sybunt: gave SOME earlier year but not last year and not this year
 */
export type RenewalMode = "lapsed" | "lybunt" | "sybunt";

export type RenewalDonor = {
  person_id: string;
  name: string | null;
  owner: string | null;
  email: string | null;
  phone: string | null;
  lifetime_total: number;
  prior_years: number;
  gave_last_year: boolean;
  last_gift_amount: number | null;
  last_gift_date: string | null;
  last_gift_year: number | null;
  score: number;
};

export const RENEWAL_LABELS: Record<RenewalMode, string> = {
  lapsed: "All lapsed donors",
  lybunt: "LYBUNT — gave last year, not this year",
  sybunt: "SYBUNT — gave an earlier year, not since",
};

export type RenewalSettings = { min_total_giving: number; min_prior_years: number };

export const RENEWAL_DEFAULTS: RenewalSettings = { min_total_giving: 0, min_prior_years: 1 };

export function useRenewalSettings() {
  return useQuery({
    queryKey: ["renewal-settings"],
    queryFn: async (): Promise<RenewalSettings> => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "renewal_outreach").maybeSingle();
      const v = (data?.value ?? {}) as Partial<RenewalSettings>;
      return {
        min_total_giving: Number(v.min_total_giving ?? RENEWAL_DEFAULTS.min_total_giving),
        min_prior_years: Number(v.min_prior_years ?? RENEWAL_DEFAULTS.min_prior_years),
      };
    },
    staleTime: 60_000,
  });
}

export async function fetchRenewalDonors(mode: RenewalMode, limit = 500): Promise<RenewalDonor[]> {
  const { data, error } = await supabase.rpc("lapsed_donors", { _mode: mode, _limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    lifetime_total: Number(r.lifetime_total ?? 0),
    last_gift_amount: r.last_gift_amount === null ? null : Number(r.last_gift_amount),
    score: Number(r.score ?? 0),
  })) as RenewalDonor[];
}

export function useRenewalDonors(mode: RenewalMode, limit = 500) {
  return useQuery({
    queryKey: ["renewal-donors", mode, limit],
    queryFn: () => fetchRenewalDonors(mode, limit),
  });
}

/** The renewal ask, written as outreach about a gift — never as money owed. */
export function renewalTaskText(d: RenewalDonor) {
  const amount = d.last_gift_amount ? `$${Math.round(d.last_gift_amount).toLocaleString()}` : "a gift";
  const year = d.last_gift_year ?? "a previous year";
  return `Renewal call — ${d.name ?? "this contact"}, last gave ${amount} in ${year}`;
}
