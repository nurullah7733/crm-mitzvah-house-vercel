import { personName } from "@/lib/names";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  AddTaskDialog,
  CompleteTaskDialog,
  TaskCheckbox,
  type CompletableTask,
} from "@/components/forms/AddDialogs";
import { todayISO } from "@/components/forms/fields";
import { nextBirthday, nextYahrzeit } from "@/lib/hebrew";
import { CalendarHeart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks | Mitzvah House CRM" },
      { name: "description", content: "What to do next, with the person each task belongs to." },
      { property: "og:title", content: "Tasks | Mitzvah House CRM" },
      { property: "og:description", content: "What to do next, with the person each task belongs to." },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [completing, setCompleting] = useState<CompletableTask | null>(null);
  const [showDone, setShowDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, people(id, display_name, first_name, last_name)")
        .order("due_date");
      if (error) throw error;
      return data;
    },
  });

  const { data: dates } = useQuery({
    queryKey: ["upcoming-special-dates"],
    queryFn: async () => {
      const [people, yahrzeits] = await Promise.all([
        supabase
          .from("people")
          .select("id, display_name, first_name, last_name, birth_date")
          .not("birth_date", "is", null),
        supabase
          .from("yahrzeits")
          .select(
            "id, deceased_name, relationship, hebrew_month, hebrew_day, people(id, display_name, first_name, last_name)",
          ),
      ]);
      return { people: people.data ?? [], yahrzeits: yahrzeits.data ?? [] };
    },
  });

  const reminders = [
    ...(dates?.people ?? []).flatMap((p) => {
      const next = nextBirthday(p.birth_date);
      if (!next || next.days > 31) return [];
      return [
        {
          key: `b-${p.id}`,
          personId: p.id,
          name: personName(p),
          label: `Birthday in ${next.days} day${next.days === 1 ? "" : "s"}`,
          date: next.date.toISOString(),
          days: next.days,
        },
      ];
    }),
    ...(dates?.yahrzeits ?? []).flatMap((y) => {
      const next = nextYahrzeit(y.hebrew_month, y.hebrew_day);
      if (!next || next.days > 31 || !y.people) return [];
      return [
        {
          key: `y-${y.id}`,
          personId: y.people.id,
          name: personName(y.people),
          label: `Yahrzeit for ${y.deceased_name} in ${next.days} day${next.days === 1 ? "" : "s"}`,
          date: next.date.toISOString(),
          days: next.days,
        },
      ];
    }),
  ].sort((a, b) => a.days - b.days);

  const tasks = (data ?? []).map((t) => ({
    ...t,
    group:
      t.status === "done"
        ? ("done" as const)
        : t.due_date && t.due_date < todayISO()
          ? ("overdue" as const)
          : ("upcoming" as const),
  }));

  const overdue = tasks.filter((t) => t.group === "overdue");
  const upcoming = tasks.filter((t) => t.group === "upcoming");
  const weekStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Sunday of the current week
    return d.toISOString().slice(0, 10);
  })();
  const done = tasks.filter(
    (t) => t.group === "done" && ((t.completed_at ?? t.created_at) ?? "").slice(0, 10) >= weekStart,
  );

  function Row({ t }: { t: (typeof tasks)[number] }) {
    const isDone = t.group === "done";
    return (
      <div
        className={`flex gap-3 rounded-2xl border bg-card p-4 shadow-sm ${
          t.group === "overdue" ? "border-urgent/40" : "border-border"
        }`}
      >
        <TaskCheckbox
          done={isDone}
          onClick={() => {
            if (!isDone) setCompleting({ id: t.id, text: t.text, person_id: t.person_id, owner: t.owner });
          }}
        />
        <div className="min-w-0">
          <p className={`text-sm ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.text}</p>
          <p className={`mt-1 text-xs ${t.group === "overdue" ? "text-urgent" : "text-muted-foreground"}`}>
            Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"} · {t.priority ?? "Normal"} priority
          </p>
          {t.people && (
            <Link
              to="/people/$personId"
              params={{ personId: t.people.id }}
              className="mt-2 inline-block text-sm text-primary hover:underline"
            >
              {personName(t.people)}
            </Link>
          )}
          {t.completion_note && <p className="mt-1 text-xs text-muted-foreground">{t.completion_note}</p>}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      title="Tasks"
      subtitle={`${overdue.length} overdue · ${upcoming.length} upcoming`}
      action={
        <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add task
        </Button>
      }
    >
      {isLoading && <EmptyState label="Loading tasks…" />}
      <div className="space-y-6">
        {reminders.length > 0 && (
          <section>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Reach out — special dates this month
            </h2>
            <div className="mt-3 space-y-3">
              {reminders.map((r) => (
                <div key={r.key} className="flex gap-3 rounded-2xl border border-suggestion/50 bg-suggestion/10 p-4 shadow-sm">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-suggestion/25 text-suggestion-foreground">
                    <CalendarHeart className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      Reach out to{" "}
                      <Link to="/people/$personId" params={{ personId: r.personId }} className="text-primary hover:underline">
                        {r.name}
                      </Link>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.label} · {formatDate(r.date)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {[
          { label: "Overdue", items: overdue },
          { label: "Upcoming", items: upcoming },
        ].map(({ label, items }) =>
          items.length === 0 ? null : (
            <section key={label}>
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </h2>
              <div className="mt-3 space-y-3">
                {items.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </div>
            </section>
          ),
        )}

        {!isLoading && overdue.length === 0 && upcoming.length === 0 && (
          <EmptyState label="Nothing open. Everything is done." />
        )}

        {done.length > 0 && (
          <section>
            <button
              onClick={() => setShowDone((s) => !s)}
              className="flex items-center gap-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Show completed ({done.length})
              <ChevronDown className={`size-4 transition ${showDone ? "rotate-180" : ""}`} />
            </button>
            {showDone && (
              <div className="mt-3 space-y-3">
                {done.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} />
      <CompleteTaskDialog task={completing} onOpenChange={(v) => !v && setCompleting(null)} />
    </AppShell>
  );
}
