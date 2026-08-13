import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";
import { HEBREW_MONTHS, hebrewMonthDayFromEnglish, hebrewMonthName } from "@/lib/hebrew";

export type YahrzeitRow = {
  id: string;
  deceased_name: string | null;
  relationship: string | null;
  hebrew_month: number;
  hebrew_day: number;
};

type Draft = { deceased_name: string; relationship: string; hebrew_month: string; hebrew_day: string };

const emptyDraft: Draft = { deceased_name: "", relationship: "", hebrew_month: "1", hebrew_day: "1" };

/**
 * Add, edit and remove yahrzeits. Lives inside the Special dates card's edit mode,
 * and always offers an "Add another yahrzeit" row — even when the list is empty.
 */
export function YahrzeitEditor({
  personId,
  rows,
  onChanged,
}: {
  personId: string;
  rows: readonly YahrzeitRow[];
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Draft | null>(rows.length === 0 ? { ...emptyDraft } : null);
  const [edits, setEdits] = useState<Record<string, Draft>>({});

  const draftFor = (r: YahrzeitRow): Draft =>
    edits[r.id] ?? {
      deceased_name: r.deceased_name ?? "",
      relationship: r.relationship ?? "",
      hebrew_month: String(r.hebrew_month ?? 1),
      hebrew_day: String(r.hebrew_day ?? 1),
    };

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setEdits((e) => ({ ...e, [id]: { ...draftFor(rows.find((r) => r.id === id)!), ...patch } }));

  async function saveExisting(id: string) {
    const d = edits[id];
    if (!d) return;
    if (!d.deceased_name.trim()) return toast.error("Add the name of the person being remembered.");
    setBusy(true);
    const { error } = await supabase
      .from("yahrzeits")
      .update({
        deceased_name: d.deceased_name.trim(),
        relationship: d.relationship.trim() || null,
        hebrew_month: Number(d.hebrew_month),
        hebrew_day: Number(d.hebrew_day),
      })
      .eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setEdits((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    toast.success("Yahrzeit saved");
    await onChanged();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await supabase.from("yahrzeits").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Yahrzeit removed");
    await onChanged();
  }

  async function addNew() {
    if (!adding) return;
    if (!adding.deceased_name.trim()) return toast.error("Add the name of the person being remembered.");
    setBusy(true);
    const { error } = await supabase.from("yahrzeits").insert({
      person_id: personId,
      deceased_name: adding.deceased_name.trim(),
      relationship: adding.relationship.trim() || null,
      hebrew_month: Number(adding.hebrew_month),
      hebrew_day: Number(adding.hebrew_day),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Yahrzeit added");
    setAdding(null);
    await onChanged();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Yahrzeits</p>

      {rows.map((r) => {
        const d = draftFor(r);
        const dirty = Boolean(edits[r.id]);
        return (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <DateFields
              draft={d}
              onChange={(patch) => setDraft(r.id, patch)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {dirty && (
                <Button size="sm" className="min-h-11 rounded-xl" disabled={busy} onClick={() => saveExisting(r.id)}>
                  Save this yahrzeit
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 rounded-xl text-destructive"
                disabled={busy}
                onClick={() => remove(r.id)}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-xl border border-dashed border-border p-3">
          <DateFields draft={adding} onChange={(patch) => setAdding((a) => ({ ...(a ?? emptyDraft), ...patch }))} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11 rounded-xl" disabled={busy} onClick={addNew}>
              Save yahrzeit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 rounded-xl"
              disabled={busy}
              onClick={() => setAdding(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 w-full rounded-xl"
          onClick={() => setAdding({ ...emptyDraft })}
        >
          <Plus className="size-3.5" /> Add another yahrzeit
        </Button>
      )}
    </div>
  );
}

function DateFields({ draft, onChange }: { draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name of the person remembered">
        <Input
          className="text-base"
          value={draft.deceased_name}
          onChange={(e) => onChange({ deceased_name: e.target.value })}
          placeholder="Ben Klein"
        />
      </Field>
      <Field label="Relationship">
        <Input
          className="text-base"
          value={draft.relationship}
          onChange={(e) => onChange({ relationship: e.target.value })}
          placeholder="Father"
        />
      </Field>
      <Field label="Hebrew month">
        <select
          className={selectClass}
          value={draft.hebrew_month}
          onChange={(e) => onChange({ hebrew_month: e.target.value })}
        >
          {HEBREW_MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hebrew day">
        <Input
          className="text-base"
          type="number"
          min={1}
          max={30}
          value={draft.hebrew_day}
          onChange={(e) => onChange({ hebrew_day: e.target.value })}
        />
      </Field>
      <Field
        label="Or enter the English date"
        className="sm:col-span-2"
        hint="We convert it to the Hebrew month and day so it recurs on the Hebrew calendar."
      >
        <Input
          className="text-base"
          type="date"
          onChange={(e) => {
            const hd = hebrewMonthDayFromEnglish(e.target.value);
            if (hd) onChange({ hebrew_month: String(hd.month), hebrew_day: String(hd.day) });
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Observed on {hebrewMonthName(Number(draft.hebrew_month))} {draft.hebrew_day}. In a Hebrew leap year, an Adar
        yahrzeit is observed in Adar II.
      </p>
    </div>
  );
}
