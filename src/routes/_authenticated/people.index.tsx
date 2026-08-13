import { createFileRoute, Link } from "@tanstack/react-router";
import { formatPhone } from "@/lib/phone";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Download, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, daysSince, initials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddPersonDialog } from "@/components/forms/AddDialogs";
import { Field } from "@/components/forms/fields";
import { Label } from "@/components/ui/label";
import { nextHebrewAnniversary, nextYahrzeit } from "@/lib/hebrew";
import { approachingMitzvah, needsAdultReview, useLifecycleSettings, LIFECYCLE_DEFAULTS, isChild } from "@/lib/lifecycle";
import { downloadCsv, stamp } from "@/lib/csv";
import { personInitials, personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";
import { fuzzyScoreAny } from "@/lib/nl-search";
import { LabelChips } from "@/components/LabelChips";
import { BulkPeopleBar, SelectBox, useSelection } from "@/components/BulkPeopleActions";

export const Route = createFileRoute("/_authenticated/people/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string | undefined; tag?: string | undefined; program?: string | undefined } => ({
    q: typeof search["q"] === "string" && search["q"] ? (search["q"] as string) : undefined,
    tag: typeof search["tag"] === "string" && search["tag"] ? (search["tag"] as string) : undefined,
    program: typeof search["program"] === "string" && search["program"] ? (search["program"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "People | Mitzvah House CRM" },
      { name: "description", content: "Every person Mitzvah House knows, with giving and activity at a glance." },
      { property: "og:title", content: "People | Mitzvah House CRM" },
      { property: "og:description", content: "Every person Mitzvah House knows, with giving and activity at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PeoplePage,
});

const CHIPS = [
  "All",
  "Donors",
  "Recently updated",
  "No recent activity",
  "Upcoming important date",
  "Approaching bar/bat mitzvah",
  "Children approaching adult age",
  "Children with no birth date",
] as const;
type Chip = (typeof CHIPS)[number];
const SORTS = [
  { value: "name", label: "Name" },
  { value: "birthday", label: "Next birthday" },
  { value: "activity", label: "Last activity" },
];

function monthDay(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  const [m, d] = [parts[1] ?? 0, parts[2] ?? 0];
  if (!m || !d) return null;
  return m * 100 + d;
}

function PeoplePage() {
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  const [chip, setChip] = useState<Chip>("All");
  const [sort, setSort] = useState("name");
  const [bdayOpen, setBdayOpen] = useState(false);
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");
  const [giveOpen, setGiveOpen] = useState(false);
  const [giveBasis, setGiveBasis] = useState<"lifetime" | "this_year">("lifetime");
  const [giveMin, setGiveMin] = useState("");
  const [giveMax, setGiveMax] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const selection = useSelection();
  const activeTag = search.tag ?? null;
  const activeProgram = search.program ?? null;

  const { data: labels } = useQuery({
    queryKey: ["tag-program-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tag_program_counts");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["people-list"],
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("people")
          .select("*, households(id, name), yahrzeits(hebrew_month, hebrew_day)")
          .is("deleted_at", null)
          .order("display_name")
          .order("id")
          .range(from, to),
      ),
  });

  const rows = (data ?? []).map((p) => {
    const bday = nextHebrewAnniversary(p.birth_date);
    const anniv = nextHebrewAnniversary(p.anniversary_date);
    const yz = (p.yahrzeits ?? [])
      .map((y) => nextYahrzeit(y.hebrew_month, y.hebrew_day))
      .filter(Boolean)
      .map((y) => y!.days);
    const nextImportant = Math.min(...[bday?.days ?? Infinity, anniv?.days ?? Infinity, ...yz]);
    return {
      ...p,
      bdayDays: bday?.days ?? null,
      bdayHebrew: bday?.hebrewLabel ?? null,
      nextImportant,
      sinceActivity: daysSince(p.last_activity_date),
    };
  });

  const people = rows
    .filter((p) => {
      if (activeTag && !(p.tags ?? []).some((t) => t.toLowerCase() === activeTag.toLowerCase())) return false;
      if (activeProgram && !(p.programs ?? []).some((t) => t.toLowerCase() === activeProgram.toLowerCase()))
        return false;

      // Typo-tolerant filter: every word typed must match something on the record.
      if (q.trim()) {
        const fields = [
          personName(p),
          p.first_name,
          p.last_name,
          p.email,
          (p.phone ?? "").replace(/\D/g, ""),
          p.households?.name,
          p.met_source,
          p.school,
          (p.tags ?? []).join(" "),
          (p.programs ?? []).join(" "),
        ];
        for (const term of q.trim().split(/\s+/)) {
          if (fuzzyScoreAny(term, fields) === null) return false;
        }
      }

      if (chip === "Donors" && Number(p.lifetime_giving ?? 0) <= 0) return false;
      if (chip === "Recently updated" && !(p.sinceActivity !== null && p.sinceActivity <= 30)) return false;
      if (chip === "No recent activity" && !(p.sinceActivity === null || p.sinceActivity > 90)) return false;
      if (chip === "Upcoming important date" && !(p.nextImportant <= 60)) return false;
      if (chip === "Approaching bar/bat mitzvah" && !approachingMitzvah(p, lifecycle)) return false;
      if (chip === "Children approaching adult age" && !nearAdult(p)) return false;
      if (chip === "Children with no birth date" && !(isChild(p.role) && !p.birth_date)) return false;

      const md = monthDay(p.birth_date);
      const from = monthDay(bFrom ? `2000-${bFrom}` : null) ?? monthDay(bFrom);
      const to = monthDay(bTo ? `2000-${bTo}` : null) ?? monthDay(bTo);
      if ((bFrom || bTo) && md === null) return false;
      if (from && to && md !== null) {
        const inRange = from <= to ? md >= from && md <= to : md >= from || md <= to;
        if (!inRange) return false;
      } else if (from && md !== null && md < from) return false;
      else if (to && md !== null && md > to) return false;

      const amount = Number((giveBasis === "lifetime" ? p.lifetime_giving : p.this_year_giving) ?? 0);
      if (giveMin && amount < Number(giveMin)) return false;
      if (giveMax && amount > Number(giveMax)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "birthday") return (a.bdayDays ?? 9999) - (b.bdayDays ?? 9999);
      if (sort === "activity") return (a.sinceActivity ?? 99999) - (b.sinceActivity ?? 99999);
      return personName(a).localeCompare(personName(b));
    });

  return (
    <AppShell
      title="People"
      subtitle={`${people.length} of ${data?.length ?? 0} people`}
      action={
        <>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() =>
              downloadCsv(
                `people-${stamp()}`,
                people.map((p) => ({
                  name: personName(p),
                  first_name: p.first_name ?? "",
                  last_name: p.last_name ?? "",
                  contact_type: p.contact_type ?? "individual",
                  email: p.email ?? "",
                  phone: formatPhone(p.phone),
                  household: p.households?.name ?? "",
                  role: p.role ?? "",
                  birth_date: p.birth_date ?? "",
                  lifetime_giving: p.lifetime_giving ?? 0,
                  this_year_giving: p.this_year_giving ?? 0,
                  last_gift_date: p.last_gift_date ?? "",
                  last_activity_date: p.last_activity_date ?? "",
                  tags: p.tags ?? [],
                  programs: p.programs ?? [],
                  met_source: p.met_source ?? "",
                })),
              )
            }
          >
            <Download className="size-4" /> Export to CSV
          </Button>
          <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add person
          </Button>
        </>
      }
    >
      <Input
        className="rounded-xl text-base"
        placeholder="Search by name, email, phone, household, tag or program"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Spelling doesn't have to be perfect — “klien” finds Klein and “ruht” finds Ruth.
      </p>

      {(activeTag || activeProgram) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm text-foreground">
            Showing everyone with {activeTag ? "tag" : "program"}{" "}
            <strong>{activeTag ?? activeProgram}</strong>
          </span>
          <Link to="/people" search={{}} className="ml-auto text-xs font-medium text-primary hover:underline">
            Clear filter
          </Link>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => setChip(c)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              chip === c
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/40"
            }`}
          >
            {c}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="sort" className="text-xs text-muted-foreground">
            Sort
          </Label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-base text-foreground"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Collapsible open={bdayOpen} onToggle={() => setBdayOpen((o) => !o)} label="Search by birthday range">
          <p className="text-xs text-muted-foreground">Month and day only — the year is ignored.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="From (MM-DD)">
              <Input className="text-base" placeholder="03-01" value={bFrom} onChange={(e) => setBFrom(e.target.value)} />
            </Field>
            <Field label="To (MM-DD)">
              <Input className="text-base" placeholder="04-15" value={bTo} onChange={(e) => setBTo(e.target.value)} />
            </Field>
          </div>
        </Collapsible>

        <Collapsible open={giveOpen} onToggle={() => setGiveOpen((o) => !o)} label="Search by giving amount">
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {(["lifetime", "this_year"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setGiveBasis(b)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs ${
                  giveBasis === b ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {b === "lifetime" ? "Lifetime" : "This year"}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Min">
              <Input className="text-base" type="number" inputMode="numeric" value={giveMin} onChange={(e) => setGiveMin(e.target.value)} />
            </Field>
            <Field label="Max">
              <Input className="text-base" type="number" inputMode="numeric" value={giveMax} onChange={(e) => setGiveMax(e.target.value)} />
            </Field>
          </div>
        </Collapsible>
      </div>

      <div className="mt-3">
        <Collapsible
          open={browseOpen}
          onToggle={() => setBrowseOpen((o) => !o)}
          label="Browse all tags and programs"
        >
          {(labels ?? []).length === 0 && <p className="text-xs text-muted-foreground">No tags or programs yet.</p>}
          {(["tag", "program"] as const).map((kind) => {
            const list = (labels ?? []).filter((l) => l.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind} className="mt-2 first:mt-0">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {kind === "tag" ? "Tags" : "Programs"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((l) => (
                    <Link
                      key={`${kind}-${l.label}`}
                      to="/people"
                      search={kind === "tag" ? { tag: l.label } : { program: l.label }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition hover:ring-1 hover:ring-primary/40 ${
                        kind === "tag" ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {l.label}
                      <span className="opacity-70">{l.contacts}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </Collapsible>
      </div>

      {isLoading && <div className="mt-5"><EmptyState label="Loading people…" /></div>}
      {!isLoading && people.length === 0 && <div className="mt-5"><EmptyState label="No people match those filters." /></div>}

      {/* Desktop table */}
      {people.length > 0 && (
        <div className="mt-5 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-3" aria-label="Select" />
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Household</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Lifetime</th>
                <th className="px-4 py-3 font-medium">This year</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-2 py-3">
                    <SelectBox
                      checked={selection.has(p.id)}
                      onChange={() => selection.toggle(p.id)}
                      label={personName(p)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link to="/people/$personId" params={{ personId: p.id }} className="font-medium text-primary">
                      {personName(p)}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.contact_type && p.contact_type !== "individual" ? p.contact_type : p.role}
                    </span>
                    <LabelChips tags={p.tags ?? []} programs={p.programs ?? []} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.households?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.email ?? (formatPhone(p.phone) || "—")}</td>
                  <td className="px-4 py-3 font-medium text-money">{currency(p.lifetime_giving)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{currency(p.this_year_giving)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.sinceActivity === null ? "—" : `${p.sinceActivity} days ago`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      <div className="mt-5 space-y-3 lg:hidden">
        {people.map((p) => (
          <div key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-2">
              <SelectBox checked={selection.has(p.id)} onChange={() => selection.toggle(p.id)} label={personName(p)} />
              <Link to="/people/$personId" params={{ personId: p.id }} className="block min-w-0 flex-1">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-sm font-semibold text-primary">
                  {personInitials(p)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-heading font-semibold">
                    {personName(p)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.households?.name ?? "No household"} · {p.email ?? (formatPhone(p.phone) || "No contact")}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-money">{currency(p.lifetime_giving)}</p>
                <p className="text-xs text-muted-foreground">
                  {p.sinceActivity === null ? "No activity" : `${p.sinceActivity}d ago`}
                </p>
              </div>
            </div>
            </Link>
            </div>
            <LabelChips tags={p.tags ?? []} programs={p.programs ?? []} />
          </div>
        ))}
      </div>

      <BulkPeopleBar
        selectedIds={selection.ids}
        onClear={selection.clear}
        visibleIds={people.map((p) => p.id)}
        onSelectAll={() => selection.selectAll(people.map((p) => p.id))}
      />

      <AddPersonDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppShell>
  );
}

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-sm font-medium">
        {label}
        <ChevronDown className={`size-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
