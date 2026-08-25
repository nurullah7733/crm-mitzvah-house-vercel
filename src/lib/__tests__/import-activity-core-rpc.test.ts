import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000400_extract_import_activity_core.sql",
    import.meta.url,
  ),
  "utf8",
);

const helperStart = sql.indexOf("CREATE FUNCTION public.apply_import_activity_core");
const reviewStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.resolve_review_merge_core");
const helper = sql.slice(helperStart, reviewStart);
const reviewCore = sql.slice(reviewStart);

describe("shared transactional import activity core", () => {
  it("is called by the review merge core", () => {
    expect(reviewCore).toContain("v_activity := public.apply_import_activity_core(");
    expect(reviewCore).toContain("jsonb_build_array(_event)");
    expect(reviewCore).toContain(") || v_activity");
  });

  it("owns registration, donation, and note writes without duplicating them in review core", () => {
    expect(helper).toContain("INSERT INTO public.registrations");
    expect(helper).toContain("INSERT INTO public.donations");
    expect(helper).toContain("INSERT INTO public.interactions");
    expect(reviewCore).not.toContain("INSERT INTO public.registrations");
    expect(reviewCore).not.toContain("INSERT INTO public.donations");
    expect(reviewCore).not.toContain("INSERT INTO public.interactions");
  });

  it("preserves fingerprint and fallback deduplication with partial-index conflict handling", () => {
    expect(helper).toContain("import_fingerprint = _donation->>'import_fingerprint'");
    expect(helper).toContain("person_id = _person_id");
    expect(helper).toContain("campaign_id IS NOT DISTINCT FROM");
    expect(helper).toContain("ON CONFLICT (import_fingerprint)");
    expect(helper).toContain("WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL");
    expect(helper).toContain("RAISE EXCEPTION 'Donation insert failed without a resolvable duplicate'");
  });

  it("supports resolved registration arrays and donation event attribution", () => {
    expect(helper).toContain("jsonb_array_elements(COALESCE(_registrations, '[]'::jsonb))");
    expect(helper).toContain("NULLIF(_donation->>'event_id', '')::uuid");
  });

  it("cannot be executed directly by authenticated clients", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.apply_import_activity_core(uuid, jsonb, jsonb, jsonb, uuid)\n  FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_import_activity_core\([^;]+\)\s+TO authenticated/,
    );
  });
});
