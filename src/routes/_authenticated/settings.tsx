import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, RefreshCw, ChevronDown, Mail, RotateCcw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { logChange } from "@/lib/session-log";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/is-admin";
import {
  listStaff,
  inviteStaff,
  resendStaffInvite,
  setStaffRole as setStaffRoleFn,
  removeStaff,
  deleteStaff,
  restoreStaff,
  type StaffAccountStatus,
} from "@/lib/staff.functions";
import { AppShell, formatDate } from "@/components/AppShell";
import { EditableList } from "@/components/EditableList";
import { IntegrationsPanel } from "@/components/settings/IntegrationsPanel";
import { BackupExportPanel } from "@/components/settings/BackupExportPanel";
import { RenewalSettingsPanel } from "@/components/settings/RenewalSettingsPanel";
import { LifecycleSettingsPanel } from "@/components/settings/LifecycleSettingsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { restoreRecords, type ArchivableTable } from "@/lib/archive";

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

        <RecalculateTotalsPanel />

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="backup" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Download a full backup
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <BackupExportPanel />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="renewal" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Renewal outreach
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <RenewalSettingsPanel />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="lifecycle" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Children growing up
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <LifecycleSettingsPanel />
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

        <Accordion type="multiple" defaultValue={[]} className="rounded-2xl border border-border bg-card shadow-sm">
          <AccordionItem value="history" className="border-0">
            <AccordionTrigger className="px-5 py-4 text-base hover:no-underline">
              Change history
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <ChangeHistoryPanel />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </AppShell>
  );
}

const HISTORY_TABLES: Record<string, string> = {
  people: "Contact",
  donations: "Gift",
  events: "Event",
  tasks: "Task",
  campaigns: "Campaign",
  grants: "Grant",
  import_batches: "Import",
};

const RESTORABLE = ["people", "donations", "events", "tasks"] as const;
type RestorableTable = (typeof RESTORABLE)[number];

