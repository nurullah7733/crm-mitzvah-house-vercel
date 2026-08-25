import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000500_resolve_import_row_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("resolve_import_row main-contact transaction boundary", () => {
  it("explicitly requires an authenticated staff role", () => {
    expect(sql).toContain("auth.uid() IS NULL");
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
    expect(sql).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(sql).toContain("public.has_role(auth.uid(), 'va')");
    expect(sql).toContain("RAISE EXCEPTION 'Active staff access required'");
  });

  it("locks and validates a client-selected existing person before updating", () => {
    const lock = sql.indexOf("SELECT * INTO v_person");
    const update = sql.indexOf("UPDATE public.people SET");
    expect(sql.slice(lock, update)).toContain("deleted_at IS NULL");
    expect(sql.slice(lock, update)).toContain("FOR UPDATE");
    expect(sql.slice(lock, update)).toContain(
      "RAISE EXCEPTION 'That imported contact no longer exists'",
    );
    expect(lock).toBeLessThan(update);
    expect(sql).toContain("CASE WHEN v_person_values ? 'email'");
  });

  it("creates a person once and returns the generated ID", () => {
    expect(sql.match(/INSERT INTO public\.people/g)).toHaveLength(1);
    expect(sql).toContain("RETURNING id INTO v_person_id");
    expect(sql).toContain("'person_id', v_person_id");
  });

  it("keeps household create, update, lock, and person link in the same function", () => {
    expect(sql).toContain("INSERT INTO public.households");
    expect(sql).toContain("UPDATE public.households SET");
    expect(sql).toContain("FROM public.households WHERE id = v_household_id FOR UPDATE");
    expect(sql).toContain("household_id = CASE WHEN v_household_action <> 'none'");
    expect(sql).toContain("v_person_values->>'household_relationship'");
  });

  it("contains required contact methods and tag/program updates", () => {
    expect(sql).toContain("INSERT INTO public.contact_methods");
    expect(sql).toContain("regexp_replace(v_method_value, '\\D', '', 'g')");
    expect(sql).toContain("tags = p.tags || ARRAY(");
    expect(sql).toContain("programs = p.programs || ARRAY(");
    expect(sql).not.toMatch(/INSERT INTO public\.(tag|program)/);
  });

  it("isolates only best-effort provenance", () => {
    expect(sql).toContain("INSERT INTO public.field_sources");
    expect(sql.match(/EXCEPTION WHEN OTHERS/g)).toHaveLength(1);
    expect(sql.indexOf("INSERT INTO public.contact_methods")).toBeLessThan(
      sql.indexOf("EXCEPTION WHEN OTHERS"),
    );
  });

  it("does not introduce activity, failure recording, or matching", () => {
    expect(sql).not.toContain("public.apply_import_activity_core");
    expect(sql).not.toContain("INSERT INTO public.donations");
    expect(sql).not.toContain("INSERT INTO public.registrations");
    expect(sql).not.toContain("INSERT INTO public.interactions");
    expect(sql).not.toContain("import_row_outcomes");
    expect(sql).not.toContain("review_queue");
    expect(sql).not.toMatch(/WHERE[^;]+(email|phone|address|first_name|last_name)[^;]+FOR UPDATE/is);
  });
});
