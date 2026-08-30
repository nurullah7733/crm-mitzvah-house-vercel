import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M2-I6: import_batches.status / processed_rows / created_rows / matched_rows /
// flagged_rows / failed_rows / completed_at were previously written directly by the
// browser from a client-computed count, in exactly two places — the main import-run
// finalize block and I5's finalizeBatchAfterRetries — with nothing server-side ever
// verifying the count against durable import_row_outcomes rows, and
// finalizeBatchAfterRetries in particular marked the batch `completed` unconditionally
// the moment its own local retry list emptied, regardless of any other outstanding row
// (e.g. a flagged one). These tests pin the server-side authoritative contract added in
// 20260830001400 and the client cutover away from direct writes.
const sql = readFileSync(
  new URL("../../../supabase/migrations/20260830001400_authoritative_import_progress.sql", import.meta.url),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

function slice(source: string, from: string, to?: string) {
  const start = source.indexOf(from);
  if (start === -1) throw new Error(`marker not found: ${from}`);
  const searchFrom = start + from.length;
  const end = to ? source.indexOf(to, searchFrom) : source.length;
  return source.slice(start, end === -1 ? undefined : end);
}

const progressFn = slice(
  sql,
  "CREATE OR REPLACE FUNCTION public.import_batch_progress",
  "REVOKE ALL ON FUNCTION public.import_batch_progress",
);
const triggerFn = slice(
  sql,
  "CREATE OR REPLACE FUNCTION public.protect_import_batch_final_state",
  "REVOKE ALL ON FUNCTION public.protect_import_batch_final_state",
);
const reconcileFn = slice(sql, "CREATE OR REPLACE FUNCTION public.reconcile_import_batch");

describe("import_batch_progress — authoritative count derivation", () => {
  it("requires active staff before reading anything", () => {
    const authIdx = progressFn.indexOf("IMPORT_STAFF_REQUIRED");
    const selectIdx = progressFn.indexOf("SELECT\n");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(selectIdx);
  });

  it("derives every count from import_row_outcomes, not from import_batches", () => {
    expect(progressFn).toContain("FROM public.import_row_outcomes");
    expect(progressFn).not.toContain("FROM public.import_batches");
    expect(progressFn).toContain("count(*) FILTER (WHERE outcome = 'pending')");
    expect(progressFn).toContain("count(*) FILTER (WHERE outcome = 'created')");
    expect(progressFn).toContain("count(*) FILTER (WHERE outcome = 'matched')");
    expect(progressFn).toContain("count(*) FILTER (WHERE outcome = 'flagged')");
    expect(progressFn).toContain("count(*) FILTER (WHERE outcome = 'failed')");
  });

  it("splits processing rows into active vs reclaimable by lease expiry, and both count as incomplete", () => {
    expect(progressFn).toContain("outcome = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at > v_now");
    expect(progressFn).toContain("outcome = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= v_now)");
    expect(progressFn).toContain("'processing_active_count', v_processing_active");
    expect(progressFn).toContain("'processing_reclaimable_count', v_processing_reclaimable");
    expect(progressFn).toContain(
      "'incomplete', (v_pending + v_processing_active + v_processing_reclaimable) > 0",
    );
  });

  it("terminal_count is exactly created+matched+flagged+failed", () => {
    expect(progressFn).toContain("'terminal_count', v_created + v_matched + v_flagged + v_failed");
  });
});

describe("reconcile_import_batch — guarded finalization", () => {
  it("requires active staff and locks the batch row before anything else", () => {
    const authIdx = reconcileFn.indexOf("IMPORT_STAFF_REQUIRED");
    const lockIdx = reconcileFn.indexOf("FOR UPDATE;");
    expect(authIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(lockIdx);
  });

  it("reverted and historical imported batches are refused before any recount", () => {
    expect(reconcileFn).toContain("IF v_batch.status IN ('reverted', 'imported') THEN");
    expect(reconcileFn).toContain("'reason', 'IMPORT_BATCH_NOT_RECONCILABLE'");
    const refuseIdx = reconcileFn.indexOf("IMPORT_BATCH_NOT_RECONCILABLE");
    const progressCallIdx = reconcileFn.indexOf("public.import_batch_progress(_batch_id)");
    expect(refuseIdx).toBeLessThan(progressCallIdx);
  });

  it("refuses to finalize when staged/outcome rows don't yet match the expected total", () => {
    expect(reconcileFn).toContain("v_bound <> v_batch.total_rows");
    expect(reconcileFn).toContain("'reason', 'IMPORT_STAGING_INCOMPLETE'");
  });

  it("pending/processing rows (including expired-but-reclaimable) block completion and nothing is written", () => {
    const incompleteBlock = slice(reconcileFn, "IF (v_progress->>'incomplete')::boolean THEN", "END IF;");
    expect(incompleteBlock).toContain("'reason', 'IMPORT_ROWS_INCOMPLETE'");
    expect(incompleteBlock).not.toContain("UPDATE public.import_batches");
    expect(incompleteBlock).not.toContain("set_config");
    // the incomplete check must run before the guarded write section
    expect(reconcileFn.indexOf("IF (v_progress->>'incomplete')::boolean THEN")).toBeLessThan(
      reconcileFn.indexOf("set_config('app.import_batch_reconcile_mutation', 'on', true)"),
    );
  });

  it("final status: failed>0 or flagged>0 -> needs_attention, otherwise completed", () => {
    const rule = slice(reconcileFn, "v_final_status := CASE", "END;\n$$;");
    expect(rule.indexOf("(v_progress->>'failed_count')::integer > 0 THEN 'needs_attention'")).toBeGreaterThan(-1);
    expect(rule.indexOf("(v_progress->>'flagged_count')::integer > 0 THEN 'needs_attention'")).toBeGreaterThan(-1);
    expect(rule).toContain("ELSE 'completed'");
  });

  it("the terminal write is wrapped in the reconcile-mutation guard, matching the finalize_claimed_import_row_failure pattern", () => {
    const onIdx = reconcileFn.indexOf("set_config('app.import_batch_reconcile_mutation', 'on', true)");
    const updateIdx = reconcileFn.indexOf("UPDATE public.import_batches SET");
    const offIdx = reconcileFn.indexOf("set_config('app.import_batch_reconcile_mutation', 'off', true)");
    expect(onIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(onIdx);
    expect(offIdx).toBeGreaterThan(updateIdx);
  });

  it("the write updates every stored count column plus status and completed_at from the authoritative progress", () => {
    const update = slice(reconcileFn, "UPDATE public.import_batches SET", "WHERE id = v_batch.id;");
    expect(update).toContain("processed_rows = (v_progress->>'terminal_count')::integer");
    expect(update).toContain("created_rows = (v_progress->>'created_count')::integer");
    expect(update).toContain("matched_rows = (v_progress->>'matched_count')::integer");
    expect(update).toContain("flagged_rows = (v_progress->>'flagged_count')::integer");
    expect(update).toContain("failed_rows = (v_progress->>'failed_count')::integer");
    expect(update).toContain("status = v_final_status");
  });

  it("completed_at is set once and preserved on every later call — repeated reconciliation is idempotent", () => {
    expect(reconcileFn).toContain("completed_at = COALESCE(v_batch.completed_at, clock_timestamp())");
  });

  it("returns reconciled:true only alongside the terminal write, and reconciled:false for every refusal branch", () => {
    expect(reconcileFn).toContain("'reconciled', true");
    const falseCount = (reconcileFn.match(/'reconciled', false/g) ?? []).length;
    expect(falseCount).toBe(3); // not-reconcilable, staging-incomplete, rows-incomplete
  });
});

describe("protect_import_batch_final_state — direct client mutation is blocked", () => {
  it("guards all five stored count columns, completed_at, and entry into a terminal status", () => {
    expect(triggerFn).toContain("NEW.processed_rows IS DISTINCT FROM OLD.processed_rows");
    expect(triggerFn).toContain("NEW.created_rows IS DISTINCT FROM OLD.created_rows");
    expect(triggerFn).toContain("NEW.matched_rows IS DISTINCT FROM OLD.matched_rows");
    expect(triggerFn).toContain("NEW.flagged_rows IS DISTINCT FROM OLD.flagged_rows");
    expect(triggerFn).toContain("NEW.failed_rows IS DISTINCT FROM OLD.failed_rows");
    expect(triggerFn).toContain("NEW.completed_at IS DISTINCT FROM OLD.completed_at");
    expect(triggerFn).toContain("NEW.status IN ('completed', 'needs_attention')");
    expect(triggerFn).toContain("IMPORT_BATCH_RECONCILE_REQUIRED");
    expect(triggerFn).toContain("current_setting('app.import_batch_reconcile_mutation', true)");
  });

  it("is attached as a BEFORE UPDATE trigger on import_batches, alongside the existing lease guard untouched", () => {
    expect(sql).toContain("CREATE TRIGGER protect_import_batch_final_state");
    expect(sql).toContain("BEFORE UPDATE ON public.import_batches");
    expect(sql).not.toContain("protect_import_batch_lease_metadata()"); // that trigger/function isn't redefined here
  });
});

describe("client cutover — no more direct import_batches writes for status/counts", () => {
  it("no longer writes import_batches directly anywhere in the file", () => {
    expect(importer).not.toMatch(/from\("import_batches"\)\s*\n?\s*\.update\(/);
  });

  it("the main run reads authoritative progress and, when clean, calls reconcile_import_batch", () => {
    expect(importer).toContain('supabase.rpc as any)("import_batch_progress"');
    expect(importer).toContain('supabase.rpc as any)("reconcile_import_batch"');
  });

  it("finalizeBatchAfterRetries reconciles authoritatively instead of assuming completed", () => {
    const fn = slice(importer, "async function finalizeBatchAfterRetries", "async function retryOneFailedRow");
    expect(fn).toContain('"reconcile_import_batch"');
    expect(fn).not.toContain('status: "completed"');
    expect(fn).toContain("if (!reconcileResult.reconciled)");
    // it must not release the lease or reset when reconciliation says the batch isn't done
    const notReconciledBranch = slice(fn, "if (!reconcileResult.reconciled) {", "}");
    expect(notReconciledBranch).not.toContain("release_import_batch");
    expect(notReconciledBranch).not.toContain("reset()");
  });

  it("a success toast fires only for an authoritatively completed batch, not just an empty retry panel", () => {
    const fn = slice(importer, "async function finalizeBatchAfterRetries", "async function retryOneFailedRow");
    const completedBranch = slice(fn, 'reconcileResult.status === "completed"', "} else {");
    expect(completedBranch).toContain('toast.success("All rows saved.")');
    const attentionBranch = slice(fn, "} else {", "}\n  }");
    expect(attentionBranch).toContain("toast.warning");
    expect(attentionBranch).toContain("needs attention");
  });

  it("the retry action's own RPC sequence is unchanged by I6", () => {
    const retryFn = slice(importer, "async function retryOneFailedRow", "async function ");
    expect(retryFn).toContain("retryFailedImportRow(");
    const claimIdx = retryFn.indexOf('"claim_import_rows"');
    const executeIdx = retryFn.indexOf('"execute_claimed_import_row"');
    expect(retryFn.indexOf("retryFailedImportRow(")).toBeLessThan(claimIdx);
    expect(claimIdx).toBeLessThan(executeIdx);
  });
});
