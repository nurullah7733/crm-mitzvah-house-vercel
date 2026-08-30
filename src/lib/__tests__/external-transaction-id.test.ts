import { describe, expect, it } from "vitest";
import { parseExternalTransactionId } from "@/lib/external-transaction-id";
import { buildRowValues } from "@/lib/import-rows";
import { donationImportFingerprintFromCents, rowOccurrenceKeys } from "@/lib/import-mapping";
import { buildActivityPlan } from "@/lib/import-activity-plan";
import { resolveReviewMergePayload } from "@/lib/review-quick";

const mapping = [{ field: "transaction_id" as const, header: "Transaction ID", confidence: "high" as const }];
const person = { first_name: "Opaque", last_name: "Donor", email: "opaque@example.test", amount: "10", date: "2026-08-29" };

describe("opaque external transaction IDs", () => {
  it.each(["00012345", "TX-00123", "pay/abc:001"])("preserves safe CSV text %s", (value) => {
    const parsed = parseExternalTransactionId(value);
    expect(parsed).toMatchObject({ storedValue: value, status: "valid" });
    expect(buildRowValues([value], mapping).transaction_id).toBe(value);
  });

  it("preserves an XLSX text cell with leading zeroes", () => {
    const values = buildRowValues(["00012345"], mapping, [
      { raw: "00012345", display: "00012345", kind: "string" },
    ]);
    expect(values).toMatchObject({ transaction_id: "00012345" });
    expect(values.normalization_issues).toBeUndefined();
  });

  it("makes case and whitespace comparison explicit while preserving punctuation", () => {
    expect(parseExternalTransactionId("  Tx-  001 / A ")).toEqual({
      storedValue: "Tx-  001 / A",
      identityValue: "tx- 001 / a",
      status: "valid",
      reason: null,
    });
    expect(parseExternalTransactionId("TX-001").identityValue).not.toBe(
      parseExternalTransactionId("TX001").identityValue,
    );
    expect(parseExternalTransactionId("00123").identityValue).not.toBe(
      parseExternalTransactionId("123").identityValue,
    );
  });

  it.each([
    [{ raw: 12345, display: "12345", kind: "number" as const }, "ordinary numeric"],
    [{ raw: 1234500000000, display: "1.2345E+12", kind: "number" as const }, "scientific notation"],
    [{ raw: 12345678901234568, display: "12345678901234568", kind: "number" as const }, "precision-risk numeric"],
    [{ raw: 12345, display: "00012345", kind: "number" as const, format: "00000000" }, "zero-padded numeric"],
  ])("blocks $label XLSX transaction cells", (cell, _label) => {
    const values = buildRowValues([cell.display], mapping, [cell]);
    expect(values.transaction_id).toBeUndefined();
    expect(values.normalization_issues?.[0]).toMatchObject({ field: "transaction_id", status: "unsafe" });
    expect(values.normalization_issues?.[0]?.message).toContain("format it as text");
  });

  it("uses one normalized identity for occurrence keys and donation fingerprints", () => {
    const first = { ...person, transaction_id: " TX-  1 " };
    const second = { ...person, transaction_id: "tx- 1" };
    expect(rowOccurrenceKeys(first)).toEqual(rowOccurrenceKeys(second));
    expect(donationImportFingerprintFromCents(first, 1000, person.date)).toBe(
      donationImportFingerprintFromCents(second, 1000, person.date),
    );
  });

  it("blocks unsafe XLSX identity instead of silently auto-importing with fallback identity", () => {
    const values = buildRowValues(["12345"], mapping, [
      { raw: 12345, display: "12345", kind: "number" },
    ]);
    const plan = buildActivityPlan({
      row: { ...person, ...values },
      effectiveDate: person.date,
      eventDecision: { kind: "ignore" },
    });
    expect(plan.sourceTransactionId).toBeNull();
    expect(plan.blockingIssues[0]).toContain("numeric Excel cell");
  });

  it("preserves the stored value in review donation payloads", async () => {
    const payload = await resolveReviewMergePayload(
      { ...person, transaction_id: "  Tx-001  " },
      "Review",
      null,
    );
    expect(payload.donation).toMatchObject({ external_transaction_id: "Tx-001" });
  });
});
