import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChipEditor({
  values,
  options,
  placeholder,
  emptyLabel,
  onChange,
  tone = "secondary",
  linkKind,
}: {
  values: string[];
  options: string[];
  placeholder?: string;
  emptyLabel?: string;
  onChange: (next: string[]) => void;
  tone?: "secondary" | "primary";
  /** When set, each chip links to the People screen filtered by that tag or program. */
  linkKind?: "tag" | "program";
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const add = (label: string) => {
    const v = label.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
    setAdding(false);
  };

  const suggestions = options.filter((o) => !values.includes(o));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && !adding && (
          <span className="text-sm text-muted-foreground">{emptyLabel ?? "None yet."}</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
              tone === "primary"
                ? "bg-primary/10 text-primary"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {linkKind ? (
              <Link
                to="/people"
                search={linkKind === "tag" ? { tag: v } : { program: v }}
                className="hover:underline"
                title={`See everyone with this ${linkKind}`}
              >
                {v}
              </Link>
            ) : (
              v
            )}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="grid size-4 place-items-center rounded-full hover:bg-foreground/10"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {!adding && (
          <button
            type="button"
            aria-label="Add"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" /> Add
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              autoFocus
              className="text-base"
              placeholder={placeholder ?? "Type and press Enter"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(draft);
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
            />
            <Button
              size="sm"
              className="rounded-xl"
              onClick={() => add(draft)}
              disabled={!draft.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions
                .filter((o) => o.toLowerCase().includes(draft.trim().toLowerCase()))
                .slice(0, 12)
                .map((o) => (
                  <Badge
                    key={o}
                    variant="outline"
                    className="cursor-pointer rounded-full text-[11px] font-normal hover:border-primary/50 hover:text-primary"
                    onClick={() => add(o)}
                  >
                    <Plus className="mr-1 size-3" />
                    {o}
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
