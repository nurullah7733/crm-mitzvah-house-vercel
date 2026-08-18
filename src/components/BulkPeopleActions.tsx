import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Merge, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { MergeContactsDialog } from "@/components/MergeContactsDialog";

/** Shared multi-select state for any list of people. */
export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const clear = useCallback(() => setIds([]), []);
  const selectAll = useCallback((all: string[]) => setIds(all), []);

  return useMemo(
    () => ({ ids, toggle, clear, selectAll, has: (id: string) => ids.includes(id), count: ids.length }),
    [ids, toggle, clear, selectAll],
  );
}

/** Checkbox for a row; stops the click from opening the person. */
export function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className="inline-flex shrink-0 items-center p-1"
    >
      <Checkbox checked={checked} aria-label={`Select ${label}`} />
    </span>
  );
}

/**
 * "Select everything showing" control that sits above a list, so staff don't
 * have to tick a box first to be offered it. It always covers exactly the rows
 * the current search and filters produce.
 */
export function SelectAllToggle({
  visibleIds,
  selectedIds,
  onSelectAll,
  onClear,
  noun,
}: {
  visibleIds: string[];
  selectedIds: string[];
  onSelectAll: () => void;
  onClear: () => void;
  noun: string;
}) {
  if (visibleIds.length === 0) return null;
  const allSelected = selectedIds.length >= visibleIds.length;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span
        onClick={() => (allSelected ? onClear() : onSelectAll())}
        className="inline-flex cursor-pointer items-center gap-2"
      >
        <Checkbox checked={allSelected} aria-label={`Select all ${noun} matching these filters`} />
        <span className="text-sm text-foreground">
          {allSelected
            ? `All ${visibleIds.length} ${noun} selected`
            : `Select all ${visibleIds.length} ${noun} matching these filters`}
        </span>
      </span>
      {selectedIds.length > 0 && (
        <button type="button" className="ml-auto text-xs text-muted-foreground underline" onClick={onClear}>
          Clear selection
        </button>
      )}
    </div>
  );
}

type ExtraAction = { label: string; run: (ids: string[]) => Promise<void>; icon?: React.ReactNode };

/**
 * Floating bar shown when one or more people are selected. Lets staff add a tag,
 * add a program (list), register everyone for an event, or remove the records.
 */
