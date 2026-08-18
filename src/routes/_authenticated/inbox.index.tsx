import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, UserPlus, Users } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "@e965/xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/is-admin";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Field, selectClass } from "@/components/forms/fields";
import { fetchAll } from "@/lib/fetch-all";
import { addContactMethods, type MethodDraft } from "@/lib/contact-methods";
import { normalizeEmail, normalizeState, properCase, properCaseAddress } from "@/lib/proper-case";
import { friendlyDbError } from "@/lib/db-errors";
import { attributeGiftToEvent, recordAttendance } from "@/lib/gift-events";
import { findGiftsOnOtherContacts, sameGiftElsewhereReason } from "@/lib/donation-dupes";
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
import {
  FIELD_LABELS,
  addressKey,
  composeAddress,
  donationImportFingerprint,
  guessMapping,
  matchRowOnce,
  newRowIdentityRegistry,
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

export const Route = createFileRoute("/_authenticated/inbox/")({
  head: () => ({
    meta: [
      { title: "Import Center | Mitzvah House CRM" },
      {
        name: "description",
        content: "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:title", content: "Import Center | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Upload a spreadsheet, review the proposed matches and column mapping, then approve the import.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportCenter,
});

type Sheet = { name: string; headers: string[]; rows: string[][] };

const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

async function readFile(file: File): Promise<Sheet> {
  const isCsv = /\.csv$/i.test(file.name);
  let table: string[][] = [];
  if (isCsv) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
    table = parsed.data;
  } else {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { cellDates: false });
    const first = wb.SheetNames[0];
    if (!first) throw new Error("That workbook has no sheets.");
    const ws = wb.Sheets[first]!;
    table = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  }
  const [headerRow, ...rest] = table;
  if (!headerRow || rest.length === 0) throw new Error("We need a header row plus at least one row of data.");
  return {
    name: file.name,
    headers: headerRow.map((h) => String(h ?? "").trim()),
    rows: rest.map((r) => headerRow.map((_, i) => String(r?.[i] ?? "").trim())),
  };
}

/** Unpack one spreadsheet row: the main contact, their partner, and any children on the row. */
function buildRowValues(row: string[], mapping: ColumnGuess[]): RowValues {
  const out: RowValues = {};
  const childNames: string[] = [];
  const childFirsts: string[] = [];
  const childLasts: string[] = [];
  const childDobs: string[] = [];
  const childAges: string[] = [];
  const childSchools: string[] = [];
  const phones: { value: string; method_type: string }[] = [];
  const emails: { value: string; method_type: string }[] = [];
  const PHONE_COLUMNS: Partial<Record<FieldKey, string>> = {
    phone: "Mobile",
    phone_mobile: "Mobile",
    phone_home: "Home",
    phone_work: "Work",
    phone_other: "Other",
  };
  const EMAIL_COLUMNS: Partial<Record<FieldKey, string>> = {
    email: "Personal",
    email_work: "Work",
    email_other: "Other",
  };

  mapping.forEach((m, i) => {
    const value = row[i]?.trim();
    if (!value || m.field === "ignore") return;
    if (PHONE_COLUMNS[m.field]) {
      // One column can hold several numbers ("404-555-0100 / 404-555-0101").
      for (const part of value.split(/[;,|]|\s\/\s/).map((s) => s.trim()).filter(Boolean)) {
        phones.push({ value: part, method_type: PHONE_COLUMNS[m.field]! });
      }
      if (!out.phone && phones[0]) out.phone = phones[0].value;
      return;
    }
    if (EMAIL_COLUMNS[m.field]) {
      for (const part of value.split(/[;,|\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"))) {
        emails.push({ value: normalizeEmail(part), method_type: EMAIL_COLUMNS[m.field]! });
      }
      if (!out.email && emails[0]) out.email = emails[0].value;
      return;
    }
    if (m.field === "child_name") {
      childNames.push(...splitPeopleList(value));
      return;
    }
    if (m.field === "child_first_name") {
      childFirsts.push(value);
      return;
    }
    if (m.field === "child_last_name") {
      childLasts.push(value);
      return;
    }
    if (m.field === "child_birth_date") {
      childDobs.push(value);
      return;
    }
    if (m.field === "child_age") {
      childAges.push(value);
      return;
    }
    if (m.field === "child_school") {
      childSchools.push(value);
      return;
    }
    if (!out[m.field]) out[m.field] = value;
  });

  // Children can arrive either as whole names ("Child 1", "Child 2") or as paired
  // first/last columns. Both shapes become one child record each.
  const children: NonNullable<RowValues["children"]>[number][] = [];
  childNames.forEach((name, idx) => {
    const n = splitFullName(name);
    if (!n.first && !n.last) return;
    children.push({
      first: n.first,
      ...(n.last ? { last: n.last } : {}),
      ...(childDobs[idx] ? { birth_date: childDobs[idx]! } : {}),
      ...(childAges[idx] ? { age: childAges[idx]! } : {}),
      ...(childSchools[idx] ? { school: childSchools[idx]! } : {}),
    });
  });
  const pairedOffset = childNames.length;
  childFirsts.forEach((first, idx) => {
    if (!first.trim()) return;
    const last = childLasts[idx];
    children.push({
      first: first.trim(),
      ...(last ? { last } : {}),
      ...(childDobs[pairedOffset + idx] ? { birth_date: childDobs[pairedOffset + idx]! } : {}),
      ...(childAges[pairedOffset + idx] ? { age: childAges[pairedOffset + idx]! } : {}),
      ...(childSchools[pairedOffset + idx] ? { school: childSchools[pairedOffset + idx]! } : {}),
    });
  });
  if (children.length > 0) out.children = children;
  if (phones.length > 0) out.phones = phones;
  if (emails.length > 0) out.emails = emails;
  return tidyCase(out);
}

/**
 * Tidy capitalisation on the text that people read: names, addresses, cities.
 * Spelling is never touched, and anything already typed with deliberate internal
 * capitals is left exactly as it is.
 */
function tidyCase(v: RowValues): RowValues {
  const nameKeys: FieldKey[] = [
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "household_name",
    "spouse_full_name",
    "spouse_first_name",
    "spouse_last_name",
    "school",
    "city",
    "county",
  ];
  for (const k of nameKeys) if (v[k]) v[k] = properCase(v[k]!);
  for (const k of ["address", "address_line2", "address_line3", "billing_address"] as FieldKey[]) {
    if (v[k]) v[k] = properCaseAddress(v[k]!);
  }
  if (v.state) v.state = normalizeState(v.state);
  if (v.children) {
    v.children = v.children.map((c) => ({
      ...c,
      first: properCase(c.first),
      ...(c.last ? { last: properCase(c.last) } : {}),
      ...(c.school ? { school: properCase(c.school) } : {}),
    }));
  }
  return v;
}

/** Join the first / middle / last / suffix columns a file happens to have. */
function mainName(v: RowValues) {
  const base = splitName(v);
  const first = [base.first, base.middle].filter(Boolean).join(" ").trim();
  const surname = base.last.trim();
  const last = [surname, base.suffix].filter(Boolean).join(" ").trim();
  const display = [first, last].filter(Boolean).join(" ").trim();
  return { first, last, surname, display };
}

function isoDate(raw: string | undefined) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function splitList(raw: string | undefined) {
  return raw ? raw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [];
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
  const [giftEventDecisions, setGiftEventDecisions] = useState<Record<string, "attended" | "gift_only" | "skip">>({});
  /** Set when staff confirm they really do want to import a file already imported before. */
  const [reimportConfirmed, setReimportConfirmed] = useState(false);
  /** Blocks a double-tap or a browser retry from running the same import twice. */
  const runningRef = useRef(false);

  /** Keep the uploaded file in this browser so a refresh or a timed-out tab doesn't lose the work. */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { sheet: Sheet; mapping: ColumnGuess[] };
      if (draft?.sheet?.headers?.length) {
        setSheet(draft.sheet);
        setMapping(draft.mapping ?? guessMapping(draft.sheet.headers));
      }
    } catch {
      /* ignore a bad draft */
    }
  }, []);

  useEffect(() => {
    try {
      if (sheet) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ sheet, mapping }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* the file is too big to stash — the import still works */
    }
  }, [sheet, mapping]);

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
            "id, first_name, last_name, email, phone, household_id, households(name, address), contact_methods(kind, value)",
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
    queryKey: ["prior-imports", sheet?.name ?? ""],
    enabled: Boolean(sheet?.name),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("id, import_date, total_rows, created_at")
        .eq("filename", sheet!.name)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: events } = useQuery({
    queryKey: ["import-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .is("deleted_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EventOption[];
    },
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

  const analysed = useMemo<{ row: string[]; values: RowValues; match: MatchResult }[]>(() => {
    if (!sheet || !people) return [];
    // One shared duplicate check, so the preview and the import loop agree.
    const seen = newRowIdentityRegistry();
    return sheet.rows.map((row, index) => {
      const values = buildRowValues(row, mapping);
      return { row, values, match: matchRowOnce(values, people, seen, index) };
    });
  }, [sheet, people, mapping]);

  const counts = useMemo(
    () => ({
      total: analysed.length,
      matched: analysed.filter((a) => a.match.status === "matched").length,
      new: analysed.filter((a) => a.match.status === "new").length,
      ambiguous: analysed.filter((a) => a.match.status === "ambiguous").length,
      extraPeople: analysed.reduce(
        (n, a) =>
          n +
          (a.values.children?.length ?? 0) +
          (a.values.spouse_full_name || a.values.spouse_first_name ? 1 : 0),
        0,
      ),
    }),
    [analysed],
  );

  /** Every distinct event name the file mentions, and what it matched. */
  const fileEvents = useMemo(() => {
    const map = new Map<string, { value: string; rows: number; matched: EventOption | null }>();
    analysed.forEach((a) => {
      const value = (a.values.event_name ?? "").trim();
      if (!value) return;
      const key = normalizeLabel(value);
      const entry = map.get(key) ?? { value, rows: 0, matched: matchEventByName(value, events ?? []) };
      entry.rows += 1;
      map.set(key, entry);
    });
    return [...map.entries()].map(([key, v]) => ({ key, ...v }));
  }, [analysed, events]);

  const unansweredEvents = fileEvents.filter(
    (e) => !e.matched && (eventDecisions[e.key]?.action ?? undefined) === undefined,
  );

  /** How each row will be linked, so the preview can be exact. */
  const eventLinkPlan = useMemo(() => {
    const bulkEvent = (events ?? []).find((e) => e.id === bulkTarget.eventId) ?? null;
    const perRow = analysed.map((a) => {
      const value = (a.values.event_name ?? "").trim();
      const key = normalizeLabel(value);
      const entry = fileEvents.find((f) => f.key === key);
      const decision = eventDecisions[key];
      let label: string | null = null;
      if (entry?.matched) label = entry.matched.name;
      else if (decision?.action === "create") label = entry?.value ?? null;
      else if (decision?.action === "existing")
        label = (events ?? []).find((e) => e.id === decision.eventId)?.name ?? null;
      if (!label && bulkEvent) label = bulkEvent.name;
      return label;
    });
    const totals = new Map<string, number>();
    perRow.forEach((label, i) => {
      if (!label) return;
      if (analysed[i]?.match.status === "ambiguous") return;
      totals.set(label, (totals.get(label) ?? 0) + 1);
    });
    return { perRow, totals: [...totals.entries()].map(([name, count]) => ({ name, count })) };
  }, [analysed, fileEvents, eventDecisions, events, bulkTarget.eventId]);

  /**
   * Gifts in this file whose date lands on an event (or a day either side).
   * One decision covers the whole batch, not row by row.
   */
  const giftEventGroups = useMemo(() => {
    const groups = new Map<string, { event: EventOption; rows: number; total: number }>();
    analysed.forEach((a) => {
      if (a.match.status === "ambiguous") return;
      const amount = Number(String(a.values.amount ?? "").replace(/[^0-9.-]/g, ""));
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
  }, [analysed, events]);

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
    const review = analysed.reduce(
      (n, a, i) => n + (a.match.status === "ambiguous" || addressReviewRows.has(i) ? 1 : 0),
      0,
    );
    return { review, importNow: Math.max(analysed.length - review, 0) };
  }, [analysed, addressReviewRows]);

  async function handleFile(file: File) {
    setError(null);
    try {
      const parsed = await readFile(file);
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
      setAdjusting(false);
      setEventDecisions({});
      setAddressDecisions({});
      setBulkTarget(EMPTY_BULK_TARGET);
    } catch (e) {
      setSheet(null);
      setError(e instanceof Error ? e.message : "We couldn't read that file.");
    }
  }

  function reset() {
    setSheet(null);
    setMapping([]);
    setError(null);
    setProgress(null);
    setEventDecisions({});
    setAddressDecisions({});
    setBulkTarget(EMPTY_BULK_TARGET);
    setGiftEventDecisions({});
    setReimportConfirmed(false);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  async function approve() {
    if (!sheet) return;
    if (runningRef.current || busy) return;
    if ((priorImports ?? []).length > 0 && !reimportConfirmed) {
      toast.error("This file was imported before. Tick the box to confirm you want to import it again.");
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setProgress({ done: 0, total: analysed.length });
    try {
      const importDate = new Date().toISOString().slice(0, 10);
      const source = `${sheet.name}, imported ${importDate}`;

      const { data: batch, error: batchError } = await supabase
        .from("import_batches")
        .insert({
          filename: sheet.name,
          import_date: importDate,
          total_rows: counts.total,
          matched_rows: counts.matched,
          new_rows: counts.new,
          ambiguous_rows: counts.ambiguous,
          status: "imported",
          mapping: mapping.reduce<Record<string, string>>((acc, m, i) => {
            acc[m.header || `Column ${i + 1}`] = m.field;
            return acc;
          }, {}),
        })
        .select("id")
        .single();
      if (batchError) throw batchError;
      const batchId = batch.id;

      const fieldSources: {
        person_id: string;
        field_name: string;
        source: string;
        recorded_date: string;
        import_batch_id: string;
      }[] = [];
      let failures = 0;
      let queued = 0;

      const existingGiftFingerprints = new Set(
        (await fetchAll<{ import_fingerprint: string | null }>((f, t) =>
          supabase
            .from("donations")
            .select("import_fingerprint")
            .not("import_fingerprint", "is", null)
            .is("deleted_at", null)
            .order("id")
            .range(f, t),
        ))
          .map((gift) => gift.import_fingerprint)
          .filter((value): value is string => Boolean(value)),
      );

      /** Park a row in the Data Inbox, with the address it shares so it can be grouped there. */
      async function queueForReview(
        values: RowValues,
        reason: string,
        candidateIds: string[],
        group: { key: string; address: string } | null,
      ) {
        queued += 1;
        await supabase.from("review_queue").insert({
          batch_id: batchId,
          filename: sheet!.name,
          reason,
          row_data: {
            ...(values as unknown as Record<string, unknown>),
            ...(group ? { [GROUP_KEY_FIELD]: group.key, [GROUP_ADDRESS_FIELD]: group.address } : {}),
          } as unknown as Record<string, string>,
          candidate_person_ids: candidateIds,
          status: "pending",
        });
      }

      // Existing households, so people at the same address join one household
      // instead of each row creating a fresh duplicate.
      const existingHouses = (await fetchAll<{ id: string; name: string; address: string | null }>((f, t) =>
        supabase.from("households").select("id, name, address").order("id").range(f, t),
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
        methods?: { kind: string; value: string }[];
      }) {
        const existing = livePeople.find((p) => p.id === entry.id);
        if (existing) {
          existing.email = existing.email ?? entry.email ?? null;
          existing.phone = existing.phone ?? entry.phone ?? null;
          existing.contact_methods = [...(existing.contact_methods ?? []), ...(entry.methods ?? [])];
          return;
        }
        livePeople.push({
          id: entry.id,
          first_name: entry.first,
          last_name: entry.last,
          email: entry.email ?? null,
          phone: entry.phone ?? null,
          household_id: entry.householdId ?? null,
          households: entry.address ? { name: "", address: entry.address } : null,
          contact_methods: entry.methods ?? [],
        });
      }

      // Which event each row links to. Names the reviewer asked us to create are
      // created once here, so 40 rows never make 40 copies of the same event.
      const eventIdByKey = new Map<string, string>();
      for (const fe of fileEvents) {
        if (fe.matched) {
          eventIdByKey.set(fe.key, fe.matched.id);
          continue;
        }
        const decision = eventDecisions[fe.key];
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
      const decisionByRow = new Map<number, { action: AddressDecision["action"]; relationship: string }>();
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
        address_line3: string | null;
        city: string | null;
        state: string | null;
        postal_code: string | null;
        county: string | null;
      };

      /** Find the household for this row, or create it once and remember it. */
      async function ensureHousehold(
        name: string,
        parts: HouseParts,
        billing: string | null,
        allowAddressLink = true,
      ): Promise<string | null> {
        const key = allowAddressLink ? addressKey(parts.address) : null;
        const nameKey = `name:${name.trim().toLowerCase()}`;
        const found = (key ? houseByKey.get(key) : undefined) ?? (name ? houseByKey.get(nameKey) : undefined);
        if (found) {
          // Fill in any address details the stored household is missing.
          const patch: Partial<HouseParts> & { billing_address?: string } = {};
          if (parts.address) patch.address = parts.address;
          if (parts.address_line2) patch.address_line2 = parts.address_line2;
          if (parts.address_line3) patch.address_line3 = parts.address_line3;
          if (parts.city) patch.city = parts.city;
          if (parts.state) patch.state = parts.state;
          if (parts.postal_code) patch.postal_code = parts.postal_code;
          if (parts.county) patch.county = parts.county;
          if (billing) patch.billing_address = billing;
          // People are joining this address, so an address-only record becomes a real household.
          await supabase
            .from("households")
            .update({ ...patch, status: "active" } as never)
            .eq("id", found);
          return found;
        }
        const { data: household } = await supabase
          .from("households")
          .insert({ name, ...parts, billing_address: billing, import_batch_id: batchId })
          .select("id")
          .single();
        if (household?.id) {
          if (key) houseByKey.set(key, household.id);
          if (name) houseByKey.set(nameKey, household.id);
          return household.id;
        }
        return null;
      }

      // The same in-file identity registry the preview used, applied again here
      // against the contacts this import has created as it goes.
      const loopSeen = newRowIdentityRegistry();

      for (let index = 0; index < analysed.length; index++) {
        const item = analysed[index]!;
        const v = item.values;

        try {
          // Exactly the same check the preview ran, now against the contacts this
          // import has already created.
          const live = matchRowOnce(v, livePeople, loopSeen, index);
          const flaggedByPreview = item.match.status === "ambiguous";
          const match = live;
          const shared = addressReviewRows.get(index);
          const rowAddress = composeAddress(v);
          const groupInfo = shared
            ? { key: shared.key, address: shared.address }
            : (() => {
                const k = addressKey(rowAddress);
                return k ? { key: k, address: rowAddress ?? "" } : null;
              })();

          const rowAmount = Number(String(v.amount ?? "").replace(/[^0-9.-]/g, ""));
          const rowGiftDate = isoDate(v.date) ?? importDate;
          const giftFingerprint = donationImportFingerprint(v, rowAmount, rowGiftDate);
          const giftAlreadyImported = Boolean(giftFingerprint && existingGiftFingerprints.has(giftFingerprint));

          // The gift itself, not the person: the same amount on the same day sitting
          // on a contact we did NOT match to usually means a second record for one donor.
          const giftsElsewhere =
            Number.isFinite(rowAmount) && rowAmount > 0
              ? await findGiftsOnOtherContacts(rowAmount, rowGiftDate, live.candidates.map((c) => c.id))
              : [];

          // A flagged row is never written. It waits in the Data Inbox for a person.
          if (
            flaggedByPreview ||
            live.status === "ambiguous" ||
            shared ||
            giftAlreadyImported ||
            giftsElsewhere.length > 0
          ) {
            const reason = live.status === "ambiguous" ? live.reason : item.match.reason;
            await queueForReview(
              v,
              giftAlreadyImported
                ? "This gift appears to have already been imported"
                : flaggedByPreview || live.status === "ambiguous"
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
                  ).concat(giftsElsewhere.map((g) => g.personId)),
                ),
              ],
              groupInfo,
            );
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
            address_line3: v.address_line3 ?? null,
            city: v.city ?? null,
            state: v.state ?? null,
            postal_code: v.postal_code ?? null,
            county: v.county ?? null,
          };
          const hasFamily = Boolean(
            v.children?.length || v.spouse_full_name || v.spouse_first_name || v.household_name || fullAddress,
          );
          const householdName = v.household_name ?? `${surname || first || "New"} household`;
          // Only group people by address when the reviewer confirmed they're family.
          const addressAnswer = decisionByRow.get(index);
          const allowAddressLink = !addressAnswer || addressAnswer.action === "household";
          const relationship = addressAnswer?.relationship || null;

          if (match.status === "new") {
            if (hasFamily || v.billing_address) {
              householdId = await ensureHousehold(
                householdName,
                addressParts,
                v.billing_address ?? null,
                allowAddressLink,
              );
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
            if (Object.keys(patch).length > 0) await supabase.from("people").update(patch).eq("id", personId);
            remember({
              id: personId,
              first,
              last,
              email: v.email ?? null,
              phone: v.phone ?? null,
              methods: [
                ...(v.phones ?? []).map((m) => ({ kind: "phone", value: m.value })),
                ...(v.emails ?? []).map((m) => ({ kind: "email", value: m.value })),
              ],
            });

            // Existing person, new family details on the row: attach a household if they don't have one.
            if (!householdId && (v.household_name || fullAddress || v.billing_address || v.children?.length)) {
              householdId = await ensureHousehold(
                householdName,
                addressParts,
                v.billing_address ?? null,
                allowAddressLink,
              );
              if (householdId) await supabase.from("people").update({ household_id: householdId }).eq("id", personId);
            } else if (householdId && (fullAddress || v.billing_address)) {
              const housePatch: {
                billing_address?: string;
                address?: string;
                address_line2?: string;
                address_line3?: string;
                city?: string;
                state?: string;
                postal_code?: string;
                county?: string;
              } = {};
              if (v.billing_address) housePatch["billing_address"] = v.billing_address;
              if (fullAddress) {
                housePatch["address"] = fullAddress;
                if (v.address_line2) housePatch["address_line2"] = v.address_line2;
                if (v.address_line3) housePatch["address_line3"] = v.address_line3;
                if (v.city) housePatch["city"] = v.city;
                if (v.state) housePatch["state"] = v.state;
                if (v.postal_code) housePatch["postal_code"] = v.postal_code;
                if (v.county) housePatch["county"] = v.county;
              }
              if (Object.keys(housePatch).length > 0)
                await supabase.from("households").update(housePatch).eq("id", householdId);
            }
          }

          if (!personId) continue;

          if (relationship) {
            await supabase.from("people").update({ household_relationship: relationship }).eq("id", personId);
          }

          // Link this contact to the event named on the row, or to the event the
          // reviewer chose for the whole file. Nothing is linked twice.
          const rowEventKey = normalizeLabel(v.event_name ?? "");
          const targetEventId = (rowEventKey ? eventIdByKey.get(rowEventKey) : undefined) ?? bulkTarget.eventId ?? "";
          if (targetEventId) {
            const { data: alreadyOn } = await supabase
              .from("registrations")
              .select("id")
              .eq("event_id", targetEventId)
              .eq("person_id", personId)
              .limit(1);
            if (!alreadyOn?.length) {
              await supabase
                .from("registrations")
                .insert({ event_id: targetEventId, person_id: personId, status: "Attended", import_batch_id: batchId });
              // The attendance timeline entry is written by the database from the
              // registration, so removing the registration removes the entry too.
            }
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
            if (Object.keys(patch).length > 0) await supabase.from("people").update(patch).eq("id", personId);
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
            ? ((await supabase.from("people").select("first_name, last_name").eq("household_id", householdId)).data ?? [])
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
              const { data: spouse } = await supabase
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
              if (spouse?.id) {
                const spouseMethods: MethodDraft[] = [];
                if (v.spouse_phone)
                  spouseMethods.push({ kind: "phone", value: v.spouse_phone, method_type: "Mobile", is_primary: true });
                if (v.spouse_email)
                  spouseMethods.push({ kind: "email", value: v.spouse_email, method_type: "Personal", is_primary: true });
                if (spouseMethods.length)
                  await addContactMethods(spouse.id, spouseMethods, { importBatchId: batchId, existing: [] });
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
            const { data: childRow } = await supabase.from("people").insert({
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
            }).select("id").single();
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
            "billing_address",
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
            const amount = Number(String(v.amount).replace(/[^0-9.-]/g, ""));
            if (Number.isFinite(amount) && amount > 0) {
              const giftDate = isoDate(v.date) ?? importDate;
              const fingerprint = donationImportFingerprint(v, amount, giftDate);
              // Re-importing the same file must not add the same gift twice, and a
              // gift only ever gets one timeline entry — the donation itself.
              const dupeCheck = supabase
                .from("donations")
                .select("id")
                .eq("person_id", personId)
                .eq("amount", amount)
                .eq("date", giftDate)
                .is("deleted_at", null);
              const { data: existingGift } = await (v.campaign
                ? dupeCheck.eq("campaign", v.campaign)
                : dupeCheck.is("campaign", null)
              ).limit(1);
              if (!existingGift?.length) {
                const { data: newGift } = await supabase
                  .from("donations")
                  .insert({
                  person_id: personId,
                  amount,
                  date: giftDate,
                  campaign: v.campaign ?? null,
                  source,
                  notes: v.notes ?? null,
                  import_batch_id: batch.id,
                  import_fingerprint: fingerprint,
                  })
                  .select("id")
                  .single();

                // Apply the reviewer's one decision about gifts made on an event date.
                const giftEvent = giftEventGroups.find(
                  (g) => g.event.date >= dayShift(giftDate, -1) && g.event.date <= dayShift(giftDate, 1),
                );
                const decision = giftEvent ? giftEventDecisions[giftEvent.event.id] : undefined;
                if (newGift?.id && giftEvent && (decision === "attended" || decision === "gift_only")) {
                  await attributeGiftToEvent({
                    donationId: newGift.id,
                    personId,
                    eventId: giftEvent.event.id,
                    attended: decision === "attended",
                    importBatchId: batchId,
                  });
                }
                if (fingerprint) existingGiftFingerprints.add(fingerprint);
              }
            }
          }

          const noteParts = [v.notes, v.person_notes ? `Note: ${v.person_notes}` : "", v.school ? `School: ${v.school}` : ""]
            .filter(Boolean)
            .join(" · ");
          if (noteParts && !v.amount) {
            await supabase.from("interactions").insert({
              person_id: personId,
              type: "form",
              date: importDate,
              text: noteParts,
              author: "Import",
              import_batch_id: batch.id,
            });
          }
        } catch (rowError) {
          failures += 1;
          console.error("Import row failed", rowError);
          const why = await friendlyDbError(rowError, "We couldn't save this row.");
          const k = addressKey(composeAddress(v));
          await queueForReview(v, why, [], k ? { key: k, address: composeAddress(v) ?? "" } : null);
        }

        // Let the browser breathe so a long import never freezes the page.
        if (index % 10 === 9 || index === analysed.length - 1) {
          setProgress({ done: index + 1, total: analysed.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (fieldSources.length > 0) {
        for (let i = 0; i < fieldSources.length; i += 500) {
          await supabase.from("field_sources").insert(fieldSources.slice(i, i + 500));
        }
      }

      const importedRows = Math.max(analysed.length - queued, 0);
      toast.success(
        `${importedRows} imported · ${queued} need review${
          counts.extraPeople ? ` · ${counts.extraPeople} family members added` : ""
        }`,
        {
          duration: 12000,
          ...(queued > 0
            ? { description: "The rows that need a person to look at them are waiting in the Data Inbox." }
            : {}),
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
      {!sheet && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center shadow-sm">
          <UploadCloud className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-heading font-semibold text-foreground">Upload a spreadsheet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            CSV or Excel exports from Donorbox, Constant Contact, Cognito Forms, QuickBooks, Salesforce or Google
            Sheets. Names can be split, combined, or last name only — you can set that in the mapping.
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

      {error && <p className="mt-4 rounded-2xl border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">{error}</p>}

      {sheet && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">{sheet.name}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Stat icon={Users} label="Rows found" value={counts.total} tone="text-foreground" />
              <Stat icon={CheckCircle2} label="Match existing people" value={counts.matched} tone="text-money" />
              <Stat icon={UserPlus} label="Look new" value={counts.new} tone="text-primary" />
              <Stat icon={AlertTriangle} label="Need review" value={plan.review} tone="text-suggestion" />
            </div>
            {counts.extraPeople > 0 && (
              <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
                {counts.extraPeople} family member{counts.extraPeople === 1 ? "" : "s"} on these rows (partners and
                children) will each get their own contact, linked to the same household.
              </p>
            )}
            <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">
              <strong>{plan.importNow}</strong> row{plan.importNow === 1 ? "" : "s"} will be imported straight away.
              {plan.review > 0 ? (
                <>
                  {" "}
                  <strong>{plan.review}</strong> row{plan.review === 1 ? "" : "s"} that need a person to look at them go
                  to the Data Inbox — you don't have to sort them out now, and they'll wait there until you do.
                </>
              ) : null}
            </p>
            {progress && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {busy ? "Importing" : "Finished"} {progress.done} of {progress.total} rows — keep this tab open.
                </p>
              </div>
            )}
          </section>

          {fileEvents.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">Events in this file</h2>
              <p className="text-sm text-muted-foreground">
                This file has an event column. Answering here is optional — anything you leave blank simply isn't linked
                to an event, and the import still runs.
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
                      </p>
                      {fe.matched ? (
                        <p className="mt-1 text-sm text-money">
                          Matches your event “{fe.matched.name}”. Those people will be added to it.
                        </p>
                      ) : (
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr]">
                          <select
                            className={selectClass}
                            value={
                              decision?.action === "existing"
                                ? decision.eventId
                                : (decision?.action ?? "")
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setEventDecisions((d) => ({
                                ...d,
                                [fe.key]:
                                  val === "create"
                                    ? { action: "create" }
                                    : val === "ignore"
                                      ? { action: "ignore" }
                                      : { action: "existing", eventId: val },
                              }));
                            }}
                          >
                            <option value="">What should we do?</option>
                            <option value="create">Create a new event called “{fe.value}”</option>
                            <option value="ignore">Skip this — don't link anyone</option>
                            {(events ?? []).map((ev) => (
                              <option key={ev.id} value={ev.id}>
                                Add them to “{ev.name}” ({ev.date})
                              </option>
                            ))}
                          </select>
                          <p className="self-center text-xs text-muted-foreground">
                            We didn't find an event with this name.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {giftEventGroups.length > 0 && (
            <section className="rounded-2xl border border-money/40 bg-money/5 p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">Gifts made on an event date</h2>
              <p className="text-sm text-muted-foreground">
                One answer covers the whole file — we won't ask row by row.
              </p>
              <div className="mt-3 space-y-3">
                {giftEventGroups.map((g) => {
                  const decision = giftEventDecisions[g.event.id];
                  return (
                    <div key={g.event.id} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-sm text-foreground">
                        These {g.rows} {g.rows === 1 ? "gift" : "gifts"} were made on the date of “{g.event.name}” (
                        {g.event.date}) — link them to that event?
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
            <h2 className="font-heading font-semibold text-foreground">Add everyone in this file to…</h2>
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
                    {t.count} {t.count === 1 ? "person" : "people"} will be marked as attending “{t.name}”.
                  </p>
                ))}
                {bulkTarget.program && (
                  <p>
                    {counts.matched + counts.new} {counts.matched + counts.new === 1 ? "person" : "people"} will be added
                    to the {bulkTarget.program} program.
                  </p>
                )}
                {bulkTarget.tag && (
                  <p>
                    {counts.matched + counts.new} {counts.matched + counts.new === 1 ? "person" : "people"} will get the
                    “{bulkTarget.tag}” tag.
                  </p>
                )}
              </div>
            )}
          </section>

          {addressGroups.length > 0 && (
            <section className="rounded-2xl border border-suggestion/40 bg-suggestion/5 p-5 shadow-sm">
              <h2 className="font-heading font-semibold text-foreground">Same address, different last names</h2>
              <p className="text-sm text-muted-foreground">
                We won't guess. Answer here if you know, or leave it — anyone you don't answer for goes to the Data
                Inbox as one card per address, so you can decide later without holding up the import.
              </p>
              <div className="mt-3 space-y-3">
                {addressGroups.map((group) => {
                  const decision = addressDecisions[group.key];
                  return (
                    <div key={group.key} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-sm font-medium text-foreground">{group.address}</p>
                      <p className="text-sm text-muted-foreground">{group.rows.map((r) => r.name).join(", ")}</p>
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
                                [group.key]: { action, relationships: d[group.key]?.relationships ?? {} },
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
                <h2 className="font-heading font-semibold text-foreground">Proposed column mapping</h2>
                <p className="text-sm text-muted-foreground">
                  Check anything marked medium or low. Child columns can be used more than once — map "Child 1", "Child
                  2" and so on all to the child fields.
                </p>
              </div>
              <Button variant="outline" className="rounded-xl" onClick={() => setAdjusting((a) => !a)}>
                {adjusting ? "Done adjusting" : "Adjust mapping"}
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {mapping.map((m, i) => (
                <div key={`${m.header}-${i}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                  <p className="truncate text-sm font-medium text-foreground">{m.header || `Column ${i + 1}`}</p>
                  {adjusting ? (
                    <select
                      className={selectClass}
                      value={m.field}
                      aria-label={`Map ${m.header}`}
                      onChange={(e) =>
                        setMapping((prev) =>
                          prev.map((row, ri) =>
                            ri === i ? { ...row, field: e.target.value as FieldKey, confidence: "high" } : row,
                          ),
                        )
                      }
                    >
                      {FIELD_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {FIELD_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {FIELD_LABELS[m.field]}
                    </p>
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
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-heading font-semibold text-foreground">First rows</h2>
            <div className="mt-3 -mx-5 overflow-x-auto px-5">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">Status</th>
                    <th className="border-b border-border pb-2 pr-5 text-xs text-muted-foreground">Will create</th>
                    {sheet.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap border-b border-border pb-2 pr-5 text-xs text-muted-foreground">
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysed.slice(0, 15).map((a, ri) => (
                    <tr key={ri}>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs">
                        <span
                          className={
                            a.match.status === "matched"
                              ? "text-money"
                              : a.match.status === "new"
                                ? "text-primary"
                                : "text-urgent"
                          }
                        >
                          {a.match.reason}
                        </span>
                      </td>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-5 text-xs text-muted-foreground">
                        {[
                          a.match.status === "new" ? "contact" : "update",
                          a.values.spouse_full_name || a.values.spouse_first_name ? "partner" : "",
                          a.values.children?.length ? `${a.values.children.length} child` : "",
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </td>
                      {sheet.headers.map((_, ci) => (
                        <td key={ci} className="whitespace-nowrap border-b border-border py-2 pr-5 text-foreground">
                          {a.row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysed.length > 15 && (
              <p className="mt-3 text-xs text-muted-foreground">Showing the first 15 of {analysed.length} rows.</p>
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
                  A file named <strong>{sheet.name}</strong> was already imported
                  {priorImports![0]?.import_date ? ` on ${priorImports![0]!.import_date}` : ""}
                  {(priorImports ?? []).length > 1 ? ` (${priorImports!.length} times)` : ""}. Tick this box if you
                  really want to import it again.
                </span>
              </label>
            )}
            <Button className="rounded-xl" disabled={busy} onClick={() => void approve()}>
              {busy ? `Importing… ${progress?.done ?? 0}/${progress?.total ?? 0}` : "Approve & import"}
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setAdjusting(true)} disabled={busy}>
              Adjust mapping
            </Button>
            <Button variant="ghost" className="rounded-xl text-urgent" onClick={reset} disabled={busy}>
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
        Undoing an import removes only the records that import created. Anything you added or edited by hand stays.
      </p>
      <div className="mt-3 space-y-2">
        {batches.map((b) => (
          <div key={b.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{b.filename}</p>
              <p className="text-xs text-muted-foreground">
                {b.import_date} · {b.total_rows} rows · {b.new_rows} new · {b.matched_rows} matched
                {b.status === "reverted" ? " · undone" : ""}
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
                {undoing === b.id ? "Undoing…" : isAdmin ? "Undo this import" : "Undo (admins only)"}
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