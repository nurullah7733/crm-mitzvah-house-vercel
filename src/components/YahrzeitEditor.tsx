import { useState } from "react";
import { Plus, Trash2, Sunset } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";
import {
  HEBREW_MONTHS,
  hebrewDateFromDeath,
  hebrewMonthDayFromDeath,
  hebrewMonthName,
} from "@/lib/hebrew";

export type YahrzeitRow = {
  id: string;
  deceased_name: string | null;
  relationship: string | null;
  hebrew_month: number;
  hebrew_day: number;
  death_date?: string | null;
  death_after_sunset?: boolean | null;
  needs_sunset_review?: boolean | null;
};

type Draft = {
  deceased_name: string;
  relationship: string;
  hebrew_month: string;
  hebrew_day: string;
  death_date: string;
  death_after_sunset: boolean;
};

const emptyDraft: Draft = {
  deceased_name: "",
  relationship: "",
  hebrew_month: "1",
  hebrew_day: "1",
  death_date: "",
  death_after_sunset: false,
};

/**
 * Add, edit and remove yahrzeits. Lives inside the Special dates card's edit mode,
 * and always offers an "Add yahrzeit" row — even when the list is empty.
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
      death_date: (r.death_date ?? "").slice(0, 10),
      death_after_sunset: Boolean(r.death_after_sunset),
    };

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setEdits((e) => ({ ...e, [id]: { ...draftFor(rows.find((r) => r.id === id)!), ...patch } }));

  async function saveExisting(id: string) {
    const d = edits[id];
    if (!d) return;
    if (!d.deceased_name.trim()) {
      toast.error("Add the name of the person being remembered.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("yahrzeits")
      .update({
        deceased_name: d.deceased_name.trim(),
        relationship: d.relationship.trim() || null,
        hebrew_month: Number(d.hebrew_month),
        hebrew_day: Number(d.hebrew_day),
        death_date: d.death_date || null,
        death_after_sunset: d.death_after_sunset,
        // Saving is the staff member confirming the date, sunset rule included.
        needs_sunset_review: false,
      })
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Yahrzeit removed");
    await onChanged();
  }

  /** Staff confirming an older date is right, without changing it. */
  async function confirmReviewed(id: string) {
    setBusy(true);
    const { error } = await supabase
      .from("yahrzeits")
      .update({ needs_sunset_review: false })
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked as checked");
    await onChanged();
  }

  async function addNew() {
    if (!adding) return;
    if (!adding.deceased_name.trim()) {
      toast.error("Add the name of the person being remembered.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("yahrzeits").insert({
      person_id: personId,
      deceased_name: adding.deceased_name.trim(),
      relationship: adding.relationship.trim() || null,
      hebrew_month: Number(adding.hebrew_month),
      hebrew_day: Number(adding.hebrew_day),
      death_date: adding.death_date || null,
      death_after_sunset: adding.death_after_sunset,
      needs_sunset_review: false,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
            {r.needs_sunset_review ? (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-[#F9C348] bg-[#F9C348]/10 p-3 text-xs">
                <Sunset className="mt-0.5 size-4 shrink-0 text-[#B98600]" />
                <span>
                  Please check this date. It was entered before we asked whether the passing was
                  after sunset — if it was, the yahrzeit falls one Hebrew day later. Enter the
                  English date of passing below and answer the sunset question, then save. Nothing
                  has been changed automatically.
                </span>
              </p>
            ) : null}
            <DateFields draft={d} onChange={(patch) => setDraft(r.id, patch)} />
            <div className="mt-3 flex flex-wrap gap-2">
              {dirty && (
                <Button
                  size="sm"
                  className="min-h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => saveExisting(r.id)}
                >
                  Save
                </Button>
              )}
              {r.needs_sunset_review && !dirty && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => confirmReviewed(r.id)}
                >
                  Date is correct
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
          <DateFields
            draft={adding}
            onChange={(patch) => setAdding((a) => ({ ...(a ?? emptyDraft), ...patch }))}
          />
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
          <Plus className="size-3.5" /> Add yahrzeit
        </Button>
      )}
    </div>
  );
}

function DateFields({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  /** Keep the Hebrew month/day in step with the English date + sunset answer. */
  function applyDeathDate(deathDate: string, afterSunset: boolean) {
    const patch: Partial<Draft> = { death_date: deathDate, death_after_sunset: afterSunset };
    const hd = hebrewMonthDayFromDeath(deathDate, afterSunset);
    if (hd) {
      patch.hebrew_month = String(hd.month);
      patch.hebrew_day = String(hd.day);
    }
    onChange(patch);
  }

  const hebrewFull = draft.death_date
    ? hebrewDateFromDeath(draft.death_date, draft.death_after_sunset)
    : null;

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
        label="Or enter the English date of passing"
        className="sm:col-span-2"
        hint="We convert it to the Hebrew month and day so it recurs on the Hebrew calendar."
      >
        <Input
          className="text-base"
          type="date"
          value={draft.death_date}
          onChange={(e) => applyDeathDate(e.target.value, draft.death_after_sunset)}
        />
      </Field>

      <label className="flex items-start gap-3 rounded-xl border border-border p-3 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[#335AA4]"
          checked={draft.death_after_sunset}
          onChange={(e) => applyDeathDate(draft.death_date, e.target.checked)}
        />
        <span className="text-sm">
          The passing was <strong>after sunset</strong>
          <span className="block text-xs text-muted-foreground">
            A Hebrew day begins at sunset, so a passing after sunset already belongs to the next
            Hebrew day and the yahrzeit is observed a day later. Tick this and we move the date for
            you.
          </span>
        </span>
      </label>

      <p className="text-xs text-muted-foreground sm:col-span-2">
        Observed on {hebrewMonthName(Number(draft.hebrew_month))} {draft.hebrew_day}
        {hebrewFull ? ` (${hebrewFull})` : ""}.
        {draft.death_after_sunset && draft.death_date
          ? " Moved one Hebrew day forward for the after-sunset rule."
          : ""}{" "}
        In a Hebrew leap year, an Adar yahrzeit is observed in Adar II.
      </p>
    </div>
  );
}
