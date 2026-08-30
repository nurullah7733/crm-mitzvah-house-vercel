import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import type { RowValues } from "@/lib/import-mapping";
import type { ReviewPerson } from "@/lib/review-merge";
import { keepExistingRegistrationPayment } from "@/lib/review-quick";
import type { RegistrationPaymentConflictContext } from "@/lib/registration-payment-conflict";
import { showError } from "@/lib/app-errors";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function RegistrationPaymentConflictDialog({
  open,
  onOpenChange,
  item,
  existing,
  context,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; filename: string | null; row_data: RowValues; batch_id?: string | null };
  existing: ReviewPerson;
  context: RegistrationPaymentConflictContext;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const keepExisting = useMutation({
    mutationFn: () => keepExistingRegistrationPayment(item, existing, context),
    onSuccess: ({ changedFields }) => {
      queryClient.invalidateQueries();
      toast.success(
        `Kept the existing ${money(context.existing_payment_cents)} payment and skipped the incoming activity${changedFields ? `; added ${changedFields} contact detail${changedFields === 1 ? "" : "s"}` : ""}.`,
      );
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) => void showError(error),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Registration payment conflict"
      description="Choose the safe resolution for this imported activity. The existing registration and donation history will not be changed."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={keepExisting.isPending}>
            Leave for later
          </Button>
          <Button onClick={() => keepExisting.mutate()} disabled={keepExisting.isPending}>
            {keepExisting.isPending ? "Resolving…" : "Keep existing payment; skip incoming activity"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Event" value={context.event_name} />
        <Detail label="Existing payment" value={money(context.existing_payment_cents)} />
        <Detail label="Incoming payment" value={money(context.incoming_payment_cents)} urgent />
        <Detail label="Registration fee" value={money(context.fee_cents)} />
        <Detail label="Planned net donation" value={money(context.planned_net_donation_cents)} />
      </div>
      <p className="mt-4 rounded-xl bg-suggestion/10 px-3 py-2 text-sm text-foreground">
        Keeping the existing payment submits no event registration and no donation from this row.
      </p>
    </ResponsiveModal>
  );
}

function Detail({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={urgent ? "font-semibold text-urgent" : "font-semibold text-foreground"}>{value}</p>
    </div>
  );
}
