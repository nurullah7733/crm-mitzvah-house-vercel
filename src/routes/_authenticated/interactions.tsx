import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/interactions")({
  head: () => ({
    meta: [
      { title: "Inbox | Mitzvah House CRM" },
      { name: "description", content: "Everything logged across the community, newest first." },
      { property: "og:title", content: "Inbox | Mitzvah House CRM" },
      { property: "og:description", content: "Everything logged across the community, newest first." },
    ],
  }),
  component: InteractionsPage,
});

function InteractionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["interactions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interactions")
        .select("*, people(id, first_name, last_name)")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell title="Inbox" subtitle="All recent activity across everyone">
      {isLoading && <EmptyState label="Loading activity…" />}
      <div className="space-y-3">
        {data?.map((i) => (
          <div key={i.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                  i.type === "donation" ? "bg-money" : i.type === "event" ? "bg-primary" : "bg-suggestion"
                }`}
              />
              <div className="min-w-0">
                {i.people && (
                  <Link
                    to="/people/$personId"
                    params={{ personId: i.people.id }}
                    className="font-heading font-semibold text-primary hover:underline"
                  >
                    {i.people.first_name} {i.people.last_name}
                  </Link>
                )}
                <p className="text-sm text-foreground">{i.text}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(i.date)} · {i.type}
                  {i.author ? ` · ${i.author}` : ""}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
