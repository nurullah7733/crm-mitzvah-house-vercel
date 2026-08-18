import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EventDecision, EventOption } from "@/lib/import-links";

/**
 * Deciding what to do with an event name the file mentions. The choice used to
 * apply the instant a dropdown changed, with nothing to press and no
 * confirmation — so it read as broken. Now the choice is drafted, confirmed with
 * a button, and shown back in plain words with a way to change it.
 */
export function EventDecisionPicker({
  name,
  rows,
  events,
  decision,
  onApply,
  onClear,
}: {
  name: string;
  rows: number;
  events: EventOption[];
  decision: EventDecision | undefined;
  onApply: (decision: EventDecision) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<"create" | "existing" | "ignore" | "">("");
  const [eventId, setEventId] = useState("");
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? events.filter((e) => e.name.toLowerCase().includes(q) || e.date.includes(q))
      : events;
    return list.slice(0, 40);
  }, [events, search]);

  const chosenEvent = events.find((e) => e.id === eventId) ?? null;
  const canApply = draft === "create" || draft === "ignore" || (draft === "existing" && !!eventId);

  const applied = !editing && decision;
  if (applied) {
    const label =
      decision.action === "create"
        ? `We'll create a new event called “${name}” and link these ${rows} ${rows === 1 ? "row" : "rows"} to it.`
        : decision.action === "ignore"
          ? "Not linked to any event."
          : `These ${rows === 1 ? "row" : "rows"} will be added to “${
              events.find((e) => e.id === decision.eventId)?.name ?? "an event"
            }”.`;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-money">
          <Check className="mr-1 inline size-4" />
          {label}
        </p>
        <button
          type="button"
          className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          onClick={() => {
            setDraft(decision.action === "existing" ? "existing" : decision.action);
            setEventId(decision.action === "existing" ? decision.eventId : "");
            setEditing(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-muted-foreground">
        We didn't find an event with this name. Pick what to do, then press Apply.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["create", "Create a new event"],
            ["existing", "Use an event we already have"],
            ["ignore", "Don't link anyone"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`rounded-xl border px-3 py-1.5 text-sm ${
              draft === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-foreground"
            }`}
            onClick={() => setDraft(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {draft === "existing" && (
        <div className="rounded-xl border border-border p-2">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              className="h-9 border-0 text-base shadow-none focus-visible:ring-0"
              placeholder="Search your events by name or date"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-1 max-h-52 overflow-y-auto">
            {matches.length === 0 && (
              <p className="px-2 py-2 text-sm text-muted-foreground">No events match that search.</p>
            )}
            {matches.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                  eventId === e.id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                }`}
                onClick={() => setEventId(e.id)}
              >
                <span className="truncate">{e.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.date}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canApply}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => {
            if (draft === "create") onApply({ action: "create" });
            else if (draft === "ignore") onApply({ action: "ignore" });
            else if (draft === "existing" && eventId) onApply({ action: "existing", eventId });
            setEditing(false);
          }}
        >
          Apply
        </button>
        {editing && (
          <button
            type="button"
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        )}
        {draft === "create" && (
          <span className="text-xs text-muted-foreground">
            Creates one event named “{name}”, dated the day of this import — you can rename it later
            on the Events page.
          </span>
        )}
        {draft === "existing" && chosenEvent && (
          <span className="text-xs text-muted-foreground">
            Selected “{chosenEvent.name}” ({chosenEvent.date}).
          </span>
        )}
        {decision && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => {
              onClear();
              setEditing(false);
              setDraft("");
              setEventId("");
            }}
          >
            Clear this answer
          </button>
        )}
      </div>
    </div>
  );
}
