import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, LoadingState, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass } from "@/components/forms/fields";
import { RouteError } from "@/components/RouteError";
import { showError } from "@/lib/app-errors";
import { logChange } from "@/lib/session-log";
import { useOrgSettings } from "@/lib/org-settings";
import {
  DELIVERY_CHANNELS,
  DELIVERY_METHODS,
  deliverDocuments,
  deliveryLabel,
  printDocuments,
  type DeliveryMethod,
} from "@/lib/document-delivery";
import {
  fetchIssuedDocuments,
  fetchYearGifts,
  groupByDonor,
  issueStatement,
  statementFor,
  voidStatement,
  type DonorYearGroup,
  type IssuedDocumentRow,
} from "@/lib/statements";
import type { GeneratedDocument } from "@/lib/documents";

export const Route = createFileRoute("/_authenticated/statements")({
  head: () => ({
    meta: [
      { title: "Tax statements | Mitzvah House CRM" },
      {
        name: "description",
        content:
          "Generate year-end giving statements for every donor, with IRS substantiation wording, and mark them issued.",
      },
      { property: "og:title", content: "Tax statements | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Year-end giving statements, print-ready, with delivery tracked per donor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: RouteError,
  component: StatementsPage,
});

function StatementsPage() {
  const thisYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(thisYear - 1);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<DeliveryMethod>("printed");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { data: org } = useOrgSettings();

  const gifts = useQuery({
    queryKey: ["statement-gifts", taxYear],
    queryFn: () => fetchYearGifts(taxYear),
  });
  const issued = useQuery({
    queryKey: ["issued-documents", taxYear],
    queryFn: () => fetchIssuedDocuments({ taxYear }),
  });

  const groups = useMemo(() => groupByDonor(gifts.data ?? []), [gifts.data]);
  const issuedByPerson = useMemo(() => {
    const map = new Map<string, IssuedDocumentRow>();
    for (const doc of issued.data ?? []) {
      if (doc.kind === "tax_statement" && doc.status === "issued") map.set(doc.person_id, doc);
    }
    return map;
  }, [issued.data]);

  const visible = groups.filter((g) =>
    search.trim() ? g.donor.name.toLowerCase().includes(search.trim().toLowerCase()) : true,
  );
  const yearTotal = groups.reduce((sum, g) => sum + g.total, 0);
  const notYetIssued = visible.filter((g) => !issuedByPerson.has(g.personId));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["issued-documents"] });
    await queryClient.invalidateQueries({ queryKey: ["statement-gifts"] });
  }

  /** Generate the document, record it as issued, then hand it to a delivery channel. */
  async function generate(list: DonorYearGroup[]) {
    if (!org || list.length === 0) return;
    setBusy(true);
    try {
      const docs: GeneratedDocument[] = [];
      const ids: string[] = [];
      for (const group of list) {
        const id = await issueStatement(group.personId, taxYear);
        ids.push(id);
        docs.push(statementFor(group, taxYear, org));
      }
      const result = await deliverDocuments({
        documentIds: ids,
        docs,
        heading: `${taxYear} giving statements`,
        method,
      });
      logChange(`Issued ${ids.length} ${taxYear} tax statement(s)`);
      await refresh();
      if (result.status === "delivered") {
        toast.success(`${ids.length} statement(s) issued and sent to ${deliveryLabel(method)}`);
      } else if (result.status === "failed") {
        toast.error(result.note ?? "The statements were issued but could not be printed.");
      } else {
        toast.success(`${ids.length} statement(s) issued — delivery is still pending`);
      }
    } catch (e) {
      await showError(e, {
        area: "Tax statements",
        action: "Issue year-end statements",
        fallback: "Could not issue those statements",
      });
    } finally {
      setBusy(false);
    }
  }

  /** Preview without recording anything as issued. */
  function preview(group: DonorYearGroup) {
    if (!org) return;
    // Preview never records anything: no statement row, no receipt flags.
    printDocuments([statementFor(group, taxYear, org)], `${taxYear} statement preview`);
  }

  async function undo(documentId: string) {
    setBusy(true);
    try {
      await voidStatement(documentId);
      await refresh();
      toast.success("Statement voided — the gifts are no longer marked as receipted");
    } catch (e) {
      await showError(e, {
        area: "Tax statements",
        action: "Void a statement",
        fallback: "Could not void that statement",
      });
    } finally {
      setBusy(false);
    }
  }

  const years = Array.from({ length: 8 }, (_, i) => thisYear - i);

  return (
    <AppShell
      title="Tax statements"
      subtitle={`${groups.length} donors gave in ${taxYear} · ${currency(yearTotal)} total`}
      action={
        <Button
          className="min-h-11 rounded-xl"
          disabled={busy || notYetIssued.length === 0 || !org}
          onClick={() => generate(notYetIssued)}
        >
          <Printer className="size-4" /> Generate {notYetIssued.length || ""} statement
          {notYetIssued.length === 1 ? "" : "s"}
        </Button>
      }
    >
      <div className="grid gap-5">
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:grid-cols-3">
          <Field label="Tax year">
            <select
              className={selectClass}
              value={String(taxYear)}
              onChange={(e) => setTaxYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Find a donor">
            <Input
              className="text-base"
              placeholder="Start typing a name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field
            label="How it goes out"
            hint="Only printing is connected today. Other channels are recorded as pending."
          >
            <select
              className={selectClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as DeliveryMethod)}
            >
              {DELIVERY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {DELIVERY_CHANNELS[m].label}
                  {DELIVERY_CHANNELS[m].available ? "" : " (not connected yet)"}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {!org?.ein && (
          <p className="rounded-2xl border border-[#F9C348] bg-[#F9C348]/10 p-4 text-sm">
            Add your organisation's address and EIN in{" "}
            <Link to="/settings" className="font-medium text-primary underline">
              Settings
            </Link>{" "}
            before sending statements to donors — an accountant will look for the EIN.
          </p>
        )}

        {gifts.isLoading ? (
          <LoadingState what="gifts" />
        ) : visible.length === 0 ? (
          <EmptyState
            label={`No gifts recorded in ${taxYear}. Pick another tax year, or record gifts on the Donations screen first.`}
          />
        ) : (
          <section className="grid gap-3">
            {visible.map((group) => {
              const doc = issuedByPerson.get(group.personId);
              return (
                <article
                  key={group.personId}
                  className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        to="/people/$personId"
                        params={{ personId: group.personId }}
                        className="font-heading font-semibold text-primary hover:underline"
                      >
                        {group.donor.name}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {group.gifts.length} gift{group.gifts.length === 1 ? "" : "s"} ·{" "}
                        <span className="font-medium text-[#1FAB6D]">{currency(group.total)}</span> ·{" "}
                        {group.receiptedCount}/{group.gifts.length} already receipted
                      </p>
                      {doc ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Issued {formatDate(doc.issued_at)} · {deliveryLabel(doc.delivery_method)} ·{" "}
                          {doc.delivery_status}
                          {doc.issued_by_email ? ` · by ${doc.issued_by_email}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 rounded-xl"
                        onClick={() => preview(group)}
                      >
                        Preview
                      </Button>
                      {doc ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-11 rounded-xl text-destructive"
                          disabled={busy}
                          onClick={() => undo(doc.id)}
                        >
                          <RotateCcw className="size-3.5" /> Void
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="min-h-11 rounded-xl"
                          disabled={busy || !org}
                          onClick={() => generate([group])}
                        >
                          <Printer className="size-3.5" /> Generate
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </AppShell>
  );
}