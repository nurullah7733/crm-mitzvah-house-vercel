import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));
vi.mock("@/lib/campaigns", () => ({ resolveCampaignId: vi.fn(async () => null) }));

const { manualMerge } = await import("@/lib/review-quick");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260824000100_resolve_review_manual_merge.sql",
    import.meta.url,
  ),
  "utf8",
);
const dialog = readFileSync(
  new URL("../../components/ReviewCompareDialog.tsx", import.meta.url),
  "utf8",
);

const fields = [
  { key: "email", label: "Email", existing: null, incoming: "new@example.com", state: "fill" },
] as const;
const item = {
  id: "review-1",
  filename: "people.csv",
  row_data: { first_name: "Sarah", email: "new@example.com" },
};

beforeEach(() => rpc.mockReset());

describe("transactional manual review merge", () => {
  it("uses one RPC instead of independent person, activity, audit, and finalizer writes", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await manualMerge(
      item,
      "person-1",
      [...fields],
      {},
      {
        existingBefore: { email: null },
        survivingAfter: { email: "new@example.com" },
      },
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_manual_merge",
      expect.objectContaining({
        _person_patch: {
          __h2_contract: "manual",
          __h2_expected: { email: null },
          __h2_values: { email: "new@example.com" },
        },
        _existing_before: { email: null },
        _surviving_after: { email: "new@example.com" },
      }),
    );
    expect(dialog).not.toContain('supabase.rpc("log_import_review_merge"');
    expect(dialog).not.toContain("await applyIncoming(");
  });

  it("rejects when the transactional boundary reports an activity/database failure", async () => {
    const failure = { message: "registration insert failed" };
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(
      manualMerge(
        item,
        "person-1",
        [...fields],
        {},
        {
          existingBefore: {},
          survivingAfter: {},
        },
      ),
    ).rejects.toBe(failure);
  });

  it("reuses Block 5B core and keeps required merge audit in the same SQL function", () => {
    expect(migration).toContain("public.resolve_review_quick_merge(");
    expect(migration).toContain("PERFORM public.log_import_review_merge(");
    expect(migration.indexOf("public.resolve_review_quick_merge(")).toBeLessThan(
      migration.indexOf("PERFORM public.log_import_review_merge("),
    );
    expect(migration).not.toContain("EXCEPTION WHEN OTHERS");
  });
});
