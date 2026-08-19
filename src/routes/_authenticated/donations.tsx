import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddDonationDialog } from "@/components/forms/AddDialogs";
import { useSelection, SelectBox, SelectAllToggle } from "@/components/BulkPeopleActions";
import { BulkRecordBar } from "@/components/BulkRecordActions";
import { EditRecordDialog } from "@/components/forms/EditRecordDialog";
import { AcknowledgmentButton } from "@/components/DonorDocumentActions";
import { Field } from "@/components/forms/fields";
import { downloadCsv, stamp } from "@/lib/csv";
import { personName } from "@/lib/names";
import { fuzzyScoreAny } from "@/lib/nl-search";
import { fetchAll } from "@/lib/fetch-all";
import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/donations")({
  head: () => ({
    meta: [
      { title: "Donations | Mitzvah House CRM" },
      {
        name: "description",
        content: "Every gift, always attached to the individual who gave it.",
      },
      { property: "og:title", content: "Donations | Mitzvah House CRM" },
      {
        property: "og:description",
        content: "Every gift, always attached to the individual who gave it.",
      },
    ],
  }),
  errorComponent: RouteError,
  component: DonationsPage,
});

function DonationsPage() {
  const queryClient = useQueryClient();
  const selection = useSelection();
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [followUp, setFollowUp] = useState<"all" | "needs_thanks" | "thanked" | "needs_receipt">(
    "all",
  );

  const { data, isLoading } = useQuery({
    queryKey: ["donations-list"],
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("donations")
          .select(
            "*, people(id, display_name, first_name, last_name), campaigns(id, name), grants(id, name), events(id, name, date)",
          )
          .is("deleted_at", null)
          .order("date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });

  const { data: eventOptions } = useQuery({
    queryKey: ["events-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .is("deleted_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  /** Same typo-tolerant matching as the main search: donor name, campaign or amount. */
  function searchScore(d: (typeof rows)[number]): number | null {
    if (terms.length === 0) return 0;
    const fields = [
      personName(d.people),
      d.campaigns?.name ?? "",
      d.grants?.name ?? "",
      d.events?.name ?? "",
      String(d.amount ?? ""),
      currency(d.amount).replace(/[^0-9.]/g, ""),
    ];
    let sum = 0;
    for (const term of terms) {
      const s = fuzzyScoreAny(term, fields);
      if (s === null) return null;
      sum += s;
    }
    return sum;
  }

  const rows = data ?? [];
  const gifts = rows
    .map((d) => ({ d, score: searchScore(d) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((r) => r.d)
    .filter((d) => {
    const date = (d.date ?? "").slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    const amount = Number(d.amount ?? 0);
    if (min && amount < Number(min)) return false;
    if (max && amount > Number(max)) return false;
    if (followUp === "needs_thanks" && d.thank_you_sent) return false;
    if (followUp === "thanked" && !d.thank_you_sent) return false;
    if (followUp === "needs_receipt" && d.receipt_sent) return false;
    return true;
    });
  const total = gifts.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const awaitingThanks = (data ?? []).filter((d) => !d.thank_you_sent).length;

  /** Tick or untick the thank-you box; the linked reminder task is kept in step. */
  async function toggleThankYou(id: string, sent: boolean) {
    const { error } = await supabase.rpc("mark_thank_you_sent", { _donation_id: id, _sent: sent });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(sent ? "Marked as thanked" : "Thank-you unmarked");
    await queryClient.invalidateQueries();
  }

  async function toggleReceipt(id: string, sent: boolean) {
    // Ticking adds the date and a timeline entry; unticking clears both.
    const { error } = await supabase.rpc("mark_receipt_sent", { _donation_id: id, _sent: sent });
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries();
  }

  return (
    <AppShell
      title="Donations"
      subtitle={`${gifts.length} gifts shown · ${currency(total)} total`}
      action={
        <>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() =>
              downloadCsv(
                `donations-${stamp()}`,
                gifts.map((d) => ({
                  donor: personName(d.people),
                  amount: d.amount,
                  date: d.date,
                  campaign: d.campaigns?.name ?? "",
                  grant: d.grants?.name ?? "",
                  method: d.method ?? "",
                  source: d.source ?? "",
                  notes: d.notes ?? "",
                  thank_you_sent: d.thank_you_sent ? "yes" : "no",
                  thank_you_sent_date: d.thank_you_sent_date ?? "",
                  receipt_sent: d.receipt_sent ? "yes" : "no",
                  receipt_sent_date: d.receipt_sent_date ?? "",
                })),
              )
            }
          >
            <Download className="size-4" /> Export to CSV
          </Button>
          <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Log donation
          </Button>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/statements">
              <FileText className="size-4" /> Year-end statements
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search by donor, campaign or amount" className="sm:col-span-2 lg:col-span-4">
          <Input
            className="text-base"
            type="search"
            placeholder="Try a name — spelling doesn't have to be perfect"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Field label="Start date">
          <Input
            className="text-base"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="End date">
          <Input
            className="text-base"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Min amount">
          <Input
            className="text-base"
            type="number"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </Field>
        <Field label="Max amount">
          <Input
            className="text-base"
            type="number"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </Field>
        <Field label="Follow-up" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All gifts"],
                [
                  "needs_thanks",
                  `Thank-you pending${awaitingThanks ? ` (${awaitingThanks})` : ""}`,
                ],
                ["thanked", "Thank-you sent"],
                ["needs_receipt", "Receipt pending"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm ${
                  followUp === key
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground"
                }`}
                onClick={() => setFollowUp(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        {(q || from || to || min || max) && (
          <button
            type="button"
            className="justify-self-start text-xs text-primary hover:underline sm:col-span-2 lg:col-span-4"
            onClick={() => {
              setQ("");
              setFrom("");
              setTo("");
              setMin("");
              setMax("");
              setFollowUp("all");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-money/30 bg-money/5 px-4 py-3 text-sm">
        Running total of what's shown:{" "}
        <span className="font-heading font-semibold text-money">{currency(total)}</span>
      </div>

      <SelectAllToggle
        visibleIds={gifts.map((d) => d.id)}
        selectedIds={selection.ids}
        onSelectAll={() => selection.selectAll(gifts.map((d) => d.id))}
        onClear={selection.clear}
        noun="gifts"
      />

      <div className="mt-4 space-y-3">
        {isLoading && <EmptyState label="Loading donations…" />}
        {!isLoading && gifts.length === 0 && <EmptyState label="No gifts match those filters." />}
        {gifts.map((d) => (
          <div
            key={d.id}
            className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 pt-0.5">
                <SelectBox
                  checked={selection.has(d.id)}
                  onChange={() => selection.toggle(d.id)}
                  label="this gift"
                />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  {d.people ? (
                    <Link
                      to="/people/$personId"
                      params={{ personId: d.people.id }}
                      className="min-w-0 break-words text-left font-heading font-semibold text-primary hover:underline"
                    >
                      {personName(d.people)}
                    </Link>
                  ) : (
                    <p className="font-heading font-semibold text-foreground">Unknown donor</p>
                  )}
                  <p className="shrink-0 font-heading text-lg font-semibold text-money">
                    {currency(d.amount)}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDate(d.date)} · {d.campaigns?.name ?? "General"} ·{" "}
                  {d.method ?? "—"}
                </p>
                {d.grants && (
                  <Link
                    to="/grants/$grantId"
                    params={{ grantId: d.grants.id }}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    Grant payment — {d.grants.name}
                  </Link>
                )}
                {d.events && (
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: d.events.id }}
                    className="mt-1 block text-xs text-primary hover:underline"
                  >
                    Given at {d.events.name}
                  </Link>
                )}
                {d.notes && <p className="mt-1 text-sm text-muted-foreground">{d.notes}</p>}
                {d.source && (
                  <p className="mt-1 text-xs text-muted-foreground">Source: {d.source}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(d.thank_you_sent)}
                  onChange={(e) => void toggleThankYou(d.id, e.target.checked)}
                />
                Thank-you letter
                {d.thank_you_sent_date ? (
                  <span className="text-xs text-muted-foreground">
                    sent {formatDate(d.thank_you_sent_date)}
                  </span>
                ) : (
                  <span className="text-xs text-urgent">not sent</span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(d.receipt_sent)}
                  onChange={(e) => void toggleReceipt(d.id, e.target.checked)}
                />
                Tax receipt
                {d.receipt_sent_date ? (
                  <span className="text-xs text-muted-foreground">
                    sent {formatDate(d.receipt_sent_date)}
                  </span>
                ) : null}
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <AcknowledgmentButton
                donationId={d.id}
                label={d.thank_you_sent ? "Print letter again" : "Print thank-you letter"}
                onDone={async () => {
                  await queryClient.invalidateQueries({ queryKey: ["donations"] });
                }}
              />
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => setEditing(d as unknown as Record<string, unknown>)}
            >
              Edit or remove this gift
            </button>
          </div>
        ))}
      </div>
      <AddDonationDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkRecordBar
        table="donations"
        noun="gift"
        nounPlural="gifts"
        selectedIds={selection.ids}
        onClear={selection.clear}
        visibleIds={gifts.map((d) => d.id)}
        onSelectAll={() => selection.selectAll(gifts.map((d) => d.id))}
      />
      {editing && (
        <EditRecordDialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          table="donations"
          id={String(editing["id"])}
          record={editing}
          title="Edit gift"
          deleteLabel="Remove this gift"
          onDeleted={() => setEditing(null)}
          fields={[
            { key: "amount", label: "Amount", type: "number" },
            { key: "date", label: "Date", type: "date" },
            { key: "method", label: "Method" },
            { key: "source", label: "Source" },
            {
              key: "event_id",
              label: "Given at this event",
              type: "select",
              options: (eventOptions ?? []).map((ev) => ({
                value: ev.id,
                label: `${ev.name} (${ev.date})`,
              })),
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
        />
      )}
    </AppShell>
  );
}
