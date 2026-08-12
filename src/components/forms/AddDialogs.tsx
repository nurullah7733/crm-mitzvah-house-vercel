import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logChange } from "@/lib/session-log";
import { Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass, todayISO } from "@/components/forms/fields";
import { hebrewDateFromEnglish } from "@/lib/hebrew";

type DialogProps = { open: boolean; onOpenChange: (v: boolean) => void };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

function usePeopleMini() {
  return useQuery({
    queryKey: ["people-mini"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("id, first_name, last_name, lifetime_giving, this_year_giving")
        .order("last_name");
      if (error) throw error;
      return data;
    },
  });
}

function useHouseholdsMini() {
  return useQuery({
    queryKey: ["households-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("households").select("id, name, address").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useMetSourceOptions() {
  return useQuery({
    queryKey: ["met-source-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("met_source_options").select("id, label").order("label");
      if (error) throw error;
      return data;
    },
  });
}

export function useProgramOptions() {
  return useQuery({
    queryKey: ["program-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("program_options").select("id, label").order("label");
      if (error) throw error;
      return data;
    },
  });
}

/* ------------------------------------------------------------------ person */

const EMPTY_PERSON = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  met_source: "",
  met_date: "",
  household_id: "",
  new_household: "",
  address: "",
  birth_date: "",
  role: "Adult",
  programs: "",
  tags: "",
  owner: "",
  notes: "",
};

export function AddPersonDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_PERSON);
  const [newSource, setNewSource] = useState("");
  const [showNewSource, setShowNewSource] = useState(false);
  const set = (k: keyof typeof EMPTY_PERSON, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: households } = useHouseholdsMini();
  const { data: metSources } = useMetSourceOptions();
  const hebrew = hebrewDateFromEnglish(form.birth_date);

  const addSource = useMutation({
    mutationFn: async (label: string) => {
      const { data, error } = await supabase
        .from("met_source_options")
        .insert({ label: label.trim() })
        .select("label")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["met-source-options"] });
      set("met_source", row.label);
      setNewSource("");
      setShowNewSource(false);
      toast.success("Saved for future use");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim() && !form.last_name.trim()) throw new Error("A name is required");

      let householdId = form.household_id || null;
      if (form.new_household.trim()) {
        const { data, error } = await supabase
          .from("households")
          .insert({ name: form.new_household.trim(), address: form.address || null, phone: form.phone || null })
          .select("id")
          .single();
        if (error) throw error;
        householdId = data.id;
      } else if (householdId && form.address.trim()) {
        await supabase.from("households").update({ address: form.address.trim() }).eq("id", householdId);
      }

      const list = (value: string) =>
        value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

      const { data: person, error } = await supabase
        .from("people")
        .insert({
          first_name: form.first_name.trim() || "—",
          last_name: form.last_name.trim() || "",
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          met_source: form.met_source || null,
          met_date: form.met_date || todayISO(),
          household_id: householdId,
          birth_date: form.birth_date || null,
          role: form.role,
          programs: list(form.programs),
          tags: list(form.tags),
          owner: form.owner.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const source = form.met_source || "Manual entry";
      const recorded = form.met_date || todayISO();
      const sourceRows = (["phone", "email", "address"] as const)
        .filter((f) => (f === "address" ? form.address.trim() : form[f].trim()))
        .map((field_name) => ({ person_id: person.id, field_name, source, recorded_date: recorded }));
      if (sourceRows.length) await supabase.from("field_sources").insert(sourceRows);

      if (form.notes.trim()) {
        await supabase.from("interactions").insert({
          person_id: person.id,
          type: "note",
          date: todayISO(),
          text: form.notes.trim(),
          author: form.owner.trim() || null,
        });
      }
    },
    onSuccess: () => {
      toast.success("Person added");
      logChange("Added a person");
      refresh();
      setForm(EMPTY_PERSON);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add person"
      description="Only a name is required — everything else can come later."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save person
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input className="text-base" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input className="text-base" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input className="text-base" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input className="text-base" type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>

        <Field label="Where did we meet them?" className="sm:col-span-2">
          <div className="flex gap-2">
            <select value={form.met_source} onChange={(e) => set("met_source", e.target.value)} className={selectClass}>
              <option value="">Not sure yet</option>
              {(metSources ?? []).map((m) => (
                <option key={m.id} value={m.label}>
                  {m.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-xl"
              onClick={() => setShowNewSource((s) => !s)}
            >
              <Plus className="size-4" /> New
            </Button>
          </div>
          {showNewSource && (
            <div className="mt-2 flex gap-2">
              <Input
                className="text-base"
                placeholder="e.g. Farmers market"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
              />
              <Button
                type="button"
                className="shrink-0 rounded-xl"
                onClick={() => newSource.trim() && addSource.mutate(newSource)}
                disabled={addSource.isPending}
              >
                <Check className="size-4" /> Save option
              </Button>
            </div>
          )}
        </Field>

        <Field label="Date met">
          <Input className="text-base" type="date" value={form.met_date} onChange={(e) => set("met_date", e.target.value)} />
        </Field>
        <Field label="Adult or child">
          <select value={form.role} onChange={(e) => set("role", e.target.value)} className={selectClass}>
            <option value="Adult">Adult</option>
            <option value="Child">Child</option>
          </select>
        </Field>

        <Field label="Household">
          <select
            value={form.household_id}
            onChange={(e) => set("household_id", e.target.value)}
            className={selectClass}
            disabled={!!form.new_household.trim()}
          >
            <option value="">No household</option>
            {(households ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Or create a new household">
          <Input
            className="text-base"
            placeholder="e.g. The Cohen Family"
            value={form.new_household}
            onChange={(e) => set("new_household", e.target.value)}
          />
        </Field>

        <Field label="Address" className="sm:col-span-2">
          <Input className="text-base" value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>

        <Field label="Birthday" hint={hebrew ? `Hebrew date: ${hebrew}` : null} className="sm:col-span-2">
          <Input className="text-base" type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
        </Field>

        <Field label="Programs (comma separated)">
          <Input className="text-base" value={form.programs} onChange={(e) => set("programs", e.target.value)} />
        </Field>
        <Field label="Tags (comma separated)">
          <Input className="text-base" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        <Field label="Owner" className="sm:col-span-2">
          <Input className="text-base" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* --------------------------------------------------------------- household */

export function AddHouseholdDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const [form, setForm] = useState({ name: "", address: "", phone: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("A household name is required");
      const { error } = await supabase.from("households").insert({
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Household added");
      logChange("Added a household");
      refresh();
      setForm({ name: "", address: "", phone: "", notes: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add household"
      description="Households are only for mailings and spotting duplicates."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save household
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Household name">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Address">
          <Input className="text-base" value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input className="text-base" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ---------------------------------------------------------------- donation */

export function AddDonationDialog({
  open,
  onOpenChange,
  personId,
}: DialogProps & { personId?: string }) {
  const refresh = useRefresh();
  const { data: people } = usePeopleMini();
  const [form, setForm] = useState({
    person_id: personId ?? "",
    amount: "",
    date: todayISO(),
    campaign: "",
    method: "",
    source: "",
    notes: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const pid = personId ?? form.person_id;
      const amount = Number(form.amount);
      if (!pid) throw new Error("Pick a donor");
      if (!amount || amount <= 0) throw new Error("Enter an amount");

      const { error } = await supabase.from("donations").insert({
        person_id: pid,
        amount,
        date: form.date || todayISO(),
        campaign: form.campaign.trim() || null,
        method: form.method.trim() || null,
        source: form.source.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;

      const person = (people ?? []).find((p) => p.id === pid);
      const thisYear = (form.date || todayISO()).slice(0, 4) === todayISO().slice(0, 4);
      await supabase
        .from("people")
        .update({
          lifetime_giving: Number(person?.lifetime_giving ?? 0) + amount,
          this_year_giving: Number(person?.this_year_giving ?? 0) + (thisYear ? amount : 0),
          last_gift_amount: amount,
          last_gift_date: form.date || todayISO(),
          last_activity_date: todayISO(),
        })
        .eq("id", pid);

      await supabase.from("interactions").insert({
        person_id: pid,
        type: "donation",
        date: form.date || todayISO(),
        text: `Gift of $${amount.toLocaleString()}${form.campaign ? ` — ${form.campaign}` : ""}${
          form.notes ? ` · ${form.notes}` : ""
        }`,
        author: null,
      });
    },
    onSuccess: () => {
      toast.success("Donation logged");
      logChange("Logged a donation");
      refresh();
      setForm({ person_id: personId ?? "", amount: "", date: todayISO(), campaign: "", method: "", source: "", notes: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log donation"
      description="Gifts always attach to a person, never to a household."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save donation
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!personId && (
          <Field label="Donor" className="sm:col-span-2">
            <select value={form.person_id} onChange={(e) => set("person_id", e.target.value)} className={selectClass}>
              <option value="">Choose a person</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Amount">
          <Input
            className="text-base"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label="Date">
          <Input className="text-base" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Campaign">
          <Input className="text-base" value={form.campaign} onChange={(e) => set("campaign", e.target.value)} />
        </Field>
        <Field label="Method">
          <Input className="text-base" placeholder="Check, card, cash…" value={form.method} onChange={(e) => set("method", e.target.value)} />
        </Field>
        <Field label="Source">
          <Input className="text-base" placeholder="Donorbox, Stripe, manual…" value={form.source} onChange={(e) => set("source", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------- event */

export function AddEventDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const { data: programOptions } = useProgramOptions();
  const [newProgram, setNewProgram] = useState(false);
  const [form, setForm] = useState({
    name: "",
    date: todayISO(),
    time: "",
    location: "",
    program: "",
    capacity: "",
    staff_lead: "",
    description: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("An event name is required");
      const { error } = await supabase.from("events").insert({
        name: form.name.trim(),
        date: form.date || todayISO(),
        time: form.time || null,
        location: form.location.trim() || null,
        program: form.program.trim() || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        staff_lead: form.staff_lead.trim() || null,
        description: form.description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event added");
      logChange("Added an event");
      refresh();
      setForm({ name: "", date: todayISO(), time: "", location: "", program: "", capacity: "", staff_lead: "", description: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add event"
      description="Programs are a property of the event."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save event
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Event name" className="sm:col-span-2">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Date">
          <Input className="text-base" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Time">
          <Input className="text-base" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
        </Field>
        <Field label="Location">
          <Input className="text-base" value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
        <Field label="Program / event type">
          {newProgram ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                className="text-base"
                placeholder="New program name"
                value={form.program}
                onChange={(e) => set("program", e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setNewProgram(false);
                  set("program", "");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                className={selectClass}
                value={form.program}
                onChange={(e) => set("program", e.target.value)}
              >
                <option value="">No program</option>
                {(programOptions ?? []).map((o) => (
                  <option key={o.id} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 rounded-xl"
                onClick={() => {
                  setNewProgram(true);
                  set("program", "");
                }}
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
          )}
        </Field>
        <Field label="Capacity">
          <Input className="text-base" type="number" inputMode="numeric" min="0" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
        </Field>
        <Field label="Staff lead">
          <Input className="text-base" value={form.staff_lead} onChange={(e) => set("staff_lead", e.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* -------------------------------------------------------------------- task */

export function AddTaskDialog({ open, onOpenChange, personId }: DialogProps & { personId?: string }) {
  const refresh = useRefresh();
  const { data: people } = usePeopleMini();
  const [form, setForm] = useState({
    person_id: personId ?? "",
    text: "",
    due_date: "",
    priority: "Normal",
    owner: "",
    notes: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.text.trim()) throw new Error("Describe the task");
      const due = form.due_date || null;
      const overdue = !!due && due < todayISO();
      const { error } = await supabase.from("tasks").insert({
        person_id: personId ?? (form.person_id || null),
        text: form.text.trim(),
        due_date: due,
        priority: form.priority,
        owner: form.owner.trim() || null,
        notes: form.notes.trim() || null,
        status: overdue ? "overdue" : "upcoming",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task added");
      logChange("Added a task");
      refresh();
      setForm({ person_id: personId ?? "", text: "", due_date: "", priority: "Normal", owner: "", notes: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add task"
      description="Anything dated in the past is marked overdue automatically."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save task
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!personId && (
          <Field label="Person" className="sm:col-span-2">
            <select value={form.person_id} onChange={(e) => set("person_id", e.target.value)} className={selectClass}>
              <option value="">No specific person</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="What needs doing?" className="sm:col-span-2">
          <Input className="text-base" value={form.text} onChange={(e) => set("text", e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input className="text-base" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => set("priority", e.target.value)} className={selectClass}>
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
          </select>
        </Field>
        <Field label="Assignee" className="sm:col-span-2">
          <Input className="text-base" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ----------------------------------------------------------- complete task */

export type CompletableTask = {
  id: string;
  text: string;
  person_id?: string | null;
  owner?: string | null;
};

export function CompleteTaskDialog({
  task,
  onOpenChange,
}: {
  task: CompletableTask | null;
  onOpenChange: (v: boolean) => void;
}) {
  const refresh = useRefresh();
  const [kind, setKind] = useState<"note" | "call" | "meeting">("note");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!task) return;
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", completion_note: note.trim() || null })
        .eq("id", task.id);
      if (error) throw error;

      if (task.person_id) {
        await supabase.from("interactions").insert({
          person_id: task.person_id,
          type: kind === "meeting" ? "note" : kind,
          date: todayISO(),
          text: note.trim() ? `${task.text} — ${note.trim()}` : `Completed: ${task.text}`,
          author: task.owner ?? null,
        });
        await supabase.from("people").update({ last_activity_date: todayISO() }).eq("id", task.person_id);
      }
    },
    onSuccess: () => {
      toast.success("Task completed");
      logChange("Completed a task");
      refresh();
      setNote("");
      setKind("note");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={!!task}
      onOpenChange={onOpenChange}
      title="Complete task"
      description={task?.text}
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Mark done
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="What kind of activity was this?">
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {(["note", "call", "meeting"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize ${
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Add a note (optional)">
          <Textarea className="text-base" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* --------------------------------------------------------------- checkbox */

export function TaskCheckbox({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? "Completed" : "Mark task complete"}
      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition ${
        done ? "border-money bg-money text-white" : "border-border bg-card hover:border-primary"
      }`}
    >
      {done ? <Check className="size-3.5" /> : null}
    </button>
  );
}