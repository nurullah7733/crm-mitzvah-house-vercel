type NameLike = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/** Always render contact names from display_name, falling back to first + last. */
export function personName(p: NameLike | null | undefined) {
  if (!p) return "Unknown";
  const display = (p.display_name ?? "").trim();
  if (display) return display;
  const joined = [p.first_name ?? "", p.last_name ?? ""].join(" ").trim();
  return joined || "Unnamed contact";
}

export function personInitials(p: NameLike | null | undefined) {
  const name = personName(p);
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return `${first}${second}`.toUpperCase() || "?";
}

export const CONTACT_TYPES = ["individual", "organization", "foundation"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const GRANT_STAGES = [
  "researching",
  "LOI submitted",
  "applied",
  "awarded",
  "declined",
  "reporting due",
  "reported",
  "renewal eligible",
] as const;
export type GrantStage = (typeof GRANT_STAGES)[number];

export const CAMPAIGN_STATUSES = ["planning", "active", "completed", "archived"] as const;
