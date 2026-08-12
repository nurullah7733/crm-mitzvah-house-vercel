import { fuzzyScore } from "@/lib/nl-search";

/** Fields a spreadsheet column can be mapped to. */
export type FieldKey =
  | "title"
  | "first_name"
  | "middle_name"
  | "last_name"
  | "suffix"
  | "full_name"
  | "email"
  | "phone"
  | "address"
  | "address_line2"
  | "address_line3"
  | "city"
  | "state"
  | "postal_code"
  | "county"
  | "billing_address"
  | "household_name"
  | "birth_date"
  | "anniversary_date"
  | "school"
  | "person_notes"
  | "spouse_full_name"
  | "spouse_first_name"
  | "spouse_last_name"
  | "spouse_email"
  | "spouse_phone"
  | "child_name"
  | "child_birth_date"
  | "child_school"
  | "amount"
  | "date"
  | "campaign"
  | "notes"
  | "met_source"
  | "tags"
  | "programs"
  | "ignore";

export const FIELD_LABELS: Record<FieldKey, string> = {
  title: "Title (Mr, Mrs, Rabbi…)",
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  suffix: "Suffix (Jr, MD…)",
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  address: "Home address",
  address_line2: "Address line 2 (apt, unit)",
  address_line3: "Extra address line",
  city: "City",
  state: "State",
  postal_code: "ZIP / postal code",
  county: "County",
  billing_address: "Billing address",
  household_name: "Household name",
  birth_date: "Birth date",
  anniversary_date: "Anniversary",
  school: "School",
  person_notes: "Notes about this person",
  spouse_full_name: "Partner — full name",
  spouse_first_name: "Partner — first name",
  spouse_last_name: "Partner — last name",
  spouse_email: "Partner — email",
  spouse_phone: "Partner — phone",
  child_name: "Child — name (repeatable)",
  child_birth_date: "Child — birth date (repeatable)",
  child_school: "Child — school (repeatable)",
  amount: "Donation amount",
  date: "Donation date",
  campaign: "Campaign",
  notes: "Message / form note",
  met_source: "Where we met",
  tags: "Tags",
  programs: "Programs",
  ignore: "Don't import",
};

/** These may be mapped to more than one column (child 1, child 2, …). */
export const REPEATABLE_FIELDS: FieldKey[] = ["child_name", "child_birth_date", "child_school"];

