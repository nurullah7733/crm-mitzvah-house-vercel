import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { selectClass } from "@/components/forms/fields";
import { GRANT_STAGES, personName } from "@/lib/names";
import { logChange } from "@/lib/session-log";

export const Route = createFileRoute("/_authenticated/grants/$grantId")({
  head: () => ({
    meta: [
      { title: "Grant | Mitzvah House CRM" },
      { name: "description", content: "One grant: funder, amounts, deadlines and payments received." },
      { property: "og:title", content: "Grant | Mitzvah House CRM" },
      { property: "og:description", content: "One grant: funder, amounts, deadlines and payments received." },
    ],
  }),
  component: GrantPage,
});

function GrantPage() {
  const { grantId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["grant", grantId],
    queryFn: async () => {
      const [grant, payments, tasks] = await Promise.all([
        supabase
          .from("grants")
          .select(
            "*, funder:funder_id(id, display_name, first_name, last_name), officer:program_officer_id(id, display_name, first_name, last_name), campaigns(id, name)",
          )
          .eq("id", grantId)
          .maybeSingle(),
        supabase
          .from("donations")
          .select("*, people(id, display_name, first_name, last_name)")
          .is("deleted_at", null)
          .eq("grant_id", grantId)
          .order("date", { ascending: false }),
        supabase.from("tasks").select("*").is("deleted_at", null).eq("grant_id", grantId).order("due_date"),
      ]);
      return { grant: grant.data, payments: payments.data ?? [], tasks: tasks.data ?? [] };
    },
  });

  const setStage = useMutation({
    mutationFn: async (stage: string) => {
      const { error } = await supabase.from("grants").update({ stage }).eq("id", grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stage updated");
      logChange("Updated a grant stage");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <EmptyState label="Loading grant…" />
      </AppShell>
    );
  }
  const g = data?.grant;
  if (!g) {
    return (
      <AppShell title="Not found">
        <EmptyState label="We couldn't find that grant." />
      </AppShell>
    );
  }

  const received = (data?.payments ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const outstanding = Number(g.amount_awarded ?? 0) - received;

  return (
    <AppShell
      title={g.name}
      subtitle={personName(g.funder)}
      action={
        <Link
          to="/grants"
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
        >
          <ArrowLeft className="size-4" /> Grants
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Grant details</h2>
          <div className="mt-3 space-y-2 text-sm">
            <Row label="Stage">
              <select
                className={selectClass}
                value={g.stage}
                onChange={(e) => setStage.mutate(e.target.value)}
              >
                {GRANT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Funder">
              <Link to="/people/$personId" params={{ personId: g.funder_id }} className="text-primary hover:underline">
                {personName(g.funder)}
              </Link>
            </Row>
            {g.officer ? (
              <Row label="Program officer">
                <Link to="/people/$personId" params={{ personId: g.officer.id }} className="text-primary hover:underline">
                  {personName(g.officer)}
                </Link>
              </Row>
            ) : null}
            <Row label="Requested">{currency(g.amount_requested)}</Row>
            <Row label="Awarded">
              <span className="font-semibold text-money">{currency(g.amount_awarded)}</span>
            </Row>
            <Row label="Received">{currency(received)}</Row>
            <Row label="Outstanding">
              <span className={outstanding > 0 ? "text-suggestion-foreground" : "text-muted-foreground"}>
                {currency(outstanding)}
              </span>
            </Row>
            <Row label="Restricted to">{g.restricted_program ?? "Unrestricted"}</Row>
            {g.campaigns ? (
              <Row label="Campaign">
                <Link to="/campaigns/$campaignId" params={{ campaignId: g.campaigns.id }} className="text-primary hover:underline">
                  {g.campaigns.name}
                </Link>
              </Row>
            ) : null}
          </div>
          {g.notes ? <p className="mt-4 text-sm text-muted-foreground">{g.notes}</p> : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Deadlines</h2>
          <div className="mt-3 space-y-2 text-sm">
            <Row label="Application">{formatDate(g.application_deadline)}</Row>
            <Row label="Report">{formatDate(g.report_deadline)}</Row>
            <Row label="Renewal">{formatDate(g.renewal_deadline)}</Row>
          </div>
          <h3 className="mt-5 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Linked tasks
          </h3>
          <div className="mt-2">
            {(data?.tasks ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}
            {(data?.tasks ?? []).map((t) => (
              <div key={t.id} className="border-b border-border py-2 last:border-0">
                <p className="text-sm text-foreground">{t.text}</p>
                <p className={`text-xs ${t.status === "overdue" ? "text-urgent" : "text-muted-foreground"}`}>
                  Due {formatDate(t.due_date)} · {t.status}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="font-heading font-semibold">Payments received</h2>
          <p className="text-xs text-muted-foreground">
            Grant payments are recorded as gifts linked to this grant, so they count exactly once.
          </p>
          <div className="mt-2">
            {(data?.payments ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            )}
            {(data?.payments ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
                <div className="min-w-0">
                  {d.people ? (
                    <Link to="/people/$personId" params={{ personId: d.people.id }} className="text-sm text-primary hover:underline">
                      {personName(d.people)}
                    </Link>
                  ) : (
                    <p className="text-sm text-foreground">Unknown</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDate(d.date)} · {d.method ?? "—"}</p>
                </div>
                <p className="shrink-0 font-semibold text-money">{currency(d.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}
