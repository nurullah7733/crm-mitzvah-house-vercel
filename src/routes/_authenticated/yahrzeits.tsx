import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/yahrzeits")({
  head: () => ({
    meta: [
      { title: "Yahrzeits | Mitzvah House CRM" },
      { name: "description", content: "Memorial anniversaries stored on the Hebrew calendar." },
      { property: "og:title", content: "Yahrzeits | Mitzvah House CRM" },
      { property: "og:description", content: "Memorial anniversaries stored on the Hebrew calendar." },
    ],
  }),
  component: YahrzeitsPage,
});

const HEBREW_MONTHS = [
  "", "Nisan", "Iyyar", "Sivan", "Tammuz", "Av", "Elul", "Tishrei",
  "Cheshvan", "Kislev", "Tevet", "Shevat", "Adar", "Adar II",
];

function YahrzeitsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["yahrzeits-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yahrzeits")
        .select("*, people(id, first_name, last_name)")
        .order("hebrew_month");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell title="Yahrzeits" subtitle="Hebrew month and day — recurs on the Hebrew calendar">
      {isLoading && <EmptyState label="Loading yahrzeits…" />}
      <div className="space-y-3">
        {data?.map((y) => (
          <div key={y.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="font-heading font-semibold text-foreground">{y.deceased_name}</p>
            <p className="text-sm text-muted-foreground">
              {HEBREW_MONTHS[y.hebrew_month] ?? y.hebrew_month} {y.hebrew_day} · {y.relationship ?? "Relative"}
            </p>
            {y.people && (
              <Link
                to="/people/$personId"
                params={{ personId: y.people.id }}
                className="mt-1 inline-block text-sm text-primary hover:underline"
              >
                Observed by {y.people.first_name} {y.people.last_name}
              </Link>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
