import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../supabase/migrations/20260829000400_transaction_source_namespace.sql", import.meta.url),
  "utf8",
);

describe("G3 namespaced transaction SQL", () => {
  it("adds nullable namespace columns and a non-donor authoritative index", () => {
    expect(sql).toContain("transaction_source_system text");
    expect(sql).toContain("transaction_object_type text");
    expect(sql).toContain("external_transaction_id_key text");
    const index = sql.slice(sql.indexOf("CREATE UNIQUE INDEX donations_transaction_namespace_unique"));
    expect(index).toContain("transaction_source_system");
    expect(index).toContain("transaction_object_type");
    expect(index).toContain("external_transaction_id_key");
    expect(index.slice(0, index.indexOf("CREATE OR REPLACE FUNCTION public.apply_import_activity_core"))).not.toContain("person_id");
    expect(index.slice(0, index.indexOf("CREATE OR REPLACE FUNCTION public.apply_import_activity_core"))).not.toContain("deleted_at");
  });

  it("normalizes keys in SQL rather than trusting the client", () => {
    expect(sql).toContain("public.normalize_external_transaction_id(NEW.external_transaction_id)");
    expect(sql).toContain("regexp_replace(lower(btrim(_value)), '\\s+', ' ', 'g')");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF transaction_source_system");
  });

  it("validates exact facts and rejects every contradiction dimension", () => {
    for (const fact of ["person_id", "amount", "date", "event_id", "campaign_id"])
      expect(sql).toContain(`v_donation.${fact} IS DISTINCT FROM`);
    expect(sql).toContain("IMPORT_TRANSACTION_CONTRADICTION");
  });

  it("handles exact repeats, concurrency, legacy rows, and soft deletes explicitly", () => {
    expect(sql).toContain("ON CONFLICT DO NOTHING RETURNING * INTO v_donation");
    expect(sql).toContain("IMPORT_TRANSACTION_CONCURRENT_CONFLICT");
    expect(sql).toContain("IMPORT_TRANSACTION_LEGACY_REVIEW");
    expect(sql).toContain("IMPORT_TRANSACTION_SOFT_DELETED");
    expect(sql).toContain("transaction_source_system IS NULL");
  });

  it("preserves the legacy fingerprint path for unknown sources", () => {
    expect(sql).toContain("IF v_namespaced THEN");
    expect(sql).toContain("ON CONFLICT (import_fingerprint) WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL");
  });
});
