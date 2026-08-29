import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewPerson } from "@/lib/review-merge";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, rpc },
}));

vi.mock("@/lib/campaigns", () => ({
  resolveCampaignId: vi.fn(async () => null),
}));

const { quickMerge } = await import("@/lib/review-quick");

const existing: ReviewPerson = {
  id: "person-1",
  display_name: "Sarah Klein",
  first_name: "Sarah",
  last_name: "Klein",
  email: null,
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

const item = {
  id: "review-1",
  filename: "gifts.csv",
  row_data: {
    first_name: "Sarah",
    last_name: "Klein",
    role: "Adult",
    amount: "100",
    date: "2026-08-20",
  },
};

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe("transactional quick review merge", () => {
  it("uses the single transactional RPC and returns its successful activity result", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        donation_id: "donation-1",
        donation_created: true,
        registration_created: false,
        registration_upgraded: false,
        note_created: false,
      },
      error: null,
    });

    const result = await quickMerge(item, existing, "Sarah Klein");

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_quick_merge",
      expect.objectContaining({
        _item_id: "review-1",
        _person_id: "person-1",
        _donation: expect.objectContaining({ amount: 100 }),
      }),
    );
    expect(result.donationId).toBe("donation-1");
    expect(result.addedActivity).toContain("a $100 gift");
  });

  it("propagates an RPC failure instead of returning a successful merge", async () => {
    const failure = { message: "donation insert failed" };
    rpc.mockResolvedValueOnce({ data: null, error: failure });

    await expect(quickMerge(item, existing, "Sarah Klein")).rejects.toBe(failure);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["zero", "0"],
    ["negative", "-10"],
  ])("sends a zero registration fee for a %s payment", async (_label, amount) => {
    from.mockReturnValue({
      select: () => ({
        is: async () => ({
          data: [{ id: "event-1", name: "Dinner", date: "2026-08-20", registration_fee: 25 }],
          error: null,
        }),
      }),
    });
    rpc.mockResolvedValueOnce({ data: {}, error: null });

    await quickMerge(
      { ...item, row_data: { ...item.row_data, event_name: "Dinner", amount } },
      existing,
      "Sarah Klein",
    );

    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_quick_merge",
      expect.objectContaining({
        _event: expect.objectContaining({ fee_amount: 0 }),
      }),
    );
  });

  it("rejects an invalid payment before resolving the review", async () => {
    await expect(
      quickMerge(
        { ...item, row_data: { ...item.row_data, event_name: "Dinner", amount: "not a number" } },
        existing,
        "Sarah Klein",
      ),
    ).rejects.toThrow("amount is invalid or ambiguous");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("caps a positive registration fee at the payment and never sends a negative fee", async () => {
    from.mockReturnValue({
      select: () => ({
        is: async () => ({
          data: [{ id: "event-1", name: "Dinner", date: "2026-08-20", registration_fee: 125 }],
          error: null,
        }),
      }),
    });
    rpc.mockResolvedValueOnce({ data: {}, error: null });

    await quickMerge(
      { ...item, row_data: { ...item.row_data, event_name: "Dinner", amount: "100" } },
      existing,
      "Sarah Klein",
    );

    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_quick_merge",
      expect.objectContaining({
        _event: expect.objectContaining({ fee_amount: 100 }),
      }),
    );
  });

  it("clamps a negative event fee to zero", async () => {
    from.mockReturnValue({
      select: () => ({
        is: async () => ({
          data: [{ id: "event-1", name: "Dinner", date: "2026-08-20", registration_fee: -25 }],
          error: null,
        }),
      }),
    });
    rpc.mockResolvedValueOnce({ data: {}, error: null });

    await quickMerge(
      { ...item, row_data: { ...item.row_data, event_name: "Dinner", amount: "100" } },
      existing,
      "Sarah Klein",
    );

    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_quick_merge",
      expect.objectContaining({
        _event: expect.objectContaining({ fee_amount: 0 }),
      }),
    );
  });
});
