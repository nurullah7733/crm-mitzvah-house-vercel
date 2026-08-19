import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/is-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/fields";
import { logChange } from "@/lib/session-log";
import { showError } from "@/lib/app-errors";
import {
  MERGE_FIELDS,
  ORG_DEFAULTS,
  ORG_SETTINGS_KEY,
  useOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";

/**
 * The organisation details and letter wording printed on tax statements and
 * acknowledgment letters. Editable here so no developer is needed.
 */
export function OrganizationSettingsPanel() {
  const isAdmin = useIsAdmin();
  const { data } = useOrgSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrgSettings>(ORG_DEFAULTS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: OrgSettings) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: ORG_SETTINGS_KEY, value: next }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      logChange("Updated the organisation details and letter wording");
      queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      toast.success("Saved. New statements and letters will use this.");
    },
    onError: (e: unknown) =>
      void showError(e, {
        area: "Settings",
        action: "Save the organisation details",
        fallback: "Could not save the organisation details",
      }),
  });

  const set = (patch: Partial<OrgSettings>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        These appear at the top of every tax statement and acknowledgment letter. The EIN is
        required on a receipt donors will hand to an accountant.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation name">
          <Input
            className="text-base"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="EIN (tax ID)">
          <Input
            className="text-base"
            placeholder="12-3456789"
            value={form.ein}
            onChange={(e) => set({ ein: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Street address">
          <Input
            className="text-base"
            value={form.address_line1}
            onChange={(e) => set({ address_line1: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Suite or unit">
          <Input
            className="text-base"
            value={form.address_line2}
            onChange={(e) => set({ address_line2: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="City">
          <Input
            className="text-base"
            value={form.city}
            onChange={(e) => set({ city: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="State">
          <Input
            className="text-base"
            value={form.state}
            onChange={(e) => set({ state: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="ZIP code">
          <Input
            className="text-base"
            inputMode="numeric"
            value={form.postal_code}
            onChange={(e) => set({ postal_code: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Phone">
          <Input
            className="text-base"
            type="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Email">
          <Input
            className="text-base"
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Website">
          <Input
            className="text-base"
            value={form.website}
            onChange={(e) => set({ website: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Who signs the letters">
          <Input
            className="text-base"
            value={form.signer_name}
            onChange={(e) => set({ signer_name: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="Their title">
          <Input
            className="text-base"
            value={form.signer_title}
            onChange={(e) => set({ signer_title: e.target.value })}
            disabled={!isAdmin}
          />
        </Field>
      </div>

      <Field
        label="Opening paragraph on a year-end statement"
        hint="Merge fields you can use: {{donor_name}}, {{org_name}}, {{tax_year}}"
      >
        <Textarea
          className="min-h-24 text-base"
          value={form.statement_intro}
          onChange={(e) => set({ statement_intro: e.target.value })}
          disabled={!isAdmin}
        />
      </Field>

      <Field
        label="IRS substantiation wording"
        hint="Printed on every statement where no gift is flagged as goods or services given in return."
      >
        <Textarea
          className="min-h-24 text-base"
          value={form.substantiation_text}
          onChange={(e) => set({ substantiation_text: e.target.value })}
          disabled={!isAdmin}
        />
      </Field>

      <Field
        label="Acknowledgment letter template"
        hint={`Merge fields: ${MERGE_FIELDS.join(" ")}`}
      >
        <Textarea
          className="min-h-48 text-base"
          value={form.acknowledgment_template}
          onChange={(e) => set({ acknowledgment_template: e.target.value })}
          disabled={!isAdmin}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11 rounded-xl"
          onClick={() => save.mutate(form)}
          disabled={!isAdmin || save.isPending}
        >
          Save
        </Button>
        <Button
          variant="outline"
          className="min-h-11 rounded-xl"
          onClick={() => setForm(ORG_DEFAULTS)}
          disabled={!isAdmin}
        >
          Reset the wording to the default
        </Button>
        {!isAdmin && <p className="text-xs text-muted-foreground">Only an admin can change these.</p>}
      </div>
    </div>
  );
}