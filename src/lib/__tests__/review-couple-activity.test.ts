import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, resolveReviewMergePayload } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveReviewMergePayload: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));
vi.mock("@/lib/review-quick", () => ({ resolveReviewMergePayload }));

const { resolveCoupleActivity } = await import("@/lib/review-couple-activity");

const context = {
  kind: "couple_activity_owner" as const,
  main_claim: { first_name: "F11a", last_name: "Couple" },
  partner_claim: { first_name: "F11b", last_name: "Couple" },
  activity: { type: "donation", amount: 100, date: "2026-08-29" },
};

beforeEach(() => {
  rpc.mockReset();
  resolveReviewMergePayload.mockReset();
});

describe("F11 couple activity owner payload", () => {
  it("sends the selected owner's registration and net donation in the shared activity shape", async () => {
    resolveReviewMergePayload.mockResolvedValue({
      event: { event_id: "event-1", payment_amount: 100, fee_amount: 25 },
      donation: {
        amount: 75,
        event_id: "event-1",
        campaign_name: "M2F Shared Campaign",
        import_fingerprint: "f11-gift",
      },
      note: null,
    });
    rpc.mockResolvedValue({ data: { activity_owner: "partner" }, error: null });

    await resolveCoupleActivity(
      "review-1",
      "partner",
      context,
      {
        first_name: "F11a",
        last_name: "Couple",
        spouse_first_name: "F11b",
        spouse_last_name: "Couple",
        amount: "100",
        date: "2026-08-29",
        event_name: "M2F Attendance Preserve",
        campaign: "M2F Shared Campaign",
      },
      "batch-1",
    );

    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_couple_activity",
      expect.objectContaining({
        _owner: "partner",
        _activity: {
          registrations: [{ event_id: "event-1", payment_amount: 100, fee_amount: 25 }],
          donation: expect.objectContaining({
            amount: 75,
            event_id: "event-1",
            campaign_name: "M2F Shared Campaign",
          }),
          note: null,
        },
      }),
    );
  });

  it("never invents a registration when the shared planner returns no event payload", async () => {
    resolveReviewMergePayload.mockResolvedValue({ event: null, donation: null, note: null });
    rpc.mockResolvedValue({ data: {}, error: null });
    await resolveCoupleActivity("review-1", "main", context, {}, null);
    expect(rpc).toHaveBeenCalledWith(
      "resolve_review_couple_activity",
      expect.objectContaining({
        _activity: { registrations: [], donation: null, note: null },
      }),
    );
  });
});
