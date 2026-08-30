import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { MergeContactsDialog } from "@/components/MergeContactsDialog";
import { ReviewCompareDialog } from "@/components/ReviewCompareDialog";
import { HouseholdConflictReviewDialog } from "@/components/HouseholdConflictReviewDialog";
import { personName } from "@/lib/names";
import {
  compareRecords,
  hasConflict,
  incomingPatch,
  incomingPerson,
  showValue,
  type ReviewPerson,
} from "@/lib/review-merge";
import type { RowValues } from "@/lib/import-mapping";
import { friendlyDbError } from "@/lib/db-errors";
import {
  discardRow,
  quickMerge,
  resolveReviewMergePayload,
  transitionReviewStatus,
  undoQuickMerge,
  type QuickMergeResult,
} from "@/lib/review-quick";
import { rowAddress, rowDisplayName } from "@/lib/review-create";
import { RELATIONSHIP_OPTIONS, rowGroup } from "@/lib/import-links";
import { logChange } from "@/lib/session-log";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/forms/fields";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { SelectAllToggle, SelectBox, useSelection } from "@/components/BulkPeopleActions";
import { ChevronDown } from "lucide-react";
import { RouteError } from "@/components/RouteError";
import { showError } from "@/lib/app-errors";
import {
  applyHouseholdReviewCard,
  findHouseholdIdAtAddress,
  type HouseholdReviewMember,
} from "@/lib/review-household";
import { normalizeEmail } from "@/lib/proper-case";
import { householdConflictContext } from "@/lib/review-household-conflict";
import { coupleActivityContext } from "@/lib/review-couple-activity";
import { CoupleActivityOwnerDialog } from "@/components/CoupleActivityOwnerDialog";
import { RegistrationPaymentConflictDialog } from "@/components/RegistrationPaymentConflictDialog";
import {
  isRegistrationPaymentConflict,
  registrationPaymentConflictContext,
} from "@/lib/registration-payment-conflict";
import { transactionReviewKind, transactionReviewReason } from "@/lib/transaction-namespace";

/** Plain-language buckets so the reviewer sees questions, not error text. */
type Bucket = { id: string; title: string; help: string };

/** What the reviewer decided about one person on a shared-address card. */
type GroupAction = "same" | "related" | "separate" | "discard" | "later";

const GROUP_ACTIONS: { value: GroupAction; label: string }[] = [
  { value: "same", label: "Same person we already have" },
  { value: "related", label: "Related — lives here" },
  { value: "separate", label: "Not related — own contact" },
  { value: "discard", label: "Discard this row" },
  { value: "later", label: "Not sure — leave for later" },
];

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
      {
        name: "description",
        content: "Imported rows that need a person to review them before they enter the database.",
      },
      { property: "og:title", content: "Data Inbox | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Imported rows that need a person to review them before they enter the database.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: RouteError,
  component: DataInbox,
});

