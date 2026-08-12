import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { personName } from "@/lib/names";

export const Route = createFileRoute("/_authenticated/campaigns/$campaignId")({
  head: () => ({
    meta: [
      { title: "Campaign | Mitzvah House CRM" },
      { name: "description", content: "Campaign progress and its donor list, summed from linked gifts." },
      { property: "og:title", content: "Campaign | Mitzvah House CRM" },
      { property: "og:description", content: "Campaign progress and its donor list, summed from linked gifts." },
    ],
  }),
  component: CampaignPage,
});

function CampaignPage() {
  const { campaignId } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const [campaign, donations, grants] = await Promise.all([
        supabase.from("campaigns").select("*, events(id, name, date)").eq("id", campaignId).maybeSingle(),
        supabase
          .from("donations")
          .select("*, people(id, display_name, first_name, last_name)")
          .eq("campaign_id", campaignId)
          .order("date", { ascending: false }),
        supabase.from("grants").select("id, name, stage, amount_awarded").eq("campaign_id", campaignId),
      ]);
      return { campaign: campaign.data, donations: donations.data ?? [], grants: grants.data ?? [] };
    },
  });

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <EmptyState label="Loading campaign…" />
      </AppShell>
    );
  }
  const c = data?.campaign;
  if (!c) {
    return (
      <AppShell title="Not found">
        <EmptyState label="We couldn't find that campaign." />
      </AppShell>
    );
  }

  const raised = (data?.donations ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const goal = Number(c.goal_amount ?? 0);
  const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;

  return (
    <AppShell
      title={c.name}
      subtitle={c.status}
      action={
        <Link
          to="/campaigns"
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
        >
          <ArrowLeft className="size-4" /> Campaigns
        </Link>
      }
    >
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-heading text-2xl font-semibold text-money">{currency(raised)}</p>
            <p className="text-sm text-muted-foreground">
              {goal > 0 ? `${pct}% of ${currency(goal)} goal` : "No goal set"} · {data?.donations.length ?? 0} gifts
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            {c.start_date ? <p>Starts {formatDate(c.start_date)}</p> : null}
            {c.end_date ? <p>Ends {formatDate(c.end_date)}</p> : null}
            {c.events ? (
              <Link to="/events/$eventId" params={{ eventId: c.events.id }} className="text-primary hover:underline">
                {c.events.name}
              </Link>
            ) : null}
          </div>
        </div>
        {pct !== null && (
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-money" style={{ width: `${pct}%` }} />
          </div>
        )}
        {c.description ? <p className="mt-4 text-sm text-muted-foreground">{c.description}</p> : null}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Donors</h2>
          <div className="mt-2">
            {(data?.donations ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No gifts linked to this campaign yet.</p>
            )}
            {(data?.donations ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
                <div className="min-w-0">
                  {d.people ? (
                    <Link
                      to="/people/$personId"
                      params={{ personId: d.people.id }}
                      className="text-sm text-primary hover:underline"
                    >
                      {personName(d.people)}
                    </Link>
                  ) : (
                    <p className="text-sm text-foreground">Unknown donor</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDate(d.date)} · {d.method ?? "—"}</p>
                </div>
                <p className="shrink-0 font-semibold text-money">{currency(d.amount)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Grants supporting this campaign</h2>
          <div className="mt-2">
            {(data?.grants ?? []).length === 0 && <p className="text-sm text-muted-foreground">No grants linked.</p>}
            {(data?.grants ?? []).map((g) => (
              <Link
                key={g.id}
                to="/grants/$grantId"
                params={{ grantId: g.id }}
                className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-primary">{g.name}</p>
                  <p className="text-xs text-muted-foreground">{g.stage}</p>
                </div>
                <p className="shrink-0 text-sm text-money">{currency(g.amount_awarded)}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
