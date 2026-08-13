import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { MergeContactsDialog } from "@/components/MergeContactsDialog";
import { ReviewCompareDialog } from "@/components/ReviewCompareDialog";
import { personName } from "@/lib/names";
import {
  applyIncoming,
  compareRecords,
  hasConflict,
  incomingPerson,
  showValue,
  type ReviewPerson,
} from "@/lib/review-merge";
import type { RowValues } from "@/lib/import-mapping";
import { friendlyDbError } from "@/lib/db-errors";

/** Plain-language buckets so the reviewer sees questions, not error text. */
type Bucket = { id: string; title: string; help: string };

const BUCKETS: Bucket[] = [
  {
    id: "duplicate",
    title: "Might be someone we already have",
    help: "The file has a person who looks like a contact already in Mitzvah House. Decide if they're the same person.",
  },
  {
    id: "shared",
    title: "Shares an email or phone with someone",
    help: "Two people in the file use the same email or phone number. Often a couple or a parent and child.",
  },
  {
    id: "twice",
    title: "Listed more than once in the same file",
    help: "The same person appears on several rows of the upload. Keep one, and throw away the extra rows.",
  },
  {
    id: "incomplete",
    title: "Missing something we need",
    help: "There wasn't enough information on the row to save it — usually a missing name.",
  },
  {
    id: "problem",
    title: "Couldn't be saved automatically",
    help: "Something on the row stopped it from saving. Fix it here, or discard the row.",
  },
];

function bucketFor(reason: string): Bucket {
  const r = (reason ?? "").toLowerCase();
  if (/email|phone|number/.test(r) && /same|shar|already used/.test(r)) return BUCKETS[1]!;
  if (/match|similar|duplicate|looks like|more than one/.test(r)) return BUCKETS[0]!;
  if (/more than once|twice|also row/.test(r)) return BUCKETS[2]!;
  if (/missing|no name|not enough|required|blank|empty/.test(r)) return BUCKETS[3]!;
  return BUCKETS[4]!;
}

/** One sentence describing what the reviewer is looking at. */
function plainSummary(fileName: string, existingName: string | null, conflicts: number) {
  if (!existingName) return `${fileName || "This row"} isn't in Mitzvah House yet.`;
  if (conflicts === 0)
    return `${fileName || "This row"} looks like ${existingName}, and only adds details we don't have yet.`;
  return `${fileName || "This row"} looks like ${existingName}, but ${conflicts} detail${conflicts === 1 ? "" : "s"} don't match.`;
}