function DataInbox() {
  const queryClient = useQueryClient();
  const [mergeFor, setMergeFor] = useState<string[] | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  /** One answer per row inside an address card. */
  const [choices, setChoices] = useState<
    Record<string, { action: GroupAction; relationship: string }>
  >({});
  const [chosenPeople, setChosenPeople] = useState<Record<string, ReviewPerson>>({});
  const [contactSearch, setContactSearch] = useState<{ rowId: string; query: string } | null>(null);
  const [batchFilter, setBatchFilter] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [bulkDiscardOpen, setBulkDiscardOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [showPast, setShowPast] = useState(false);
  const selection = useSelection();

  const { data: contactSearchResults } = useQuery({
    queryKey: ["address-card-contact-search", contactSearch?.query.trim() ?? ""],
    enabled: Boolean(contactSearch && contactSearch.query.trim().length >= 2),
    queryFn: async () => {
      const query = contactSearch?.query.trim() ?? "";
      const { data: hits, error: searchError } = await supabase.rpc("search_people", {
        _q: query,
        _limit: 8,
      });
      if (searchError) throw searchError;
      const ids = (hits ?? []).map((hit) => hit.person_id);
      if (ids.length === 0) return [] as ReviewPerson[];
      const { data: people, error } = await supabase
        .from("people")
        .select("*")
        .in("id", ids)
        .is("deleted_at", null);
      if (error) throw error;
      const byId = new Map((people ?? []).map((person) => [person.id, person]));
      return ids
        .map((id) => byId.get(id))
        .filter((person) => person !== undefined)
        .map((person) => person as ReviewPerson);
    },
  });

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

  /** Only rows still waiting on a decision stay in the active Inbox. */
  const allPending = (data ?? []).filter((r) => r.status === "pending");
  const past = (data ?? []).filter((r) => r.status !== "pending");

  /** One entry per upload, so staff can work through a single import at a time. */
  const batchOptions = Array.from(
    new Map(
      allPending.map(
        (r) => [r.batch_id ?? r.filename ?? "manual", r.filename ?? "Added by hand"] as const,
      ),
    ).entries(),
  );
  const batchKey = (r: { batch_id: string | null; filename: string | null }) =>
    r.batch_id ?? r.filename ?? "manual";
  const pending = batchFilter ? allPending.filter((r) => batchKey(r) === batchFilter) : allPending;

  /** Past uploads, gathered under the file they came from. */
  const pastBatches = Array.from(
    past
      .reduce((map, r) => {
        const key = batchKey(r);
        const bucket = map.get(key) ?? {
          key,
          filename: r.filename ?? "Added by hand",
          rows: [] as typeof past,
        };
        bucket.rows.push(r);
        map.set(key, bucket);
        return map;
      }, new Map<string, { key: string; filename: string; rows: typeof past }>())
      .values(),
  );

  /**
   * Everyone in an upload who shares one address, gathered onto a single card —
   * so the same question is asked once per address, not once per person.
   */
  const addressCards = useMemo(() => {
    const byKey = new Map<string, { key: string; address: string; rows: typeof pending }>();
    for (const r of pending) {
      // A single identified contact belongs in the certain/conflict split below,
      // not in household review merely because the spreadsheet also had an address.
      if ((r.candidate_person_ids ?? []).length === 1) continue;
      const g = rowGroup(r.row_data as Record<string, unknown> | null);
      if (!g) continue;
      const bucket = byKey.get(g.key) ?? {
        key: g.key,
        address: g.address,
        rows: [] as typeof pending,
      };
      bucket.rows.push(r);
      byKey.set(g.key, bucket);
    }
    return [...byKey.values()].filter((c) => c.rows.length > 1);
  }, [pending]);

  const groupedIds = new Set(addressCards.flatMap((c) => c.rows.map((r) => r.id)));
  const reviewedCount = past.length;
  const totalCount = pending.length + reviewedCount;

  const candidateIds = Array.from(
    new Set((pending ?? []).flatMap((r) => r.candidate_person_ids ?? [])),
  );

  const { data: candidates } = useQuery({
    queryKey: ["review-candidates", candidateIds.join(",")],
    enabled: candidateIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("people").select("*").in("id", candidateIds);
      if (error) throw error;
      return data;
    },
  });

  const paymentConflictRows = pending.filter((row) =>
    isRegistrationPaymentConflict((row.row_data ?? {}) as Record<string, unknown>, row.reason),
  );
  const conflictPersonIds = [...new Set(paymentConflictRows.flatMap((row) => row.candidate_person_ids ?? []))];
  const conflictEventIds = [...new Set(paymentConflictRows.map((row) => String((row.row_data as Record<string, unknown> | null)?.["activity_event_id"] ?? "")).filter(Boolean))];
  const { data: conflictRegistrations } = useQuery({
    queryKey: ["review-registration-payment-conflicts", conflictPersonIds.join(","), conflictEventIds.join(",")],
    enabled: conflictPersonIds.length > 0 && conflictEventIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations")
        .select("id, person_id, event_id, payment_amount, fee_amount, status")
        .in("person_id", conflictPersonIds).in("event_id", conflictEventIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: conflictEvents } = useQuery({
    queryKey: ["review-registration-payment-events", conflictEventIds.join(",")],
    enabled: conflictEventIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("events")
        .select("id, name, registration_fee").in("id", conflictEventIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const personById = (id: string | null | undefined) =>
    (id ? (candidates ?? []).find((p) => p.id === id) : undefined) as ReviewPerson | undefined;

  const paymentConflictFor = (row: (typeof pending)[number]) => {
    const rowData = (row.row_data ?? {}) as RowValues & { review_context?: unknown };
    const personId = (row.candidate_person_ids ?? [])[0] ?? null;
    const eventId = String((row.row_data as Record<string, unknown> | null)?.["activity_event_id"] ?? "") || null;
    const registration = (conflictRegistrations ?? []).find(
      (candidate) => candidate.person_id === personId && candidate.event_id === eventId,
    );
    const event = (conflictEvents ?? []).find((candidate) => candidate.id === eventId);
    return registrationPaymentConflictContext(rowData, row.reason, {
      personId,
      registrationId: registration?.id,
      eventId,
      eventName: event?.name,
      feeAmount: registration?.fee_amount ?? event?.registration_fee,
    });
  };

  /** Rows that only fill blanks in an existing contact — safe to approve together. */
  const safeRows = useMemo(() => {
    return pending.filter((r) => {
      if (groupedIds.has(r.id)) return false;
      if (isRegistrationPaymentConflict((r.row_data ?? {}) as Record<string, unknown>, r.reason)) return false;
      if (transactionReviewKind((r.row_data ?? {}) as Record<string, unknown>)) return false;
      if (householdConflictContext((r.row_data ?? {}) as Record<string, unknown>)) return false;
      if (coupleActivityContext((r.row_data ?? {}) as Record<string, unknown>)) return false;
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
        await quickMerge(
          {
            id: r.id,
            filename: r.filename,
            batch_id: r.batch_id,
            row_data: (r.row_data ?? {}) as RowValues,
          },
          existing,
          personName(existing),
        );
        done += 1;
      }
      return done;
    },
    onSuccess: (done) => {
      queryClient.invalidateQueries();
      toast.success(`${done} row${done === 1 ? "" : "s"} approved`);
      logChange(`Merged ${done} imported rows with no conflicts`);
    },
    onError: (e: unknown) => void showError(e),
  });

  /** One tap: fill blanks and add new activity, never overwrite. */
  const quick = useMutation({
    mutationFn: async (r: {
      id: string;
      filename: string | null;
      batch_id: string | null;
      row_data: RowValues;
      existing: ReviewPerson;
    }) =>
      quickMerge(
        { id: r.id, filename: r.filename, batch_id: r.batch_id, row_data: r.row_data },
        r.existing,
        personName(r.existing),
      ),
    onSuccess: (result: QuickMergeResult) => {
      queryClient.invalidateQueries();
      logChange(`Updated ${result.personName} from an imported row`);
      const added = [
        result.filledFields > 0
          ? `${result.filledFields} detail${result.filledFields === 1 ? "" : "s"}`
          : "",
        ...result.addedActivity,
      ].filter(Boolean);
      toast.success(
        `${result.personName} updated${added.length ? ` — added ${added.join(", ")}` : ""}`,
        {
          duration: 12000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await undoQuickMerge(result);
                queryClient.invalidateQueries();
                toast.success("Put back the way it was — the row is on the list again");
              } catch (e) {
                toast.error(await friendlyDbError(e as Error));
              }
            },
          },
        },
      );
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Throw the incoming row away, with a short reason kept on the record. */
  const discard = useMutation({
    mutationFn: async (v: { id: string; reason: string; personId?: string | null }) =>
      discardRow(v.id, v.reason.trim() || "No reason given", v.personId ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDeleteFor(null);
      setDeleteReason("");
      toast.success("Row thrown away — your reason is saved in the change history");
      logChange("Discarded an imported row from the review list");
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Leave a row for later without losing it. */
  const skip = useMutation({
    mutationFn: (id: string) => transitionReviewStatus(id, "pending", "skipped", "Skipped for now"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Set aside — find it under Past imports whenever you want it back");
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Bring a set-aside row back into the active list. */
  const reopen = useMutation({
    mutationFn: (value: { id: string; status: "skipped" | "dismissed" }) =>
      transitionReviewStatus(value.id, value.status, "pending", "Brought back from past imports"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Back on the list");
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Merge every selected row that has no disagreement with the contact on file. */
  const bulkMerge = useMutation({
    mutationFn: async () => {
      let done = 0;
      let skipped = 0;
      for (const r of pending.filter((row) => selection.has(row.id))) {
        if (isRegistrationPaymentConflict((r.row_data ?? {}) as Record<string, unknown>, r.reason)) {
          skipped += 1;
          continue;
        }
        if (transactionReviewKind((r.row_data ?? {}) as Record<string, unknown>)) {
          skipped += 1;
          continue;
        }
        if (
          householdConflictContext((r.row_data ?? {}) as Record<string, unknown>) ||
          coupleActivityContext((r.row_data ?? {}) as Record<string, unknown>)
        ) {
          skipped += 1;
          continue;
        }
        const existing = personById((r.candidate_person_ids ?? [])[0]);
        const fields = existing
          ? compareRecords(existing, incomingPerson((r.row_data ?? {}) as RowValues))
          : [];
        if (!existing || (r.candidate_person_ids ?? []).length !== 1 || hasConflict(fields)) {
          skipped += 1;
          continue;
        }
        await quickMerge(
          {
            id: r.id,
            filename: r.filename,
            batch_id: r.batch_id,
            row_data: (r.row_data ?? {}) as RowValues,
          },
          existing,
          personName(existing),
        );
        done += 1;
      }
      return { done, skipped };
    },
    onSuccess: ({ done, skipped }) => {
      queryClient.invalidateQueries();
      selection.clear();
      toast.success(`${done} merged${skipped ? ` · ${skipped} still need a decision` : ""}`);
      logChange(`Merged ${done} imported rows with no conflicts`);
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Throw away every selected row, with one shared reason. */
  const bulkDiscard = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids)
        await discardRow(id, bulkReason.trim() || "Cleared out from the Data Inbox");
      return ids.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries();
      selection.clear();
      setBulkDiscardOpen(false);
      setClearOpen(false);
      setBulkReason("");
      toast.success(`${count} row${count === 1 ? "" : "s"} thrown away`);
      logChange(`Discarded ${count} imported rows from the Data Inbox`);
    },
    onError: (e: unknown) => void showError(e),
  });

  /** Set selected rows aside — they move to Past imports and can come back. */
  const bulkDismiss = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids)
        await transitionReviewStatus(id, "pending", "skipped", "Dismissed from the Data Inbox");
      return ids.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries();
      selection.clear();
      toast.success(
        `${count} row${count === 1 ? "" : "s"} set aside — find them under Past imports`,
      );
    },
    onError: (e: unknown) => void showError(e),
  });

  /**
   * Save every answer on one address card: the people who live together join one
   * household, the rest become their own contacts, and anything the reviewer
   * wasn't sure about stays on the list.
   */
  const applyCard = useMutation({
    mutationFn: async (card: { key: string; address: string; rows: typeof pending }) => {
      const relatedRows = card.rows.filter((row) => choices[row.id]?.action === "related");
      const sameRows = card.rows.filter((row) => choices[row.id]?.action === "same");
      const existingHouseholdIds = [
        ...new Set(
          sameRows
            .map(
              (row) =>
                (chosenPeople[row.id] ?? personById((row.candidate_person_ids ?? [])[0]))
                  ?.household_id,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (existingHouseholdIds.length > 1) {
        throw new Error(
          "These contacts already belong to different households. Merge those households first, then apply this address group.",
        );
      }
      let householdId = existingHouseholdIds[0] ?? null;
      const togetherRows = [...sameRows, ...relatedRows];
      if (!householdId && togetherRows.length > 1)
        householdId = await findHouseholdIdAtAddress(card.address || null);
      const firstTogether = togetherRows[0];
      const surname = firstTogether
        ? rowDisplayName((firstTogether.row_data ?? {}) as RowValues).surname
        : "";
      const members: HouseholdReviewMember[] = [];
      for (const r of card.rows) {
        const choice = choices[r.id];
        const action = choice?.action ?? "later";
        const row = (r.row_data ?? {}) as RowValues;
        if (action === "later") {
          members.push({ action, item_id: r.id });
          continue;
        }
        if (action === "discard") {
          members.push({ action, item_id: r.id });
          continue;
        }
        const source = `${r.filename ?? "Import"} ${action === "same" ? "quick update" : "review"}`;
        const { event, donation, note } = await resolveReviewMergePayload(row, source, r.batch_id);
        if (action === "same") {
          const existing = chosenPeople[r.id] ?? personById((r.candidate_person_ids ?? [])[0]);
          if (!existing)
            throw new Error(
              "We don't have a matching contact for that person — open and decide instead.",
            );
          const comparisons = compareRecords(existing, incomingPerson(row));
          if (hasConflict(comparisons))
            throw new Error("This row disagrees with what we have — open it and decide.");
          const { patch, changedFields } = incomingPatch(comparisons, {});
          members.push({
            action,
            item_id: r.id,
            person_id: existing.id,
            expected_household_id: existing.household_id,
            relationship: choice?.relationship || "",
            person_patch: {
              __h2_contract: "manual",
              __h2_values: patch,
              __h2_expected: Object.fromEntries(
                Object.keys(patch).map((key) => [
                  key,
                  existing[key as keyof ReviewPerson] ?? null,
                ]),
              ),
            },
            traceable_fields: changedFields.filter((key) =>
              ["email", "phone", "school", "notes"].includes(key),
            ),
            source,
            batch_id: r.batch_id,
            event,
            donation,
            note,
          });
          continue;
        }
        const person = incomingPerson(row);
        if (!person.first_name && !person.last_name)
          throw new Error("This row has no name, so it can't be saved as a contact.");
        const contactMethods = [
          ...(row.phones ?? []).map((method, index) => ({
            kind: "phone",
            value: method.value.trim(),
            method_type: method.method_type,
            is_primary: index === 0,
          })),
          ...(row.emails ?? []).map((method, index) => ({
            kind: "email",
            value: normalizeEmail(method.value),
            method_type: method.method_type,
            is_primary: index === 0,
          })),
        ];
        const traceableFields = [
          row.email && "email",
          row.phone && "phone",
          rowAddress(row) && "address",
          row.birth_date && "birth_date",
          row.anniversary_date && "anniversary_date",
          row.school && "school",
          row.met_source && "met_source",
        ].filter((field): field is string => Boolean(field));
        members.push({
          action,
          item_id: r.id,
          person: { ...person, notes: row.person_notes ?? null },
          relationship: choice?.relationship || "",
          contact_methods: contactMethods,
          traceable_fields: traceableFields,
          reason:
            action === "related"
              ? "Related — added to the household at this address"
              : "Not related — saved as their own contact",
          source: `${source}, ${new Date().toISOString().slice(0, 10)}`,
          batch_id: r.batch_id,
          event,
          donation,
          note,
        });
      }
      return applyHouseholdReviewCard(
        {
          id: householdId,
          create: !householdId && togetherRows.length > 1,
          name: surname ? `${surname} household` : "Household",
          address: card.address || null,
          batch_id: firstTogether?.batch_id ?? null,
        },
        members,
      );
    },
    onSuccess: ({ saved, left }) => {
      queryClient.invalidateQueries();
      toast.success(`${saved} saved${left ? ` · ${left} left for later` : ""}`);
      logChange(`Reviewed an address with ${saved + left} people from an import`);
    },
    onError: (e: unknown) => void showError(e),
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
  const householdConflict = householdConflictContext(
    (reviewItem?.row_data ?? {}) as Record<string, unknown>,
  );
  const coupleActivity = coupleActivityContext(
    (reviewItem?.row_data ?? {}) as Record<string, unknown>,
  );
  const registrationPaymentConflict = reviewItem ? paymentConflictFor(reviewItem) : null;
  const reviewItemIsPaymentConflict = reviewItem
    ? isRegistrationPaymentConflict((reviewItem.row_data ?? {}) as Record<string, unknown>, reviewItem.reason)
    : false;
  const reviewItemTransactionConflict = transactionReviewKind(
    (reviewItem?.row_data ?? {}) as Record<string, unknown>,
  );

  return (
    <AppShell
      title="Data Inbox"
      subtitle={`${pending.length} thing${pending.length === 1 ? "" : "s"} to look at`}
      action={
        <Link
          to="/inbox"
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary"
        >
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
            Nothing here is in Mitzvah House yet. For each one you can add the new details, keep
            both people, fix a typo, or throw the row away. If you're unsure, set it aside — it
            waits under Past imports.
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-money/40 bg-money/5 p-4">
          <p className="text-sm text-foreground">
            <strong>{safeRows.length} certain matches</strong> · {pending.length - safeRows.length}{" "}
            need your review. Certain matches only add missing details; formatting differences and
            blank fields are not conflicts.
          </p>
          {safeRows.length > 0 && (
            <Button
              className="rounded-xl"
              disabled={approveSafe.isPending}
              onClick={() => approveSafe.mutate()}
            >
              {approveSafe.isPending ? "Merging…" : `Approve all ${safeRows.length}`}
            </Button>
          )}
        </div>
      )}

      {allPending.length > 0 && (
        <div className="mb-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              aria-label="Which import are you working on?"
              value={batchFilter}
              onChange={(e) => {
                setBatchFilter(e.target.value);
                selection.clear();
              }}
            >
              <option value="">All imports ({allPending.length} rows)</option>
              {batchOptions.map(([key, name]) => (
                <option key={key} value={key}>
                  {name} ({allPending.filter((r) => batchKey(r) === key).length} rows)
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="rounded-xl border-urgent/40 text-urgent"
              onClick={() => setClearOpen(true)}
            >
              Clear all {batchFilter ? "in this import" : ""}
            </Button>
          </div>
          <SelectAllToggle
            visibleIds={pending.map((r) => r.id)}
            selectedIds={selection.ids}
            onSelectAll={() => selection.selectAll(pending.map((r) => r.id))}
            onClear={selection.clear}
            noun="rows"
          />
          {selection.count > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
              <span className="text-sm font-medium text-foreground">
                {selection.count} selected
              </span>
              <Button
                size="sm"
                className="rounded-xl"
                disabled={bulkMerge.isPending}
                onClick={() => bulkMerge.mutate()}
              >
                {bulkMerge.isPending ? "Merging…" : "Merge all with no conflicts"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={bulkDismiss.isPending}
                onClick={() => bulkDismiss.mutate(selection.ids)}
              >
                Dismiss all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-urgent/40 text-urgent"
                onClick={() => setBulkDiscardOpen(true)}
              >
                Discard all
              </Button>
              <Button size="sm" variant="ghost" className="rounded-xl" onClick={selection.clear}>
                Clear selection
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-6">
        {addressCards.length > 0 && (
          <section>
            <h2 className="font-heading font-semibold text-foreground">
              People at the same address ({addressCards.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Everyone the file lists at one address is on one card. Say who lives together and who
              doesn't — we never guess from an address on its own.
            </p>
            <div className="mt-2 space-y-3">
              {addressCards.map((card) => {
                const answered = card.rows.filter((r) => choices[r.id]).length;
                const missingRelationship = card.rows.some(
                  (r) => choices[r.id]?.action === "related" && !choices[r.id]?.relationship,
                );
                return (
                  <div
                    key={card.key}
                    className="rounded-2xl border border-suggestion/40 bg-card p-4 shadow-sm"
                  >
                    <p className="font-heading font-semibold text-foreground">
                      {card.address || "This address"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {card.rows.length} people in the upload share this address.
                    </p>
                    <div className="mt-3 space-y-2">
                      {card.rows.map((r) => {
                        const row = (r.row_data ?? {}) as RowValues;
                        const name = rowDisplayName(row).display || "(no name)";
                        const existing = personById((r.candidate_person_ids ?? [])[0]);
                        const selectedPerson = chosenPeople[r.id] ?? existing;
                        const choice = choices[r.id];
                        return (
                          <div key={r.id} className="rounded-xl border border-border p-3">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <SelectBox
                                checked={selection.has(r.id)}
                                onChange={() => selection.toggle(r.id)}
                                label={name}
                              />
                              {name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[row.email, row.phone].filter(Boolean).join(" · ") ||
                                "No email or phone on the row"}
                              {selectedPerson
                                ? ` · comparing with ${personName(selectedPerson)}, already on file`
                                : ""}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <select
                                className={selectClass}
                                aria-label={`What should we do with ${name}?`}
                                value={choice?.action ?? ""}
                                onChange={(e) =>
                                  setChoices((c) => ({
                                    ...c,
                                    [r.id]: {
                                      action: e.target.value as GroupAction,
                                      relationship: c[r.id]?.relationship ?? "",
                                    },
                                  }))
                                }
                              >
                                <option value="">Choose this row's action</option>
                                {GROUP_ACTIONS.filter(
                                  (a) => a.value !== "same" || selectedPerson,
                                ).map((a) => (
                                  <option key={a.value} value={a.value}>
                                    {a.value === "same" && selectedPerson
                                      ? `Same person as ${personName(selectedPerson)}`
                                      : a.label}
                                  </option>
                                ))}
                              </select>
                              {choice?.action === "related" && (
                                <select
                                  className={selectClass}
                                  aria-label={`How is ${name} related?`}
                                  value={choice.relationship}
                                  onChange={(e) =>
                                    setChoices((c) => ({
                                      ...c,
                                      [r.id]: { action: "related", relationship: e.target.value },
                                    }))
                                  }
                                >
                                  <option value="">Choose relationship</option>
                                  {RELATIONSHIP_OPTIONS.map((rel) => (
                                    <option key={rel} value={rel}>
                                      {rel}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div className="mt-2">
                              <Input
                                className="text-base"
                                value={contactSearch?.rowId === r.id ? contactSearch.query : ""}
                                placeholder="Search for a different existing contact"
                                onChange={(event) =>
                                  setContactSearch({ rowId: r.id, query: event.target.value })
                                }
                              />
                              {contactSearch?.rowId === r.id &&
                                contactSearch.query.trim().length >= 2 && (
                                  <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                                    {(contactSearchResults ?? [])
                                      .filter((person) =>
                                        (r.candidate_person_ids ?? []).includes(person.id),
                                      )
                                      .map((person) => (
                                      <Button
                                        key={person.id}
                                        type="button"
                                        variant="ghost"
                                        className="w-full justify-start rounded-md"
                                        onClick={() => {
                                          setChosenPeople((current) => ({
                                            ...current,
                                            [r.id]: person,
                                          }));
                                          setChoices((current) => ({
                                            ...current,
                                            [r.id]: {
                                              action: "same",
                                              relationship: current[r.id]?.relationship ?? "",
                                            },
                                          }));
                                          setContactSearch(null);
                                        }}
                                      >
                                        {personName(person)}
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {[person.email, person.phone]
                                            .filter(Boolean)
                                            .join(" · ") || "No email or phone"}
                                        </span>
                                      </Button>
                                    ))}
                                    {(contactSearchResults ?? []).filter((person) =>
                                      (r.candidate_person_ids ?? []).includes(person.id),
                                    ).length === 0 && (
                                      <p className="px-2 py-1 text-sm text-muted-foreground">
                                        No matching contacts found.
                                      </p>
                                    )}
                                  </div>
                                )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="mt-2 rounded-xl text-primary"
                              onClick={() => setReviewId(r.id)}
                            >
                              Edit row details
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        className="rounded-xl"
                        disabled={
                          applyCard.isPending ||
                          answered !== card.rows.length ||
                          missingRelationship
                        }
                        onClick={() => applyCard.mutate(card)}
                      >
                        {applyCard.isPending ? "Applying…" : "Apply all row actions"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {answered} of {card.rows.length} answered
                        {missingRelationship ? " · choose each relationship" : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {BUCKETS.map((bucket) => {
          const rows = pending.filter(
            (r) => !groupedIds.has(r.id) && bucketFor(r.reason).id === bucket.id,
          );
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
                  const fills = fields.filter((f) => f.state === "fill");
                  const paymentConflict = paymentConflictFor(r);
                  const isPaymentConflict = isRegistrationPaymentConflict(
                    (r.row_data ?? {}) as Record<string, unknown>, r.reason,
                  );
                  const transactionConflict = transactionReviewKind(
                    (r.row_data ?? {}) as Record<string, unknown>,
                  );
                  const householdReviewConflict = householdConflictContext(
                    (r.row_data ?? {}) as Record<string, unknown>,
                  );
                  const coupleReviewConflict = coupleActivityContext(
                    (r.row_data ?? {}) as Record<string, unknown>,
                  );
                  const dedicatedConflict = Boolean(
                    isPaymentConflict ||
                      transactionConflict ||
                      householdReviewConflict ||
                      coupleReviewConflict,
                  );
                  const safe =
                    Boolean(existing) &&
                    (r.candidate_person_ids ?? []).length === 1 &&
                    conflicts.length === 0 &&
                    !dedicatedConflict;
                  const fileName = incoming.display_name ?? "This row";
                  return (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-suggestion/40 bg-card p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-2">
                          <SelectBox
                            checked={selection.has(r.id)}
                            onChange={() => selection.toggle(r.id)}
                            label="this row"
                          />
                          <div className="min-w-0">
                            <p className="font-heading font-semibold text-foreground">
                              {isPaymentConflict
                                ? `${fileName} has a registration payment that differs from the existing registration.`
                                : plainSummary(fileName, existing ? personName(existing) : null, conflicts.length)}
                            </p>
                            {existing && (
                              <p
                                className={`mt-1 text-sm font-medium ${
                                  conflicts.length > 0 ? "text-urgent" : "text-money"
                                }`}
                              >
                                {isPaymentConflict
                                  ? "Activity conflict — choose how to handle the incoming event payment"
                                  : householdReviewConflict
                                    ? "Household conflict — review the current household memberships"
                                    : coupleReviewConflict
                                      ? "Activity owner required — choose which partner owns this activity"
                                  : conflicts.length > 0
                                  ? `${conflicts.length} field${conflicts.length === 1 ? "" : "s"} disagree — needs review`
                                  : `No conflicts — ${fills.length} new field${fills.length === 1 ? "" : "s"} will be added`}
                              </p>
                            )}
                            {paymentConflict && (
                              <p className="mt-2 text-sm text-foreground">
                                {paymentConflict.event_name}: existing ${(paymentConflict.existing_payment_cents / 100).toFixed(2)} · incoming ${(paymentConflict.incoming_payment_cents / 100).toFixed(2)} · fee ${(paymentConflict.fee_cents / 100).toFixed(2)} · planned net donation ${(paymentConflict.planned_net_donation_cents / 100).toFixed(2)}
                              </p>
                            )}
                            {transactionConflict && (
                              <p className="mt-2 rounded-xl border border-suggestion/40 bg-suggestion/10 p-3 text-sm text-foreground">
                                {transactionReviewReason(transactionConflict)} Generic merge and
                                create actions are disabled. Set this row aside for financial
                                reconciliation, or discard it with a reason.
                              </p>
                            )}
                            <p className="mt-1 inline-block rounded-full bg-suggestion/15 px-2.5 py-1 text-xs font-medium text-foreground">
                              Why it's here: {r.reason}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              From {r.filename ?? "a manual entry"} · uploaded{" "}
                              {formatDate(r.created_at?.slice(0, 10))}
                              {r.status === "skipped" ? " · skipped earlier" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {safe && existing && (
                            <Button
                              className="rounded-xl"
                              disabled={quick.isPending}
                              onClick={() =>
                                quick.mutate({
                                  id: r.id,
                                  filename: r.filename,
                                  batch_id: r.batch_id,
                                  row_data: row,
                                  existing,
                                })
                              }
                            >
                              ✓ Same person
                            </Button>
                          )}
                          {!transactionConflict && <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setReviewId(r.id)}
                          >
                            {isPaymentConflict
                              ? "Review activity conflict"
                              : householdReviewConflict
                              ? "Review household conflict"
                              : coupleReviewConflict
                                ? "Choose activity owner"
                                : "✏️ Open and decide"}
                          </Button>}
                          <Button
                            variant="outline"
                            className="rounded-xl text-urgent"
                            onClick={() => {
                              setDeleteFor(deleteFor === r.id ? null : r.id);
                              setDeleteReason("");
                            }}
                          >
                            🗑️ Delete row
                          </Button>
                        </div>
                      </div>

                      {deleteFor === r.id && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-urgent/40 bg-urgent/5 p-3">
                          <Input
                            className="min-w-[12rem] flex-1 text-base"
                            placeholder="Why are you throwing this row away?"
                            value={deleteReason}
                            onChange={(e) => setDeleteReason(e.target.value)}
                          />
                          <Button
                            className="rounded-xl"
                            disabled={discard.isPending || !deleteReason.trim()}
                            onClick={() =>
                              discard.mutate({
                                id: r.id,
                                reason: deleteReason,
                                personId: existing?.id ?? null,
                              })
                            }
                          >
                            Delete row
                          </Button>
                          <button
                            type="button"
                            className="text-sm text-muted-foreground underline"
                            onClick={() => setDeleteFor(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

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
                                <span
                                  className={
                                    f.state === "same" ? "text-muted-foreground" : "text-foreground"
                                  }
                                >
                                  {showValue(f.existing)}
                                </span>
                                <span
                                  className={
                                    f.state === "same"
                                      ? "text-muted-foreground"
                                      : "font-medium text-foreground"
                                  }
                                >
                                  {showValue(f.incoming)}
                                  {f.state === "conflict" && (
                                    <span className="ml-2 text-xs text-suggestion">
                                      doesn't match
                                    </span>
                                  )}
                                  {f.state === "fill" && (
                                    <span className="ml-2 text-xs text-money">new</span>
                                  )}
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
                                <dt className="text-xs text-muted-foreground">
                                  {k.replace(/_/g, " ")}
                                </dt>
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
                                {match
                                  ? `Look at ${personName(match)}'s page`
                                  : "Look at the possible match"}
                              </Link>
                            );
                          })}
                        </div>
                      )}

                      {r.status !== "skipped" && (
                        <button
                          type="button"
                          className="mt-3 text-sm text-muted-foreground underline"
                          disabled={skip.isPending}
                          onClick={() => skip.mutate(r.id)}
                        >
                          Set aside
                        </button>
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
          <h2 className="font-heading font-semibold text-foreground">
            Possible duplicates already in the database
          </h2>
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
                    onClick={() =>
                      setMergeFor([d.person_a, d.person_b].filter(Boolean) as string[])
                    }
                  >
                    Compare and merge
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pastBatches.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setShowPast((s) => !s)}
            className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left"
          >
            <span>
              <span className="font-heading font-semibold text-foreground">Past imports</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {pastBatches.length} finished upload{pastBatches.length === 1 ? "" : "s"} ·{" "}
                {past.length} row
                {past.length === 1 ? "" : "s"} settled
              </span>
            </span>
            <ChevronDown className={`size-4 transition ${showPast ? "rotate-180" : ""}`} />
          </button>
          {showPast && (
            <div className="mt-2 space-y-2">
              {pastBatches.map((b) => (
                <div key={b.key} className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-sm font-medium text-foreground">
                    {b.filename} · {b.rows.length} row{b.rows.length === 1 ? "" : "s"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {b.rows.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span>
                          {r.reason} · {r.status}
                          {r.resolution_note ? ` · ${r.resolution_note}` : ""}
                        </span>
                        {(r.status === "skipped" || r.status === "dismissed") && (
                          <button
                            type="button"
                            className="text-primary underline"
                            onClick={() =>
                              reopen.mutate({
                                id: r.id,
                                status: r.status as "skipped" | "dismissed",
                              })
                            }
                          >
                            Put back
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
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

      <ResponsiveModal
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear ${pending.length} row${pending.length === 1 ? "" : "s"} out of the Inbox?`}
        description="Nothing already in Mitzvah House is touched — only these unreviewed rows are thrown away."
        footer={
          <>
            <Button
              variant="outline"
              className="flex-1 rounded-xl sm:flex-none"
              onClick={() => setClearOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl bg-urgent text-primary-foreground hover:bg-urgent/90 sm:flex-none"
              disabled={bulkDiscard.isPending}
              onClick={() => bulkDiscard.mutate(pending.map((r) => r.id))}
            >
              {bulkDiscard.isPending ? "Clearing…" : "Yes, discard them"}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-foreground">
          <p>This will discard:</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {batchOptions
              .filter(([key]) => !batchFilter || key === batchFilter)
              .map(([key, name]) => (
                <li key={key}>
                  {name} — {pending.filter((r) => batchKey(r) === key).length} row
                  {pending.filter((r) => batchKey(r) === key).length === 1 ? "" : "s"}
                </li>
              ))}
          </ul>
          <Input
            className="text-base"
            placeholder="Why are you clearing these? (saved in the change history)"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
          />
        </div>
      </ResponsiveModal>

      <ResponsiveModal
        open={bulkDiscardOpen}
        onOpenChange={setBulkDiscardOpen}
        title={`Discard ${selection.count} selected row${selection.count === 1 ? "" : "s"}?`}
        description="They leave the Inbox for good. Contacts already in Mitzvah House are untouched."
        footer={
          <>
            <Button
              variant="outline"
              className="flex-1 rounded-xl sm:flex-none"
              onClick={() => setBulkDiscardOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl bg-urgent text-primary-foreground hover:bg-urgent/90 sm:flex-none"
              disabled={bulkDiscard.isPending}
              onClick={() => bulkDiscard.mutate(selection.ids)}
            >
              {bulkDiscard.isPending ? "Discarding…" : "Yes, discard"}
            </Button>
          </>
        }
      >
        <Input
          className="text-base"
          placeholder="Why are you discarding these?"
          value={bulkReason}
          onChange={(e) => setBulkReason(e.target.value)}
        />
      </ResponsiveModal>

      {reviewItem && householdConflict && (
        <HouseholdConflictReviewDialog
          open
          onOpenChange={(value) => !value && setReviewId(null)}
          itemId={reviewItem.id}
          context={householdConflict}
          hasActivity={["amount", "event_name", "campaign", "notes", "tags", "programs"].some(
            (field) => Boolean((reviewItem.row_data as Record<string, unknown> | null)?.[field]),
          )}
          onDone={() => setReviewId(null)}
        />
      )}

      {reviewItem && !householdConflict && coupleActivity && (
        <CoupleActivityOwnerDialog
          open
          onOpenChange={(value) => !value && setReviewId(null)}
          itemId={reviewItem.id}
          context={coupleActivity}
          row={(reviewItem.row_data ?? {}) as RowValues}
          batchId={reviewItem.batch_id}
          onDone={() => setReviewId(null)}
        />
      )}

      {reviewItem && registrationPaymentConflict && personById(registrationPaymentConflict.person_id) && (
        <RegistrationPaymentConflictDialog
          open
          onOpenChange={(value) => !value && setReviewId(null)}
          item={{
            id: reviewItem.id,
            filename: reviewItem.filename,
            batch_id: reviewItem.batch_id,
            row_data: (reviewItem.row_data ?? {}) as RowValues,
          }}
          existing={personById(registrationPaymentConflict.person_id)!}
          context={registrationPaymentConflict}
          onDone={() => setReviewId(null)}
        />
      )}

      {reviewItem && !reviewItemIsPaymentConflict && !reviewItemTransactionConflict && !householdConflict && !coupleActivity && (
        <ReviewCompareDialog
          open
          onOpenChange={(v) => !v && setReviewId(null)}
          item={{
            id: reviewItem.id,
            reason: reviewItem.reason,
            filename: reviewItem.filename,
            batch_id: reviewItem.batch_id,
            row_data: (reviewItem.row_data ?? {}) as RowValues,
          }}
          existing={personById((reviewItem.candidate_person_ids ?? [])[0]) ?? null}
          candidatePersonIds={reviewItem.candidate_person_ids ?? []}
          onDone={() => setReviewId(null)}
        />
      )}
    </AppShell>
  );
}
