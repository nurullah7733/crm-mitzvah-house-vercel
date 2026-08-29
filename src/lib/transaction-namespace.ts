import { parseExternalTransactionId } from "@/lib/external-transaction-id";

export type TransactionSourceConfidence = "explicit" | "confirmed_inference" | "unknown";

export type TransactionNamespace = {
  sourceSystem: string | null;
  objectType: string | null;
  sourceTransactionId: string | null;
  sourceTransactionIdentity: string | null;
  strongIdentity: string | null;
};

export const TRANSACTION_SOURCE_OPTIONS = [
  { label: "Other / unknown", value: "" },
  { label: "Donorbox", value: "donorbox" },
  { label: "Salesforce", value: "salesforce" },
  { label: "Cognito Forms", value: "cognito_forms" },
] as const;

/** Stable extensible slug contract. Unknown values stay null, never `generic`. */
export function normalizeTransactionSlug(value: string | null | undefined) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

export function resolveTransactionNamespace({
  sourceSystem,
  objectType,
  transactionId,
}: {
  sourceSystem?: string | null | undefined;
  objectType?: string | null | undefined;
  transactionId?: string | null | undefined;
}): TransactionNamespace {
  const transaction = parseExternalTransactionId(transactionId);
  const source = normalizeTransactionSlug(sourceSystem);
  const type = source ? normalizeTransactionSlug(objectType) ?? "donation" : null;
  const identity = transaction.status === "valid" ? transaction.identityValue : null;
  return {
    sourceSystem: source,
    objectType: type,
    sourceTransactionId: transaction.status === "valid" ? transaction.storedValue : null,
    sourceTransactionIdentity: identity,
    strongIdentity: source && type && identity ? `tx:v2|${source}|${type}|${identity}` : null,
  };
}

export type TransactionReviewCondition =
  | "legacy_transaction"
  | "transaction_contradiction"
  | "soft_deleted_transaction"
  | "transaction_concurrency_conflict";

/** Convert structured SQL conditions into review routing without treating them as failed rows. */
export function transactionReviewCondition(error: unknown): TransactionReviewCondition | null {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : String(error ?? "");
  if (message.includes("IMPORT_TRANSACTION_LEGACY_REVIEW")) return "legacy_transaction";
  if (message.includes("IMPORT_TRANSACTION_CONTRADICTION")) return "transaction_contradiction";
  if (message.includes("IMPORT_TRANSACTION_SOFT_DELETED")) return "soft_deleted_transaction";
  if (message.includes("IMPORT_TRANSACTION_CONCURRENT_CONFLICT")) return "transaction_concurrency_conflict";
  return null;
}

export function transactionReviewReason(condition: TransactionReviewCondition) {
  if (condition === "legacy_transaction")
    return "This external transaction matches a legacy unnamespaced gift and needs explicit reconciliation.";
  if (condition === "soft_deleted_transaction")
    return "This external transaction belongs to a deleted gift and needs an explicit restore decision.";
  if (condition === "transaction_concurrency_conflict")
    return "This external transaction changed while the import was running and needs review.";
  return "This namespaced external transaction conflicts with an existing gift's person or activity details.";
}
