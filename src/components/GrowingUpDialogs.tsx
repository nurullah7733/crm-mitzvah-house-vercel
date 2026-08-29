import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, selectClass, todayISO } from "@/components/forms/fields";
import { fetchAll } from "@/lib/fetch-all";
import { reportDbError } from "@/lib/db-errors";
import { logChange } from "@/lib/session-log";
import { properCase } from "@/lib/proper-case";
import { showError, guard } from "@/lib/app-errors";

type PersonLite = {
  id: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  household_id?: string | null;
  mailing_preference?: string | null;
};

function useHouseholds() {
  return useQuery({
    queryKey: ["households-mini"],
    queryFn: () =>
      fetchAll((f, t) =>
        supabase
          .from("households")
          .select("id, name, address")
          .order("name")
          .order("id")
          .range(f, t),
      ),
  });
}

/**
 * Staff-confirmed step from Child to Adult. Nothing here happens automatically.
 * They stay in the household — moving out is a separate decision.
 */
export function BecomeAdultDialog({
  open,
  onOpenChange,
  person,
  name,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  person: PersonLite;
  name: string;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [mailing, setMailing] = useState<"household" | "own">("household");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (open) {
      setMailing(
        (person.mailing_preference === "own" ? "own" : "household") as "household" | "own",
      );
      setPhone(person.phone ?? "");
      setEmail(person.email ?? "");
    }
  }, [open, person.mailing_preference, person.phone, person.email]);

  const confirm = useMutation({
    mutationFn: async () => {
      const patch: { role: string; mailing_preference: string; phone?: string; email?: string } = {
        role: "Adult",
        mailing_preference: mailing,
      };
      if (phone.trim() && phone.trim() !== (person.phone ?? "")) patch["phone"] = phone.trim();
      if (email.trim() && email.trim().toLowerCase() !== (person.email ?? ""))
        patch["email"] = email.trim().toLowerCase();
      const { error } = await supabase.from("people").update(patch).eq("id", person.id);
      if (error) throw error;
      await guard(
        supabase.from("interactions").insert({
          person_id: person.id,
          type: "note",
          date: todayISO(),
          text: `Reviewed and confirmed as an adult. Mailings: ${
            mailing === "own" ? "their own mailings" : "stays on the household mailing"
          }. Household unchanged.`,
        }),
        { area: "people", action: "Add the timeline note" },
      );
    },
    onSuccess: async () => {
      logChange(`Confirmed ${name} as an adult`);
      toast.success(`${name} is now an adult. They stay in the household.`);
      await queryClient.invalidateQueries({ queryKey: ["person", person.id] });
      await queryClient.invalidateQueries({ queryKey: ["people-list"] });
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: unknown) => void showError(e),
  });

  const missingContact = !person.phone && !person.email;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Make ${name} an adult`}
      description="Their role changes to Adult. They keep their household, and all their history stays with them."
      footer={
        <>
          <Button
            className="rounded-xl"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? "Saving…" : "Yes, make them an adult"}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Should {name} receive their own mailings, or stay on the household mailing?
          </p>
          <div className="mt-2 flex gap-1 rounded-xl border border-border p-1">
            {(
              [
                ["household", "Stays on the household mailing"],
                ["own", "Their own mailings"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMailing(value)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs ${
                  mailing === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {missingContact && (
          <p className="rounded-xl border border-suggestion/50 bg-suggestion/10 p-3 text-xs text-foreground">
            We have no phone or email for {name}. Children often have neither — a good moment to
            ask.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Their own phone">
            <Input
              className="text-base"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Their own email">
            <Input
              className="text-base"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          From now on they can have their own donations and their own communications. Moving out of
          the household is a separate decision — use “Move to new household” whenever that actually
          happens.
        </p>
      </div>
    </ResponsiveModal>
  );
}

/**
 * Move a person to a different household without ever deleting and recreating
 * them — donations, events, notes and tasks all stay attached to the person.
 */
export function MoveHouseholdDialog({
  open,
  onOpenChange,
  personId,
  name,
  currentHouseholdId,
  currentHouseholdName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personId: string;
  name: string;
  currentHouseholdId: string | null;
  currentHouseholdName?: string | null;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: households } = useHouseholds();
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [householdId, setHouseholdId] = useState("");
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");

  useEffect(() => {
    if (open) {
      setMode("new");
      setHouseholdId("");
      setNewName(name ? `${name.split(" ").slice(-1)[0]} Household` : "");
      setNewAddress("");
    }
  }, [open, name]);

  const move = useMutation({
    mutationFn: async () => {
      if (mode === "new" && !newName.trim()) throw new Error("Give the new household a name.");
      if (mode !== "new" && !householdId) throw new Error("Pick a household to move them to.");
      const to =
        mode === "new"
          ? newName.trim()
          : ((households ?? []).find((h) => h.id === householdId)?.name ?? "a household");
      const { error } = await supabase.rpc("mutate_household_membership", {
        _person_id: personId,
        _expected_household_id: currentHouseholdId,
        _intent: mode === "new" ? "create" : "link",
        _target_household_id: mode === "new" ? null : householdId,
        _relationship: null,
        _new_household:
          mode === "new"
            ? { name: properCase(newName.trim()), address: newAddress.trim() || null }
            : null,
        _note: `Moved household: ${currentHouseholdName ?? "no household"} → ${to}. All history stayed with them.`,
      });
      if (error) throw error;
      return to;
    },
    onSuccess: async (to) => {
      logChange(`Moved ${name} to ${to}`);
      toast.success(`${name} now belongs to ${to}. Nothing in their history moved or was lost.`);
      await queryClient.invalidateQueries({ queryKey: ["person", personId] });
      await queryClient.invalidateQueries({ queryKey: ["people-list"] });
      await queryClient.invalidateQueries({ queryKey: ["households-mini"] });
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: unknown) => void showError(e),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${name} to a new household`}
      description="Their donations, event attendance, notes and tasks all stay with them. Nothing is deleted."
      footer={
        <>
          <Button className="rounded-xl" disabled={move.isPending} onClick={() => move.mutate()}>
            {move.isPending ? "Moving…" : "Move them"}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Currently in <strong>{currentHouseholdName ?? "no household"}</strong>.
        </p>
        <div className="flex gap-1 rounded-xl border border-border p-1">
          {(
            [
              ["new", "Start a new household"],
              ["existing", "Join a household we already have"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs ${
                mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "new" ? (
          <div className="grid gap-3">
            <Field label="New household name">
              <Input
                className="text-base"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <Field label="Address (optional)">
              <Input
                className="text-base"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label="Household">
            <select
              className={selectClass}
              value={householdId}
              onChange={(e) => setHouseholdId(e.target.value)}
            >
              <option value="">Choose a household</option>
              {(households ?? [])
                .filter((h) => h.id !== currentHouseholdId)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.address ? ` — ${h.address}` : ""}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
    </ResponsiveModal>
  );
}
