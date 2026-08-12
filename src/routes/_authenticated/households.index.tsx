import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Users, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AddHouseholdDialog } from "@/components/forms/AddDialogs";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { downloadCsv, stamp } from "@/lib/csv";

type HouseholdRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  notes?: string | null;
  people: {
    id: string;
    first_name: string;
    last_name: string;
    role: string;
    email?: string | null;
    phone?: string | null;
    lifetime_giving: number | string;
    this_year_giving: number | string;
  }[];
};

const NAME_STYLES = [
  { value: "household", label: "Household name", hint: "The Klein Household" },
  { value: "adult_firsts", label: "First names of the adults", hint: "Sarah & David Klein" },
  { value: "adults_full", label: "Full names of the adults", hint: "Sarah Klein, David Klein" },
  { value: "all_members", label: "Everyone in the household", hint: "Sarah, David, Ari, Mia Klein" },
] as const;
type NameStyle = (typeof NAME_STYLES)[number]["value"];

const COLUMNS = [
  { key: "address", label: "Mailing address" },
  { key: "phone", label: "Phone" },
  { key: "members", label: "Number of members" },
  { key: "member_names", label: "Member names" },
  { key: "emails", label: "Member emails" },
  { key: "lifetime", label: "Lifetime giving (combined)" },
  { key: "this_year", label: "Giving this year (combined)" },
  { key: "notes", label: "Notes" },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

function lastNames(people: HouseholdRow["people"]) {
  return Array.from(new Set(people.map((p) => p.last_name))).join("-");
}

function nameFor(h: HouseholdRow, style: NameStyle) {
  const adults = h.people.filter((p) => p.role !== "Child");
  switch (style) {
    case "adult_firsts": {
      const group = adults.length > 0 ? adults : h.people;
      if (group.length === 0) return h.name;
      return `${group.map((p) => p.first_name).join(" & ")} ${lastNames(group)}`.trim();
    }
    case "adults_full": {
      const group = adults.length > 0 ? adults : h.people;
      return group.map((p) => `${p.first_name} ${p.last_name}`).join(", ") || h.name;
    }
    case "all_members": {
      if (h.people.length === 0) return h.name;
      return `${h.people.map((p) => p.first_name).join(", ")} ${lastNames(h.people)}`.trim();
    }
    default:
      return h.name;
  }
}

function ExportHouseholdsDialog({
  open,
  onOpenChange,
  households,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  households: HouseholdRow[];
}) {
  const [style, setStyle] = useState<NameStyle>("household");
  const [columns, setColumns] = useState<ColumnKey[]>([
    "address",
    "phone",
    "members",
    "lifetime",
    "this_year",
  ]);

  const toggle = (key: ColumnKey) =>
    setColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  function run() {
    const rows = households.map((h) => {
      const row: Record<string, unknown> = { Name: nameFor(h, style) };
      if (columns.includes("address")) row["Address"] = h.address ?? "";
      if (columns.includes("phone")) row["Phone"] = h.phone ?? "";
      if (columns.includes("members")) row["Members"] = h.people.length;
      if (columns.includes("member_names"))
        row["Member names"] = h.people.map((p) => `${p.first_name} ${p.last_name}`).join("; ");
      if (columns.includes("emails"))
        row["Member emails"] = h.people.map((p) => p.email).filter(Boolean).join("; ");
      if (columns.includes("lifetime"))
        row["Lifetime giving"] = h.people.reduce((s, p) => s + Number(p.lifetime_giving ?? 0), 0);
      if (columns.includes("this_year"))
        row["Giving this year"] = h.people.reduce((s, p) => s + Number(p.this_year_giving ?? 0), 0);
      if (columns.includes("notes")) row["Notes"] = h.notes ?? "";
      return row;
    });
    downloadCsv(`households-${stamp()}`, rows);
    onOpenChange(false);
  }

  const preview = households[0] ? nameFor(households[0], style) : "";

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Export households to CSV"
      description="Choose how names should appear and which details to include."
    >
      <div className="space-y-5">
        <div>
          <p className="text-sm font-medium text-foreground">Name in the CSV</p>
          <div className="mt-2 space-y-2">
            {NAME_STYLES.map((s) => (
              <label
                key={s.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="household-name-style"
                  className="mt-1 size-4"
                  checked={style === s.value}
                  onChange={() => setStyle(s.value)}
                />
                <span>
                  <span className="font-medium text-foreground">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">e.g. {s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {preview && (
            <p className="mt-2 text-xs text-muted-foreground">
              First row will read: <span className="font-medium text-foreground">{preview}</span>
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Include these columns</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {COLUMNS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={columns.includes(c.key)}
                  onChange={() => toggle(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <Button className="w-full rounded-xl" onClick={run} disabled={households.length === 0}>
          <Download className="size-4" /> Download {households.length} households
        </Button>
      </div>
    </ResponsiveModal>
  );
}

export const Route = createFileRoute("/_authenticated/households/")({
  head: () => ({
    meta: [
      { title: "Households | Mitzvah House CRM" },
      { name: "description", content: "Households grouped for mailings, with the people who belong to each." },
      { property: "og:title", content: "Households | Mitzvah House CRM" },
      { property: "og:description", content: "Households grouped for mailings, with the people who belong to each." },
    ],
  }),
  component: HouseholdsPage,
});

function HouseholdsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["households-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("households")
        .select("*, people(id, first_name, last_name, role, lifetime_giving, this_year_giving)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Households"
      subtitle="Used for mailings and duplicate detection only"
      action={
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setExportOpen(true)}>
            <Download className="size-4" /> Export to CSV
          </Button>
          <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add household
          </Button>
        </div>
      }
    >
      {isLoading && <EmptyState label="Loading households…" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.map((h) => {
          const lifetime = (h.people ?? []).reduce((sum, p) => sum + Number(p.lifetime_giving ?? 0), 0);
          const thisYear = (h.people ?? []).reduce((sum, p) => sum + Number(p.this_year_giving ?? 0), 0);
          return (
            <Link
              key={h.id}
              to="/households/$householdId"
              params={{ householdId: h.id }}
              className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50"
            >
              <h2 className="font-heading font-semibold text-foreground">{h.name}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{h.address ?? "No address"}</p>
              <p className="text-sm text-muted-foreground">{h.phone ?? "No phone"}</p>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="size-4" /> {(h.people ?? []).length} members
                </p>
                <div className="text-right">
                  <p className="font-semibold text-money">{currency(lifetime)}</p>
                  <p className="text-xs text-muted-foreground">{currency(thisYear)} this year</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!isLoading && (data ?? []).length === 0 && <EmptyState label="No households yet." />}
      <AddHouseholdDialog open={addOpen} onOpenChange={setAddOpen} />
      <ExportHouseholdsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        households={(data ?? []) as HouseholdRow[]}
      />
    </AppShell>
  );
}
