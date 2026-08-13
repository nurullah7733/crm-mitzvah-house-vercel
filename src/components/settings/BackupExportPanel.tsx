import { useState } from "react";
import { Download, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { csvText, downloadBlob, stamp } from "@/lib/csv";
import { makeZip, type ZipEntry } from "@/lib/zip";
import { logChange } from "@/lib/session-log";
import { Button } from "@/components/ui/button";

/**
 * Full-data backup export.
 *
 * The order below is LOAD order: every table comes after the tables it points
 * at, so the files can be loaded into a fresh database from top to bottom
 * without a single foreign-key error. Do not reorder without checking the
 * foreign keys.
 */
type Step = {
  table: string;
  label: string;
  order: string;
  /** Columns to sort by so exports are stable and diffable. */
};

const STEPS: Step[] = [
  { table: "households", label: "Households", order: "created_at" },
  { table: "import_batches", label: "Import batches", order: "created_at" },
  { table: "campaigns", label: "Campaigns", order: "created_at" },
  { table: "events", label: "Events", order: "date" },
  { table: "people", label: "People", order: "created_at" },
  { table: "contact_methods", label: "Phone numbers & emails", order: "created_at" },
  { table: "grants", label: "Grants", order: "created_at" },
  { table: "donations", label: "Donations", order: "date" },
  { table: "interactions", label: "Interactions (timeline)", order: "date" },
  { table: "registrations", label: "Event registrations", order: "created_at" },
  { table: "tasks", label: "Tasks", order: "created_at" },
  { table: "yahrzeits", label: "Yahrzeits", order: "created_at" },
  { table: "field_sources", label: "Field sources", order: "created_at" },
  { table: "met_source_options", label: "Where we met (list)", order: "label" },
  { table: "program_options", label: "Programs (list)", order: "label" },
  { table: "tag_options", label: "Tags (list)", order: "label" },
  { table: "staff_members", label: "Staff", order: "created_at" },
];

type Result = { label: string; table: string; rows: number; file: string; error?: string };

export function BackupExportPanel() {
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  async function runExport() {
    setBusy(true);
    setResults(null);
    const day = stamp();
    const out: Result[] = [];
    const files: ZipEntry[] = [];

    try {
      for (let i = 0; i < STEPS.length; i += 1) {
        const step = STEPS[i]!;
        setCurrent(step.label);
        const file = `${String(i + 1).padStart(2, "0")}-${step.table}-${day}.csv`;
        try {
          const rows = await fetchAll<Record<string, unknown>>((from, to) =>
            supabase
              .from(step.table as never)
              .select("*")
              .order(step.order, { ascending: true })
              .range(from, to),
          );
          // An empty table still gets a header-only file, so the person
          // restoring can see nothing was skipped.
          files.push({ file, text: csvText(rows.length > 0 ? rows : [{ note: "no rows" }]) } as never as ZipEntry);
          files[files.length - 1] = { name: file, text: csvText(rows.length > 0 ? rows : [{ note: "no rows" }]) };
          out.push({ label: step.label, table: step.table, rows: rows.length, file });
        } catch (e) {
          out.push({
            label: step.label,
            table: step.table,
            rows: 0,
            file,
            error: e instanceof Error ? e.message : "Could not export",
          });
        }
      }

      // A manifest so anyone reloading the data knows the order to use.
      setCurrent("Backup summary");
      files.unshift({
        name: `00-READ-ME-load-order-${day}.csv`,
        text: csvText(
          out.map((r, i) => ({
          load_order: i + 1,
          file: r.file,
          table: r.table,
          what_it_is: r.label,
          rows: r.rows,
          status: r.error ? `FAILED: ${r.error}` : "ok",
        })),
        ),
      });

      // One single .zip download — browsers block a burst of separate saves.
      downloadBlob(`mitzvah-house-backup-${day}.zip`, makeZip(files));

      setResults(out);
      const failed = out.filter((r) => r.error);
      if (failed.length === 0) {
        const total = out.reduce((sum, r) => sum + r.rows, 0);
        toast.success(
          `Backup saved — mitzvah-house-backup-${day}.zip (${out.length} files, ${total.toLocaleString()} rows)`,
        );
        logChange("Downloaded a full data backup");
      } else {
        toast.error(`${failed.length} of ${out.length} files could not be exported`);
      }
    } finally {
      setCurrent(null);
      setBusy(false);
    }
  }

  const failedCount = results?.filter((r) => r.error).length ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Downloads everything in the CRM as spreadsheet files — people, households, donations, events,
        tasks, timeline notes, grants and your shared lists. The files are numbered in the order they
        would be loaded back in, and a “READ ME” file lists them all. Everything arrives as one
        <span className="font-medium"> .zip</span> file in your Downloads folder — double-click it to
        see the spreadsheets. Keep a copy somewhere safe before any big import.
      </p>

      <Button onClick={runExport} disabled={busy} className="h-11 rounded-xl">
        <Download className="mr-2 h-4 w-4" />
        {busy ? `Exporting ${current ?? ""}…` : "Download a full backup"}
      </Button>

      {busy && (
        <p className="text-xs text-muted-foreground">
          Gathering your data — this takes about half a minute, then one .zip file will be saved.
          Please don't leave this page until it finishes.
        </p>
      )}

      {results && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div
            className={`flex items-center gap-2 px-4 py-3 text-sm ${
              failedCount === 0 ? "bg-money/10 text-money" : "bg-urgent/10 text-urgent"
            }`}
          >
            {failedCount === 0 ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span className="font-medium">
              {failedCount === 0
                ? `${results.length} files zipped — ${results
                    .reduce((sum, r) => sum + r.rows, 0)
                    .toLocaleString()} rows in total`
                : `${failedCount} file${failedCount === 1 ? "" : "s"} failed — try again`}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {results.map((r) => (
              <li key={r.table} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate text-foreground">{r.label}</span>
                <span className={r.error ? "text-urgent" : "text-muted-foreground"}>
                  {r.error ? r.error : `${r.rows.toLocaleString()} rows`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}