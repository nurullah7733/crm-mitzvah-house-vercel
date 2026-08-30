import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M2-I8 fix: LIVE QA proved an ordinary staff client calling record_import_row_failure
// directly could force an actively-claimed, mid-execution outcome to `failed` with none of
// I4/I5's claim-token/claimant/lease validation and without clearing claim_token/claimed_by/
// claimed_at/lease_expires_at — permanently stranding the row past retry_failed_import_row's
// own "claim fields must already be null" guard. The active client has zero references to it
// (confirmed by both this file and the earlier i8-orchestration-integration-audit.test.ts), so
// the fix is a grant restriction only — 20260830001600 revokes PUBLIC/anon/authenticated and
// leaves only service_role. This is a pure REVOKE/GRANT change; no function body is touched.
const fixSql = readFileSync(
  new URL("../../../supabase/migrations/20260830001600_restrict_legacy_import_rpcs.sql", import.meta.url),
  "utf8",
);
const finalizeFn = readFileSync(
  new URL("../../../supabase/migrations/20260830001300_fix_failure_claim_cleanup_guard.sql", import.meta.url),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);
const failureHelper = readFileSync(
  new URL("../import-row-failure.ts", import.meta.url),
  "utf8",
);

describe("record_import_row_failure — grant restriction", () => {
  it("PUBLIC, anon, and authenticated are all explicitly revoked", () => {
    expect(fixSql).toContain(
      "REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM PUBLIC;",
    );
    expect(fixSql).toContain(
      "REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM anon;",
    );
    expect(fixSql).toContain(
      "REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM authenticated;",
    );
  });

  it("service_role retains execute access for any legitimate internal/administrative use", () => {
    expect(fixSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) TO service_role;",
    );
  });

  it("the function body itself is not touched — this is a grants-only fix", () => {
    expect(fixSql).not.toContain("CREATE OR REPLACE FUNCTION public.record_import_row_failure");
    expect(fixSql).not.toContain("CREATE FUNCTION public.record_import_row_failure");
  });
});

describe("assert_import_row_claim — matching hygiene restriction", () => {
  it("is restricted the same way, having been confirmed dependency-free first", () => {
    expect(fixSql).toContain(
      "REVOKE ALL ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) FROM authenticated;",
    );
    expect(fixSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) TO service_role;",
    );
  });

  it("its body is untouched too", () => {
    expect(fixSql).not.toContain("CREATE OR REPLACE FUNCTION public.assert_import_row_claim");
  });
});

describe("this migration changes grants only — no I1-I7 function body is redefined", () => {
  it("contains zero CREATE (OR REPLACE) FUNCTION statements", () => {
    expect(fixSql).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION/);
  });

  it("contains zero CREATE/DROP TRIGGER statements", () => {
    expect(fixSql).not.toMatch(/CREATE\s+TRIGGER|DROP\s+TRIGGER/);
  });
});

describe("active path safety — unaffected by this fix", () => {
  it("the active client has zero references to either legacy RPC (the precondition for this fix being safe)", () => {
    expect(importer).not.toMatch(/rpc\(\s*"record_import_row_failure"/);
    expect(importer).not.toMatch(/rpc\(\s*"assert_import_row_claim"/);
  });

  it("finalize_claimed_import_row_failure remains the sole active claimed-row failure finalizer, unmodified by this fix", () => {
    expect(importer).toContain("recordImportRowFailureAndRethrow");
    expect(failureHelper).toContain('supabase.rpc("finalize_claimed_import_row_failure"');
    expect(finalizeFn).toContain("CREATE OR REPLACE FUNCTION public.finalize_claimed_import_row_failure");
    // its own claim-bound validation (untouched) still gates every legitimate failure path.
    expect(finalizeFn).toContain("v_outcome.claim_token IS DISTINCT FROM _claim_token");
    expect(finalizeFn).toContain("claim_token = NULL, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL");
  });
});
