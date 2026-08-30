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
