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
  if (raw) return raw.replace(/\s*\(.*?constraint.*?\)\s*/gi, "").trim();
  return fallback;
}

/** Show a database error as plain language via a toast-style callback. */
export async function reportDbError(e: unknown, show: (msg: string) => void, fallback?: string) {
  show(await friendlyDbError(e, fallback));
}
