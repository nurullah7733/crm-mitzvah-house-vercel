import { fuzzyScore } from "@/lib/nl-search";

export type FieldKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "address"
  | "household_name"
  | "birth_date"
  | "amount"
  | "date"
  | "campaign"
  | "notes"
  | "met_source"
  | "tags"
  | "programs"
  | "ignore";

export const FIELD_LABELS: Record<FieldKey, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  address: "Address",
  household_name: "Household name",
  birth_date: "Birth date",
  amount: "Donation amount",
  date: "Donation date",
  campaign: "Campaign",
  notes: "Notes",
  met_source: "Where we met",
  tags: "Tags",
  programs: "Programs",
  ignore: "Don't import",
};

/** Known header spellings for each field. */
const SYNONYMS: Record<Exclude<FieldKey, "ignore">, string[]> = {
  first_name: ["first name", "first", "fname", "f name", "contact first", "contact first name", "given name", "firstname"],
  last_name: ["last name", "last", "lname", "l name", "contact last", "contact last name", "surname", "family name", "lastname"],
  full_name: ["name", "full name", "contact name", "donor name", "display name"],
  email: ["email", "e-mail", "email address", "primary email", "contact email", "mail"],
  phone: ["phone", "phone number", "cell", "cell phone", "mobile", "mobile phone", "telephone", "home phone", "primary phone"],
  address: ["address", "street", "street address", "address line 1", "mailing address", "home address", "city state zip"],
  household_name: ["household", "household name", "family", "family name"],
  birth_date: ["birthday", "birth date", "birthdate", "dob", "date of birth"],
  amount: ["amount", "gift amount", "donation amount", "total", "gross amount", "paid amount"],
  date: ["date", "gift date", "donation date", "transaction date", "created at", "processed on"],
  campaign: ["campaign", "fund", "appeal", "designation", "program"],
  notes: ["notes", "note", "comments", "comment", "message", "memo"],
  met_source: ["source", "met at", "where we met", "how did you hear", "lead source", "referral"],
  tags: ["tags", "tag", "labels", "groups", "lists"],
  programs: ["programs", "program interest", "interests"],
};

export type Confidence = "high" | "medium" | "low";

export type ColumnGuess = { header: string; field: FieldKey; confidence: Confidence };

function normalize(h: string) {
  return h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
}

/** Guess which CRM field each spreadsheet column belongs to. */
export function guessColumn(header: string): ColumnGuess {
  const h = normalize(header);
  if (!h) return { header, field: "ignore", confidence: "low" };

  let best: { field: FieldKey; score: number } | null = null;
  for (const [field, list] of Object.entries(SYNONYMS) as [FieldKey, string[]][]) {
    for (const syn of list) {
      if (h === syn) return { header, field, confidence: "high" };
      const score = fuzzyScore(syn, h);
      if (score !== null && (best === null || score < best.score)) best = { field, score };
    }
  }
  if (!best) return { header, field: "ignore", confidence: "low" };
  return { header, field: best.field, confidence: best.score <= 1 ? "medium" : "low" };
}

export function guessMapping(headers: string[]): ColumnGuess[] {
  const used = new Set<FieldKey>();
  return headers.map((h) => {
    const guess = guessColumn(h);
    if (guess.field !== "ignore" && used.has(guess.field)) {
      return { header: h, field: "ignore" as FieldKey, confidence: "low" as Confidence };
    }
    if (guess.field !== "ignore") used.add(guess.field);
    return guess;
  });
}

export function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export type ExistingPerson = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  household_id: string | null;
  households?: { name: string; address: string | null } | null;
};

export type MatchResult = {
  status: "matched" | "new" | "ambiguous";
  reason: string;
  candidates: ExistingPerson[];
};

/** Match a spreadsheet row to existing people: email, then phone, then name + address. */
export function matchRow(values: Partial<Record<FieldKey, string>>, people: ExistingPerson[]): MatchResult {
  const email = (values.email ?? "").trim().toLowerCase();
  if (email) {
    const hits = people.filter((p) => (p.email ?? "").trim().toLowerCase() === email);
    if (hits.length === 1) return { status: "matched", reason: "Matched on email", candidates: hits };
    if (hits.length > 1) return { status: "ambiguous", reason: "Several people share that email", candidates: hits };
  }

  const phone = digits(values.phone);
  if (phone.length >= 7) {
    const hits = people.filter((p) => digits(p.phone).endsWith(phone.slice(-10)));
    if (hits.length === 1) return { status: "matched", reason: "Matched on phone", candidates: hits };
    if (hits.length > 1) return { status: "ambiguous", reason: "Several people share that phone", candidates: hits };
  }

  const { first, last } = splitName(values);
  if (first || last) {
    const nameHits = people.filter(
      (p) =>
        p.first_name.trim().toLowerCase() === first.toLowerCase() &&
        p.last_name.trim().toLowerCase() === last.toLowerCase(),
    );
    const address = (values.address ?? "").trim().toLowerCase();
    if (nameHits.length === 1) {
      if (!address || (nameHits[0]?.households?.address ?? "").trim().toLowerCase() === address) {
        return { status: "matched", reason: "Matched on name + address", candidates: nameHits };
      }
      return { status: "ambiguous", reason: "Same name, different address", candidates: nameHits };
    }
    if (nameHits.length > 1) {
      const withAddress = address
        ? nameHits.filter((p) => (p.households?.address ?? "").trim().toLowerCase() === address)
        : [];
      if (withAddress.length === 1)
        return { status: "matched", reason: "Matched on name + address", candidates: withAddress };
      return { status: "ambiguous", reason: "More than one person with that name", candidates: nameHits };
    }
    if (!last) return { status: "ambiguous", reason: "No last name in the file", candidates: [] };
    return { status: "new", reason: "Looks like a new person", candidates: [] };
  }

  return { status: "ambiguous", reason: "Not enough information to identify a person", candidates: [] };
}

export function splitName(values: Partial<Record<FieldKey, string>>) {
  const first = (values.first_name ?? "").trim();
  const last = (values.last_name ?? "").trim();
  if (first || last) return { first, last };
  const full = (values.full_name ?? "").trim();
  if (!full) return { first: "", last: "" };
  if (full.includes(",")) {
    const [l, f] = full.split(",");
    return { first: (f ?? "").trim(), last: (l ?? "").trim() };
  }
  const parts = full.split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}