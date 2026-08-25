import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000600_resolve_import_row_relatives.sql",
    import.meta.url,
  ),
  "utf8",
);
const rpc = sql.slice(sql.indexOf("CREATE FUNCTION public.resolve_import_row("));
const personHelper = sql.slice(
  sql.indexOf("CREATE FUNCTION public.apply_import_person_core("),
  sql.indexOf("CREATE FUNCTION public.apply_import_contact_methods_core("),
);

describe("resolve_import_row relative transaction boundary", () => {
  it("accepts spouse and children inside the same public RPC", () => {
    expect(rpc).toContain("_spouse jsonb DEFAULT");
    expect(rpc).toContain("_children jsonb DEFAULT");
    expect(rpc).toContain("v_spouse_id := public.apply_import_person_core(");
    expect(rpc).toContain("FOR v_child IN SELECT value FROM jsonb_array_elements");
  });

  it("locks and validates selected existing relatives", () => {
    expect(personHelper).toContain("deleted_at IS NULL");
    expect(personHelper).toContain("FOR UPDATE");
    expect(personHelper).toContain("RAISE EXCEPTION 'That selected spouse no longer exists'");
    expect(personHelper).toContain("RAISE EXCEPTION 'That selected child no longer exists'");
  });

  it("creates relatives through one shared insert implementation", () => {
    expect(personHelper.match(/INSERT INTO public\.people/g)).toHaveLength(1);
    expect(rpc.match(/public\.apply_import_person_core\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(rpc).not.toContain("INSERT INTO public.people");
  });

  it("assigns spouse and children to the resolved household", () => {
    expect(personHelper).toContain(
      "household_id = CASE WHEN _link_household THEN _household_id ELSE household_id END",
    );
    expect(rpc).toContain("'Adult', 'Spouse', 'spouse'");
    expect(rpc).toContain("'Child', 'Child', 'child'");
    expect(rpc).toContain("Imported relatives require a resolved household");
  });

  it("imports spouse methods but does not invent child contact methods", () => {
    expect(rpc).toContain("COALESCE(_spouse->'contact_methods', '[]'::jsonb)");
    const childLoop = rpc.slice(rpc.indexOf("FOR v_child IN"), rpc.indexOf("-- Provenance"));
    expect(childLoop).not.toContain("apply_import_contact_methods_core");
  });

  it("does not swallow required relative failures", () => {
    expect(personHelper).not.toContain("EXCEPTION WHEN OTHERS");
    expect(rpc.match(/EXCEPTION WHEN OTHERS/g)).toHaveLength(1);
    expect(rpc.indexOf("FOR v_child IN")).toBeLessThan(rpc.indexOf("EXCEPTION WHEN OTHERS"));
  });

  it("keeps activity, outcomes, matching, and importer cutover absent", () => {
    expect(sql).not.toContain("public.apply_import_activity_core");
    expect(sql).not.toContain("INSERT INTO public.donations");
    expect(sql).not.toContain("INSERT INTO public.registrations");
    expect(sql).not.toContain("INSERT INTO public.interactions");
    expect(sql).not.toContain("import_row_outcomes");
    expect(sql).not.toContain("review_queue");
    expect(sql).not.toMatch(/WHERE[^;]+(email|phone|address|first_name|last_name)[^;]+FOR UPDATE/is);
  });

  it("keeps internal helpers unavailable to authenticated clients", () => {
    expect(sql.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(2);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_import_[^(]+\([^;]+authenticated/);
  });
});
