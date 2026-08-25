import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));

const { applyHouseholdReviewCard } = await import("@/lib/review-household");
const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000300_resolve_review_household_card.sql",
    import.meta.url,
  ),
  "utf8",
);
const route = readFileSync(
  new URL("../../routes/_authenticated/inbox.review.tsx", import.meta.url),
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("transactional household review card", () => {
  it("sends multiple selected rows through one RPC boundary", async () => {
    rpc.mockResolvedValueOnce({
      data: { household_id: "household-1", saved: 2, left: 1 },
      error: null,
    });
    const members = [
      { action: "same" as const, item_id: "review-1", person_id: "person-1" },
      { action: "related" as const, item_id: "review-2", person: { first_name: "Mira" } },
      { action: "later" as const, item_id: "review-3" },
    ];
    await expect(
      applyHouseholdReviewCard(
        {
          id: "household-1",
          create: false,
          name: "Klein household",
          address: null,
          batch_id: null,
        },
        members,
      ),
    ).resolves.toEqual({ household_id: "household-1", saved: 2, left: 1 });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_household_card",
      expect.objectContaining({ _members: members }),
    );
  });

  it("rejects a required member failure instead of reporting card success", async () => {
    const failure = { message: "person C donation failed" };
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(
      applyHouseholdReviewCard(
        { id: null, create: true, name: "Household", address: "1 Main St", batch_id: null },
        [{ action: "related", item_id: "review-1" }],
      ),
    ).rejects.toBe(failure);
  });

  it("keeps household, existing-link, create, activity, and decisions in one SQL function", () => {
    expect(sql).toContain("CREATE FUNCTION public.resolve_review_household_card");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("INSERT INTO public.households");
    expect(sql).toContain("UPDATE public.people SET");
    expect(sql).toContain("INSERT INTO public.people");
    expect(sql.match(/public\.resolve_review_merge_core\(/g)).toHaveLength(2);
    expect(sql).toContain("PERFORM public.log_review_decision(");
    expect(sql).toContain("jsonb_array_elements");
    expect(sql).not.toContain("EXCEPTION WHEN OTHERS");
  });

  it("has an explicit staff gate and preserves later rows as skipped inside the transaction", () => {
    expect(sql).toContain("auth.uid() IS NULL");
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
    expect(sql).toContain("public.has_role(auth.uid(), 'marketing')");
    expect(sql).toContain("public.has_role(auth.uid(), 'va')");
    expect(sql).toContain("status = 'skipped'");
    expect(sql).toContain("Left for later from the address card");
  });

  it("removes independent card-level person, activity, and finalizer writes", () => {
    const body = route.slice(
      route.indexOf("const applyCard = useMutation"),
      route.indexOf("// Duplicates"),
    );
    expect(body).toContain("applyHouseholdReviewCard(");
    expect(body).not.toContain("createPersonFromRow(");
    expect(body).not.toContain("quickMerge(");
    expect(body).not.toContain("linkHouseholdBeforeFinalize(");
    expect(body).not.toContain('.from("review_queue")');
  });
});
