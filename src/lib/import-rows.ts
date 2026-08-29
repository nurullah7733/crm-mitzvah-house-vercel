import { normalizeState, properCase, properCaseAddress } from "@/lib/proper-case";
import {
  splitFullName,
  splitName,
  splitPeopleList,
  type ColumnGuess,
  type FieldKey,
  type RowValues,
} from "@/lib/import-mapping";
import { decideCoupleName } from "@/lib/couple-semantics";
import { parseImportDateResult } from "@/lib/import-dates";
import { parseImportAmount, parseImportEmails, parseImportPhone } from "@/lib/import-normalization";
import type { SourceCell } from "@/lib/import-workbook";
import { parseExternalTransactionId } from "@/lib/external-transaction-id";

/** Unpack one spreadsheet row: the main contact, their partner, and any children on the row. */
export function buildRowValues(row: string[], mapping: ColumnGuess[], sourceCells?: SourceCell[]): RowValues {
  const out: RowValues = {};
  const childNames: string[] = [];
  const childFirsts: string[] = [];
  const childLasts: string[] = [];
  const childDobs: string[] = [];
  const childAges: string[] = [];
  const childSchools: string[] = [];
  const phones: { value: string; method_type: string }[] = [];
  const emails: { value: string; method_type: string }[] = [];
  const issues: NonNullable<RowValues["normalization_issues"]> = [];
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
      for (const part of value
        .split(/[;,|]|\s\/\s/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        const parsed = parseImportPhone(part);
        if (parsed.status === "valid" && parsed.base)
          phones.push({ value: parsed.base, method_type: PHONE_COLUMNS[m.field]! });
        else
          issues.push({ field: m.field, status: parsed.status === "unsafe" ? "unsafe" : "invalid", raw: part, message: parsed.status === "unsafe" ? "Phone format is not safe for identity matching." : "Phone number is invalid." });
      }
      if (!out.phone && phones[0]) out.phone = phones[0].value;
      return;
    }
    if (EMAIL_COLUMNS[m.field]) {
      for (const parsed of parseImportEmails(value)) {
        if (parsed.status === "valid" && parsed.canonical)
          emails.push({ value: parsed.canonical, method_type: EMAIL_COLUMNS[m.field]! });
        else if (parsed.status === "invalid")
          issues.push({ field: m.field, status: "invalid", raw: parsed.raw, message: "Email address is malformed and cannot identify a person." });
      }
      if (!out.email && emails[0]) out.email = emails[0].value;
      return;
    }
    if (m.field === "spouse_email") {
      const parsed = parseImportEmails(value);
      const valid = [...new Set(parsed.flatMap((result) => result.canonical ? [result.canonical] : []))];
      if (valid[0]) out.spouse_email = valid[0];
      parsed.filter((result) => result.status === "invalid").forEach((result) => issues.push({ field: m.field, status: "invalid", raw: result.raw, message: "Partner email is malformed and cannot identify a person." }));
      return;
    }
    if (m.field === "spouse_phone") {
      const parsed = parseImportPhone(value);
      if (parsed.status === "valid" && parsed.base) out.spouse_phone = parsed.base;
      else issues.push({ field: m.field, status: parsed.status === "unsafe" ? "unsafe" : "invalid", raw: value, message: "Partner phone is not safe for identity matching." });
      return;
    }
    if (["date", "birth_date", "anniversary_date"].includes(m.field)) {
      const parsed = parseImportDateResult(sourceCells?.[i] ?? value);
      if (parsed.status === "valid" && parsed.value) out[m.field] = parsed.value;
      else issues.push({ field: m.field, status: parsed.status === "ambiguous" ? "ambiguous" : "invalid", raw: value, message: parsed.status === "ambiguous" ? "Date order is ambiguous." : "Date is invalid." });
      return;
    }
    if (m.field === "amount") {
      const parsed = parseImportAmount(value);
      if (parsed.status === "valid" && parsed.canonical) out.amount = parsed.canonical;
      else issues.push({ field: m.field, status: parsed.status === "ambiguous_locale" ? "ambiguous_locale" : "invalid", raw: value, message: parsed.status === "ambiguous_locale" ? "Amount uses an ambiguous number format." : "Amount is invalid." });
      return;
    }
    if (m.field === "transaction_id") {
      const parsed = parseExternalTransactionId(sourceCells?.[i] ?? value);
      if (parsed.status === "valid" && parsed.storedValue) out.transaction_id = parsed.storedValue;
      else if (parsed.status === "unsafe")
        issues.push({
          field: m.field,
          status: "unsafe",
          raw: parsed.storedValue ?? value,
          message: parsed.reason!,
        });
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
      const parsed = parseImportDateResult(sourceCells?.[i] ?? value);
      if (parsed.status === "valid" && parsed.value) childDobs.push(parsed.value);
      else {
        childDobs.push("");
        issues.push({ field: m.field, status: parsed.status === "ambiguous" ? "ambiguous" : "invalid", raw: value, message: parsed.status === "ambiguous" ? "Child birth-date order is ambiguous." : "Child birth date is invalid." });
      }
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
  if (phones.length > 0)
    out.phones = [...new Map(phones.map((entry) => [entry.value, entry])).values()];
  if (emails.length > 0)
    out.emails = [...new Map(emails.map((entry) => [entry.value, entry])).values()];
  if (issues.length > 0) out.normalization_issues = issues;
  const tidied = tidyCase(out);
  if (tidied.full_name) {
    const couple = decideCoupleName(tidied.full_name);
    tidied.couple_decision = couple;
    if (couple.kind === "confident_couple" && couple.person1 && couple.person2) {
      tidied.first_name = couple.person1.first;
      tidied.last_name = couple.person1.last;
      tidied.spouse_first_name = couple.person2.first;
      tidied.spouse_last_name = couple.person2.last;
    }
  } else if (
    (tidied.spouse_full_name || tidied.spouse_first_name || tidied.spouse_last_name) &&
    (tidied.first_name || tidied.last_name)
  ) {
    const main = [tidied.first_name, tidied.last_name].filter(Boolean).join(" ");
    const partner =
      tidied.spouse_full_name ||
      [tidied.spouse_first_name, tidied.spouse_last_name].filter(Boolean).join(" ");
    const couple = decideCoupleName(`${main} & ${partner}`);
    tidied.couple_decision = couple;
  }
  return tidied;
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
