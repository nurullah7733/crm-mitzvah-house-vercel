import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Plug } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, formatDate } from "@/components/AppShell";
import { EditableList } from "@/components/EditableList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "marketing", label: "Marketing" },
  { value: "va", label: "VA" },
] as const;
type Role = (typeof ROLES)[number]["value"];

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
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["met-source-options"] });

  const add = useMutation({
    mutationFn: async (label: string) => {
      const { error } = await supabase.from("met_source_options").insert({ label: label.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel("");
      refresh();
      toast.success("Option added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await supabase.from("met_source_options").update({ label }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("met_source_options").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Option removed");
    },
    onError: (e: Error) => toast.error(e.message),
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
          <h2 className="font-heading font-semibold">"Where did we meet them?" options</h2>
          <p className="text-xs text-muted-foreground">Rename or remove any option — changes apply everywhere.</p>
          <div className="mt-3 space-y-2">
            {(metSources ?? []).map((m) => (
              <div key={m.id} className="flex gap-2">
                <Input
                  className="text-base"
                  defaultValue={m.label}
                  onBlur={(e) => {
                    const label = e.target.value.trim();
                    if (label && label !== m.label) rename.mutate({ id: m.id, label });
                  }}
                />
                <Button
                  variant="outline"
                  className="shrink-0 rounded-xl text-urgent"
                  aria-label={`Remove ${m.label}`}
                  onClick={() => remove.mutate(m.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              className="text-base"
              placeholder="Add a new option"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Button
              className="shrink-0 rounded-xl"
              onClick={() => newLabel.trim() && add.mutate(newLabel)}
              disabled={add.isPending}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
