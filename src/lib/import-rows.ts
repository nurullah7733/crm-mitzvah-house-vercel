import {
  normalizeEmail,
  normalizeState,
  properCase,
  properCaseAddress,
} from "@/lib/proper-case";
import {
  splitFullName,
  splitName,
  splitPeopleList,
  type ColumnGuess,
  type FieldKey,
  type RowValues,
} from "@/lib/import-mapping";

/** Unpack one spreadsheet row: the main contact, their partner, and any children on the row. */
export function buildRowValues(row: string[], mapping: ColumnGuess[]): RowValues {
  const out: RowValues = {};
  const childNames: string[] = [];
  const childFirsts: string[] = [];
  const childLasts: string[] = [];
  const childDobs: string[] = [];
  const childAges: string[] = [];
  const childSchools: string[] = [];
  const phones: { value: string; method_type: string }[] = [];
  const emails: { value: string; method_type: string }[] = [];
  const PHONE_COLUMNS: Partial<Record<FieldKey, string>> = {
    phone: "Mobile",
    phone_mobile: "Mobile",
    phone_home: "Home",
    phone_work: "Work",
    phone_other: "Other",
  };
  const EMAIL_COLUMNS: Partial<Record<FieldKey, string>> = {
    email: "Personal",
    email_work: "Work",
    email_other: "Other",
  };

  mapping.forEach((m, i) => {
    const value = row[i]?.trim();
    if (!value || m.field === "ignore") return;
    if (PHONE_COLUMNS[m.field]) {
      // One column can hold several numbers ("404-555-0100 / 404-555-0101").
      for (const part of value.split(/[;,|]|\s\/\s/).map((s) => s.trim()).filter(Boolean)) {
        phones.push({ value: part, method_type: PHONE_COLUMNS[m.field]! });
      }
      if (!out.phone && phones[0]) out.phone = phones[0].value;
      return;
    }
    if (EMAIL_COLUMNS[m.field]) {
      for (const part of value.split(/[;,|\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"))) {
        emails.push({ value: normalizeEmail(part), method_type: EMAIL_COLUMNS[m.field]! });
      }
      if (!out.email && emails[0]) out.email = emails[0].value;
      return;
    }
    if (m.field === "child_name") {
      childNames.push(...splitPeopleList(value));
      return;
    }
    if (m.field === "child_first_name") {
      childFirsts.push(value);
      return;
    }
    if (m.field === "child_last_name") {
      childLasts.push(value);
      return;
    }
    if (m.field === "child_birth_date") {
      childDobs.push(value);
      return;
    }
    if (m.field === "child_age") {
      childAges.push(value);
      return;
    }
    if (m.field === "child_school") {
      childSchools.push(value);
      return;
    }
    if (!out[m.field]) out[m.field] = value;
  });

  // Children can arrive either as whole names ("Child 1", "Child 2") or as paired
  // first/last columns. Both shapes become one child record each.
  const children: NonNullable<RowValues["children"]>[number][] = [];
  childNames.forEach((name, idx) => {
    const n = splitFullName(name);
    if (!n.first && !n.last) return;
    children.push({
      first: n.first,
      ...(n.last ? { last: n.last } : {}),
      ...(childDobs[idx] ? { birth_date: childDobs[idx]! } : {}),
      ...(childAges[idx] ? { age: childAges[idx]! } : {}),
      ...(childSchools[idx] ? { school: childSchools[idx]! } : {}),
    });
  });
  const pairedOffset = childNames.length;
  childFirsts.forEach((first, idx) => {
    if (!first.trim()) return;
    const last = childLasts[idx];
    children.push({
      first: first.trim(),
      ...(last ? { last } : {}),
      ...(childDobs[pairedOffset + idx] ? { birth_date: childDobs[pairedOffset + idx]! } : {}),
      ...(childAges[pairedOffset + idx] ? { age: childAges[pairedOffset + idx]! } : {}),
      ...(childSchools[pairedOffset + idx] ? { school: childSchools[pairedOffset + idx]! } : {}),
    });
  });
  if (children.length > 0) out.children = children;
  if (phones.length > 0) out.phones = phones;
  if (emails.length > 0) out.emails = emails;
  return tidyCase(out);
}

/**
 * Tidy capitalisation on the text that people read: names, addresses, cities.
 * Spelling is never touched, and anything already typed with deliberate internal
 * capitals is left exactly as it is.
 */
export function tidyCase(v: RowValues): RowValues {
  const nameKeys: FieldKey[] = [
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "household_name",
    "spouse_full_name",
    "spouse_first_name",
    "spouse_last_name",
    "school",
    "city",
  ];
  for (const k of nameKeys) if (v[k]) v[k] = properCase(v[k]!);
  for (const k of ["address", "address_line2"] as FieldKey[]) {
    if (v[k]) v[k] = properCaseAddress(v[k]!);
  }
  if (v.state) v.state = normalizeState(v.state);
  if (v.children) {
    v.children = v.children.map((c) => ({
      ...c,
      first: properCase(c.first),
      ...(c.last ? { last: properCase(c.last) } : {}),
      ...(c.school ? { school: properCase(c.school) } : {}),
    }));
  }
  return v;
}

/** Join the first / middle / last / suffix columns a file happens to have. */
export function mainName(v: RowValues) {
  const base = splitName(v);
  const first = [base.first, base.middle].filter(Boolean).join(" ").trim();
  const surname = base.last.trim();
  const last = [surname, base.suffix].filter(Boolean).join(" ").trim();
  const display = [first, last].filter(Boolean).join(" ").trim();
  return { first, last, surname, display };
}

