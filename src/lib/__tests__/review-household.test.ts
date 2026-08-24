import { describe, expect, it, vi } from "vitest";
import { linkHouseholdBeforeFinalize } from "@/lib/review-household";

describe("household review writes", () => {
  it("does not finalize a review item when linking its household fails", async () => {
    const finalize = vi.fn(async () => "finalized");

    await expect(
      linkHouseholdBeforeFinalize(
        Promise.resolve({ error: { message: "permission denied" } }),
        finalize,
      ),
    ).rejects.toThrow("The contact couldn't be linked to the household. permission denied");

    expect(finalize).not.toHaveBeenCalled();
  });
});
