-- M2-I8 fix: close the live-proven claim-bound-safety bypass in the legacy,
-- pre-claim-era record_import_row_failure RPC.
--
-- LIVE QA found: an ordinary staff-authenticated client calling
-- record_import_row_failure(_batch_id, _row_number, _row_data, _message) directly can force an
-- ACTIVELY CLAIMED, mid-execution outcome (outcome='processing', a real claim_token held by a
-- real worker) straight to 'failed' — with no claim_token check, no claimant check, no lease
-- check, and no clearing of claim_token/claimed_by/claimed_at/lease_expires_at. Its UPDATE never
-- touches those four columns, so protect_import_claim_metadata's guard (which only fires when
-- attempt_count/claim_token/claimed_by/lease_expires_at change, or on a pending->processing
-- transition) never trips — the bypass is invisible to that trigger by construction, not a hole
-- in it. The row is then permanently stranded: retry_failed_import_row's own guard requires
-- those same three claim fields to already be null before it will reopen a 'failed' row.
--
-- record_import_row_failure predates the I3/I4 claim-and-lease model entirely (it was written
-- for the pre-claim single-pass importer) and has been fully superseded by the claim-bound
-- finalize_claimed_import_row_failure (I4, still the only failure finalizer the active client
-- ever calls — unchanged and untouched by this migration). The active client has zero
-- references to record_import_row_failure. The smallest safe fix is to stop granting ordinary
-- staff direct execute access to it — not to change its body, which stays available to
-- service_role for any legitimate internal/administrative use.
REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_import_row_failure(uuid, integer, jsonb, text) TO service_role;

-- assert_import_row_claim is read-only (RETURNS boolean, no UPDATE in its body) so it cannot
-- itself corrupt anything, and LIVE QA confirmed it: it only ever reports whether a claim is
-- currently valid. It carries the same hygiene gap, though — audited and confirmed zero
-- dependencies before restricting it here: no active client reference, and no other I3-I7
-- SECURITY DEFINER function calls it internally (every claim/execute/finalize function does its
-- own inline claim validation instead). Restricted alongside record_import_row_failure for
-- consistency, not because it was itself proven exploitable.
REVOKE ALL ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_import_row_claim(uuid, uuid, uuid, uuid, uuid) TO service_role;
