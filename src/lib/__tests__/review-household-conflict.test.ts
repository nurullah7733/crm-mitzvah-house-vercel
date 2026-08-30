import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const { householdConflictContext, keepCurrentHouseholds } =
  await import("@/lib/review-household-conflict");

beforeEach(() => rpc.mockReset());

describe("household conflict review", () => {
  const context = {
    kind: "household_conflict",
    main_person_id: "noah",
    partner_person_id: "leah",
    main_household_id: "household-a",
    partner_household_id: "household-b",
    main_household_name: "Noah household",
    partner_household_name: "Leah household",
    main_name: "Noah Bernstein",
    partner_name: "Leah Bernstein",
  };

  it("reads both resolved people and households from structured metadata", () => {
    expect(householdConflictContext({ review_context: context })).toEqual(context);
  });

  it("keeps current households by resolving only the review item", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await keepCurrentHouseholds("review-1");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("log_review_decision", {
      _item_id: "review-1",
      _decision: "kept_both",
      _reason: "Kept both people in their current households; no household change applied.",
    });
  });

  it("does not send person, household, or activity writes", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await keepCurrentHouseholds("review-1");
    expect(rpc.mock.calls[0]?.[0]).toBe("log_review_decision");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("_person_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("_donation");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("_event");
  });

  it("does not treat malformed context as a household conflict", () => {
    expect(householdConflictContext({ review_context: { kind: "household_conflict" } })).toBeNull();
  });

  it("routes only structured conflicts away from the generic dialog", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.review.tsx", "utf8");
    expect(source).toContain("householdConflictContext(");
    expect(source).toContain("<HouseholdConflictReviewDialog");
    expect(source).toContain("!householdConflict && !coupleActivity");
    expect(source).toContain("<ReviewCompareDialog");
  });

  it("keeps set-aside and discard operations on their existing safe paths", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.review.tsx", "utf8");
    expect(source).toContain("transitionReviewStatus(");
    expect(source).toContain("discardRow(");
  });
});
