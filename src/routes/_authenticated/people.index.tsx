import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({
    meta: [
      { title: "People | Mitzvah House CRM" },
      { name: "description", content: "Every person Mitzvah House knows, with giving and activity at a glance." },
      { property: "og:title", content: "People | Mitzvah House CRM" },
      { property: "og:description", content: "Every person Mitzvah House knows, with giving and activity at a glance." },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["people-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("*, households(name)")
        .order("last_name");
      if (error) throw error;
      return data;
    },
  });

  const chips = Array.from(new Set((data ?? []).flatMap((p) => p.tags ?? [])));
  const people = (data ?? []).filter((p) => {
    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
    const matchesQ = !q || name.includes(q.toLowerCase()) || (p.email ?? "").toLowerCase().includes(q.toLowerCase());
    const matchesTag = !filter || (p.tags ?? []).includes(filter);
    return matchesQ && matchesTag;
  });

  return (
    <AppShell title="People" subtitle={`${people.length} of ${data?.length ?? 0} people`}>
      <Input
        className="rounded-xl text-base"
        placeholder="Search by name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilter(filter === tag ? null : tag)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                filter === tag
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {isLoading && <EmptyState label="Loading people…" />}
        {!isLoading && people.length === 0 && <EmptyState label="No people match that search." />}
        {people.map((p) => (
          <Link
            key={p.id}
            to="/people/$personId"
            params={{ personId: p.id }}
            className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-heading font-semibold text-foreground">
                  {p.first_name} {p.last_name}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {p.households?.name ?? "No household"} · {p.email ?? p.phone ?? "No contact info"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(p.tags ?? []).map((t) => (
                    <Badge key={t} variant="secondary" className="rounded-full text-[11px] font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-money">{currency(p.lifetime_giving)}</p>
                <p className="text-xs text-muted-foreground">This year {currency(p.this_year_giving)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Last gift {formatDate(p.last_gift_date)}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
