import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LIVE re-verification of the 20260830001100/001200 fix found that its deployed
// finalize_claimed_import_row_failure could never actually reach `failed`:
// protect_import_claim_metadata (20260830000800) rejects any UPDATE touching
// claim_token/claimed_by/claimed_at/lease_expires_at unless
// current_setting('app.import_claim_mutation', true) = 'on', and the deployed function
// never set that flag. 20260830001300 fixes this — these tests pin the fix so it can't
// silently regress again.
const fixSql = readFileSync(
  new URL("../../../supabase/migrations/20260830001300_fix_failure_claim_cleanup_guard.sql", import.meta.url),
  "utf8",
);
const triggerSql = readFileSync(
  new URL("../../../supabase/migrations/20260830000800_import_batch_and_row_claims.sql", import.meta.url),
  "utf8",
);
const retrySql = readFileSync(
  new URL("../../../supabase/migrations/20260830001000_review_failure_retry_safety.sql", import.meta.url),
  "utf8",
);

const fn = fixSql.slice(
  fixSql.indexOf("CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure"),
);

describe("finalize_claimed_import_row_failure — claim-cleanup guard fix", () => {
  it("wraps exactly the terminal UPDATE in the same on/off pattern claim_import_rows uses", () => {
    const onCount = (fn.match(/set_config\('app\.import_claim_mutation','on',true\)/g) ?? []).length;
    const offCount = (fn.match(/set_config\('app\.import_claim_mutation','off',true\)/g) ?? []).length;
    expect(onCount).toBe(1);
    expect(offCount).toBe(1);
    const onStmt = "PERFORM set_config('app.import_claim_mutation','on',true);";
    const offStmt = "PERFORM set_config('app.import_claim_mutation','off',true);";
    const onIdx = fn.indexOf(onStmt);
    const updateIdx = fn.indexOf("UPDATE public.import_row_outcomes SET");
    const offIdx = fn.indexOf(offStmt);
    expect(onIdx).toBeGreaterThan(-1);
    expect(offIdx).toBeGreaterThan(-1);
    // on -> UPDATE -> off, with nothing else in between (the override covers only this write).
    expect(onIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(offIdx);
    const betweenOnAndUpdate = fn.slice(onIdx + onStmt.length, updateIdx).trim();
    expect(betweenOnAndUpdate).toBe("");
    const betweenUpdateAndOff = fn.slice(fn.indexOf("WHERE id = v_outcome.id;") + "WHERE id = v_outcome.id;".length, offIdx).trim();
    expect(betweenUpdateAndOff).toBe("");
  });

  it("every validation still runs before the flag is ever turned on — stale worker still rejected first", () => {
    const onIdx = fn.indexOf("set_config('app.import_claim_mutation','on',true)");
    const staffCheckIdx = fn.indexOf("IMPORT_STAFF_REQUIRED");
    const alreadyFinalizedIdx = fn.indexOf("'already_finalized',true");
    const staleWorkerGuardIdx = fn.indexOf("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    const wrongClaimantGuardIdx = fn.indexOf("v_outcome.claimed_by IS DISTINCT FROM _claimed_by");
    expect(staffCheckIdx).toBeLessThan(onIdx);
    expect(alreadyFinalizedIdx).toBeLessThan(onIdx);
    expect(staleWorkerGuardIdx).toBeLessThan(onIdx);
    expect(wrongClaimantGuardIdx).toBeLessThan(onIdx);
    // The full stale-worker/lease/token guard block is untouched from the pre-fix version.
    expect(fn).toContain("v_batch.status <> 'processing' OR v_batch.lease_owner IS DISTINCT FROM _claimed_by");
    expect(fn).toContain("v_outcome.lease_expires_at IS NULL OR v_outcome.lease_expires_at <= clock_timestamp()");
    expect(fn).toContain("IMPORT_ROW_CLAIM_LOST");
  });

  it("the UPDATE clears all four protected claim fields and preserves everything else", () => {
    const update = fn.slice(fn.indexOf("UPDATE public.import_row_outcomes SET"), fn.indexOf("WHERE id = v_outcome.id;"));
    expect(update).toContain("outcome = 'failed'");
    expect(update).toContain("claim_token = NULL");
    expect(update).toContain("claimed_by = NULL");
    expect(update).toContain("claimed_at = NULL");
    expect(update).toContain("lease_expires_at = NULL");
    expect(update).not.toContain("attempt_count");
    expect(update).toContain("completed_at = clock_timestamp()");
    expect(update).toContain("last_error = v_message");
    expect(update).toContain("result = v_result");
  });

  it("no exception handler wraps the update — a failed UPDATE rolls the whole call back, no partial commit", () => {
    expect(fn).not.toContain("EXCEPTION WHEN");
    // Exactly one BEGIN: the function's own top-level block. No nested BEGIN/EXCEPTION
    // sub-block was introduced around the UPDATE that could swallow a failure.
    expect((fn.match(/\bBEGIN\b/g) ?? []).length).toBe(1);
  });

  it("still returns the same already_finalized replay shape untouched", () => {
    expect(fn).toContain("'already_finalized',true,'outcome',v_outcome.outcome");
    expect(fn).toContain("'already_finalized',false,'outcome','failed'");
  });

  it("protect_import_claim_metadata itself is untouched — ordinary client updates to these columns are still blocked", () => {
    expect(triggerSql).toContain("CREATE OR REPLACE FUNCTION public.protect_import_claim_metadata()");
    expect(triggerSql).toContain("NEW.claim_token IS DISTINCT FROM OLD.claim_token");
    expect(triggerSql).toContain("NEW.claimed_by IS DISTINCT FROM OLD.claimed_by");
    expect(triggerSql).toContain("NEW.claimed_at IS DISTINCT FROM OLD.claimed_at");
    expect(triggerSql).toContain("NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at");
    expect(triggerSql).toContain("IMPORT_CLAIM_TOKEN_REQUIRED");
    expect(triggerSql).toContain("COALESCE(current_setting('app.import_claim_mutation',true),'') <> 'on'");
    // 20260830001300 never drops or redefines this trigger/function — it only calls the
    // session flag that trigger already checks for.
    expect(fixSql).not.toContain("DROP TRIGGER");
    expect(fixSql).not.toContain("CREATE OR REPLACE FUNCTION public.protect_import_claim_metadata");
  });

  it("the four fields this now clears are exactly what retry_failed_import_row's own guard requires to be null", () => {
    const guard = retrySql.slice(
      retrySql.indexOf("IF v_outcome.claim_token IS NOT NULL"),
      retrySql.indexOf("IMPORT_ROW_STATE_CHANGED", retrySql.indexOf("IF v_outcome.claim_token IS NOT NULL")),
    );
    expect(guard).toContain("v_outcome.claim_token IS NOT NULL");
    expect(guard).toContain("v_outcome.claimed_by IS NOT NULL");
    expect(guard).toContain("v_outcome.lease_expires_at IS NOT NULL");
    // With the guard now correctly clearing all three (plus claimed_at), a real
    // claim -> finalize_claimed_import_row_failure -> retry_failed_import_row cycle can
    // actually reach `pending` — this is the exact contract this fix restores.
  });
});
