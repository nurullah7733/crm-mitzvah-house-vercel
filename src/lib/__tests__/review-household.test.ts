import { describe, expect, it, vi } from "vitest";
import { linkHouseholdBeforeFinalize } from "@/lib/review-household";

describe("household review writes", () => {
  it("quarantines the nontransactional link-then-finalize helper", async () => {
    const finalize = vi.fn(async () => "finalized");

    await expect(
      linkHouseholdBeforeFinalize(
        Promise.resolve({ error: { message: "permission denied" } }),
        finalize,
      ),
    ).rejects.toThrow("LEGACY_UNSAFE_HELPER_DISABLED");

    expect(finalize).not.toHaveBeenCalled();
  });
});
