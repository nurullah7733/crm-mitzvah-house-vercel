import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/fields";
import { Input } from "@/components/ui/input";
import { personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";
import { namesAreClose } from "@/lib/import-mapping";
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
  households?: { name: string | null } | null;
};

const FIELDS: MergeField[] = [
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

/** Exact editable values this dialog was based on, used for stale-write rejection. */
function mergePersonSnapshot(person: Person) {
  return Object.fromEntries(FIELDS.map(({ key }) => [key, person[key as keyof Person] ?? null]));
}

/** Households are shown by name; the id is put back when saving. */
function toCompareRecord(p: Person, houseNames: Map<string, string>) {
  const rec: Record<string, unknown> = { ...p };
  rec["household_id"] = p.household_id
    ? (houseNames.get(p.household_id) ?? "Household on file")
    : null;
  return rec;
}

/**
 * Find a contact by typing. A plain dropdown of three thousand names is
 * unusable on a phone, which is why the merge screen felt like it did nothing.
 */
function PersonPicker({
  label,
  people,
  value,
  exclude,
  onPick,
}: {
  label: string;
  people: Person[];
  value: Person | undefined;
  exclude?: string | undefined;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return people
      .filter((p) => p.id !== exclude)
      .filter((p) => {
        const name = personName(p).toLowerCase();
        return (
          name.includes(q) ||
          (p.email ?? "").toLowerCase().includes(q) ||
          (p.phone ?? "").includes(q) ||
          namesAreClose(q, name)
        );
      })
      .slice(0, 15);
  }, [people, query, exclude]);

  return (
    <Field label={label}>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
          <span className="text-sm text-foreground">{personName(value)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg"
            onClick={() => {
              onPick("");
              setQuery("");
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            className="text-base"
            value={query}
            placeholder="Start typing a name, email or phone"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && (
            <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {results.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start rounded-lg text-left"
                  onClick={() => onPick(p.id)}
                >
                  <span className="truncate">
                    {personName(p)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[p.email, p.phone].filter(Boolean).join(" · ") || "No email or phone"}
                    </span>
                  </span>
                </Button>
              ))}
              {results.length === 0 && (
                <p className="px-2 py-1 text-sm text-muted-foreground">No contacts match that.</p>
              )}
            </div>
          )}
        </>
      )}
    </Field>
  );
}

/**
 * Side-by-side duplicate merge. All history (donations, notes, registrations,
 * tasks, sources, yahrzeits) is re-pointed to the surviving record by the
 * database, so nothing is orphaned, and each merge is logged.
 *
 * The same component is used from the People list, a contact's own profile and
 * the import review, so all three behave identically. Pass `queueIds` to work
 * through three or more selected contacts one pair at a time.
 */
