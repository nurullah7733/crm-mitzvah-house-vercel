import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260828000200_fix_couple_activity_household_resolution.sql",
    import.meta.url,
  ),
  "utf8",
);
const client = readFileSync("src/lib/review-couple-activity.ts", "utf8");
const route = readFileSync("src/routes/_authenticated/inbox.review.tsx", "utf8");

describe("transactional couple activity review", () => {
  it("locks and validates the structured pending review item and explicit owner", () => {
    expect(sql).toContain("WHERE id = _item_id FOR UPDATE");
    expect(sql).toContain("v_review.status <> 'pending'");
    expect(sql).toContain("_owner NOT IN ('main', 'partner')");
    expect(sql).toContain("couple_activity_owner");
  });

  it("resolves both people through the existing import transaction", () => {
    expect(sql).toContain("public.resolve_import_row(");
    expect(sql).toContain("CASE WHEN v_main_id IS NULL THEN 'create' ELSE 'update' END");
    expect(sql).toContain("CASE WHEN v_partner_id IS NULL THEN 'create' ELSE 'update' END");
    expect(sql).toContain("Both people already belong to different households");
    expect(sql).toContain("v_main_household_id IS NOT NULL AND v_partner_household_id IS NOT NULL");
    expect(sql).toContain("COALESCE(v_main_household_id, v_partner_household_id)");
  });

  it("applies activity exactly once to the selected owner", () => {
    expect(sql).toContain("CASE WHEN _owner = 'main' THEN _activity ELSE '{}'::jsonb END");
    expect(sql).toContain("v_result->>'spouse_id'");
    expect(sql).toContain("public.apply_import_activity_core");
    expect(sql).toContain("public.log_review_decision(_item_id, 'created'");
    expect(client).toContain("registrations: event ? [event] : []");
    expect(client).not.toContain("_activity: { event, donation, note }");
  });

  it("uses the dedicated client path and never the generic review dialog", () => {
    expect(client).toContain("resolve_review_couple_activity");
    expect(route).toContain("<CoupleActivityOwnerDialog");
    expect(route).toContain("!coupleActivity");
    expect(route).toContain("<ReviewCompareDialog");
  });

  it("queues structured D8 context with both claims and activity", () => {
    const importer = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
    expect(importer).toContain('kind: "couple_activity_owner"');
    expect(importer).toContain("main_claim");
    expect(importer).toContain("partner_claim");
    expect(importer).toContain("resolved_person_id");
    expect(importer).toContain("activity,");
  });

  it("exposes explicit owner choices for the supported activity display", () => {
    const dialog = readFileSync("src/components/CoupleActivityOwnerDialog.tsx", "utf8");
    expect(dialog).toContain("Assign to");
    expect(dialog).toContain('"main", "partner"');
    expect(dialog).toContain("resolveCoupleActivity");
    expect(dialog).toContain("Set aside");
  });

  it("keeps retries idempotent and rejects already-resolved items", () => {
    expect(sql).toContain("v_review.status <> 'pending'");
    expect(sql).toContain("_decision");
    expect(sql).toContain("public.apply_import_activity_core");
    expect(sql).not.toContain("EXCEPTION WHEN OTHERS");
  });
});
