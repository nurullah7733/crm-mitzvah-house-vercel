import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/inbox/review")({
  head: () => ({
    meta: [
      { title: "Data Inbox | Mitzvah House CRM" },
      { name: "description", content: "Imported rows that need a person to review them before they enter the database." },
      { property: "og:title", content: "Data Inbox | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Imported rows that need a person to review them before they enter the database.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataInbox,
});

function DataInbox() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["review-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_queue")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "resolved" | "dismissed" }) => {
      const { error } = await supabase.from("review_queue").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["review-queue-count"] });
      toast.success("Item cleared from the Data Inbox");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = (data ?? []).filter((r) => r.status === "pending");
  const handled = (data ?? []).filter((r) => r.status !== "pending");

  return (
    <AppShell
      title="Data Inbox"
      subtitle={`${pending.length} item${pending.length === 1 ? "" : "s"} waiting for review`}
      action={
        <Link to="/inbox" className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary">
          Import Center
        </Link>
      }
    >
      {isLoading && <EmptyState label="Loading review items…" />}
      {!isLoading && pending.length === 0 && <EmptyState label="Nothing needs review. All clear." />}

      <div className="space-y-3">
        {pending.map((r) => {
          const row = (r.row_data ?? {}) as Record<string, string>;
          return (
            <div key={r.id} className="rounded-2xl border border-suggestion/40 bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-heading font-semibold text-foreground">{r.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.filename ?? "Manual"} · {formatDate(r.created_at?.slice(0, 10))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="rounded-xl"
                    onClick={() => resolve.mutate({ id: r.id, status: "resolved" })}
                  >
                    Mark reviewed
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl text-urgent"
                    onClick={() => resolve.mutate({ id: r.id, status: "dismissed" })}
                  >
                    Discard
                  </Button>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(row).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-muted/50 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-sm text-foreground">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              {(r.candidate_person_ids ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(r.candidate_person_ids ?? []).map((id) => (
                    <Link
                      key={id}
                      to="/people/$personId"
                      params={{ personId: id }}
                      className="rounded-full border border-border px-3 py-1 text-xs text-primary"
                    >
                      Open possible match
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {handled.length > 0 && (
        <section className="mt-6">
          <h2 className="font-heading font-semibold text-foreground">Already handled</h2>
          <div className="mt-2 space-y-2">
            {handled.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                {r.reason} · {r.filename ?? "Manual"} · {r.status}
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}