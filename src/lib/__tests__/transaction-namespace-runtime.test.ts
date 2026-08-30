import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);
const review = readFileSync(new URL("../review-quick.ts", import.meta.url), "utf8");
const couple = readFileSync(new URL("../review-couple-activity.ts", import.meta.url), "utf8");

describe("G3 namespace runtime propagation", () => {
  it("persists explicit or unknown batch source selection", () => {
    expect(route).toContain("TRANSACTION_SOURCE_OPTIONS");
    expect(route).toContain("source_system: transactionSourceSystem || null");
    expect(route).toContain("source_system_confidence: sourceConfidence");
    expect(route).toContain("transaction_object_type: transactionObjectType");
    expect(route).not.toContain('transactionSourceSystem || "generic"');
  });

  it("sends the namespace in direct donation payloads", () => {
    expect(route).toContain(
      "external_transaction_id_key: giftPlan.activityPlan.sourceTransactionIdentity",
    );
    expect(route).toContain("transaction_source_system: giftPlan.activityPlan.sourceSystem");
    expect(route).toContain("transaction_object_type: giftPlan.activityPlan.transactionObjectType");
  });

  it("captures namespace in delayed review row data and never re-infers it", () => {
    expect(route).toContain("transaction_source_system: transactionSourceSystem");
    expect(route).toContain('transaction_source_confidence: "unknown"');
    expect(route).not.toMatch(/filename[\s\S]{0,100}infer/i);
  });

  it("propagates quick/manual/create review through one payload used by couple review", () => {
    expect(review).toContain("transaction_source_system: plan.sourceSystem");
    expect(review).toContain("transaction_object_type: plan.transactionObjectType");
    expect(review).toContain("external_transaction_id_key: plan.sourceTransactionIdentity");
    expect(couple).toContain("resolveReviewMergePayload(row, source, batchId)");
  });

  it("keeps registration-conflict resolution activity-free", () => {
    const keepExisting = review.slice(
      review.indexOf("export async function keepExistingRegistrationPayment"),
    );
    expect(keepExisting).toContain("_event: null");
    expect(keepExisting).toContain("_donation: null");
  });

  it("routes structured SQL transaction conditions to review instead of failure", () => {
    expect(route).toContain("transactionReviewCondition(rowError)");
    expect(route).toContain("await queueForReview(");
    expect(route).toContain('kind: "review"');
  });
});
