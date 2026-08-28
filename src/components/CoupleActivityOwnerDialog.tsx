import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/app-errors";
import {
  resolveCoupleActivity,
  setAsideCoupleActivity,
  type CoupleActivityContext,
} from "@/lib/review-couple-activity";
import type { RowValues } from "@/lib/import-mapping";

export function CoupleActivityOwnerDialog({
  open,
  onOpenChange,
  itemId,
  context,
  row,
  batchId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  itemId: string;
  context: CoupleActivityContext;
  row: RowValues;
  batchId?: string | null;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const choose = useMutation({
    mutationFn: (owner: "main" | "partner") =>
      resolveCoupleActivity(itemId, owner, context, row, batchId ?? null),
    onSuccess: (_, owner) => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(
        `Activity assigned to ${owner === "main" ? context.main_claim.first_name : context.partner_claim.first_name}`,
      );
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) => void showError(error),
  });
  const setAside = useMutation({
    mutationFn: () => setAsideCoupleActivity(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Set aside for later");
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) => void showError(error),
  });
  const activity = context.activity;
  const activityLabel =
    activity["type"] === "donation"
      ? `Donation — $${Number(activity["amount"] ?? 0).toFixed(2)} — ${String(activity["date"] ?? "")}`
      : activity["type"] === "event"
        ? `Event attendance — ${String(activity["name"] ?? "")}`
        : activity["type"] === "note"
          ? `Timeline note — ${String(activity["text"] ?? "")}`
          : "Tags or programs";
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose activity owner"
      description="Both people remain separate contacts. The activity will be attached exactly once to the person you choose."
      footer={
        <>
          <Button
            variant="ghost"
            className="rounded-xl"
            disabled={choose.isPending || setAside.isPending}
            onClick={() => setAside.mutate()}
          >
            Set aside
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="rounded-xl border border-suggestion/40 bg-suggestion/10 p-3">
          Activity: {activityLabel}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["main", "partner"] as const).map((owner) => {
            const claim = owner === "main" ? context.main_claim : context.partner_claim;
            return (
              <Button
                key={owner}
                variant="outline"
                className="h-auto justify-start rounded-xl p-3 text-left"
                disabled={choose.isPending}
                onClick={() => choose.mutate(owner)}
              >
                <span>
                  <strong>
                    Assign to {claim.first_name} {claim.last_name}
                  </strong>
                  <br />
                  <span className="text-xs text-muted-foreground">{claim.email || "No email"}</span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </ResponsiveModal>
  );
}
