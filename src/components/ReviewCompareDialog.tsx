import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/fields";
import { personName } from "@/lib/names";
import { logChange } from "@/lib/session-log";
import {
  COMPARE_FIELDS,
  applyIncoming,
  compareRecords,
  createFromIncoming,
  hasConflict,
  incomingPerson,
  showValue,
  type CompareKey,
  type ReviewPerson,
} from "@/lib/review-merge";
import type { RowValues } from "@/lib/import-mapping";

type Mode = "compare" | "edit" | "discard";

/**
 * Side-by-side review of a queued spreadsheet row against the contact it looks
 * like. Anything the stored record is missing is filled in automatically; only
 * genuine disagreements ask the reviewer to choose. Nothing is ever discarded
 * without a reason.
 */
export function ReviewCompareDialog({
  open,
  onOpenChange,
  item,
  existing,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: { id: string; reason: string; filename: string | null; row_data: RowValues };
  existing: ReviewPerson | null;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("compare");
  const [edited, setEdited] = useState<RowValues>(item.row_data);
  const [choices, setChoices] = useState<Partial<Record<CompareKey, "existing" | "incoming">>>({});
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setMode("compare");
      setEdited(item.row_data);
      setChoices({});
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  const incoming = useMemo(() => incomingPerson(edited), [edited]);
  const fields = useMemo(
    () => (existing ? compareRecords(existing, incoming) : []),
    [existing, incoming],
  );
  const conflicts = fields.filter((f) => f.state === "conflict");
  const fills = fields.filter((f) => f.state === "fill");
  const source = `${item.filename ?? "Import"} review`;

  const finish = async (decision: "merged" | "kept_both" | "discarded", personId: string | null) => {
    const { error } = await supabase.rpc("log_review_decision", {
      _item_id: item.id,
      _decision: decision,
      ...(reason.trim() ? { _reason: reason.trim() } : {}),
      ...(personId ? { _person_id: personId } : {}),
    });
    if (error) throw error;
  };

  const merge = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error("No matching contact to merge into");
      const missing = conflicts.filter((f) => !choices[f.key]);
      if (missing.length > 0) throw new Error(`Choose a value for ${missing[0]!.label}`);
      const changed = await applyIncoming(existing.id, fields, choices, source);
      await finish("merged", existing.id);
      return changed;
    },
    onSuccess: (changed) => {
      queryClient.invalidateQueries();
      toast.success(changed > 0 ? `Merged — ${changed} field${changed === 1 ? "" : "s"} updated` : "Merged — nothing needed changing");
      logChange("Merged an imported row into an existing contact");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const keepBoth = useMutation({
    mutationFn: async () => {
      const id = await createFromIncoming(incoming, existing?.household_id ?? null, source);
      await finish("kept_both", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Saved as a separate contact");
      logChange("Kept an imported row as a separate contact");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discard = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Please say briefly why this row is being discarded");
      await finish("discarded", existing?.id ?? null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Row discarded — the reason is saved in the change history");
      logChange("Discarded an imported row");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = merge.isPending || keepBoth.isPending || discard.isPending;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Fix the incoming row" : mode === "discard" ? "Discard this row" : "Review this row"}
      description={
        mode === "compare"
          ? existing
            ? "Anything we're missing is filled in for you. Only real disagreements need a choice."
            : "No matching contact was found, so this row can be saved as a new contact, fixed first, or discarded."
          : mode === "edit"
            ? "Correct anything that came through wrong, then merge it, save it as new, or discard it."
            : "Discarding removes the row. A short reason is recorded in the change history."
      }
      footer={
        mode === "discard" ? (
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setMode("compare")}>
              Back
            </Button>
            <Button
              className="flex-1 rounded-xl bg-urgent text-primary-foreground hover:bg-urgent/90 sm:flex-none"
              disabled={busy}
              onClick={() => discard.mutate()}
            >
              Discard row
            </Button>
          </>
        ) : mode === "edit" ? (
          <Button className="w-full rounded-xl sm:w-auto" onClick={() => setMode("compare")}>
            Done editing
          </Button>
        ) : (
          <div className="grid w-full gap-2 sm:grid-cols-4">
            {existing && (
              <Button className="rounded-xl" disabled={busy} onClick={() => merge.mutate()}>
                {merge.isPending ? "Merging…" : "Merge"}
              </Button>
            )}
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => keepBoth.mutate()}>
              {existing ? "Keep both" : "Save as new"}
            </Button>
            <Button variant="outline" className="rounded-xl text-urgent" disabled={busy} onClick={() => setMode("discard")}>
              Discard
            </Button>
          </div>
        )
      }
    >
      {mode === "discard" && (
        <Field label="Why is this row being discarded?">
          <Input
            className="text-base"
            value={reason}
            placeholder="e.g. test row, not a real person"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}

      {mode === "edit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["first_name", "First name", "text"],
              ["last_name", "Last name", "text"],
              ["full_name", "Full name (if combined)", "text"],
              ["email", "Email", "email"],
              ["phone", "Phone", "tel"],
              ["birth_date", "Birth date", "date"],
              ["anniversary_date", "Anniversary", "date"],
              ["school", "School", "text"],
              ["person_notes", "Notes", "text"],
              ["met_source", "Where we met", "text"],
            ] as const
          ).map(([key, label, type]) => (
            <Field key={key} label={label}>
              <Input
                className="text-base"
                type={type}
                value={(edited[key] as string | undefined) ?? ""}
                onChange={(e) => setEdited((v) => ({ ...v, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      )}

      {mode === "compare" && (
        <div className="space-y-3">
          <p className="rounded-xl bg-suggestion/10 px-3 py-2 text-xs text-foreground">
            {item.reason}
            {existing ? ` · possible match: ${personName(existing)}` : ""}
          </p>

          {existing ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>In the database</span>
                <span>From the file</span>
              </div>
              {fields.map((f) => {
                const isConflict = f.state === "conflict";
                const pick = choices[f.key];
                return (
                  <div
                    key={f.key}
                    className={`rounded-xl border p-3 ${
                      isConflict ? "border-suggestion bg-suggestion/5" : "border-border"
                    }`}
                  >
                    <p className={`text-xs uppercase tracking-wide ${isConflict ? "text-foreground" : "text-muted-foreground"}`}>
                      {f.label}
                      {f.state === "fill" ? " · will be added" : ""}
                      {isConflict ? " · choose one" : ""}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["existing", "incoming"] as const).map((side) => {
                        const value = side === "existing" ? f.existing : f.incoming;
                        const muted = f.state === "same" || (f.state === "empty" && true);
                        return isConflict ? (
                          <label
                            key={side}
                            className={`flex items-start gap-2 rounded-lg px-2 py-1 text-sm ${
                              pick === side ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            <input
                              type="radio"
                              className="mt-1"
                              checked={pick === side}
                              onChange={() => setChoices((c) => ({ ...c, [f.key]: side }))}
                            />
                            <span className="break-words">{showValue(value)}</span>
                          </label>
                        ) : (
                          <span
                            key={side}
                            className={`break-words px-2 py-1 text-sm ${
                              muted ? "text-muted-foreground" : "font-medium text-foreground"
                            }`}
                          >
                            {showValue(value)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                {fills.length} field{fills.length === 1 ? "" : "s"} will be filled in automatically ·{" "}
                {conflicts.length} need{conflicts.length === 1 ? "s" : ""} a choice. Nothing is deleted by merging.
              </p>
            </>
          ) : (
            <div className="space-y-2">
              {COMPARE_FIELDS.map((f) => (
                <div key={f.key} className="rounded-xl border border-border px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                  <p className="text-sm text-foreground">{showValue(incoming[f.key])}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ResponsiveModal>
  );
}

export { hasConflict };