/** Canonical treatment for source transaction references: opaque text, never a number. */
export type ExternalTransactionIdResult = {
  storedValue: string | null;
  identityValue: string | null;
  status: "blank" | "valid" | "unsafe";
  reason: string | null;
};

type TransactionSourceCell = {
  raw: string | number | boolean | null;
  display: string;
  kind: "blank" | "string" | "number" | "boolean" | "date" | "formula";
  format?: string;
};

const unsafeNumericReason =
  "This transaction/reference ID came from a numeric Excel cell and cannot be trusted as an opaque identifier. Export or format it as text, then import it again.";

export function parseExternalTransactionId(
  input: string | null | undefined | TransactionSourceCell,
): ExternalTransactionIdResult {
  const cell = typeof input === "object" && input !== null ? input : null;
  const displayed = cell ? cell.display : input ?? "";
  const storedValue = String(displayed).trim();
  if (!storedValue) return { storedValue: null, identityValue: null, status: "blank", reason: null };

  // XLSX numbers are not opaque: formatting may hide leading zeroes or use
  // scientific notation, and Excel may already have rounded long identifiers.
  // A numeric formula result carries the same risk. CSV tokens arrive as strings.
  if (cell && (cell.kind === "number" || typeof cell.raw === "number")) {
    return { storedValue, identityValue: null, status: "unsafe", reason: unsafeNumericReason };
  }

  return {
    storedValue,
    identityValue: storedValue.toLowerCase().replace(/\s+/g, " "),
    status: "valid",
    reason: null,
  };
}
