import { beforeEach, describe, expect, it, vi } from "vitest";

const { processActivity } = vi.hoisted(() => ({
  processActivity: vi.fn(),
}));

vi.mock("@/lib/review-quick", () => ({
  processReviewRowActivity: processActivity,
}));

const { processActivityBeforeFinalize } = await import("@/lib/review-activity");
const donationRow = { amount: "100", date: "2026-08-20" };

beforeEach(() => {
  processActivity.mockReset();
  processActivity.mockResolvedValue({ donationId: "donation-1" });
});

describe("manual review activity", () => {
  it("processes a donation row for the selected person before finalizing a merge", async () => {
    const finalize = vi.fn(async () => undefined);

    await processActivityBeforeFinalize(
      "existing-person",
      donationRow,
      "import review",
      "batch-1",
      finalize,
    );

    expect(processActivity).toHaveBeenCalledWith(
      "existing-person",
      donationRow,
      "import review",
      "batch-1",
    );
    expect(processActivity.mock.invocationCallOrder[0]).toBeLessThan(
      finalize.mock.invocationCallOrder[0]!,
    );
  });

  it("processes a donation row for the newly created person before keeping both", async () => {
    const finalize = vi.fn(async () => undefined);

    await processActivityBeforeFinalize(
      "new-person",
      donationRow,
      "import review",
      "batch-1",
      finalize,
    );

    expect(processActivity).toHaveBeenCalledWith(
      "new-person",
      donationRow,
      "import review",
      "batch-1",
    );
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("does not finalize the review item when activity processing fails", async () => {
    const finalize = vi.fn(async () => undefined);
    processActivity.mockRejectedValueOnce(new Error("donation failed"));

    await expect(
      processActivityBeforeFinalize(
        "existing-person",
        donationRow,
        "import review",
        "batch-1",
        finalize,
      ),
    ).rejects.toThrow("donation failed");

    expect(finalize).not.toHaveBeenCalled();
  });
});
