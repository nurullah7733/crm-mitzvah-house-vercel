import { supabase } from "@/integrations/supabase/client";
import { personName } from "@/lib/names";

type MaybePgError = { code?: string; message?: string; details?: string; hint?: string };

function asPg(e: unknown): MaybePgError {
  return (e ?? {}) as MaybePgError;
}

/** Pull an email address out of a Postgres constraint message. */
function emailIn(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

/**
 * Turn a database error into a sentence a non-technical reviewer can act on.
 * Never shows constraint names, error codes or SQL.
 */
export async function friendlyDbError(e: unknown, fallback = "That didn't save."): Promise<string> {
  const err = asPg(e);
  const raw = `${err.message ?? ""} ${err.details ?? ""}`.trim();

  if (/REVIEW_STALE_PERSON/.test(raw))
    return "This contact changed after the review opened. Refresh the review and decide again; nothing was overwritten.";
  if (/REVIEW_STALE_UNDO/.test(raw))
    return "This record changed after the import update, so it cannot be undone automatically. Nothing was partially undone.";
  if (/REVIEW_(STALE|INVALID)_TRANSITION/.test(raw))
    return "This review row changed in another session. Refresh the Data Inbox and try again.";
  if (/REVIEW_ALREADY_FINALIZED/.test(raw))
    return "This review row was already resolved. Refresh the Data Inbox.";
  if (/REVIEW_TARGET_NOT_CANDIDATE|REVIEW_INVALID_PATCH_CONTRACT/.test(raw))
    return "This review decision no longer matches the queued row. Refresh it and decide again.";
  if (/REVIEW_TRANSACTION_ACTION_REQUIRED/.test(raw))
    return "This protected financial transaction cannot use a generic person action. Set it aside for financial reconciliation or discard it with a reason.";
  if (/REVIEW_DEDICATED_ACTION_REQUIRED/.test(raw))
    return "This row needs its dedicated review action. Refresh the Data Inbox and use the household, activity-owner, or payment-conflict choice shown there.";
  if (/REVIEW_STALE_HOUSEHOLD/.test(raw))
    return "This person's household changed after the screen opened. Refresh and review the household choice again; nothing was partially moved.";
  if (/REVIEW_HOUSEHOLD_TARGET_INVALID|HOUSEHOLD_(TARGET|MERGE_TARGET)_INVALID/.test(raw))
    return "That household choice no longer matches the records on screen. Refresh and choose again.";
  if (/HOUSEHOLD_RELATIONSHIP_(INVALID|REQUIRED)/.test(raw))
    return "Choose a valid household relationship before saving.";

  if (err.code === "23505") {
    const email = emailIn(raw);
    if (email) {
      const { data } = await supabase
        .from("people")
        .select("id, display_name, first_name, last_name")
        .ilike("email", email)
        .is("deleted_at", null)
        .limit(1);
      const owner = data?.[0];
      return owner
        ? `This email is already used by ${personName(owner)}. Merge the two records, or give this person their own email address.`
        : `That email address is already in use by another contact.`;
    }
    if (/donations_import_unique|donations/i.test(raw)) {
      return "This gift is already recorded — same person, amount, date and campaign. Nothing was added twice.";
    }
    if (/registrations/i.test(raw)) return "This person is already on the list for that event.";
    if (/met_source_options|tag_options|program_options/i.test(raw))
      return "That label already exists in the list.";
    return "One of these details is already used by another record.";
  }

  if (err.code === "23503")
    return "Something this record points to no longer exists — refresh the page and try again.";
  if (err.code === "23502")
    return "A required detail is missing. Fill in the highlighted field and try again.";
  if (err.code === "22P02" || err.code === "22008")
    return "A date or number wasn't in a format we could read.";
  if (err.code === "42501" || err.code === "PGRST301")
    return "You don't have permission to do that. Ask an administrator.";

  if (/duplicate key/i.test(raw)) return "One of these details is already used by another record.";

  // No internet, the backend is unreachable, or the request was cut off: the
  // wording has to point at the connection, not at the data.
  if (/failed to fetch|networkerror|network request failed|typeerror|load failed|err_(internet|network|connection|failed)|aborted|timeout/i.test(raw))
    return "We couldn't reach the database. Check the internet connection and try again — nothing was changed.";

  if (raw) {
    const cleaned = raw
      .replace(/\s*\(.*?constraint.*?\)\s*/gi, "")
      .replace(/^(TypeError|Error|AuthApiError|PostgrestError)\s*:?\s*/i, "")
      .trim();
    if (cleaned) return cleaned;
  }
  return fallback;
}

/** Show a database error as plain language via a toast-style callback. */
export async function reportDbError(e: unknown, show: (msg: string) => void, fallback?: string) {
  show(await friendlyDbError(e, fallback));
}