export function MergeContactsDialog({
  open,
  onOpenChange,
  primaryId,
  suggestedIds = [],
  queueIds = [],
  onMerged,
  lockSelection = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  primaryId?: string;
  suggestedIds?: string[];
  queueIds?: string[];
  onMerged?: (survivingId: string) => void;
  lockSelection?: boolean;
}) {
  const queryClient = useQueryClient();
  const queue = queueIds.length >= 2 ? queueIds : [];
  const [step, setStep] = useState(0);
  const [leftId, setLeftId] = useState(queue[0] ?? primaryId ?? "");
  const [rightId, setRightId] = useState(queue[1] ?? suggestedIds[0] ?? "");
  const [keepLeft, setKeepLeft] = useState(true);
  const [picks, setPicks] = useState<Record<string, Side>>({});
  const [mergeHouses, setMergeHouses] = useState(true);

  const { data: people } = useQuery({
    queryKey: ["merge-people"],
    enabled: open,
    queryFn: () =>
      fetchAll<Person>((from, to) =>
        supabase
          .from("people")
          .select(
            "id, display_name, first_name, last_name, email, phone, role, contact_type, owner, met_source, met_date, birth_date, household_id, tags, programs, lifetime_giving, households(name)",
          )
          .is("deleted_at", null)
          .order("display_name")
          .order("id")
          .range(from, to),
      ),
  });

  useEffect(() => {
    if (open) {
      setStep(0);
      setLeftId(queue[0] ?? primaryId ?? "");
      setRightId(queue[1] ?? suggestedIds[0] ?? "");
      setKeepLeft(true);
      setPicks({});
      setMergeHouses(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, primaryId, suggestedIds.join(","), queueIds.join(",")]);

  const left = (people ?? []).find((p) => p.id === leftId);
  const right = (people ?? []).find((p) => p.id === rightId);
  const remaining = queue.length ? queue.length - 1 - step : 0;

  const houseNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      if (p.household_id && p.households?.name) map.set(p.household_id, p.households.name);
    return map;
  }, [people]);

  const rows = useMemo(
    () =>
      left && right
        ? diffRecords(FIELDS, toCompareRecord(left, houseNames), toCompareRecord(right, houseNames))
        : [],
    [left, right, houseNames],
  );

  /** Two different households behind the two contacts means a leftover near-duplicate household. */
  const twoHouseholds =
    !!left?.household_id && !!right?.household_id && left.household_id !== right.household_id;

  const merge = useMutation({
    mutationFn: async () => {
      if (!left || !right) throw new Error("Pick two contacts");
      if (left.id === right.id) throw new Error("Pick two different contacts");
      const survivor = keepLeft ? left : right;
      const loser = keepLeft ? right : left;

      const fieldValues = writableValues(mergedResult(rows, picks, keepLeft ? "left" : "right"));
      // Put the household back as an id, choosing whichever record's household won.
      const chosenHouse = fieldValues["household_id"];
      if (chosenHouse !== undefined) {
        const name = String(chosenHouse);
        const id =
          [left, right].find(
            (p) => p.household_id && (houseNames.get(p.household_id) ?? "") === name,
          )?.household_id ??
          survivor.household_id ??
          loser.household_id ??
          null;
        if (id) fieldValues["household_id"] = id;
        else delete fieldValues["household_id"];
      }

      const { data, error } = await supabase.rpc("merge_people_with_households", {
        _surviving_id: survivor.id,
        _merged_id: loser.id,
        _field_values: fieldValues as never,
        _merge_households: twoHouseholds && mergeHouses,
        _expected_surviving_household_id: survivor.household_id,
        _expected_merged_household_id: loser.household_id,
        _expected_surviving_person: mergePersonSnapshot(survivor),
        _expected_merged_person: mergePersonSnapshot(loser),
      });
      if (error) throw error;
      const result = (data ?? {}) as Record<string, unknown>;
      const housesMerged = result["households_merged"] === true;
      return { id: survivor.id, housesMerged };
    },
    onSuccess: ({ id, housesMerged }) => {
      queryClient.invalidateQueries();
      toast.success(
        housesMerged
          ? "Contacts merged, and their two households combined into one"
          : "Contacts merged — all history kept on the surviving record",
      );
      logChange(
        housesMerged
          ? "Merged two duplicate contacts and their households"
          : "Merged two duplicate contacts",
      );
      // Working through a selection of three or more: keep going with the next one.
      if (queue.length && step + 1 < queue.length - 1) {
        setStep(step + 1);
        setLeftId(id);
        setRightId(queue[step + 2]!);
        setKeepLeft(true);
        setPicks({});
        return;
      }
      onOpenChange(false);
      onMerged?.(id);
    },
    onError: (e: unknown) => void showError(e),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Merge duplicate contacts"
      description={
        queue.length
          ? `Merging ${queue.length} selected contacts, one pair at a time. ${remaining} left after this one.`
          : "Choose which record survives and which value to keep for each field. All donations, notes, event history and tasks move to the surviving record."
      }
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
            disabled={!left || !right || left?.id === right?.id || merge.isPending}
            onClick={() => merge.mutate()}
          >
            {merge.isPending
              ? "Merging…"
              : remaining > 0
                ? "Merge these two, then the next"
                : "Merge contacts"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {!lockSelection && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PersonPicker
              label="This contact"
              people={people ?? []}
              value={left}
              exclude={rightId || undefined}
              onPick={setLeftId}
            />
            <PersonPicker
              label="The contact it duplicates"
              people={people ?? []}
              value={right}
              exclude={leftId || undefined}
              onPick={setRightId}
            />
          </div>
        )}

        {!lockSelection && (!left || !right) && (
          <p className="rounded-xl bg-suggestion/10 px-3 py-2 text-sm text-foreground">
            Search for the other contact by name, email or phone. Once both are chosen you'll see
            them side by side.
          </p>
        )}

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
              leftLabel={personName(left)}
              rightLabel={personName(right)}
              defaultSide={keepLeft ? "left" : "right"}
            />

            <p className="rounded-xl bg-suggestion/10 px-3 py-2 text-xs text-foreground">
              Every donation, note, event, task, special date and source moves to the surviving
              record. Merging cannot be undone automatically, but each merge is recorded with a full
              copy of the record that was merged away.
            </p>

            {twoHouseholds && (
              <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={mergeHouses}
                  onChange={(e) => setMergeHouses(e.target.checked)}
                />
                <span>
                  These two contacts are in different households (
                  {houseNames.get(left.household_id!) ?? "one household"} and{" "}
                  {houseNames.get(right.household_id!) ?? "another household"}). Combine those two
                  households into one as well, so we don't leave a near-identical household behind.
                </span>
              </label>
            )}
          </>
        )}
      </div>
    </ResponsiveModal>
  );
}
