import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/forms/fields";

export type EditField = {
  key: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "number" | "textarea" | "select";
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
  full?: boolean;
};

/**
 * A profile card that flips between reading and editing in place. Read mode keeps
 * whatever markup the page already had, so nothing about the layout changes until
 * someone taps Edit.
 */
export function EditableCard({
  title,
  action,
  fields,
  values,
  onSave,
  children,
  editHint,
  className,
  extraEditor,
}: {
  title: string;
  action?: ReactNode;
  fields: readonly EditField[];
  /** Current values, keyed the same as the fields. */
  values: Record<string, unknown>;
  /** Only the changed keys are handed back. */
  onSave: (patch: Record<string, string | null>) => Promise<void>;
  children: ReactNode;
  editHint?: string;
  className?: string;
  /** Extra controls shown only while editing, beneath the fields. */
  extraEditor?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

  function start() {
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = asText(values[f.key]);
    setDraft(next);
    setEditing(true);
  }

  async function save() {
    const patch: Record<string, string | null> = {};
    for (const f of fields) {
      const before = asText(values[f.key]);
      const after = (draft[f.key] ?? "").trim();
      if (before === after) continue;
      patch[f.key] = after === "" ? null : after;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't save — nothing was lost, try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className ?? ""}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 className="truncate font-heading font-semibold text-foreground">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {!editing && (
            <Button size="sm" variant="outline" className="rounded-xl" onClick={start}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-3">
          {editHint ? <p className="mb-2 text-xs text-muted-foreground">{editHint}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                className={f.full || f.type === "textarea" ? "sm:col-span-2" : ""}
                hint={f.hint ?? null}
              >
                {f.type === "textarea" ? (
                  <Textarea
                    className="text-base"
                    rows={3}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                ) : f.type === "select" ? (
                  <select
                    className={selectClass}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  >
                    <option value="">Not set</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="text-base"
                    type={f.type ?? "text"}
                    inputMode={f.type === "tel" ? "tel" : f.type === "email" ? "email" : f.type === "number" ? "decimal" : undefined}
                    placeholder={f.placeholder ?? ""}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
          {extraEditor ? <div className="mt-4 border-t border-border pt-4">{extraEditor}</div> : null}
          <div className="mt-4 flex gap-2">
            <Button className="rounded-xl" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </section>
  );
}