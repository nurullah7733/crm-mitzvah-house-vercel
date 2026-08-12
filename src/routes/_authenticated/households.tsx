import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/households")({
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
  const { data, isLoading } = useQuery({
    queryKey: ["households-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("households")
        .select("*, people(id, first_name, last_name, role, lifetime_giving)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell title="Households" subtitle="Used for mailings and duplicate detection only">
      <div className="space-y-3">
        {isLoading && <EmptyState label="Loading households…" />}
        {data?.map((h) => {
          const total = (h.people ?? []).reduce((sum, p) => sum + Number(p.lifetime_giving ?? 0), 0);
          return (
            <section key={h.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading font-semibold text-foreground">{h.name}</h2>
                  <p className="text-sm text-muted-foreground">{h.address ?? "No address"}</p>
                  <p className="text-sm text-muted-foreground">{h.phone ?? "No phone"}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-money">{currency(total)}</p>
                  <p className="text-xs text-muted-foreground">household giving</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(h.people ?? []).map((p) => (
                  <Link
                    key={p.id}
                    to="/people/$personId"
                    params={{ personId: p.id }}
                    className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground transition hover:border-primary hover:text-primary"
                  >
                    {p.first_name} {p.last_name}
                    <span className="ml-1 text-xs text-muted-foreground">{p.role}</span>
                  </Link>
                ))}
              </div>
              {h.notes && <p className="mt-3 text-sm text-muted-foreground">{h.notes}</p>}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
