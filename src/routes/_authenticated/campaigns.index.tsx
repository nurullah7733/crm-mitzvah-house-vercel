import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AddCampaignDialog } from "@/components/forms/CampaignGrantDialogs";
import { CAMPAIGN_STATUSES } from "@/lib/names";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campaigns | Mitzvah House CRM" },
      { name: "description", content: "Fundraising pushes with goals, progress summed from every linked gift." },
      { property: "og:title", content: "Campaigns | Mitzvah House CRM" },
      { property: "og:description", content: "Fundraising pushes with goals, progress summed from every linked gift." },
    ],
  }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [status, setStatus] = useState<string>("All");

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns-list"],
    queryFn: async () => {
      const [campaigns, donations] = await Promise.all([
        supabase.from("campaigns").select("*, events(id, name, date)").order("created_at", { ascending: false }),
        supabase.from("donations").select("campaign_id, amount"),
      ]);
      if (campaigns.error) throw campaigns.error;
      const raised = new Map<string, number>();
      for (const d of donations.data ?? []) {
        if (!d.campaign_id) continue;
        raised.set(d.campaign_id, (raised.get(d.campaign_id) ?? 0) + Number(d.amount ?? 0));
      }
      return (campaigns.data ?? []).map((c) => ({ ...c, raised: raised.get(c.id) ?? 0 }));
    },
  });

  const rows = (data ?? []).filter((c) => status === "All" || c.status === status);

  return (
    <AppShell
      title="Campaigns"
      subtitle={`${rows.length} campaign${rows.length === 1 ? "" : "s"}`}
      action={
        <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add campaign
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {["All", ...CAMPAIGN_STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1.5 text-xs capitalize transition ${
              status === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/40"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && <EmptyState label="Loading campaigns…" />}
        {!isLoading && rows.length === 0 && <EmptyState label="No campaigns yet." />}
        {rows.map((c) => {
          const goal = Number(c.goal_amount ?? 0);
          const pct = goal > 0 ? Math.min(100, Math.round((c.raised / goal) * 100)) : null;
          return (
            <Link
              key={c.id}
              to="/campaigns/$campaignId"
              params={{ campaignId: c.id }}
              className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-heading font-semibold text-primary">{c.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="capitalize">{c.status}</span>
                    {c.start_date ? ` · from ${formatDate(c.start_date)}` : ""}
                    {c.end_date ? ` to ${formatDate(c.end_date)}` : ""}
                    {c.events ? ` · ${c.events.name}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-heading text-lg font-semibold text-money">{currency(c.raised)}</p>
                  <p className="text-xs text-muted-foreground">{goal > 0 ? `of ${currency(goal)} goal` : "no goal set"}</p>
                </div>
              </div>
              {pct !== null && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-money" style={{ width: `${pct}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
      <AddCampaignDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppShell>
  );
}
