import { describe, expect, it } from "vitest";
import {
  findRegistrationPaymentConflict,
  isRegistrationPaymentConflict,
  registrationPaymentConflictContext,
} from "@/lib/registration-payment-conflict";

describe("registration payment conflict", () => {
  it("blocks a changed existing payment using canonical cents", () => {
    expect(findRegistrationPaymentConflict("100.00", 12500)).toMatchObject({
      kind: "registration_payment_conflict",
      existingPaymentCents: 10000,
      incomingPaymentCents: 12500,
    });
    expect(findRegistrationPaymentConflict("100.00", 12500)?.reason).toContain(
      "Registration payment conflict",
    );
  });

  it("allows the same numeric payment", () => {
    expect(findRegistrationPaymentConflict(100, 10000)).toBeNull();
  });

  it("allows a blank incoming payment without overwriting stored payment", () => {
    expect(findRegistrationPaymentConflict("100.00", null)).toBeNull();
  });

  it("treats stored decimal text and incoming canonical cents as equal", () => {
    expect(findRegistrationPaymentConflict("100.00", 10000)).toBeNull();
  });

  it("reads structured review context without re-parsing money", () => {
    const context = {
      kind: "registration_payment_conflict" as const,
      person_id: "person-1",
      registration_id: "registration-1",
      event_id: "event-1",
      event_name: "Dinner",
      existing_payment_cents: 10000,
      incoming_payment_cents: 12500,
      fee_cents: 2500,
      planned_net_donation_cents: 10000,
      donation_fingerprint: "gift-key",
    };
    expect(registrationPaymentConflictContext({ review_context: context }, "")).toEqual(context);
  });

  it("adapts an already-queued reason-only conflict", () => {
    const row = { amount: "125", event_name: "Dinner", activity_event_id: "event-1" };
    expect(isRegistrationPaymentConflict(row, "Registration payment conflict: existing $100.00, incoming $125.00.")).toBe(true);
    expect(registrationPaymentConflictContext(
      row,
      "Registration payment conflict: existing $100.00, incoming $125.00.",
      { personId: "person-1", registrationId: "registration-1", eventId: "event-1", eventName: "Dinner", feeAmount: "25.00" },
    )).toMatchObject({
      existing_payment_cents: 10000,
      incoming_payment_cents: 12500,
      fee_cents: 2500,
      planned_net_donation_cents: 10000,
    });
  });
});
