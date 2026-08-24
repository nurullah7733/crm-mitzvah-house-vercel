import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260823000100_resolve_review_quick_merge.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("resolve_review_quick_merge SQL boundary", () => {
  it("requires a caller with one of the project's staff roles", () => {
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
    expect(sql).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(sql).toContain("public.has_role(auth.uid(), 'va')");
    expect(sql).toContain("RAISE EXCEPTION 'Active staff access required'");
  });

  it("keeps all required writes and finalization in one PostgreSQL function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("UPDATE public.people");
    expect(sql).toContain("INSERT INTO public.registrations");
    expect(sql).toContain("INSERT INTO public.donations");
    expect(sql).toContain("INSERT INTO public.interactions");
    expect(sql).toContain("PERFORM public.log_review_decision");
    expect(sql.indexOf("UPDATE public.people")).toBeLessThan(
      sql.indexOf("PERFORM public.log_review_decision"),
    );
  });

  it("preserves database-backed donation and registration idempotency", () => {
    expect(sql).toContain("ON CONFLICT (import_fingerprint)");
    expect(sql).toContain(
      "WHERE event_id = (_event->>'event_id')::uuid AND person_id = _person_id",
    );
  });

  it("isolates only optional provenance failures", () => {
    const exceptionBlock = sql.slice(sql.indexOf("BEGIN\n      INSERT INTO public.field_sources"));
    expect(exceptionBlock).toContain("EXCEPTION WHEN OTHERS");
    expect(exceptionBlock.indexOf("EXCEPTION WHEN OTHERS")).toBeLessThan(
      exceptionBlock.indexOf("IF _event IS NOT NULL"),
    );
  });
});
