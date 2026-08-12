import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings | Mitzvah House CRM" },
      { name: "description", content: "Account details and the lists that power Mitzvah House CRM." },
      { property: "og:title", content: "Settings | Mitzvah House CRM" },
      { property: "og:description", content: "Account details and the lists that power Mitzvah House CRM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  const { data: metSources } = useQuery({
    queryKey: ["met-source-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("met_source_options").select("*").order("label");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell title="Settings" subtitle="Your account and shared lists">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Signed in as</h2>
          <p className="mt-2 text-sm text-foreground">{user?.email ?? "—"}</p>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">How we met options</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(metSources ?? []).map((m) => (
              <span key={m.id} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                {m.label}
              </span>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
