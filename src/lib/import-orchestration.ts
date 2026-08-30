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
