import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Field, selectClass } from "@/components/forms/fields";
import { Input } from "@/components/ui/input";
import { personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";
import { logChange } from "@/lib/session-log";
import { friendlyDbError } from "@/lib/db-errors";

type Person = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  contact_type: string | null;
  owner: string | null;
  met_source: string | null;
  met_date: string | null;
  birth_date: string | null;
  household_id: string | null;
  tags: string[] | null;
  programs: string[] | null;
  lifetime_giving: number | string | null;
};

const FIELDS: { key: keyof Person; label: string }[] = [
  { key: "display_name", label: "Name shown" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "role", label: "Role" },
  { key: "contact_type", label: "Contact type" },
  { key: "owner", label: "Owner" },
  { key: "met_source", label: "Where we met" },
  { key: "met_date", label: "Date we met" },
  { key: "birth_date", label: "Birth date" },
  { key: "household_id", label: "Household" },
  { key: "tags", label: "Tags" },
  { key: "programs", label: "Programs" },
];

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/**
 * Side-by-side duplicate merge. All history (donations, notes, registrations,
 * tasks, sources, yahrzeits) is re-pointed to the surviving record by the
 * database, so nothing is orphaned, and each merge is logged.
 */
export function MergeContactsDialog({
  open,
  onOpenChange,
  primaryId,
  suggestedIds = [],
  onMerged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  primaryId?: string;
  suggestedIds?: string[];
  onMerged?: (survivingId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [leftId, setLeftId] = useState(primaryId ?? "");
  const [rightId, setRightId] = useState(suggestedIds[0] ?? "");
  const [keepLeft, setKeepLeft] = useState(true);
  const [picks, setPicks] = useState<Record<string, "left" | "right">>({});

  const { data: people } = useQuery({
    queryKey: ["merge-people"],
    enabled: open,
    queryFn: () =>
      fetchAll<Person>((from, to) =>
        supabase
          .from("people")
          .select(
            "id, display_name, first_name, last_name, email, phone, role, contact_type, owner, met_source, met_date, birth_date, household_id, tags, programs, lifetime_giving",
          )
          .is("deleted_at", null)
          .order("display_name")
          .order("id")
          .range(from, to),
      ),
  });

  useEffect(() => {
    if (open) {
      setLeftId(primaryId ?? "");
      setRightId(suggestedIds[0] ?? "");
      setKeepLeft(true);
      setPicks({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, primaryId, suggestedIds.join(",")]);

  const left = (people ?? []).find((p) => p.id === leftId);
  const right = (people ?? []).find((p) => p.id === rightId);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (people ?? []).filter((p) => (q ? personName(p).toLowerCase().includes(q) : true));
    return list.slice(0, 200);
  }, [people, search]);

  const merge = useMutation({
    mutationFn: async () => {
      if (!left || !right) throw new Error("Pick two contacts");
      if (left.id === right.id) throw new Error("Pick two different contacts");
      const survivor = keepLeft ? left : right;
      const loser = keepLeft ? right : left;

      const fieldValues: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const side = picks[f.key as string] ?? (keepLeft ? "left" : "right");
        const chosen = side === "left" ? left[f.key] : right[f.key];
        if (chosen !== null && chosen !== undefined && chosen !== "") {
          fieldValues[f.key as string] = chosen;
        }
      }

      const { error } = await supabase.rpc("merge_people", {
        _surviving_id: survivor.id,
        _merged_id: loser.id,
        _field_values: fieldValues as never,
      });
      if (error) throw error;
      return survivor.id;
    },
    onSuccess: (survivingId) => {
      queryClient.invalidateQueries();
      toast.success("Contacts merged — all history kept on the surviving record");
      logChange("Merged two duplicate contacts");
      onOpenChange(false);
      onMerged?.(survivingId);
    },
    onError: async (e: Error) => toast.error(await friendlyDbError(e)),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Merge duplicate contacts"
      description="Choose which record survives and which value to keep for each field. All donations, notes, event history and tasks move to the surviving record."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl sm:flex-none"
            disabled={!left || !right || left?.id === right?.id || merge.isPending}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? "Merging…" : "Merge contacts"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Find a contact">
          <Input
            className="text-base"
            value={search}
            placeholder="Type a name to narrow the lists"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact A">
            <select className={selectClass} value={leftId} onChange={(e) => setLeftId(e.target.value)}>
              <option value="">Choose a contact</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact B (the possible duplicate)">
            <select className={selectClass} value={rightId} onChange={(e) => setRightId(e.target.value)}>
              <option value="">Choose a contact</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {left && right && (
          <>
            <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={keepLeft} onChange={() => setKeepLeft(true)} />
                Keep {personName(left)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={!keepLeft} onChange={() => setKeepLeft(false)} />
                Keep {personName(right)}
              </label>
            </div>

            <div className="space-y-2">
              {FIELDS.map((f) => {
                const side = picks[f.key as string] ?? (keepLeft ? "left" : "right");
                return (
                  <div key={f.key as string} className="rounded-xl border border-border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {(["left", "right"] as const).map((s) => (
                        <label
                          key={s}
                          className={`flex items-start gap-2 rounded-lg px-2 py-1 text-sm ${
                            side === s ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          <input
                            type="radio"
                            className="mt-1"
                            checked={side === s}
                            onChange={() => setPicks((p) => ({ ...p, [f.key as string]: s }))}
                          />
                          <span className="break-words">{show(s === "left" ? left[f.key] : right[f.key])}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="rounded-xl bg-suggestion/10 px-3 py-2 text-xs text-foreground">
              Merging cannot be undone automatically, but every merge is recorded with a full copy of the
              record that was merged away.
            </p>
          </>
        )}
      </div>
    </ResponsiveModal>
  );
}