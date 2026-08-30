import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830000300_merge_person_stale_write_safety.sql",
    import.meta.url,
  ),
  "utf8",
);
const dialog = readFileSync(
  new URL("../../components/MergeContactsDialog.tsx", import.meta.url),
  "utf8",
);
const types = readFileSync(
  new URL("../../integrations/supabase/types.ts", import.meta.url),
  "utf8",
);
const errors = readFileSync(new URL("../db-errors.ts", import.meta.url), "utf8");

const functionBody = migration.slice(
  migration.indexOf("CREATE FUNCTION public.merge_people_with_households"),
);

describe("M2-H5 atomic merge stale-person safety", () => {
  it("keeps the normal person and household merge in one transaction after validation", () => {
    expect(functionBody).toContain("PERFORM public.merge_people(");
    expect(functionBody).toContain("PERFORM public.merge_households(");
    expect(functionBody.indexOf("MERGE_STALE_PERSON")).toBeLessThan(
      functionBody.indexOf("PERFORM public.merge_people("),
    );
    expect(functionBody.indexOf("PERFORM public.merge_people(")).toBeLessThan(
      functionBody.indexOf("PERFORM public.merge_households("),
    );
  });

  it("rejects a stale surviving-person field before any merge write", () => {
    expect(functionBody).toContain("v_current := to_jsonb(v_survivor)->v_key");
    expect(functionBody).toContain("'person_id',_surviving_id");
    expect(functionBody).toContain("RAISE EXCEPTION 'MERGE_STALE_PERSON'");
  });

  it("rejects a stale merged-away-person field before any merge write", () => {
    expect(functionBody).toContain("v_current := to_jsonb(v_merged)->v_key");
    expect(functionBody).toContain("'person_id',_merged_id");
    expect(functionBody).toContain("RAISE EXCEPTION 'MERGE_STALE_PERSON'");
  });

  it("locks and validates both complete snapshots before person, household, or audit writes", () => {
    expect(functionBody).toContain(
      "WHERE id IN (_surviving_id, _merged_id) ORDER BY id FOR UPDATE",
    );
    expect(functionBody).toContain("_expected_surviving_person ? v_key");
    expect(functionBody).toContain("_expected_merged_person ? v_key");
    expect(functionBody.indexOf("FOR UPDATE")).toBeLessThan(
      functionBody.indexOf("MERGE_STALE_PERSON"),
    );
    expect(functionBody.indexOf("MERGE_STALE_PERSON")).toBeLessThan(
      functionBody.indexOf("PERFORM public.merge_people("),
    );
  });

  it("sends refreshed snapshots for both contacts on every retry", () => {
    expect(dialog).toContain("function mergePersonSnapshot(person: Person)");
    expect(dialog).toContain("_expected_surviving_person: mergePersonSnapshot(survivor)");
    expect(dialog).toContain("_expected_merged_person: mergePersonSnapshot(loser)");
    expect(types).toContain("_expected_surviving_person: Json");
    expect(types).toContain("_expected_merged_person: Json");
    expect(errors).toContain("MERGE_STALE_PERSON");
  });

  it("removes the old RPC overload so callers cannot omit expected person state", () => {
    expect(migration).toContain(
      "DROP FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid)",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.merge_people_with_households(uuid,uuid,jsonb,boolean,uuid,uuid,jsonb,jsonb)",
    );
  });
});
