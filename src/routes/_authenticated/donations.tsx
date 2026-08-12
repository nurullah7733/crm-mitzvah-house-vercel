import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddDonationDialog } from "@/components/forms/AddDialogs";
import { Field } from "@/components/forms/fields";
import { downloadCsv, stamp } from "@/lib/csv";
import { personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/donations")({
  head: () => ({
    meta: [
      { title: "Donations | Mitzvah House CRM" },
      { name: "description", content: "Every gift, always attached to the individual who gave it." },
      { property: "og:title", content: "Donations | Mitzvah House CRM" },
      { property: "og:description", content: "Every gift, always attached to the individual who gave it." },
    ],
  }),
  component: DonationsPage,
});

function DonationsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["donations-list"],
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("donations")
          .select("*, people(id, display_name, first_name, last_name), campaigns(id, name), grants(id, name)")
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });

  const gifts = (data ?? []).filter((d) => {
    const date = (d.date ?? "").slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    const amount = Number(d.amount ?? 0);
    if (min && amount < Number(min)) return false;
    if (max && amount > Number(max)) return false;
    return true;
  });
  const total = gifts.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return (
    <AppShell
      title="Donations"
      subtitle={`${gifts.length} gifts shown · ${currency(total)} total`}
      action={
        <>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() =>
              downloadCsv(
                `donations-${stamp()}`,
                gifts.map((d) => ({
                  donor: personName(d.people),
                  amount: d.amount,
                  date: d.date,
                  campaign: d.campaigns?.name ?? d.campaign ?? "",
                  grant: d.grants?.name ?? "",
                  method: d.method ?? "",
                  source: d.source ?? "",
                  notes: d.notes ?? "",
                })),
              )
            }
          >
            <Download className="size-4" /> Export to CSV
          </Button>
          <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Log donation
          </Button>
        </>
      }
    >
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Start date">
          <Input className="text-base" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="End date">
          <Input className="text-base" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Min amount">
          <Input className="text-base" type="number" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label="Max amount">
          <Input className="text-base" type="number" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        {(from || to || min || max) && (
          <button
            type="button"
            className="justify-self-start text-xs text-primary hover:underline sm:col-span-2 lg:col-span-4"
            onClick={() => {
              setFrom("");
              setTo("");
              setMin("");
              setMax("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-money/30 bg-money/5 px-4 py-3 text-sm">
        Running total of what's shown: <span className="font-heading font-semibold text-money">{currency(total)}</span>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && <EmptyState label="Loading donations…" />}
        {!isLoading && gifts.length === 0 && <EmptyState label="No gifts match those filters." />}
        {gifts.map((d) => (
          <div key={d.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {d.people ? (
                  <Link
                    to="/people/$personId"
                    params={{ personId: d.people.id }}
                    className="font-heading font-semibold text-primary hover:underline"
                  >
                    {personName(d.people)}
                  </Link>
                ) : (
                  <p className="font-heading font-semibold text-foreground">Unknown donor</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {formatDate(d.date)} · {d.campaigns?.name ?? d.campaign ?? "General"} · {d.method ?? "—"}
                </p>
                {d.grants && (
                  <Link
                    to="/grants/$grantId"
                    params={{ grantId: d.grants.id }}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    Grant payment — {d.grants.name}
                  </Link>
                )}
                {d.notes && <p className="mt-1 text-sm text-muted-foreground">{d.notes}</p>}
                {d.source && <p className="mt-1 text-xs text-muted-foreground">Source: {d.source}</p>}
              </div>
              <p className="shrink-0 font-heading text-lg font-semibold text-money">{currency(d.amount)}</p>
            </div>
          </div>
        ))}
      </div>
      <AddDonationDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppShell>
  );
}
