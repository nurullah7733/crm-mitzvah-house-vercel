import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Merge, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { MergeHouseholdsDialog } from "@/components/MergeHouseholdsDialog";

type BulkTable = "donations" | "events" | "households" | "grants" | "tasks" | "campaigns";

/** Tables that keep the record but hide it (recoverable). */
const SOFT_DELETE: BulkTable[] = ["donations", "events", "tasks"];

/**
 * Floating bar for any list of records (gifts, events, households, grants…).
 * Selecting rows reveals it; Delete removes every selected record.
 */
export function BulkRecordBar({
  table,
  selectedIds,
  onClear,
  visibleIds,
  onSelectAll,
  noun,
  nounPlural,
}: {
  table: BulkTable;
  selectedIds: string[];
  onClear: () => void;
  visibleIds: string[];
  onSelectAll: () => void;
  noun: string;
  nounPlural: string;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const soft = SOFT_DELETE.includes(table);

  const remove = useMutation({
    mutationFn: async () => {
      if (soft) {
        await archiveRecords(table as ArchivableTable, selectedIds);
        return;
      }
      if (table === "households") {
        // Keep people; they simply stop belonging to a household.
        const { error: unlink } = await supabase
          .from("people")
          .update({ household_id: null } as never)
          .in("household_id", selectedIds);
        if (unlink) throw unlink;
      }
      const { error } = await supabase.from(table).delete().in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        `Deleted ${selectedIds.length} ${selectedIds.length === 1 ? noun : nounPlural}`,
      );
      queryClient.invalidateQueries();
      setConfirm(false);
      onClear();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (selectedIds.length === 0) return null;
  const allSelected = visibleIds.length > 0 && selectedIds.length >= visibleIds.length;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-3 lg:bottom-6">
        <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg">
          <span className="text-sm font-medium text-foreground">{selectedIds.length} selected</span>
          {!allSelected && (
            <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={onSelectAll}>
              Select all {visibleIds.length} matching these filters
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {table === "households" && selectedIds.length === 2 && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setMergeOpen(true)}>
                <Merge className="size-4" /> Merge
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-urgent/40 text-urgent"
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
            <Button variant="ghost" size="sm" className="rounded-xl" onClick={onClear} aria-label="Clear selection">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ResponsiveModal
        open={confirm}
        onOpenChange={(o) => !o && setConfirm(false)}
        title={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? noun : nounPlural}?`}
        description={
          soft
            ? "They're hidden from every screen and recoverable from the change history."
            : "This removes them for good."
        }
        footer={
          <>
            <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl bg-urgent text-white hover:bg-urgent/90 sm:flex-none"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Yes, delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {table === "households"
            ? "People stay in the system — they just won't belong to a household any more."
            : "Only the selected records are affected."}
        </p>
      </ResponsiveModal>

      {table === "households" && selectedIds.length === 2 && (
        <MergeHouseholdsDialog open={mergeOpen} onOpenChange={setMergeOpen} ids={selectedIds} onMerged={onClear} />
      )}
    </>
  );
}
