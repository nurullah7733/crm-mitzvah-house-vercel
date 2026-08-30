import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportOrchestrationContext } from "@/lib/import-orchestration";

const sql = readFileSync(
  "supabase/migrations/20260830000600_resumable_import_state_foundation.sql",
  "utf8",
);
const route = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");

describe("M2-I1 resumable import state foundation", () => {
  it("defines canonical batch states while retaining historical imported rows", () => {
    expect(sql).toContain(
      "'staging','ready','processing','needs_attention','completed','reverted','imported'",
    );
    expect(sql).toContain("NOT VALID");
    expect(sql).toContain("ALTER COLUMN status SET DEFAULT 'staging'");
  });

  it("defines pending, processing, and current terminal row states", () => {
    expect(sql).toContain("'pending','processing','created','matched','flagged','failed'");
    expect(sql).toContain("import_row_outcomes_terminal_completion");
  });

  it("seeds new rows pending and transitions the current loop to processing", () => {
    expect(route).toContain('supabase.rpc("stage_import_rows"');
    expect(
      readFileSync(
        "supabase/migrations/20260830000700_atomic_import_begin_and_staging.sql",
        "utf8",
      ),
    ).toContain("'pending'");
    expect(route).toContain('supabase.rpc("claim_import_rows"');
    expect(readFileSync("supabase/migrations/20260830000800_import_batch_and_row_claims.sql", "utf8"))
      .toContain("attempt_count = o.attempt_count + 1");
    expect(route).toContain("claimedRow.row_number !== index + 1");
    expect(route).toContain("could not be claimed in source order");
  });

  it("binds each future outcome to exactly one staged row in the same batch", () => {
    expect(sql).toContain("FOREIGN KEY (staged_row_id, batch_id)");
    expect(sql).toContain("REFERENCES public.import_staged_rows(id, batch_id)");
    expect(sql).toContain("CREATE UNIQUE INDEX import_row_outcomes_staged_row_unique");
    expect(
      readFileSync(
        "supabase/migrations/20260830000700_atomic_import_begin_and_staging.sql",
        "utf8",
      ),
    ).toContain("VALUES (_batch_id,v_row_number,v_staged_id");
  });

  it("provides attempt, claim, lease, completion, error, and structured result metadata", () => {
    for (const column of [
      "attempt_count",
      "claim_token",
      "claimed_by",
      "claimed_at",
      "lease_expires_at",
      "completed_at",
      "last_error",
      "result jsonb",
    ])
      expect(sql).toContain(column);
    expect(sql).toContain("CHECK (attempt_count >= 0)");
  });

  it("serializes only durable approved orchestration choices", () => {
    const context = buildImportOrchestrationContext({
      effectiveDate: "2026-08-30",
      sourceSystem: "donorbox",
      sourceConfidence: "explicit",
      transactionObjectType: "donation",
      eventDecisions: { gala: { action: "create" } },
      addressDecisions: {},
      giftEventDecisions: { event_1: "gift_only" },
      bulkTarget: { eventId: "event_1", program: "Program", tag: "Tag" },
      repeatedFileConfirmed: true,
      manualHeaderRiskConfirmed: false,
    });
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
    expect(context).toMatchObject({
      version: 1,
      effective_date: "2026-08-30",
      source_namespace: { source_system: "donorbox", transaction_object_type: "donation" },
      approvals: { repeated_file_confirmed: true },
    });
    expect(context).not.toHaveProperty("file");
    expect(context).not.toHaveProperty("credentials");
  });

  it("keeps historical outcome binding nullable but requires new active imports to bind", () => {
    expect(sql).toContain("Nullable only for historical outcomes created before M2-I1");
    expect(route).toContain('supabase.rpc("stage_import_rows"');
  });

  it("updates failure logging for pending rows and terminal metadata", () => {
    expect(sql).toContain("outcome IN ('pending','processing','failed')");
    expect(sql).toContain("completed_at = now()");
    expect(sql).toContain("last_error = EXCLUDED.last_error");
  });
});
