import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

describe("M2-F registration payment preflight", () => {
  it("loads the registration fields needed before preview classification", () => {
    expect(route).toContain(
      '.select("person_id, event_id, payment_amount, fee_amount, status")',
    );
    expect(route).toContain("const previewAnalysed = useMemo(");
    expect(route).toContain("presentation: { status: \"review\" as const, reason: conflict.reason");
    expect(route).toContain("const review = previewAnalysed.reduce(");
    expect(route).toContain("Math.max(previewAnalysed.length - review, 0)");
  });

  it("uses the same conflict helper in preview and the approval race guard", () => {
    expect(route.match(/findRegistrationPaymentConflict\(/g)).toHaveLength(2);
    expect(route).toContain("eventLinkPlan.eventIds[index]");
    expect(route).toContain("giftPlan.activityPlan.grossPaymentCents");
  });

  it("queues structured registration conflict context", () => {
    expect(route).toContain('kind: "registration_payment_conflict"');
    expect(route).toContain("existing_payment_cents: paymentConflict.existingPaymentCents");
    expect(route).toContain("planned_net_donation_cents: giftPlan.activityPlan.netDonationCents");
    expect(route).toContain("donation_fingerprint: giftPlan.activityPlan.fingerprint");
  });

  it("does not let nearby-date choices override a planned explicit event", () => {
    expect(route).toContain("if (eventLinkPlan.eventIds[index]) return;");
    expect(route).toContain("const nearbyGroup = explicitEvent");
    expect(route).toContain("event_id: giftPlan.activityPlan.donationEventId");
    expect(route).not.toContain("registrations.set(nearbyGroup.event.id");
  });
});
