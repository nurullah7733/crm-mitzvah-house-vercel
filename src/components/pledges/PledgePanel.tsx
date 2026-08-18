import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currency, formatDate } from "@/components/AppShell";
import { PledgeDialog } from "@/components/pledges/PledgeDialog";
import {
  FREQUENCY_LABELS,
  STATUS_LABELS,
  fetchPledgesForPerson,
  nextExpectedDate,
  type Pledge,
} from "@/lib/pledges";

/**
 * What this donor has promised, and how much of it has arrived. Promises and
 * payments are shown side by side so nobody has to guess whether a recurring
 * gift is still coming in.
 */
export function PledgePanel({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pledge | null>(null);

  const { data: pledges } = useQuery({
    queryKey: ["pledges", personId],
    queryFn: () => fetchPledgesForPerson(personId),
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 className="truncate font-heading font-semibold text-foreground">
          Pledges & recurring gifts
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1 size-4" /> Add
        </Button>
      </div>
      <div className="mt-3">
        {(pledges ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No pledge on file. Add one when someone commits to give — monthly, quarterly or once a
            year.
          </p>
        )}
        {(pledges ?? []).map((p) => {
          const expected = p.status === "active" ? nextExpectedDate(p, p.lastGiftDate) : null;
          const late = expected !== null && expected < today;
          return (
            <div key={p.id} className="border-b border-border py-3 last:border-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-heading text-sm font-semibold text-foreground">
                  {currency(p.amount)}{" "}
                  <span className="font-body text-sm font-normal text-muted-foreground">
                    · {FREQUENCY_LABELS[p.frequency].toLowerCase()}
                  </span>
                </p>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    p.status === "active"
                      ? "bg-money/15 text-money"
                      : p.status === "lapsed"
                        ? "bg-urgent/15 text-urgent"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABELS[p.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {currency(p.received)} received so far
                {p.lastGiftDate
                  ? ` · last payment ${formatDate(p.lastGiftDate)}`
                  : " · no payments yet"}
              </p>
              {expected && (
                <p className={`mt-1 text-sm ${late ? "text-urgent" : "text-muted-foreground"}`}>
                  {late ? "Payment overdue since " : "Next payment due "}
                  {formatDate(expected)}
                </p>
              )}
              {p.notes && <p className="mt-1 text-sm text-muted-foreground">{p.notes}</p>}
              <button
                type="button"
                className="mt-1 text-xs text-primary hover:underline"
                onClick={() => {
                  setEditing(p);
                  setOpen(true);
                }}
              >
                Edit pledge
              </button>
            </div>
          );
        })}
      </div>
      <PledgeDialog open={open} onOpenChange={setOpen} personId={personId} pledge={editing} />
    </section>
  );
}
