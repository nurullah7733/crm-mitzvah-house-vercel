import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/is-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/fields";
import { RENEWAL_DEFAULTS, useRenewalSettings, type RenewalSettings } from "@/lib/renewal";
import { logChange } from "@/lib/session-log";
import { showError } from "@/lib/app-errors";

/** Who counts as a lapsed donor worth reaching out to. */
export function RenewalSettingsPanel() {
  const isAdmin = useIsAdmin();
  const { data } = useRenewalSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RenewalSettings>(RENEWAL_DEFAULTS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: RenewalSettings) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "renewal_outreach", value: next }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      logChange("Updated the renewal outreach thresholds");
      queryClient.invalidateQueries({ queryKey: ["renewal-settings"] });
      queryClient.invalidateQueries({ queryKey: ["renewal-donors"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-renewals"] });
      toast.success("Renewal outreach settings saved");
    },
    onError: (e: unknown) => void showError(e, "Could not save the settings"),
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        A lapsed donor is someone who gave in a past year and hasn't given yet this year. These two
        numbers decide who shows up on the Renewal outreach list.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum lifetime giving">
          <Input
            type="number"
            min={0}
            step={10}
            inputMode="decimal"
            className="text-base"
            value={form.min_total_giving}
            onChange={(e) => setForm({ ...form, min_total_giving: Number(e.target.value) })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Minimum number of past years they gave">
          <Input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            className="text-base"
            value={form.min_prior_years}
            onChange={(e) => setForm({ ...form, min_prior_years: Number(e.target.value) })}
            disabled={!isAdmin}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate(form)} disabled={!isAdmin || save.isPending}>
          Save
        </Button>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">Only an admin can change these.</p>
        )}
      </div>
    </div>
  );
}
