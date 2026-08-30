import { describe, expect, it, vi } from "vitest";
import { processActivityBeforeFinalize } from "@/lib/review-activity";

describe("legacy manual review activity helper", () => {
  it("is quarantined before any activity or finalization can run", async () => {
    const finalize = vi.fn(async () => undefined);
    await expect(
      processActivityBeforeFinalize(
        "person-1",
        { amount: "100", date: "2026-08-20" },
        "legacy review",
        "batch-1",
        finalize,
      ),
    ).rejects.toThrow("LEGACY_UNSAFE_HELPER_DISABLED");
    expect(finalize).not.toHaveBeenCalled();
  });
});
