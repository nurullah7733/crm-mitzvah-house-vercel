import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260830000900_atomic_claimed_row_execution.sql",
  "utf8",
);
const route = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
const failure = readFileSync("src/lib/import-row-failure.ts", "utf8");

describe("M2-I4 atomic claimed-row execution", () => {
  it("locks batch and outcome before validating and executing a claim", () => {
    const batchLock = sql.indexOf("WHERE id = _batch_id FOR UPDATE");
    const outcomeLock = sql.indexOf(
      "id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id",
    );
    const crm = sql.indexOf("v_crm := public.resolve_import_row(");
    expect(batchLock).toBeGreaterThan(-1);
    expect(outcomeLock).toBeGreaterThan(batchLock);
    expect(crm).toBeGreaterThan(outcomeLock);
    expect(sql).toContain("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    expect(sql).toContain("v_outcome.claimed_by IS DISTINCT FROM _claimed_by");
    expect(sql).toContain("v_batch.lease_owner IS DISTINCT FROM _claimed_by");
    expect(sql).toContain("IMPORT_ROW_CLAIM_LOST");
  });

  it("uses the existing full CRM transaction and atomically finalizes create or match", () => {
    expect(sql).toContain("public.resolve_import_row(");
    expect(sql).toContain("v_terminal NOT IN ('created','matched')");
    expect(sql).toContain("outcome = v_terminal, person_id = (v_crm->>'person_id')::uuid");
    expect(sql).toContain("completed_at = clock_timestamp()");
    expect(sql).not.toMatch(/INSERT INTO public\.(people|donations|registrations|interactions)/);
  });

  it("returns terminal authority before token and lease validation on response-loss replay", () => {
    const terminal = sql.indexOf("v_outcome.outcome IN ('created','matched','flagged','failed')");
    const token = sql.indexOf("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    const crm = sql.indexOf("v_crm := public.resolve_import_row(");
    expect(terminal).toBeGreaterThan(-1);
    expect(terminal).toBeLessThan(token);
    expect(token).toBeLessThan(crm);
    expect(sql).toContain("'already_finalized',true");
  });

  it("binds one review to one outcome and flags both in the same transaction", () => {
    expect(sql).toContain(
      "ADD COLUMN import_outcome_id uuid REFERENCES public.import_row_outcomes(id)",
    );
    expect(sql).toContain("CREATE UNIQUE INDEX review_queue_import_outcome_unique");
    expect(sql).toContain("WHERE import_outcome_id = v_outcome.id FOR UPDATE");
    expect(sql).toContain("status,import_outcome_id");
    expect(sql).toContain("outcome = 'flagged'");
    expect(sql).toContain("review_queue_id = v_review_id");
  });

  it("keeps failure finalization claim-bound and unable to overwrite terminal results", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure");
    expect(
      sql.match(/v_outcome\.outcome IN \('created','matched','flagged','failed'\)/g),
    ).toHaveLength(2);
    expect(sql).toContain("UPDATE public.import_row_outcomes SET outcome = 'failed'");
    expect(failure).toContain('supabase.rpc("finalize_claimed_import_row_failure"');
    expect(failure).not.toContain('supabase.rpc("record_import_row_failure"');
  });

  it("cuts the browser over from split CRM/review/outcome commits", () => {
    expect(route).toContain('supabase.rpc("execute_claimed_import_row"');
    expect(route).not.toContain('supabase.rpc("resolve_import_row"');
    expect(route).not.toContain("async function recordOutcome(");
    expect(route).not.toMatch(/\.from\("review_queue"\)\s*\.insert/);
    expect(route).not.toMatch(/\.from\("import_row_outcomes"\)\s*\.update/);
  });

  it("preserves claim evidence while terminal states remain excluded from reclaim", () => {
    expect(sql).not.toContain("claim_token = NULL");
    expect(sql).not.toContain("attempt_count = 0");
    const i3 = readFileSync(
      "supabase/migrations/20260830000800_import_batch_and_row_claims.sql",
      "utf8",
    );
    expect(i3).toContain("o.outcome = 'pending'");
    expect(i3).toContain("o.outcome = 'processing'");
    expect(i3).not.toMatch(/outcome\s+IN\s*\([^)]*created/i);
  });

  it("applies the active staff contract to both I4 RPCs", () => {
    expect(sql.match(/IMPORT_STAFF_REQUIRED/g)).toHaveLength(2);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.execute_claimed_import_row");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.finalize_claimed_import_row_failure");
    expect(sql.match(/TO authenticated, service_role;/g)).toHaveLength(2);
  });
});
