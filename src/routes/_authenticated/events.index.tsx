import { personName } from "@/lib/names";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AddEventDialog } from "@/components/forms/AddDialogs";
import { useSelection, SelectBox, SelectAllToggle } from "@/components/BulkPeopleActions";
import { BulkRecordBar } from "@/components/BulkRecordActions";
import { downloadCsv, stamp } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/events/")({
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
  const selection = useSelection();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["events-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*, registrations(status, people(id, display_name, first_name, last_name))")
        .is("deleted_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const programs = Array.from(new Set((data ?? []).map((e) => e.program).filter(Boolean) as string[]));
  const events = (data ?? []).filter((e) => !program || e.program === program);

  return (
    <AppShell
      title="Events"
      subtitle="Programs are filters here, not a separate section"
      action={
        <>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() =>
              downloadCsv(
                `events-${stamp()}`,
                events.map((e) => ({
                  name: e.name,
                  date: e.date,
                  time: e.time ?? "",
                  location: e.location ?? "",
                  program: e.program ?? "",
                  capacity: e.capacity ?? "",
                  staff_lead: e.staff_lead ?? "",
                  registered: (e.registrations ?? []).length,
                  attended: (e.registrations ?? []).filter((r) => r.status === "attended").length,
                })),
              )
            }
          >
            <Download className="size-4" /> Export to CSV
          </Button>
          <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add event
          </Button>
        </>
      }
    >
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

      <SelectAllToggle
        visibleIds={events.map((e) => e.id)}
        selectedIds={selection.ids}
        onSelectAll={() => selection.selectAll(events.map((e) => e.id))}
        onClear={selection.clear}
        noun="events"
      />

      <div className="mt-5 space-y-3">
        {isLoading && <EmptyState label="Loading events…" />}
        {events.map((e) => (
          <div
            key={e.id}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SelectBox
                checked={selection.has(e.id)}
                onChange={() => selection.toggle(e.id)}
                label={e.name}
              />
              <div>
                <Link
                  to="/events/$eventId"
                  params={{ eventId: e.id }}
                  className="font-heading font-semibold text-foreground hover:text-primary hover:underline"
                >
                  {e.name}
                </Link>
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
                  <span
                    key={r.people!.id}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                  >
                    {personName(r.people)} · {r.status}
                  </span>
                ))}
            </div>
          </div>
        ))}
        {!isLoading && events.length === 0 && <EmptyState label="No events for that program." />}
      </div>
      <AddEventDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkRecordBar
        table="events"
        noun="event"
        nounPlural="events"
        selectedIds={selection.ids}
        onClear={selection.clear}
        visibleIds={events.map((e) => e.id)}
        onSelectAll={() => selection.selectAll(events.map((e) => e.id))}
      />
    </AppShell>
  );
}
