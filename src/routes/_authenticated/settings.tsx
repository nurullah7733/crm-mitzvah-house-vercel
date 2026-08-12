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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  return (
    <AppShell title="Settings" subtitle="Staff, the lists everyone shares, and your integrations">
      <div className="grid gap-5">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold">Signed in as</h2>
          <p className="mt-2 text-sm text-foreground">{user?.email ?? "—"}</p>
        </section>

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="staff" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">Staff</AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <StaffPanel />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="lists" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Lists & labels
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <EditableList
                  table="program_options"
                  title="Programs"
                  description="Programs appear as filters on Events and on each person's profile. Add new ones any time."
                  placeholder="Add a program"
                />
                <EditableList
                  table="tag_options"
                  title="Tags"
                  description="The everyday tags you put on people."
                  placeholder="Add a tag"
                  category="general"
                />
                <EditableList
                  table="met_source_options"
                  title="Where did we meet them? sources"
                  description="Rename or remove any option — changes apply everywhere."
                  placeholder="Add a source"
                />
                <EditableList
                  table="tag_options"
                  title="Important labels"
                  description="Extra labels you want available throughout the CRM — priorities, campaigns, anything you flag."
                  placeholder="Add a label"
                  category="important"
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="integrations" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Integrations
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <IntegrationsPanel />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </AppShell>
  );
}

function StaffPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("va");

  const { data: staff } = useQuery({
    queryKey: ["staff-members"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_members").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-members"] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("staff_members")
        .insert({ name: name.trim(), email: email.trim().toLowerCase(), role });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setEmail("");
      setRole("va");
      refresh();
      toast.success("Staff member added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStaffRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const { error } = await supabase.from("staff_members").update({ role }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Role updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Staff member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Add the people who work in the CRM and set what each one does. They sign in with this email address.
      </p>
      <div className="mt-3 space-y-2">
        {(staff ?? []).map((s) => (
          <div key={s.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
            <p className="text-sm font-medium text-foreground">{s.name}</p>
            <p className="truncate text-sm text-muted-foreground">{s.email}</p>
            <select
              className={selectClass}
              value={s.role}
              aria-label={`Role for ${s.name}`}
              onChange={(e) => setStaffRole.mutate({ id: s.id, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="shrink-0 rounded-xl text-urgent"
              aria-label={`Remove ${s.name}`}
              onClick={() => remove.mutate(s.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {(staff ?? []).length === 0 && <p className="text-sm text-muted-foreground">No staff added yet.</p>}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label="Name">
          <Input className="text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Email">
          <Input
            className="text-base"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@mitzvahhouse.org"
          />
        </Field>
        <Field label="Role">
          <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Button
          className="rounded-xl"
          disabled={!name.trim() || !email.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          <Plus className="size-4" /> Add staff
        </Button>
      </div>
    </div>
  );
}

const STATUSES = [
  { value: "connected", label: "Connected" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "not_connected", label: "Not connected" },
] as const;

function IntegrationsPanel() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("integrations").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("integrations")
        .update({ status, last_sync_at: status === "connected" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integration updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="size-4 text-primary" />
        <h2 className="font-heading font-semibold">Integrations</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Where information comes from and goes to, and when each one last synced.
      </p>
      <div className="space-y-2">
        {(data ?? []).map((i) => (
          <div key={i.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{i.name}</p>
              <p className="text-xs text-muted-foreground">{i.purpose ?? "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Last sync: {i.last_sync_at ? formatDate(i.last_sync_at.slice(0, 10)) : "never"}
            </p>
            <select
              className={selectClass}
              value={i.status}
              aria-label={`Status for ${i.name}`}
              onChange={(e) => update.mutate({ id: i.id, status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