export function BulkPeopleBar({
  selectedIds,
  onClear,
  visibleIds,
  onSelectAll,
  extraAction,
}: {
  selectedIds: string[];
  onClear: () => void;
  visibleIds: string[];
  onSelectAll: () => void;
  extraAction?: ExtraAction | undefined;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<null | "tag" | "program" | "event" | "delete">(null);
  const [value, setValue] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);

  const { data: options } = useQuery({
    queryKey: ["bulk-options"],
    queryFn: async () => {
      const [tags, programs, events] = await Promise.all([
        supabase.from("tag_options").select("label").order("label"),
        supabase.from("program_options").select("label").order("label"),
        supabase.from("events").select("id, name, date").is("deleted_at", null).order("date", { ascending: false }),
      ]);
      return {
        tags: (tags.data ?? []).map((t) => t.label),
        programs: (programs.data ?? []).map((p) => p.label),
        events: events.data ?? [],
      };
    },
  });

  const finish = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries();
    setMode(null);
    setValue("");
    onClear();
  };

  const addLabel = useMutation({
    mutationFn: async ({ kind, label }: { kind: "tags" | "programs"; label: string }) => {
      const { data, error } = await supabase.from("people").select(`id, ${kind}`).in("id", selectedIds);
      if (error) throw error;
      for (const row of data ?? []) {
        const current = ((row as Record<string, unknown>)[kind] as string[] | null) ?? [];
        if (current.some((c) => c.toLowerCase() === label.toLowerCase())) continue;
        const { error: upErr } = await supabase
          .from("people")
          .update({ [kind]: [...current, label] } as never)
          .eq("id", row.id);
        if (upErr) throw upErr;
      }
    },
    onSuccess: (_d, v) => finish(`Added “${v.label}” to ${selectedIds.length} ${selectedIds.length === 1 ? "person" : "people"}`),
    onError: (e: Error) => toast.error(e.message),
  });

  const addToEvent = useMutation({
    mutationFn: async (eventId: string) => {
      const { data: existing, error } = await supabase
        .from("registrations")
        .select("person_id")
        .eq("event_id", eventId)
        .in("person_id", selectedIds);
      if (error) throw error;
      const already = new Set((existing ?? []).map((r) => r.person_id));
      const rows = selectedIds
        .filter((id) => !already.has(id))
        .map((id) => ({ event_id: eventId, person_id: id, status: "registered" }));
      if (rows.length === 0) return 0;
      const { error: insErr } = await supabase.from("registrations").insert(rows);
      if (insErr) throw insErr;
      return rows.length;
    },
    onSuccess: (n) => finish(n === 0 ? "Everyone was already registered" : `Registered ${n} for the event`),
    onError: (e: Error) => toast.error(e.message),
  });

  const removePeople = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("people")
        .update({ deleted_at: new Date().toISOString() } as never)
        .in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => finish("Removed — hidden now, and recoverable from the change history"),
    onError: (e: Error) => toast.error(e.message),
  });

  const runExtra = useMutation({
    mutationFn: async () => {
      if (extraAction) await extraAction.run(selectedIds);
    },
    onSuccess: () => finish("Done"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (selectedIds.length === 0) return null;
  const allSelected = visibleIds.length > 0 && selectedIds.length >= visibleIds.length;
  const busy = addLabel.isPending || addToEvent.isPending || removePeople.isPending || runExtra.isPending;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-3 lg:bottom-6">
        <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.length} selected
          </span>
          {!allSelected && (
            <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={onSelectAll}>
              Select all {visibleIds.length} matching these filters
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setMode("tag")}>
              <Tag className="size-4" /> Add tag
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setMode("program")}>
              <Check className="size-4" /> Add to list
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setMode("event")}>
              <CalendarPlus className="size-4" /> Add to event
            </Button>
            {selectedIds.length === 2 && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setMergeOpen(true)}>
                <Merge className="size-4" /> Merge
              </Button>
            )}
            {extraAction && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={busy}
                onClick={() => runExtra.mutate()}
              >
                {extraAction.icon}
                {extraAction.label}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-urgent/40 text-urgent"
              onClick={() => setMode("delete")}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
            <Button variant="ghost" size="sm" className="rounded-xl" onClick={onClear} aria-label="Clear selection">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ResponsiveModal
        open={mode === "tag" || mode === "program"}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "program" ? "Add to a list or program" : "Add a tag"}
        description={`This applies to all ${selectedIds.length} selected.`}
        footer={
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl sm:flex-none"
              disabled={!value.trim() || busy}
              onClick={() =>
                addLabel.mutate({ kind: mode === "program" ? "programs" : "tags", label: value.trim() })
              }
            >
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <Input
          className="rounded-xl text-base"
          placeholder={mode === "program" ? "e.g. Mitzvah Kitchen" : "e.g. Volunteer"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {((mode === "program" ? options?.programs : options?.tags) ?? []).map((label) => (
            <button
              key={label}
              onClick={() => setValue(label)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                value === label ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </ResponsiveModal>

      <ResponsiveModal
        open={mode === "event"}
        onOpenChange={(o) => !o && setMode(null)}
        title="Add to an event"
        description={`Registers all ${selectedIds.length} selected. Anyone already registered is skipped.`}
      >
        <div className="space-y-2">
          {(options?.events ?? []).map((ev) => (
            <button
              key={ev.id}
              disabled={busy}
              onClick={() => addToEvent.mutate(ev.id)}
              className="w-full rounded-xl border border-border p-3 text-left transition hover:border-primary/50"
            >
              <p className="font-medium text-foreground">{ev.name}</p>
              <p className="text-xs text-muted-foreground">{ev.date}</p>
            </button>
          ))}
          {(options?.events ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          )}
        </div>
      </ResponsiveModal>

      <ResponsiveModal
        open={mode === "delete"}
        onOpenChange={(o) => !o && setMode(null)}
        title={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? "person" : "people"}?`}
        description="They're hidden from every screen and recoverable from the change history."
        footer={
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl bg-urgent text-white hover:bg-urgent/90 sm:flex-none"
              disabled={busy}
              onClick={() => removePeople.mutate()}
            >
              {busy ? "Removing…" : "Yes, delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Their donations and history stay in the change history, so nothing is lost permanently.
        </p>
      </ResponsiveModal>

      {selectedIds.length === 2 && (
        <MergeContactsDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          lockSelection
          primaryId={selectedIds[0]!}
          suggestedIds={[selectedIds[1]!]}
          onMerged={() => onClear()}
        />
      )}
    </>
  );
}