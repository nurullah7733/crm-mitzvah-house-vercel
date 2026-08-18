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
import { friendlyDbError } from "@/lib/db-errors";
import { ExistingRecordPanel } from "@/components/ExistingRecordPanel";
import { fetchFullRecord } from "@/lib/review-record";
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

const LEFT_LABEL = "Already in Mitzvah House";
const RIGHT_LABEL = "From the file";

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
  item: { id: string; reason: string; filename: string | null; row_data: RowValues; batch_id?: string | null };
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
  const [contactSearch, setContactSearch] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<ReviewPerson | null>(existing);

  useEffect(() => {
    if (open) {
      setMode("compare");
      setEditSide("incoming");
      setEdited(item.row_data);
      setEditedExisting({});
      setChoices({});
      setReason("");
      setShowSame(false);
      setContactSearch("");
      setSelectedExisting(existing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  const incoming = useMemo(() => incomingPerson(edited), [edited]);
  const fields = useMemo(
    () => (selectedExisting ? compareRecords(selectedExisting, incoming) : []),
    [selectedExisting, incoming],
  );
  const conflicts = fields.filter((f) => f.state === "conflict");
  const kept = fields.filter((f) => f.state === "fill" || (f.state === "same" && !f.incoming && f.existing));
  const same = fields.filter((f) => f.state === "same" && f.existing && f.incoming);
  const blank = fields.filter((f) => !f.existing && !f.incoming);
  const preview = mergedValues(fields, choices);
  const undecided = conflicts.filter((f) => !choices[f.key]);
  const source = `${item.filename ?? "Import"} review`;

  const { data: history } = useQuery({
    queryKey: ["review-history", selectedExisting?.id],
    enabled: open && Boolean(selectedExisting?.id),
    queryFn: () => selectedExisting ? fetchHistory(selectedExisting.id) : Promise.resolve(null),
  });

  const { data: fullRecord } = useQuery({
    queryKey: ["review-full-record", selectedExisting?.id],
    enabled: open && Boolean(selectedExisting?.id),
    queryFn: () => fetchFullRecord(selectedExisting!.id),
  });

  const { data: searchResults } = useQuery({
    queryKey: ["review-contact-search", contactSearch.trim()],
    enabled: open && contactSearch.trim().length >= 2,
    queryFn: async () => {
      const { data: hits, error: searchError } = await supabase.rpc("search_people", {
        _q: contactSearch.trim(),
        _limit: 8,
      });
      if (searchError) throw searchError;
      const ids = (hits ?? []).map((hit) => hit.person_id);
      if (ids.length === 0) return [] as ReviewPerson[];
      const { data: people, error } = await supabase.from("people").select("*").in("id", ids).is("deleted_at", null);
      if (error) throw error;
      const byId = new Map((people ?? []).map((person) => [person.id, person]));
      return ids
        .map((id) => byId.get(id))
        .filter((person) => person !== undefined)
        .map((person) => person as ReviewPerson);
    },
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
      if (!selectedExisting) throw new Error("Choose an existing contact to combine this with.");
      if (undecided.length > 0) throw new Error(`Pick the right ${undecided[0]!.label.toLowerCase()} first.`);
      const before = { ...selectedExisting };
      const changed = await applyIncoming(selectedExisting.id, fields, choices, source, item.batch_id ?? null);
      await supabase.rpc("log_import_review_merge", {
        _item_id: item.id,
        _person_id: selectedExisting.id,
        _existing_before: before as never,
        _incoming: edited as never,
        _surviving_after: preview as never,
        _choices: choices as never,
      });
      await finish("merged", selectedExisting.id);
      return changed;
    },
    onSuccess: (changed) => {
      queryClient.invalidateQueries();
      toast.success(
        changed > 0
          ? `Combined — ${changed} detail${changed === 1 ? "" : "s"} added or updated`
          : "Combined — nothing needed changing",
      );
      logChange("Merged an imported row into an existing contact");
      onOpenChange(false);
      onDone?.();
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  const keepBoth = useMutation({
    mutationFn: async () => {
      const id = await createFromIncoming(incoming, selectedExisting?.household_id ?? null, source, item.batch_id ?? null);
      await finish("kept_both", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Saved as a separate contact — both records kept");
      logChange("Kept an imported row as a separate contact");
      onOpenChange(false);
      onDone?.();
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  const discard = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Write a few words about why you're throwing this row away.");
      await finish("discarded", selectedExisting?.id ?? null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Row thrown away — your reason is saved in the change history");
      logChange("Discarded an imported row");
      onOpenChange(false);
      onDone?.();
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  const saveExistingEdits = useMutation({
    mutationFn: async () => {
      if (!selectedExisting) return;
      await updateExistingFields(selectedExisting.id, editedExisting);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Saved to the contact we already had");
      logChange("Corrected a contact while reviewing an import");
      setMode("compare");
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  const busy = merge.isPending || keepBoth.isPending || discard.isPending || saveExistingEdits.isPending;
  /** Assign one side as the winner for every field that has a value anywhere. */
  const pickAll = (side: Side) =>
    setChoices(
      Object.fromEntries(
        fields.filter((f) => f.existing || f.incoming).map((f) => [f.key, side]),
      ) as Partial<Record<CompareKey, Side>>,
    );
  const pickAllConflicts = (side: Side) =>
    setChoices((c) => ({ ...c, ...(Object.fromEntries(conflicts.map((f) => [f.key, side])) as Partial<Record<CompareKey, Side>>) }));

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        mode === "edit"
          ? "Fix a typo before combining"
          : mode === "discard"
            ? "Throw this row away"
            : "Is this the same person?"
      }
      description={
        mode === "compare"
            ? selectedExisting
            ? "The person we already have is on the left, the spreadsheet row is on the right. You only have to choose where they don't match."
            : "We didn't find anyone like this. You can save them as a new contact, fix a typo first, or throw the row away."
          : mode === "edit"
            ? "Change anything that came through wrong, then go back and finish."
            : "Write a few words so we know why. Nothing is deleted from Mitzvah House."
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
              Yes, throw it away
            </Button>
          </>
        ) : mode === "edit" ? (
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setMode("compare")}>
              Back
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
            {selectedExisting && (
              <Button className="rounded-xl" disabled={busy} onClick={() => merge.mutate()}>
                {merge.isPending ? "Combining…" : "Same person — combine"}
              </Button>
            )}
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => keepBoth.mutate()}>
              {selectedExisting ? "Different people — keep both" : "Save as a new contact"}
            </Button>
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => setMode("edit")}>
              Fix a typo
            </Button>
            <Button
              variant="outline"
              className="rounded-xl text-urgent"
              disabled={busy}
              onClick={() => setMode("discard")}
            >
              Throw this row away
            </Button>
          </div>
        )
      }
    >
      {mode === "discard" && (
        <Field label="Why are you throwing this row away?">
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
          {selectedExisting && (
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
                  Change {label}
                </button>
              ))}
            </div>
          )}

          {selectedExisting && editSide === "existing" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {COMPARE_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input
                    className="text-base"
                    value={editedExisting[f.key] ?? (selectedExisting[f.key] as string | null) ?? ""}
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
            {selectedExisting ? ` · comparing with: ${personName(selectedExisting)}` : ""}
          </p>

          <div className="rounded-xl border border-border p-3">
            <Field label="Merge with someone else — search any contact">
              <Input
                className="text-base"
                value={contactSearch}
                placeholder="Search by name, email, phone, tag, or program"
                onChange={(event) => setContactSearch(event.target.value)}
              />
            </Field>
            {contactSearch.trim().length >= 2 && (
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {(searchResults ?? []).map((person) => (
                  <Button
                    key={person.id}
                    type="button"
                    variant="ghost"
                    className="w-full justify-start rounded-lg"
                    onClick={() => {
                      setSelectedExisting(person);
                      setChoices({});
                      setEditedExisting({});
                      setContactSearch("");
                    }}
                  >
                    {personName(person)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[person.email, person.phone].filter(Boolean).join(" · ") || "No email or phone"}
                    </span>
                  </Button>
                ))}
                {searchResults?.length === 0 && (
                  <p className="px-2 py-1 text-sm text-muted-foreground">No matching contacts found.</p>
                )}
              </div>
            )}
          </div>

          {!selectedExisting ? (
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
              {/* The whole contact we already have, next to the incoming row */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{LEFT_LABEL}</p>
                  <div className="mt-1">
                    <ExistingRecordPanel record={fullRecord ?? null} />
                  </div>
                  {history && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {history.donations} donation{history.donations === 1 ? "" : "s"} · {currency(history.giving)} given ·{" "}
                      {history.registrations} event registration{history.registrations === 1 ? "" : "s"} · {history.notes}{" "}
                      note{history.notes === 1 ? "" : "s"} · {history.tasks} task{history.tasks === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{RIGHT_LABEL}</p>
                  <p className="font-heading text-base font-semibold text-foreground">
                    {showValue(incoming.display_name)}
                  </p>
                  <dl className="mt-1 space-y-1">
                    {fields
                      .filter((f) => f.incoming)
                      .map((f) => (
                        <div key={f.key} className="flex gap-2 py-1 text-sm">
                          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                            {f.label}
                          </span>
                          <span
                            className={`min-w-0 break-words ${
                              f.state === "conflict" ? "font-semibold text-urgent" : "text-foreground"
                            }`}
                          >
                            {showValue(f.incoming)}
                            {f.state === "conflict" && <span className="ml-2 text-xs text-urgent">differs</span>}
                            {f.state === "fill" && <span className="ml-2 text-xs text-money">new</span>}
                          </span>
                        </div>
                      ))}
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    A row from {item.filename ?? "an upload"} — no giving or history of its own yet.
                  </p>
                </div>
              </div>

              <p className="rounded-xl border border-money/40 bg-money/5 px-3 py-2 text-xs text-foreground">
                Every donation, event, note and task stays with the contact. Choosing below only decides which details to
                show — nothing is ever deleted.
              </p>

              {/* Conflicts — the only decisions required */}
              {conflicts.length > 0 && (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-heading text-sm font-semibold text-foreground">
                      {conflicts.length} detail{conflicts.length === 1 ? "" : "s"} don't match — pick the right one
                    </h3>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAllConflicts("existing")}>
                        Keep what we have
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAllConflicts("incoming")}>
                        Use the file's version
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

              {/* Pick a winner field by field, either side */}
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Pick field by field</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAll("existing")}>
                      Use all from left
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => pickAll("incoming")}>
                      Use all from right
                    </Button>
                    <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setChoices({})}>
                      Reset
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {fields
                    .filter((f: FieldComparison) => f.existing || f.incoming)
                    .map((f: FieldComparison) => (
                      <div
                        key={f.key}
                        className={`rounded-xl border p-2 ${
                          f.state === "conflict" ? "border-urgent/50 bg-urgent/5" : "border-border"
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          {(
                            [
                              ["existing", f.existing],
                              ["incoming", f.incoming],
                            ] as const
                          ).map(([side, value]) => {
                            const chosen = choices[f.key] === side || (!choices[f.key] && preview[f.key] === value);
                            return (
                              <button
                                key={side}
                                type="button"
                                onClick={() => setChoices((c) => ({ ...c, [f.key]: side }))}
                                className={`rounded-lg border p-2 text-left text-sm ${
                                  chosen ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
                                }`}
                              >
                                <span className="block text-[11px] uppercase tracking-wide">
                                  {side === "existing" ? "Left — on file" : "Right — in the file"}
                                </span>
                                <span className="block break-words font-medium text-foreground">{showValue(value)}</span>
                              </button>
                            );
                          })}
                        </div>
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
