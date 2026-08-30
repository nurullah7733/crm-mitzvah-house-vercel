import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830001000_review_failure_retry_safety.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("M2-I5 review and failure retry safety", () => {
  it("adds a guarded failed-row retry RPC that reopens only failed rows", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.retry_failed_import_row");
    expect(sql).toContain("IMPORT_ROW_NOT_RETRYABLE");
    expect(sql).toContain("IMPORT_ROW_STATE_CHANGED");
    expect(sql).toContain("IF v_outcome.outcome = 'failed' THEN");
    expect(sql).toContain("outcome = 'pending'");
    expect(sql).toContain("claim_token = NULL");
    expect(sql).toContain("attempt_count");
    expect(sql).toContain("_expected_attempt_count");
  });

  it("respects unresolved review rows and stale workers", () => {
    expect(sql).toContain("IMPORT_REVIEW_UNRESOLVED");
    expect(sql).toContain("review_queue_id IS NOT NULL");
    expect(sql).toContain("Row lock is held via the `FOR UPDATE` selects above");
    expect(sql).toContain("FOR UPDATE");
  });

  it("keeps a durable failed result context while clearing active claim metadata", () => {
    expect(sql).toContain("last_error");
    expect(sql).toContain("completed_at = NULL");
    expect(sql).toContain("claimed_by = NULL");
    expect(sql).toContain("lease_expires_at = NULL");
    expect(sql).toContain("result");
  });

  it("updates the import outcome metadata when a review is resolved", () => {
    expect(sql).toContain("sync_import_review_resolution_metadata");
    expect(sql).toContain("UPDATE public.import_row_outcomes SET");
    expect(sql).toContain("result = v_result");
    expect(sql).toContain("review_queue_id IS NOT NULL");
  });
});
