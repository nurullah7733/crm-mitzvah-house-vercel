import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));

const { transitionReviewStatus, undoQuickMerge } = await import("@/lib/review-quick");
const { transactionReviewKind } = await import("@/lib/transaction-namespace");

beforeEach(() => rpc.mockReset());

describe("H2 active review safety client", () => {
  it("sends quick undo through one transactional RPC", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await undoQuickMerge({
      itemId: "review-1", personId: "person-1", personName: "A Person", before: {},
      filledFields: 0, donationId: null, registrationId: null, interactionIds: [],
      addedActivity: [], undoToken: { person_id: "person-1" },
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("undo_review_quick_merge", {
      _item_id: "review-1", _person_id: "person-1", _undo_token: { person_id: "person-1" },
    });
  });

  it("propagates stale undo without attempting a client fallback", async () => {
    const stale = { message: "REVIEW_STALE_UNDO" };
    rpc.mockResolvedValueOnce({ data: null, error: stale });
    await expect(undoQuickMerge({
      itemId: "review-1", personId: "person-1", personName: "A Person", before: {},
      filledFields: 0, donationId: null, registrationId: null, interactionIds: [],
      addedActivity: [], undoToken: {},
    })).rejects.toBe(stale);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("sends expected and next status for stale-safe transitions", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await transitionReviewStatus("review-1", "pending", "skipped", "Later");
    expect(rpc).toHaveBeenCalledWith("transition_review_status", {
      _item_id: "review-1", _expected_status: "pending", _next_status: "skipped", _note: "Later",
    });
  });

  it.each(["transaction_contradiction", "legacy_transaction", "soft_deleted_transaction"])(
    "recognizes protected %s review context",
    (kind) => expect(transactionReviewKind({ review_context: { kind } })).toBe(kind),
  );
});
