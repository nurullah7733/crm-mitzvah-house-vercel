import type { AddressDecision, BulkTarget, EventDecision } from "@/lib/import-links";
import type { TransactionSourceConfidence } from "@/lib/transaction-namespace";

export type ImportOrchestrationContextV1 = {
  version: 1;
  effective_date: string;
  source_namespace: {
    source_system: string | null;
    source_system_confidence: TransactionSourceConfidence;
    transaction_object_type: string | null;
  };
  event_decisions: Record<string, EventDecision>;
  address_decisions: Record<string, AddressDecision>;
  gift_event_decisions: Record<string, "attended" | "gift_only" | "skip">;
  bulk_target: BulkTarget;
  approvals: {
    repeated_file_confirmed: boolean;
    manual_header_risk_confirmed: boolean;
  };
};

export type BeginOrResumeImportBatchResult = {
  created: boolean;
  resumed: boolean;
  batch_id: string;
  status: "staging" | "ready" | "processing" | "needs_attention";
  resumable_identity: string;
  expected_rows: number;
  staged_rows: number;
  outcomes: number;
  orchestration_context: ImportOrchestrationContextV1;
};

export type FinalizeImportStagingResult = {
  batch_id: string;
  status: "ready";
  expected_rows: number;
  staged_rows: number;
  outcomes: number;
};

export type ClaimedImportRow = {
  outcome_id: string;
  staged_row_id: string;
  row_number: number;
  physical_row_number: number;
  attempt_count: number;
  claim_token: string;
  claimed_by: string;
  claimed_at: string;
  lease_expires_at: string;
  reclaimed: boolean;
  raw_cells: unknown;
  source_columns: unknown;
  mapping: unknown;
  normalized_values: unknown;
};

export function throwImportLeaseError(error: { message?: string } | null): never {
  const code = error?.message ?? "IMPORT_BATCH_LEASE_LOST";
  if (code.includes("IMPORT_BATCH_LEASE_HELD"))
    throw new Error("This import is already running in another session.");
  if (code.includes("IMPORT_BATCH_LEASE_LOST"))
    throw new Error("Import interrupted because this session no longer owns the execution lease.");
  throw new Error(code);
}

export function buildImportOrchestrationContext(input: {
  effectiveDate: string;
  sourceSystem: string | null;
  sourceConfidence: TransactionSourceConfidence;
  transactionObjectType: string | null;
  eventDecisions: Record<string, EventDecision>;
  addressDecisions: Record<string, AddressDecision>;
  giftEventDecisions: Record<string, "attended" | "gift_only" | "skip">;
  bulkTarget: BulkTarget;
  repeatedFileConfirmed: boolean;
  manualHeaderRiskConfirmed: boolean;
}): ImportOrchestrationContextV1 {
  return {
    version: 1,
    effective_date: input.effectiveDate,
    source_namespace: {
      source_system: input.sourceSystem,
      source_system_confidence: input.sourceConfidence,
      transaction_object_type: input.transactionObjectType,
    },
    event_decisions: structuredClone(input.eventDecisions),
    address_decisions: structuredClone(input.addressDecisions),
    gift_event_decisions: structuredClone(input.giftEventDecisions),
    bulk_target: structuredClone(input.bulkTarget),
    approvals: {
      repeated_file_confirmed: input.repeatedFileConfirmed,
      manual_header_risk_confirmed: input.manualHeaderRiskConfirmed,
    },
  };
}
