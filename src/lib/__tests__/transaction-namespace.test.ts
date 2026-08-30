import { describe, expect, it } from "vitest";
import {
  normalizeTransactionSlug,
  resolveTransactionNamespace,
  transactionReviewCondition,
} from "@/lib/transaction-namespace";
import { donationImportFingerprintFromCents } from "@/lib/import-mapping";

const gift = {
  email: "donor@example.test",
  transaction_id: " Tx-  001/A ",
  transaction_source_system: "donorbox",
  transaction_object_type: "donation",
};

describe("G3 transaction namespaces", () => {
  it("normalizes extensible source and object slugs", () => {
    expect(normalizeTransactionSlug(" Cognito Forms ")).toBe("cognito_forms");
    expect(normalizeTransactionSlug("Future.Provider-v2")).toBe("future_provider_v2");
    expect(normalizeTransactionSlug(" ")).toBeNull();
  });

  it("creates a strong explicit namespace while unknown stays legacy", () => {
    expect(resolveTransactionNamespace({ sourceSystem: "Donorbox", transactionId: "TX-1" }))
      .toMatchObject({ sourceSystem: "donorbox", objectType: "donation", strongIdentity: "tx:v2|donorbox|donation|tx-1" });
    expect(resolveTransactionNamespace({ transactionId: "TX-1" })).toMatchObject({
      sourceSystem: null,
      objectType: null,
      strongIdentity: null,
    });
  });

  it("uses case-insensitive collapsed whitespace while preserving punctuation and zeroes", () => {
    const namespace = resolveTransactionNamespace({ sourceSystem: "DONORBOX", objectType: "Donation", transactionId: "  Tx-  0001/A " });
    expect(namespace).toMatchObject({
      sourceTransactionId: "Tx-  0001/A",
      sourceTransactionIdentity: "tx- 0001/a",
      strongIdentity: "tx:v2|donorbox|donation|tx- 0001/a",
    });
    expect(resolveTransactionNamespace({ sourceSystem: "donorbox", transactionId: "TX0001/A" }).strongIdentity)
      .not.toBe(namespace.strongIdentity);
  });

  it("separates providers and makes strong identity independent of person", () => {
    const donorbox = donationImportFingerprintFromCents(gift, 7200, "2026-08-29");
    const salesforce = donationImportFingerprintFromCents({ ...gift, transaction_source_system: "salesforce" }, 7200, "2026-08-29");
    const otherPerson = donationImportFingerprintFromCents({ ...gift, email: "other@example.test" }, 9900, "2027-01-01");
    expect(donorbox).toBe("tx:v2|donorbox|donation|tx- 001/a");
    expect(salesforce).not.toBe(donorbox);
    expect(otherPerson).toBe(donorbox);
  });

  it("preserves the legacy fingerprint when source is unknown", () => {
    expect(donationImportFingerprintFromCents({ email: gift.email, transaction_id: "TX-1" }, 7200, "2026-08-29"))
      .toBe("email:donor@example.test|transaction|tx-1");
  });

  it.each([
    ["IMPORT_TRANSACTION_LEGACY_REVIEW", "legacy_transaction"],
    ["IMPORT_TRANSACTION_CONTRADICTION", "transaction_contradiction"],
    ["IMPORT_TRANSACTION_SOFT_DELETED", "soft_deleted_transaction"],
  ])("routes structured SQL condition %s", (message, condition) => {
    expect(transactionReviewCondition({ message })).toBe(condition);
  });
});
