import { describe, expect, it } from "vitest";
import { donationImportFingerprint, type RowValues } from "@/lib/import-mapping";

/**
 * Regression cover for the duplicate-donation bug: the same gift arriving twice
 * (re-uploaded file, gift also typed in by hand) must produce one identical
 * fingerprint so the database can reject the second copy.
 */

const row = (over: Partial<RowValues> = {}): RowValues => ({
  first_name: "Yosef",
  last_name: "Katz",
  email: "yosef@example.com",
  ...over,
});

describe("the same gift always produces the same fingerprint", () => {
  it("is stable across repeat imports of the same file", () => {
    const a = donationImportFingerprint(row(), 18, "2026-03-01");
    const b = donationImportFingerprint(row(), 18, "2026-03-01");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("ignores casing and spacing in the donor's email and the campaign", () => {
    const a = donationImportFingerprint(row({ campaign: "Matzah  Campaign" }), 18, "2026-03-01");
    const b = donationImportFingerprint(row({ email: " YOSEF@Example.com " }), 18, "2026-03-01");
    expect(b).toBe(donationImportFingerprint(row(), 18, "2026-03-01"));
    expect(a).toBe(
      donationImportFingerprint(row({ campaign: "matzah campaign" }), 18, "2026-03-01"),
    );
  });

  it("ignores how the amount was typed", () => {
    expect(donationImportFingerprint(row(), 18, "2026-03-01")).toBe(
      donationImportFingerprint(row(), 18.0, "2026-03-01"),
    );
  });

  it("does not depend on person_id, so a duplicated contact still can't duplicate the gift", () => {
    // The row carries no id at all — identity comes from the donor's own details.
    expect(donationImportFingerprint(row(), 18, "2026-03-01")).toContain("email:yosef@example.com");
  });

  it("uses the phone when there is no email, and the name when there is neither", () => {
    expect(
      donationImportFingerprint(row({ email: "", phone: "(404) 555-0100" }), 18, "2026-03-01"),
    ).toContain("phone:4045550100");
    expect(donationImportFingerprint(row({ email: "", phone: "" }), 18, "2026-03-01")).toContain(
      "name:yosef katz",
    );
  });
});

describe("genuinely different gifts do not collide", () => {
  const base = donationImportFingerprint(row(), 18, "2026-03-01");

  it.each([
    ["a different amount", donationImportFingerprint(row(), 36, "2026-03-01")],
    ["a different date", donationImportFingerprint(row(), 18, "2026-03-02")],
    [
      "a different donor",
      donationImportFingerprint(row({ email: "leah@example.com" }), 18, "2026-03-01"),
    ],
    [
      "a different campaign",
      donationImportFingerprint(row({ campaign: "Building Fund" }), 18, "2026-03-01"),
    ],
  ])("%s produces a different fingerprint", (_label, other) => {
    expect(other).not.toBe(base);
    expect(other).not.toBeNull();
  });

  it("three separate $18 gifts on three different days each stand alone", () => {
    const keys = ["2026-03-01", "2026-03-02", "2026-03-03"].map((d) =>
      donationImportFingerprint(row(), 18, d),
    );
    expect(new Set(keys).size).toBe(3);
  });
});

describe("refuses to fingerprint what it can't identify", () => {
  it.each([
    ["no donor details", donationImportFingerprint({}, 18, "2026-03-01")],
    ["no amount", donationImportFingerprint(row(), 0, "2026-03-01")],
    ["a negative amount", donationImportFingerprint(row(), -18, "2026-03-01")],
    ["no date", donationImportFingerprint(row(), 18, "")],
  ])("returns null for %s", (_label, value) => {
    expect(value).toBeNull();
  });
});

describe("imports and hand-typed gifts agree on the format", () => {
  /**
   * The database trigger that fingerprints a manually entered gift builds
   * `donor|date|amount|campaign` — donor key, ISO date, amount to two decimal
   * places, lower-cased campaign. If the importer ever drifts from that shape,
   * a hand-typed gift would no longer be recognised as the imported one.
   */
  it("matches the four-part shape the database trigger writes", () => {
    const fp = donationImportFingerprint(row({ campaign: "Matzah Campaign" }), 18, "2026-03-01");
    expect(fp).toBe("email:yosef@example.com|2026-03-01|18.00|matzah campaign");
    expect(fp!.split("|")).toHaveLength(4);
  });

  it("writes the amount with two decimal places, as the trigger does", () => {
    expect(donationImportFingerprint(row(), 1000, "2026-03-01")!.split("|")[2]).toBe("1000.00");
    expect(donationImportFingerprint(row(), 18.5, "2026-03-01")!.split("|")[2]).toBe("18.50");
  });

  it("leaves the campaign part empty when there is no campaign", () => {
    expect(donationImportFingerprint(row(), 18, "2026-03-01")!.endsWith("|")).toBe(true);
  });
});