export const Route = createFileRoute("/_authenticated/inbox/review")({
  head: () => ({
    meta: [
      { title: "Data Inbox | Mitzvah House CRM" },
      { name: "description", content: "Imported rows that need a person to review them before they enter the database." },
      { property: "og:title", content: "Data Inbox | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Imported rows that need a person to review them before they enter the database.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataInbox,
});

function DataInbox() {
  const queryClient = useQueryClient();
  const [mergeFor, setMergeFor] = useState<string[] | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["review-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_queue")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pending = (data ?? []).filter((r) => r.status === "pending" || r.status === "skipped");
  const handled = (data ?? []).filter((r) => r.status !== "pending" && r.status !== "skipped");
  const reviewedCount = handled.length;
  const totalCount = pending.length + reviewedCount;

  const candidateIds = Array.from(
    new Set((pending ?? []).flatMap((r) => r.candidate_person_ids ?? [])),
  );

  const { data: candidates } = useQuery({
    queryKey: ["review-candidates", candidateIds.join(",")],
    enabled: candidateIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("*")
        .in("id", candidateIds);
      if (error) throw error;
      return data;
    },
  });

  const personById = (id: string | null | undefined) =>
    (id ? (candidates ?? []).find((p) => p.id === id) : undefined) as ReviewPerson | undefined;

  /** Rows that only fill blanks in an existing contact — safe to approve together. */
  const safeRows = useMemo(() => {
    return pending.filter((r) => {
      const existing = personById((r.candidate_person_ids ?? [])[0]);
      if (!existing) return false;
      if ((r.candidate_person_ids ?? []).length !== 1) return false;
      const fields = compareRecords(existing, incomingPerson((r.row_data ?? {}) as RowValues));
      return !hasConflict(fields);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, candidates]);

  const approveSafe = useMutation({
    mutationFn: async () => {
      let done = 0;
      for (const r of safeRows) {
        const existing = personById((r.candidate_person_ids ?? [])[0]);
        if (!existing) continue;
        const fields = compareRecords(existing, incomingPerson((r.row_data ?? {}) as RowValues));
        await applyIncoming(existing.id, fields, {}, `${r.filename ?? "Import"} bulk approve`);
        const { error } = await supabase.rpc("log_review_decision", {
          _item_id: r.id,
          _decision: "merged",
          _reason: "Approved in bulk — no conflicting fields",
          _person_id: existing.id,
        });
        if (error) throw error;
        done += 1;
      }
      return done;
    },
    onSuccess: (done) => {
      queryClient.invalidateQueries();
      toast.success(`${done} row${done === 1 ? "" : "s"} approved`);
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  /** Leave a row for later without losing it. */
  const skip = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("review_queue")
        .update({ status: "skipped", resolution_note: "Skipped for now" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Skipped — it will come back next time you open this list");
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  // Duplicates that already exist in the database, not just from imports.
  const { data: dbDupes } = useQuery({
    queryKey: ["db-duplicates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("find_duplicate_people");
      if (error) throw error;
      return data ?? [];
    },
  });

  const dupeIds = Array.from(
    new Set((dbDupes ?? []).flatMap((d) => [d.person_a, d.person_b].filter(Boolean) as string[])),
  );

  const { data: dupePeople } = useQuery({
    queryKey: ["db-duplicate-people", dupeIds.join(",")],
    enabled: dupeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("id, display_name, first_name, last_name, email, phone")
        .in("id", dupeIds);
      if (error) throw error;
      return data;
    },
  });

  const reviewItem = pending.find((r) => r.id === reviewId);

  return (
    <AppShell
      title="Data Inbox"
      subtitle={`${pending.length} thing${pending.length === 1 ? "" : "s"} to look at`}
      action={
        <Link to="/inbox" className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary">
          Import Center
        </Link>
      }
    >
      {isLoading && <EmptyState label="Loading review items…" />}
      {!isLoading && pending.length === 0 && <EmptyState label="Nothing to review right now." />}

      {totalCount > 0 && (
        <div className="mb-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-foreground">
            {reviewedCount} of {totalCount} reviewed · {pending.length} left
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-money transition-all"
              style={{ width: `${Math.round((reviewedCount / Math.max(totalCount, 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing here is in Mitzvah House yet. For each one you can add the new details, keep both people, fix a
            typo, or throw the row away. If you're unsure, skip it — it stays on this list.
          </p>
        </div>
      )}

      {safeRows.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-money/40 bg-money/5 p-4">
          <p className="text-sm text-foreground">
            {safeRows.length} of these are clearly the same person and only add details we were missing. Nothing gets
            overwritten.
          </p>
          <Button className="rounded-xl" disabled={approveSafe.isPending} onClick={() => approveSafe.mutate()}>
            {approveSafe.isPending ? "Adding…" : `Add details for these ${safeRows.length}`}
          </Button>
        </div>
      )}

      <div className="space-y-6">
        {BUCKETS.map((bucket) => {
          const rows = pending.filter((r) => bucketFor(r.reason).id === bucket.id);
          if (rows.length === 0) return null;
          return (
            <section key={bucket.id}>
              <h2 className="font-heading font-semibold text-foreground">
                {bucket.title} ({rows.length})
              </h2>
              <p className="text-sm text-muted-foreground">{bucket.help}</p>
              <div className="mt-2 space-y-3">
                {rows.map((r) => {
                  const row = (r.row_data ?? {}) as RowValues;
                  const incoming = incomingPerson(row);
                  const existing = personById((r.candidate_person_ids ?? [])[0]);
                  const fields = existing ? compareRecords(existing, incoming) : [];
                  const conflicts = fields.filter((f) => f.state === "conflict");
                  const fileName = incoming.display_name ?? "This row";
                  return (
                    <div key={r.id} className="rounded-2xl border border-suggestion/40 bg-card p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-heading font-semibold text-foreground">
                            {plainSummary(fileName, existing ? personName(existing) : null, conflicts.length)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.reason} · from {r.filename ?? "a manual entry"} · uploaded{" "}
                            {formatDate(r.created_at?.slice(0, 10))}
                            {r.status === "skipped" ? " · skipped earlier" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button className="rounded-xl" onClick={() => setReviewId(r.id)}>
                            Open and decide
                          </Button>
                          {r.status !== "skipped" && (
                            <Button
                              variant="outline"
                              className="rounded-xl"
                              disabled={skip.isPending}
                              onClick={() => skip.mutate(r.id)}
                            >
                              Skip for now
                            </Button>
                          )}
                        </div>
                      </div>

                      {existing ? (
                        <div className="mt-3 overflow-hidden rounded-xl border border-border">
                          <div className="grid grid-cols-[8rem_1fr_1fr] gap-2 bg-muted/60 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            <span>Detail</span>
                            <span>Already saved</span>
                            <span>In the file</span>
                          </div>
                          {fields
                            .filter((f) => f.state !== "empty")
                            .map((f) => (
                              <div
                                key={f.key}
                                className={`grid grid-cols-[8rem_1fr_1fr] gap-2 px-2 py-1.5 text-sm ${
                                  f.state === "conflict" ? "bg-suggestion/10" : ""
                                }`}
                              >
                                <span className="text-xs text-muted-foreground">{f.label}</span>
                                <span className={f.state === "same" ? "text-muted-foreground" : "text-foreground"}>
                                  {showValue(f.existing)}
                                </span>
                                <span
                                  className={
                                    f.state === "same" ? "text-muted-foreground" : "font-medium text-foreground"
                                  }
                                >
                                  {showValue(f.incoming)}
                                  {f.state === "conflict" && (
                                    <span className="ml-2 text-xs text-suggestion">doesn't match</span>
                                  )}
                                  {f.state === "fill" && <span className="ml-2 text-xs text-money">new</span>}
                                </span>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                          {Object.entries(row)
                            .filter(([, v]) => typeof v === "string" && v)
                            .map(([k, v]) => (
                              <div key={k} className="rounded-xl bg-muted/50 px-3 py-2">
                                <dt className="text-xs text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                                <dd className="text-sm text-foreground">{String(v)}</dd>
                              </div>
                            ))}
                        </dl>
                      )}

                      {(r.candidate_person_ids ?? []).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(r.candidate_person_ids ?? []).map((id) => {
                            const match = (candidates ?? []).find((p) => p.id === id);
                            return (
                              <Link
                                key={id}
                                to="/people/$personId"
                                params={{ personId: id }}
                                className="rounded-full border border-border px-3 py-1 text-xs text-primary"
                              >
                                {match ? `Look at ${personName(match)}'s page` : "Look at the possible match"}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {(dbDupes ?? []).length > 0 && (
        <section className="mt-6">
          <h2 className="font-heading font-semibold text-foreground">Possible duplicates already in the database</h2>
          <p className="text-xs text-muted-foreground">
            Contacts that share an email, a phone number, or the same name in one household.
          </p>
          <div className="mt-2 space-y-2">
            {(dbDupes ?? []).map((d) => {
              const a = (dupePeople ?? []).find((p) => p.id === d.person_a);
              const b = (dupePeople ?? []).find((p) => p.id === d.person_b);
              return (
                <div
                  key={`${d.person_a}-${d.person_b}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {personName(a)} · {personName(b)}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.reason}</p>
                  </div>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => setMergeFor([d.person_a, d.person_b].filter(Boolean) as string[])}
                  >
                    Compare and merge
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {handled.length > 0 && (
        <section className="mt-6">
          <h2 className="font-heading font-semibold text-foreground">Already handled</h2>
          <div className="mt-2 space-y-2">
            {handled.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                {r.reason} · {r.filename ?? "Manual"} · {r.status}
                {r.resolution_note ? ` · ${r.resolution_note}` : ""}
              </div>
            ))}
          </div>
        </section>
      )}

      <MergeContactsDialog
        open={mergeFor !== null}
        onOpenChange={(v) => {
          if (!v) setMergeFor(null);
        }}
        {...(mergeFor?.[0] ? { primaryId: mergeFor[0] } : {})}
        suggestedIds={mergeFor?.slice(1) ?? []}
      />

      {reviewItem && (
        <ReviewCompareDialog
          open
          onOpenChange={(v) => !v && setReviewId(null)}
          item={{
            id: reviewItem.id,
            reason: reviewItem.reason,
            filename: reviewItem.filename,
            row_data: (reviewItem.row_data ?? {}) as RowValues,
          }}
          existing={personById((reviewItem.candidate_person_ids ?? [])[0]) ?? null}
          onDone={() => setReviewId(null)}
        />
      )}
    </AppShell>
  );
}