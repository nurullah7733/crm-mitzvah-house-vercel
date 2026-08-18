import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass, todayISO } from "@/components/forms/fields";
import { logChange } from "@/lib/session-log";
import { friendlyDbError } from "@/lib/db-errors";
import {
  FREQUENCY_LABELS,
  STATUS_LABELS,
  type Pledge,
  type PledgeFrequency,
  type PledgeStatus,
} from "@/lib/pledges";

/** Record what a donor has promised. The money itself is still logged as donations. */
export function PledgeDialog({
  open,
  onOpenChange,
  personId,
  pledge,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personId: string;
  pledge?: Pledge | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    amount: "",
    frequency: "monthly" as PledgeFrequency,
    start_date: todayISO(),
    end_date: "",
    status: "active" as PledgeStatus,
    campaign_id: "",
    grace_days: "7",
    notes: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setForm({
      amount: pledge ? String(pledge.amount) : "",
      frequency: pledge?.frequency ?? "monthly",
      start_date: pledge?.start_date ?? todayISO(),
      end_date: pledge?.end_date ?? "",
      status: pledge?.status ?? "active",
      campaign_id: pledge?.campaign_id ?? "",
      grace_days: String(pledge?.grace_days ?? 7),
      notes: pledge?.notes ?? "",
    });
  }, [open, pledge]);

  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      if (!amount || amount <= 0) throw new Error("Enter the amount they pledged");
      const row = {
        person_id: personId,
        amount,
        frequency: form.frequency,
        start_date: form.start_date || todayISO(),
        end_date: form.end_date || null,
        status: form.status,
        campaign_id: form.campaign_id || null,
        grace_days: Number(form.grace_days) || 0,
        notes: form.notes.trim() || null,
      };
      const { error } = pledge
        ? await supabase.from("pledges").update(row).eq("id", pledge.id)
        : await supabase.from("pledges").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(pledge ? "Pledge updated" : "Pledge saved");
      logChange(pledge ? "Updated a pledge" : "Added a pledge");
      queryClient.invalidateQueries({ queryKey: ["pledges", personId] });
      queryClient.invalidateQueries({ queryKey: ["pledge-summary"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      void friendlyDbError(e, "That pledge didn't save.").then((why) => toast.error(why));
    },
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={pledge ? "Edit pledge" : "Add a pledge or recurring gift"}
      description="A pledge is a promise. Payments are still logged as donations and linked back here."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl sm:flex-none"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {pledge ? "Save changes" : "Save pledge"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount each time">
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
        <Field label="How often">
          <select className={selectClass} value={form.frequency} onChange={(e) => set("frequency", e.target.value)}>
            {(Object.keys(FREQUENCY_LABELS) as PledgeFrequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts">
          <Input className="text-base" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="Ends (optional)" hint="Leave blank for an open-ended commitment.">
          <Input className="text-base" type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
            {(Object.keys(STATUS_LABELS) as PledgeStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Campaign (optional)">
          <select className={selectClass} value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)}>
            <option value="">No campaign</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Days of grace" hint="How late a payment can be before we flag it." className="sm:col-span-2">
          <Input
            className="text-base"
            type="number"
            inputMode="numeric"
            min="0"
            value={form.grace_days}
            onChange={(e) => set("grace_days", e.target.value)}
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}
