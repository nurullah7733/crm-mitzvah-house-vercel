import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const { recordImportRowFailureAndRethrow } = await import("@/lib/import-row-failure");
const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825000200_record_import_row_failure.sql",
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

describe("separate import-row failure outcome", () => {
  it("is not called inside resolve_import_row", () => {
    expect(rowTransaction).not.toContain("record_import_row_failure");
    expect(sql).toContain("CREATE FUNCTION public.record_import_row_failure(");
  });

  it("writes only a failed import_row_outcomes record", () => {
    expect(sql).toContain("INSERT INTO public.import_row_outcomes");
    expect(sql).toContain("outcome = 'failed'");
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(people|households|contact_methods|donations|registrations|interactions)/,
    );
  });

  it("retains batch, row number, row data, and a useful message", () => {
    expect(sql).toContain("batch_id,\n    row_number,\n    row_data");
    expect(sql).toContain("COALESCE(_row_data, '{}'::jsonb)");
    expect(sql).toContain("COALESCE(NULLIF(btrim(_message), ''), 'Import row failed')");
    expect(sql).toContain("ON CONFLICT (batch_id, row_number) DO UPDATE");
  });

  it("cannot overwrite a successful or reviewer-routed final outcome", () => {
    expect(sql).toContain(
      "WHERE public.import_row_outcomes.outcome IN ('processing', 'failed')",
    );
    expect(sql).toContain("RAISE EXCEPTION 'Import row already has final outcome: %'");
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
    rpc.mockResolvedValueOnce({ data: "outcome-1", error: null });
    await expect(
      recordImportRowFailureAndRethrow(
        { batchId: "batch-1", rowNumber: 4, rowData: { first_name: "Leah" }, message: original.message },
        original,
      ),
    ).rejects.toBe(original);
    expect(rpc).toHaveBeenCalledWith("record_import_row_failure", {
      _batch_id: "batch-1",
      _row_number: 4,
      _row_data: { first_name: "Leah" },
      _message: original.message,
    });
  });

  it("still rethrows the original error when failure logging fails", async () => {
    const original = new Error("donation insert failed");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "logging unavailable" } });
    await expect(
      recordImportRowFailureAndRethrow(
        { batchId: "batch-1", rowNumber: 2, rowData: {}, message: original.message },
        original,
      ),
    ).rejects.toBe(original);
    expect(console.error).toHaveBeenCalled();
  });

  it("activates the separate helper without embedding its RPC in the importer", () => {
    expect(importer).toContain("recordImportRowFailureAndRethrow");
    expect(importer).not.toContain('rpc("record_import_row_failure"');
  });
});
