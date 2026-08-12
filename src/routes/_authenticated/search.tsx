import { personInitials, personName } from "@/lib/names";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, daysSince, formatDate, initials } from "@/components/AppShell";
import { describeIntents, parseQuery, runIntents, type SearchPerson } from "@/lib/nl-search";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: (search: Record<string, unknown>): { q?: string | undefined } => ({
    q: typeof search["q"] === "string" && search["q"] ? (search["q"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Search | Mitzvah House CRM" },
      { name: "description", content: "Ask a plain-English question and get the exact list of people it describes." },
      { property: "og:title", content: "Search | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Ask a plain-English question and get the exact list of people it describes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

const EXAMPLES = [
  "donated over 500",
  "gave between 500 and 2000 last year",
  "donors who haven't given this year",
  "relationships going cold",
  "volunteers",
  "upcoming birthdays",
  "met at farmers market",
  "Mitzvah Kitchen",
];

function SearchPage() {
  const { q = "" } = Route.useSearch();

  const { data, isLoading } = useQuery({
    queryKey: ["search-corpus"],
    queryFn: async () => {
      const lastYear = new Date().getFullYear() - 1;
      const [people, interactions, donations, programs, tags] = await Promise.all([
        fetchAll((f, t) => supabase.from("people").select("*, households(name)").is("deleted_at", null).order("id").range(f, t)),
        fetchAll((f, t) => supabase.from("interactions").select("person_id, text, type").order("id").range(f, t)),
        fetchAll((f, t) =>
          supabase
            .from("donations")
            .select("person_id, amount, date")
            .is("deleted_at", null)
            .gte("date", `${lastYear}-01-01`)
            .lte("date", `${lastYear}-12-31`)
            .order("id")
            .range(f, t),
        ),
        supabase.from("program_options").select("label"),
        supabase.from("tag_options").select("label"),
      ]);
      const notes = new Map<string, string[]>();
      for (const i of interactions) {
        const list = notes.get(i.person_id) ?? [];
        list.push(`${i.type ?? ""} ${i.text ?? ""}`);
        notes.set(i.person_id, list);
      }
      const lastYearTotals = new Map<string, number>();
      for (const d of donations) {
        lastYearTotals.set(d.person_id, (lastYearTotals.get(d.person_id) ?? 0) + Number(d.amount ?? 0));
      }
      const rows: (SearchPerson & { household_name: string | null })[] = people.map((p) => ({
        ...p,
        household_name: p.households?.name ?? null,
        interaction_text: (notes.get(p.id) ?? []).join(" | "),
        last_year_giving: lastYearTotals.get(p.id) ?? 0,
      }));
      return {
        people: rows,
        programs: (programs.data ?? []).map((p) => p.label),
        tags: (tags.data ?? []).map((t) => t.label),
      };
    },
  });

  const intents = parseQuery(q, { programs: data?.programs ?? [], tags: data?.tags ?? [] });
  const matches = data ? runIntents(intents, data.people) : [];

  return (
    <AppShell title="Search" subtitle={q ? `“${q}”` : "Ask a question in the bar above"}>
      {q && (
        <div className="rounded-2xl border border-suggestion/40 bg-suggestion/10 p-4">
          <p className="flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-suggestion" /> Understood as: {describeIntents(intents)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading ? "Searching…" : `${matches.length} ${matches.length === 1 ? "person" : "people"} matched`}
          </p>
        </div>
      )}

      {!q && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="font-heading font-semibold">Try asking</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Link
                key={e}
                to="/search"
                search={{ q: e }}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary"
              >
                {e}
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Spelling doesn't have to be perfect — “klien” finds Klein and “sarrah” finds Sarah.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {q && !isLoading && matches.length === 0 && <EmptyState label="Nobody matched that question." />}
        {matches.map((p) => (
          <Link
            key={p.id}
            to="/people/$personId"
            params={{ personId: p.id }}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/50"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-semibold text-primary">
              {personInitials(p)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-heading font-semibold text-primary">
                {personName(p)}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {[p.email, p.phone, p.household_name].filter(Boolean).join(" · ") || "No contact details yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {currency(p.lifetime_giving)} lifetime · {currency(p.this_year_giving)} this year
                {p.last_year_giving ? ` · ${currency(p.last_year_giving)} last year` : ""}
                {p.met_source ? ` · met at ${p.met_source}` : ""}
              </p>
            </div>
            <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
              <p>Last activity</p>
              <p>{formatDate(p.last_activity_date)}</p>
              {daysSince(p.last_activity_date) !== null && <p>{daysSince(p.last_activity_date)} days ago</p>}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}