import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mitzvah House CRM" },
      {
        name: "description",
        content:
          "Internal relationship management for Mitzvah House staff: people, donations, events and follow-ups.",
      },
      { property: "og:title", content: "Mitzvah House CRM" },
      {
        property: "og:description",
        content:
          "Internal relationship management for Mitzvah House staff: people, donations, events and follow-ups.",
      },
    ],
  }),
  errorComponent: RouteError,
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <p className="text-sm text-muted-foreground">Loading Mitzvah House…</p>
    </main>
  );
}
