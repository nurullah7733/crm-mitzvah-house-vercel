import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825000100_resolve_import_row_activity.sql",
    import.meta.url,
  ),
  "utf8",
);
const activityCore = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000400_extract_import_activity_core.sql",
    import.meta.url,
  ),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

describe("resolve_import_row activity composition", () => {
  it("calls the shared activity core after the transactional foundation", () => {
    const foundationCall = sql.indexOf(
      "v_foundation := public.resolve_import_row_foundation_core(",
    );
    const activityCall = sql.indexOf("v_activity := public.apply_import_activity_core(");
    const successReturn = sql.indexOf("RETURN v_foundation || v_activity");
    expect(foundationCall).toBeGreaterThan(-1);
    expect(foundationCall).toBeLessThan(activityCall);
    expect(activityCall).toBeLessThan(successReturn);
  });

  it("passes the full resolved registration array, donation, and note", () => {
    expect(sql).toContain("COALESCE(_activity->'registrations', '[]'::jsonb)");
    expect(sql).toContain("NULLIF(_activity->'donation', 'null'::jsonb)");
    expect(sql).toContain("NULLIF(_activity->'note', 'null'::jsonb)");
    expect(sql).not.toContain("jsonb_build_array(_activity->'registrations')");
  });

  it("does not duplicate registration, donation, or note implementation", () => {
    expect(sql).not.toContain("INSERT INTO public.registrations");
    expect(sql).not.toContain("INSERT INTO public.donations");
    expect(sql).not.toContain("INSERT INTO public.interactions");
    expect(sql).not.toContain("ON CONFLICT (import_fingerprint)");
  });

  it("returns foundation and activity result fields together", () => {
    expect(sql).toContain("RETURN v_foundation || v_activity");
    expect(activityCore).toContain("'registrations', v_registration_results");
    expect(activityCore).toContain("'donation_id'");
    expect(activityCore).toContain("'note_id'");
  });

  it("retains shared fingerprint idempotency and required donation failure", () => {
    expect(activityCore).toContain("ON CONFLICT (import_fingerprint)");
    expect(activityCore).toContain("WHERE import_fingerprint IS NOT NULL AND deleted_at IS NULL");
    expect(activityCore).toContain(
      "RAISE EXCEPTION 'Donation insert failed without a resolvable duplicate'",
    );
  });

  it("has no activity exception swallowing or failure recorder", () => {
    const rpc = sql.slice(sql.indexOf("CREATE FUNCTION public.resolve_import_row("));
    expect(rpc).not.toContain("EXCEPTION WHEN OTHERS");
    expect(sql).not.toContain("import_row_outcomes");
    expect(sql).not.toContain("review_queue");
  });

  it("is now called by the normal importer cutover", () => {
    expect(importer).toMatch(/\.rpc\(\s*"execute_claimed_import_row"/);
  });

  it("locks the renamed foundation away from authenticated clients", () => {
    expect(sql).toContain(") FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_import_row_foundation_core\([^;]+\) TO authenticated/,
    );
  });
});
