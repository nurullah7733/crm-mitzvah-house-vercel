import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/fields";
import { currency } from "@/components/AppShell";
import { personName } from "@/lib/names";
import { logChange } from "@/lib/session-log";
import {
  COMPARE_FIELDS,
  applyIncoming,
  compareRecords,
  createFromIncoming,
  fetchHistory,
  hasConflict,
  incomingPerson,
  mergedValues,
  showValue,
  updateExistingFields,
  type CompareKey,
  type FieldComparison,
  type ReviewPerson,
} from "@/lib/review-merge";
import type { RowValues } from "@/lib/import-mapping";

type Mode = "compare" | "edit" | "discard";
type Side = "existing" | "incoming";

const LEFT_LABEL = "Already in CRM";
const RIGHT_LABEL = "Incoming (from the file)";

/**
 * Side-by-side review of a queued spreadsheet row against the contact it looks
 * like. Only true disagreements ask for a decision; anything one record is
 * missing is filled in automatically, and no history is ever thrown away.
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
  const [editSide, setEditSide] = useState<Side>("incoming");
  const [edited, setEdited] = useState<RowValues>(item.row_data);
  const [editedExisting, setEditedExisting] = useState<Partial<Record<CompareKey, string>>>({});
  const [choices, setChoices] = useState<Partial<Record<CompareKey, Side>>>({});
  const [reason, setReason] = useState("");
  const [showSame, setShowSame] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("compare");
      setEditSide("incoming");
      setEdited(item.row_data);
      setEditedExisting({});
      setChoices({});
      setReason("");
      setShowSame(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  const incoming = useMemo(() => incomingPerson(edited), [edited]);
  const fields = useMemo(
    () => (existing ? compareRecords(existing, incoming) : []),
    [existing, incoming],
  );
  const conflicts = fields.filter((f) => f.state === "conflict");
  const kept = fields.filter((f) => f.state === "fill" || (f.state === "same" && !f.incoming && f.existing));
  const same = fields.filter((f) => f.state === "same" && f.existing && f.incoming);
  const blank = fields.filter((f) => !f.existing && !f.incoming);
  const preview = mergedValues(fields, choices);
  const undecided = conflicts.filter((f) => !choices[f.key]);
  const source = `${item.filename ?? "Import"} review`;

  const { data: history } = useQuery({
    queryKey: ["review-history", existing?.id],
    enabled: open && Boolean(existing?.id),
    queryFn: () => fetchHistory(existing!.id),
  });

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
      if (undecided.length > 0) throw new Error(`Choose which value to keep for ${undecided[0]!.label}`);
      const before = { ...existing };
      const changed = await applyIncoming(existing.id, fields, choices, source);
      await supabase.rpc("log_import_review_merge", {
        _item_id: item.id,
        _person_id: existing.id,
        _existing_before: before as never,
        _incoming: edited as never,
        _surviving_after: preview as never,
        _choices: choices as never,
      });
      await finish("merged", existing.id);
      return changed;
    },
    onSuccess: (changed) => {
      queryClient.invalidateQueries();
      toast.success(
        changed > 0 ? `Merged — ${changed} field${changed === 1 ? "" : "s"} updated` : "Merged — nothing needed changing",
      );
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
      toast.success("Saved as a separate contact — both records kept");
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
      toast.success("Incoming row discarded — the reason is saved in the change history");
      logChange("Discarded an imported row");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveExistingEdits = useMutation({
    mutationFn: async () => {
      if (!existing) return;
      await updateExistingFields(existing.id, editedExisting);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Saved to the contact already in the CRM");
      logChange("Corrected a contact while reviewing an import");
      setMode("compare");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = merge.isPending || keepBoth.isPending || discard.isPending || saveExistingEdits.isPending;
  const pickAll = (side: Side) =>
    setChoices(Object.fromEntries(conflicts.map((f) => [f.key, side])) as Partial<Record<CompareKey, Side>>);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        mode === "edit"
          ? "Fix bad data before merging"
          : mode === "discard"
            ? "Discard the incoming row"
            : "Are these the same person?"
      }
      description={
        mode === "compare"
          ? existing
            ? "Both records are shown side by side. You only have to choose where they disagree."
            : "No matching contact was found, so this row can be saved as a new contact, fixed first, or discarded."
          : mode === "edit"
            ? "Correct anything that came through wrong, then go back and merge."
            : "A short reason is required and is recorded in the change history."
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
              Discard incoming row
            </Button>
          </>
        ) : mode === "edit" ? (
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setMode("compare")}>
              Back to comparison
            </Button>
            {editSide === "existing" && (
              <Button
                className="flex-1 rounded-xl sm:flex-none"
                disabled={busy}
                onClick={() => saveExistingEdits.mutate()}
              >
                {saveExistingEdits.isPending ? "Saving…" : "Save changes"}
              </Button>
            )}
          </>
        ) : (
          <div className="grid w-full gap-2 sm:grid-cols-4">
            {existing && (
              <Button className="rounded-xl" disabled={busy} onClick={() => merge.mutate()}>
                {merge.isPending ? "Merging…" : "Merge"}
              </Button>
            )}
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => keepBoth.mutate()}>
              {existing ? "Keep both" : "Save as new"}
            </Button>
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button
              variant="outline"
              className="rounded-xl text-urgent"
              disabled={busy}
              onClick={() => setMode("discard")}
            >
              Discard incoming
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
        <div className="space-y-3">
          {existing && (
            <div className="flex gap-2">
              {(
                [
                  ["existing", LEFT_LABEL],
                  ["incoming", RIGHT_LABEL],
                ] as const
              ).map(([side, label]) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setEditSide(side)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    editSide === side ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                  }`}
                >
                  Edit {label}
                </button>
              ))}
            </div>
          )}

          {existing && editSide === "existing" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {COMPARE_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input
                    className="text-base"
                    value={editedExisting[f.key] ?? (existing[f.key] as string | null) ?? ""}
                    onChange={(e) => setEditedExisting((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          ) : (
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
        </div>
      )}

      {mode === "compare" && (
        <div className="space-y-4">
          <p className="rounded-xl bg-suggestion/10 px-3 py-2 text-xs text-foreground">
            {item.reason}
            {existing ? ` · possible match: ${personName(existing)}` : ""}
          </p>

          {!existing ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{RIGHT_LABEL}</p>
              {COMPARE_FIELDS.map((f) => (
                <div key={f.key} className="rounded-xl border border-border px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                  <p className="text-sm text-foreground">{showValue(incoming[f.key])}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* What history is attached to each record */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{LEFT_LABEL}</p>
                  <p className="font-heading font-semibold text-foreground">{personName(existing)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {history
                      ? `${history.donations} donation${history.donations === 1 ? "" : "s"} · ${currency(history.giving)} given · ${history.registrations} event registration${history.registrations === 1 ? "" : "s"} · ${history.notes} note${history.notes === 1 ? "" : "s"} · ${history.tasks} task${history.tasks === 1 ? "" : "s"}`
                      : "Loading history…"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{RIGHT_LABEL}</p>
                  <p className="font-heading font-semibold text-foreground">
                    {showValue(incoming.display_name)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A spreadsheet row — no donations, events, notes or tasks of its own yet.
                  </p>
                </div>
              </div>

              <p className="rounded-xl border border-money/40 bg-money/5 px-3 py-2 text-xs text-foreground">
                All history from both records is kept and moved onto the surviving contact. Choosing values below decides
                field values only — it never deletes donations, events, notes or tasks.
              </p>

              {/* Conflicts — the only decisions required */}
              {conflicts.length > 0 && (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-heading text-sm font-semibold text-foreground">
                      {conflicts.length} field{conflicts.length === 1 ? "" : "s"} disagree — pick which to keep
                    </h3>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAll("existing")}>
                        Use all from CRM
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAll("incoming")}>
                        Use all incoming
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {conflicts.map((f) => (
                      <div key={f.key} className="rounded-xl border border-suggestion bg-suggestion/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{f.label}</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {(
                            [
                              ["existing", LEFT_LABEL],
                              ["incoming", RIGHT_LABEL],
                            ] as const
                          ).map(([side, label]) => (
                            <label
                              key={side}
                              className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${
                                choices[f.key] === side
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border text-muted-foreground"
                              }`}
                            >
                              <input
                                type="radio"
                                className="mt-1"
                                name={`conflict-${f.key}`}
                                checked={choices[f.key] === side}
                                onChange={() => setChoices((c) => ({ ...c, [f.key]: side }))}
                              />
                              <span className="min-w-0">
                                <span className="block text-[11px] uppercase tracking-wide">{label}</span>
                                <span className="block break-words font-medium text-foreground">
                                  {showValue(side === "existing" ? f.existing : f.incoming)}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Only one side has a value — kept automatically */}
              {kept.length > 0 && (
                <section>
                  <h3 className="font-heading text-sm font-semibold text-foreground">
                    {kept.length} field{kept.length === 1 ? "" : "s"} kept automatically — no decision needed
                  </h3>
                  <div className="mt-2 space-y-1">
                    {kept.map((f) => (
                      <div key={f.key} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</span>
                        <span className="ml-2 font-medium text-foreground">
                          {showValue(f.state === "fill" ? f.incoming : f.existing)}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          only in {f.state === "fill" ? "incoming" : "the CRM"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Identical fields, tucked away */}
              {same.length > 0 && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowSame((s) => !s)}
                    className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground"
                  >
                    <span>
                      {same.length} field{same.length === 1 ? "" : "s"} match
                    </span>
                    <ChevronDown className={`size-4 transition ${showSame ? "rotate-180" : ""}`} />
                  </button>
                  {showSame && (
                    <div className="mt-2 space-y-1">
                      {same.map((f) => (
                        <div key={f.key} className="px-3 py-1 text-sm text-muted-foreground">
                          <span className="text-xs uppercase tracking-wide">{f.label}</span>
                          <span className="ml-2">{showValue(f.existing)}</span>
                        </div>
                      ))}
                      {blank.length > 0 && (
                        <p className="px-3 py-1 text-xs text-muted-foreground">
                          {blank.length} field{blank.length === 1 ? "" : "s"} are empty on both records.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Full record view, side by side */}
              <section>
                <h3 className="font-heading text-sm font-semibold text-foreground">Every field, side by side</h3>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {(
                    [
                      ["existing", LEFT_LABEL],
                      ["incoming", RIGHT_LABEL],
                    ] as const
                  ).map(([side, label]) => (
                    <div key={side} className="rounded-2xl border border-border bg-card p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                      <dl className="mt-2 space-y-1">
                        {fields.map((f: FieldComparison) => (
                          <div key={f.key} className="flex gap-2 text-sm">
                            <dt className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                              {f.label}
                            </dt>
                            <dd
                              className={`min-w-0 break-words ${
                                f.state === "conflict" ? "font-medium text-foreground" : "text-muted-foreground"
                              }`}
                            >
                              {showValue(side === "existing" ? f.existing : f.incoming)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </section>

              {/* Live preview of the result */}
              <section className="rounded-2xl border border-primary/40 bg-primary/5 p-3">
                <h3 className="font-heading text-sm font-semibold text-foreground">
                  After merging, this contact will look like
                </h3>
                <dl className="mt-2 space-y-1">
                  {COMPARE_FIELDS.map((f) => (
                    <div key={f.key} className="flex gap-2 text-sm">
                      <dt className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                      <dd className="min-w-0 break-words font-medium text-foreground">{showValue(preview[f.key])}</dd>
                    </div>
                  ))}
                </dl>
                {undecided.length > 0 && (
                  <p className="mt-2 text-xs text-urgent">
                    Still to choose: {undecided.map((f) => f.label).join(", ")}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </ResponsiveModal>
  );
}

export { hasConflict };
