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

  const pending = (data ?? []).filter((r) => r.status === "pending");
  const handled = (data ?? []).filter((r) => r.status !== "pending");

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
    onError: (e: Error) => toast.error(e.message),
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
      subtitle={`${pending.length} item${pending.length === 1 ? "" : "s"} waiting for review`}
      action={
        <Link to="/inbox" className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary">
          Import Center
        </Link>
      }
    >
      {isLoading && <EmptyState label="Loading review items…" />}
      {!isLoading && pending.length === 0 && <EmptyState label="Nothing needs review. All clear." />}

      {safeRows.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-money/40 bg-money/5 p-4">
          <p className="text-sm text-foreground">
            {safeRows.length} rows match one contact exactly and only add missing details — safe to approve together.
          </p>
          <Button className="rounded-xl" disabled={approveSafe.isPending} onClick={() => approveSafe.mutate()}>
            {approveSafe.isPending ? "Approving…" : `Approve ${safeRows.length} safe matches`}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {pending.map((r) => {
          const row = (r.row_data ?? {}) as RowValues;
          const existing = personById((r.candidate_person_ids ?? [])[0]);
          const fields = existing ? compareRecords(existing, incomingPerson(row)) : [];
          const conflicts = fields.filter((f) => f.state === "conflict");
          return (
            <div key={r.id} className="rounded-2xl border border-suggestion/40 bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-heading font-semibold text-foreground">{r.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.filename ?? "Manual"} · {formatDate(r.created_at?.slice(0, 10))}
                    {existing
                      ? ` · ${conflicts.length === 0 ? "no conflicting fields" : `${conflicts.length} field${conflicts.length === 1 ? "" : "s"} disagree`}`
                      : " · no match found"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button className="rounded-xl" onClick={() => setReviewId(r.id)}>
                    Review side by side
                  </Button>
                </div>
              </div>
              {existing ? (
                <dl className="mt-3 space-y-1">
                  {fields
                    .filter((f) => f.state !== "empty")
                    .map((f) => (
                      <div
                        key={f.key}
                        className={`grid grid-cols-[8rem_1fr_1fr] gap-2 rounded-lg px-2 py-1 text-sm ${
                          f.state === "conflict" ? "bg-suggestion/10" : ""
                        }`}
                      >
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                        <dd className={f.state === "same" ? "text-muted-foreground" : "text-foreground"}>
                          {showValue(f.existing)}
                        </dd>
                        <dd className={f.state === "same" ? "text-muted-foreground" : "font-medium text-foreground"}>
                          {showValue(f.incoming)}
                        </dd>
                      </div>
                    ))}
                </dl>
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
                        {match ? `Open ${personName(match)}` : "Open possible match"}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
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