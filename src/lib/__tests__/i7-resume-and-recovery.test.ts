import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M2-I7: audit found the active execution loop asserts `claimedRow.row_number === index + 1`
// on every claim, so re-uploading the same file to resume a partially-completed batch throws
// immediately the moment any earlier row is already terminal — resume was impossible, not just
// unsupported. It also found the in-file duplicate/couple detection (loopSeen,
// databasePersonByLogicalId) is built incrementally as rows are visited, so rows that finished
// in a PRIOR session would silently never be (re)registered on a resumed pass. These tests pin
// both fixes, plus the new discovery/recovery surface, using the same static-source-assertion
// convention the rest of this migration series uses (there is no local database in this test
// environment).
const sql = readFileSync(
  new URL("../../../supabase/migrations/20260830001500_resumable_import_discovery.sql", import.meta.url),
  "utf8",
);
const importer = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);

function slice(source: string, from: string, to?: string) {
  const start = source.indexOf(from);
  if (start === -1) throw new Error(`marker not found: ${from}`);
  const searchFrom = start + from.length;
  const end = to ? source.indexOf(to, searchFrom) : source.length;
  return source.slice(start, end === -1 ? undefined : end);
}

const discoveryFn = slice(sql, "CREATE OR REPLACE FUNCTION public.find_active_import_batch");

describe("find_active_import_batch — discovery contract", () => {
  it("requires active staff before reading anything", () => {
    const authIdx = discoveryFn.indexOf("IMPORT_STAFF_REQUIRED");
    const selectIdx = discoveryFn.indexOf("SELECT * INTO v_batch");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(selectIdx);
  });

  it("offers staging, ready, and processing batches as resumable", () => {
    expect(discoveryFn).toContain("status IN ('staging', 'ready', 'processing', 'needs_attention')");
  });

  it("never offers completed, reverted, or imported batches", () => {
    const whereClause = discoveryFn.slice(
      discoveryFn.indexOf("WHERE status IN"),
      discoveryFn.indexOf("ORDER BY"),
    );
    expect(whereClause).not.toContain("completed");
    expect(whereClause).not.toContain("reverted");
    expect(whereClause).not.toContain("'imported'");
  });

  it("labels needs_attention distinctly from resumable — never conflated as still-processing", () => {
    expect(discoveryFn).toContain(
      "'kind', CASE WHEN v_batch.status = 'needs_attention' THEN 'needs_attention' ELSE 'resumable' END",
    );
  });

  it("returns the authoritative I6 progress summary, not a separately reconstructed count", () => {
    expect(discoveryFn).toContain("'progress', public.import_batch_progress(v_batch.id)");
  });

  it("is purely read-only — it can never invent a second active batch", () => {
    expect(discoveryFn).not.toMatch(/INSERT INTO|UPDATE public\.import_batches|DELETE FROM/);
  });

  it("is staff-gated at the grant level too, matching the rest of the I3-I6 RPC surface", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.find_active_import_batch() FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.find_active_import_batch() TO authenticated, service_role;");
  });
});

describe("client — resume loop no longer crashes on an already-terminal row", () => {
  it("fetches durable outcomes right after the batch lease is (re)acquired, before the claim loop", () => {
    const claimIdx = importer.indexOf('rpc("claim_import_batch"');
    const outcomesIdx = importer.indexOf('.from("import_row_outcomes")\n        .select("row_number, outcome, person_id, result")');
    const loopIdx = importer.indexOf("for (let index = 0; index < analysed.length; index++) {");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(outcomesIdx).toBeGreaterThan(claimIdx);
    expect(outcomesIdx).toBeLessThan(loopIdx);
  });

  it("terminalRowNumbers covers exactly created/matched/flagged/failed — never pending or processing", () => {
    const block = slice(importer, "const terminalRowNumbers = new Set(", ");");
    expect(block).toContain('o.outcome === "created"');
    expect(block).toContain('o.outcome === "matched"');
    expect(block).toContain('o.outcome === "flagged"');
    expect(block).toContain('o.outcome === "failed"');
    expect(block).not.toContain('o.outcome === "pending"');
    expect(block).not.toContain('o.outcome === "processing"');
  });

  it("the loop skips already-terminal rows instead of asserting strict claim order against them", () => {
    const loop = slice(
      importer,
      "for (let index = 0; index < analysed.length; index++) {",
      "activeClaimedRow = claimedRow;",
    );
    expect(loop).toContain("if (terminalRowNumbers.has(index + 1)) continue;");
    // the skip-check must run before any claim_import_rows call for this index
    expect(loop.indexOf("terminalRowNumbers.has(index + 1)")).toBeLessThan(
      loop.indexOf('rpc("claim_import_rows"'),
    );
  });

  it("the residual out-of-order assertion still exists as a concurrency safety net, with a clearer message", () => {
    expect(importer).toContain(
      "could not be claimed in source order (it may be actively processing in another tab)",
    );
  });
});

