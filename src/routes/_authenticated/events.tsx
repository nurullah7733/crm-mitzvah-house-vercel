import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({
    meta: [
      { title: "Events | Mitzvah House CRM" },
      { name: "description", content: "Upcoming and past Mitzvah House events, filtered by program." },
      { property: "og:title", content: "Events | Mitzvah House CRM" },
      { property: "og:description", content: "Upcoming and past Mitzvah House events, filtered by program." },
    ],
  }),
  component: EventsPage,
});

function EventsPage() {
  const [program, setProgram] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["events-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*, registrations(status, people(id, first_name, last_name))")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const programs = Array.from(new Set((data ?? []).map((e) => e.program).filter(Boolean) as string[]));
  const events = (data ?? []).filter((e) => !program || e.program === program);

  return (
    <AppShell title="Events" subtitle="Programs are filters here, not a separate section">
      <div className="flex flex-wrap gap-2">
        {programs.map((p) => (
          <button
            key={p}
            onClick={() => setProgram(program === p ? null : p)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              program === p
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/40"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {isLoading && <EmptyState label="Loading events…" />}
        {events.map((e) => (
          <section key={e.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-heading font-semibold text-foreground">{e.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {formatDate(e.date)}
                  {e.time ? ` · ${e.time}` : ""} · {e.location ?? "TBD"}
                </p>
                {e.program && <p className="mt-1 text-xs text-primary">{e.program}</p>}
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>
                  {(e.registrations ?? []).length}
                  {e.capacity ? ` / ${e.capacity}` : ""} registered
                </p>
                {e.staff_lead && <p className="text-xs">Lead: {e.staff_lead}</p>}
              </div>
            </div>
            {e.description && <p className="mt-2 text-sm text-muted-foreground">{e.description}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {(e.registrations ?? [])
                .filter((r) => r.people)
                .map((r) => (
                  <Link
                    key={r.people!.id}
                    to="/people/$personId"
                    params={{ personId: r.people!.id }}
                    className="rounded-full border border-border px-3 py-1 text-xs text-foreground transition hover:border-primary hover:text-primary"
                  >
                    {r.people!.first_name} {r.people!.last_name} · {r.status}
                  </Link>
                ))}
            </div>
          </section>
        ))}
        {!isLoading && events.length === 0 && <EmptyState label="No events for that program." />}
      </div>
    </AppShell>
  );
}
