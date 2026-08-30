import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Users,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseImportDate } from "@/lib/import-dates";
import { resolveCampaignId } from "@/lib/campaigns";
import { useIsAdmin } from "@/lib/is-admin";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Field, selectClass } from "@/components/forms/fields";
import { fetchAll } from "@/lib/fetch-all";
import { addContactMethods, type MethodDraft } from "@/lib/contact-methods";
import { normalizeEmail, normalizeState, properCase, properCaseAddress } from "@/lib/proper-case";
import { friendlyDbError } from "@/lib/db-errors";
import { attributeGiftToEvent, recordAttendance } from "@/lib/gift-events";
import { recordImportRowFailureAndRethrow } from "@/lib/import-row-failure";
import {
  findGiftsOnOtherContacts,
  isExactTransactionDonationRepeat,
  sameGiftElsewhereReason,
  type ExistingImportDonation,
} from "@/lib/donation-dupes";
import {
  EMPTY_BULK_TARGET,
  GROUP_ADDRESS_FIELD,
  GROUP_KEY_FIELD,
  RELATIONSHIP_OPTIONS,
  groupSharedAddresses,
  matchEventByName,
  normalizeLabel,
  type AddressDecision,
  type BulkTarget,
  type EventDecision,
  type EventOption,
} from "@/lib/import-links";
import { EventDecisionPicker } from "@/components/import/EventDecisionPicker";
import {
  ESSENTIAL_CHECKS,
  FIELD_HINTS,
  FIELD_LABELS,
  FIELD_PAIRS,
  REPEATABLE_FIELDS,
  addressKey,
  applyNormalizationReview,
  buildFileClaimGraph,
  composeAddress,
  correlateFileCoupleResolution,
  correlateFileMatch,
  guessMapping,
  namesAreClose,
  matchRowOnce,
  logicalFilePerson,
  newRowIdentityRegistry,
  resolveCoupleClaims,
  needsCoupleActivityOwnerReview,
  COUPLE_ACTIVITY_OWNER_REVIEW_REASON,
  roleFromRow,
  splitFullName,
  splitName,
  splitPeopleList,
  type ColumnGuess,
  type ExistingPerson,
  type FieldKey,
  type MatchResult,
  type RowValues,
} from "@/lib/import-mapping";
import { presentCoupleDecision } from "@/lib/couple-semantics";

import { buildRowValues, mainName } from "@/lib/import-rows";
import { amountToCents, centsToAmount } from "@/lib/import-normalization";
import { buildActivityPlan, chooseActivityEventDecision } from "@/lib/import-activity-plan";
import { findRegistrationPaymentConflict, type RegistrationPaymentConflictContext } from "@/lib/registration-payment-conflict";
import {
  TRANSACTION_SOURCE_OPTIONS,
  transactionReviewCondition,
  transactionReviewReason,
  type TransactionSourceConfidence,
} from "@/lib/transaction-namespace";
import { FieldPicker } from "@/components/import/FieldPicker";
import { RouteError } from "@/components/RouteError";
import { guard, mustWrite } from "@/lib/app-errors";
import {
  profileImportFile,
  selectWorkbookSheet,
  stagedRowPayload,
  validateImportMapping,
  type SelectedSheet,
  type WorkbookProfile,
} from "@/lib/import-workbook";

