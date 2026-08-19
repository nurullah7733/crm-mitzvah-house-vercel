import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The organisation's own details and the letter wording, both editable in
 * Settings. They live in app_settings so no developer is needed to change an
 * address, an EIN or the acknowledgment template.
 */
export type OrgSettings = {
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  ein: string;
  phone: string;
  email: string;
  website: string;
  signer_name: string;
  signer_title: string;
  /** Shown under the gift table on a year-end statement. */
  statement_intro: string;
  /** IRS substantiation sentence for gifts with nothing given in return. */
  substantiation_text: string;
  /** Merge-field letter body for a single-gift acknowledgment. */
  acknowledgment_template: string;
};

export const ORG_DEFAULTS: OrgSettings = {
  name: "Mitzvah House",
  address_line1: "",
  address_line2: "",
  city: "Atlanta",
  state: "GA",
  postal_code: "",
  ein: "",
  phone: "",
  email: "",
  website: "",
  signer_name: "",
  signer_title: "Director",
  statement_intro:
    "Thank you for your generous support this year. Below is a summary of your tax-deductible contributions to {{org_name}} for {{tax_year}}. Please keep this statement with your tax records.",
  substantiation_text:
    "No goods or services were provided in exchange for these contributions. {{org_name}} is a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code; contributions are deductible to the extent allowed by law.",
  acknowledgment_template:
    "Dear {{donor_name}},\n\nThank you for your gift of {{gift_amount}} received on {{gift_date}} in support of {{designation}}. Your generosity makes our work in the community possible.\n\nNo goods or services were provided in exchange for this contribution. {{org_name}} is a 501(c)(3) organization, EIN {{ein}}.\n\nWith gratitude,\n{{signer_name}}\n{{signer_title}}\n{{org_name}}",
};

export const MERGE_FIELDS = [
  "{{donor_name}}",
  "{{gift_amount}}",
  "{{gift_date}}",
  "{{designation}}",
  "{{org_name}}",
  "{{ein}}",
  "{{signer_name}}",
  "{{signer_title}}",
  "{{tax_year}}",
] as const;

export function normalizeOrgSettings(value: unknown): OrgSettings {
  const v = (value ?? {}) as Partial<OrgSettings>;
  const out = { ...ORG_DEFAULTS };
  for (const key of Object.keys(ORG_DEFAULTS) as (keyof OrgSettings)[]) {
    const incoming = v[key];
    if (typeof incoming === "string" && incoming.trim()) out[key] = incoming;
  }
  return out;
}

/** Fill {{merge_fields}} in a template. Unknown fields are left untouched. */
export function mergeTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

/** "123 Main St, Atlanta, GA 30305" from whichever pieces are filled in. */
export function orgAddressLines(org: OrgSettings): string[] {
  const lines: string[] = [];
  if (org.address_line1.trim()) lines.push(org.address_line1.trim());
  if (org.address_line2.trim()) lines.push(org.address_line2.trim());
  const cityLine = [org.city, org.state].filter((p) => p.trim()).join(", ");
  const withZip = [cityLine, org.postal_code.trim()].filter(Boolean).join(" ");
  if (withZip.trim()) lines.push(withZip.trim());
  const contact = [org.phone, org.email, org.website].filter((p) => p.trim()).join(" · ");
  if (contact) lines.push(contact);
  return lines;
}

export const ORG_SETTINGS_KEY = "organization";

/** One-off read, for places that generate a document outside React Query. */
export async function loadOrgSettings(): Promise<OrgSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ORG_SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeOrgSettings(data?.value);
}

export function useOrgSettings() {
  return useQuery({
    queryKey: ["org-settings"],
    queryFn: async (): Promise<OrgSettings> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", ORG_SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return normalizeOrgSettings(data?.value);
    },
    staleTime: 60_000,
  });
}