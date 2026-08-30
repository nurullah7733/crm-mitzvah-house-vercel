import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const { recordImportRowFailureAndRethrow } = await import("@/lib/import-row-failure");
const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830000900_atomic_claimed_row_execution.sql",
    import.meta.url,
  ),
  "utf8",
);
const rowTransaction = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825000100_resolve_import_row_activity.sql",
    import.meta.url,
  ),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("claim-bound import-row failure outcome", () => {
  it("is not called inside resolve_import_row", () => {
    expect(rowTransaction).not.toContain("finalize_claimed_import_row_failure");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure(");
  });

  it("writes only a failed import_row_outcomes record", () => {
    expect(sql).toContain("UPDATE public.import_row_outcomes SET outcome = 'failed'");
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(people|households|contact_methods|donations|registrations|interactions)/,
    );
  });

  it("retains the durable claim identity and a useful message", () => {
    expect(sql).toContain(
      "id = _outcome_id AND batch_id = _batch_id AND staged_row_id = _staged_row_id",
    );
    expect(sql).toContain("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    expect(sql).toMatch(/COALESCE\(NULLIF\(btrim\(_message\),\s*''\),\s*'Import row failed'\)/);
  });

  it("cannot overwrite a successful or reviewer-routed final outcome", () => {
    expect(sql).toContain("v_outcome.outcome IN ('created','matched','flagged','failed')");
    expect(sql).toContain("'already_finalized',true");
    expect(sql).toContain("person_id = NULL");
    expect(sql).toContain("review_queue_id = NULL");
  });

  it("explicitly requires an authenticated staff role", () => {
    expect(sql).toContain("auth.uid() IS NULL");
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
    expect(sql).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(sql).toContain("public.has_role(auth.uid(), 'va')");
    expect(sql).toContain("FROM PUBLIC, anon;");
    expect(sql).toContain("TO authenticated, service_role;");
  });

  it("records separately and always preserves the original error", async () => {
    const original = { message: "child 3 insert failed" };
    rpc.mockResolvedValueOnce({ data: { outcome: "failed" }, error: null });
    await expect(
      recordImportRowFailureAndRethrow(
        {
          batchId: "batch-1",
          outcomeId: "outcome-1",
          stagedRowId: "staged-1",
          claimToken: "token-1",
          claimedBy: "worker-1",
          message: original.message,
        },
        original,
      ),
    ).rejects.toBe(original);
    expect(rpc).toHaveBeenCalledWith("finalize_claimed_import_row_failure", {
      _batch_id: "batch-1",
      _outcome_id: "outcome-1",
      _staged_row_id: "staged-1",
      _claim_token: "token-1",
      _claimed_by: "worker-1",
      _message: original.message,
    });
  });

  it("still rethrows the original error when failure logging fails", async () => {
    const original = new Error("donation insert failed");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "logging unavailable" } });
    await expect(
      recordImportRowFailureAndRethrow(
        {
          batchId: "batch-1",
          outcomeId: "outcome-2",
          stagedRowId: "staged-2",
          claimToken: "token-2",
          claimedBy: "worker-2",
          message: original.message,
        },
        original,
      ),
    ).rejects.toBe(original);
    expect(console.error).toHaveBeenCalled();
  });

  it("activates the separate helper without embedding its RPC in the importer", () => {
    expect(importer).toContain("recordImportRowFailureAndRethrow");
    expect(importer).not.toContain('rpc("finalize_claimed_import_row_failure"');
  });
});