describe("client — in-file duplicate/couple detection is seeded for rows finished in an earlier session", () => {
  it("replays matchRowOnce for every already-terminal row before the claim loop runs", () => {
    const seedBlock = slice(
      importer,
      "// Resuming: replay identity/couple registration for rows that are already terminal",
      "/** Resolve fee allocation once",
    );
    expect(seedBlock).toContain("if (!terminalRowNumbers.has(outcome.row_number)) continue;");
    expect(seedBlock).toContain("matchRowOnce(item.values, livePeople, loopSeen, idx);");
    const seedIdx = importer.indexOf(seedBlock.slice(0, 40));
    const loopIdx = importer.indexOf("for (let index = 0; index < analysed.length; index++) {");
    expect(seedIdx).toBeLessThan(loopIdx);
  });

  it("also re-links already-created people (and their couple partner) to the file's logical identities", () => {
    const seedBlock = slice(
      importer,
      "// Resuming: replay identity/couple registration for rows that are already terminal",
      "/** Resolve fee allocation once",
    );
    expect(seedBlock).toContain("databasePersonByLogicalId.set(logicalMain.id, outcome.person_id);");
    expect(seedBlock).toContain('const spouseId = (outcome.result as Record<string, unknown> | null)?.["spouse_id"];');
    expect(seedBlock).toContain("databasePersonByLogicalId.set(logicalPartner.id, spouseId);");
  });
});

describe("client — durable failed-row visibility and deferred retry after reload", () => {
  it("refreshActiveBatch reads failed rows from import_row_outcomes, not from any in-memory array", () => {
    const fn = slice(importer, "async function refreshActiveBatch()", "useEffect(() => {\n    void refreshActiveBatch();");
    expect(fn).toContain('.eq("outcome", "failed")');
    expect(fn).toContain('.from("import_row_outcomes")');
  });

  it("old-row retry only queues (retry_failed_import_row) — it never fabricates or replays an execution decision", () => {
    const fn = slice(importer, "async function queueOldFailedRowForRetry", "function resumeActiveBatch");
    expect(fn).toContain("retryFailedImportRow(");
    expect(fn).not.toContain('rpc("execute_claimed_import_row"');
    expect(fn).not.toContain('rpc("resolve_import_row"');
    expect(fn).not.toContain(".from(\"import_row_outcomes\").update(");
  });

  it("a successful queue-for-retry refreshes authoritative progress instead of a locally-updated count", () => {
    const fn = slice(importer, "async function queueOldFailedRowForRetry", "function resumeActiveBatch");
    expect(fn).toContain("await refreshActiveBatch();");
  });

  it("created/matched rows never appear in either failed-row list — both are populated only from `outcome === failed`", () => {
    expect(importer).toContain('.eq("outcome", "failed")');
    // the in-session panel (I5) is populated only inside the failure catch branch — unchanged by I7.
    const catchBlock = slice(importer, "} catch (rowError) {", "// Let the browser breathe");
    expect(catchBlock).toContain("retryableFailures.push(");
  });

  it("a flagged/needs_attention batch offers Review Issues, not a generic failed-row retry, for its flagged rows", () => {
    const banner = slice(importer, '{activeBatch.kind === "needs_attention" && activeBatch.progress.flagged_count > 0 && (', ")}");
    expect(banner).toContain('to="/inbox/review"');
    expect(banner).not.toContain("Queue for Retry");
  });
});

describe("client — Start Over reuses the existing safe revert path, admin-gated", () => {
  it("calls the same undo_import RPC ImportHistory's existing Undo action already uses — no new revert mechanism", () => {
    const fn = slice(importer, "async function startOverActiveBatch", "function resumeActiveBatch");
    expect(fn).toContain('rpc("undo_import"');
    expect(importer.match(/rpc\("undo_import"/g)?.length).toBe(2); // ImportHistory's existing call + this one
  });

  it("is gated the same way as the existing admin-only Undo action", () => {
    const banner = slice(importer, "{activeBatch && (", "{failedRetryRows.length > 0 && (");
    expect(banner).toContain("{isAdmin && (");
    expect(banner).toContain("Start Over");
  });

  it("does not add any destructive mechanism beyond the existing, already-reviewed undo_import", () => {
    const fn = slice(importer, "async function startOverActiveBatch", "function resumeActiveBatch");
    expect(fn).not.toMatch(/DELETE FROM|\.delete\(\)/);
  });
});

describe("client — I7 stays out of the terminal-status-write and background-worker territory", () => {
  it("no I7 addition writes import_batches directly — reconcile_import_batch remains the only path", () => {
    expect(importer).not.toMatch(/from\("import_batches"\)\s*\n?\s*\.update\(/);
  });

  it("resume still goes through begin_or_resume_import_batch for identity — no parallel batch-creation path was added", () => {
    expect(importer).toContain('"begin_or_resume_import_batch"');
    expect((importer.match(/"begin_or_resume_import_batch"/g) ?? []).length).toBe(1);
  });

  it("reconciliation and lease release after a resumed run are unchanged — still present exactly once each in the main run", () => {
    expect((importer.match(/\(supabase\.rpc as any\)\("reconcile_import_batch"/g) ?? []).length).toBe(2); // main run + finalizeBatchAfterRetries
    expect(importer).toContain('rpc("release_import_batch"');
  });

  it("no worker/queue/cron/background-processing surface was introduced", () => {
    expect(importer.toLowerCase()).not.toMatch(/background.?worker|job.?queue|cron\.schedule|pg_cron/);
  });

  it("the discovery banner is a single most-recent batch, not a list/dashboard", () => {
    expect(importer).toContain("const [activeBatch, setActiveBatch] = useState<ActiveImportBatch | null>(null);");
    expect(importer).not.toContain("activeBatches");
  });
});
