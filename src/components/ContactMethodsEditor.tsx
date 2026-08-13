import { useState } from "react";
import { Plus, Trash2, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/forms/fields";
import {
  emptyDraft,
  typesFor,
  type ContactMethod,
  type MethodDraft,
  type MethodKind,
} from "@/lib/contact-methods";
import { normalizeEmail } from "@/lib/proper-case";

/* ------------------------------------------------------------------ display */

/** Read-only list of every phone or email on a contact. */
export function ContactMethodList({
  kind,
  rows,
  fallback,
  emptyLabel,
}: {
  kind: MethodKind;
  rows: readonly ContactMethod[];
  /** The single value stored on the contact, used if the list is empty. */
  fallback?: string | null;
  emptyLabel: string;
}) {
  const list = rows.filter((r) => r.kind === kind);
  if (list.length === 0) {
    if ((fallback ?? "").trim()) {
      return (
        <p className="text-sm text-foreground">
          {kind === "phone" ? (
            <a href={`tel:${fallback}`} className="text-primary hover:underline">
              {fallback}
            </a>
          ) : (
            <a href={`mailto:${fallback}`} className="text-primary hover:underline">
              {fallback}
            </a>
          )}
        </p>
      );
    }
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1">
      {list.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
          <a
            href={kind === "phone" ? `tel:${m.value}` : `mailto:${m.value}`}
            className="break-all font-medium text-primary hover:underline"
          >
            {m.value}
          </a>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{m.method_type}</span>
          {m.is_primary && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Main</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- editor */

/**
 * Add, change, remove and re-order the phones and emails on a saved contact.
 * Every change is written straight away, so nothing is lost if the card is closed.
 */
export function ContactMethodsEditor({
  personId,
  rows,
  onChanged,
}: {
  personId: string;
  rows: readonly ContactMethod[];
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<MethodDraft | null>(null);
  const [edits, setEdits] = useState<Record<string, { value: string; method_type: string }>>({});

  const draftFor = (m: ContactMethod) => edits[m.id] ?? { value: m.value, method_type: m.method_type };

  async function run(work: () => Promise<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    const { error } = await work();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(done);
    await onChanged();
    return true;
  }

  async function saveRow(m: ContactMethod) {
    const d = edits[m.id];
    if (!d) return;
    const value = m.kind === "email" ? normalizeEmail(d.value) : d.value.trim();
    if (!value) {
      toast.error("Add a value, or remove the line instead.");
      return;
    }
    const ok = await run(
      () => supabase.from("contact_methods").update({ value, method_type: d.method_type }).eq("id", m.id),
      "Saved",
    );
    if (ok) setEdits((e) => ({ ...e, [m.id]: undefined as unknown as { value: string; method_type: string } }));
  }

  async function addRow() {
    if (!adding) return;
    const value = adding.kind === "email" ? normalizeEmail(adding.value) : adding.value.trim();
    if (!value) {
      toast.error(adding.kind === "phone" ? "Enter a phone number." : "Enter an email address.");
      return;
    }
    const first = !rows.some((r) => r.kind === adding.kind);
    const ok = await run(
      () =>
        supabase.from("contact_methods").insert({
          person_id: personId,
          kind: adding.kind,
          value,
          method_type: adding.method_type,
          is_primary: first,
        }),
      adding.kind === "phone" ? "Phone number added" : "Email added",
    );
    if (ok) setAdding(null);
  }

  function section(kind: MethodKind) {
    const list = rows.filter((r) => r.kind === kind);
    const label = kind === "phone" ? "Phone numbers" : "Email addresses";
    return (
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-2 space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">
              None yet — add the first {kind === "phone" ? "number" : "address"} below.
            </p>
          )}
          {list.map((m) => {
            const d = draftFor(m);
            const dirty = d.value !== m.value || d.method_type !== m.method_type;
            return (
              <div key={m.id} className="grid gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1fr_9rem_auto]">
                <Input
                  className="text-base"
                  type={kind === "phone" ? "tel" : "email"}
                  inputMode={kind === "phone" ? "tel" : "email"}
                  aria-label={`${label} value`}
                  value={d.value}
                  onChange={(e) => setEdits((s) => ({ ...s, [m.id]: { ...d, value: e.target.value } }))}
                />
                <select
                  className={selectClass}
                  aria-label={`${label} type`}
                  value={d.method_type}
                  onChange={(e) => setEdits((s) => ({ ...s, [m.id]: { ...d, method_type: e.target.value } }))}
                >
                  {typesFor(kind).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  {dirty && (
                    <Button size="sm" className="rounded-xl" disabled={busy} onClick={() => void saveRow(m)}>
                      Save
                    </Button>
                  )}
                  {!m.is_primary && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      title="Make this the main one"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => supabase.from("contact_methods").update({ is_primary: true }).eq("id", m.id),
                          "Set as the main one",
                        )
                      }
                    >
                      <Star className="size-3.5" /> Main
                    </Button>
                  )}
                  {m.is_primary && (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Main</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-xl text-urgent"
                    title="Remove"
                    disabled={busy}
                    onClick={() =>
                      void run(() => supabase.from("contact_methods").delete().eq("id", m.id), "Removed")
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}

          {adding?.kind === kind ? (
            <div className="grid gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2 sm:grid-cols-[1fr_9rem_auto]">
              <Input
                className="text-base"
                autoFocus
                type={kind === "phone" ? "tel" : "email"}
                inputMode={kind === "phone" ? "tel" : "email"}
                placeholder={kind === "phone" ? "(404) 555-0100" : "name@example.com"}
                aria-label={`New ${label}`}
                value={adding.value}
                onChange={(e) => setAdding({ ...adding, value: e.target.value })}
              />
              <select
                className={selectClass}
                aria-label={`New ${label} type`}
                value={adding.method_type}
                onChange={(e) => setAdding({ ...adding, method_type: e.target.value })}
              >
                {typesFor(kind).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <Button size="sm" className="rounded-xl" disabled={busy} onClick={() => void addRow()}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAdding(emptyDraft(kind))}
            >
              <Plus className="size-3.5" /> Add another {kind === "phone" ? "phone number" : "email"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {section("phone")}
      {section("email")}
    </div>
  );
}

/* ------------------------------------- draft list, used before a contact exists */

/** Enter several phones / emails on a form, before there is a contact to attach them to. */
export function MethodDraftList({
  kind,
  drafts,
  onChange,
}: {
  kind: MethodKind;
  drafts: MethodDraft[];
  onChange: (next: MethodDraft[]) => void;
}) {
  const label = kind === "phone" ? "Phone numbers" : "Email addresses";
  const update = (i: number, patch: Partial<MethodDraft>) =>
    onChange(drafts.map((d, di) => (di === i ? { ...d, ...patch } : d)));

  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 space-y-2">
        {drafts.map((d, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input
              className="text-base"
              type={kind === "phone" ? "tel" : "email"}
              inputMode={kind === "phone" ? "tel" : "email"}
              placeholder={kind === "phone" ? "(404) 555-0100" : "name@example.com"}
              aria-label={`${label} ${i + 1}`}
              value={d.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <select
              className={selectClass}
              aria-label={`${label} ${i + 1} type`}
              value={d.method_type}
              onChange={(e) => update(i, { method_type: e.target.value })}
            >
              {typesFor(kind).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {drafts.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl text-urgent"
                title="Remove"
                onClick={() => onChange(drafts.filter((_, di) => di !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="rounded-xl"
          onClick={() => onChange([...drafts, emptyDraft(kind)])}
        >
          <Plus className="size-3.5" /> Add another {kind === "phone" ? "phone number" : "email"}
        </Button>
      </div>
    </div>
  );
}