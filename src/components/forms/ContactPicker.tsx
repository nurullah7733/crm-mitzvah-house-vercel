import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";
import { personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";
import { logChange } from "@/lib/session-log";

type ContactType = "individual" | "organization" | "foundation";

export function useContactsByType(types: readonly ContactType[]) {
  return useQuery({
    queryKey: ["contacts-by-type", [...types].sort().join(",")],
    queryFn: async () => {
      const rows = await fetchAll((f, t) =>
        supabase
          .from("people")
          .select("id, display_name, first_name, last_name, contact_type")
          .in("contact_type", [...types])
          .is("deleted_at", null)
          .order("id")
          .range(f, t),
      );
      return rows.sort((a, b) => personName(a).localeCompare(personName(b)));
    },
  });
}

/**
 * A contact dropdown that can also create the contact on the spot, so staff never
 * have to leave a form, add a foundation elsewhere, and start over.
 */
export function ContactPicker({
  label,
  types,
  value,
  onChange,
  emptyLabel = "Not linked",
  newLabel = "New",
  parentOrgId,
  className,
  hint,
}: {
  label: string;
  types: readonly ContactType[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel?: string;
  newLabel?: string;
  /** When creating an individual, link them to this organization/foundation. */
  parentOrgId?: string;
  className?: string;
  hint?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: contacts } = useContactsByType(types);
  const [creating, setCreating] = useState(false);
  const individual = types.includes("individual");
  const [draft, setDraft] = useState({ first_name: "", last_name: "", org_name: "", contact_type: types[0] ?? "individual" });

  const create = useMutation({
    mutationFn: async () => {
      const payload = individual
        ? {
            contact_type: "individual",
            first_name: draft.first_name.trim() || null,
            last_name: draft.last_name.trim() || null,
            parent_org_id: parentOrgId || null,
          }
        : {
            contact_type: draft.contact_type,
            display_name: draft.org_name.trim(),
          };
      if (individual && !draft.first_name.trim() && !draft.last_name.trim()) {
        throw new Error("Enter a name first");
      }
      if (!individual && !draft.org_name.trim()) throw new Error("Enter a name first");
      const { data, error } = await supabase.from("people").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["contacts-by-type"] });
      queryClient.invalidateQueries({ queryKey: ["people-mini"] });
      onChange(id);
      setDraft({ first_name: "", last_name: "", org_name: "", contact_type: types[0] ?? "individual" });
      setCreating(false);
      logChange("Added a contact");
      toast.success("Contact created and selected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Field label={label} className={className} hint={hint}>
      <div className="flex gap-2">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          <option value="">{emptyLabel}</option>
          {(contacts ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {personName(c)}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={() => setCreating((c) => !c)}>
          <Plus className="size-4" /> {newLabel}
        </Button>
      </div>
      {creating && (
        <div className="mt-2 grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
          {individual ? (
            <>
              <Input
                className="text-base"
                placeholder="First name"
                value={draft.first_name}
                onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
              />
              <Input
                className="text-base"
                placeholder="Last name"
                value={draft.last_name}
                onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
              />
            </>
          ) : (
            <>
              <Input
                className="text-base"
                placeholder="Foundation or organization name"
                value={draft.org_name}
                onChange={(e) => setDraft((d) => ({ ...d, org_name: e.target.value }))}
              />
              <select
                className={selectClass}
                value={draft.contact_type}
                aria-label="Contact type"
                onChange={(e) => setDraft((d) => ({ ...d, contact_type: e.target.value as ContactType }))}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t === "foundation" ? "Foundation" : "Organization"}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="button"
              className="rounded-xl"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <Check className="size-4" /> Create and use
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Only the name is needed now — phone, email and the rest can be filled in on their profile later.
          </p>
        </div>
      )}
    </Field>
  );
}