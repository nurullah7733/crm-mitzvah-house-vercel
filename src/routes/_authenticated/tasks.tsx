import { personName } from "@/lib/names";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Plus, HeartHandshake } from "lucide-react";
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
import { EditRecordDialog } from "@/components/forms/EditRecordDialog";
import { nextHebrewAnniversary, nextYahrzeit } from "@/lib/hebrew";
import { fetchAll } from "@/lib/fetch-all";
import { CalendarHeart } from "lucide-react";
import { giftReminders, quietReminders, type EngagementReminder } from "@/lib/engagement";
import { fetchMissedPledgePayments, missedPledgeReminders } from "@/lib/pledges";
import {
  lifecycleItems,
  useLifecycleSettings,
  LIFECYCLE_DEFAULTS,
  type LifecycleItem,
} from "@/lib/lifecycle";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/db-errors";
import { useSelection, SelectBox, SelectAllToggle } from "@/components/BulkPeopleActions";
import { BulkRecordBar } from "@/components/BulkRecordActions";
import { RouteError } from "@/components/RouteError";
import { showError } from "@/lib/app-errors";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks | Mitzvah House CRM" },
      { name: "description", content: "What to do next, with the person each task belongs to." },
      { property: "og:title", content: "Tasks | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "What to do next, with the person each task belongs to.",
      },
    ],
  }),
  errorComponent: RouteError,
  component: TasksPage,
});

function TasksPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const selection = useSelection();
  const [completing, setCompleting] = useState<CompletableTask | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks-list"],
    queryFn: () =>
      fetchAll((f, t) =>
        supabase
          .from("tasks")
          .select("*, people(id, display_name, first_name, last_name)")
          .is("deleted_at", null)
          .order("due_date")
          .order("id")
          .range(f, t),
      ),
  });

  const { data: dates } = useQuery({
    queryKey: ["upcoming-special-dates"],
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
              "id, deceased_name, relationship, hebrew_month, hebrew_day, people(id, display_name, first_name, last_name)",
            )
            .order("id")
            .range(f, t),
        ),
      ]);
      return { people, yahrzeits };
    },
  });

  const { data: engagement } = useQuery({
    queryKey: ["engagement-reminders"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 45);
      const [people, donations] = await Promise.all([
        fetchAll((f, t) =>
          supabase
            .from("people")
            .select("id, display_name, first_name, last_name, last_activity_date, last_gift_date")
            .is("deleted_at", null)
            .order("id")
            .range(f, t),
        ),
        fetchAll((f, t) =>
          supabase
            .from("donations")
            .select(
              "id, person_id, amount, date, campaigns(name), source, people(id, display_name, first_name, last_name)",
            )
            .is("deleted_at", null)
            .gte("date", since.toISOString().slice(0, 10))
            .order("id")
            .range(f, t),
        ),
      ]);
      return { people, donations };
    },
  });

  // Recurring gifts that didn't arrive. Nothing is changed — it becomes a
  // follow-up staff can turn into a task.
  const { data: missedPledges } = useQuery({
    queryKey: ["missed-pledge-payments"],
    queryFn: fetchMissedPledgePayments,
  });

  const { data: lifecycleSettings } = useLifecycleSettings();

  // Children only. Nothing here changes a record — it is a review list.
  const { data: children } = useQuery({
    queryKey: ["children-lifecycle"],
    queryFn: () =>
      fetchAll((f, t) =>
        supabase
          .from("people")
          .select("id, display_name, first_name, last_name, role, gender, birth_date, phone, email")
          .is("deleted_at", null)
          .ilike("role", "child")
          .order("id")
          .range(f, t),
      ),
  });

  const addLifecycleTask = useMutation({
    mutationFn: async (r: LifecycleItem) => {
      const { error } = await supabase.from("tasks").insert({
        person_id: r.personId,
        text: r.label,
        due_date: r.dueDate,
        priority: r.priority,
        status: "upcoming",
        notes: `auto:${r.key} · ${r.detail}`,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Task added");
      queryClient.invalidateQueries({ queryKey: ["tasks-list"] });
    },
    onError: (e: unknown) => void showError(e),
  });

  const addReminderTask = useMutation({
    mutationFn: async (r: EngagementReminder) => {
      const { error } = await supabase.from("tasks").insert({
        person_id: r.personId,
        text: `${r.label}: ${r.name}`,
        due_date: r.dueDate,
        priority: r.priority,
        status: "upcoming",
        notes: `auto:${r.key} · ${r.detail}`,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Task added");
      queryClient.invalidateQueries({ queryKey: ["tasks-list"] });
    },
    onError: (e: unknown) => void showError(e),
  });

  const reminders = [
    ...(dates?.people ?? []).flatMap((p) => {
      const next = nextHebrewAnniversary(p.birth_date);
      if (!next || next.days > 31) return [];
      return [
        {
          key: `b-${p.id}`,
          personId: p.id,
          name: personName(p),
          label: `Hebrew birthday ${next.hebrewLabel} — in ${next.days} day${next.days === 1 ? "" : "s"}`,
          date: next.date.toISOString(),
          days: next.days,
        },
      ];
    }),
    ...(dates?.people ?? []).flatMap((p) => {
      const next = nextHebrewAnniversary(p.anniversary_date);
      if (!next || next.days > 31) return [];
      return [
        {
          key: `a-${p.id}`,
          personId: p.id,
          name: personName(p),
          label: `Hebrew anniversary ${next.hebrewLabel} — in ${next.days} day${next.days === 1 ? "" : "s"}`,
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

  // A reminder disappears once staff have turned it into a real task.
  const alreadyTracked = new Set(
    (data ?? []).flatMap((t) => {
      const m = /auto:([^\s·]+)/.exec(String(t.notes ?? ""));
      return m ? [m[1]] : [];
    }),
  );

  const followUps = [
    ...missedPledgeReminders(missedPledges ?? []),
    ...quietReminders(engagement?.people ?? [], (p) => personName(p)),
    ...giftReminders(engagement?.donations ?? [], (p) => personName(p)),
  ]
    .filter((r) => !alreadyTracked.has(r.key))
    .sort((a, b) => a.sort - b.sort);

  const growingUp = lifecycleItems(
    children ?? [],
    (p) => personName(p),
    lifecycleSettings ?? LIFECYCLE_DEFAULTS,
  ).filter((r) => !alreadyTracked.has(r.key));
  const adultReviews = growingUp.filter((r) => r.kind === "adult").length;

  const overdue = tasks.filter((t) => t.group === "overdue");
  const upcoming = tasks.filter((t) => t.group === "upcoming");
  const weekStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Sunday of the current week
    return d.toISOString().slice(0, 10);
  })();
  const done = tasks.filter(
    (t) => t.group === "done" && (t.completed_at ?? t.created_at ?? "").slice(0, 10) >= weekStart,
  );

  function Row({ t }: { t: (typeof tasks)[number] }) {
    const isDone = t.group === "done";
    async function reopen() {
      // The database reverses everything completing it wrote: the activity entry
      // goes away, and a thank-you task also un-marks the gift's letter.
      const { error } = await supabase
        .from("tasks")
        .update({ status: "upcoming", completed_at: null, completion_note: null })
        .eq("id", t.id);
      if (error) {
        toast.error(await friendlyDbError(error, "Could not reopen this task."));
        return;
      }
      toast.success("Task reopened — the activity entry it added was removed");
      await queryClient.invalidateQueries();
    }
    return (
      <div
        className={`flex gap-3 rounded-2xl border bg-card p-4 shadow-sm ${
          t.group === "overdue" ? "border-urgent/40" : "border-border"
        }`}
      >
        <SelectBox
          checked={selection.has(t.id)}
          onChange={() => selection.toggle(t.id)}
          label="this task"
        />
        <TaskCheckbox
          done={isDone}
          onClick={() => {
            if (!isDone)
              setCompleting({ id: t.id, text: t.text, person_id: t.person_id, owner: t.owner });
            else void reopen();
          }}
        />
        <div className="min-w-0">
          <p
            className={`text-sm ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}
          >
            {t.text}
          </p>
          <p
            className={`mt-1 text-xs ${t.group === "overdue" ? "text-urgent" : "text-muted-foreground"}`}
          >
            Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"} · {t.priority ?? "Normal"}{" "}
            priority
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
          {t.completion_note && (
            <p className="mt-1 text-xs text-muted-foreground">{t.completion_note}</p>
          )}
          {isDone && (
            <button
              type="button"
              className="mt-2 block text-xs text-primary hover:underline"
              onClick={() => void reopen()}
            >
              Reopen this task
            </button>
          )}
          <button
            type="button"
            className="mt-2 block text-xs text-primary hover:underline"
            onClick={() => setEditing(t as unknown as Record<string, unknown>)}
          >
            Edit or remove this task
          </button>
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
      <SelectAllToggle
        visibleIds={tasks.map((t) => t.id)}
        selectedIds={selection.ids}
        onSelectAll={() => selection.selectAll(tasks.map((t) => t.id))}
        onClear={selection.clear}
        noun="tasks"
      />

      <div className="space-y-6">
        {reminders.length > 0 && (
          <section>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Reach out — special dates this month
            </h2>
            <div className="mt-3 space-y-3">
              {reminders.map((r) => (
                <div
                  key={r.key}
                  className="flex gap-3 rounded-2xl border border-suggestion/50 bg-suggestion/10 p-4 shadow-sm"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-suggestion/25 text-suggestion-foreground">
                    <CalendarHeart className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      Reach out to{" "}
                      <Link
                        to="/people/$personId"
                        params={{ personId: r.personId }}
                        className="text-primary hover:underline"
                      >
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

        {followUps.length > 0 && (
          <section>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Follow up — engagement
            </h2>
            <div className="mt-3 space-y-3">
              {followUps.map((r) => (
                <div
                  key={r.key}
                  className="flex gap-3 rounded-2xl border border-suggestion/50 bg-suggestion/10 p-4 shadow-sm"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-suggestion/25 text-suggestion-foreground">
                    <HeartHandshake className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {r.label} —{" "}
                      <Link
                        to="/people/$personId"
                        params={{ personId: r.personId }}
                        className="text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                    <button
                      type="button"
                      disabled={addReminderTask.isPending}
                      className="mt-2 text-xs text-primary hover:underline disabled:opacity-50"
                      onClick={() => addReminderTask.mutate(r)}
                    >
                      Add as task
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {growingUp.length > 0 && (
          <section>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Growing up — for you to decide
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing has been changed automatically.
              {adultReviews > 0
                ? ` ${adultReviews} ${adultReviews === 1 ? "child is" : "children are"} past age ${
                    (lifecycleSettings ?? LIFECYCLE_DEFAULTS).adult_age
                  } and waiting for your review.`
                : ""}
            </p>
            <div className="mt-3 space-y-3">
              {growingUp.map((r) => (
                <div
                  key={r.key}
                  className="flex gap-3 rounded-2xl border border-suggestion/50 bg-suggestion/10 p-4 shadow-sm"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-suggestion/25 text-suggestion-foreground">
                    <GraduationCap className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{r.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <Link
                        to="/people/$personId"
                        params={{ personId: r.personId }}
                        className="text-xs text-primary hover:underline"
                      >
                        Open {r.name}
                      </Link>
                      <button
                        type="button"
                        disabled={addLifecycleTask.isPending}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                        onClick={() => addLifecycleTask.mutate(r)}
                      >
                        Add as task
                      </button>
                    </div>
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
      <BulkRecordBar
        table="tasks"
        noun="task"
        nounPlural="tasks"
        selectedIds={selection.ids}
        onClear={selection.clear}
        visibleIds={tasks.map((t) => t.id)}
        onSelectAll={() => selection.selectAll(tasks.map((t) => t.id))}
      />
      <CompleteTaskDialog task={completing} onOpenChange={(v) => !v && setCompleting(null)} />
      {editing && (
        <EditRecordDialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          table="tasks"
          id={String(editing["id"])}
          record={editing}
          title="Edit task"
          deleteLabel="Remove this task"
          onDeleted={() => setEditing(null)}
          fields={[
            { key: "text", label: "Task", type: "textarea" },
            { key: "due_date", label: "Due date", type: "date" },
            { key: "owner", label: "Owner" },
            {
              key: "priority",
              label: "Priority",
              type: "select",
              options: [
                { value: "High", label: "High" },
                { value: "Normal", label: "Normal" },
                { value: "Low", label: "Low" },
              ],
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
        />
      )}
    </AppShell>
  );
}