/** Known header spellings for each field. */
const SYNONYMS: Record<Exclude<FieldKey, "ignore">, string[]> = {
  title: ["title", "prefix", "salutation", "honorific"],
  first_name: ["first name", "first", "fname", "f name", "contact first", "contact first name", "given name", "firstname"],
  middle_name: ["middle name", "middle", "middle initial", "mi"],
  last_name: ["last name", "last", "lname", "l name", "contact last", "contact last name", "surname", "family name", "lastname"],
  suffix: ["suffix", "name suffix"],
  full_name: ["name", "full name", "contact name", "donor name", "display name", "your name", "parent name"],
  email: ["email", "e-mail", "email address", "primary email", "contact email", "mail"],
  phone: ["phone", "phone number", "cell", "cell phone", "mobile", "mobile phone", "telephone", "home phone", "primary phone"],
  address: ["address", "street", "street address", "address line 1", "mailing address", "home address", "city state zip", "shipping address"],
  address_line2: ["address line 2", "address 2", "apt", "apartment", "unit", "suite", "street 2", "address line two", "apt suite"],
  address_line3: ["address line 3", "address 3", "extra address line", "additional address", "care of", "c/o"],
  city: ["city", "town", "city name", "billing city", "shipping city"],
  state: ["state", "province", "region", "st", "billing state", "shipping state"],
  postal_code: ["zip", "zip code", "zipcode", "postal code", "postcode", "billing zip", "shipping zip"],
  county: ["county", "county name", "district"],
  billing_address: ["billing address", "billing street", "bill to address", "billing address line 1", "card address"],
  household_name: ["household", "household name", "family", "family name"],
  birth_date: ["birthday", "birth date", "birthdate", "dob", "date of birth"],
  anniversary_date: ["anniversary", "wedding anniversary", "anniversary date", "wedding date"],
  school: ["school", "school name", "grade school", "yeshiva", "day school"],
  person_notes: ["about", "occupation", "job title", "employer", "additional info", "other information", "details"],
  spouse_full_name: ["spouse", "spouse name", "partner", "partner name", "husband", "wife", "second parent", "parent 2", "parent 2 name"],
  spouse_first_name: ["spouse first name", "partner first name", "spouse first", "parent 2 first name"],
  spouse_last_name: ["spouse last name", "partner last name", "spouse last", "parent 2 last name"],
  spouse_email: ["spouse email", "partner email", "second email", "parent 2 email"],
  spouse_phone: ["spouse phone", "partner phone", "second phone", "parent 2 phone"],
  child_name: ["child", "child name", "children", "child 1", "child 1 name", "child 2", "child 2 name", "child 3 name", "student name", "camper name", "kid name", "participant name"],
  child_birth_date: ["child birthday", "child birth date", "child dob", "student dob", "child 1 dob", "child 2 dob"],
  child_school: ["child school", "student school", "child 1 school", "child 2 school", "child grade"],
  amount: ["amount", "gift amount", "donation amount", "total", "gross amount", "paid amount"],
  date: ["date", "gift date", "donation date", "transaction date", "created at", "processed on"],
  campaign: ["campaign", "fund", "appeal", "designation"],
  notes: ["notes", "note", "comments", "comment", "message", "memo", "your message", "questions"],
  met_source: ["source", "met at", "where we met", "how did you hear", "lead source", "referral"],
  tags: ["tags", "tag", "labels", "groups", "lists"],
  programs: ["programs", "program", "program interest", "interests"],
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
    const repeatable = REPEATABLE_FIELDS.includes(guess.field);
    if (guess.field !== "ignore" && !repeatable && used.has(guess.field)) {
      return { header: h, field: "ignore" as FieldKey, confidence: "low" as Confidence };
    }
    if (guess.field !== "ignore" && !repeatable) used.add(guess.field);
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

/** A single spreadsheet row, unpacked into one main contact plus the people attached to it. */
export type RowValues = Partial<Record<FieldKey, string>> & {
  children?: { name: string; birth_date?: string; school?: string }[];
};

/** Match a spreadsheet row to existing people: email, then phone, then name + address. */
export function matchRow(values: RowValues, people: ExistingPerson[]): MatchResult {
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
        (p.first_name ?? "").trim().toLowerCase() === first.toLowerCase() &&
        (p.last_name ?? "").trim().toLowerCase() === last.toLowerCase(),
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
    if (!first && !last) return { status: "ambiguous", reason: "No name in the file", candidates: [] };
    return { status: "new", reason: "Looks like a new person", candidates: [] };
  }

  return { status: "ambiguous", reason: "Not enough information to identify a person", candidates: [] };
}

const TITLES = ["mr", "mrs", "ms", "miss", "dr", "rabbi", "rebbetzin", "rev", "cantor", "prof", "mr.", "mrs.", "ms.", "dr.", "r'"];
const SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq", "jr.", "sr.", "m.d.", "ph.d."];

/**
 * Turn whatever name columns a file happens to have into a first + last name.
 * Handles "Last, First", "Rabbi Levi Cohen Jr", first-only and last-only files.
 */
export function splitName(values: Partial<Record<FieldKey, string>>): { first: string; last: string } {
  const first = (values.first_name ?? "").trim();
  const last = (values.last_name ?? "").trim();
  if (first || last) return { first, last };
  return splitFullName(values.full_name ?? "");
}

export function splitFullName(raw: string): { first: string; last: string } {
  const full = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!full) return { first: "", last: "" };
  if (full.includes(",")) {
    const [l, f] = full.split(",");
    return { first: (f ?? "").trim(), last: (l ?? "").trim() };
  }
  let parts = full.split(" ");
  if (parts.length > 1 && TITLES.includes((parts[0] ?? "").toLowerCase())) parts = parts.slice(1);
  if (parts.length > 1 && SUFFIXES.includes((parts[parts.length - 1] ?? "").toLowerCase().replace(/,$/, "")))
    parts = parts.slice(0, -1);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/** Split a cell that may hold several names ("Leah, Moshe and Sara"). */
export function splitPeopleList(raw: string): string[] {
  return (raw ?? "")
    .split(/[;,|]|\band\b|\&|\+|\//gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}
