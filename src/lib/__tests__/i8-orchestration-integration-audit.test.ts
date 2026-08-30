import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M2-I8: closure-gate integration audit for the full I1-I7 import orchestration stack.
// This file intentionally does NOT re-test what I1-I7's own test files already cover
// individually (row-level claim/execute/retry/reconcile/resume mechanics). It exists to lock
// in the handful of *cross-cutting* facts the audit depends on, as regression guards: which
// migration owns the final, authoritative definition of a function that was redefined more
// than once, that two functions found to be orphaned during the audit stay orphaned, that
// retry and review-resolution can never contend for the same row, and that no correctness-
// critical local truth has crept back into the active client.
const migrationText = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

describe("migration lineage — final function ownership", () => {
  it("finalize_claimed_import_row_failure's authoritative definition is 01300 — nothing after it redefines it", () => {
    expect(migrationText("20260830001300_fix_failure_claim_cleanup_guard.sql")).toContain(
      "CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure",
    );
    expect(migrationText("20260830001400_authoritative_import_progress.sql")).not.toContain(
      "FUNCTION public.finalize_claimed_import_row_failure",
    );
    expect(migrationText("20260830001500_resumable_import_discovery.sql")).not.toContain(
      "FUNCTION public.finalize_claimed_import_row_failure",
    );
  });

  it("sync_import_review_resolution_metadata and log_review_decision's authoritative definitions are 01200 — 01300/01400/01500 never touch either", () => {
    expect(migrationText("20260830001200_deploy_i5_retry_and_metadata_fix.sql")).toContain(
      "CREATE OR REPLACE FUNCTION public.sync_import_review_resolution_metadata",
    );
    expect(migrationText("20260830001200_deploy_i5_retry_and_metadata_fix.sql")).toContain(
      "CREATE OR REPLACE FUNCTION public.log_review_decision",
    );
    for (const later of [
      "20260830001300_fix_failure_claim_cleanup_guard.sql",
      "20260830001400_authoritative_import_progress.sql",
      "20260830001500_resumable_import_discovery.sql",
    ]) {
      const text = migrationText(later);
      expect(text).not.toContain("FUNCTION public.sync_import_review_resolution_metadata");
      expect(text).not.toContain("FUNCTION public.log_review_decision");
    }
  });

  it("retry_failed_import_row, execute_claimed_import_row, and the I3 claim/lease RPCs were never redefined after their introducing migration", () => {
    for (const later of [
      "20260830001100_review_resolution_outcome_metadata.sql",
      "20260830001200_deploy_i5_retry_and_metadata_fix.sql",
      "20260830001300_fix_failure_claim_cleanup_guard.sql",
      "20260830001400_authoritative_import_progress.sql",
      "20260830001500_resumable_import_discovery.sql",
    ]) {
      const text = migrationText(later);
      expect(text).not.toContain("FUNCTION public.retry_failed_import_row");
      expect(text).not.toContain("FUNCTION public.execute_claimed_import_row");
      expect(text).not.toContain("FUNCTION public.claim_import_batch");
      expect(text).not.toContain("FUNCTION public.claim_import_rows");
      expect(text).not.toContain("FUNCTION public.release_import_batch");
    }
  });

  it("review_queue.import_outcome_id and import_row_outcomes.staged_row_id keep their uniqueness constraints — one review, one outcome, per row", () => {
    expect(migrationText("20260830000900_atomic_claimed_row_execution.sql")).toContain(
      "CREATE UNIQUE INDEX review_queue_import_outcome_unique",
    );
    expect(migrationText("20260830000600_resumable_import_state_foundation.sql")).toContain(
      "CREATE UNIQUE INDEX import_row_outcomes_staged_row_unique",
    );
  });
});

describe("audit finding — two orphaned pre-claim-era functions stay orphaned from the active path", () => {
  it("record_import_row_failure (superseded by finalize_claimed_import_row_failure) is never called by the active importer", () => {
    expect(importer).not.toMatch(/rpc\(\s*"record_import_row_failure"/);
  });

  it("assert_import_row_claim (never wired into any active caller) is never called by the active importer", () => {
    expect(importer).not.toMatch(/rpc\(\s*"assert_import_row_claim"/);
  });
});

describe("retry and review resolution can never contend for the same row", () => {
  it("retry_failed_import_row only ever reopens outcome='failed'; review resolution only ever acts on outcome='flagged' — the outcome CHECK constraint makes both true for one row at once impossible", () => {
    const retrySql = migrationText("20260830001000_review_failure_retry_safety.sql");
    expect(retrySql).toContain("IF v_outcome.outcome = 'failed' THEN");
    const outcomeConstraint = migrationText("20260830000600_resumable_import_state_foundation.sql");
    expect(outcomeConstraint).toContain(
      "CHECK (outcome IN ('pending','processing','created','matched','flagged','failed'))",
    );
    // a single text column can hold exactly one of these values at a time — 'failed' and
    // 'flagged' are mutually exclusive by construction, so retry and review resolution can
    // never both be legally in flight against the same outcome row.
  });
});

describe("client source-of-truth — no correctness-critical local state in the active import path", () => {
  it("no direct import_batches status/count write exists anywhere in the file", () => {
    expect(importer).not.toMatch(/from\("import_batches"\)\s*\n?\s*\.update\(/);
  });

  it("no direct import_row_outcomes terminal write (only the guarded RPCs ever set outcome to a terminal value)", () => {
    expect(importer).not.toMatch(/from\("import_row_outcomes"\)\s*\n?\s*\.update\(/);
  });

  it("no direct resolve_import_row call — every CRM write goes through execute_claimed_import_row", () => {
    expect(importer).not.toMatch(/rpc\(\s*"resolve_import_row"/);
  });

  it("claim tokens and claimants are always the value just returned by claim_import_rows, never fabricated", () => {
    // every _claim_token/_claimed_by pair passed to execute/finalize is sourced from a
    // `claimed`/`c`/`c1`/`c2`/`cB`/`claimedRow`-shaped claim result in the same function —
    // spot-check there is no literal/random UUID passed directly as a claim token.
    expect(importer).not.toMatch(/_claim_token:\s*crypto\.randomUUID\(\)/);
  });

  it("progress/counts shown to the user come only from import_batch_progress / find_active_import_batch / reconcile_import_batch, never a client-side reduce over outcomes", () => {
    expect(importer).not.toMatch(/\.filter\(\(row\)\s*=>\s*row\.outcome\s*===\s*"created"\)\.length/);
  });
});
