import { supabase } from "@/integrations/supabase/client";
import { personName } from "@/lib/names";
import {
  buildAcknowledgment,
  buildStatement,
  giftDesignation,
  type AcknowledgmentDocument,
  type DonorDetails,
  type GiftLine,
  type StatementDocument,
} from "@/lib/documents";
import type { OrgSettings } from "@/lib/org-settings";

/** Gift columns every document needs, including the substantiation flags. */
const GIFT_COLUMNS = `
  id, person_id, amount, date, method, notes,
  goods_or_services_provided, goods_or_services_description,
  thank_you_sent, thank_you_sent_date, receipt_sent, receipt_sent_date,
  campaigns:campaign_id ( name ), grants:grant_id ( name ), events:event_id ( name ),
  people:person_id (
    id, display_name, first_name, last_name, mailing_preference,
    households:household_id ( address, address_line2, city, state, postal_code )
  )
`;

export type StatementGiftRow = {
  id: string;
  person_id: string | null;
  amount: number | null;
  date: string;
  method: string | null;
  thank_you_sent: boolean | null;
  receipt_sent: boolean | null;
  goods_or_services_provided: boolean | null;
  goods_or_services_description: string | null;
  campaigns?: { name: string | null } | null;
  grants?: { name: string | null } | null;
  events?: { name: string | null } | null;
  people?: {
    id: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    households?: {
      address: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
    } | null;
  } | null;
};

export type IssuedDocumentRow = {
  id: string;
  kind: string;
  person_id: string;
  tax_year: number | null;
  donation_id: string | null;
  gift_count: number;
  total_amount: number;
  status: string;
  delivery_method: string;
  delivery_status: string;
  delivered_at: string | null;
  issued_at: string;
  issued_by_email: string | null;
};

export type DonorYearGroup = {
  personId: string;
  donor: DonorDetails;
  gifts: GiftLine[];
  total: number;
  receiptedCount: number;
  thankedCount: number;
};

function donorFrom(row: StatementGiftRow): DonorDetails {
  const p = row.people;
  const h = p?.households ?? null;
  const lines: string[] = [];
  if (h?.address?.trim()) lines.push(h.address.trim());
  if (h?.address_line2?.trim()) lines.push(h.address_line2.trim());
  const cityLine = [h?.city ?? "", h?.state ?? ""].filter((v) => v.trim()).join(", ");
  const withZip = [cityLine, (h?.postal_code ?? "").trim()].filter(Boolean).join(" ").trim();
  if (withZip) lines.push(withZip);
  return { id: row.person_id ?? "", name: personName(p), addressLines: lines };
}

export function giftLine(row: StatementGiftRow): GiftLine {
  return {
    id: row.id,
    date: (row.date ?? "").slice(0, 10),
    amount: Number(row.amount ?? 0),
    designation: giftDesignation(row),
    method: row.method ?? null,
    goods_or_services_provided: Boolean(row.goods_or_services_provided),
    goods_or_services_description: row.goods_or_services_description ?? null,
  };
}

/** Every gift in a tax year, grouped by donor. Archived gifts are excluded by RLS. */
export async function fetchYearGifts(taxYear: number, personId?: string) {
  let query = supabase
    .from("donations")
    .select(GIFT_COLUMNS)
    .gte("date", `${taxYear}-01-01`)
    .lte("date", `${taxYear}-12-31`)
    .not("person_id", "is", null)
    .order("date", { ascending: true });
  if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as StatementGiftRow[];
}

export function groupByDonor(rows: StatementGiftRow[]): DonorYearGroup[] {
  const map = new Map<string, DonorYearGroup>();
  for (const row of rows) {
    const id = row.person_id;
    if (!id) continue;
    let group = map.get(id);
    if (!group) {
      group = {
        personId: id,
        donor: donorFrom(row),
        gifts: [],
        total: 0,
        receiptedCount: 0,
        thankedCount: 0,
      };
      map.set(id, group);
    }
    group.gifts.push(giftLine(row));
    group.total += Number(row.amount ?? 0);
    // These read the live flags on the gift ledger, not a cached copy.
    if (row.receipt_sent) group.receiptedCount += 1;
    if (row.thank_you_sent) group.thankedCount += 1;
  }
  return [...map.values()].sort((a, b) => a.donor.name.localeCompare(b.donor.name));
}

export async function fetchIssuedDocuments(args: { taxYear?: number; personId?: string }) {
  let query = supabase
    .from("issued_documents")
    .select(
      "id, kind, person_id, tax_year, donation_id, gift_count, total_amount, status, delivery_method, delivery_status, delivered_at, issued_at, issued_by_email",
    )
    .order("issued_at", { ascending: false });
  if (args.taxYear) query = query.eq("tax_year", args.taxYear);
  if (args.personId) query = query.eq("person_id", args.personId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as IssuedDocumentRow[];
}

export function statementFor(group: DonorYearGroup, taxYear: number, org: OrgSettings): StatementDocument {
  return buildStatement({ donor: group.donor, taxYear, gifts: group.gifts, org });
}

export function acknowledgmentFor(row: StatementGiftRow, org: OrgSettings): AcknowledgmentDocument {
  return buildAcknowledgment({ donor: donorFrom(row), gift: giftLine(row), org });
}

/** Record a statement as issued. Returns the new document id. */
export async function issueStatement(personId: string, taxYear: number) {
  const { data, error } = await supabase.rpc("issue_tax_statement", {
    _person_id: personId,
    _tax_year: taxYear,
    _delivery_method: "printed",
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function issueAcknowledgment(donationId: string) {
  const { data, error } = await supabase.rpc("issue_acknowledgment", {
    _donation_id: donationId,
    _delivery_method: "printed",
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function voidStatement(documentId: string) {
  const { error } = await supabase.rpc("void_tax_statement", { _document_id: documentId });
  if (error) throw error;
}

/** One gift with everything a letter needs. */
export async function fetchGift(donationId: string) {
  const { data, error } = await supabase
    .from("donations")
    .select(GIFT_COLUMNS)
    .eq("id", donationId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as StatementGiftRow | null;
}