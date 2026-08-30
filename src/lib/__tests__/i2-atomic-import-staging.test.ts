import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260830000700_atomic_import_begin_and_staging.sql",
  "utf8",
);
const route = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");

describe("M2-I2 atomic begin/resume and staging", () => {
  it("creates or resumes one active batch under a durable lock and unique invariant", () => {
    expect(sql).toContain("begin_or_resume_import_batch");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(v_identity, 0))");
    expect(sql).toContain("import_batches_active_resumable_identity_unique");
    expect(sql).toContain("status IN ('staging','ready','processing','needs_attention')");
    expect(sql).toContain("'created',v_created,'resumed',NOT v_created");
  });

  it("does not use filename alone and excludes completed/reverted history", () => {
    expect(sql).toContain("_raw_file_hash");
    expect(sql).toContain("_source_data_hash");
    expect(sql).toContain("_selected_sheet_index");
    expect(sql).not.toContain("lower(btrim(_filename))");
    expect(sql).not.toContain(
      "status IN ('staging','ready','processing','needs_attention','completed'",
    );
  });

  it("rejects incompatible resume context with a stable error", () => {
    expect(sql).toContain("IMPORT_RESUME_CONTEXT_CONFLICT");
    expect(sql).toContain("v_batch.orchestration_context IS DISTINCT FROM");
    expect(sql).toContain("v_batch.mapping IS DISTINCT FROM");
    expect(sql).toContain("v_batch.orchestration_context - 'effective_date'");
    expect(sql).toContain("'orchestration_context',v_batch.orchestration_context");
  });

  it("stages identical source rows idempotently and rejects changed evidence", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.stage_import_rows");
    expect(sql).toContain("IMPORT_STAGING_CONFLICT");
    for (const field of ["raw_cells", "source_columns", "mapping", "normalized_values"])
      expect(sql).toContain(`v_existing.${field} IS DISTINCT FROM`);
    expect(sql).toContain("v_reused := v_reused + 1");
  });

  it("initializes exactly one pending outcome for every staged row", () => {
    expect(sql).toContain("INSERT INTO public.import_row_outcomes");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("VALUES (_batch_id,v_row_number,v_staged_id");
    expect(sql).toContain("IMPORT_STAGING_OUTCOME_CONFLICT");
  });

  it("keeps partial staging in staging and rejects premature finalization", () => {
    expect(sql).toContain("IMPORT_STAGING_INCOMPLETE");
    expect(sql).toContain("v_staged <> v_batch.total_rows");
    expect(sql).toContain("v_pending <> v_batch.total_rows");
  });

  it("finalizes exact complete staging to ready and is idempotent while ready", () => {
    expect(sql).toContain("v_batch.status NOT IN ('staging','ready')");
    expect(sql).toContain("IF v_batch.status = 'staging'");
    expect(sql).toContain("SET status = 'ready'");
    expect(sql).toContain("'status','ready'");
  });

  it("restricts all I2 RPCs to existing staff roles", () => {
    for (const role of ["'admin'", "'marketing'", "'va'"]) expect(sql).toContain(role);
    expect(sql.match(/IMPORT_STAFF_REQUIRED/g)?.length).toBe(3);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.begin_or_resume_import_batch");
    expect(sql).toContain('DROP POLICY IF EXISTS "Staff full access" ON public.import_batches');
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Authenticated staff can create import row outcomes"',
    );
  });

  it("wires the active browser path through begin, idempotent staging, and finalize", () => {
    expect(route).toContain('supabase.rpc(\n        "begin_or_resume_import_batch"');
    expect(route).toContain('supabase.rpc("stage_import_rows"');
    expect(route).toMatch(/supabase\.rpc\(\s*"finalize_import_staging"/);
    expect(route).not.toContain('.from("import_staged_rows")\n          .insert');
    expect(route.match(/\.in\("status", \["completed", "imported", "reverted"\]\)/g)?.length).toBe(
      2,
    );
  });

  it("allows only one tab to transition ready into the existing execution loop", () => {
    expect(route).toContain(
      '.update({ status: "processing", started_at: new Date().toISOString() })',
    );
    expect(route).toContain('.eq("status", "ready")');
    expect(route).toContain("This import has already started in another session.");
    expect(route.indexOf('"finalize_import_staging"')).toBeLessThan(
      route.indexOf('.update({ status: "processing", started_at:'),
    );
  });
});
