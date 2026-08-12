import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";

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
  const { data, isLoading } = useQuery({
    queryKey: ["donations-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("donations")
        .select("*, people(id, first_name, last_name)")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const total = (data ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return (
    <AppShell title="Donations" subtitle={`${data?.length ?? 0} gifts · ${currency(total)} total`}>
      <div className="space-y-3">
        {isLoading && <EmptyState label="Loading donations…" />}
        {data?.map((d) => (
          <div key={d.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {d.people ? (
                  <Link
                    to="/people/$personId"
                    params={{ personId: d.people.id }}
                    className="font-heading font-semibold text-primary hover:underline"
                  >
                    {d.people.first_name} {d.people.last_name}
                  </Link>
                ) : (
                  <p className="font-heading font-semibold text-foreground">Unknown donor</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {formatDate(d.date)} · {d.campaign ?? "General"} · {d.method ?? "—"}
                </p>
                {d.notes && <p className="mt-1 text-sm text-muted-foreground">{d.notes}</p>}
                {d.source && <p className="mt-1 text-xs text-muted-foreground">Source: {d.source}</p>}
              </div>
              <p className="shrink-0 font-heading text-lg font-semibold text-money">{currency(d.amount)}</p>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
