import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830000100_household_correction_safety.sql",
    import.meta.url,
  ),
  "utf8",
);
const inbox = readFileSync(
  new URL("../../routes/_authenticated/inbox.review.tsx", import.meta.url),
  "utf8",
);
const compare = readFileSync(
  new URL("../../components/ReviewCompareDialog.tsx", import.meta.url),
  "utf8",
);
const contacts = readFileSync(
  new URL("../../components/MergeContactsDialog.tsx", import.meta.url),
  "utf8",
);
const growing = readFileSync(
  new URL("../../components/GrowingUpDialogs.tsx", import.meta.url),
  "utf8",
);
const bulk = readFileSync(
  new URL("../../components/BulkRecordActions.tsx", import.meta.url),
  "utf8",
);
const quickHousehold = readFileSync(
  new URL("../../components/forms/QuickAddHouseholdDialog.tsx", import.meta.url),
  "utf8",
);

const section = (start: string, end?: string) => {
  const from = migration.indexOf(start);
  const to = end ? migration.indexOf(end, from + start.length) : migration.length;
  return migration.slice(from, to < 0 ? migration.length : to);
};

describe("M2-H3 household correction safety", () => {
  it("prevalidates and locks an entire household card before any write", () => {
    const body = section(
      "CREATE OR REPLACE FUNCTION public.resolve_review_household_card",
      "REVOKE ALL ON FUNCTION public.household_address_key",
    );
    expect(body).toContain("ORDER BY q.id FOR UPDATE");
    expect(body).toContain("ORDER BY p.id FOR UPDATE");
    expect(body).toContain("REVIEW_STALE_HOUSEHOLD");
    expect(body).toContain("v_person.household_id IS DISTINCT FROM");
    expect(body).toContain("v_person_id = ANY(v_review.candidate_person_ids)");
    expect(body).toContain("REVIEW_HOUSEHOLD_TARGET_INVALID");
    expect(body.indexOf("REVIEW_STALE_HOUSEHOLD")).toBeLessThan(
      body.indexOf("PERFORM public.resolve_review_merge_core"),
    );
    expect(inbox).toContain("expected_household_id: existing.household_id");
    expect(inbox).toContain('__h2_contract: "manual"');
  });

  it("moves membership and its timeline note through one stale-safe RPC", () => {
    const body = section(
      "CREATE OR REPLACE FUNCTION public.mutate_household_membership",
      "CREATE OR REPLACE FUNCTION public.delete_households_transactional",
    );
    expect(body).toContain("WHERE id = _person_id AND deleted_at IS NULL FOR UPDATE");
    expect(body).toContain("v_person.household_id IS DISTINCT FROM _expected_household_id");
    expect(body).toContain("UPDATE public.people SET household_id = v_target_id");
    expect(body).toContain("INSERT INTO public.interactions");
    expect(growing).toContain('supabase.rpc("mutate_household_membership"');
    expect(growing).not.toContain('.update({ household_id: targetId })');
  });

  it("unlinks and deletes selected households in one database boundary", () => {
    const body = section(
      "CREATE OR REPLACE FUNCTION public.delete_households_transactional",
      "CREATE OR REPLACE FUNCTION public.merge_people_with_households",
    );
    expect(body).toContain("UPDATE public.people SET household_id = NULL");
    expect(body).toContain("DELETE FROM public.households");
    expect(bulk).toContain('supabase.rpc("delete_households_transactional"');
    expect(bulk).not.toContain('.update({ household_id: null }');
  });

  it("does not inherit a candidate household when keeping both", () => {
    const keepBoth = compare.slice(compare.indexOf("const keepBoth"), compare.indexOf("const discard"));
    expect(keepBoth).toContain("createReviewPerson(");
    expect(keepBoth).toMatch(/incoming,\s*null,/);
    expect(keepBoth).not.toContain("selectedExisting?.household_id");
  });

  it("combines person and household merge through one atomic RPC", () => {
    const body = section(
      "CREATE OR REPLACE FUNCTION public.merge_people_with_households",
      "CREATE OR REPLACE FUNCTION public.resolve_review_household_card",
    );
    expect(body).toContain("ORDER BY id FOR UPDATE");
    expect(body).toContain("REVIEW_STALE_HOUSEHOLD");
    expect(body).toContain("PERFORM public.merge_people(");
    expect(body).toContain("PERFORM public.merge_households(");
    expect(contacts).toContain('supabase.rpc("merge_people_with_households"');
    expect(contacts).not.toContain('supabase.rpc("merge_people"');
    expect(contacts).not.toContain('supabase.rpc("merge_households"');
  });

  it("serializes normalized-address lookup/create without global uniqueness", () => {
    const body = section(
      "CREATE OR REPLACE FUNCTION public.resolve_household_at_address",
      "CREATE OR REPLACE FUNCTION public.mutate_household_membership",
    );
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toContain("household_address_key(h.address) = v_key");
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("INSERT INTO public.households"));
    expect(quickHousehold).toContain('supabase.rpc("resolve_household_at_address"');
    expect(migration).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*household_address/i);
  });

  it("validates relationship values and requires one for related card members", () => {
    expect(migration).toContain("HOUSEHOLD_RELATIONSHIP_INVALID");
    expect(migration).toContain("HOUSEHOLD_RELATIONSHIP_REQUIRED");
    for (const relationship of ["Spouse", "Child", "Parent", "Sibling", "Other"])
      expect(migration).toContain(`'${relationship}'`);
  });
});
