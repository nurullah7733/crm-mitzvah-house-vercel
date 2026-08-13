import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/fields";
import { properCaseAddress } from "@/lib/proper-case";
import { logChange } from "@/lib/session-log";
import { createFindOutWhoTask, findHouseholdAtAddress, nameFromAddress } from "@/lib/address-household";

const HINTS = [
  "Family with young kids",
  "Hebrew speaking",
  "Russian speaking",
  "Elderly",
  "Nobody home",
  "Interested in Shabbat package",
] as const;

/** Doorstep capture: an address is enough. Everything else is optional. */
export function QuickAddHouseholdDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);

  const toggleHint = (h: string) =>
    setHints((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));

  function reset() {
    setAddress("");
    setFirstName("");
    setPhone("");
    setNotes("");
    setHints([]);
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("This device can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
          );
          const json = (await res.json()) as { display_name?: string };
          if (json.display_name) {
            setAddress(json.display_name.split(",").slice(0, 4).join(", "));
            toast.success("Address filled in — check it before saving.");
          } else {
            toast.error("Couldn't turn that location into an address.");
          }
        } catch {
          toast.error("Couldn't reach the address lookup. Type it instead.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        toast.error("Location permission was declined.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const save = useMutation({
    mutationFn: async () => {
      const clean = properCaseAddress(address).trim();
      if (!clean) throw new Error("An address is required");

      const existing = await findHouseholdAtAddress(clean);
      if (existing) {
        throw new Error(`There's already a household at this address: ${existing.name}`);
      }

      const noteLines = [
        firstName.trim() ? `First name at the door: ${firstName.trim()}` : "",
        hints.length ? hints.join(" · ") : "",
        notes.trim(),
      ].filter(Boolean);

      const { data, error } = await supabase
        .from("households")
        .insert({
          name: nameFromAddress(clean),
          address: clean,
          phone: phone.trim() || null,
          notes: noteLines.join("\n") || null,
          status: "address_only",
        })
        .select("id")
        .single();
      if (error) throw error;

      if (noteLines.length) {
        await supabase.from("interactions").insert({
          household_id: data.id,
          type: "note",
          text: noteLines.join(" · "),
        });
      }
      await createFindOutWhoTask(clean);
    },
    onSuccess: () => {
      toast.success("Address saved — a follow-up task was created");
      logChange("Added an address-only household");
      queryClient.invalidateQueries();
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Quick add an address"
      description="For doorsteps and deliveries — the address is all you need."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl sm:flex-none"
            onClick={() => save.mutate()}
            disabled={save.isPending || !address.trim()}
          >
            Save address
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Address">
          <Textarea
            className="text-base"
            rows={2}
            autoFocus
            placeholder="412 Ashford Dunwoody Rd"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Button type="button" variant="outline" className="rounded-xl" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
          Use my current location
        </Button>

        <Field label="Note (what you picked up at the door)">
          <Textarea
            className="text-base"
            rows={3}
            placeholder="Left a Shabbat package, wife said to come back Sunday…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div>
          <p className="text-xs text-muted-foreground">Quick tags</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {HINTS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => toggleHint(h)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  hints.includes(h)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <Field label="First name, if you got one">
          <Input className="text-base" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Phone, if you got one">
          <Input
            className="text-base"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/** Log a visit, delivery or note against a household — works with no members. */
export function LogHouseholdActivityDialog({
  open,
  onOpenChange,
  householdId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  householdId: string;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"Visit" | "Delivery" | "Note" | "Call">("Visit");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("interactions").insert({
        household_id: householdId,
        type: kind === "Call" ? "call" : "note",
        date,
        text: `${kind}${text.trim() ? ` — ${text.trim()}` : ""}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logged");
      logChange("Logged household activity");
      queryClient.invalidateQueries();
      setText("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log activity"
      description="Visits and deliveries stay on this address's history."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {(["Visit", "Delivery", "Call", "Note"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                kind === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <Field label="Date">
          <Input className="text-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="What happened">
          <Textarea className="text-base" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}