function ChangeHistoryPanel() {
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();

  // Anything older than two months is cleared by a nightly job in the database,
  // so nobody has to remember to do it. Admins can also clear it on demand.
  const purge = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("purge_old_audit_log");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      toast.success(`Cleared ${count} old ${count === 1 ? "entry" : "entries"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: entries } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const [openRow, setOpenRow] = useState<string | null>(null);

  const restore = useMutation({
    mutationFn: async ({ table, id }: { table: RestorableTable; id: string }) => {
      const n = await restoreRecords(table as ArchivableTable, [id]);
      if (n === 0) throw new Error("That record is not in the removed list any more");
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Restored");
      logChange("Restored a removed record");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Everything anyone has added, edited or removed in the last two months, newest first. Anything
        older is cleared automatically each night. Removed records can be put back, and you can open
        any entry to see exactly what changed.
      </p>
      {isAdmin && (
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={purge.isPending}
          onClick={() => purge.mutate()}
        >
          {purge.isPending ? "Clearing…" : "Clear entries older than two months"}
        </Button>
      )}
      <div className="space-y-2">
        {(entries ?? []).map((row) => {
          const changes = (row.changes ?? {}) as Record<string, unknown>;
          const fields = row.action === "edited" ? Object.keys(changes).filter((k) => k !== "updated_at") : [];
          const canRestore =
            row.action === "deleted" &&
            row.record_id &&
            (RESTORABLE as readonly string[]).includes(row.table_name);
          const open = openRow === row.id;
          return (
            <div key={row.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOpenRow(open ? null : row.id)}
                  className="flex min-w-0 items-center gap-2 text-left"
                  aria-expanded={open}
                >
                  <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
                  <span className="text-sm text-foreground">
                    {HISTORY_TABLES[row.table_name] ?? row.table_name} {row.action.replace("_", " ")}
                    {fields.length > 0 ? ` — ${fields.join(", ")}` : ""}
                  </span>
                </button>
                {canRestore && (
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      restore.mutate({ table: row.table_name as RestorableTable, id: row.record_id as string })
                    }
                  >
                    Restore
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.actor_email ?? "System"} · {formatDate(row.created_at.slice(0, 10))}
              </p>
              {open && <ChangeDetail action={row.action} changes={changes} recordId={row.record_id} table={row.table_name} />}
            </div>
          );
        })}
        {(entries ?? []).length === 0 && <p className="text-sm text-muted-foreground">No changes recorded yet.</p>}
      </div>
    </div>
  );
}

const HIDDEN_DETAIL_FIELDS = new Set(["id", "updated_at", "created_at", "import_batch_id"]);

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ChangeDetail({
  action,
  changes,
  recordId,
  table,
}: {
  action: string;
  changes: Record<string, unknown>;
  recordId: string | null;
  table: string;
}) {
  const rows = Object.entries(changes).filter(([key]) => !HIDDEN_DETAIL_FIELDS.has(key));
  const isEdit = action === "edited";

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3">
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No field details were recorded.</p>}
      {rows.map(([key, value]) => {
        const pair = isEdit && value && typeof value === "object" && "from" in (value as object)
          ? (value as { from?: unknown; to?: unknown })
          : null;
        return (
          <div key={key} className="grid gap-0.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</p>
            {pair ? (
              <p className="break-words text-xs text-foreground">
                <span className="line-through text-muted-foreground">{showValue(pair.from)}</span>{" "}
                <span aria-hidden>→</span> <span className="font-medium">{showValue(pair.to)}</span>
              </p>
            ) : (
              <p className="break-words text-xs text-foreground">{showValue(value)}</p>
            )}
          </div>
        );
      })}
      {recordId && (RESTORABLE as readonly string[]).includes(table) ? (
        <p className="pt-1 text-xs text-muted-foreground">Record ID: {recordId}</p>
      ) : null}
    </div>
  );
}

function RecalculateTotalsPanel() {
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();

  const recalc = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("recalculate_all_giving_totals");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries();
      toast.success(`Rebuilt giving totals for ${count} contacts`);
      logChange("Recalculated all giving totals");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-heading font-semibold">Giving totals</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Totals update themselves whenever a gift is added, changed or removed. Use this only if you
        suspect a figure looks wrong — it rebuilds every contact's lifetime and this-year giving from
        the actual donation records.
      </p>
      <Button
        className="mt-3 rounded-xl"
        variant="outline"
        disabled={recalc.isPending}
        onClick={() => recalc.mutate()}
      >
        <RefreshCw className="size-4" /> {recalc.isPending ? "Recalculating…" : "Recalculate all totals"}
      </Button>
    </section>
  );
}

const STATUS_LABEL: Record<StaffAccountStatus, { label: string; className: string; hint: string }> = {
  active: { label: "Active", className: "bg-money/10 text-money", hint: "Has signed in and can use the CRM." },
  invited: {
    label: "Invited",
    className: "bg-suggestion/15 text-foreground",
    hint: "Invite email sent — waiting for them to choose a password.",
  },
  no_account: {
    label: "No account",
    className: "bg-urgent/10 text-urgent",
    hint: "No login yet. Send an invite so they can get in.",
  },
  disabled: {
    label: "No access",
    className: "bg-muted text-muted-foreground",
    hint: "Their login is switched off. Restore access to let them back in.",
  },
};

function StaffPanel() {
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("va");

  const load = useServerFn(listStaff);
  const invite = useServerFn(inviteStaff);
  const resend = useServerFn(resendStaffInvite);
  const changeRole = useServerFn(setStaffRoleFn);
  const disable = useServerFn(removeStaff);
  const hardDelete = useServerFn(deleteStaff);
  const restore = useServerFn(restoreStaff);

  const { data: staff, isError, error } = useQuery({
    queryKey: ["staff-members"],
    queryFn: () => load(),
    enabled: isAdmin,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-members"] });
  const inviteLink = () => `${window.location.origin}/set-password`;

  const add = useMutation({
    mutationFn: () =>
      invite({
        data: { name: name.trim(), email: email.trim().toLowerCase(), role, redirectTo: inviteLink() },
      }),
    onSuccess: (result) => {
      setName("");
      setEmail("");
      setRole("va");
      refresh();
      toast.success(
        result.invited
          ? "Invite sent — they'll get an email to choose their password"
          : "They already had a login, so it's now linked with this role",
      );
      logChange("Invited a staff member");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resendInvite = useMutation({
    mutationFn: (staffId: string) => resend({ data: { staffId, redirectTo: inviteLink() } }),
    onSuccess: (result: { mode?: string }) => {
      refresh();
      toast.success(
        result?.mode === "invite"
          ? "Invite sent again — any earlier link no longer works"
          : "Sign-in link emailed — they can set a password now. Any earlier link no longer works",
      );
      logChange("Resent a staff invite");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStaffRoleMut = useMutation({
    mutationFn: ({ staffId, role }: { staffId: string; role: Role }) => changeRole({ data: { staffId, role } }),
    onSuccess: () => {
      refresh();
      toast.success("Role updated");
      logChange("Changed a staff role");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (staffId: string) => disable({ data: { staffId } }),
    onSuccess: () => {
      refresh();
      toast.success("Their login has been switched off");
      logChange("Removed staff access");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteForGood = useMutation({
    mutationFn: (staffId: string) => hardDelete({ data: { staffId } }),
    onSuccess: () => {
      refresh();
      toast.success("Deleted — that email address can be invited again");
      logChange("Deleted a staff member");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const putBack = useMutation({
    mutationFn: (staffId: string) => restore({ data: { staffId } }),
    onSuccess: () => {
      refresh();
      toast.success("Access restored");
      logChange("Restored staff access");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <p className="text-xs text-suggestion">
        Only an admin can see and manage staff logins. Ask a director if someone needs access.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Adding someone here creates their login and emails them an invite. They click the link, choose
        their own password, and get the role you picked. Nobody else ever handles their password.
      </p>
      {isError && <p className="mt-2 text-xs text-urgent">{(error as Error)?.message}</p>}

      <div className="mt-3 space-y-2">
        {(staff ?? []).map((s) => {
          const badge = STATUS_LABEL[s.status];
          return (
            <div key={s.id} className="rounded-xl border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{s.email}</p>
                </div>
                <div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">{badge.hint}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={selectClass}
                    value={s.role}
                    aria-label={`Role for ${s.name}`}
                    onChange={(e) => setStaffRoleMut.mutate({ staffId: s.id, role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    disabled={resendInvite.isPending}
                    onClick={() => resendInvite.mutate(s.id)}
                    title="Emails a fresh link to set a password. Any earlier link stops working."
                  >
                    <Mail className="size-4" /> {s.status === "no_account" ? "Send invite" : "Resend invite"}
                  </Button>
                  {s.status === "disabled" ? (
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      disabled={putBack.isPending}
                      onClick={() => putBack.mutate(s.id)}
                    >
                      <RotateCcw className="size-4" /> Restore access
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="shrink-0 rounded-xl text-urgent"
                      aria-label={`Switch off access for ${s.name}`}
                      title="Switch off their login, keeping the record"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="shrink-0 rounded-xl text-urgent"
                    aria-label={`Delete ${s.name} completely`}
                    title="Delete them and their login, so this email can be used again"
                    disabled={deleteForGood.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${s.name} and their login for good? ${s.email} will be free to invite again.`,
                        )
                      ) {
                        deleteForGood.mutate(s.id);
                      }
                    }}
                  >
                    Delete for good
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
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
          <Plus className="size-4" /> {add.isPending ? "Sending…" : "Add & invite"}
        </Button>
      </div>
    </div>
  );
}
