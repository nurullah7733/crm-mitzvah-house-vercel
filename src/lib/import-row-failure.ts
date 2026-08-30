import { supabase } from "@/integrations/supabase/client";

export type ImportRowFailure = {
  batchId: string;
  outcomeId: string;
  stagedRowId: string;
  claimToken: string;
  claimedBy: string;
  message: string;
};

/**
 * Claim-bound failure finalization runs only after the atomic execution RPC has
 * rolled back. A reclaimed row cannot be finalized by its stale worker.
 */
export async function recordImportRowFailureAndRethrow(
  failure: ImportRowFailure,
  originalError: unknown,
): Promise<never> {
  try {
    const { error: loggingError } = await supabase.rpc("finalize_claimed_import_row_failure", {
      _batch_id: failure.batchId,
      _outcome_id: failure.outcomeId,
      _staged_row_id: failure.stagedRowId,
      _claim_token: failure.claimToken,
      _claimed_by: failure.claimedBy,
      _message: failure.message,
    });
    if (loggingError) console.error("Failed to record import row failure", loggingError);
  } catch (loggingError) {
    console.error("Failed to record import row failure", loggingError);
  }
  throw originalError;
}

export type ImportRowRetryArgs = {
  batchId: string;
  outcomeId: string;
  stagedRowId: string;
  expectedAttemptCount?: number | null;
  expectedLastError?: string | null;
};

/** Minimal retry hook for the active Import Center row retry lane. */
export async function retryFailedImportRow(args: ImportRowRetryArgs) {
  const { data, error } = await (supabase.rpc as any)("retry_failed_import_row", {
    _batch_id: args.batchId,
    _outcome_id: args.outcomeId,
    _staged_row_id: args.stagedRowId,
    _expected_attempt_count: args.expectedAttemptCount ?? null,
    _expected_last_error: args.expectedLastError ?? null,
  });
  if (error) throw error;
  return data as unknown as {
    outcome?: string;
    outcome_id?: string;
    retry_count?: number;
    result?: Record<string, unknown>;
  } | null;
}
