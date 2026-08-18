import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AddGrantDialog } from "@/components/forms/CampaignGrantDialogs";
import { useSelection, SelectBox, SelectAllToggle } from "@/components/BulkPeopleActions";
import { BulkRecordBar } from "@/components/BulkRecordActions";
import { GRANT_STAGES, personName } from "@/lib/names";

export const Route = createFileRoute("/_authenticated/grants/")({
  head: () => ({
    meta: [
      { title: "Grants | Mitzvah House CRM" },
      { name: "description", content: "Institutional funding tracked through every stage and deadline." },
      { property: "og:title", content: "Grants | Mitzvah House CRM" },
      { property: "og:description", content: "Institutional funding tracked through every stage and deadline." },
    ],
  }),
  component: GrantsPage,
});

function GrantsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const selection = useSelection();

  const { data, isLoading } = useQuery({
    queryKey: ["grants-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grants")
        .select("*, funder:funder_id(id, display_name, first_name, last_name), campaigns(id, name)")
        .order("application_deadline", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const grants = data ?? [];
  const awarded = grants.reduce((sum, g) => sum + Number(g.amount_awarded ?? 0), 0);

  return (
    <AppShell
      title="Grants"
      subtitle={`${grants.length} grants · ${currency(awarded)} awarded`}
      action={
        <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add grant
        </Button>
      }
    >
      {isLoading && <EmptyState label="Loading grants…" />}
      {!isLoading && grants.length === 0 && <EmptyState label="No grants yet." />}

      <SelectAllToggle
        visibleIds={grants.map((g) => g.id)}
        selectedIds={selection.ids}
        onSelectAll={() => selection.selectAll(grants.map((g) => g.id))}
        onClear={selection.clear}
        noun="grants"
      />

      <div className="space-y-6">
        {GRANT_STAGES.map((stage) => {
          const rows = grants.filter((g) => g.stage === stage);
          if (rows.length === 0) return null;
          return (
            <section key={stage}>
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {stage} · {rows.length}
              </h2>
              <div className="mt-2 space-y-3">
                {rows.map((g) => (
                  <div
                    key={g.id}
                    className="rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <SelectBox
                        checked={selection.has(g.id)}
                        onChange={() => selection.toggle(g.id)}
                        label={g.name}
                      />
                      <div className="min-w-0">
                        <Link
                          to="/grants/$grantId"
                          params={{ grantId: g.id }}
                          className="font-heading font-semibold text-primary hover:underline"
                        >
                          {g.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {personName(g.funder)}
                          {g.restricted_program ? ` · ${g.restricted_program}` : ""}
                          {g.campaigns ? ` · ${g.campaigns.name}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {g.application_deadline ? `Application due ${formatDate(g.application_deadline)}` : ""}
                          {g.report_deadline ? ` · Report due ${formatDate(g.report_deadline)}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-heading font-semibold text-money">{currency(g.amount_awarded)}</p>
                        <p className="text-xs text-muted-foreground">requested {currency(g.amount_requested)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <AddGrantDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkRecordBar
        table="grants"
        noun="grant"
        nounPlural="grants"
        selectedIds={selection.ids}
        onClear={selection.clear}
        visibleIds={grants.map((g) => g.id)}
        onSelectAll={() => selection.selectAll(grants.map((g) => g.id))}
      />
    </AppShell>
  );
}
