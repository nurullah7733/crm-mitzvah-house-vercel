import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { throwImportLeaseError } from "@/lib/import-orchestration";

const sql = readFileSync(
  "supabase/migrations/20260830000800_import_batch_and_row_claims.sql",
  "utf8",
);
const route = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");

describe("M2-I3 batch leases and row claims", () => {
  it("atomically leases ready/processing batches and starts ready once", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_import_batch");
    expect(sql).toContain("WHERE id = _batch_id FOR UPDATE");
    expect(sql).toContain("v_batch.status NOT IN ('ready','processing')");
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("CASE WHEN status = 'ready' THEN COALESCE(started_at,v_now)");
  });

  it("renews the same owner, rejects another active owner, and permits expiry takeover", () => {
    expect(sql).toContain("v_batch.lease_owner IS DISTINCT FROM _lease_owner");
    expect(sql).toContain("v_batch.lease_expires_at > v_now");
    expect(sql).toContain("IMPORT_BATCH_LEASE_HELD");
    expect(sql).toContain("lease_owner = _lease_owner");
    expect(sql).toContain("CREATE TRIGGER protect_import_batch_lease_metadata");
    expect(sql).toContain("IMPORT_BATCH_LEASE_REQUIRED");
  });

  it("bounds lease durations and rejects terminal/reverted states", () => {
    expect(sql.match(/_lease_seconds NOT BETWEEN 15 AND 300/g)?.length).toBe(2);
    expect(sql).toContain("IMPORT_BATCH_NOT_LEASABLE");
    expect(sql).not.toContain("status IN ('completed','reverted','imported')");
  });

  it("restricts heartbeat and release to the current owner", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.heartbeat_import_batch");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.release_import_batch");
    expect(sql).toContain("IMPORT_BATCH_LEASE_LOST");
    expect(sql).toContain("SET lease_owner = NULL,lease_expires_at = NULL");
  });

  it("claims pending rows deterministically with skip-locked concurrency", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_import_rows");
    expect(sql).toContain("ORDER BY s.physical_row_number,o.id");
    expect(sql).toContain("FOR UPDATE OF o SKIP LOCKED");
    expect(sql).toContain("LIMIT _max_rows");
    expect(sql).toContain("_max_rows NOT BETWEEN 1 AND 50");
  });

  it("increments once and writes durable claimant/token metadata", () => {
    expect(sql).toContain("attempt_count = o.attempt_count + 1");
    expect(sql).toContain("claim_token = gen_random_uuid()");
    expect(sql).toContain("claimed_by = _lease_owner");
    expect(sql).toContain("lease_expires_at = v_batch.lease_expires_at");
  });

  it("reclaims only expired processing rows and never terminal rows", () => {
    expect(sql).toContain("o.outcome = 'pending'");
    expect(sql).toContain("o.outcome = 'processing' AND o.lease_expires_at IS NOT NULL");
    expect(sql).toContain("o.lease_expires_at <= v_now");
    expect(sql).toContain("o.outcome = 'processing' AS reclaimed");
    expect(sql).not.toMatch(/outcome\s+IN\s*\([^)]*created/i);
  });

  it("protects claim metadata and exposes the future token assertion contract", () => {
    expect(sql).toContain("CREATE TRIGGER protect_import_claim_metadata");
    expect(sql).toContain("IMPORT_CLAIM_TOKEN_REQUIRED");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.assert_import_row_claim");
    expect(sql).toContain("IMPORT_ROW_CLAIM_LOST");
    expect(sql).toContain("claim_token = _claim_token AND claimed_by = _claimed_by");
  });

  it("uses staff authorization on every public I3 RPC", () => {
    expect(sql.match(/IMPORT_STAFF_REQUIRED/g)?.length).toBe(5);
    for (const fn of [
      "claim_import_batch", "heartbeat_import_batch", "release_import_batch",
      "claim_import_rows", "assert_import_row_claim",
    ]) expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
  });

  it("moves the browser from direct state updates to lease and claim RPCs", () => {
    expect(route).toContain('supabase.rpc("claim_import_batch"');
    expect(route).toContain('supabase.rpc("heartbeat_import_batch"');
    expect(route).toContain('supabase.rpc("claim_import_rows"');
    expect(route).toContain('supabase.rpc("release_import_batch"');
    expect(route).not.toContain('.update({ outcome: "processing", attempt_count: 1 })');
    expect(route).not.toContain('.eq("outcome", "pending")');
  });

  it("turns lease contention/loss into clear interrupted orchestration errors", () => {
    expect(() => throwImportLeaseError({ message: "IMPORT_BATCH_LEASE_HELD" })).toThrow(
      "already running in another session",
    );
    expect(() => throwImportLeaseError({ message: "IMPORT_BATCH_LEASE_LOST" })).toThrow(
      "no longer owns the execution lease",
    );
  });
});
