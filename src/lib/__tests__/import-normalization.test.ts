import { describe, expect, it } from "vitest";
import { allocateRegistrationCents, parseImportAmount, parseImportEmails, parseImportPhone } from "@/lib/import-normalization";
import { parseImportDate, parseImportDateResult, resolveImportDonationDate } from "@/lib/import-dates";
import { buildRowValues } from "@/lib/import-rows";
import { donationImportFingerprint, matchRow, type ExistingPerson } from "@/lib/import-mapping";

describe("M2-E conservative normalization", () => {
  it.each(["54", "54.00", "$54.00"])("normalizes %s to 5400 cents", (raw) => {
    expect(parseImportAmount(raw)).toMatchObject({ cents: 5400, canonical: "54.00", status: "valid" });
  });

  it.each(["$1,250.50", "1,250.50"])("normalizes %s to 125050 cents", (raw) => {
    expect(parseImportAmount(raw)).toMatchObject({ cents: 125050, canonical: "1250.50" });
  });

  it("handles signs and refuses ambiguous locales", () => {
    expect(parseImportAmount("(54.00)")).toMatchObject({ cents: -5400, sign: "negative" });
    expect(parseImportAmount("-54.00")).toMatchObject({ cents: -5400, sign: "negative" });
    expect(parseImportAmount("54,00").status).toBe("ambiguous_locale");
    expect(parseImportAmount("1.250,50").status).toBe("ambiguous_locale");
  });

  it("normalizes valid email variants and display syntax", () => {
    expect(parseImportEmails(" SARAH@EXAMPLE.COM ")[0]?.canonical).toBe("sarah@example.com");
    expect(parseImportEmails("John <john@example.com>")[0]?.canonical).toBe("john@example.com");
    expect(parseImportEmails("foo@bar")[0]?.status).toBe("invalid");
    expect(parseImportEmails("not-an-email@")[0]?.status).toBe("invalid");
  });

  it("normalizes US phone variants without extension contamination", () => {
    const values = ["(202) 555-0111", "202-555-0111", "2025550111", "+1 202 555 0111"];
    expect(new Set(values.map((value) => parseImportPhone(value).identityKey))).toEqual(new Set(["2025550111"]));
    expect(parseImportPhone("2025550111 x123")).toMatchObject({ identityKey: "2025550111", extension: "123" });
  });

  it("keeps uncertain international phones out of strong identity", () => {
    expect(parseImportPhone("+44 20 7946 0958")).toMatchObject({ status: "unsafe", identityKey: null });
  });

  it("does not turn an ambiguous DOB into agreement or contradiction", () => {
    const existing: ExistingPerson = {
      id: "p1", first_name: "Sarah", last_name: "Klein", email: null, phone: null,
      birth_date: "1988-05-04", household_id: null,
    };
    const result = matchRow({ first_name: "Sarah", last_name: "Klein", birth_date: "04/05/1988" }, [existing]);
    expect(result.status).toBe("ambiguous");
    expect(result.evidence?.[0]?.contradictions).not.toContain("birth_date");
    expect(result.evidence?.[0]?.positives).not.toContain("birth_date");
  });

  it("records malformed identity values as normalization issues", () => {
    const values = buildRowValues(
      ["Sarah", "foo@bar", "04/05/1988", "54,00"],
      [
        { field: "first_name", header: "First", confidence: "high" },
        { field: "email", header: "Email", confidence: "high" },
        { field: "birth_date", header: "DOB", confidence: "high" },
        { field: "amount", header: "Amount", confidence: "high" },
      ],
    );
    expect(values.email).toBeUndefined();
    expect(values.birth_date).toBeUndefined();
    expect(values.amount).toBeUndefined();
    expect(values.normalization_issues).toHaveLength(3);
  });

  it("fingerprints equivalent valid amount and date forms identically", () => {
    const row = { first_name: "Sarah", last_name: "Klein", email: "sarah@example.com" };
    const dates = ["2026-08-28", "8/28/2026"].map((value) => parseImportDate(value));
    const amounts = ["$72", "72", "72.00"].map((value) => parseImportAmount(value).cents! / 100);
    const fingerprints = amounts.flatMap((amount) => dates.map((date) => donationImportFingerprint(row, amount, date!)));
    expect(new Set(fingerprints).size).toBe(1);
  });

  it("classifies dotted ambiguity explicitly", () => {
    expect(parseImportDateResult("8.9.2023").status).toBe("ambiguous");
    expect(parseImportDate("13.9.2023")).toBe("2023-09-13");
  });

  it("uses typed XLSX metadata instead of an ambiguous display date", () => {
    const values = buildRowValues(
      ["04/05/1988"],
      [{ field: "birth_date", header: "DOB", confidence: "high" }],
      [{ raw: 32238, display: "04/05/1988", kind: "date", format: "m/d/yyyy" }],
    );
    expect(values.birth_date).toBe("1988-04-05");
    expect(values.normalization_issues).toBeUndefined();
  });

  it("never gives a bad nonblank donation date the blank-date fallback", () => {
    expect(resolveImportDonationDate("not a date", "2026-08-29")).toBeNull();
    expect(resolveImportDonationDate("04/05/1988", "2026-08-29")).toBeNull();
    expect(resolveImportDonationDate("", "2026-08-29")).toBe("2026-08-29");
  });

  it("allocates registration fees in cents", () => {
    expect(allocateRegistrationCents(10000, 25)).toEqual({ grossCents: 10000, feeCents: 2500, donationCents: 7500 });
    expect(allocateRegistrationCents(1800, 25)).toEqual({ grossCents: 1800, feeCents: 1800, donationCents: 0 });
  });
});
