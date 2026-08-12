import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UploadCloud, FileSpreadsheet } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox | Mitzvah House CRM" },
      {
        name: "description",
        content: "Review spreadsheet and platform uploads before they enter the Mitzvah House database.",
      },
      { property: "og:title", content: "Inbox | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Review spreadsheet and platform uploads before they enter the Mitzvah House database.",
      },
    ],
  }),
  component: InboxPage,
});

type Parsed = { name: string; headers: string[]; rows: string[][] };

function splitCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function InboxPage() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!/\.csv$/i.test(file.name)) {
      setParsed(null);
      setError("Please save the sheet as a CSV file first (File → Download → CSV), then upload it here.");
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setParsed(null);
      setError("That file looks empty — we need a header row plus at least one row of data.");
      return;
    }
    setParsed({
      name: file.name,
      headers: splitCsvLine(lines[0] ?? ""),
      rows: lines.slice(1).map(splitCsvLine),
    });
  }

  return (
    <AppShell title="Inbox" subtitle="Spreadsheet and platform uploads waiting to be reviewed">
      <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center shadow-sm">
        <UploadCloud className="mx-auto size-8 text-primary" />
        <p className="mt-3 font-heading font-semibold text-foreground">Upload a spreadsheet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Drop in a CSV export from Donorbox, Constant Contact, Cognito Forms, QuickBooks or Google Sheets. Nothing is
          saved to the database until it is reviewed and approved here.
        </p>
        <label className="mt-4 inline-block">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-base font-medium text-primary-foreground">
            <FileSpreadsheet className="size-4" /> Choose a file
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-4 rounded-2xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">{error}</p>
      )}

      {!parsed && !error && (
        <div className="mt-5">
          <EmptyState label="No uploads waiting for review." />
        </div>
      )}

      {parsed && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading font-semibold text-foreground">{parsed.name}</h2>
              <p className="text-sm text-muted-foreground">
                {parsed.rows.length} rows · {parsed.headers.length} columns · awaiting review
              </p>
            </div>
            <Button variant="outline" className="rounded-xl" onClick={() => setParsed(null)}>
              Discard
            </Button>
          </div>
          <div className="mt-4 -mx-5 overflow-x-auto px-5">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  {parsed.headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap border-b border-border pb-2 pr-5 text-xs text-muted-foreground">
                      {h || `Column ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 25).map((r, ri) => (
                  <tr key={ri}>
                    {parsed.headers.map((_, ci) => (
                      <td key={ci} className="whitespace-nowrap border-b border-border py-2 pr-5 text-foreground">
                        {r[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 25 && (
            <p className="mt-3 text-xs text-muted-foreground">Showing the first 25 of {parsed.rows.length} rows.</p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Next step: matching these columns to people and approving the import into the database.
          </p>
        </section>
      )}
    </AppShell>
  );
}