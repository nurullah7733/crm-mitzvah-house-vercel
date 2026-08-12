import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";

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

const GROUPS = ["overdue", "upcoming", "done"] as const;

function TasksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["tasks-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, people(id, first_name, last_name)")
        .order("due_date");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell title="Tasks" subtitle={`${(data ?? []).filter((t) => t.status === "overdue").length} overdue`}>
      {isLoading && <EmptyState label="Loading tasks…" />}
      <div className="space-y-6">
        {GROUPS.map((group) => {
          const items = (data ?? []).filter((t) => t.status === group);
          if (items.length === 0) return null;
          return (
            <section key={group}>
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h2>
              <div className="mt-3 space-y-3">
                {items.map((t) => (
                  <div
                    key={t.id}
                    className={`rounded-2xl border bg-card p-4 shadow-sm ${
                      group === "overdue" ? "border-urgent/40" : "border-border"
                    }`}
                  >
                    <p className="text-sm text-foreground">{t.text}</p>
                    <p className={`mt-1 text-xs ${group === "overdue" ? "text-urgent" : "text-muted-foreground"}`}>
                      Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"} · {t.priority ?? "normal"} priority
                    </p>
                    {t.people && (
                      <Link
                        to="/people/$personId"
                        params={{ personId: t.people.id }}
                        className="mt-2 inline-block text-sm text-primary hover:underline"
                      >
                        {t.people.first_name} {t.people.last_name}
                      </Link>
                    )}
                    {t.completion_note && (
                      <p className="mt-1 text-xs text-muted-foreground">{t.completion_note}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
