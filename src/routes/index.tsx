import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Backend Connection Check" },
      {
        name: "description",
        content: "Live status readout confirming the app's backend database connection.",
      },
      { property: "og:title", content: "Backend Connection Check" },
      {
        property: "og:description",
        content: "Live status readout confirming the app's backend database connection.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["connection_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connection_check")
        .select("id, status")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Backend status
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-card-foreground">
          {isLoading ? "Checking…" : error ? "Not reachable" : (data?.status ?? "No row found")}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          {error
            ? error.message
            : data
              ? `Row ${data.id} read live from the connection_check table.`
              : "Waiting for data from the database."}
        </p>
      </div>
    </main>
  );
}
