import { supabase } from "@/integrations/supabase/client";

/** Tables where "delete" means "hide, keep recoverable". */
export type ArchivableTable = "people" | "donations" | "events" | "tasks";

/**
 * Hide one or more records.
 *
 * Removed rows are invisible to reads at the database level, so the app cannot
 * write `deleted_at` directly any more — it would not be able to see the row it
 * just wrote back. This goes through one database action instead. The
 * admin-only rule and the change-history entry are unchanged.
 */
export async function archiveRecords(table: ArchivableTable, ids: string[]) {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc("archive_records", { _table: table, _ids: ids });
  if (error) throw error;
  return (data as number | null) ?? ids.length;
}

/** Bring back a removed record from the change history. */
export async function restoreRecords(table: ArchivableTable, ids: string[]) {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc("restore_records", { _table: table, _ids: ids });
  if (error) throw error;
  return (data as number | null) ?? ids.length;
}
