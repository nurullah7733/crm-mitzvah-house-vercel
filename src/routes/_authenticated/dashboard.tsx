import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, currency, formatDate } from "@/components/AppShell";
import { greeting, useCurrentStaff } from "@/lib/current-staff";
import { getSessionLog, subscribeSessionLog, type SessionChange } from "@/lib/session-log";
import { CompleteTaskDialog, TaskCheckbox, type CompletableTask } from "@/components/forms/AddDialogs";
import { personName } from "@/lib/names";

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
  const staff = useCurrentStaff();

  const { data: pendingReview } = useQuery({
    queryKey: ["review-queue-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [overdue, recentGifts, upcoming, lapsed, grantDeadlines] = await Promise.all([
        supabase
          .from("tasks")
          .select("*, people(id, display_name, first_name, last_name)")
          .is("deleted_at", null)
          .neq("status", "done")
          .lt("due_date", new Date().toISOString().slice(0, 10))
          .order("due_date"),
        supabase
          .from("donations")
          .select("*, people(id, display_name, first_name, last_name)")
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .limit(5),
        supabase.from("events").select("*").is("deleted_at", null).gte("date", new Date().toISOString().slice(0, 10)).order("date").limit(4),
        supabase
          .from("people")
          .select("id, display_name, first_name, last_name, lifetime_giving, this_year_giving, last_gift_date")
          .is("deleted_at", null)
          .eq("this_year_giving", 0)
          .gt("lifetime_giving", 1000)
          .order("lifetime_giving", { ascending: false })
          .limit(5),
        supabase
          .from("grants")
          .select("id, name, stage, amount_awarded, application_deadline, report_deadline, renewal_deadline, funder:funder_id(id, display_name, first_name, last_name)"),
      ]);
      return {
        overdue: overdue.data ?? [],
        recentGifts: recentGifts.data ?? [],
        upcoming: upcoming.data ?? [],
        lapsed: lapsed.data ?? [],
        grants: grantDeadlines.data ?? [],
      };
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const grantDeadlines = (data?.grants ?? [])
    .flatMap((g) =>
      (
        [
          ["Application", g.application_deadline],
          ["Report", g.report_deadline],
          ["Renewal", g.renewal_deadline],
        ] as const
      )
        .filter(([, date]) => !!date)
        .map(([kind, date]) => ({ id: `${g.id}-${kind}`, grantId: g.id, name: g.name, funder: g.funder, kind, date: date! })),
    )
    .filter((d) => d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 6);

  return (
    <AppShell
      title={`${greeting()}${staff?.name ? `, ${staff.name}` : ""}`}
      subtitle={`Signed in as ${user.email}`}
    >
      {!!pendingReview && (
        <Link
          to="/inbox/review"
          className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-suggestion/50 bg-suggestion/15 px-4 py-3 text-sm text-foreground"
        >
          <AlertTriangle className="size-4 text-suggestion" />
          <span className="font-medium">
            {pendingReview} imported {pendingReview === 1 ? "row" : "rows"} waiting in the Data Inbox
          </span>
          <span className="text-primary underline">Review now</span>
        </Link>
      )}
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
                    {personName(t.people)}
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
                    {personName(d.people)}
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
                  {personName(p)}
                </p>
                <p className="text-xs text-muted-foreground">Last gift {formatDate(p.last_gift_date)}</p>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">{currency(p.lifetime_giving)} lifetime</p>
            </Link>
          ))}
        </Panel>

        <Panel title="Upcoming grant deadlines" to="/grants" linkLabel="All grants">
          {grantDeadlines.length === 0 && <p className="text-sm text-muted-foreground">No grant deadlines ahead.</p>}
          {grantDeadlines.map((d) => {
            const days = Math.round((new Date(d.date).getTime() - new Date(today).getTime()) / 86400000);
            return (
              <Link
                key={d.id}
                to="/grants/$grantId"
                params={{ grantId: d.grantId }}
                className="block border-b border-border py-2.5 last:border-0"
              >
                <p className="text-sm text-primary">
                  {d.kind} · {d.name}
                </p>
                <p className={`text-xs ${days <= 14 ? "text-urgent" : "text-muted-foreground"}`}>
                  Due {formatDate(d.date)} — in {days} {days === 1 ? "day" : "days"} · {personName(d.funder)}
                </p>
              </Link>
            );
          })}
        </Panel>

        <SessionLogPanel />
      </div>
      <CompleteTaskDialog task={completing} onOpenChange={(v) => !v && setCompleting(null)} />
    </AppShell>
  );
}

function SessionLogPanel() {
  const [entries, setEntries] = useState<SessionChange[]>([]);

  useEffect(() => {
    setEntries(getSessionLog());
    return subscribeSessionLog(() => setEntries(getSessionLog()));
  }, []);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <History className="size-4 text-primary" />
        <h2 className="font-heading font-semibold text-foreground">Changes this session</h2>
      </div>
      <div className="mt-2">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet since you signed in.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="border-b border-border py-2.5 last:border-0">
              <p className="text-sm text-foreground">{e.text}</p>
              <p className="text-xs text-muted-foreground">
                {e.actor} ·{" "}
                {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Panel({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to: "/tasks" | "/donations" | "/events" | "/people" | "/grants";
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
