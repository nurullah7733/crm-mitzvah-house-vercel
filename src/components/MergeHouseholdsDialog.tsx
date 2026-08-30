import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { logChange } from "@/lib/session-log";
import { friendlyDbError } from "@/lib/db-errors";
import {
  MergeCompare,
  diffRecords,
  mergedResult,
  writableValues,
  type MergeField,
  type Side,
} from "@/components/MergeCompare";
import { showError } from "@/lib/app-errors";

type Household = {
  id: string;
  status: string;
  name: string;
  address: string | null;
  address_line2: string | null;
  address_line3: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  county: string | null;
  billing_address: string | null;
  phone: string | null;
  notes: string | null;
};

type HouseholdMemberSnapshot = {
  id: string;
  household_id: string | null;
  household_relationship: string | null;
  deleted_at: string | null;
};

type HouseholdMergeSnapshot = {
  key: string;
  left: Household;
  right: Household;
  members: HouseholdMemberSnapshot[];
};

const FIELDS: MergeField[] = [
  { key: "name", label: "Household name" },
  { key: "address", label: "Address" },
  { key: "address_line2", label: "Address line 2" },
  { key: "address_line3", label: "Extra address line" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "ZIP" },
  { key: "county", label: "County" },
  { key: "billing_address", label: "Billing address" },
  { key: "phone", label: "Phone" },
  { key: "notes", label: "Notes" },
];

/**
 * Merge two households that are really one family. Everyone in both households
 * ends up in the surviving household, and all of their history stays with them.
 */
export function MergeHouseholdsDialog({
  open,
  onOpenChange,
  ids,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ids: string[];
  onMerged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [keepLeft, setKeepLeft] = useState(true);
  const [picks, setPicks] = useState<Record<string, Side>>({});
  const [snapshot, setSnapshot] = useState<HouseholdMergeSnapshot | null>(null);
  const snapshotKey = ids.join(",");

  useEffect(() => {
    if (open) {
      setKeepLeft(true);
      setPicks({});
      setSnapshot(null);
    }
  }, [open, snapshotKey]);

  const { data, isFetching } = useQuery({
    queryKey: ["merge-households", snapshotKey],
    enabled: open && ids.length === 2,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data: houses, error } = await supabase
        .from("households")
        .select(
          "id, status, name, address, address_line2, address_line3, city, state, postal_code, county, billing_address, phone, notes",
        )
        .in("id", ids);
      if (error) throw error;
      const { data: members, error: membersError } = await supabase
        .from("people")
        .select("id, household_id, household_relationship, deleted_at")
        .in("household_id", ids);
      if (membersError) throw membersError;
      return {
        left: (houses ?? []).find((h) => h.id === ids[0]) as Household | undefined,
        right: (houses ?? []).find((h) => h.id === ids[1]) as Household | undefined,
        members: (members ?? []) as HouseholdMemberSnapshot[],
      };
    },
  });

  useEffect(() => {
    if (!open || isFetching || snapshot || !data?.left || !data.right) return;
    setSnapshot({
      key: snapshotKey,
      left: { ...data.left },
      right: { ...data.right },
      members: data.members.map((member) => ({ ...member })),
    });
  }, [data, isFetching, open, snapshot, snapshotKey]);

  const currentSnapshot = snapshot?.key === snapshotKey ? snapshot : null;
  const left = currentSnapshot?.left;
  const right = currentSnapshot?.right;

  const rows = useMemo(
    () =>
      left && right
        ? diffRecords(
            FIELDS,
            left as unknown as Record<string, unknown>,
            right as unknown as Record<string, unknown>,
          )
        : [],
    [left, right],
  );

  const merge = useMutation({
    mutationFn: async () => {
      if (!left || !right) throw new Error("Pick two households");
      const survivor = keepLeft ? left : right;
      const loser = keepLeft ? right : left;
      const fieldValues = writableValues(mergedResult(rows, picks, keepLeft ? "left" : "right"));
      const { error } = await supabase.rpc("merge_households", {
        _surviving_id: survivor.id,
        _merged_id: loser.id,
        _field_values: fieldValues as never,
        _expected_surviving_household: survivor as never,
        _expected_merged_household: loser as never,
        _expected_surviving_members: currentSnapshot!.members
          .filter((member) => member.household_id === survivor.id)
          .sort((a, b) => a.id.localeCompare(b.id)) as never,
        _expected_merged_members: currentSnapshot!.members
          .filter((member) => member.household_id === loser.id)
          .sort((a, b) => a.id.localeCompare(b.id)) as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Households merged — everyone is now in one household");
      logChange("Merged two households");
      onOpenChange(false);
      onMerged?.();
    },
    onError: (e: unknown) => void showError(e),
  });

  const memberLine = (h: Household | undefined) =>
    h
      ? `${currentSnapshot?.members.filter((member) => member.household_id === h.id && !member.deleted_at).length ?? 0} ${(currentSnapshot?.members.filter((member) => member.household_id === h.id && !member.deleted_at).length ?? 0) === 1 ? "person" : "people"}`
      : "";

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Merge two households"
      description="Choose which household stays. Everyone from both households moves into it, and all of their donations and history stay with them."
      footer={
        <>
          <Button
            variant="outline"
            className="flex-1 rounded-xl sm:flex-none"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl sm:flex-none"
            disabled={!left || !right || merge.isPending}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? "Merging…" : "Merge households"}
          </Button>
        </>
      }
    >
      {left && right ? (
        <div className="grid gap-3">
          <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={keepLeft} onChange={() => setKeepLeft(true)} />
              Keep {left.name} ({memberLine(left)})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={!keepLeft} onChange={() => setKeepLeft(false)} />
              Keep {right.name} ({memberLine(right)})
            </label>
          </div>

          <MergeCompare
            rows={rows}
            picks={picks}
            onPick={(key, side) => setPicks((p) => ({ ...p, [key]: side }))}
            onUseAll={(side) =>
              setPicks(
                Object.fromEntries(
                  rows.filter((r) => r.state === "conflict").map((r) => [r.key, side]),
                ),
              )
            }
            leftLabel={left.name}
            rightLabel={right.name}
            defaultSide={keepLeft ? "left" : "right"}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading the two households…</p>
      )}
    </ResponsiveModal>
  );
}
