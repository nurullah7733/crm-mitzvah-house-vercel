import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FIELD_GROUPS,
  FIELD_HINTS,
  FIELD_LABELS,
  REPEATABLE_FIELDS,
  type FieldKey,
} from "@/lib/import-mapping";

/**
 * The "what is this column?" picker. Long lists are hard for staff to scan, so
 * fields are grouped the way they'd think about a spreadsheet, each one says in
 * plain words what it does, and a search box means nobody has to hunt.
 */
export function FieldPicker({
  value,
  onChange,
  label,
}: {
  value: FieldKey;
  onChange: (field: FieldKey) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIELD_GROUPS.map((g) => ({
      title: g.title,
      fields: g.fields.filter((f) => {
        if (!q) return true;
        return (
          FIELD_LABELS[f].toLowerCase().includes(q) ||
          (FIELD_HINTS[f] ?? "").toLowerCase().includes(q) ||
          g.title.toLowerCase().includes(q)
        );
      }),
    })).filter((g) => g.fields.length > 0);
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Map ${label}`}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-base text-foreground"
        >
          <span className="truncate">{FIELD_LABELS[value]}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields"
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">No field matches “{query}”.</p>
          )}
          {groups.map((g) => (
            <div key={g.title} className="py-1">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </p>
              {g.fields.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    onChange(f);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted ${
                    f === value ? "bg-primary/10" : ""
                  }`}
                >
                  <Check
                    className={`mt-0.5 size-4 shrink-0 ${f === value ? "text-primary" : "opacity-0"}`}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {FIELD_LABELS[f]}
                      {REPEATABLE_FIELDS.includes(f) && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                          can be used more than once
                        </span>
                      )}
                    </span>
                    {FIELD_HINTS[f] && (
                      <span className="block text-xs text-muted-foreground">{FIELD_HINTS[f]}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
