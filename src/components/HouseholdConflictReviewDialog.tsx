import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/app-errors";
import {
  keepCurrentHouseholds,
  type HouseholdConflictContext,
} from "@/lib/review-household-conflict";

export function HouseholdConflictReviewDialog({
  open,
  onOpenChange,
  itemId,
  context,
  hasActivity,
  onDone,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  itemId: string;
  context: HouseholdConflictContext;
  hasActivity: boolean;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: () => keepCurrentHouseholds(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Both people kept in their current households");
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) => void showError(error),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Household conflict"
      description="These are two existing people. This decision does not merge or create either person."
      footer={
        <>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-xl"
            disabled={resolve.isPending || hasActivity}
            onClick={() => resolve.mutate()}
          >
            {resolve.isPending
              ? "Keeping…"
              : hasActivity
                ? "Activity needs review first"
                : "Keep current households"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="rounded-xl border border-suggestion/40 bg-suggestion/10 p-3 text-foreground">
          Both people already exist but belong to different households.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Person A</p>
            <p className="font-medium text-foreground">{context.main_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current household:{" "}
              {context.main_household_name || context.main_household_id || "None"}
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Person B</p>
            <p className="font-medium text-foreground">{context.partner_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current household:{" "}
              {context.partner_household_name || context.partner_household_id || "None"}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          No household change or activity will be applied.{" "}
          {hasActivity
            ? "Activity must be handled separately before this conflict can be resolved."
            : "Any activity on this row remains unresolved."}
        </p>
      </div>
    </ResponsiveModal>
  );
}
