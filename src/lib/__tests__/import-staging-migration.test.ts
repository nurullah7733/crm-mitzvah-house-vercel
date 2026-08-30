import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../supabase/migrations/20260827000100_import_source_staging.sql", import.meta.url),
  "utf8",
);

describe("M2-B import source staging migration", () => {
  it("adds both raw-file and normalized-source identities without rewriting batches", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS raw_file_hash text");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS source_data_hash text");
    expect(sql).not.toMatch(/UPDATE\s+public\.import_batches/i);
  });

  it("stores physical provenance, raw cells, source columns, mapping, and canonical values", () => {
    for (const column of [
      "physical_row_number", "raw_cells", "source_columns", "mapping", "normalized_values",
    ]) expect(sql).toContain(column);
  });

  it("protects source cells and mapping from later mutation", () => {
    expect(sql).toContain("CREATE FUNCTION public.protect_import_staged_source");
    expect(sql).toContain("NEW.raw_cells IS DISTINCT FROM OLD.raw_cells");
    expect(sql).toContain("NEW.mapping IS DISTINCT FROM OLD.mapping");
    expect(sql).toContain("Staged import source data is immutable");
  });

  it("enables RLS and limits policies to active staff roles", () => {
    expect(sql).toContain("ALTER TABLE public.import_staged_rows ENABLE ROW LEVEL SECURITY");
    for (const role of ["admin", "marketing", "va"])
      expect(sql).toContain(`public.has_role(auth.uid(), '${role}')`);
    expect(sql).not.toMatch(/TO anon/);
  });
});
