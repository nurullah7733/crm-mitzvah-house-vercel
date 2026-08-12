import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | Mitzvah House CRM" },
      {
        name: "description",
        content: "Signed-in overview of Mitzvah House people, households, donations, events and tasks.",
      },
      { property: "og:title", content: "Dashboard | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Signed-in overview of Mitzvah House people, households, donations, events and tasks.",
      },
    ],
  }),
  component: Dashboard,
});

const TABLES = [
  "households",
  "people",
  "events",
  "registrations",
  "donations",
  "interactions",
  "tasks",
  "yahrzeits",
] as const;

function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data, isLoading } = useQuery({
    queryKey: ["table-counts"],
    queryFn: async () => {
      const entries = await Promise.all(
        TABLES.map(async (table) => {
          const { count, error } = await supabase
            .from(table)
            .select("*", { count: "exact", head: true });
          if (error) throw error;
          return [table, count ?? 0] as const;
        }),
      );
      return entries;
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl text-foreground">Mitzvah House</h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}</p>
          </div>
          <Button variant="outline" className="rounded-xl" onClick={signOut}>
            Sign out
          </Button>
        </header>

        <section className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg text-card-foreground">Sample data loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Row counts read live from the database.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {isLoading
              ? TABLES.map((table) => (
                  <div key={table} className="rounded-xl bg-muted p-4">
                    <dt className="text-xs capitalize text-muted-foreground">{table}</dt>
                    <dd className="mt-1 text-2xl text-muted-foreground">–</dd>
                  </div>
                ))
              : data?.map(([table, count]) => (
                  <div key={table} className="rounded-xl bg-muted p-4">
                    <dt className="text-xs capitalize text-muted-foreground">{table}</dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">{count}</dd>
                  </div>
                ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
