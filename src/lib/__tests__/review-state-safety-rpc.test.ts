import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260829000500_review_state_stale_write_safety.sql",
    import.meta.url,
  ),
  "utf8",
);
const route = readFileSync(
  new URL("../../routes/_authenticated/inbox.review.tsx", import.meta.url),
  "utf8",
);
const quick = readFileSync(new URL("../review-quick.ts", import.meta.url), "utf8");

const section = (start: string, end?: string) => {
  const from = sql.indexOf(start);
  const to = end ? sql.indexOf(end, from + start.length) : sql.length;
  return sql.slice(from, to < 0 ? sql.length : to);
};

describe("H2 review state and stale-write SQL", () => {
  it("locks, authorizes, and finalizes a decision only from pending", () => {
    const body = section("CREATE OR REPLACE FUNCTION public.log_review_decision", "CREATE OR REPLACE FUNCTION public.transition_review_status");
    expect(body).toContain("public.has_role(auth.uid(), 'admin')");
    expect(body).toContain("WHERE id = _item_id FOR UPDATE");
    expect(body).toContain("v_review.status <> 'pending'");
    expect(body).toContain("REVIEW_ALREADY_FINALIZED");
    expect(body.indexOf("REVIEW_ALREADY_FINALIZED")).toBeLessThan(body.indexOf("INSERT INTO public.audit_log"));
  });

  it("requires expected current values for quick/manual patches", () => {
    const body = section("CREATE OR REPLACE FUNCTION public.resolve_review_merge_core", "CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge");
    expect(body).toContain("__h2_expected");
    expect(body).toContain("to_jsonb(v_person)->v_key IS DISTINCT FROM v_expected->v_key");
    expect(body).toContain("REVIEW_STALE_PERSON");
    expect(body.indexOf("REVIEW_STALE_PERSON")).toBeLessThan(body.indexOf("UPDATE public.people SET"));
  });

  it("rejects a tampered candidate and patch field", () => {
    expect(sql).toContain("NOT (_person_id = ANY(v_review.candidate_person_ids))");
    expect(sql).toContain("REVIEW_TARGET_NOT_CANDIDATE");
    expect(sql).toContain("v_allowed text[]");
    expect(sql).toContain("REVIEW_INVALID_PATCH_CONTRACT");
  });

  it("blocks every protected G3 transaction condition from generic merge/create", () => {
    for (const kind of [
      "transaction_contradiction",
      "legacy_transaction",
      "soft_deleted_transaction",
      "transaction_concurrency_conflict",
    ]) expect(sql.match(new RegExp(`'${kind}'`, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("REVIEW_TRANSACTION_ACTION_REQUIRED");
    expect(route).toContain("!transactionConflict && <Button");
    expect(route).toContain("Generic merge and");
  });

  it("uses an authorized compare-and-swap transition boundary", () => {
    const body = section("CREATE OR REPLACE FUNCTION public.transition_review_status", "CREATE OR REPLACE FUNCTION public.resolve_review_merge_core");
    expect(body).toContain("WHERE id = _item_id FOR UPDATE");
    expect(body).toContain("v_review.status IS DISTINCT FROM _expected_status");
    expect(body).toContain("REVIEW_STALE_TRANSITION");
    expect(body).toContain("REVIEW_INVALID_TRANSITION");
    expect(route).not.toContain('.update({ status: "skipped"');
  });

  it("undo validates person and activity snapshots before any reversal", () => {
    const body = section("CREATE OR REPLACE FUNCTION public.undo_review_quick_merge");
    expect(body).toContain("REVIEW_STALE_UNDO");
    expect(body).toContain("to_jsonb(v_person)->v_key IS DISTINCT FROM v_after->v_key");
    expect(body).toContain("v_current IS DISTINCT FROM _undo_token->'donation_after'");
    expect(body).toContain("v_current IS DISTINCT FROM _undo_token->'registration_after'");
    expect(body).toContain("v_current IS DISTINCT FROM _undo_token->'note_after'");
    const firstMutation = body.indexOf("UPDATE public.people SET");
    expect(firstMutation).toBeGreaterThan(body.indexOf("v_current IS DISTINCT FROM _undo_token->'note_after'"));
    expect(body).toContain("review_quick_merge_undone");
  });

  it("replaces destructive client undo with one RPC", () => {
    const undo = quick.slice(quick.indexOf("export async function undoQuickMerge"), quick.indexOf("export async function transitionReviewStatus"));
    expect(undo).toContain('supabase.rpc("undo_review_quick_merge"');
    expect(undo).not.toContain('.from("donations")');
    expect(undo).not.toContain('.from("registrations")');
    expect(undo).not.toContain('.from("interactions")');
    expect(undo).not.toContain('.from("review_queue")');
  });

  it("preserves the shared M2-F/G activity core", () => {
    const body = section("CREATE OR REPLACE FUNCTION public.resolve_review_merge_core", "CREATE OR REPLACE FUNCTION public.resolve_review_quick_merge");
    expect(body).toContain("public.apply_import_activity_core(");
    expect(body).not.toContain("INSERT INTO public.donations");
    expect(body).not.toContain("UPDATE public.registrations SET");
  });
});
