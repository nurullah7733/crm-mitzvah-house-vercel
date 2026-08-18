import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/is-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/fields";
import { LIFECYCLE_DEFAULTS, useLifecycleSettings, type LifecycleSettings } from "@/lib/lifecycle";
import { logChange } from "@/lib/session-log";
import { showError } from "@/lib/app-errors";

/** When a child should be reviewed for adulthood, and how early bar/bat mitzvahs appear. */
export function LifecycleSettingsPanel() {
  const isAdmin = useIsAdmin();
  const { data } = useLifecycleSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LifecycleSettings>(LIFECYCLE_DEFAULTS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: LifecycleSettings) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "lifecycle", value: next }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      logChange("Updated the growing-up review settings");
      queryClient.invalidateQueries({ queryKey: ["lifecycle-settings"] });
      toast.success("Saved");
    },
    onError: (e: unknown) => void showError(e, "Could not save the settings"),
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Nobody is ever changed from Child to Adult automatically. These two numbers only decide when
        someone shows up on the review list in Tasks and on People.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adult age to review at" hint="Default 18. Staff still decide each one.">
          <Input
            type="number"
            min={12}
            max={30}
            step={1}
            inputMode="numeric"
            className="text-base"
            value={form.adult_age}
            onChange={(e) => setForm({ ...form, adult_age: Number(e.target.value) })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Days ahead to show a bar/bat mitzvah" hint="Default 60 days.">
          <Input
            type="number"
            min={7}
            max={365}
            step={1}
            inputMode="numeric"
            className="text-base"
            value={form.bnm_lead_days}
            onChange={(e) => setForm({ ...form, bnm_lead_days: Number(e.target.value) })}
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
