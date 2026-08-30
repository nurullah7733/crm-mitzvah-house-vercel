import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewPerson } from "@/lib/review-merge";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));
vi.mock("@/lib/campaigns", () => ({ resolveCampaignId: vi.fn(async () => null) }));

const { manualMerge } = await import("@/lib/review-quick");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260830000400_fix_manual_review_stale_snapshot.sql",
    import.meta.url,
  ),
  "utf8",
);
const dialog = readFileSync(
  new URL("../../components/ReviewCompareDialog.tsx", import.meta.url),
  "utf8",
);

const openedPerson: ReviewPerson = {
  id: "person-h2",
  first_name: "H2Edited",
  last_name: "QuickUndo",
  display_name: "H2Edited QuickUndo",
  email: "h2@example.test",
  phone: null,
  role: "Adult",
  birth_date: null,
  anniversary_date: null,
  school: null,
  notes: null,
  met_source: null,
  household_id: null,
  lifetime_giving: 0,
};
const fields = [
  {
    key: "phone",
    label: "Phone",
    existing: null,
    incoming: "12025550147",
    state: "fill",
  },
] as const;
const item = {
  id: "review-h2",
  filename: "H2-5D-quick-undo-review.csv",
  row_data: { first_name: "H2Edited", last_name: "QuickUndo", phone: "12025550147" },
};

beforeEach(() => rpc.mockReset());

describe("H5 stale manual-review dialog", () => {
  it("submits the immutable full dialog snapshot and propagates stale rejection without fallback writes", async () => {
    const stale = { code: "P0001", message: "REVIEW_STALE_PERSON" };
    rpc.mockResolvedValueOnce({ data: null, error: stale });

    await expect(
      manualMerge(item, openedPerson.id, [...fields], {}, {
        existingBefore: { ...openedPerson },
        survivingAfter: { ...openedPerson, phone: "12025550147" },
      }),
    ).rejects.toBe(stale);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_manual_merge",
      expect.objectContaining({
        _person_patch: expect.objectContaining({
          __h2_contract: "manual",
          __h2_values: { phone: "12025550147" },
          __h2_expected: expect.objectContaining({
            first_name: "H2Edited",
            display_name: "H2Edited QuickUndo",
            phone: null,
          }),
        }),
      }),
    );
  });

  it("allows the same resolution after reopening with refreshed person values", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    const refreshed = {
      ...openedPerson,
      first_name: "NewerName",
      display_name: "NewerName QuickUndo",
    };
    await expect(
      manualMerge(item, refreshed.id, [...fields], {}, {
        existingBefore: refreshed,
        survivingAfter: { ...refreshed, phone: "12025550147" },
      }),
    ).resolves.toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_manual_merge",
      expect.objectContaining({
        _person_patch: expect.objectContaining({
          __h2_expected: expect.objectContaining({
            first_name: "NewerName",
            display_name: "NewerName QuickUndo",
          }),
        }),
      }),
    );
  });

  it("validates every protected dialog field before any merge, activity, audit, or finalization", () => {
    for (const field of [
      "first_name", "last_name", "display_name", "email", "phone", "role",
      "birth_date", "anniversary_date", "school", "notes", "met_source",
    ]) expect(migration).toContain(`'${field}'`);
    expect(migration).toContain("RAISE EXCEPTION 'REVIEW_STALE_PERSON'");
    expect(migration.indexOf("REVIEW_STALE_PERSON")).toBeLessThan(
      migration.indexOf("public.resolve_review_merge_core("),
    );
    expect(migration.indexOf("REVIEW_STALE_PERSON")).toBeLessThan(
      migration.indexOf("public.log_import_review_merge("),
    );
    expect(dialog).toContain("setSelectedExisting(existing ? { ...existing } : null)");
    expect(dialog).toContain("setSelectedExisting({ ...person })");
  });
});
