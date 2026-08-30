import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildActivityPlan } from "@/lib/import-activity-plan";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260829000300_fix_interaction_note_lookup.sql", import.meta.url),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

describe("F14 zero-amount fallback note", () => {
  it("plans no donation and preserves the note without a review issue", () => {
    const plan = buildActivityPlan({
      row: {
        first_name: "F14",
        last_name: "NoteOnly",
        email: "m2f.f14@example.test",
        amount: "0",
        date: "2026-08-29",
        notes: "Called to discuss sponsorship",
      },
      effectiveDate: "2026-08-29",
      eventDecision: { kind: "ignore" },
    });
    expect(plan).toMatchObject({
      grossPaymentCents: 0,
      netDonationCents: 0,
      donationIntent: false,
      attendanceIntent: false,
      fingerprint: null,
      notes: "Called to discuss sponsorship",
      blockingIssues: [],
    });
  });

  it("sends no donation and uses the exact fallback note payload", () => {
    const payloadBlock = importer.slice(
      importer.indexOf("let donationPayload"),
      importer.indexOf("if (personId && registrations.size"),
    );
    expect(payloadBlock).toContain("Number.isFinite(amount) && amount > 0");
    expect(payloadBlock).toContain("noteParts && !giftPlan.activityPlan.donationIntent");
    expect(payloadBlock).toContain('{ date: importDate, text: noteParts, author: "Import" }');
  });

  it("inserts the note once and creates no donation when donation payload is null", () => {
    const donationBlock = migration.slice(
      migration.indexOf("IF _donation IS NOT NULL"),
      migration.indexOf("IF _note IS NOT NULL"),
    );
    const noteBlock = migration.slice(
      migration.indexOf("IF _note IS NOT NULL"),
      migration.indexOf("v_first :="),
    );
    expect(donationBlock).toContain("INSERT INTO public.donations");
    expect(noteBlock).toContain("INSERT INTO public.interactions");
    expect(noteBlock).toContain("WHERE NOT EXISTS");
    expect(noteBlock).not.toContain("deleted_at");
  });
});
