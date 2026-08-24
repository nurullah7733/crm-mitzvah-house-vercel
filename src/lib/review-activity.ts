import type { RowValues } from "@/lib/import-mapping";
import { processReviewRowActivity } from "@/lib/review-quick";

/** Imported activity must finish before the review decision can be finalized. */
export async function processActivityBeforeFinalize<T>(
  personId: string,
  row: RowValues,
  source: string,
  batchId: string | null,
  finalize: () => Promise<T>,
): Promise<T> {
  await processReviewRowActivity(personId, row, source, batchId);
  return finalize();
}
