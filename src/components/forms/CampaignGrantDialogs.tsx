import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass, todayISO } from "@/components/forms/fields";
import { logChange } from "@/lib/session-log";
import { CAMPAIGN_STATUSES, GRANT_STAGES, personName } from "@/lib/names";
import { useProgramOptions } from "@/components/forms/AddDialogs";
import { fetchAll } from "@/lib/fetch-all";

type DialogProps = { open: boolean; onOpenChange: (v: boolean) => void };

export function useCampaignsMini() {
  return useQuery({
    queryKey: ["campaigns-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("id, name, status").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useGrantsMini() {
  return useQuery({
    queryKey: ["grants-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grants").select("id, name, stage").order("name");
      if (error) throw error;
      return data;
    },
  });
}

function useContacts(types: readonly string[]) {
  return useQuery({
    queryKey: ["contacts-by-type", types.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("id, display_name, first_name, last_name, contact_type")
        .in("contact_type", [...types]);
      if (error) throw error;
      return (data ?? []).sort((a, b) => personName(a).localeCompare(personName(b)));
    },
  });
}

/* ---------------------------------------------------------------- campaign */

export function AddCampaignDialog({ open, onOpenChange }: DialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    description: "",
    goal_amount: "",
    status: "active",
    start_date: "",
    end_date: "",
    event_id: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: events } = useQuery({
    queryKey: ["events-mini-campaign"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("id, name, date").order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("A campaign name is required");
      const { error } = await supabase.from("campaigns").insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        goal_amount: form.goal_amount ? Number(form.goal_amount) : null,
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        event_id: form.event_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign added");
      logChange("Added a campaign");
      queryClient.invalidateQueries();
      setForm({ name: "", description: "", goal_amount: "", status: "active", start_date: "", end_date: "", event_id: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add campaign"
      description="Progress is always summed from linked gifts — never typed in."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save campaign
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign name" className="sm:col-span-2">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Goal amount">
          <Input
            className="text-base"
            type="number"
            inputMode="decimal"
            min="0"
            value={form.goal_amount}
            onChange={(e) => set("goal_amount", e.target.value)}
          />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)} className={selectClass}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date">
          <Input className="text-base" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="End date">
          <Input className="text-base" type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
        <Field label="Linked event (optional)" className="sm:col-span-2">
          <select value={form.event_id} onChange={(e) => set("event_id", e.target.value)} className={selectClass}>
            <option value="">No event</option>
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------- grant */

const EMPTY_GRANT = {
  name: "",
  funder_id: "",
  program_officer_id: "",
  amount_requested: "",
  amount_awarded: "",
  stage: "researching",
  application_deadline: "",
  report_deadline: "",
  renewal_deadline: "",
  restricted_program: "",
  campaign_id: "",
  notes: "",
};

export function AddGrantDialog({ open, onOpenChange }: DialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_GRANT);
  const set = (k: keyof typeof EMPTY_GRANT, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: funders } = useContacts(["foundation", "organization"]);
  const { data: officers } = useContacts(["individual"]);
  const { data: campaigns } = useCampaignsMini();
  const { data: programs } = useProgramOptions();

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("A grant name is required");
      if (!form.funder_id) throw new Error("Pick the funder (a foundation or organization contact)");
      const { data: grant, error } = await supabase
        .from("grants")
        .insert({
          name: form.name.trim(),
          funder_id: form.funder_id,
          program_officer_id: form.program_officer_id || null,
          amount_requested: form.amount_requested ? Number(form.amount_requested) : null,
          amount_awarded: form.amount_awarded ? Number(form.amount_awarded) : null,
          stage: form.stage,
          application_deadline: form.application_deadline || null,
          report_deadline: form.report_deadline || null,
          renewal_deadline: form.renewal_deadline || null,
          restricted_program: form.restricted_program || null,
          campaign_id: form.campaign_id || null,
          notes: form.notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const deadlineTasks = (
        [
          ["application_deadline", "Submit grant application"],
          ["report_deadline", "Submit grant report"],
          ["renewal_deadline", "Start grant renewal"],
        ] as const
      )
        .filter(([field]) => form[field])
        .map(([field, label]) => ({
          grant_id: grant.id,
          person_id: form.program_officer_id || form.funder_id,
          text: `${label} — ${form.name.trim()}`,
          due_date: form[field],
          owner: null,
          priority: "High",
          status: form[field] < todayISO() ? "overdue" : "upcoming",
        }));
      if (deadlineTasks.length) {
        const { error: taskError } = await supabase.from("tasks").insert(deadlineTasks);
        if (taskError) throw taskError;
      }
      return deadlineTasks.length;
    },
    onSuccess: (count) => {
      toast.success(count ? `Grant added · ${count} deadline task${count === 1 ? "" : "s"} created` : "Grant added");
      logChange("Added a grant");
      queryClient.invalidateQueries();
      setForm(EMPTY_GRANT);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add grant"
      description="Deadlines automatically become tasks so nothing is missed."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save grant
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Grant name" className="sm:col-span-2">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Funder">
          <select value={form.funder_id} onChange={(e) => set("funder_id", e.target.value)} className={selectClass}>
            <option value="">Choose a foundation</option>
            {(funders ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {personName(f)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Program officer (optional)">
          <select
            value={form.program_officer_id}
            onChange={(e) => set("program_officer_id", e.target.value)}
            className={selectClass}
          >
            <option value="">Not known</option>
            {(officers ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {personName(o)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount requested">
          <Input
            className="text-base"
            type="number"
            inputMode="decimal"
            min="0"
            value={form.amount_requested}
            onChange={(e) => set("amount_requested", e.target.value)}
          />
        </Field>
        <Field label="Amount awarded">
          <Input
            className="text-base"
            type="number"
            inputMode="decimal"
            min="0"
            value={form.amount_awarded}
            onChange={(e) => set("amount_awarded", e.target.value)}
          />
        </Field>
        <Field label="Stage" className="sm:col-span-2">
          <select value={form.stage} onChange={(e) => set("stage", e.target.value)} className={selectClass}>
            {GRANT_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Application deadline">
          <Input
            className="text-base"
            type="date"
            value={form.application_deadline}
            onChange={(e) => set("application_deadline", e.target.value)}
          />
        </Field>
        <Field label="Report deadline">
          <Input
            className="text-base"
            type="date"
            value={form.report_deadline}
            onChange={(e) => set("report_deadline", e.target.value)}
          />
        </Field>
        <Field label="Renewal deadline">
          <Input
            className="text-base"
            type="date"
            value={form.renewal_deadline}
            onChange={(e) => set("renewal_deadline", e.target.value)}
          />
        </Field>
        <Field label="Restricted to program">
          <select
            value={form.restricted_program}
            onChange={(e) => set("restricted_program", e.target.value)}
            className={selectClass}
          >
            <option value="">Unrestricted</option>
            {(programs ?? []).map((p) => (
              <option key={p.id} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Linked campaign" className="sm:col-span-2">
          <select value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} className={selectClass}>
            <option value="">No campaign</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}
