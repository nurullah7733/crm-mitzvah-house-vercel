import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AddHouseholdDialog } from "@/components/forms/AddDialogs";

export const Route = createFileRoute("/_authenticated/households/")({
  head: () => ({
    meta: [
      { title: "Households | Mitzvah House CRM" },
      { name: "description", content: "Households grouped for mailings, with the people who belong to each." },
      { property: "og:title", content: "Households | Mitzvah House CRM" },
      { property: "og:description", content: "Households grouped for mailings, with the people who belong to each." },
    ],
  }),
  component: HouseholdsPage,
});

function HouseholdsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["households-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("households")
        .select("*, people(id, first_name, last_name, role, lifetime_giving, this_year_giving)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Households"
      subtitle="Used for mailings and duplicate detection only"
      action={
        <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add household
        </Button>
      }
    >
      {isLoading && <EmptyState label="Loading households…" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.map((h) => {
          const lifetime = (h.people ?? []).reduce((sum, p) => sum + Number(p.lifetime_giving ?? 0), 0);
          const thisYear = (h.people ?? []).reduce((sum, p) => sum + Number(p.this_year_giving ?? 0), 0);
          return (
            <Link
              key={h.id}
              to="/households/$householdId"
              params={{ householdId: h.id }}
              className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50"
            >
              <h2 className="font-heading font-semibold text-foreground">{h.name}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{h.address ?? "No address"}</p>
              <p className="text-sm text-muted-foreground">{h.phone ?? "No phone"}</p>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="size-4" /> {(h.people ?? []).length} members
                </p>
                <div className="text-right">
                  <p className="font-semibold text-money">{currency(lifetime)}</p>
                  <p className="text-xs text-muted-foreground">{currency(thisYear)} this year</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!isLoading && (data ?? []).length === 0 && <EmptyState label="No households yet." />}
      <AddHouseholdDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppShell>
  );
}
