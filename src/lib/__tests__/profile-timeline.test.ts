import { describe, expect, it } from "vitest";
import { shouldShowProfileInteraction } from "../profile-timeline";

describe("profile timeline interaction visibility", () => {
  it("shows thank-you and tax receipt entries", () => {
    expect(shouldShowProfileInteraction({ source_kind: "donation_thank_you" })).toBe(true);
    expect(shouldShowProfileInteraction({ source_kind: "donation_receipt" })).toBe(true);
  });

  it("hides only interaction rows mirrored by source records", () => {
    expect(shouldShowProfileInteraction({ source_kind: "donation_gift" })).toBe(false);
    expect(shouldShowProfileInteraction({ source_kind: "event_attendance" })).toBe(false);
    expect(shouldShowProfileInteraction({ source_kind: null })).toBe(true);
  });
});