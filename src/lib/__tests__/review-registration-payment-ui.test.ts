import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../../routes/_authenticated/inbox.review.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../../components/RegistrationPaymentConflictDialog.tsx", import.meta.url), "utf8");

describe("registration payment review UI", () => {
  it("excludes activity conflicts from quick and bulk same-person paths", () => {
    expect(route.match(/isRegistrationPaymentConflict\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(route).toContain("const dedicatedConflict = Boolean(");
    expect(route).toContain("!dedicatedConflict");
    expect(route).toContain("skipped += 1");
  });

  it("shows activity details instead of the generic no-conflicts message", () => {
    expect(route).toContain("Activity conflict — choose how to handle the incoming event payment");
    expect(route).toContain("planned net donation");
    expect(dialog).toContain("Existing payment");
    expect(dialog).toContain("Incoming payment");
    expect(dialog).toContain("Registration fee");
    expect(dialog).toContain("Planned net donation");
  });

  it("offers only the safe payment action in the activity dialog", () => {
    expect(dialog).toContain("Keep existing payment; skip incoming activity");
    expect(dialog).not.toContain("Different people");
    expect(dialog).not.toContain("Use incoming");
  });

  it("retains set-aside and discard handling", () => {
    expect(route).toContain('status: "skipped"');
    expect(route).toContain("discard.mutate({");
  });
});
