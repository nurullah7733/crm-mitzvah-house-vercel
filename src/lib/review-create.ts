import { composeAddress, splitName, type RowValues } from "@/lib/import-mapping";

/** The person's name as it reads on an imported row. */
export function rowDisplayName(row: RowValues) {
  const n = splitName(row);
  const first = [n.first, n.middle].filter(Boolean).join(" ").trim();
  const last = [n.last, n.suffix].filter(Boolean).join(" ").trim();
  return {
    first,
    last,
    surname: n.last.trim(),
    display: [first, last].filter(Boolean).join(" ").trim(),
  };
}

/** The address written on an imported row, as one readable block. */
export function rowAddress(row: RowValues) {
  return composeAddress(row);
}

export type ReviewQueueItem = {
  id: string;
  filename: string | null;
  batch_id: string | null;
  row_data: RowValues;
};

/** @deprecated Nontransactional legacy helper. Use resolve_household_at_address. */
export async function ensureHouseholdAtAddress(
  _address: string | null,
  _name: string,
  _batchId: string | null,
): Promise<string | null> {
  throw new Error(
    "LEGACY_UNSAFE_HELPER_DISABLED: use resolve_household_at_address or resolve_review_household_card.",
  );
}

/** @deprecated Nontransactional legacy helper. Use resolve_review_create. */
export async function createPersonFromRow(
  _item: ReviewQueueItem,
  _opts: { householdId?: string | null; relationship?: string | null; note: string },
): Promise<{ personId: string; name: string }> {
  throw new Error(
    "LEGACY_UNSAFE_HELPER_DISABLED: use resolve_review_create for transactional review creation.",
  );
}
