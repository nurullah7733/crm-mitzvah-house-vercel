import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, UserPlus, Users } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/forms/fields";
import { fetchAll } from "@/lib/fetch-all";
import {
  FIELD_LABELS,
  guessMapping,
  matchRow,
  splitFullName,
  splitName,
  splitPeopleList,
  type ColumnGuess,
  type ExistingPerson,
  type FieldKey,
  type MatchResult,
  type RowValues,
} from "@/lib/import-mapping";

export const Route = createFileRoute("/_authenticated/inbox/")({
  head: () => ({
    meta: [
      { title: "Import Center | Mitzvah House CRM" },
      {
        name: "description",
        content: "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:title", content: "Import Center | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportCenter,
});

type Sheet = { name: string; headers: string[]; rows: string[][] };

const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

async function readFile(file: File): Promise<Sheet> {
  const isCsv = /\.csv$/i.test(file.name);
  let table: string[][] = [];
  if (isCsv) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
    table = parsed.data;
  } else {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { cellDates: false });
    const first = wb.SheetNames[0];
    if (!first) throw new Error("That workbook has no sheets.");
    const ws = wb.Sheets[first]!;
    table = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  }
  const [headerRow, ...rest] = table;
  if (!headerRow || rest.length === 0) throw new Error("We need a header row plus at least one row of data.");
  return {
    name: file.name,
    headers: headerRow.map((h) => String(h ?? "").trim()),
    rows: rest.map((r) => headerRow.map((_, i) => String(r?.[i] ?? "").trim())),
  };
}

/** Unpack one spreadsheet row: the main contact, their partner, and any children on the row. */
function buildRowValues(row: string[], mapping: ColumnGuess[]): RowValues {
  const out: RowValues = {};
  const childNames: string[] = [];
  const childDobs: string[] = [];
  const childSchools: string[] = [];

  mapping.forEach((m, i) => {
    const value = row[i]?.trim();
    if (!value || m.field === "ignore") return;
    if (m.field === "child_name") {
      childNames.push(...splitPeopleList(value));
      return;
    }
    if (m.field === "child_birth_date") {
      childDobs.push(value);
      return;
    }
    if (m.field === "child_school") {
      childSchools.push(value);
      return;
    }
    if (!out[m.field]) out[m.field] = value;
  });

  if (childNames.length > 0) {
    out.children = childNames.map((name, idx) => ({
      name,
      ...(childDobs[idx] ? { birth_date: childDobs[idx]! } : {}),
      ...(childSchools[idx] ? { school: childSchools[idx]! } : {}),
    }));
  }
  return out;
}

/** Join the first / middle / last / suffix columns a file happens to have. */
function mainName(v: RowValues) {
  const base = splitName(v);
  const first = [base.first, v.middle_name].filter(Boolean).join(" ").trim();
  const last = [base.last, v.suffix].filter(Boolean).join(" ").trim();
  return { first, last };
}

function isoDate(raw: string | undefined) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function splitList(raw: string | undefined) {
  return raw ? raw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [];
}

const DRAFT_KEY = "mh-import-draft";

function ImportCenter() {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnGuess[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /** Keep the uploaded file in this browser so a refresh or a timed-out tab doesn't lose the work. */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { sheet: Sheet; mapping: ColumnGuess[] };
      if (draft?.sheet?.headers?.length) {
        setSheet(draft.sheet);
        setMapping(draft.mapping ?? guessMapping(draft.sheet.headers));
      }
    } catch {
      /* ignore a bad draft */
    }
  }, []);

  useEffect(() => {
    try {
      if (sheet) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ sheet, mapping }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* the file is too big to stash — the import still works */
    }
  }, [sheet, mapping]);

  /** Warn before leaving mid-import. */
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const { data: people } = useQuery({
    queryKey: ["import-people"],
    queryFn: async () =>
      (await fetchAll((f, t) =>
        supabase
          .from("people")
          .select("id, first_name, last_name, email, phone, household_id, households(name, address)")
          .is("deleted_at", null)
          .order("id")
          .range(f, t),
      )) as unknown as ExistingPerson[],
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["review-queue-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  const analysed = useMemo<{ row: string[]; values: RowValues; match: MatchResult }[]>(() => {
    if (!sheet || !people) return [];
    return sheet.rows.map((row) => {
      const values = buildRowValues(row, mapping);
      return { row, values, match: matchRow(values, people) };
    });
  }, [sheet, people, mapping]);

  const counts = useMemo(
    () => ({
      total: analysed.length,
      matched: analysed.filter((a) => a.match.status === "matched").length,
      new: analysed.filter((a) => a.match.status === "new").length,
      ambiguous: analysed.filter((a) => a.match.status === "ambiguous").length,
      extraPeople: analysed.reduce(
        (n, a) =>
          n +
          (a.values.children?.length ?? 0) +
          (a.values.spouse_full_name || a.values.spouse_first_name ? 1 : 0),
        0,
      ),
    }),
    [analysed],
  );

  async function handleFile(file: File) {
    setError(null);
    try {
      const parsed = await readFile(file);
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
      setAdjusting(false);
    } catch (e) {
      setSheet(null);
      setError(e instanceof Error ? e.message : "We couldn't read that file.");
    }
  }

  function reset() {
    setSheet(null);
    setMapping([]);
    setError(null);
    setProgress(null);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  async function approve() {
    if (!sheet) return;
    setBusy(true);
    setProgress({ done: 0, total: analysed.length });
    try {
      const importDate = new Date().toISOString().slice(0, 10);
      const source = `${sheet.name}, imported ${importDate}`;

      const { data: batch, error: batchError } = await supabase
        .from("import_batches")
        .insert({
          filename: sheet.name,
          import_date: importDate,
          total_rows: counts.total,
          matched_rows: counts.matched,
          new_rows: counts.new,
          ambiguous_rows: counts.ambiguous,
          status: "imported",
          mapping: mapping.reduce<Record<string, string>>((acc, m, i) => {
            acc[m.header || `Column ${i + 1}`] = m.field;
            return acc;
          }, {}),
        })
        .select("id")
        .single();
      if (batchError) throw batchError;

      const fieldSources: {
        person_id: string;
        field_name: string;
        source: string;
        recorded_date: string;
        import_batch_id: string;
      }[] = [];
      let failures = 0;

      for (let index = 0; index < analysed.length; index++) {
        const item = analysed[index]!;
        const v = item.values;

        try {
          if (item.match.status === "ambiguous") {
            await supabase.from("review_queue").insert({
              batch_id: batch.id,
              filename: sheet.name,
              reason: item.match.reason,
              row_data: v as unknown as Record<string, string>,
              candidate_person_ids: item.match.candidates.map((c) => c.id),
              status: "pending",
            });
            continue;
          }

          let personId = item.match.candidates[0]?.id ?? null;
          let householdId = item.match.candidates[0]?.household_id ?? null;
          const { first, last } = mainName(v);
          const hasFamily = Boolean(
            v.children?.length || v.spouse_full_name || v.spouse_first_name || v.household_name || v.address,
          );

          if (item.match.status === "new") {
            if (hasFamily || v.billing_address) {
              const { data: household } = await supabase
                .from("households")
                .insert({
                  name: v.household_name ?? `${last || first || "New"} household`,
                  address: v.address ?? null,
                  billing_address: v.billing_address ?? null,
                  import_batch_id: batch.id,
                })
                .select("id")
                .single();
              householdId = household?.id ?? null;
            }
            const { data: created, error: createError } = await supabase
              .from("people")
              .insert({
                first_name: first || null,
                last_name: last || null,
                email: v.email ?? null,
                phone: v.phone ?? null,
                birth_date: isoDate(v.birth_date),
                met_source: v.met_source ?? null,
                school: v.school ?? null,
                notes: v.person_notes ?? null,
                household_id: householdId,
                role: "Adult",
                tags: splitList(v.tags),
                programs: splitList(v.programs),
                import_batch_id: batch.id,
              })
              .select("id")
              .single();
            if (createError) throw createError;
            personId = created.id;
          } else if (personId) {
            const existing = item.match.candidates[0]!;
            const patch: {
              email?: string;
              phone?: string;
              birth_date?: string;
              met_source?: string;
              school?: string;
              notes?: string;
            } = {};
            if (v.email && !existing.email) patch["email"] = v.email;
            if (v.phone && !existing.phone) patch["phone"] = v.phone;
            const dob = isoDate(v.birth_date);
            if (dob) patch["birth_date"] = dob;
            if (v.met_source) patch["met_source"] = v.met_source;
            if (v.school) patch["school"] = v.school;
            if (v.person_notes) patch["notes"] = v.person_notes;
            if (Object.keys(patch).length > 0) await supabase.from("people").update(patch).eq("id", personId);

            // Existing person, new family details on the row: attach a household if they don't have one.
            if (!householdId && (v.household_name || v.address || v.billing_address || v.children?.length)) {
              const { data: household } = await supabase
                .from("households")
                .insert({
                  name: v.household_name ?? `${last || first || "New"} household`,
                  address: v.address ?? null,
                  billing_address: v.billing_address ?? null,
                  import_batch_id: batch.id,
                })
                .select("id")
                .single();
              householdId = household?.id ?? null;
              if (householdId) await supabase.from("people").update({ household_id: householdId }).eq("id", personId);
            } else if (householdId && (v.address || v.billing_address)) {
              const housePatch: { billing_address?: string } = {};
              if (v.billing_address) housePatch["billing_address"] = v.billing_address;
              if (Object.keys(housePatch).length > 0)
                await supabase.from("households").update(housePatch).eq("id", householdId);
            }
          }

          if (!personId) continue;

          // A partner on the same row becomes their own contact in the same household.
          const spouseName = v.spouse_first_name
            ? { first: v.spouse_first_name, last: v.spouse_last_name ?? last }
            : v.spouse_full_name
              ? splitFullName(v.spouse_full_name)
              : null;
          if (spouseName && (spouseName.first || spouseName.last)) {
            const already = (people ?? []).some(
              (p) =>
                (p.first_name ?? "").toLowerCase() === spouseName.first.toLowerCase() &&
                (p.last_name ?? "").toLowerCase() === (spouseName.last || last).toLowerCase(),
            );
            if (!already) {
              await supabase.from("people").insert({
                first_name: spouseName.first || null,
                last_name: spouseName.last || last || null,
                email: v.spouse_email ?? null,
                phone: v.spouse_phone ?? null,
                household_id: householdId,
                role: "Adult",
                met_source: v.met_source ?? null,
                import_batch_id: batch.id,
              });
            }
          }

          // Children listed on the row each become their own contact, linked by household.
          for (const child of v.children ?? []) {
            const cn = splitFullName(child.name);
            if (!cn.first && !cn.last) continue;
            const already = (people ?? []).some(
              (p) =>
                (p.first_name ?? "").toLowerCase() === cn.first.toLowerCase() &&
                (p.last_name ?? "").toLowerCase() === (cn.last || last).toLowerCase(),
            );
            if (already) continue;
            await supabase.from("people").insert({
              first_name: cn.first || null,
              last_name: cn.last || last || null,
              household_id: householdId,
              role: "Child",
              birth_date: isoDate(child.birth_date),
              school: child.school ?? null,
              met_source: v.met_source ?? null,
              programs: splitList(v.programs),
              import_batch_id: batch.id,
            });
          }

          for (const key of [
            "email",
            "phone",
            "address",
            "billing_address",
            "birth_date",
            "met_source",
            "school",
          ] as FieldKey[]) {
            if (v[key])
              fieldSources.push({
                person_id: personId,
                field_name: key,
                source,
                recorded_date: importDate,
                import_batch_id: batch.id,
              });
          }

          if (v.amount) {
            const amount = Number(String(v.amount).replace(/[^0-9.-]/g, ""));
            if (Number.isFinite(amount) && amount > 0) {
              await supabase.from("donations").insert({
                person_id: personId,
                amount,
                date: isoDate(v.date) ?? importDate,
                campaign: v.campaign ?? null,
                source,
                notes: v.notes ?? null,
                import_batch_id: batch.id,
              });
              await supabase.from("interactions").insert({
                person_id: personId,
                type: "donation",
                date: isoDate(v.date) ?? importDate,
                text: `Imported gift of $${amount}${v.campaign ? ` · ${v.campaign}` : ""}`,
                author: "Import",
                import_batch_id: batch.id,
              });
            }
          }

          const noteParts = [v.notes, v.person_notes ? `Note: ${v.person_notes}` : "", v.school ? `School: ${v.school}` : ""]
            .filter(Boolean)
            .join(" · ");
          if (noteParts && !v.amount) {
            await supabase.from("interactions").insert({
              person_id: personId,
              type: "form",
              date: importDate,
              text: noteParts,
              author: "Import",
              import_batch_id: batch.id,
            });
          }
        } catch (rowError) {
          failures += 1;
          console.error("Import row failed", rowError);
          await supabase.from("review_queue").insert({
            batch_id: batch.id,
            filename: sheet.name,
            reason: rowError instanceof Error ? `Couldn't import this row: ${rowError.message}` : "Couldn't import this row",
            row_data: v as unknown as Record<string, string>,
            candidate_person_ids: [],
            status: "pending",
          });
        }

        // Let the browser breathe so a long import never freezes the page.
        if (index % 10 === 9 || index === analysed.length - 1) {
          setProgress({ done: index + 1, total: analysed.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (fieldSources.length > 0) {
        for (let i = 0; i < fieldSources.length; i += 500) {
          await supabase.from("field_sources").insert(fieldSources.slice(i, i + 500));
        }
      }

      toast.success(
        `Imported ${counts.matched + counts.new - failures} rows${
          counts.extraPeople ? `, plus ${counts.extraPeople} family members` : ""
        }. ${counts.ambiguous + failures} sent to the Data Inbox for review.`,
      );
      await queryClient.invalidateQueries();
      reset();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `${e.message} — your file is still here, nothing was lost.`
          : "Import failed — your file is still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Import Center"
      subtitle="Nothing is saved until you approve it"
      action={
        <Link
          to="/inbox/review"
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary"
        >
          Data Inbox{pendingCount ? ` (${pendingCount})` : ""}
        </Link>
      }
    >
      {!sheet && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center shadow-sm">
          <UploadCloud className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-heading font-semibold text-foreground">Upload a spreadsheet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            CSV or Excel exports from Donorbox, Constant Contact, Cognito Forms, QuickBooks, Salesforce or Google
            Sheets. Names can be split, combined, or last name only — you can set that in the mapping.
          </p>
          <label className="mt-4 inline-block">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
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
      )}

      {error && <p className="mt-4 rounded-2xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">{error}</p>}

      {sheet && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">{sheet.name}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Stat icon={Users} label="Rows found" value={counts.total} tone="text-foreground" />
              <Stat icon={CheckCircle2} label="Match existing people" value={counts.matched} tone="text-money" />
              <Stat icon={UserPlus} label="Look new" value={counts.new} tone="text-primary" />
              <Stat icon={AlertTriangle} label="Need review" value={counts.ambiguous} tone="text-suggestion" />
            </div>
            {counts.extraPeople > 0 && (
              <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
                {counts.extraPeople} family member{counts.extraPeople === 1 ? "" : "s"} on these rows (partners and
                children) will each get their own contact, linked to the same household.
              </p>
            )}
            {counts.ambiguous > 0 && (
              <p className="mt-3 rounded-xl bg-suggestion/10 p-3 text-sm text-foreground">
                {counts.ambiguous} row{counts.ambiguous === 1 ? "" : "s"} will go to the Data Inbox instead of being
                imported.
              </p>
            )}
            {progress && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {busy ? "Importing" : "Finished"} {progress.done} of {progress.total} rows — keep this tab open.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-heading font-semibold text-foreground">Proposed column mapping</h2>
                <p className="text-sm text-muted-foreground">
                  Check anything marked medium or low. Child columns can be used more than once — map "Child 1", "Child
                  2" and so on all to the child fields.
                </p>
              </div>
              <Button variant="outline" className="rounded-xl" onClick={() => setAdjusting((a) => !a)}>
                {adjusting ? "Done adjusting" : "Adjust mapping"}
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {mapping.map((m, i) => (
                <div key={`${m.header}-${i}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                  <p className="truncate text-sm font-medium text-foreground">{m.header || `Column ${i + 1}`}</p>
                  {adjusting ? (
                    <select
                      className={selectClass}
                      value={m.field}
                      aria-label={`Map ${m.header}`}
                      onChange={(e) =>
                        setMapping((prev) =>
                          prev.map((row, ri) =>
                            ri === i ? { ...row, field: e.target.value as FieldKey, confidence: "high" } : row,
                          ),
                        )
                      }
                    >
                      {FIELD_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {FIELD_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {FIELD_LABELS[m.field]}
                    </p>
                  )}
                  <span
                    className={`justify-self-start rounded-full px-2.5 py-1 text-xs ${
                      m.confidence === "high"
                        ? "bg-money/15 text-money"
                        : m.confidence === "medium"
                          ? "bg-suggestion/20 text-foreground"
                          : "bg-urgent/15 text-urgent"
                    }`}
                  >
                    {m.confidence} confidence
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">First rows</h2>
            <div className="mt-3 -mx-5 overflow-x-auto px-5">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">Status</th>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">Will create</th>
                    {sheet.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap border-b border-border pb-2 pr-5 text-xs text-muted-foreground">
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysed.slice(0, 15).map((a, ri) => (
                    <tr key={ri}>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs">
                        <span
                          className={
                            a.match.status === "matched"
                              ? "text-money"
                              : a.match.status === "new"
                                ? "text-primary"
                                : "text-urgent"
                          }
                        >
                          {a.match.reason}
                        </span>
                      </td>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs text-muted-foreground">
                        {[
                          a.match.status === "new" ? "contact" : "update",
                          a.values.spouse_full_name || a.values.spouse_first_name ? "partner" : "",
                          a.values.children?.length ? `${a.values.children.length} child` : "",
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </td>
                      {sheet.headers.map((_, ci) => (
                        <td key={ci} className="whitespace-nowrap border-b border-border py-2 pr-5 text-foreground">
                          {a.row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysed.length > 15 && (
              <p className="mt-3 text-xs text-muted-foreground">Showing the first 15 of {analysed.length} rows.</p>
            )}
          </section>

          <div className="sticky bottom-24 flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm lg:bottom-4">
            <Button className="rounded-xl" disabled={busy} onClick={() => void approve()}>
              {busy ? `Importing… ${progress?.done ?? 0}/${progress?.total ?? 0}` : "Approve & import"}
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setAdjusting(true)} disabled={busy}>
              Adjust mapping
            </Button>
            <Button variant="ghost" className="rounded-xl text-urgent" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!sheet && !error && (
        <div className="mt-5">
          <EmptyState label="No file loaded yet." />
        </div>
      )}

      <ImportHistory />
    </AppShell>
  );
}

function ImportHistory() {
  const queryClient = useQueryClient();
  const [undoing, setUndoing] = useState<string | null>(null);

  const { data: batches } = useQuery({
    queryKey: ["import-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  async function undo(id: string) {
    setUndoing(id);
    try {
      const { data, error } = await supabase.rpc("undo_import", { _batch_id: id });
      if (error) throw error;
      const counts = (data ?? {}) as Record<string, number>;
      toast.success(
        `Import undone — removed ${counts["people"] ?? 0} contacts and ${counts["donations"] ?? 0} gifts it had added.`,
      );
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo that import");
    } finally {
      setUndoing(null);
    }
  }

  if (!batches || batches.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-heading font-semibold text-foreground">Past imports</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Undoing an import removes only the records that import created. Anything you added or edited by hand stays.
      </p>
      <div className="mt-3 space-y-2">
        {batches.map((b) => (
          <div key={b.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{b.filename}</p>
              <p className="text-xs text-muted-foreground">
                {b.import_date} · {b.total_rows} rows · {b.new_rows} new · {b.matched_rows} matched
                {b.status === "reverted" ? " · undone" : ""}
              </p>
            </div>
            {b.status === "reverted" ? (
              <span className="justify-self-start rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Undone
              </span>
            ) : (
              <Button
                variant="outline"
                className="justify-self-start rounded-xl text-urgent"
                disabled={undoing === b.id}
                onClick={() => void undo(b.id)}
              >
                {undoing === b.id ? "Undoing…" : "Undo this import"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <Icon className={`size-4 ${tone}`} />
      <p className={`mt-1 font-heading text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}