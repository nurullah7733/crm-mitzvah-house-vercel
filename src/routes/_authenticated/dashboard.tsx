import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, currency, formatDate } from "@/components/AppShell";
import { CompleteTaskDialog, TaskCheckbox, type CompletableTask } from "@/components/forms/AddDialogs";

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

function Dashboard() {
  const { user } = Route.useRouteContext();
  const [completing, setCompleting] = useState<CompletableTask | null>(null);

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [overdue, recentGifts, upcoming, lapsed] = await Promise.all([
        supabase
          .from("tasks")
          .select("*, people(id, first_name, last_name)")
          .neq("status", "done")
          .lt("due_date", new Date().toISOString().slice(0, 10))
          .order("due_date"),
        supabase
          .from("donations")
          .select("*, people(id, first_name, last_name)")
          .order("date", { ascending: false })
          .limit(5),
        supabase.from("events").select("*").gte("date", new Date().toISOString().slice(0, 10)).order("date").limit(4),
        supabase
          .from("people")
          .select("id, first_name, last_name, lifetime_giving, this_year_giving, last_gift_date")
          .eq("this_year_giving", 0)
          .gt("lifetime_giving", 1000)
          .order("lifetime_giving", { ascending: false })
          .limit(5),
      ]);
      return {
        overdue: overdue.data ?? [],
        recentGifts: recentGifts.data ?? [],
        upcoming: upcoming.data ?? [],
        lapsed: lapsed.data ?? [],
      };
    },
  });

  return (
    <AppShell title="Dashboard" subtitle={`Signed in as ${user.email}`}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Needs attention" to="/tasks" linkLabel="All tasks">
          {data?.overdue.length === 0 && <p className="text-sm text-muted-foreground">Nothing overdue. Nice.</p>}
          {data?.overdue.map((t) => (
            <div key={t.id} className="flex gap-3 border-b border-border py-2.5 last:border-0">
              <TaskCheckbox
                done={false}
                onClick={() => setCompleting({ id: t.id, text: t.text, person_id: t.person_id, owner: t.owner })}
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground">{t.text}</p>
                <p className="text-xs text-urgent">Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"}</p>
                {t.people && (
                  <Link
                    to="/people/$personId"
                    params={{ personId: t.people.id }}
                    className="text-sm text-primary hover:underline"
                  >
                    {t.people.first_name} {t.people.last_name}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Recent gifts" to="/donations" linkLabel="All donations">
          {data?.recentGifts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
              <div className="min-w-0">
                {d.people && (
                  <Link
                    to="/people/$personId"
                    params={{ personId: d.people.id }}
                    className="text-sm text-primary hover:underline"
                  >
                    {d.people.first_name} {d.people.last_name}
                  </Link>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDate(d.date)} · {d.campaign ?? "General"}
                </p>
              </div>
              <p className="shrink-0 font-semibold text-money">{currency(d.amount)}</p>
            </div>
          ))}
        </Panel>

        <Panel title="Upcoming events" to="/events" linkLabel="All events">
          {data?.upcoming.length === 0 && <p className="text-sm text-muted-foreground">No upcoming events.</p>}
          {data?.upcoming.map((e) => (
            <div key={e.id} className="border-b border-border py-2.5 last:border-0">
              <p className="text-sm text-foreground">{e.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(e.date)} · {e.program ?? "No program"} · {e.location ?? "TBD"}
              </p>
            </div>
          ))}
        </Panel>

        <Panel title="Lapsed donors" to="/people" linkLabel="All people">
          {data?.lapsed.length === 0 && <p className="text-sm text-muted-foreground">Everyone has given this year.</p>}
          {data?.lapsed.map((p) => (
            <Link
              key={p.id}
              to="/people/$personId"
              params={{ personId: p.id }}
              className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0 hover:text-primary"
            >
              <div>
                <p className="text-sm text-primary">
                  {p.first_name} {p.last_name}
                </p>
                <p className="text-xs text-muted-foreground">Last gift {formatDate(p.last_gift_date)}</p>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">{currency(p.lifetime_giving)} lifetime</p>
            </Link>
          ))}
        </Panel>
      </div>
      <CompleteTaskDialog task={completing} onOpenChange={(v) => !v && setCompleting(null)} />
    </AppShell>
  );
}

function Panel({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to: "/tasks" | "/donations" | "/events" | "/people";
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground">{title}</h2>
        <Link to={to} className="text-xs text-primary hover:underline">
          {linkLabel}
        </Link>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}
