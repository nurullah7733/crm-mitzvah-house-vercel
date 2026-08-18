import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { QueryError } from "@/components/ErrorState";
import { AppShell, currency, formatDate } from "@/components/AppShell";
import { greeting, useCurrentStaff } from "@/lib/current-staff";
import { getSessionLog, subscribeSessionLog, type SessionChange } from "@/lib/session-log";
import {
  CompleteTaskDialog,
  TaskCheckbox,
  type CompletableTask,
} from "@/components/forms/AddDialogs";
import { personName } from "@/lib/names";
import { fetchRenewalDonors } from "@/lib/renewal";
import { fetchAll } from "@/lib/fetch-all";
import { nextHebrewAnniversary, nextYahrzeit } from "@/lib/hebrew";
import {
  FREQUENCY_LABELS,
  monthlyEquivalent,
  type PledgeFrequency,
  type PledgeStatus,
} from "@/lib/pledges";
import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | Mitzvah House CRM" },
      {
        name: "description",
        content:
          "Signed-in overview of Mitzvah House people, households, donations, events and tasks.",
      },
      { property: "og:title", content: "Dashboard | Mitzvah House CRM" },
      {
        property: "og:description",
        content:
          "Signed-in overview of Mitzvah House people, households, donations, events and tasks.",
      },
    ],
  }),
  errorComponent: RouteError,
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const [completing, setCompleting] = useState<CompletableTask | null>(null);
  const staff = useCurrentStaff();

  const { data: pendingReview } = useQuery({
    queryKey: ["review-queue-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Recurring giving at a glance: what is promised, and what has slipped.
  const { data: pledgeSummary } = useQuery({
    queryKey: ["pledge-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pledges")
        .select("id, amount, frequency, status")
        .in("status", ["active", "paused", "lapsed"]);
      if (error) throw error;
      const rows = (data ?? []) as {
        amount: number;
        frequency: PledgeFrequency;
        status: PledgeStatus;
      }[];
      const active = rows.filter((r) => r.status === "active");
      const lapsed = rows.filter((r) => r.status === "lapsed");
      const byFrequency = new Map<PledgeFrequency, number>();
      for (const r of active) byFrequency.set(r.frequency, (byFrequency.get(r.frequency) ?? 0) + 1);
      return {
        activeCount: active.length,
        pausedCount: rows.filter((r) => r.status === "paused").length,
        lapsedCount: lapsed.length,
        lapsedValue: lapsed.reduce((sum, r) => sum + monthlyEquivalent(r) * 12, 0),
        monthlyValue: active.reduce((sum, r) => sum + monthlyEquivalent(r), 0),
        byFrequency: [...byFrequency.entries()],
      };
    },
  });

  const {
    data,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [overdue, recentGifts, upcoming, grantDeadlines, pendingThanks] = await Promise.all([
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
        supabase
          .from("events")
          .select("*")
          .is("deleted_at", null)
          .gte("date", new Date().toISOString().slice(0, 10))
          .order("date")
          .limit(4),
        supabase
          .from("grants")
          .select(
            "id, name, stage, amount_awarded, application_deadline, report_deadline, renewal_deadline, funder:funder_id(id, display_name, first_name, last_name)",
          ),
        supabase
          .from("donations")
          .select("id, amount, date, campaign, people(id, display_name, first_name, last_name)")
          .is("deleted_at", null)
          .eq("thank_you_sent", false)
          .order("date", { ascending: false })
          .limit(6),
      ]);
      // One failed read used to look exactly like an empty dashboard, so any
      // failure here is raised instead of quietly showing nothing.
      for (const result of [overdue, recentGifts, upcoming, grantDeadlines, pendingThanks]) {
        if (result.error) throw result.error;
      }
      return {
        overdue: overdue.data ?? [],
        recentGifts: recentGifts.data ?? [],
        upcoming: upcoming.data ?? [],
        grants: grantDeadlines.data ?? [],
        pendingThanks: pendingThanks.data ?? [],
      };
    },
  });

  // Lapsed donors are computed live from the gift ledger, so this card is right
  // on January 1 too. Ranked by consistency plus total giving.
  const { data: lapsed } = useQuery({
    queryKey: ["dashboard-renewals"],
    queryFn: () => fetchRenewalDonors("lapsed", 5),
  });

  // Birthdays and anniversaries count down on the Hebrew calendar, same as yahrzeits.
  const { data: hebrewDates } = useQuery({
    queryKey: ["dashboard-hebrew-dates"],
    queryFn: async () => {
      const [people, yahrzeits] = await Promise.all([
        fetchAll((f, t) =>
          supabase
            .from("people")
            .select("id, display_name, first_name, last_name, birth_date, anniversary_date")
            .is("deleted_at", null)
            .order("id")
            .range(f, t),
        ),
        fetchAll((f, t) =>
          supabase
            .from("yahrzeits")
            .select(
              "id, deceased_name, hebrew_month, hebrew_day, people(id, display_name, first_name, last_name)",
            )
            .order("id")
            .range(f, t),
        ),
      ]);
      return { people, yahrzeits };
    },
  });

  const upcomingHebrew = [
    ...(hebrewDates?.people ?? []).flatMap((p) => {
      const b = nextHebrewAnniversary(p.birth_date);
      const a = nextHebrewAnniversary(p.anniversary_date);
      return [
        ...(b && b.days <= 31
          ? [
              {
                id: `b-${p.id}`,
                personId: p.id,
                name: personName(p),
                what: `Birthday · ${b.hebrewLabel}`,
                occ: b,
              },
            ]
          : []),
        ...(a && a.days <= 31
          ? [
              {
                id: `a-${p.id}`,
                personId: p.id,
                name: personName(p),
                what: `Anniversary · ${a.hebrewLabel}`,
                occ: a,
              },
            ]
          : []),
      ];
    }),
    ...(hebrewDates?.yahrzeits ?? []).flatMap((y) => {
      const n = nextYahrzeit(y.hebrew_month, y.hebrew_day);
      if (!n || n.days > 31 || !y.people) return [];
      return [
        {
          id: `y-${y.id}`,
          personId: y.people.id,
          name: personName(y.people),
          what: `Yahrzeit for ${y.deceased_name} · ${n.hebrewLabel}`,
          occ: n,
        },
      ];
    }),
  ]
    .sort((x, z) => x.occ.days - z.occ.days)
    .slice(0, 6);

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
        .map(([kind, date]) => ({
          id: `${g.id}-${kind}`,
          grantId: g.id,
          name: g.name,
          funder: g.funder,
          kind,
          date: date!,
        })),
    )
    .filter((d) => d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 6);

  return (
    <AppShell
      title={`${greeting()}${staff?.name ? `, ${staff.name}` : ""}`}
      subtitle={`Signed in as ${user.email}`}
    >
      <QueryError
        error={dashboardError}
        what="the dashboard"
        onRetry={() => void refetchDashboard()}
      />
      {!!pendingReview && (
        <Link
          to="/inbox/review"
          className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-suggestion/50 bg-suggestion/15 px-4 py-3 text-sm text-foreground"
        >
          <AlertTriangle className="size-4 text-suggestion" />
          <span className="font-medium">
            {pendingReview} imported {pendingReview === 1 ? "row" : "rows"} waiting in the Data
            Inbox
          </span>
          <span className="text-primary underline">Review now</span>
        </Link>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Needs attention" to="/tasks" linkLabel="All tasks">
          {data?.overdue.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing overdue. Nice.</p>
          )}
          {data?.overdue.map((t) => (
            <div key={t.id} className="flex gap-3 border-b border-border py-2.5 last:border-0">
              <TaskCheckbox
                done={false}
                onClick={() =>
                  setCompleting({ id: t.id, text: t.text, person_id: t.person_id, owner: t.owner })
                }
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground">{t.text}</p>
                <p className="text-xs text-urgent">
                  Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"}
                </p>
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
          {data?.recentGifts.length === 0 && (
            <p className="text-sm text-muted-foreground">No gifts logged yet.</p>
          )}
          {data?.recentGifts.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
            >
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

        <Panel title="Thank-you letters to send" to="/donations" linkLabel="All donations">
          {data?.pendingThanks.length === 0 && (
            <p className="text-sm text-muted-foreground">Every gift has been thanked. Lovely.</p>
          )}
          {data?.pendingThanks.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
            >
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
          {data?.upcoming.length === 0 && (
            <p className="text-sm text-muted-foreground">No upcoming events.</p>
          )}
          {data?.upcoming.map((e) => (
            <div key={e.id} className="border-b border-border py-2.5 last:border-0">
              <p className="text-sm text-foreground">{e.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(e.date)} · {e.program ?? "No program"} · {e.location ?? "TBD"}
              </p>
            </div>
          ))}
        </Panel>

        <Panel
          title="Renewal outreach — lapsed donors"
          to="/renewals"
          linkLabel="Full renewal list"
        >
          {lapsed?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Everyone who gave before has given again this year.
            </p>
          )}
          {lapsed?.map((d) => (
            <Link
              key={d.person_id}
              to="/renewals"
              className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0 hover:text-primary"
            >
              <div>
                <p className="text-sm text-primary">{d.name ?? "Unnamed contact"}</p>
                <p className="text-xs text-muted-foreground">
                  Last gift{" "}
                  {d.last_gift_amount === null ? "" : `${currency(d.last_gift_amount)} · `}
                  {formatDate(d.last_gift_date)} · gave in {d.prior_years}{" "}
                  {d.prior_years === 1 ? "year" : "years"}
                </p>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">
                {currency(d.lifetime_total)} lifetime
              </p>
            </Link>
          ))}
        </Panel>

        <Panel title="Upcoming Hebrew dates" to="/people" linkLabel="All people">
          {upcomingHebrew.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No birthdays, anniversaries or yahrzeits in the next month.
            </p>
          )}
          {upcomingHebrew.map((d) => (
            <Link
              key={d.id}
              to="/people/$personId"
              params={{ personId: d.personId }}
              className="block border-b border-border py-2.5 last:border-0"
            >
              <p className="text-sm text-primary">{d.name}</p>
              <p className={`text-xs ${d.occ.days <= 3 ? "text-urgent" : "text-muted-foreground"}`}>
                {d.what} — in {d.occ.days} {d.occ.days === 1 ? "day" : "days"} (
                {formatDate(d.occ.date.toISOString())}, begins the evening before)
              </p>
            </Link>
          ))}
        </Panel>

        <Panel title="Recurring giving" to="/donations" linkLabel="All donations">
          {!pledgeSummary ||
          pledgeSummary.activeCount + pledgeSummary.lapsedCount + pledgeSummary.pausedCount ===
            0 ? (
            <p className="text-sm text-muted-foreground">
              No pledges recorded yet. Add one from a person's profile when they commit to give.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5">
                <p className="text-sm text-foreground">
                  {pledgeSummary.activeCount} active{" "}
                  {pledgeSummary.activeCount === 1 ? "pledge" : "pledges"}
                </p>
                <p className="shrink-0 font-semibold text-money">
                  {currency(pledgeSummary.monthlyValue)} / month
                </p>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5">
                <p
                  className={`text-sm ${pledgeSummary.lapsedCount > 0 ? "text-urgent" : "text-muted-foreground"}`}
                >
                  {pledgeSummary.lapsedCount} lapsed{" "}
                  {pledgeSummary.lapsedCount === 1 ? "pledge" : "pledges"}
                  {pledgeSummary.pausedCount > 0 ? ` · ${pledgeSummary.pausedCount} paused` : ""}
                </p>
                {pledgeSummary.lapsedValue > 0 && (
                  <p className="shrink-0 text-sm text-muted-foreground">
                    {currency(pledgeSummary.lapsedValue)} / year at risk
                  </p>
                )}
              </div>
              <p className="pt-2.5 text-xs text-muted-foreground">
                {pledgeSummary.byFrequency.length === 0
                  ? "Missed payments show up in Tasks as follow-ups."
                  : `${pledgeSummary.byFrequency
                      .map(([f, n]) => `${n} ${FREQUENCY_LABELS[f].toLowerCase()}`)
                      .join(" · ")} — missed payments show up in Tasks.`}
              </p>
            </>
          )}
        </Panel>

        <Panel title="Upcoming grant deadlines" to="/grants" linkLabel="All grants">
          {grantDeadlines.length === 0 && (
            <p className="text-sm text-muted-foreground">No grant deadlines ahead.</p>
          )}
          {grantDeadlines.map((d) => {
            const days = Math.round(
              (new Date(d.date).getTime() - new Date(today).getTime()) / 86400000,
            );
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
                  Due {formatDate(d.date)} — in {days} {days === 1 ? "day" : "days"} ·{" "}
                  {personName(d.funder)}
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
                {new Date(e.at).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
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
  to: "/tasks" | "/donations" | "/events" | "/people" | "/grants" | "/renewals";
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
