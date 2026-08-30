import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// LIVE QA against the M2-I5 migration found three product defects, fixed forward in
// 20260830001100_review_resolution_outcome_metadata.sql (20260830001000 is already applied
// live and is intentionally not edited). These tests pin the actual fix content so a future
// change can't silently reopen any of them — the earlier i5-review-failure-retry-safety.test.ts
// only read 001000, which is exactly why none of these three defects were caught until a real
// database was exercised.
const fixSql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830001100_review_resolution_outcome_metadata.sql",
    import.meta.url,
  ),
  "utf8",
);
const retrySql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830001000_review_failure_retry_safety.sql",
    import.meta.url,
  ),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

describe("defect #1 — finalize_claimed_import_row_failure clears claim ownership on failure", () => {
  const fn = fixSql.slice(
    fixSql.indexOf("CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure"),
    fixSql.indexOf("-- Fix 3:"),
  );

  it("stale-worker validation still runs, unchanged, before any write", () => {
    // Same guard clause as the original 000900 definition — untouched by this fix.
    expect(fn).toContain("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    expect(fn).toContain("v_outcome.claimed_by IS DISTINCT FROM _claimed_by");
    expect(fn).toContain("v_outcome.lease_expires_at IS NULL OR v_outcome.lease_expires_at <= clock_timestamp()");
    expect(fn.indexOf("IMPORT_ROW_CLAIM_LOST")).toBeLessThan(fn.indexOf("UPDATE public.import_row_outcomes SET"));
  });

  it("clears claim_token, claimed_by, claimed_at and lease_expires_at in the same UPDATE that finalizes failure", () => {
    const update = fn.slice(fn.indexOf("UPDATE public.import_row_outcomes SET"), fn.indexOf("WHERE id = v_outcome.id;"));
    expect(update).toContain("outcome = 'failed'");
    expect(update).toContain("claim_token = NULL");
    expect(update).toContain("claimed_by = NULL");
    expect(update).toContain("claimed_at = NULL");
    expect(update).toContain("lease_expires_at = NULL");
  });

  it("preserves attempt_count, completed_at, last_error and result instead of resetting them", () => {
    const update = fn.slice(fn.indexOf("UPDATE public.import_row_outcomes SET"), fn.indexOf("WHERE id = v_outcome.id;"));
    expect(update).not.toContain("attempt_count");
    expect(update).toContain("completed_at = clock_timestamp()");
    expect(update).toContain("last_error = v_message");
    expect(update).toContain("result = v_result");
  });

  it("the four cleared fields are exactly what retry_failed_import_row's own guard requires to be null", () => {
    const guard = retrySql.slice(
      retrySql.indexOf("IF v_outcome.claim_token IS NOT NULL"),
      retrySql.indexOf("IMPORT_ROW_STATE_CHANGED", retrySql.indexOf("IF v_outcome.claim_token IS NOT NULL")),
    );
    expect(guard).toContain("v_outcome.claim_token IS NOT NULL");
    expect(guard).toContain("v_outcome.claimed_by IS NOT NULL");
    expect(guard).toContain("v_outcome.lease_expires_at IS NOT NULL");
    // Before the fix, finalize_claimed_import_row_failure never satisfied this guard for a row
    // that actually went through a real claim -> fail cycle, so retry always raised
    // IMPORT_ROW_STATE_CHANGED. This is the exact contract the fix restores.
  });

  it("still returns the same already_finalized shape for a stale replay after failure", () => {
    expect(fn).toContain("'already_finalized',true,'outcome',v_outcome.outcome");
  });
});

describe("defect #3 — sync_import_review_resolution_metadata requires active staff", () => {
  const fn = fixSql.slice(
    fixSql.indexOf(
      "CREATE OR REPLACE FUNCTION public.sync_import_review_resolution_metadata",
    ),
    fixSql.indexOf("REVOKE ALL ON FUNCTION public.sync_import_review_resolution_metadata"),
  );

  it("checks staff role before reading or writing anything", () => {
    const authIndex = fn.indexOf("IMPORT_STAFF_REQUIRED");
    const firstRead = fn.indexOf("SELECT * INTO v_review");
    expect(authIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(firstRead);
    expect(fn).toContain("public.has_role(auth.uid(), 'admin')");
    expect(fn).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(fn).toContain("public.has_role(auth.uid(), 'va')");
  });

  it("revokes direct authenticated access, matching the resolve_review_merge_core convention", () => {
    expect(fixSql).toContain(
      "REVOKE ALL ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;",
    );
    expect(fixSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) TO service_role;",
    );
    expect(fixSql).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.sync_import_review_resolution_metadata(uuid,text,text,uuid,jsonb) TO authenticated",
    );
  });
});

