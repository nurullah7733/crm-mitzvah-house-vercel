import { describe, expect, it } from "vitest";
import { isExactTransactionDonationRepeat, type ExistingImportDonation } from "@/lib/donation-dupes";
import { donationImportFingerprintFromCents } from "@/lib/import-mapping";

const row = {
  first_name: "F12",
  last_name: "TxDonor",
  email: "m2f.f12@example.test",
  amount: "72",
  date: "2026-08-29",
  campaign: "M2F Shared Campaign",
  transaction_id: "TX-1",
};
const fingerprint = donationImportFingerprintFromCents(row, 7200, "2026-08-29");
const existing: ExistingImportDonation = {
  person_id: "person-1",
  import_fingerprint: fingerprint,
  amount: 72,
  date: "2026-08-29",
  event_id: null,
  campaigns: { name: "M2F Shared Campaign" },
};

const check = (overrides: Partial<Parameters<typeof isExactTransactionDonationRepeat>[0]> = {}) =>
  isExactTransactionDonationRepeat({
    row,
    personId: "person-1",
    fingerprint,
    netAmountCents: 7200,
    donationDate: "2026-08-29",
    eventId: null,
    existing: [existing],
    ...overrides,
  });

describe("strong transaction donation repeats", () => {
  it("accepts the exact transaction repeat for the resolved same person", () => {
    expect(check()).toBe(true);
  });

  it("keeps fallback fingerprint collisions conservative", () => {
    expect(check({ row: { ...row, transaction_id: "" } })).toBe(false);
  });

  it("does not bypass unresolved or different-person identity", () => {
    expect(check({ personId: null })).toBe(false);
    expect(check({ personId: "person-2" })).toBe(false);
  });

  it.each([
    ["amount", { netAmountCents: 7300 }],
    ["date", { donationDate: "2026-08-30" }],
    ["campaign", { row: { ...row, campaign: "Different Campaign" } }],
    ["event", { eventId: "event-1" }],
  ])("does not suppress a contradictory %s repeat", (_label, override) => {
    expect(check(override)).toBe(false);
  });

  it("keeps TX-1 and TX-2 distinct", () => {
    const tx2 = { ...row, transaction_id: "TX-2" };
    expect(check({ row: tx2, fingerprint: donationImportFingerprintFromCents(tx2, 7200, "2026-08-29") })).toBe(false);
  });
});
