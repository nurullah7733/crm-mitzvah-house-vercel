import { mergeTemplate, orgAddressLines, type OrgSettings } from "@/lib/org-settings";

/**
 * Document GENERATION only. Nothing here sends anything — turning a document
 * into something a donor receives is the delivery layer's job
 * (src/lib/document-delivery.ts), so a new channel (email, text, Constant
 * Contact) can be added without touching this file.
 */

export type GiftLine = {
  id: string;
  date: string;
  amount: number;
  designation: string;
  method: string | null;
  goods_or_services_provided: boolean;
  goods_or_services_description: string | null;
};

export type DonorDetails = {
  id: string;
  name: string;
  addressLines: string[];
};

export type StatementDocument = {
  kind: "tax_statement";
  title: string;
  donor: DonorDetails;
  taxYear: number;
  gifts: GiftLine[];
  total: number;
  intro: string;
  substantiation: string;
  quidProQuoNotes: string[];
  org: OrgSettings;
  orgAddress: string[];
};

export type AcknowledgmentDocument = {
  kind: "acknowledgment";
  title: string;
  donor: DonorDetails;
  gift: GiftLine;
  body: string;
  org: OrgSettings;
  orgAddress: string[];
};

export type GeneratedDocument = StatementDocument | AcknowledgmentDocument;

export function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function longDate(value: string): string {
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 1, parts[2] ?? 1];
  if (!y) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function mergeValues(org: OrgSettings, extra: Record<string, string>) {
  return {
    org_name: org.name,
    ein: org.ein || "—",
    signer_name: org.signer_name,
    signer_title: org.signer_title,
    ...extra,
  };
}

/** Consolidated year-end statement for one donor. */
export function buildStatement(args: {
  donor: DonorDetails;
  taxYear: number;
  gifts: GiftLine[];
  org: OrgSettings;
}): StatementDocument {
  const { donor, taxYear, gifts, org } = args;
  const sorted = [...gifts].sort((a, b) => a.date.localeCompare(b.date));
  const total = sorted.reduce((sum, g) => sum + Number(g.amount ?? 0), 0);
  const values = mergeValues(org, {
    donor_name: donor.name,
    tax_year: String(taxYear),
    gift_amount: money(total),
    gift_date: "",
    designation: "",
  });
  const quidProQuo = sorted.filter((g) => g.goods_or_services_provided);
  return {
    kind: "tax_statement",
    title: `${taxYear} Annual Giving Statement`,
    donor,
    taxYear,
    gifts: sorted,
    total,
    intro: mergeTemplate(org.statement_intro, values),
    // The blanket "nothing was given in return" sentence only applies when no
    // gift on the statement is flagged as a quid pro quo gift.
    substantiation:
      quidProQuo.length === 0
        ? mergeTemplate(org.substantiation_text, values)
        : mergeTemplate(
            `${org.name} is a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code. Except where noted below, no goods or services were provided in exchange for these contributions. Contributions are deductible only to the extent they exceed the value of any goods or services received.`,
            values,
          ),
    quidProQuoNotes: quidProQuo.map(
      (g) =>
        `${longDate(g.date)} — ${money(Number(g.amount))}: goods or services provided${
          g.goods_or_services_description ? ` (${g.goods_or_services_description})` : ""
        }.`,
    ),
    org,
    orgAddress: orgAddressLines(org),
  };
}

