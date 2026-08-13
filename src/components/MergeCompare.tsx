import { useMemo } from "react";
import { ChevronDown } from "lucide-react";

export type MergeField = { key: string; label: string };

export type MergeState = "match" | "fill" | "conflict" | "union" | "empty";

export type MergeRow = {
  key: string;
  label: string;
  left: unknown;
  right: unknown;
  state: MergeState;
};

export type Side = "left" | "right";

function isBlank(v: unknown) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

/** How a value reads on screen. */
export function showValue(v: unknown) {
  if (isBlank(v)) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/**
 * Compare two records field by field.
 * "fill" means only one side has a value — that value is always kept, no question asked.
 * "conflict" means both sides have different values, and a person must choose.
 * Lists (tags, programs) are always combined.
 */
export function diffRecords(
  fields: readonly MergeField[],
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): MergeRow[] {
  return fields.map(({ key, label }) => {
    const a = left[key] ?? null;
    const b = right[key] ?? null;
    let state: MergeState = "empty";
    if (Array.isArray(a) || Array.isArray(b)) {
      state = isBlank(a) && isBlank(b) ? "empty" : "union";
    } else if (!isBlank(a) && !isBlank(b)) {
      state = norm(a) === norm(b) ? "match" : "conflict";
    } else if (isBlank(a) !== isBlank(b)) {
      state = "fill";
    }
    return { key, label, left: a, right: b, state };
  });
}

function unionList(a: unknown, b: unknown) {
  const out: string[] = [];
  for (const v of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const s = String(v ?? "").trim();
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

/** The record that will be saved: filled values kept automatically, conflicts as chosen. */
export function mergedResult(
  rows: readonly MergeRow[],
  picks: Record<string, Side>,
  defaultSide: Side,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.state === "union") {
      out[r.key] = unionList(r.left, r.right);
      continue;
    }
    if (r.state === "conflict") {
      const side = picks[r.key] ?? defaultSide;
      out[r.key] = side === "left" ? r.left : r.right;
      continue;
    }
    out[r.key] = isBlank(r.left) ? r.right : r.left;
  }
  return out;
}

/** Only the values we actually want to write (blank values are left alone). */
export function writableValues(merged: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v;
      continue;
    }
    if (!isBlank(v)) out[k] = v;
  }
  return out;
}

/**
 * The shared merge screen: only real conflicts ask a question, everything that
 * only one record has is kept automatically, matching fields collapse, and the
 * result is previewed live.
 */
export function MergeCompare({
  rows,
  picks,
  onPick,
  onUseAll,
  leftLabel,
  rightLabel,
  defaultSide,
}: {
  rows: MergeRow[];
  picks: Record<string, Side>;
  onPick: (key: string, side: Side) => void;
  onUseAll: (side: Side) => void;
  leftLabel: string;
  rightLabel: string;
  defaultSide: Side;
}) {
  const conflicts = rows.filter((r) => r.state === "conflict");
  const kept = rows.filter((r) => r.state === "fill" || r.state === "union");
  const matches = rows.filter((r) => r.state === "match");
  const merged = useMemo(() => mergedResult(rows, picks, defaultSide), [rows, picks, defaultSide]);

  return (
    <div className="space-y-3">
      {conflicts.length === 0 ? (
        <p className="rounded-xl bg-money/10 px-3 py-2 text-sm text-foreground">
          Nothing disagrees — every detail from both records is kept.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {conflicts.length} {conflicts.length === 1 ? "field needs" : "fields need"} your choice
            </p>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => onUseAll("left")}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                Use all from {leftLabel}
              </button>
              <button
                onClick={() => onUseAll("right")}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                Use all from {rightLabel}
              </button>
            </div>
          </div>
          {conflicts.map((r) => {
            const side = picks[r.key] ?? defaultSide;
            return (
              <div key={r.key} className="rounded-xl border border-suggestion/50 bg-suggestion/10 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{r.label}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(["left", "right"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => onPick(r.key, s)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        side === s
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <span className="block text-[11px] text-muted-foreground">
                        {s === "left" ? leftLabel : rightLabel}
                      </span>
                      <span className="break-words">{showValue(s === "left" ? r.left : r.right)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {kept.length > 0 && (
        <div className="rounded-xl border border-border p-3">
          <p className="text-sm font-medium text-foreground">Kept automatically</p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {kept.map((r) => (
              <li key={r.key}>
                <span className="text-foreground">{r.label}:</span> {showValue(merged[r.key])}
              </li>
            ))}
          </ul>
        </div>
      )}

      {matches.length > 0 && (
        <details className="rounded-xl border border-border p-3">
          <summary className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground">
            <ChevronDown className="size-4" /> {matches.length} {matches.length === 1 ? "field matches" : "fields match"}
          </summary>
          <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
            {matches.map((r) => (
              <li key={r.key}>
                <span className="text-foreground">{r.label}:</span> {showValue(r.left)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <p className="text-sm font-medium text-foreground">After merging, the record will show</p>
        <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground sm:grid-cols-2">
          {rows
            .filter((r) => !isBlank(merged[r.key]))
            .map((r) => (
              <li key={r.key}>
                <span className="text-foreground">{r.label}:</span> {showValue(merged[r.key])}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}