export const Route = createFileRoute("/_authenticated/inbox/")({
  head: () => ({
    meta: [
      { title: "Import Center | Mitzvah House CRM" },
      {
        name: "description",
        content:
          "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:title", content: "Import Center | Mitzvah House CRM" },
      {
        property: "og:description",
        content:
          "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: RouteError,
  component: ImportCenter,
});

type Sheet = SelectedSheet & { name: string };

/** Spreadsheet dates are read by one shared parser — see src/lib/import-dates.ts. */
const isoDate = (raw: string | undefined) => parseImportDate(raw);
const importedAmount = (raw: string | number | null | undefined) => {
  const cents = amountToCents(raw);
  return cents === null ? Number.NaN : centsToAmount(cents);
};

function splitList(raw: string | undefined) {
  return raw
    ? raw
        .split(/[;,|]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
}

/** Same date, shifted by whole days — used for the one-day event window. */
function dayShift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DRAFT_KEY = "mh-import-draft";

function ImportCenter() {
  const queryClient = useQueryClient();
  const [workbook, setWorkbook] = useState<WorkbookProfile | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnGuess[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** What to do with each event name found in the file that matched nothing. */
  const [eventDecisions, setEventDecisions] = useState<Record<string, EventDecision>>({});
  /** Applies to every contact in the file, whatever the columns say. */
  const [bulkTarget, setBulkTarget] = useState<BulkTarget>(EMPTY_BULK_TARGET);
  /** One answer per group of people sharing an address. */
  const [addressDecisions, setAddressDecisions] = useState<Record<string, AddressDecision>>({});
  /** One answer per event whose date matches gifts in this file. */
  const [giftEventDecisions, setGiftEventDecisions] = useState<
    Record<string, "attended" | "gift_only" | "skip">
  >({});
  /** Set when staff confirm they really do want to import a file already imported before. */
  const [reimportConfirmed, setReimportConfirmed] = useState(false);
  const [headerRiskConfirmed, setHeaderRiskConfirmed] = useState(false);
  const [transactionSourceSystem, setTransactionSourceSystem] = useState("");
  /** Blocks a double-tap or a browser retry from running the same import twice. */
  const runningRef = useRef(false);

  /** Keep the uploaded file in this browser so a refresh or a timed-out tab doesn't lose the work. */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        workbook?: WorkbookProfile;
        sheet: Sheet;
        mapping: ColumnGuess[];
        transactionSourceSystem?: string;
      };
      if (draft?.sheet?.headers?.length) {
        if (draft.workbook) setWorkbook(draft.workbook);
        setSheet(draft.sheet);
        setMapping(draft.mapping ?? guessMapping(draft.sheet.headers));
        setTransactionSourceSystem(draft.transactionSourceSystem ?? "");
      }
    } catch {
      /* ignore a bad draft */
    }
  }, []);

  useEffect(() => {
    try {
      if (sheet) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ workbook, sheet, mapping, transactionSourceSystem }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* the file is too big to stash — the import still works */
    }
  }, [workbook, sheet, mapping, transactionSourceSystem]);

  /** Warn before leaving mid-import. */
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const { data: people } = useQuery({
    queryKey: ["import-people"],
    queryFn: async () =>
      (await fetchAll((f, t) =>
        supabase
          .from("people")
          .select(
            "id, first_name, last_name, email, phone, birth_date, household_id, households(name, address), contact_methods(kind, value)",
          )
          .is("deleted_at", null)
          .order("id")
          .range(f, t),
      )) as unknown as ExistingPerson[],
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["review-queue-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  /** Has this exact file been imported before? */
  const { data: priorImports } = useQuery({
    queryKey: ["prior-imports", sheet?.rawFileHash ?? "", sheet?.sourceDataHash ?? ""],
    enabled: Boolean(sheet?.rawFileHash && sheet?.sourceDataHash),
    queryFn: async () => {
      const select =
        "id, import_date, total_rows, created_at, filename, raw_file_hash, source_data_hash";
      const [identity, legacyName] = await Promise.all([
        supabase
          .from("import_batches")
          .select(select)
          .or(`raw_file_hash.eq.${sheet!.rawFileHash},source_data_hash.eq.${sheet!.sourceDataHash}`)
          .order("created_at", { ascending: false }),
        supabase
          .from("import_batches")
          .select(select)
          .eq("filename", sheet!.name)
          .order("created_at", { ascending: false }),
      ]);
      if (identity.error) throw identity.error;
      if (legacyName.error) throw legacyName.error;
      return [
        ...new Map(
          [...(identity.data ?? []), ...(legacyName.data ?? [])].map((row) => [row.id, row]),
        ).values(),
      ];
    },
  });

  const { data: events } = useQuery({
    queryKey: ["import-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date, registration_fee")
        .is("deleted_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EventOption[];
    },
  });

  const { data: existingRegistrations } = useQuery({
    queryKey: ["import-registrations"],
    queryFn: async () =>
      fetchAll((from, to) =>
        supabase
          .from("registrations")
          .select("person_id, event_id, payment_amount, fee_amount, status")
          .order("id")
          .range(from, to),
      ),
  });

  const { data: programOptions } = useQuery({
    queryKey: ["program-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("program_options").select("label").order("label");
      if (error) throw error;
      return (data ?? []).map((p) => p.label);
    },
  });

  const { data: tagOptions } = useQuery({
    queryKey: ["tag-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tag_options").select("label").order("label");
      if (error) throw error;
      return (data ?? []).map((t) => t.label);
    },
  });

  const analysed = useMemo<
    {
      row: string[];
      values: RowValues;
      match: MatchResult;
      coupleResolution: ReturnType<typeof resolveCoupleClaims>;
      presentation: ReturnType<typeof presentCoupleDecision>;
    }[]
  >(() => {
    if (!sheet || !people) return [];
    const valuesByRow = sheet.rows.map((row, index) =>
      buildRowValues(row, mapping, sheet.rawRows[index]?.cells),
    );
    const claimGraph = buildFileClaimGraph(valuesByRow);
    // One shared duplicate check, so the preview and the import loop agree.
    const seen = newRowIdentityRegistry();
    return sheet.rows.map((row, index) => {
      const values = valuesByRow[index]!;
      const match = applyNormalizationReview(
        values,
        correlateFileMatch(matchRowOnce(values, people, seen, index), claimGraph, index),
      );
      const coupleResolution = correlateFileCoupleResolution(
        resolveCoupleClaims(values, people, match),
        claimGraph,
        index,
      );
      const activityOwnerReview = needsCoupleActivityOwnerReview(values);
      return {
        row,
        values,
        match,
        coupleResolution,
        activityOwnerReview,
        presentation: presentCoupleDecision(
          values.couple_decision,
          match.status,
          coupleResolution,
          activityOwnerReview,
        ),
      };
    });
  }, [sheet, people, mapping]);

  /** Which of the four things a usable file needs are mapped, and which pairs are half-done. */
  const mappingReview = useMemo(() => {
    const mapped = new Set(mapping.filter((m) => m.field !== "ignore").map((m) => m.field));
    const checklist = ESSENTIAL_CHECKS.map((c) => ({
      label: c.label,
      ok: c.fields.some((f) => mapped.has(f)),
    }));
    const warnings = FIELD_PAIRS.filter((p) => {
      const needs = Array.isArray(p.needs) ? p.needs : [p.needs];
      return mapped.has(p.field) && !needs.some((field) => mapped.has(field));
    }).map((p) => p.message);
    const gate = validateImportMapping(mapping, sheet?.headers.length ?? 0, sheet?.columnProfiles);
    return { checklist, warnings: [...warnings, ...gate.warnings], mapped, gate };
  }, [mapping, sheet?.headers.length, sheet?.columnProfiles]);

  /** Every distinct event name the file mentions, and what it matched. */
  const fileEvents = useMemo(() => {
    const map = new Map<
      string,
      { value: string; rows: number; matched: EventOption | null; origin: "event" | "campaign" }
    >();
    // Only explicit event semantics may create attendance. Campaign is a
    // donation designation even when its text happens to match an event.
    analysed.forEach((a) => {
      for (const [origin, raw] of [["event", a.values.event_name]] as const) {
        const value = (raw ?? "").trim();
        if (!value) continue;
        const key = normalizeLabel(value);
        const existing = map.get(key);
        if (existing) {
          existing.rows += 1;
          if (origin === "event") existing.origin = "event";
          continue;
        }
        map.set(key, { value, rows: 1, matched: matchEventByName(value, events ?? []), origin });
      }
    });
    return [...map.entries()].map(([key, v]) => ({ key, ...v }));
  }, [analysed, events]);

  // Explicit event attendance must never be silently discarded.
  const unansweredEvents = fileEvents.filter(
    (e) =>
      e.origin === "event" &&
      !e.matched &&
      (eventDecisions[e.key]?.action ?? undefined) === undefined,
  );

  /** How each row will be linked, so the preview can be exact. */
  const eventLinkPlan = useMemo(() => {
    const bulkEvent = (events ?? []).find((e) => e.id === bulkTarget.eventId) ?? null;
    const eventIds: (string | null)[] = [];
    const perRow = analysed.map((a) => {
      const value = (a.values.event_name ?? "").trim();
      const key = normalizeLabel(value);
      const entry = fileEvents.find((f) => f.key === key);
      const decision = eventDecisions[key];
      let label: string | null = null;
      let eventId: string | null = null;
      if (entry?.matched) {
        label = entry.matched.name;
        eventId = entry.matched.id;
      } else if (decision?.action === "create") label = entry?.value ?? null;
      else if (decision?.action === "existing") {
        const selected = (events ?? []).find((e) => e.id === decision.eventId) ?? null;
        label = selected?.name ?? null;
        eventId = selected?.id ?? null;
      }
      if (!label && bulkEvent) {
        label = bulkEvent.name;
        eventId = bulkEvent.id;
      }
      eventIds.push(eventId);
      return label;
    });
    const totals = new Map<string, number>();
    perRow.forEach((label, i) => {
      if (!label) return;
      if (analysed[i]?.match.status === "ambiguous") return;
      totals.set(label, (totals.get(label) ?? 0) + 1);
    });
    return { perRow, eventIds, totals: [...totals.entries()].map(([name, count]) => ({ name, count })) };
  }, [analysed, fileEvents, eventDecisions, events, bulkTarget.eventId]);

  /**
   * Gifts in this file whose date lands on an event (or a day either side).
   * One decision covers the whole batch, not row by row.
   */
  const giftEventGroups = useMemo(() => {
    const groups = new Map<string, { event: EventOption; rows: number; total: number }>();
    analysed.forEach((a, index) => {
      if (a.match.status === "ambiguous") return;
      if (eventLinkPlan.eventIds[index]) return;
      const amount = importedAmount(a.values.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const giftDate = isoDate(a.values.date);
      if (!giftDate) return;
      const match = (events ?? []).find(
        (ev) => ev.date >= dayShift(giftDate, -1) && ev.date <= dayShift(giftDate, 1),
      );
      if (!match) return;
      const entry = groups.get(match.id) ?? { event: match, rows: 0, total: 0 };
      entry.rows += 1;
      entry.total += amount;
      groups.set(match.id, entry);
    });
    return [...groups.values()];
  }, [analysed, events, eventLinkPlan.eventIds]);

  const previewAnalysed = useMemo(
    () =>
      analysed.map((item, index) => {
        const personId = item.match.status === "matched" ? item.match.candidates[0]?.id : null;
        const eventId = eventLinkPlan.eventIds[index];
        if (!personId || !eventId) return item;
        const event = (events ?? []).find((candidate) => candidate.id === eventId) ?? null;
        if (!event) return item;
        const activityPlan = buildActivityPlan({
          row: item.values,
          effectiveDate: isoDate(item.values.date) ?? new Date().toISOString().slice(0, 10),
          eventDecision: chooseActivityEventDecision({
            explicitEvent: event,
            nearbyEvent: null,
          }),
        });
        const registration = (existingRegistrations ?? []).find(
          (candidate) => candidate.person_id === personId && candidate.event_id === eventId,
        );
        const conflict = findRegistrationPaymentConflict(
          registration?.payment_amount,
          activityPlan.grossPaymentCents,
        );
        return conflict
          ? {
              ...item,
              presentation: { status: "review" as const, reason: conflict.reason, willCreate: "review" as const },
            }
          : item;
      }),
    [analysed, eventLinkPlan.eventIds, events, existingRegistrations],
  );

  const counts = useMemo(
    () => ({
      total: previewAnalysed.length,
      matched: previewAnalysed.filter((a) => a.match.status === "matched").length,
      new: previewAnalysed.filter((a) => a.presentation.status === "single" && a.match.status === "new").length,
      ambiguous: previewAnalysed.filter((a) => a.presentation.status === "review").length,
      couples: previewAnalysed.filter((a) => a.presentation.status === "couple").length,
      extraPeople: previewAnalysed.reduce(
        (n, a) =>
          n +
          (a.presentation.status === "review"
            ? 0
            : (a.values.children?.length ?? 0) +
              (a.values.spouse_full_name || a.values.spouse_first_name ? 1 : 0)),
        0,
      ),
    }),
    [previewAnalysed],
  );

  /** People at the same address with different surnames — a question, never an assumption. */
  const addressGroups = useMemo(
    () =>
      groupSharedAddresses(
        analysed.map((a, index) => {
          const n = mainName(a.values);
          return {
            index,
            name: n.display,
            surname: n.surname,
            address: composeAddress(a.values),
          };
        }),
      ),
    [analysed],
  );

  const undecidedAddressGroups = addressGroups.filter((g) => !addressDecisions[g.key]);

  /** Rows whose shared-address question hasn't been answered — they go to review, not into the database. */
  const addressReviewRows = useMemo(() => {
    const map = new Map<number, { key: string; address: string; names: string[] }>();
    for (const g of undecidedAddressGroups) {
      for (const r of g.rows) {
        map.set(r.index, { key: g.key, address: g.address, names: g.rows.map((x) => x.name) });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressGroups, addressDecisions]);

  /** How many rows go straight in, and how many wait in the Data Inbox. */
  const plan = useMemo(() => {
    const review = previewAnalysed.reduce(
      (n, a, i) => n + (a.presentation.status === "review" || addressReviewRows.has(i) ? 1 : 0),
      0,
    );
    return { review, importNow: Math.max(previewAnalysed.length - review, 0) };
  }, [previewAnalysed, addressReviewRows]);

  async function handleFile(file: File) {
    setError(null);
    try {
      const parsed = await profileImportFile(file);
      setWorkbook(parsed);
      setSheet(null);
      setMapping([]);
      setAdjusting(false);
      setEventDecisions({});
      setAddressDecisions({});
      setBulkTarget(EMPTY_BULK_TARGET);
      setHeaderRiskConfirmed(false);
      setReimportConfirmed(false);
      setTransactionSourceSystem("");
      if (parsed.kind === "csv" && parsed.sheets[0]) {
        const detected = parsed.sheets[0].detectedHeader;
        if (detected.rowNumber !== null)
          applySheetSelection(parsed, 0, detected.rowNumber, "detected");
      }
    } catch (e) {
      setWorkbook(null);
      setSheet(null);
      setError(e instanceof Error ? e.message : "We couldn't read that file.");
    }
  }

  function applySheetSelection(
    source: WorkbookProfile,
    sheetIndex: number,
    headerRowNumber: number | null,
    mode: SelectedSheet["headerMode"],
  ) {
    const selected = selectWorkbookSheet(source, sheetIndex, headerRowNumber, mode);
    setSheet({ ...selected, name: source.filename });
    setMapping(guessMapping(selected.headers));
    setHeaderRiskConfirmed(false);
    setTransactionSourceSystem("");
    setReimportConfirmed(false);
    setEventDecisions({});
    setAddressDecisions({});
    setGiftEventDecisions({});
  }

  function reset() {
    setWorkbook(null);
    setSheet(null);
    setMapping([]);
    setError(null);
    setProgress(null);
    setEventDecisions({});
    setAddressDecisions({});
    setBulkTarget(EMPTY_BULK_TARGET);
    setGiftEventDecisions({});
    setReimportConfirmed(false);
    setHeaderRiskConfirmed(false);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  async function approve() {
    if (unansweredEvents.length > 0) {
      toast.error("Decide whether to link, create, or ignore every unmatched event first.");
      return;
    }
    if (!sheet) return;
    if (runningRef.current || busy) return;
    if (!mappingReview.gate.valid) {
      toast.error(mappingReview.gate.errors[0] ?? "Fix the column mapping before importing.");
      return;
    }
    const profiledSheet = workbook?.sheets[sheet.sheetIndex];
    const riskyHeader =
      sheet.headerRowNumber !== null &&
      profiledSheet?.detectedHeader.rowNumber !== sheet.headerRowNumber;
    if (riskyHeader && !headerRiskConfirmed) {
      toast.error("Confirm the manually selected header row before importing.");
      return;
    }
    if ((priorImports ?? []).length > 0 && !reimportConfirmed) {
      toast.error(
        "This file was imported before. Tick the box to confirm you want to import it again.",
      );
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setProgress({ done: 0, total: analysed.length });
    try {
      const importDate = new Date().toISOString().slice(0, 10);
      const source = `${sheet.name}, imported ${importDate}`;
      const sourceConfidence: TransactionSourceConfidence = transactionSourceSystem ? "explicit" : "unknown";
      const transactionObjectType = transactionSourceSystem ? "donation" : null;

      const { data: batch, error: batchError } = await supabase
        .from("import_batches")
        .insert({
          filename: sheet.name,
          import_date: importDate,
          total_rows: counts.total,
          matched_rows: counts.matched,
          new_rows: counts.new,
          ambiguous_rows: counts.ambiguous,
          status: "processing",
          raw_file_hash: sheet.rawFileHash,
          source_data_hash: sheet.sourceDataHash,
          selected_sheet_name: sheet.sheetName,
          selected_sheet_index: sheet.sheetIndex,
          header_row_number: sheet.headerRowNumber,
          header_mode: sheet.headerMode,
          source_structure: {
            kind: workbook?.kind ?? "xlsx",
            used_range: sheet.usedRange,
            visibility: sheet.visibility,
            column_ids: sheet.columnIds,
            headers: sheet.headers,
          },
          source_system: transactionSourceSystem || null,
          source_system_confidence: sourceConfidence,
          transaction_object_type: transactionObjectType,
          mapping: mapping.reduce<Record<string, string>>((acc, m, i) => {
            acc[sheet.columnIds[i] ?? `column_${i + 1}`] = m.field;
            return acc;
          }, {}),
        })
        .select("id")
        .single();
      if (batchError) throw batchError;
      const batchId = batch.id;

      const stagedRows = stagedRowPayload(
        sheet,
        mapping,
        analysed.map((item) => item.values),
      ).map((row) => ({ ...row, batch_id: batchId })) as never[];
      for (let offset = 0; offset < stagedRows.length; offset += 250) {
        const { error: stagingError } = await supabase
          .from("import_staged_rows")
          .insert(stagedRows.slice(offset, offset + 250));
        if (stagingError) throw stagingError;
      }

      const { error: outcomeSeedError } = await supabase.from("import_row_outcomes").insert(
        analysed.map((item, index) => ({
          batch_id: batchId,
          row_number: index + 1,
          row_data: item.values as never,
          outcome: "processing",
        })),
      );
      if (outcomeSeedError) throw outcomeSeedError;

      async function recordOutcome(
        index: number,
        outcome: "created" | "matched" | "flagged" | "failed",
        details: { personId?: string | null; reviewQueueId?: string | null; message?: string } = {},
      ) {
        const { error } = await supabase
          .from("import_row_outcomes")
          .update({
            outcome,
            person_id: details.personId ?? null,
            review_queue_id: details.reviewQueueId ?? null,
            message: details.message ?? null,
          })
          .eq("batch_id", batchId)
          .eq("row_number", index + 1);
        if (error) throw error;
      }

      const fieldSources: {
        person_id: string;
        field_name: string;
        source: string;
        recorded_date: string;
        import_batch_id: string;
      }[] = [];
      let failures = 0;
      let queued = 0;
      /** Gifts we refused to date ourselves, so no gift is ever silently dated today. */
      let unreadableGiftDates = 0;

      const existingImportDonations = await fetchAll<ExistingImportDonation>((f, t) =>
            supabase
              .from("donations")
              .select("person_id, import_fingerprint, amount, date, event_id, campaigns(name)")
              .not("import_fingerprint", "is", null)
              .is("deleted_at", null)
              .order("id")
              .range(f, t),
          );
      const existingGiftFingerprints = new Set(
        existingImportDonations.map((gift) => gift.import_fingerprint)
          .filter((value): value is string => Boolean(value)),
      );

      /** Park a row in the Data Inbox, with the address it shares so it can be grouped there. */
      async function queueForReview(
        values: RowValues,
        reason: string,
        candidateIds: string[],
        group: { key: string; address: string } | null,
        reviewContext?: Record<string, unknown>,
      ): Promise<string> {
        queued += 1;
        const { data, error } = await supabase
          .from("review_queue")
          .insert({
            batch_id: batchId,
            filename: sheet!.name,
            reason,
            row_data: {
              ...(values as unknown as Record<string, unknown>),
              activity_effective_date: importDate,
              ...(eventDecisions[normalizeLabel(values.event_name ?? "")]?.action === "ignore"
                ? { activity_event_ignored: "true" }
                : {}),
              ...(eventIdByKey.get(normalizeLabel(values.event_name ?? ""))
                ? { activity_event_id: eventIdByKey.get(normalizeLabel(values.event_name ?? "")) }
                : {}),
              _source_sheet: sheet!.sheetName,
              _source_row_number:
                sheet!.physicalRowNumbers[analysed.findIndex((item) => item.values === values)] ??
                null,
              ...(group
                ? { [GROUP_KEY_FIELD]: group.key, [GROUP_ADDRESS_FIELD]: group.address }
                : {}),
              ...(reviewContext ? { review_context: reviewContext } : {}),
              ...(transactionSourceSystem
                ? {
                    transaction_source_system: transactionSourceSystem,
                    transaction_source_confidence: sourceConfidence,
                    transaction_object_type: transactionObjectType,
                  }
                : { transaction_source_confidence: "unknown" }),
            } as unknown as Record<string, string>,
            candidate_person_ids: candidateIds,
            status: "pending",
          })
          .select("id")
          .single();
        if (error) throw error;
        return data.id;
      }

      // Existing households, so people at the same address join one household
      // instead of each row creating a fresh duplicate.
      const existingHouses = (await fetchAll<{ id: string; name: string; address: string | null }>(
        (f, t) => supabase.from("households").select("id, name, address").order("id").range(f, t),
      )) as { id: string; name: string; address: string | null }[];
      const houseByKey = new Map<string, string>();
      for (const h of existingHouses) {
        const k = addressKey(h.address);
        if (k && !houseByKey.has(k)) houseByKey.set(k, h.id);
        const nk = (h.name ?? "").trim().toLowerCase();
        if (nk && !houseByKey.has(`name:${nk}`)) houseByKey.set(`name:${nk}`, h.id);
      }

      // Everyone we can match against — the contacts already on file PLUS every
      // person this import creates as it goes, so the same person listed three
      // times in one file is only ever created once.
      const livePeople: ExistingPerson[] = [...(people ?? [])];
      function remember(entry: {
        id: string;
        first: string;
        last: string;
        email?: string | null;
        phone?: string | null;
        householdId?: string | null;
        address?: string | null;
        birthDate?: string | null;
        methods?: { kind: string; value: string }[];
      }) {
        const existing = livePeople.find((p) => p.id === entry.id);
        if (existing) {
          existing.email = existing.email ?? entry.email ?? null;
          existing.phone = existing.phone ?? entry.phone ?? null;
          existing.contact_methods = [
            ...(existing.contact_methods ?? []),
            ...(entry.methods ?? []),
          ];
          return;
        }
        livePeople.push({
          id: entry.id,
          first_name: entry.first,
          last_name: entry.last,
          email: entry.email ?? null,
          phone: entry.phone ?? null,
          birth_date: entry.birthDate ?? null,
          household_id: entry.householdId ?? null,
          households: entry.address ? { name: "", address: entry.address } : null,
          contact_methods: entry.methods ?? [],
        });
      }

      // Which event each row links to. Names the reviewer asked us to create are
      // created once here, so 40 rows never make 40 copies of the same event.
      const eventIdByKey = new Map<string, string>();
      for (const fe of fileEvents) {
        const answered = eventDecisions[fe.key];
        if (answered?.action === "ignore") continue;
        if (fe.matched) {
          eventIdByKey.set(fe.key, fe.matched.id);
          continue;
        }
        const decision = answered;
        if (decision?.action === "existing") eventIdByKey.set(fe.key, decision.eventId);
        if (decision?.action === "create") {
          const { data: createdEvent } = await supabase
            .from("events")
            .insert({ name: fe.value, date: importDate, program: null })
            .select("id, name, date")
            .single();
          if (createdEvent?.id) eventIdByKey.set(fe.key, createdEvent.id);
        }
      }
      const eventNameById = new Map<string, { name: string; date: string }>(
        (events ?? []).map((e) => [e.id, { name: e.name, date: e.date }]),
      );

      // Answers to the shared-address questions, looked up by row.
      const decisionByRow = new Map<
        number,
        { action: AddressDecision["action"]; relationship: string }
      >();
      for (const group of addressGroups) {
        const decision = addressDecisions[group.key];
        if (!decision) continue;
        for (const r of group.rows) {
          decisionByRow.set(r.index, {
            action: decision.action,
            relationship: decision.relationships[r.index] ?? "",
          });
        }
      }

      type HouseParts = {
        address: string | null;
        address_line2: string | null;
        city: string | null;
        state: string | null;
        postal_code: string | null;
      };

      /** Resolve household intent without writing; the row RPC applies it. */
      function resolveHouseholdIntent(
        name: string,
        parts: HouseParts,
        allowAddressLink = true,
        allowNameLink = false,
      ) {
        const key = allowAddressLink ? addressKey(parts.address) : null;
        const nameKey = allowNameLink ? `name:${name.trim().toLowerCase()}` : "";
        const found =
          (key ? houseByKey.get(key) : undefined) ??
          (nameKey ? houseByKey.get(nameKey) : undefined);
        if (found) {
          const patch: Partial<HouseParts> = {};
          if (parts.address) patch.address = parts.address;
          if (parts.address_line2) patch.address_line2 = parts.address_line2;
          if (parts.city) patch.city = parts.city;
          if (parts.state) patch.state = parts.state;
          if (parts.postal_code) patch.postal_code = parts.postal_code;
          return {
            id: found,
            key,
            nameKey,
            payload: { action: "update", id: found, values: { ...patch, status: "active" } },
          };
        }
        return {
          id: null,
          key,
          nameKey,
          payload: { action: "create", values: { name, ...parts, status: "active" } },
        };
      }

      /** Compile-only legacy branch guard; direct rows never call this path. */
      async function ensureHousehold(
        _name: string,
        _parts: HouseParts,
        _allowAddressLink = true,
      ): Promise<string | null> {
        throw new Error("Legacy household write path is disabled");
      }

      // Activity occurrence checks run again against contacts created as the
      // import proceeds; person identity comes from the shared file claim graph.
      const loopSeen = newRowIdentityRegistry();
      const claimGraph = buildFileClaimGraph(analysed.map((item) => item.values));
      const databasePersonByLogicalId = new Map<string, string>();

      /** Resolve fee allocation once so the duplicate pre-check and insert cannot drift. */
      function planRowDonation(v: RowValues, giftDate: string) {
        const eventKey = normalizeLabel(v.event_name ?? "");
        const targetEventId =
          (eventKey ? eventIdByKey.get(eventKey) : undefined) ??
          bulkTarget.eventId ??
          "";
        const explicitEvent = targetEventId
          ? ((events ?? []).find((event) => event.id === targetEventId) ?? {
              id: targetEventId,
              registration_fee: 0,
            })
          : null;
        const nearbyGroup = explicitEvent
          ? undefined
          : giftEventGroups.find(
              (g) => g.event.date >= dayShift(giftDate, -1) && g.event.date <= dayShift(giftDate, 1),
            );
        const nearbyDecision = nearbyGroup ? giftEventDecisions[nearbyGroup.event.id] : undefined;
        const eventDecision = chooseActivityEventDecision({
          explicitEvent,
          nearbyEvent: nearbyGroup?.event ?? null,
          nearbyDecision,
        });
        const activityPlan = buildActivityPlan({
          row: v,
          effectiveDate: giftDate,
          eventDecision,
          transactionSourceSystem: transactionSourceSystem || null,
          transactionObjectType,
        });
        const registrationFee = centsToAmount(activityPlan.registrationFeeCents);
        return {
          targetEventId,
          nearbyGroup,
          nearbyDecision,
          registrationFee,
          donationAmount: centsToAmount(activityPlan.netDonationCents),
          fingerprint: activityPlan.fingerprint,
          activityPlan,
        };
      }

      for (let index = 0; index < analysed.length; index++) {
        const item = analysed[index]!;
        const v = item.values;
        let rowCommitted = false;

        try {
          // Exactly the same check the preview ran, now against the contacts this
          // import has already created.
          const logicalMain = logicalFilePerson(claimGraph, index, "main");
          const mappedMainId = logicalMain
            ? databasePersonByLogicalId.get(logicalMain.id)
            : undefined;
          const mappedMain = mappedMainId
            ? livePeople.find((person) => person.id === mappedMainId)
            : undefined;
          const rawLive = matchRowOnce(v, livePeople, loopSeen, index);
          const live: MatchResult = applyNormalizationReview(
            v,
            mappedMain
              ? {
                  status: "matched",
                  reason: "Same person elsewhere in this file",
                  candidates: [mappedMain],
                }
              : rawLive,
          );
          const flaggedByPreview = item.match.status === "ambiguous";
          const match = live;
          const coupleDecision = v.couple_decision;
          const coupleResolution = correlateFileCoupleResolution(
            resolveCoupleClaims(v, livePeople, match),
            claimGraph,
            index,
          );
          const shared = addressReviewRows.get(index);
          const rowAddress = composeAddress(v);
          const groupInfo = shared
            ? { key: shared.key, address: shared.address }
            : (() => {
                const k = addressKey(rowAddress);
                return k ? { key: k, address: rowAddress ?? "" } : null;
              })();

          const rowAmount = importedAmount(v.amount);
          const rowGiftDate = isoDate(v.date) ?? importDate;
          const giftPlan = planRowDonation(v, rowGiftDate);
          const giftFingerprint = giftPlan.fingerprint;
          const giftAlreadyImported = Boolean(
            giftFingerprint && existingGiftFingerprints.has(giftFingerprint),
          );
          const exactTransactionRepeat = live.status === "matched" &&
            isExactTransactionDonationRepeat({
              row: v,
              personId: live.candidates[0]?.id ?? null,
              fingerprint: giftFingerprint,
              netAmountCents: giftPlan.activityPlan.netDonationCents,
              donationDate: giftPlan.activityPlan.donationDate ?? rowGiftDate,
              eventId: giftPlan.activityPlan.donationEventId,
              existing: existingImportDonations,
            });

          // The gift itself, not the person: the same amount on the same day sitting
          // on a contact we did NOT match to usually means a second record for one donor.
          // Only worth asking about when the other contact is plausibly the same
          // human: a same-day, same-amount gift on an unrelated donor is a
          // coincidence, not a duplicate, and must never reach the review queue.
          const rowFullName = mainName(v).display;
          const giftsElsewhere = (
            Number.isFinite(rowAmount) && rowAmount > 0
              ? await findGiftsOnOtherContacts(
                  rowAmount,
                  rowGiftDate,
                  live.candidates.map((c) => c.id),
                )
              : []
          ).filter((g) => rowFullName && namesAreClose(rowFullName, g.name));
          const activityOwnerReview = needsCoupleActivityOwnerReview(v);

          // Certain identity matches (one exact email, phone, or name plus address/birth date)
          // continue into the fill-blanks path below. Sharing an address must not turn a
          // certain match back into a review item — that was also where mapped birthdays
          // were previously abandoned before the update payload was built.
          if (
            coupleResolution?.kind === "household_conflict" ||
            coupleResolution?.kind === "ambiguous"
          ) {
            const mainPerson = coupleResolution.main.candidates[0];
            const partnerPerson = coupleResolution.partner.candidates[0];
            const reviewContext =
              coupleResolution.kind === "household_conflict" && mainPerson && partnerPerson
                ? {
                    kind: "household_conflict",
                    main_person_id: mainPerson.id,
                    partner_person_id: partnerPerson.id,
                    main_household_id: mainPerson.household_id,
                    partner_household_id: partnerPerson.household_id,
                    main_household_name: mainPerson.households?.name ?? null,
                    partner_household_name: partnerPerson.households?.name ?? null,
                    main_name: [mainPerson.first_name, mainPerson.last_name]
                      .filter(Boolean)
                      .join(" "),
                    partner_name: [partnerPerson.first_name, partnerPerson.last_name]
                      .filter(Boolean)
                      .join(" "),
                  }
                : undefined;
            const reviewQueueId = await queueForReview(
              v,
              coupleResolution.reason,
              [
                ...new Set([
                  ...coupleResolution.main.candidates.map((c) => c.id),
                  ...coupleResolution.partner.candidates.map((c) => c.id),
                ]),
              ],
              groupInfo,
              reviewContext,
            );
            await recordOutcome(index, "flagged", {
              reviewQueueId,
              message: coupleResolution.reason,
            });
            continue;
          }
          if (
            coupleDecision &&
            (coupleDecision.kind === "ambiguous_couple" || coupleDecision.kind === "household_only")
          ) {
            const reviewQueueId = await queueForReview(
              v,
              coupleDecision.reason,
              live.candidates.map((c) => c.id),
              groupInfo,
            );
            await recordOutcome(index, "flagged", {
              reviewQueueId,
              message: coupleDecision.reason,
            });
            continue;
          }
          if (activityOwnerReview) {
            const mainClaim = coupleDecision?.person1;
            const partnerClaim = coupleDecision?.person2;
            const activity = v.amount
              ? {
                  type: "donation",
                  amount: importedAmount(v.amount),
                  date: isoDate(v.date) ?? importDate,
                }
              : v.event_name
                ? { type: "event", name: v.event_name }
                : v.notes
                  ? { type: "note", text: v.notes }
                  : { type: "labels", tags: v.tags ?? null, programs: v.programs ?? null };
            const reviewContext =
              mainClaim && partnerClaim
                ? {
                    kind: "couple_activity_owner",
                    main_claim: {
                      first_name: mainClaim.first,
                      last_name: mainClaim.last,
                      email: v.email ?? null,
                      phone: v.phone ?? null,
                      resolved_person_id: coupleResolution?.main.candidates[0]?.id ?? null,
                    },
                    partner_claim: {
                      first_name: partnerClaim.first,
                      last_name: partnerClaim.last,
                      email: v.spouse_email ?? null,
                      phone: v.spouse_phone ?? null,
                      resolved_person_id: coupleResolution?.partner.candidates[0]?.id ?? null,
                    },
                    activity,
                  }
                : undefined;
            const reviewQueueId = await queueForReview(
              v,
              COUPLE_ACTIVITY_OWNER_REVIEW_REASON,
              live.candidates.map((c) => c.id),
              groupInfo,
              reviewContext,
            );
            await recordOutcome(index, "flagged", {
              reviewQueueId,
              message: COUPLE_ACTIVITY_OWNER_REVIEW_REASON,
            });
            continue;
          }
          if (
            (flaggedByPreview && live.status !== "matched") ||
            live.status === "ambiguous" ||
            (shared && live.status !== "matched") ||
            (giftAlreadyImported && !exactTransactionRepeat) ||
            giftsElsewhere.length > 0
          ) {
            const reason = live.status === "ambiguous" ? live.reason : item.match.reason;
            const reviewQueueId = await queueForReview(
              v,
              giftAlreadyImported
                ? "This gift appears to have already been imported"
                : (flaggedByPreview && live.status !== "matched") || live.status === "ambiguous"
                  ? reason
                  : giftsElsewhere.length > 0
                    ? sameGiftElsewhereReason(rowAmount, rowGiftDate, giftsElsewhere)
                    : `Shares an address with ${(shared?.names.length ?? 1) - 1} other ${
                        (shared?.names.length ?? 2) - 1 === 1 ? "person" : "people"
                      } in this file`,
              [
                ...new Set(
                  (live.candidates.length
                    ? live.candidates.map((c) => c.id)
                    : item.match.candidates.map((c) => c.id)
                  ).concat(
                    // Same-gift candidates are only offered when the name matched too.
                    giftsElsewhere.map((g) => g.personId),
                  ),
                ),
              ],
              groupInfo,
            );
            await recordOutcome(index, "flagged", {
              reviewQueueId,
              message: giftAlreadyImported
                ? "This gift appears to have already been imported"
                : live.status === "ambiguous"
                  ? live.reason
                  : item.match.reason,
            });
            continue;
          }

          let personId = match.candidates[0]?.id ?? null;
          let householdId = match.candidates[0]?.household_id ?? null;
          const { first, last, surname, display } = mainName(v);
          const displayName = display || null;
          const personRole = roleFromRow({
            ...(v.role ? { role: v.role } : {}),
            ...(v.age ? { age: v.age } : {}),
            ...(v.birth_date ? { birth_date: v.birth_date } : {}),
          });
          const fullAddress = composeAddress(v);
          const addressParts = {
            address: fullAddress,
            address_line2: v.address_line2 ?? null,
            city: v.city ?? null,
            state: v.state ?? null,
            postal_code: v.postal_code ?? null,
          };
          const hasFamily = Boolean(
            v.children?.length ||
            v.spouse_full_name ||
            v.spouse_first_name ||
            v.household_name ||
            fullAddress,
          );
          const householdName = v.household_name ?? `${surname || first || "New"} household`;
          // Only group people by address when the reviewer confirmed they're family.
          const addressAnswer = decisionByRow.get(index);
          const allowAddressLink = !addressAnswer || addressAnswer.action === "household";
          const relationship = addressAnswer?.relationship || null;

          const transactionalRow = true as const;
          if (transactionalRow) {
            const existing = match.candidates[0] ?? null;
            const personValues: Record<string, unknown> =
              match.status === "new"
                ? {
                    first_name: first || null,
                    last_name: last || null,
                    display_name: displayName,
                    email: v.email ?? null,
                    phone: v.phone ?? null,
                    birth_date: isoDate(v.birth_date),
                    anniversary_date: isoDate(v.anniversary_date),
                    met_source: v.met_source ?? null,
                    school: v.school ?? null,
                    notes: v.person_notes ?? null,
                    role: personRole,
                    tags: splitList(v.tags),
                    programs: splitList(v.programs),
                    ...(relationship ? { household_relationship: relationship } : {}),
                  }
                : {};
            if (match.status !== "new" && existing) {
              if (v.email && !existing.email) personValues["email"] = v.email;
              if (v.phone && !existing.phone) personValues["phone"] = v.phone;
              const dob = isoDate(v.birth_date);
              if (dob) personValues["birth_date"] = dob;
              const anniversary = isoDate(v.anniversary_date);
              if (anniversary) personValues["anniversary_date"] = anniversary;
              if (v.met_source) personValues["met_source"] = v.met_source;
              if (v.school) personValues["school"] = v.school;
              if (v.person_notes) personValues["notes"] = v.person_notes;
              if (relationship) personValues["household_relationship"] = relationship;
            }

            let householdPlan: ReturnType<typeof resolveHouseholdIntent> | null = null;
            let householdPayload: Record<string, unknown> = { action: "none" };
            if (match.status === "new" && hasFamily) {
              householdPlan = resolveHouseholdIntent(
                householdName,
                addressParts,
                allowAddressLink,
                Boolean(v.household_name?.trim()),
              );
              householdPayload = householdPlan.payload;
              householdId = householdPlan.id;
            } else if (match.status !== "new" && !householdId && hasFamily) {
              householdPlan = resolveHouseholdIntent(
                householdName,
                addressParts,
                allowAddressLink,
                Boolean(v.household_name?.trim()),
              );
              householdPayload = householdPlan.payload;
              householdId = householdPlan.id;
            } else if (match.status !== "new" && householdId && fullAddress) {
              householdPayload = { action: "update", id: householdId, values: addressParts };
            }

            const addressHouseholdId = fullAddress
              ? (houseByKey.get(addressKey(fullAddress) ?? "") ?? null)
              : null;
            if (
              match.status !== "new" &&
              existing?.household_id &&
              addressHouseholdId &&
              addressHouseholdId !== existing.household_id
            ) {
              const reviewQueueId = await queueForReview(
                v,
                "The person matches, but household membership conflicts.",
                [existing.id],
                groupInfo,
              );
              await recordOutcome(index, "flagged", {
                reviewQueueId,
                message: "The person matches, but household membership conflicts.",
              });
              continue;
            }

            const contactMethods = [
              ...(v.phones ?? []).map((method, methodIndex) => ({
                kind: "phone",
                value: method.value,
                method_type: method.method_type,
                is_primary: methodIndex === 0 && match.status === "new",
              })),
              ...(v.emails ?? []).map((method, methodIndex) => ({
                kind: "email",
                value: method.value,
                method_type: method.method_type,
                is_primary: methodIndex === 0 && match.status === "new",
              })),
            ];

            const spouseName = v.spouse_first_name
              ? { first: v.spouse_first_name, last: v.spouse_last_name ?? last }
              : v.spouse_full_name
                ? splitFullName(v.spouse_full_name)
                : null;
            const houseMembers = householdId
              ? ((
                  await supabase
                    .from("people")
                    .select("first_name, last_name")
                    .eq("household_id", householdId)
                ).data ?? [])
              : [];
            const inHousehold = (relativeFirst: string, relativeLast: string) =>
              houseMembers.some(
                (member) =>
                  (member.first_name ?? "").trim().toLowerCase() ===
                    relativeFirst.trim().toLowerCase() &&
                  (member.last_name ?? "").trim().toLowerCase() ===
                    relativeLast.trim().toLowerCase(),
              );

            let spousePayload: Record<string, unknown> = { action: "skip" };
            if (spouseName && (spouseName.first || spouseName.last)) {
              const spouseLast = spouseName.last || last;
              const existingPartner = coupleResolution?.partner.candidates[0] ?? null;
              if (existingPartner && coupleResolution?.partner.status === "matched") {
                spousePayload = {
                  action: "update",
                  id: existingPartner.id,
                  values: { household_relationship: "Spouse" },
                };
              } else if (!inHousehold(spouseName.first, spouseLast)) {
                spousePayload = {
                  action: "create",
                  values: {
                    first_name: spouseName.first || null,
                    last_name: spouseLast || null,
                    display_name: [spouseName.first, spouseLast].filter(Boolean).join(" ") || null,
                    email: v.spouse_email ?? null,
                    phone: v.spouse_phone ?? null,
                    role: "Adult",
                    met_source: v.met_source ?? null,
                  },
                  contact_methods: [
                    ...(v.spouse_phone
                      ? [
                          {
                            kind: "phone",
                            value: v.spouse_phone,
                            method_type: "Mobile",
                            is_primary: true,
                          },
                        ]
                      : []),
                    ...(v.spouse_email
                      ? [
                          {
                            kind: "email",
                            value: v.spouse_email,
                            method_type: "Personal",
                            is_primary: true,
                          },
                        ]
                      : []),
                  ],
                };
                houseMembers.push({ first_name: spouseName.first, last_name: spouseLast });
              }
            }

            const childrenPayload: { action: string; values: Record<string, unknown> }[] = [];
            for (const child of v.children ?? []) {
              const childFirst = child.first.trim();
              const childLast = (child.last ?? "").trim() || last;
              if (!childFirst && !childLast) continue;
              if (inHousehold(childFirst, childLast)) continue;
              childrenPayload.push({
                action: "create",
                values: {
                  first_name: childFirst || null,
                  last_name: childLast || null,
                  display_name: [childFirst, childLast].filter(Boolean).join(" ") || null,
                  role: "Child",
                  birth_date: isoDate(child.birth_date),
                  school: child.school ?? null,
                  met_source: v.met_source ?? null,
                  programs: splitList(v.programs),
                },
              });
              houseMembers.push({ first_name: childFirst, last_name: childLast });
            }

            const provenance = (
              [
                "email",
                "phone",
                "address",
                "birth_date",
                "anniversary_date",
                "met_source",
                "school",
              ] as FieldKey[]
            )
              .filter((key) => Boolean(v[key]))
              .map((key) => ({ field_name: key, source, recorded_date: importDate }));

            const registrations = new Map<string, Record<string, unknown>>();
            const registrationEventId = giftPlan.activityPlan.attendanceIntent
              ? giftPlan.activityPlan.eventId
              : null;
            if (registrationEventId) {
              registrations.set(registrationEventId, {
                event_id: registrationEventId,
                ...(Number.isFinite(rowAmount) && rowAmount > 0
                  ? { fee_amount: giftPlan.registrationFee, payment_amount: rowAmount }
                  : {}),
              });
            }

            let donationPayload: Record<string, unknown> | null = null;
            if (v.amount) {
              const amount = importedAmount(v.amount);
              const readDate = isoDate(v.date);
              if (v.date && !readDate) {
                unreadableGiftDates += 1;
              } else if (Number.isFinite(amount) && amount > 0) {
                const giftDate = readDate ?? importDate;
                const { donationAmount, fingerprint } = giftPlan;
                if (donationAmount > 0) {
                  donationPayload = {
                    amount: donationAmount,
                    date: giftDate,
                    campaign_name: giftPlan.activityPlan.campaignName,
                    event_id: giftPlan.activityPlan.donationEventId,
                    source,
                    notes: v.notes ?? null,
                    import_batch_id: batch.id,
                    import_fingerprint: fingerprint,
                    external_transaction_id: giftPlan.activityPlan.sourceTransactionId,
                    external_transaction_id_key: giftPlan.activityPlan.sourceTransactionIdentity,
                    transaction_source_system: giftPlan.activityPlan.sourceSystem,
                    transaction_object_type: giftPlan.activityPlan.transactionObjectType,
                  };
                }
              }
            }

            const noteParts = [
              v.notes,
              v.person_notes ? `Note: ${v.person_notes}` : "",
              v.school ? `School: ${v.school}` : "",
            ]
              .filter(Boolean)
              .join(" Â· ");
            const notePayload =
              noteParts && !giftPlan.activityPlan.donationIntent
                ? { date: importDate, text: noteParts, author: "Import" }
                : null;

            if (personId && registrations.size > 0) {
              const incomingRegistration = [...registrations.values()][0]!;
              if (giftPlan.activityPlan.grossPaymentCents !== null) {
                const { data: storedRegistration } = await supabase
                  .from("registrations")
                  .select("id, payment_amount, fee_amount")
                  .eq("person_id", personId)
                  .eq("event_id", String(incomingRegistration["event_id"]))
                  .maybeSingle();
                const storedPayment = storedRegistration?.payment_amount;
                const paymentConflict = findRegistrationPaymentConflict(
                  storedPayment,
                  giftPlan.activityPlan.grossPaymentCents,
                );
                if (paymentConflict) {
                  const eventId = String(incomingRegistration["event_id"]);
                  const eventName = (events ?? []).find((event) => event.id === eventId)?.name
                    ?? v.event_name
                    ?? "Event";
                  const reviewContext: RegistrationPaymentConflictContext = {
                    kind: "registration_payment_conflict",
                    person_id: personId,
                    registration_id: storedRegistration?.id ?? null,
                    event_id: eventId,
                    event_name: eventName,
                    existing_payment_cents: paymentConflict.existingPaymentCents,
                    incoming_payment_cents: paymentConflict.incomingPaymentCents,
                    fee_cents: giftPlan.activityPlan.registrationFeeCents,
                    planned_net_donation_cents: giftPlan.activityPlan.netDonationCents,
                    donation_fingerprint: giftPlan.activityPlan.fingerprint,
                  };
                  const reviewQueueId = await queueForReview(
                    v,
                    paymentConflict.reason,
                    [personId],
                    groupInfo,
                    reviewContext,
                  );
                  await recordOutcome(index, "flagged", { reviewQueueId, message: "Registration payment requires an explicit decision." });
                  continue;
                }
              }
            }

            const { data: resolved, error: resolveError } = await supabase.rpc(
              "resolve_import_row",
              {
                _person: {
                  action: match.status === "new" ? "create" : "update",
                  ...(personId ? { id: personId } : {}),
                  values: personValues,
                } as Json,
                _household: householdPayload as Json,
                _contact_methods: contactMethods,
                _labels: {
                  tags: bulkTarget.tag ? [bulkTarget.tag] : [],
                  programs: bulkTarget.program ? [bulkTarget.program] : [],
                },
                _provenance: provenance,
                _batch_id: batchId,
                _spouse: spousePayload as Json,
                _children: childrenPayload as Json,
                _activity: {
                  registrations: [...registrations.values()],
                  donation: donationPayload,
                  note: notePayload,
                } as Json,
              },
            );
            if (resolveError) throw resolveError;
            const result = resolved as {
              person_id?: string;
              household_id?: string | null;
              spouse_id?: string | null;
              child_ids?: string[];
            } | null;
            if (!result?.person_id) throw new Error("The imported contact ID was not returned.");
            rowCommitted = true;
            personId = result.person_id;
            householdId = result.household_id ?? null;

            if (householdPlan && householdId) {
              if (householdPlan.key) houseByKey.set(householdPlan.key, householdId);
              if (householdPlan.nameKey) houseByKey.set(householdPlan.nameKey, householdId);
            }
            remember({
              id: personId,
              first,
              last,
              email: v.email ?? null,
              phone: v.phone ?? null,
              birthDate: isoDate(v.birth_date),
              householdId,
              address: fullAddress,
              methods: contactMethods.map((method) => ({
                kind: method.kind,
                value: method.value,
              })),
            });
            if (result.spouse_id && spouseName) {
              remember({
                id: result.spouse_id,
                first: spouseName.first || "",
                last: spouseName.last || last,
                email: v.spouse_email ?? null,
                phone: v.spouse_phone ?? null,
                householdId,
                address: fullAddress,
              });
            }
            if (logicalMain) databasePersonByLogicalId.set(logicalMain.id, personId);
            const logicalPartner = logicalFilePerson(claimGraph, index, "partner");
            if (logicalPartner && result.spouse_id)
              databasePersonByLogicalId.set(logicalPartner.id, result.spouse_id);
            (result.child_ids ?? []).forEach((childId, childIndex) => {
              const child = childrenPayload[childIndex]?.values;
              remember({
                id: childId,
                first: String(child?.["first_name"] ?? ""),
                last: String(child?.["last_name"] ?? ""),
                householdId,
                address: fullAddress,
              });
            });
            if (donationPayload?.["import_fingerprint"]) {
              existingGiftFingerprints.add(String(donationPayload["import_fingerprint"]));
            }
            await recordOutcome(index, match.status === "new" ? "created" : "matched", {
              personId,
            });
          } else {
            // DEPRECATED/QUARANTINED: unreachable while transactionalRow is the
            // literal true. Do not re-enable this select-then-insert activity
            // implementation; resolve_import_row is the authoritative path.
            if (match.status === "new") {
              if (hasFamily) {
                householdId = await ensureHousehold(householdName, addressParts, allowAddressLink);
              }
              const { data: created, error: createError } = await supabase
                .from("people")
                .insert({
                  first_name: first || null,
                  last_name: last || null,
                  display_name: displayName,
                  email: v.email ?? null,
                  phone: v.phone ?? null,
                  birth_date: isoDate(v.birth_date),
                  anniversary_date: isoDate(v.anniversary_date),
                  met_source: v.met_source ?? null,
                  school: v.school ?? null,
                  notes: v.person_notes ?? null,
                  household_id: householdId,
                  role: personRole,
                  tags: splitList(v.tags),
                  programs: splitList(v.programs),
                  ...(relationship ? { household_relationship: relationship } : {}),
                  import_batch_id: batch.id,
                })
                .select("id")
                .single();
              if (createError) throw createError;
              personId = created.id;
              remember({
                id: personId,
                first,
                last,
                email: v.email ?? null,
                phone: v.phone ?? null,
                birthDate: isoDate(v.birth_date),
                householdId,
                address: fullAddress,
                methods: [
                  ...(v.phones ?? []).map((m) => ({ kind: "phone", value: m.value })),
                  ...(v.emails ?? []).map((m) => ({ kind: "email", value: m.value })),
                ],
              });
            } else if (personId) {
              const existing = match.candidates[0]!;
              const patch: {
                email?: string;
                phone?: string;
                birth_date?: string;
                anniversary_date?: string;
                met_source?: string;
                school?: string;
                notes?: string;
              } = {};
              if (v.email && !existing.email) patch["email"] = v.email;
              if (v.phone && !existing.phone) patch["phone"] = v.phone;
              const dob = isoDate(v.birth_date);
              if (dob) patch["birth_date"] = dob;
              const anniversary = isoDate(v.anniversary_date);
              if (anniversary) patch["anniversary_date"] = anniversary;
              if (v.met_source) patch["met_source"] = v.met_source;
              if (v.school) patch["school"] = v.school;
              if (v.person_notes) patch["notes"] = v.person_notes;
              if (Object.keys(patch).length > 0) {
                await mustWrite(
                  supabase.from("people").update(patch).eq("id", personId),
                  "The matched contact couldn't be updated.",
                );
              }
              remember({
                id: personId,
                first,
                last,
                email: v.email ?? null,
                phone: v.phone ?? null,
                birthDate: isoDate(v.birth_date),
                methods: [
                  ...(v.phones ?? []).map((m) => ({ kind: "phone", value: m.value })),
                  ...(v.emails ?? []).map((m) => ({ kind: "email", value: m.value })),
                ],
              });

              // Existing person, new family details on the row: attach a household if they don't have one.
              if (!householdId && (v.household_name || fullAddress || v.children?.length)) {
                householdId = await ensureHousehold(householdName, addressParts, allowAddressLink);
                if (householdId)
                  await mustWrite(
                    supabase
                      .from("people")
                      .update({ household_id: householdId })
                      .eq("id", personId),
                    "The contact couldn't be linked to the household.",
                  );
              } else if (householdId && fullAddress) {
                const housePatch: {
                  address?: string;
                  address_line2?: string;
                  city?: string;
                  state?: string;
                  postal_code?: string;
                } = {};
                if (fullAddress) {
                  housePatch["address"] = fullAddress;
                  if (v.address_line2) housePatch["address_line2"] = v.address_line2;
                  if (v.city) housePatch["city"] = v.city;
                  if (v.state) housePatch["state"] = v.state;
                  if (v.postal_code) housePatch["postal_code"] = v.postal_code;
                }
                if (Object.keys(housePatch).length > 0)
                  await mustWrite(
                    supabase.from("households").update(housePatch).eq("id", householdId),
                    "The household couldn't be updated.",
                  );
              }
            }

            if (!personId) throw new Error("No contact was created or matched for this row.");

            if (relationship) {
              await mustWrite(
                supabase
                  .from("people")
                  .update({ household_relationship: relationship })
                  .eq("id", personId),
                "The household relationship couldn't be saved.",
              );
            }

            // Link this contact to the event named on the row, or to the event the
            // reviewer chose for the whole file. One shared attendance function, so an
            // existing RSVP is upgraded to Attended instead of being left as-is.
            const targetEventId = giftPlan.targetEventId;
            if (targetEventId) {
              const linkedEvent = (events ?? []).find((e) => e.id === targetEventId) ?? null;
              const fee = giftPlan.registrationFee;
              await recordAttendance({
                personId,
                eventId: targetEventId,
                eventName: linkedEvent?.name ?? "an event",
                eventDate: linkedEvent?.date ?? null,
                importBatchId: batchId,
                ...(fee > 0 ? { feeAmount: fee, paymentAmount: rowAmount } : {}),
              });
              // The attendance timeline entry is written by the database from the
              // registration, so removing the registration removes the entry too.
            }

            // Programs and lists chosen for the whole file, added without wiping
            // anything the contact already had.
            if (bulkTarget.program || bulkTarget.tag) {
              const { data: current } = await supabase
                .from("people")
                .select("tags, programs")
                .eq("id", personId)
                .single();
              const patch: { tags?: string[]; programs?: string[] } = {};
              if (bulkTarget.program) {
                const list = current?.programs ?? [];
                if (!list.some((p) => normalizeLabel(p) === normalizeLabel(bulkTarget.program)))
                  patch.programs = [...list, bulkTarget.program];
              }
              if (bulkTarget.tag) {
                const list = current?.tags ?? [];
                if (!list.some((t) => normalizeLabel(t) === normalizeLabel(bulkTarget.tag)))
                  patch.tags = [...list, bulkTarget.tag];
              }
              if (Object.keys(patch).length > 0)
                await supabase.from("people").update(patch).eq("id", personId);
            }

            // Every phone and email on the row is stored, with anything already on
            // file skipped so a re-import never duplicates a number.
            const methodDrafts: MethodDraft[] = [
              ...(v.phones ?? []).map((m, mi) => ({
                kind: "phone" as const,
                value: m.value,
                method_type: m.method_type,
                is_primary: mi === 0 && match.status === "new",
              })),
              ...(v.emails ?? []).map((m, mi) => ({
                kind: "email" as const,
                value: m.value,
                method_type: m.method_type,
                is_primary: mi === 0 && match.status === "new",
              })),
            ];
            if (methodDrafts.length > 0) {
              await addContactMethods(personId, methodDrafts, {
                importBatchId: batchId,
                ...(match.status === "new" ? { existing: [] } : {}),
              });
            }

            // A partner on the same row becomes their own contact in the same household.
            const spouseName = v.spouse_first_name
              ? { first: v.spouse_first_name, last: v.spouse_last_name ?? last }
              : v.spouse_full_name
                ? splitFullName(v.spouse_full_name)
                : null;
            // Only people already in this household count as "already there", so a
            // common first name elsewhere in the database never swallows a real person.
            const houseMembers = householdId
              ? ((
                  await supabase
                    .from("people")
                    .select("first_name, last_name")
                    .eq("household_id", householdId)
                ).data ?? [])
              : [];
            const inHousehold = (f: string, l: string) =>
              houseMembers.some(
                (p) =>
                  (p.first_name ?? "").trim().toLowerCase() === f.trim().toLowerCase() &&
                  (p.last_name ?? "").trim().toLowerCase() === l.trim().toLowerCase(),
              );
            if (spouseName && (spouseName.first || spouseName.last)) {
              const spouseLast = spouseName.last || last;
              if (!inHousehold(spouseName.first, spouseLast)) {
                const { data: spouse, error: spouseError } = await supabase
                  .from("people")
                  .insert({
                    first_name: spouseName.first || null,
                    last_name: spouseLast || null,
                    display_name: [spouseName.first, spouseLast].filter(Boolean).join(" ") || null,
                    email: v.spouse_email ?? null,
                    phone: v.spouse_phone ?? null,
                    household_id: householdId,
                    role: "Adult",
                    met_source: v.met_source ?? null,
                    import_batch_id: batchId,
                  })
                  .select("id")
                  .single();
                if (spouseError) throw spouseError;
                if (spouse?.id) {
                  const spouseMethods: MethodDraft[] = [];
                  if (v.spouse_phone)
                    spouseMethods.push({
                      kind: "phone",
                      value: v.spouse_phone,
                      method_type: "Mobile",
                      is_primary: true,
                    });
                  if (v.spouse_email)
                    spouseMethods.push({
                      kind: "email",
                      value: v.spouse_email,
                      method_type: "Personal",
                      is_primary: true,
                    });
                  if (spouseMethods.length)
                    await addContactMethods(spouse.id, spouseMethods, {
                      importBatchId: batchId,
                      existing: [],
                    });
                  remember({
                    id: spouse.id,
                    first: spouseName.first || "",
                    last: spouseLast || "",
                    email: v.spouse_email ?? null,
                    phone: v.spouse_phone ?? null,
                    householdId,
                    address: fullAddress,
                  });
                }
                houseMembers.push({ first_name: spouseName.first, last_name: spouseLast });
              }
            }

            // Children listed on the row each become their own contact, linked by household.
            for (const child of v.children ?? []) {
              const childFirst = child.first.trim();
              const childLast = (child.last ?? "").trim() || last;
              if (!childFirst && !childLast) continue;
              if (inHousehold(childFirst, childLast)) continue;
              const { data: childRow, error: childError } = await supabase
                .from("people")
                .insert({
                  first_name: childFirst || null,
                  last_name: childLast || null,
                  display_name: [childFirst, childLast].filter(Boolean).join(" ") || null,
                  household_id: householdId,
                  role: "Child",
                  birth_date: isoDate(child.birth_date),
                  school: child.school ?? null,
                  met_source: v.met_source ?? null,
                  programs: splitList(v.programs),
                  import_batch_id: batchId,
                })
                .select("id")
                .single();
              if (childError) throw childError;
              if (childRow?.id)
                remember({
                  id: childRow.id,
                  first: childFirst,
                  last: childLast,
                  householdId,
                  address: fullAddress,
                });
              houseMembers.push({ first_name: childFirst, last_name: childLast });
            }

            for (const key of [
              "email",
              "phone",
              "address",
              "birth_date",
              "anniversary_date",
              "met_source",
              "school",
            ] as FieldKey[]) {
              if (v[key])
                fieldSources.push({
                  person_id: personId,
                  field_name: key,
                  source,
                  recorded_date: importDate,
                  import_batch_id: batch.id,
                });
            }

            if (v.amount) {
              const amount = importedAmount(v.amount);
              const readDate = isoDate(v.date);
              if (v.date && !readDate) {
                // Better no gift than a gift dated today: a wrong date corrupts
                // giving history, so the row is reported instead of guessed at.
                unreadableGiftDates += 1;
              } else if (Number.isFinite(amount) && amount > 0) {
                const giftDate = readDate ?? importDate;
                const {
                  nearbyGroup,
                  nearbyDecision,
                  registrationFee,
                  donationAmount,
                  fingerprint,
                } = giftPlan;
                const rowCampaignId = await resolveCampaignId(v.campaign);
                // Re-importing the same file must not add the same gift twice, and a
                // gift only ever gets one timeline entry — the donation itself.
                const dupeCheck = supabase
                  .from("donations")
                  .select("id")
                  .eq("person_id", personId)
                  .eq("amount", donationAmount)
                  .eq("date", giftDate)
                  .is("deleted_at", null);
                const { data: existingGift } = await (
                  rowCampaignId
                    ? dupeCheck.eq("campaign_id", rowCampaignId)
                    : dupeCheck.is("campaign_id", null)
                ).limit(1);
                if (!existingGift?.length && donationAmount > 0) {
                  const { data: newGift, error: giftError } = await supabase
                    .from("donations")
                    .insert({
                      person_id: personId,
                      amount: donationAmount,
                      date: giftDate,
                      campaign_id: rowCampaignId,
                      source,
                      notes: v.notes ?? null,
                      import_batch_id: batch.id,
                      import_fingerprint: fingerprint,
                    })
                    .select("id")
                    .single();
                  if (giftError) throw giftError;

                  // Apply the reviewer's one decision about gifts made on an event date.
                  const giftEvent = nearbyGroup;
                  const decision = giftEvent ? giftEventDecisions[giftEvent.event.id] : undefined;
                  if (
                    newGift?.id &&
                    giftEvent &&
                    (decision === "attended" || decision === "gift_only")
                  ) {
                    await attributeGiftToEvent({
                      donationId: newGift.id,
                      personId,
                      eventId: giftEvent.event.id,
                      attended: decision === "attended",
                      importBatchId: batchId,
                      ...(decision === "attended" && registrationFee > 0
                        ? { feeAmount: registrationFee, paymentAmount: amount }
                        : {}),
                    });
                  } else if (newGift?.id && targetEventId) {
                    // The row named an event or a campaign that is an event, so the
                    // gift is credited to it and the person counts as having come.
                    await attributeGiftToEvent({
                      donationId: newGift.id,
                      personId,
                      eventId: targetEventId,
                      attended: true,
                      importBatchId: batchId,
                    });
                  }
                  if (fingerprint) existingGiftFingerprints.add(fingerprint);
                }
              }
            }

            const noteParts = [
              v.notes,
              v.person_notes ? `Note: ${v.person_notes}` : "",
              v.school ? `School: ${v.school}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            if (noteParts && !v.amount) {
              await guard(
                supabase.from("interactions").insert({
                  person_id: personId,
                  type: "form",
                  date: importDate,
                  text: noteParts,
                  author: "Import",
                  import_batch_id: batch.id,
                }),
                { area: "import", action: "Save an imported detail" },
              );
            }
            await recordOutcome(index, match.status === "new" ? "created" : "matched", {
              personId,
            });
          }
        } catch (rowError) {
          if (rowCommitted) throw rowError;
          const transactionCondition = transactionReviewCondition(rowError);
          if (transactionCondition) {
            const reason = transactionReviewReason(transactionCondition);
            const reviewQueueId = await queueForReview(
              v,
              reason,
              item.match.candidates.map((candidate) => candidate.id),
              null,
              {
                kind: transactionCondition,
                transaction_source_system: transactionSourceSystem || null,
                transaction_object_type: transactionObjectType,
                external_transaction_id: v.transaction_id ?? null,
              },
            );
            await recordOutcome(index, "flagged", {
              reviewQueueId,
              message: reason,
            });
            continue;
          }
          failures += 1;
          console.error("Import row failed", rowError);
          const why = await friendlyDbError(rowError, "We couldn't save this row.");
          try {
            await recordImportRowFailureAndRethrow(
              { batchId, rowNumber: index + 1, rowData: v, message: why },
              rowError,
            );
          } catch (preservedError) {
            console.error("Import row remains failed", preservedError);
          }
        }

        // Let the browser breathe so a long import never freezes the page.
        if (index % 10 === 9 || index === analysed.length - 1) {
          setProgress({ done: index + 1, total: analysed.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const { data: outcomeRows, error: outcomeError } = await supabase
        .from("import_row_outcomes")
        .select("outcome")
        .eq("batch_id", batchId);
      if (outcomeError) throw outcomeError;
      const reconciliation = {
        created: (outcomeRows ?? []).filter((row) => row.outcome === "created").length,
        matched: (outcomeRows ?? []).filter((row) => row.outcome === "matched").length,
        flagged: (outcomeRows ?? []).filter((row) => row.outcome === "flagged").length,
        failed: (outcomeRows ?? []).filter((row) => row.outcome === "failed").length,
      };
      const processed = Object.values(reconciliation).reduce((sum, count) => sum + count, 0);
      const reconciled = processed === analysed.length;
      const { error: batchFinishError } = await supabase
        .from("import_batches")
        .update({
          processed_rows: processed,
          created_rows: reconciliation.created,
          matched_rows: reconciliation.matched,
          flagged_rows: reconciliation.flagged,
          failed_rows: reconciliation.failed,
          completed_at: new Date().toISOString(),
          status: reconciled && reconciliation.failed === 0 ? "imported" : "needs_attention",
        })
        .eq("id", batchId);
      if (batchFinishError) throw batchFinishError;
      if (!reconciled) {
        throw new Error(
          `Import stopped before reconciliation: ${processed} of ${analysed.length} rows have a final outcome.`,
        );
      }
      const notes = [
        queued > 0
          ? "The rows that need a person to look at them are waiting in the Data Inbox."
          : "",
        unreadableGiftDates > 0
          ? `${unreadableGiftDates} gift${
              unreadableGiftDates === 1 ? " was" : "s were"
            } left out because the date in the file couldn't be read — nothing was dated today by mistake.`
          : "",
      ].filter(Boolean);
      toast.success(
        `${analysed.length} rows reconciled · ${reconciliation.created} created · ${reconciliation.matched} matched · ${reconciliation.flagged} flagged · ${reconciliation.failed} failed${
          counts.extraPeople ? ` · ${counts.extraPeople} family members added` : ""
        }`,
        {
          duration: 12000,
          ...(notes.length > 0 ? { description: notes.join(" ") } : {}),
        },
      );
      await queryClient.invalidateQueries();
      reset();
    } catch (e) {
      const why = await friendlyDbError(e, "Import failed.");
      toast.error(`${why} Your file is still here, nothing was lost.`);
    } finally {
      setBusy(false);
      runningRef.current = false;
    }
  }

  return (
    <AppShell
      title="Import Center"
      subtitle="Nothing is saved until you approve it"
      action={
        <Link
          to="/inbox/review"
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary"
        >
          Data Inbox{pendingCount ? ` (${pendingCount})` : ""}
        </Link>
      }
    >
      {!workbook && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center shadow-sm">
          <UploadCloud className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-heading font-semibold text-foreground">Upload a spreadsheet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            CSV or Excel exports from Donorbox, Constant Contact, Cognito Forms, QuickBooks,
            Salesforce or Google Sheets. Names can be split, combined, or last name only — you can
            set that in the mapping.
          </p>
          <label className="mt-4 inline-block">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-base font-medium text-primary-foreground">
              <FileSpreadsheet className="size-4" /> Choose a file
            </span>
          </label>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-2xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">
          {error}
        </p>
      )}

      {workbook && (
        <section className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading font-semibold text-foreground">Workbook structure</h2>
              <p className="text-sm text-muted-foreground">
                {workbook.filename} · {workbook.sheets.length} sheet
                {workbook.sheets.length === 1 ? "" : "s"}. Choose the sheet and tell us where its
                headers are. A data row is never removed unless you explicitly select it as the
                header.
              </p>
            </div>
            <Button type="button" variant="outline" className="rounded-xl" onClick={reset}>
              Choose another file
            </Button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Worksheet">
              <select
                className={selectClass}
                value={sheet?.sheetIndex ?? ""}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  const chosen = workbook.sheets[index];
                  if (!chosen) return;
                  const detected = chosen.detectedHeader.rowNumber;
                  applySheetSelection(
                    workbook,
                    index,
                    detected,
                    detected === null ? "none" : "detected",
                  );
                }}
              >
                <option value="">Select a worksheet</option>
                {workbook.sheets.map((candidate) => (
                  <option key={`${candidate.index}-${candidate.name}`} value={candidate.index}>
                    {candidate.name} · {candidate.physicalRowCount} rows · {candidate.columnCount}{" "}
                    columns
                    {candidate.visibility === "visible" ? "" : ` · ${candidate.visibility}`}
                  </option>
                ))}
              </select>
            </Field>
            {sheet && workbook.sheets[sheet.sheetIndex] && (
              <Field label="Header row">
                <select
                  className={selectClass}
                  value={sheet.headerRowNumber ?? "none"}
                  onChange={(event) => {
                    const rowNumber =
                      event.target.value === "none" ? null : Number(event.target.value);
                    const detected = workbook.sheets[sheet.sheetIndex]!.detectedHeader.rowNumber;
                    applySheetSelection(
                      workbook,
                      sheet.sheetIndex,
                      rowNumber,
                      rowNumber === null ? "none" : rowNumber === detected ? "detected" : "manual",
                    );
                  }}
                >
                  <option value="none">No header row — assign columns manually</option>
                  {workbook.sheets[sheet.sheetIndex]!.rows.filter((row) =>
                    row.cells.some((cell) => cell.display),
                  )
                    .slice(0, 25)
                    .map((row) => (
                      <option key={row.physicalRowNumber} value={row.physicalRowNumber}>
                        Row {row.physicalRowNumber}:{" "}
                        {row.cells
                          .map((cell) => cell.display)
                          .filter(Boolean)
                          .slice(0, 4)
                          .join(" · ")}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {workbook.sheets.map((candidate) => (
              <button
                key={`summary-${candidate.index}`}
                type="button"
                onClick={() =>
                  applySheetSelection(
                    workbook,
                    candidate.index,
                    candidate.detectedHeader.rowNumber,
                    candidate.detectedHeader.rowNumber === null ? "none" : "detected",
                  )
                }
                className={`rounded-xl border p-3 text-left text-sm ${
                  sheet?.sheetIndex === candidate.index
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <span className="font-medium text-foreground">{candidate.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {candidate.usedRange ?? "empty"} · {candidate.visibility} ·{" "}
                  {candidate.detectedHeader.reason}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {sheet && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">{sheet.name}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              <Stat icon={Users} label="Rows found" value={counts.total} tone="text-foreground" />
              <Stat
                icon={CheckCircle2}
                label="Match existing people"
                value={counts.matched}
                tone="text-money"
              />
              <Stat icon={UserPlus} label="Look new" value={counts.new} tone="text-primary" />
              <Stat icon={Users} label="Couples" value={counts.couples} tone="text-money" />
              <Stat
                icon={AlertTriangle}
                label="Need review"
                value={plan.review}
                tone="text-suggestion"
              />
            </div>
            {counts.extraPeople > 0 && (
              <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
                {counts.extraPeople} family member{counts.extraPeople === 1 ? "" : "s"} on these
                rows (partners and children) will each get their own contact, linked to the same
                household.
              </p>
            )}
            <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
              <strong>{plan.importNow}</strong> row{plan.importNow === 1 ? "" : "s"} will be
              imported straight away.
              {plan.review > 0 ? (
                <>
                  {" "}
                  <strong>{plan.review}</strong> row{plan.review === 1 ? "" : "s"} that need a
                  person to look at them go to the Data Inbox — you don't have to sort them out now,
                  and they'll wait there until you do.
                </>
              ) : null}
            </p>
            {progress && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {busy ? "Importing" : "Finished"} {progress.done} of {progress.total} rows — keep
                  this tab open.
                </p>
              </div>
            )}
          </section>

          {fileEvents.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">Events in this file</h2>
              <p className="text-sm text-muted-foreground">
                These are the explicit event names in the file. Every unmatched event must be linked,
                created, or ignored before import. We never create an event without asking.
                {unansweredEvents.length > 0
                  ? ` ${unansweredEvents.length} name${unansweredEvents.length === 1 ? "" : "s"} still unanswered.`
                  : ""}
              </p>
              <div className="mt-3 space-y-2">
                {fileEvents.map((fe) => {
                  const decision = eventDecisions[fe.key];
                  return (
                    <div key={fe.key} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-medium text-foreground">
                        “{fe.value}” — {fe.rows} row{fe.rows === 1 ? "" : "s"}
                        {fe.origin === "campaign" && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                            from the campaign column
                          </span>
                        )}
                      </p>
                      {fe.matched ? (
                        <div className="mt-1">
                          <p className="text-sm text-money">
                            Matches your event “{fe.matched.name}”. Those people will be marked as
                            having attended
                            {fe.origin === "campaign" ? ", and their gifts credited to it" : ""}.
                          </p>
                          <button
                            type="button"
                            className={`mt-2 rounded-xl border px-3 py-1.5 text-sm ${
                              decision?.action === "ignore"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-foreground"
                            }`}
                            onClick={() =>
                              setEventDecisions((d) => {
                                const next = { ...d };
                                if (next[fe.key]?.action === "ignore") delete next[fe.key];
                                else next[fe.key] = { action: "ignore" };
                                return next;
                              })
                            }
                          >
                            {decision?.action === "ignore"
                              ? "Not linked — click to link again"
                              : "Don't link this one"}
                          </button>
                        </div>
                      ) : (
                        <EventDecisionPicker
                          name={fe.value}
                          rows={fe.rows}
                          events={events ?? []}
                          decision={decision}
                          onApply={(next) => setEventDecisions((d) => ({ ...d, [fe.key]: next }))}
                          onClear={() =>
                            setEventDecisions((d) => {
                              const nextState = { ...d };
                              delete nextState[fe.key];
                              return nextState;
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {giftEventGroups.length > 0 && (
            <section className="rounded-2xl border border-money/40 bg-money/5 p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">
                Gifts made on an event date
              </h2>
              <p className="text-sm text-muted-foreground">
                One answer covers the whole file — we won't ask row by row.
              </p>
              <div className="mt-3 space-y-3">
                {giftEventGroups.map((g) => {
                  const decision = giftEventDecisions[g.event.id];
                  return (
                    <div key={g.event.id} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-sm text-foreground">
                        These {g.rows} {g.rows === 1 ? "gift" : "gifts"} were made on the date of “
                        {g.event.name}” ({g.event.date}) — link them to that event?
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(
                          [
                            ["attended", "Yes — link gifts and mark them as attended"],
                            ["gift_only", "Link the gifts only (they may not have come)"],
                            ["skip", "No, keep them unlinked"],
                          ] as const
                        ).map(([action, label]) => (
                          <button
                            key={action}
                            type="button"
                            className={`rounded-xl border px-3 py-2 text-sm ${
                              decision === action
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-foreground"
                            }`}
                            onClick={() =>
                              setGiftEventDecisions((d) => ({ ...d, [g.event.id]: action }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">
              Add everyone in this file to…
            </h2>
            <p className="text-sm text-muted-foreground">
              Optional. Use this when a whole file belongs to one event, program or list.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Event">
                <select
                  className={selectClass}
                  value={bulkTarget.eventId}
                  onChange={(e) => setBulkTarget((t) => ({ ...t, eventId: e.target.value }))}
                >
                  <option value="">No event</option>
                  {(events ?? []).map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({ev.date})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Program">
                <select
                  className={selectClass}
                  value={bulkTarget.program}
                  onChange={(e) => setBulkTarget((t) => ({ ...t, program: e.target.value }))}
                >
                  <option value="">No program</option>
                  {(programOptions ?? []).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tag or list">
                <select
                  className={selectClass}
                  value={bulkTarget.tag}
                  onChange={(e) => setBulkTarget((t) => ({ ...t, tag: e.target.value }))}
                >
                  <option value="">No tag</option>
                  {(tagOptions ?? []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {(eventLinkPlan.totals.length > 0 || bulkTarget.program || bulkTarget.tag) && (
              <div className="mt-3 space-y-1 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
                {eventLinkPlan.totals.map((t) => (
                  <p key={t.name}>
                    {t.count} {t.count === 1 ? "person" : "people"} will be marked as attending “
                    {t.name}”.
                  </p>
                ))}
                {bulkTarget.program && (
                  <p>
                    {counts.matched + counts.new}{" "}
                    {counts.matched + counts.new === 1 ? "person" : "people"} will be added to the{" "}
                    {bulkTarget.program} program.
                  </p>
                )}
                {bulkTarget.tag && (
                  <p>
                    {counts.matched + counts.new}{" "}
                    {counts.matched + counts.new === 1 ? "person" : "people"} will get the “
                    {bulkTarget.tag}” tag.
                  </p>
                )}
              </div>
            )}
          </section>

          {addressGroups.length > 0 && (
            <section className="rounded-2xl border border-suggestion/40 bg-suggestion/5 p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">
                Same address, different last names
              </h2>
              <p className="text-sm text-muted-foreground">
                We won't guess. Answer here if you know, or leave it — anyone you don't answer for
                goes to the Data Inbox as one card per address, so you can decide later without
                holding up the import.
              </p>
              <div className="mt-3 space-y-3">
                {addressGroups.map((group) => {
                  const decision = addressDecisions[group.key];
                  return (
                    <div key={group.key} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-sm font-medium text-foreground">{group.address}</p>
                      <p className="text-sm text-muted-foreground">
                        {group.rows.map((r) => r.name).join(", ")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(
                          [
                            ["household", "They're one household"],
                            ["unrelated", "Not related — keep separate"],
                            ["later", "Decide later"],
                          ] as const
                        ).map(([action, label]) => (
                          <button
                            key={action}
                            type="button"
                            className={`rounded-xl border px-3 py-2 text-sm ${
                              decision?.action === action
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-foreground"
                            }`}
                            onClick={() =>
                              setAddressDecisions((d) => ({
                                ...d,
                                [group.key]: {
                                  action,
                                  relationships: d[group.key]?.relationships ?? {},
                                },
                              }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {decision?.action === "household" && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {group.rows.map((r) => (
                            <Field key={r.index} label={`How is ${r.name} related?`}>
                              <select
                                className={selectClass}
                                value={decision.relationships[r.index] ?? ""}
                                onChange={(e) =>
                                  setAddressDecisions((d) => ({
                                    ...d,
                                    [group.key]: {
                                      action: "household",
                                      relationships: {
                                        ...(d[group.key]?.relationships ?? {}),
                                        [r.index]: e.target.value,
                                      },
                                    },
                                  }))
                                }
                              >
                                <option value="">Not sure</option>
                                {RELATIONSHIP_OPTIONS.map((rel) => (
                                  <option key={rel} value={rel}>
                                    {rel}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-heading font-semibold text-foreground">
                  Proposed column mapping
                </h2>
                <p className="text-sm text-muted-foreground">
                  Check anything marked medium or low. Child, phone and email fields can be used
                  more than once — map "Child 1", "Child 2" and so on all to the same child field.
                </p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setAdjusting((a) => !a)}
              >
                {adjusting ? "Done adjusting" : "Adjust mapping"}
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <label className="text-sm font-medium text-foreground" htmlFor="transaction-source-system">
                  Transaction source
                </label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Select a known system to namespace external transaction IDs. Unknown files remain fully importable.
                </p>
                <select
                  id="transaction-source-system"
                  className={selectClass}
                  value={transactionSourceSystem}
                  onChange={(event) => setTransactionSourceSystem(event.target.value)}
                  disabled={busy}
                >
                  {TRANSACTION_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value || "unknown"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {transactionSourceSystem
                    ? "Explicit selection · transaction object type: donation"
                    : "Unknown source · no strong provider namespace will be asserted"}
                </p>
              </div>
              {mapping.map((m, i) => (
                <div
                  key={`${m.header}-${i}`}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.header || `Column ${i + 1}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Value pattern: {sheet.columnProfiles[i]?.shape.replace("_", " ") ?? "unknown"}
                      {sheet.columnProfiles[i]?.samples.length
                        ? ` · ${sheet.columnProfiles[i]!.samples.join(" · ")}`
                        : " · no sample values"}
                    </p>
                  </div>
                  {adjusting ? (
                    <FieldPicker
                      value={m.field}
                      label={m.header || `Column ${i + 1}`}
                      onChange={(field) =>
                        setMapping((prev) =>
                          prev.map((row, ri) =>
                            ri === i ? { ...row, field, confidence: "high" } : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    <div>
                      <p className="text-sm text-foreground">
                        {FIELD_LABELS[m.field]}
                        {REPEATABLE_FIELDS.includes(m.field) && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            can be used more than once
                          </span>
                        )}
                      </p>
                      {FIELD_HINTS[m.field] && (
                        <p className="text-xs text-muted-foreground">{FIELD_HINTS[m.field]}</p>
                      )}
                    </div>
                  )}
                  <span
                    className={`justify-self-start rounded-full px-2.5 py-1 text-xs ${
                      m.confidence === "high"
                        ? "bg-money/15 text-money"
                        : m.confidence === "medium"
                          ? "bg-suggestion/20 text-foreground"
                          : "bg-urgent/15 text-urgent"
                    }`}
                  >
                    {m.confidence} confidence
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-border bg-background p-3">
              <p className="text-sm font-medium text-foreground">
                Does this file have what we need?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {mappingReview.checklist.map((c) => (
                  <span
                    key={c.label}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                      c.ok ? "bg-money/15 text-money" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c.ok ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="text-base leading-none">–</span>
                    )}
                    {c.label}
                    {c.ok ? "" : " not mapped"}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Import is blocked until the mapping contains a usable person identity or activity
                field and has no structural conflicts.
              </p>
            </div>
            {!mappingReview.gate.valid && (
              <ul className="mt-3 space-y-1 rounded-xl border border-urgent/40 bg-urgent/10 p-3 text-sm text-urgent">
                {mappingReview.gate.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            {mappingReview.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-xl border border-suggestion/50 bg-suggestion/10 p-3 text-sm text-foreground">
                {mappingReview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">First rows</h2>
            <div className="mt-3 -mx-5 overflow-x-auto px-5">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">
                      Status
                    </th>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">
                      Will create
                    </th>
                    {sheet.headers.map((h, i) => (
                      <th
                        key={i}
                        className="whitespace-nowrap border-b border-border pb-2 pr-5 text-xs text-muted-foreground"
                      >
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewAnalysed.slice(0, 15).map((a, ri) => (
                    <tr key={ri}>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs">
                        <span
                          className={
                            a.presentation.status === "couple"
                              ? "text-money"
                              : a.match.status === "matched"
                                ? "text-money"
                                : a.match.status === "new"
                                  ? "text-primary"
                                  : "text-urgent"
                          }
                        >
                          {a.presentation.status === "couple" || a.presentation.status === "review"
                            ? a.presentation.reason
                            : a.match.reason}
                        </span>
                      </td>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs text-muted-foreground">
                        {[
                          a.presentation.willCreate === "two contacts"
                            ? "two contacts"
                            : a.presentation.willCreate === "review"
                              ? "review"
                              : a.match.status === "new"
                                ? "contact"
                                : "update",
                          a.values.spouse_full_name || a.values.spouse_first_name ? "partner" : "",
                          a.values.children?.length ? `${a.values.children.length} child` : "",
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </td>
                      {sheet.headers.map((_, ci) => (
                        <td
                          key={ci}
                          className="whitespace-nowrap border-b border-border py-2 pr-5 text-foreground"
                        >
                          {a.row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewAnalysed.length > 15 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the first 15 of {previewAnalysed.length} rows.
              </p>
            )}
          </section>

          <div className="sticky bottom-24 flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm lg:bottom-4">
            {(priorImports ?? []).length > 0 && (
              <label className="flex w-full items-start gap-2 rounded-xl bg-suggestion/10 px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={reimportConfirmed}
                  onChange={(e) => setReimportConfirmed(e.target.checked)}
                />
                <span>
                  This filename, exact file, or equivalent workbook data was already imported
                  {priorImports![0]?.import_date ? ` on ${priorImports![0]!.import_date}` : ""}
                  {(priorImports ?? []).length > 1 ? ` (${priorImports!.length} times)` : ""}. Tick
                  this box if you really want to import it again.
                </span>
              </label>
            )}
            {sheet.headerRowNumber !== null &&
              workbook?.sheets[sheet.sheetIndex]?.detectedHeader.rowNumber !==
                sheet.headerRowNumber && (
                <label className="flex w-full items-start gap-2 rounded-xl bg-urgent/10 px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={headerRiskConfirmed}
                    onChange={(event) => setHeaderRiskConfirmed(event.target.checked)}
                  />
                  <span>
                    Header detection was uncertain. I checked row {sheet.headerRowNumber} and
                    confirm that it contains column labels, not the first data record.
                  </span>
                </label>
              )}
            <Button
              className="rounded-xl"
              disabled={busy || !mappingReview.gate.valid || unansweredEvents.length > 0}
              onClick={() => void approve()}
            >
              {busy
                ? `Importing… ${progress?.done ?? 0}/${progress?.total ?? 0}`
                : "Approve & import"}
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setAdjusting(true)}
              disabled={busy}
            >
              Adjust mapping
            </Button>
            <Button
              variant="ghost"
              className="rounded-xl text-urgent"
              onClick={reset}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!sheet && !error && (
        <div className="mt-5">
          <EmptyState label="No file loaded yet." />
        </div>
      )}

      <ImportHistory />
    </AppShell>
  );
}

function ImportHistory() {
  const queryClient = useQueryClient();
  const [undoing, setUndoing] = useState<string | null>(null);
  const isAdmin = useIsAdmin();

  const { data: batches } = useQuery({
    queryKey: ["import-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  async function undo(id: string) {
    setUndoing(id);
    try {
      const { data, error } = await supabase.rpc("undo_import", { _batch_id: id });
      if (error) throw error;
      const counts = (data ?? {}) as Record<string, number>;
      toast.success(
        `Import undone — removed ${counts["people"] ?? 0} contacts and ${counts["donations"] ?? 0} gifts it had added.`,
      );
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo that import");
    } finally {
      setUndoing(null);
    }
  }

  if (!batches || batches.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-heading font-semibold text-foreground">Past imports</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Undoing an import removes only the records that import created. Anything you added or edited
        by hand stays.
      </p>
      <div className="mt-3 space-y-2">
        {batches.map((b) => (
          <div
            key={b.id}
            className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{b.filename}</p>
              <p className="text-xs text-muted-foreground">
                {b.import_date} · {b.total_rows} rows · {b.created_rows} created · {b.matched_rows}{" "}
                matched · {b.flagged_rows} flagged · {b.failed_rows} failed
                {b.processed_rows !== b.total_rows ? ` · ${b.processed_rows} processed` : ""}
                {b.status === "reverted"
                  ? " · undone"
                  : b.status === "processing"
                    ? " · interrupted"
                    : b.status === "needs_attention"
                      ? " · needs attention"
                      : " · reconciled"}
              </p>
            </div>
            {b.status === "reverted" ? (
              <span className="justify-self-start rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Undone
              </span>
            ) : (
              <Button
                variant="outline"
                className="justify-self-start rounded-xl text-urgent"
                disabled={undoing === b.id || !isAdmin}
                onClick={() => void undo(b.id)}
              >
                {undoing === b.id
                  ? "Undoing…"
                  : isAdmin
                    ? "Undo this import"
                    : "Undo (admins only)"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <Icon className={`size-4 ${tone}`} />
      <p className={`mt-1 font-heading text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
