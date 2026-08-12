import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, daysSince, initials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hebrewDateFromEnglish, nextBirthday, nextYahrzeit } from "@/lib/hebrew";

export const Route = createFileRoute("/_authenticated/people/")({
  validateSearch: (search: Record<string, unknown>): { q?: string | undefined } => ({
    q: typeof search["q"] === "string" && search["q"] ? (search["q"] as string) : undefined,
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

const CHIPS = ["All", "Donors", "Recently updated", "No recent activity", "Upcoming important date"] as const;
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

  const { data, isLoading } = useQuery({
    queryKey: ["people-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("*, households(id, name), yahrzeits(hebrew_month, hebrew_day)")
        .order("last_name");
      if (error) throw error;
      return data;
    },
  });

  const rows = (data ?? []).map((p) => {
    const bday = nextBirthday(p.birth_date);
    const yz = (p.yahrzeits ?? [])
      .map((y) => nextYahrzeit(y.hebrew_month, y.hebrew_day))
      .filter(Boolean)
      .map((y) => y!.days);
    const nextImportant = Math.min(...[bday?.days ?? Infinity, ...yz]);
    return { ...p, bdayDays: bday?.days ?? null, nextImportant, sinceActivity: daysSince(p.last_activity_date) };
  });

  const people = rows
    .filter((p) => {
      const hay = `${p.first_name} ${p.last_name} ${p.email ?? ""} ${p.phone ?? ""} ${p.households?.name ?? ""}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;

      if (chip === "Donors" && Number(p.lifetime_giving ?? 0) <= 0) return false;
      if (chip === "Recently updated" && !(p.sinceActivity !== null && p.sinceActivity <= 30)) return false;
      if (chip === "No recent activity" && !(p.sinceActivity === null || p.sinceActivity > 90)) return false;
      if (chip === "Upcoming important date" && !(p.nextImportant <= 60)) return false;

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
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
    });

  return (
    <AppShell
      title="People"
      subtitle={`${people.length} of ${data?.length ?? 0} people`}
      action={
        <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add person
        </Button>
      }
    >
      <Input
        className="rounded-xl text-base"
        placeholder="Search by name, email, phone or household"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />

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

      {isLoading && <div className="mt-5"><EmptyState label="Loading people…" /></div>}
      {!isLoading && people.length === 0 && <div className="mt-5"><EmptyState label="No people match those filters." /></div>}

      {/* Desktop table */}
      {people.length > 0 && (
        <div className="mt-5 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
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
                  <td className="px-4 py-3">
                    <Link to="/people/$personId" params={{ personId: p.id }} className="font-medium text-primary">
                      {p.first_name} {p.last_name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{p.role}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.households?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.email ?? p.phone ?? "—"}</td>
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
          <Link
            key={p.id}
            to="/people/$personId"
            params={{ personId: p.id }}
            className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-sm font-semibold text-primary">
                  {initials(p.first_name, p.last_name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-heading font-semibold">
                    {p.first_name} {p.last_name}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.households?.name ?? "No household"} · {p.email ?? p.phone ?? "No contact"}
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
        ))}
      </div>

      <AddPersonDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
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

function AddPersonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    role: "Adult",
    birth_date: "",
    household_id: "",
    met_source: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const hebrew = hebrewDateFromEnglish(form.birth_date);

  const { data: households } = useQuery({
    queryKey: ["households-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("households").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: metSources } = useQuery({
    queryKey: ["met-source-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("met_source_options").select("label").order("label");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("people").insert({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        role: form.role,
        birth_date: form.birth_date || null,
        household_id: form.household_id || null,
        met_source: form.met_source || null,
        met_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Person added");
      queryClient.invalidateQueries({ queryKey: ["people-list"] });
      onOpenChange(false);
      setForm({ first_name: "", last_name: "", phone: "", email: "", role: "Adult", birth_date: "", household_id: "", met_source: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Add person</DialogTitle>
          <DialogDescription>Only a name is required — everything else can come later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input className="text-base" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input className="text-base" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input className="text-base" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input className="text-base" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Role">
            <select
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-base"
            >
              <option value="Adult">Adult</option>
              <option value="Child">Child</option>
            </select>
          </Field>
          <Field label="Household">
            <select
              value={form.household_id}
              onChange={(e) => set("household_id", e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-base"
            >
              <option value="">No household</option>
              {(households ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Birthday">
              <Input className="text-base" type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
            </Field>
            {hebrew && <p className="mt-1 text-xs text-primary">Hebrew date: {hebrew}</p>}
          </div>
          <div className="sm:col-span-2">
            <Field label="How we met">
              <select
                value={form.met_source}
                onChange={(e) => set("met_source", e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-base"
              >
                <option value="">Not recorded</option>
                {(metSources ?? []).map((m) => (
                  <option key={m.label} value={m.label}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-xl"
            disabled={!form.first_name.trim() || !form.last_name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