/** Single-gift acknowledgment letter, merged from the Settings template. */
export function buildAcknowledgment(args: {
  donor: DonorDetails;
  gift: GiftLine;
  org: OrgSettings;
}): AcknowledgmentDocument {
  const { donor, gift, org } = args;
  const values = mergeValues(org, {
    donor_name: donor.name,
    gift_amount: money(Number(gift.amount ?? 0)),
    gift_date: longDate(gift.date),
    designation: gift.designation || "our general fund",
    tax_year: gift.date.slice(0, 4),
  });
  return {
    kind: "acknowledgment",
    title: "Acknowledgment letter",
    donor,
    gift,
    body: mergeTemplate(org.acknowledgment_template, values),
    org,
    orgAddress: orgAddressLines(org),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function letterhead(doc: GeneratedDocument): string {
  return `
    <header class="head">
      <div>
        <h1>${escapeHtml(doc.org.name)}</h1>
        ${doc.orgAddress.map((l) => `<p class="muted">${escapeHtml(l)}</p>`).join("")}
        ${doc.org.ein ? `<p class="muted">EIN ${escapeHtml(doc.org.ein)}</p>` : `<p class="warn">EIN not set in Settings</p>`}
      </div>
      <div class="right"><p class="doc-title">${escapeHtml(doc.title)}</p></div>
    </header>
    <section class="donor">
      <p class="strong">${escapeHtml(doc.donor.name)}</p>
      ${doc.donor.addressLines.map((l) => `<p class="muted">${escapeHtml(l)}</p>`).join("")}
    </section>`;
}

function statementBody(doc: StatementDocument): string {
  const rows = doc.gifts
    .map(
      (g) => `<tr>
        <td>${escapeHtml(longDate(g.date))}</td>
        <td>${escapeHtml(g.designation || "General")}</td>
        <td>${escapeHtml(g.method ?? "—")}</td>
        <td class="right">${escapeHtml(money(Number(g.amount ?? 0)))}</td>
      </tr>`,
    )
    .join("");
  return `
    <p>${escapeHtml(doc.intro)}</p>
    <table>
      <thead><tr><th>Date</th><th>Designation</th><th>Method</th><th class="right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="3">Total for ${doc.taxYear}</th><th class="right">${escapeHtml(money(doc.total))}</th></tr></tfoot>
    </table>
    <p class="legal">${escapeHtml(doc.substantiation)}</p>
    ${
      doc.quidProQuoNotes.length
        ? `<ul class="legal">${doc.quidProQuoNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
        : ""
    }
    <p class="sign">${escapeHtml(doc.org.signer_name)}${
      doc.org.signer_title ? `<br/>${escapeHtml(doc.org.signer_title)}` : ""
    }</p>`;
}

function acknowledgmentBody(doc: AcknowledgmentDocument): string {
  return doc.body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #22262E; margin: 0; }
  .page { padding: 48px 56px; max-width: 8.5in; margin: 0 auto; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-family: Poppins, Inter, sans-serif; font-size: 20px; margin: 0 0 6px; color: #335AA4; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #335AA4; padding-bottom: 12px; }
  .doc-title { font-family: Poppins, Inter, sans-serif; font-weight: 600; font-size: 14px; margin: 0; }
  .right { text-align: right; }
  .muted { color: #78808F; font-size: 12px; margin: 2px 0; }
  .warn { color: #EC6951; font-size: 12px; margin: 2px 0; }
  .strong { font-weight: 600; margin: 0 0 2px; }
  .donor { margin: 28px 0 20px; }
  p { font-size: 13px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #E4E8EF; }
  tfoot th { border-top: 2px solid #22262E; border-bottom: none; }
  .legal { font-size: 11px; color: #4a5160; background: #F7F8FA; padding: 10px 12px; border-radius: 8px; }
  .sign { margin-top: 36px; white-space: pre-line; }
  @media print { .page { padding: 0.6in; } }
`;

/** Print/PDF-ready HTML for one or many documents (one page each). */
export function renderDocumentsHtml(docs: GeneratedDocument[], heading: string): string {
  const pages = docs
    .map(
      (doc) =>
        `<div class="page">${letterhead(doc)}${
          doc.kind === "tax_statement" ? statementBody(doc) : acknowledgmentBody(doc)
        }</div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(heading)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>${PRINT_CSS}</style></head><body>${pages}</body></html>`;
}

/** Designation shown on a statement line: campaign, then grant, then general. */
export function giftDesignation(gift: {
  campaigns?: { name: string | null } | null;
  grants?: { name: string | null } | null;
  events?: { name: string | null } | null;
}): string {
  return (
    gift.campaigns?.name?.trim() ||
    gift.grants?.name?.trim() ||
    gift.events?.name?.trim() ||
    "General"
  );
}