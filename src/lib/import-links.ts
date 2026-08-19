import { addressKey } from "@/lib/import-mapping";

/** An event as the import screen needs it. */
export type EventOption = { id: string; name: string; date: string };

export function normalizeLabel(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find the event a spreadsheet value refers to. Exact name first, then a
 * contained-name match ("Shabbat 100 Dinner" -> "Shabbat 100"), so ordinary
 * wording differences still match instead of creating a second event.
 */
export function matchEventByName(value: string, events: EventOption[]): EventOption | null {
  const want = normalizeLabel(value);
  if (!want) return null;
  const exact = events.find((e) => normalizeLabel(e.name) === want);
  if (exact) return exact;
  const contained = events.filter((e) => {
    const n = normalizeLabel(e.name);
    return n.length > 3 && (n.includes(want) || want.includes(n));
  });
  return contained.length === 1 ? contained[0]! : null;
}

/** What to do with an event name in the file that matched nothing. */
export type EventDecision =
  { action: "ignore" } | { action: "create" } | { action: "existing"; eventId: string };

/** Everything the reviewer chose to apply to the whole file. */
export type BulkTarget = {
  eventId: string;
  program: string;
  tag: string;
};

export const EMPTY_BULK_TARGET: BulkTarget = { eventId: "", program: "", tag: "" };

/** People who share an address, so the reviewer can be asked if they're family. */
export type AddressGroup = {
  key: string;
  address: string;
  rows: { index: number; name: string }[];
};

export const RELATIONSHIP_OPTIONS = ["Spouse", "Child", "Parent", "Sibling", "Other"] as const;

/**
 * Rows parked for review carry the address they share, so the Data Inbox can put
 * everyone at one address on a single card instead of asking the same question
 * over and over.
 */
export const GROUP_KEY_FIELD = "_group_key";
export const GROUP_ADDRESS_FIELD = "_group_address";

export function rowGroup(
  row: Record<string, unknown> | null | undefined,
): { key: string; address: string } | null {
  const key = row?.[GROUP_KEY_FIELD];
  if (typeof key !== "string" || !key) return null;
  const address = row?.[GROUP_ADDRESS_FIELD];
  return { key, address: typeof address === "string" ? address : "" };
}

/** A choice about one group of people sharing an address. */
export type AddressDecision = {
  action: "household" | "unrelated" | "later";
  /** Row index -> relationship inside the household. */
  relationships: Record<number, string>;
};

/**
 * Group rows that sit at the same address. Matching is forgiving about
 * formatting, so "412 Ashford Dunwoody Rd" and "412 Ashford Dunwoody Road"
 * count as one place. Every shared address is returned as one confirmation card.
 * A shared surname is a strong family signal, but staff still confirm it rather
 * than the importer silently assigning a relationship.
 */
export function groupSharedAddresses(
  rows: { index: number; name: string; surname: string; address: string | null }[],
): AddressGroup[] {
  const byKey = new Map<
    string,
    { address: string; rows: { index: number; name: string }[]; surnames: Set<string> }
  >();
  for (const r of rows) {
    const key = addressKey(r.address);
    if (!key || !r.address) continue;
    const bucket = byKey.get(key) ?? { address: r.address, rows: [], surnames: new Set<string>() };
    bucket.rows.push({ index: r.index, name: r.name || "(no name)" });
    bucket.surnames.add(normalizeLabel(r.surname));
    byKey.set(key, bucket);
  }
  return [...byKey.entries()]
    .filter(([, b]) => b.rows.length > 1)
    .map(([key, b]) => ({ key, address: b.address, rows: b.rows }));
}
