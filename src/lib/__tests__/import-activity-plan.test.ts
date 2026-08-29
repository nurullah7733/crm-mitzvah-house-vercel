import { describe, expect, it } from "vitest";
import { buildActivityPlan, chooseActivityEventDecision } from "@/lib/import-activity-plan";

const person = { first_name: "Sarah", last_name: "Klein", email: "sarah@example.com" };

describe("M2-F canonical activity plan", () => {
  it("plans a plain donation and makes its exact repeat idempotent", () => {
    const row = { ...person, amount: "72.00", date: "2026-08-29" };
    const a = buildActivityPlan({ row, effectiveDate: "2026-08-29", eventDecision: { kind: "ignore" } });
    const b = buildActivityPlan({ row, effectiveDate: "2026-08-29", eventDecision: { kind: "ignore" } });
    expect(a).toMatchObject({ donationIntent: true, netDonationCents: 7200, attendanceIntent: false });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("plans attendance without inventing payment metadata", () => {
    const plan = buildActivityPlan({ row: person, effectiveDate: "2026-08-29", eventDecision: { kind: "attend", id: "e1", registrationFee: 25 } });
    expect(plan).toMatchObject({ attendanceIntent: true, grossPaymentCents: null, registrationFeeCents: 0, donationIntent: false });
  });

  it("splits an event payment and attributes its donation to the event", () => {
    const plan = buildActivityPlan({ row: { ...person, amount: "100", date: "2026-08-29" }, effectiveDate: "2026-08-29", eventDecision: { kind: "attend", id: "e1", registrationFee: 25 } });
    expect(plan).toMatchObject({ grossPaymentCents: 10000, registrationFeeCents: 2500, netDonationCents: 7500, donationEventId: "e1" });
  });

  it("campaign is designation only and never implies attendance", () => {
    const plan = buildActivityPlan({ row: { ...person, amount: "10", campaign: "Dinner" }, effectiveDate: "2026-08-29", eventDecision: { kind: "ignore" } });
    expect(plan).toMatchObject({ campaignName: "Dinner", attendanceIntent: false, eventId: null });
  });

  it("supports event and campaign together", () => {
    const plan = buildActivityPlan({ row: { ...person, amount: "100", campaign: "Annual Fund" }, effectiveDate: "2026-08-29", eventDecision: { kind: "attend", id: "e1", registrationFee: 25 } });
    expect(plan).toMatchObject({ campaignName: "Annual Fund", donationEventId: "e1", netDonationCents: 7500 });
  });

  it("does not silently discard an unresolved explicit event", () => {
    const plan = buildActivityPlan({ row: { ...person, event_name: "Unknown Dinner" }, effectiveDate: "2026-08-29" });
    expect(plan.blockingIssues).toContain("The event attendance value must be linked, created, or ignored.");
  });

  it("keeps the planned blank-date fallback stable", () => {
    const plan = buildActivityPlan({ row: { ...person, amount: "20" }, effectiveDate: "2026-08-20", eventDecision: { kind: "ignore" } });
    expect(plan.donationDate).toBe("2026-08-20");
  });

  it("blocks bad nonblank dates and preserves notes when no gift is created", () => {
    const bad = buildActivityPlan({ row: { ...person, amount: "20", date: "04/05/2026" }, effectiveDate: "2026-08-20", eventDecision: { kind: "ignore" } });
    const zero = buildActivityPlan({ row: { ...person, amount: "0", notes: "Please call" }, effectiveDate: "2026-08-20", eventDecision: { kind: "ignore" } });
    expect(bad.blockingIssues[0]).toContain("date");
    expect(zero).toMatchObject({ donationIntent: false, notes: "Please call" });
  });

  it("allows identical gifts with distinct transaction IDs and deduplicates repeats", () => {
    const make = (transaction_id: string) => buildActivityPlan({ row: { ...person, amount: "50", date: "2026-08-29", transaction_id }, effectiveDate: "2026-08-29", eventDecision: { kind: "ignore" } });
    expect(make("tx-1").fingerprint).toBe(make("tx-1").fingerprint);
    expect(make("tx-1").fingerprint).not.toBe(make("tx-2").fingerprint);
  });

  it.each(["attended", "gift_only"] as const)(
    "keeps an explicit event ahead of a nearby %s decision",
    (nearbyDecision) => {
      const eventDecision = chooseActivityEventDecision({
        explicitEvent: { id: "explicit", registration_fee: 25 },
        nearbyEvent: { id: "nearby", registration_fee: 10 },
        nearbyDecision,
      });
      const plan = buildActivityPlan({
        row: { ...person, amount: "125", date: "2026-08-29" },
        effectiveDate: "2026-08-29",
        eventDecision,
      });
      expect(plan).toMatchObject({
        eventId: "explicit",
        donationEventId: "explicit",
        attendanceIntent: true,
      });
    },
  );
});
