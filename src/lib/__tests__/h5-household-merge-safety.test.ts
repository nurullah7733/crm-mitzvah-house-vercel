import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260830000500_harden_standalone_household_merge.sql",
  "utf8",
);
const dialog = readFileSync("src/components/MergeHouseholdsDialog.tsx", "utf8");
const h3Migration = readFileSync(
  "supabase/migrations/20260830000300_merge_person_stale_write_safety.sql",
  "utf8",
);

describe("H5 standalone household merge safety", () => {
  it("uses an immutable dialog-load snapshot for both households and their members", () => {
    expect(dialog).toContain("setSnapshot({");
    expect(dialog).toContain("_expected_surviving_household");
    expect(dialog).toContain("_expected_merged_household");
    expect(dialog).toContain("_expected_surviving_members");
    expect(dialog).toContain("_expected_merged_members");
    expect(dialog).not.toContain('select("id, household_id")');
  });

  it("locks and validates both current household snapshots before writes", () => {
    expect(migration).toContain("ORDER BY id\n  FOR UPDATE");
    expect(migration).toContain("v_surviving_snapshot IS DISTINCT FROM _expected_surviving_household");
    expect(migration).toContain("v_merged_snapshot IS DISTINCT FROM _expected_merged_household");
    expect(migration.indexOf("MERGE_STALE_HOUSEHOLD")).toBeLessThan(
      migration.indexOf("UPDATE public.people SET household_id"),
    );
  });

  it("rejects changed membership before any field, member, delete, or audit write", () => {
    const guard = migration.indexOf("v_current_members IS DISTINCT FROM v_expected_members");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(migration.indexOf("UPDATE public.households SET %I"));
    expect(guard).toBeLessThan(migration.indexOf("UPDATE public.people SET household_id"));
    expect(guard).toBeLessThan(migration.indexOf("DELETE FROM public.households"));
    expect(guard).toBeLessThan(migration.indexOf("INSERT INTO public.audit_log"));
    expect(migration).toContain("MERGE_STALE_HOUSEHOLD_MEMBERSHIP");
  });

  it("keeps selected-field, member movement, deletion, and audit in one function transaction", () => {
    expect(migration).toContain("jsonb_object_keys(COALESCE(_field_values");
    expect(migration).toContain("UPDATE public.people SET household_id = _surviving_id");
    expect(migration).toContain("DELETE FROM public.households WHERE id = _merged_id");
    expect(migration).toContain("'households', _surviving_id, 'merge'");
  });

  it("requires a staff role and removes client access to the unsafe legacy overload", () => {
    expect(migration).toContain("public.has_role(auth.uid(), 'admin')");
    expect(migration).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(migration).toContain("public.has_role(auth.uid(), 'va')");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.merge_households(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role",
    );
  });

  it("preserves the H3 atomic person and household merge's internal legacy call", () => {
    expect(h3Migration).toContain("PERFORM public.merge_households(");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.merge_people_with_households");
  });
});
