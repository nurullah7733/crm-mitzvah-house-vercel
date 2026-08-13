import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/forms/fields";
import { logChange } from "@/lib/session-log";
import { friendlyDbError } from "@/lib/db-errors";

export type EditableTable = "people" | "donations" | "events" | "tasks";

export type EditField = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "email" | "tel" | "textarea" | "select";
  options?: { value: string; label: string }[];
};

/**
 * One edit form for any record, plus a soft delete. Deleting sets deleted_at,
 * so the record disappears from every screen but nothing is destroyed and the
 * change history keeps a full copy.
 */
export function EditRecordDialog({
  open,
  onOpenChange,
  table,
  id,
  record,
  fields,
  title,
  deleteLabel = "Delete",
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: EditableTable;
  id: string;
  record: Record<string, unknown>;
  fields: EditField[];
  title: string;
  deleteLabel?: string;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const f of fields) {
      const raw = record[f.key];
      next[f.key] = raw === null || raw === undefined ? "" : String(raw);
    }
    setValues(next);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        patch[f.key] = v === "" ? null : f.type === "number" ? Number(v) : v;
      }
      const { error } = await supabase.from(table).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Changes saved");
      logChange(`Edited a record in ${table}`);
      onOpenChange(false);
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  const softDelete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Removed — it's hidden now, and recoverable from the change history");
      logChange(`Deleted a record in ${table}`);
      onOpenChange(false);
      onDeleted?.();
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            {f.type === "textarea" ? (
              <Textarea
                className="text-base"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : f.type === "select" ? (
              <select
                className={selectClass}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className="text-base"
                type={f.type ?? "text"}
                {...(f.type === "number" ? { inputMode: "decimal" as const } : {})}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-urgent/30 bg-urgent/5 p-3">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-foreground">Remove this for everyone?</p>
            <Button
              variant="outline"
              className="rounded-xl text-urgent"
              disabled={softDelete.isPending}
              onClick={() => softDelete.mutate()}
            >
              {softDelete.isPending ? "Removing…" : "Yes, remove it"}
            </Button>
            <Button variant="ghost" className="rounded-xl" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <button type="button" className="text-sm text-urgent hover:underline" onClick={() => setConfirmDelete(true)}>
            {deleteLabel}
          </button>
        )}
      </div>
    </ResponsiveModal>
  );
}