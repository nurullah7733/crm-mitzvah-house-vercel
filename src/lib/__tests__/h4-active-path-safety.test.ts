import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260830000200_review_retry_active_path_cleanup.sql", import.meta.url),
  "utf8",
);
const inbox = readFileSync("src/routes/_authenticated/inbox.review.tsx", "utf8");
const importer = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
const compare = readFileSync("src/components/ReviewCompareDialog.tsx", "utf8");
const reviewCreate = readFileSync("src/lib/review-create.ts", "utf8");
const reviewQuick = readFileSync("src/lib/review-quick.ts", "utf8");

describe("H4 active review safety", () => {
  it("rejects generic actions for dedicated review kinds", () => {
    expect(migration).toContain("REVIEW_DEDICATED_ACTION_REQUIRED");
    expect(migration).toContain("'registration_payment_conflict','couple_activity_owner','household_conflict'");
    expect(migration).toContain("keep_existing_registration_payment_skip_incoming_activity");
    expect(migration).toContain("_event IS NULL AND _donation IS NULL AND _note IS NULL");
  });

  it("does not replay imported contact fields onto resolved couple members", () => {
    expect(migration).toContain("CASE WHEN v_main_id IS NULL THEN jsonb_build_object");
    expect(migration).toContain("CASE WHEN v_partner_id IS NULL THEN jsonb_build_object");
    expect(migration).toMatch(/v_main_id IS NULL[\s\S]*?ELSE '\{\}'::jsonb END/);
    expect(migration).toMatch(/v_partner_id IS NULL[\s\S]*?ELSE '\{\}'::jsonb END/);
    expect(migration).toContain("public.resolve_household_at_address");
    expect(migration).toContain("REVIEW_ALREADY_FINALIZED");
  });

  it("keeps dedicated conflicts out of quick merge and generic dialogs", () => {
    expect(inbox).toContain("const dedicatedConflict = Boolean(");
    expect(inbox).toContain("!dedicatedConflict");
    expect(inbox.match(/householdConflictContext\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(inbox.match(/coupleActivityContext\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(inbox).toContain("Activity owner required");
    expect(inbox).toContain("Household conflict");
    expect(compare).toContain("candidatePersonIds");
    expect(compare).toContain("allowed.size === 0 || allowed.has(id)");
  });

  it("does not promise review-routed relatives were added", () => {
    expect(importer).toContain('a.presentation.status === "review"');
    expect(importer).toMatch(/a\.presentation\.status === "review"[\s\S]*?\? 0/);
  });

  it("quarantines dead direct-write helpers", () => {
    expect(reviewCreate.match(/LEGACY_UNSAFE_HELPER_DISABLED/g)).toHaveLength(2);
    expect(reviewQuick).toContain("LEGACY_UNSAFE_HELPER_DISABLED");
  });
});