describe("defect #2 — review resolution wires the outcome metadata sync", () => {
  const fn = fixSql.slice(
    fixSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.log_review_decision"),
  );

  it("calls sync_import_review_resolution_metadata only for import-linked reviews", () => {
    expect(fn).toContain("IF v_review.import_outcome_id IS NOT NULL THEN");
    expect(fn).toContain(
      "PERFORM public.sync_import_review_resolution_metadata(_item_id, _decision, _reason, _person_id, '{}'::jsonb);",
    );
  });

  it("the already-finalized guard runs before the sync call, so a repeated resolution never reaches it", () => {
    expect(fn.indexOf("REVIEW_ALREADY_FINALIZED")).toBeLessThan(
      fn.indexOf("sync_import_review_resolution_metadata"),
    );
  });

  it("runs in the same transaction as the resolution — one PERFORM, not a second RPC round trip", () => {
    // A PERFORM inside a plpgsql function body executes in the caller's own transaction.
    expect(fn).toContain("PERFORM public.sync_import_review_resolution_metadata");
    expect(fn).not.toMatch(/supabase\.rpc/); // this is SQL, not client code — sanity check the slice
  });

  it("every active review-resolution path funnels through log_review_decision (the wiring point)", () => {
    const quickMerge = readFileSync(
      new URL(
        "../../../supabase/migrations/20260830000200_review_retry_active_path_cleanup.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const merge400 = readFileSync(
      new URL("../../../supabase/migrations/20260830000400_fix_manual_review_stale_snapshot.sql", import.meta.url),
      "utf8",
    );
    const householdCard = readFileSync(
      new URL("../../../supabase/migrations/20260830000100_household_correction_safety.sql", import.meta.url),
      "utf8",
    );
    // resolve_review_quick_merge / manual_merge / create -> resolve_review_merge_core -> log_review_decision.
    expect(quickMerge).toContain("resolve_review_merge_core");
    expect(merge400).toContain("v_result := public.resolve_review_merge_core(");
    // resolve_review_couple_activity calls log_review_decision directly.
    expect(quickMerge).toContain("PERFORM public.log_review_decision(_item_id,'created'");
    // resolve_review_household_card routes every terminal member action through one of the two.
    expect(householdCard).toContain("PERFORM public.resolve_review_merge_core(");
    expect(householdCard).toContain("PERFORM public.log_review_decision((v_member->>'item_id')::uuid, 'discarded'");
  });
});

describe("client — retryFailedImportRow (unchanged helper, now actually reachable)", () => {
  const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
  vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls retry_failed_import_row with the given identifiers and returns its data", async () => {
    const { retryFailedImportRow } = await import("@/lib/import-row-failure");
    rpc.mockResolvedValueOnce({ data: { outcome: "pending", outcome_id: "outcome-1" }, error: null });
    const result = await retryFailedImportRow({
      batchId: "batch-1",
      outcomeId: "outcome-1",
      stagedRowId: "staged-1",
    });
    expect(rpc).toHaveBeenCalledWith("retry_failed_import_row", {
      _batch_id: "batch-1",
      _outcome_id: "outcome-1",
      _staged_row_id: "staged-1",
      _expected_attempt_count: null,
      _expected_last_error: null,
    });
    expect(result).toEqual({ outcome: "pending", outcome_id: "outcome-1" });
  });

  it("throws the state-change rejection instead of swallowing it", async () => {
    const { retryFailedImportRow } = await import("@/lib/import-row-failure");
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "IMPORT_ROW_STATE_CHANGED", code: "P0001" },
    });
    await expect(
      retryFailedImportRow({ batchId: "b", outcomeId: "o", stagedRowId: "s" }),
    ).rejects.toMatchObject({ message: "IMPORT_ROW_STATE_CHANGED" });
  });
});

describe("defect #4 — the Import Center exposes a real, minimal retry action", () => {
  const retryFn = importer.slice(
    importer.indexOf("async function retryOneFailedRow"),
    importer.indexOf("async function", importer.indexOf("async function retryOneFailedRow") + 1),
  );

  it("a Retry Failed Row action exists and is wired to a click handler", () => {
    expect(importer).toContain("Retry Failed Row");
    expect(importer).toContain("void retryOneFailedRow(row)");
  });

  it("only failed rows are ever added to the retry list — not created/matched/flagged", () => {
    // retryableFailures is only pushed to inside the failure catch branch, after the
    // transaction-review and rowCommitted short-circuits have already `continue`d/thrown.
    const catchBlock = importer.slice(
      importer.indexOf("} catch (rowError) {"),
      importer.indexOf("// Let the browser breathe"),
    );
    expect(catchBlock).toContain("if (rowCommitted) throw rowError;");
    expect(catchBlock).toContain("retryableFailures.push(");
    expect(catchBlock.indexOf("failures += 1;")).toBeLessThan(catchBlock.indexOf("retryableFailures.push("));
    // queueForReview (the flagged path) exits via `continue` above the push, so a flagged row
    // never reaches retryableFailures.push at all.
    expect(catchBlock.indexOf("continue;")).toBeLessThan(catchBlock.indexOf("retryableFailures.push("));
  });

  it("the retry action calls retry_failed_import_row, then claim_import_rows, then execute_claimed_import_row, in that order", () => {
    expect(retryFn).toContain("retryFailedImportRow(");
    const claimIdx = retryFn.indexOf('"claim_import_rows"');
    const executeIdx = retryFn.indexOf('"execute_claimed_import_row"');
    expect(retryFn.indexOf("retryFailedImportRow(")).toBeLessThan(claimIdx);
    expect(claimIdx).toBeLessThan(executeIdx);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(executeIdx).toBeGreaterThan(-1);
  });

  it("never writes import_row_outcomes or calls resolve_import_row directly", () => {
    expect(retryFn).not.toContain('.from("import_row_outcomes")');
    expect(retryFn).not.toContain('rpc("resolve_import_row"');
  });

  it("reuses the fresh claim token from claim_import_rows, never a fabricated one", () => {
    expect(retryFn).toContain("_claim_token: claimed.claim_token");
    expect(retryFn).toContain("_claimed_by: active.leaseOwner");
    expect(retryFn).not.toMatch(/_claim_token:\s*row\./);
  });

  it("a rejected retry surfaces a safe message and refreshes the row instead of throwing to a global handler", () => {
    const catchBlock = retryFn.slice(retryFn.lastIndexOf("} catch (e) {"));
    expect(catchBlock).toContain("friendlyDbError(e,");
    expect(catchBlock).toContain("setFailedRetryRows(");
    expect(catchBlock).toContain("error: why");
  });
});
