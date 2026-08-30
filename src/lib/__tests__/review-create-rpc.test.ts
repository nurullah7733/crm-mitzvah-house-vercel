import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));
vi.mock("@/lib/campaigns", () => ({ resolveCampaignId: vi.fn(async () => null) }));

const { createReviewPerson } = await import("@/lib/review-quick");
const sql = readFileSync(
  new URL("../../../supabase/migrations/20260824000200_resolve_review_create.sql", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("../../components/ReviewCompareDialog.tsx", import.meta.url),
  "utf8",
);
const item = {
  id: "review-1",
  filename: "people.csv",
  row_data: { first_name: "Leah", email: "leah@example.com" },
};
const incoming = {
  first_name: "Leah",
  last_name: null,
  display_name: "Leah",
  email: "leah@example.com",
  phone: null,
  role: "Adult",
  birth_date: null,
  anniversary_date: null,
  school: null,
  notes: null,
  met_source: null,
};

beforeEach(() => rpc.mockReset());

describe("transactional create/keep-both review", () => {
  it("uses one RPC and returns the created person ID", async () => {
    rpc.mockResolvedValueOnce({ data: "person-new", error: null });
    await expect(createReviewPerson(item, incoming, "household-1")).resolves.toBe("person-new");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_create",
      expect.objectContaining({
        _item_id: "review-1",
        _person: expect.objectContaining({
          email: "leah@example.com",
          household_id: "household-1",
        }),
      }),
    );
  });

  it("rejects an RPC failure instead of reporting success", async () => {
    const failure = { message: "donation insert failed" };
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(createReviewPerson(item, incoming, null)).rejects.toBe(failure);
  });

  it("has no independent frontend person/activity/finalizer write path", () => {
    const keepBothBody = dialog.slice(
      dialog.indexOf("const keepBoth = useMutation"),
      dialog.indexOf("const discard = useMutation"),
    );
    expect(keepBothBody).toContain("createReviewPerson(");
    expect(keepBothBody).not.toContain("createFromIncoming(");
    expect(keepBothBody).not.toContain("processActivityBeforeFinalize(");
    expect(keepBothBody).not.toContain("finish(");
  });

  it("creates person, runs shared activity/finalization, and returns its ID in one SQL boundary", () => {
    const createBody = sql.slice(sql.indexOf("CREATE FUNCTION public.resolve_review_create"));
    expect(createBody).toContain("INSERT INTO public.people");
    expect(createBody).toContain("public.resolve_review_merge_core(");
    expect(createBody).toContain("'kept_both'");
    expect(createBody).toContain("RETURN v_person_id");
    expect(sql).toContain("INSERT INTO public.registrations");
    expect(sql).toContain("INSERT INTO public.donations");
    expect(sql).toContain("INSERT INTO public.interactions");
    expect(sql).toContain("PERFORM public.log_review_decision");
  });

  it("explicitly staff-authorizes every public SECURITY DEFINER entry point", () => {
    const entryPoints = [
      "resolve_review_quick_merge",
      "resolve_review_manual_merge",
      "resolve_review_create",
    ];
    for (const [index, name] of entryPoints.entries()) {
      const start = sql.indexOf(`CREATE FUNCTION public.${name}`);
      const next = entryPoints[index + 1];
      const body = sql.slice(
        start,
        next ? sql.indexOf(`CREATE FUNCTION public.${next}`) : undefined,
      );
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("auth.uid() IS NULL");
      expect(body).toContain("public.has_role(auth.uid(), 'admin')");
      expect(body).toContain("public.has_role(auth.uid(), 'marketing')");
      expect(body).toContain("public.has_role(auth.uid(), 'va')");
      expect(body).toContain("RAISE EXCEPTION 'Active staff access required'");
    }
  });

  it("keeps defense-in-depth authorization and denies authenticated core execution", () => {
    const core = sql.slice(
      sql.indexOf("CREATE FUNCTION public.resolve_review_merge_core"),
      sql.indexOf("CREATE FUNCTION public.resolve_review_quick_merge"),
    );
    expect(core).toContain("auth.uid() IS NULL");
    expect(core).toContain("RAISE EXCEPTION 'Active staff access required'");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_review_merge_core\([^;]+\) TO authenticated/,
    );
  });

  it("keeps the pending-review transaction lock", () => {
    expect(sql).toContain("FROM public.review_queue WHERE id = _item_id FOR UPDATE");
    expect(sql).toContain("v_review.status <> 'pending'");
  });
});
