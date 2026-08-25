import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type ImportRowFailure = {
  batchId: string;
  rowNumber: number;
  rowData: Json;
  message: string;
};

/**
 * Future cutover contract: call only after resolve_import_row returns an error.
 * Failure logging is best-effort, but the original CRM error always remains the
 * thrown result so logging can never turn a failed row into false success.
 */
export async function recordImportRowFailureAndRethrow(
  failure: ImportRowFailure,
  originalError: unknown,
): Promise<never> {
  try {
    const { error: loggingError } = await supabase.rpc("record_import_row_failure", {
      _batch_id: failure.batchId,
      _row_number: failure.rowNumber,
      _row_data: failure.rowData,
      _message: failure.message,
    });
    if (loggingError) console.error("Failed to record import row failure", loggingError);
  } catch (loggingError) {
    console.error("Failed to record import row failure", loggingError);
  }
  throw originalError;
}
