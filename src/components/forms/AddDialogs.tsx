import { useState } from "react";
import { formatPhone } from "@/lib/phone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logChange } from "@/lib/session-log";
import { Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass, todayISO } from "@/components/forms/fields";
import { hebrewDateFromEnglish } from "@/lib/hebrew";
import { personName } from "@/lib/names";
import { fetchAll } from "@/lib/fetch-all";
import { ContactPicker } from "@/components/forms/ContactPicker";
import { MethodDraftList } from "@/components/ContactMethodsEditor";
import { addContactMethods, emptyDraft, phoneKey, type MethodDraft } from "@/lib/contact-methods";
import { normalizeEmail, properCase, properCaseAddress } from "@/lib/proper-case";
import { attributeGiftToEvent, findEventsNearDate, type NearbyEvent } from "@/lib/gift-events";
import { findGiftsOnOtherContacts, type OtherContactGift } from "@/lib/donation-dupes";
import { friendlyDbError } from "@/lib/db-errors";
import { createFindOutWhoTask, findHouseholdAtAddress, nameFromAddress } from "@/lib/address-household";

type DialogProps = { open: boolean; onOpenChange: (v: boolean) => void };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

function usePeopleMini() {
  return useQuery({
    queryKey: ["people-mini"],
    queryFn: () =>
      fetchAll((f, t) =>
        supabase
          .from("people")
          .select("id, display_name, first_name, last_name, contact_type, lifetime_giving, this_year_giving")
          .order("display_name")
          .order("id")
          .range(f, t),
      ),
  });
}

function useHouseholdsMini() {
  return useQuery({
    queryKey: ["households-mini"],
    queryFn: () =>
      fetchAll((f, t) => supabase.from("households").select("id, name, address").order("name").order("id").range(f, t)),
  });
}

export function useMetSourceOptions() {
  return useQuery({
    queryKey: ["met-source-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("met_source_options").select("id, label").order("label");
      if (error) throw error;
      return data;
    },
  });
}

export function useProgramOptions() {
  return useQuery({
    queryKey: ["program-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("program_options").select("id, label").order("label");
      if (error) throw error;
      return data;
    },
  });
}

/* ------------------------------------------------------------------ person */

const EMPTY_PERSON = {
  first_name: "",
  last_name: "",
  contact_type: "individual",
  org_name: "",
  parent_org_id: "",
  phone: "",
  email: "",
  met_source: "",
  met_date: "",
  household_id: "",
  new_household: "",
  address: "",
  birth_date: "",
  role: "Adult",
  programs: "",
  tags: "",
  owner: "",
  notes: "",
};

export function AddPersonDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_PERSON);
  const [phones, setPhones] = useState<MethodDraft[]>([emptyDraft("phone", true)]);
  const [emails, setEmails] = useState<MethodDraft[]>([emptyDraft("email", true)]);
  const [newSource, setNewSource] = useState("");
  const [showNewSource, setShowNewSource] = useState(false);
  const [saveAnyway, setSaveAnyway] = useState(false);
  const set = (k: keyof typeof EMPTY_PERSON, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: households } = useHouseholdsMini();
  const { data: metSources } = useMetSourceOptions();
  const hebrew = hebrewDateFromEnglish(form.birth_date);
  const isOrg = form.contact_type !== "individual";

  // If we already have this address on file, offer to join that household instead of making a second one.
  const { data: addressMatch } = useQuery({
    queryKey: ["household-at-address", form.address.trim()],
    enabled: form.address.trim().length > 5,
    queryFn: () => findHouseholdAtAddress(form.address.trim()),
  });
  const suggestHousehold = addressMatch && !form.household_id && !form.new_household.trim() ? addressMatch : null;

  const enteredPhones = phones.map((p) => p.value.trim()).filter(Boolean);
  const enteredEmails = emails.map((e) => normalizeEmail(e.value)).filter(Boolean);

  // Duplicate guard: every number and address entered is checked, not just the first.
  const dupName = isOrg ? form.org_name.trim() : `${form.first_name.trim()} ${form.last_name.trim()}`.trim();
  const { data: duplicates } = useQuery({
    queryKey: ["duplicate-check", enteredEmails.join(","), enteredPhones.join(","), dupName],
    enabled: enteredEmails.length > 0 || enteredPhones.length > 0 || dupName.length > 2,
    queryFn: async () => {
      const filters: string[] = [];
      for (const e of enteredEmails) if (e.length > 3) filters.push(`email.ilike.${e}`);
      for (const p of enteredPhones) {
        const key = phoneKey(p);
        if (key) filters.push(`phone.ilike.%${key.slice(-7)}%`);
      }
      if (dupName.length > 2) filters.push(`display_name.ilike.${dupName}`);

      type Hit = {
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
      };
      const found = new Map<string, Hit>();

      if (filters.length) {
        const { data, error } = await supabase
          .from("people")
          .select("id, display_name, first_name, last_name, email, phone")
          .is("deleted_at", null)
          .or(filters.join(","))
          .limit(5);
        if (error) throw error;
        for (const row of data ?? []) found.set(row.id, row);
      }

      // Also look through every stored phone number and email address.
      const methodFilters: string[] = [];
      for (const e of enteredEmails) if (e.length > 3) methodFilters.push(`value.ilike.${e}`);
      for (const p of enteredPhones) {
        const key = phoneKey(p);
        if (key) methodFilters.push(`value.ilike.%${key.slice(-7)}%`);
      }
      if (methodFilters.length) {
        const { data } = await supabase
          .from("contact_methods")
          .select("people(id, display_name, first_name, last_name, email, phone)")
          .or(methodFilters.join(","))
          .limit(10);
        for (const row of data ?? []) {
          const person = row.people as Hit | null;
          if (person && !found.has(person.id)) found.set(person.id, person);
        }
      }
      return [...found.values()].slice(0, 5);
    },
  });

  const addSource = useMutation({
    mutationFn: async (label: string) => {
      const { data, error } = await supabase
        .from("met_source_options")
        .insert({ label: label.trim() })
        .select("label")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["met-source-options"] });
      set("met_source", row.label);
      setNewSource("");
      setShowNewSource(false);
      toast.success("Saved for future use");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isOrg) {
        if (!form.org_name.trim()) throw new Error("An organization name is required");
      } else if (!form.first_name.trim() && !form.last_name.trim()) {
        throw new Error("A name is required");
      }

      let householdId = form.household_id || null;
      const address = properCaseAddress(form.address);
      if (form.new_household.trim()) {
        const { data, error } = await supabase
          .from("households")
          .insert({
            name: properCase(form.new_household),
            address: address || null,
            phone: enteredPhones[0] ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        householdId = data.id;
      } else if (householdId && address) {
        await supabase.from("households").update({ address }).eq("id", householdId);
      }

      const list = (value: string) =>
        value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

      const { data: person, error } = await supabase
        .from("people")
        .insert({
          contact_type: form.contact_type,
          display_name: isOrg ? properCase(form.org_name) : null,
          first_name: isOrg ? null : properCase(form.first_name) || null,
          last_name: isOrg ? null : properCase(form.last_name) || null,
          parent_org_id: form.parent_org_id || null,
          phone: enteredPhones[0] ?? null,
          email: enteredEmails[0] ?? null,
          met_source: form.met_source || null,
          met_date: form.met_date || todayISO(),
          household_id: householdId,
          birth_date: form.birth_date || null,
          role: form.role,
          programs: list(form.programs),
          tags: list(form.tags),
          owner: form.owner.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Every phone number and email address entered is saved to the contact.
      // A household that was address-only now has someone in it.
      if (householdId) {
        await supabase.from("households").update({ status: "active" }).eq("id", householdId).eq("status", "address_only");
      }
      const drafts: MethodDraft[] = [
        ...phones.filter((p) => p.value.trim()).map((p, i) => ({ ...p, is_primary: i === 0 })),
        ...emails.filter((e) => e.value.trim()).map((e, i) => ({ ...e, is_primary: i === 0 })),
      ];
      if (drafts.length) await addContactMethods(person.id, drafts, { existing: [] });

      const source = form.met_source || "Manual entry";
      const recorded = form.met_date || todayISO();
      const provided: Record<"phone" | "email" | "address", boolean> = {
        phone: enteredPhones.length > 0,
        email: enteredEmails.length > 0,
        address: Boolean(address),
      };
      const sourceRows = (["phone", "email", "address"] as const)
        .filter((f) => provided[f])
        .map((field_name) => ({ person_id: person.id, field_name, source, recorded_date: recorded }));
      if (sourceRows.length) await supabase.from("field_sources").insert(sourceRows);

      if (form.notes.trim()) {
        await supabase.from("interactions").insert({
          person_id: person.id,
          type: "note",
          date: todayISO(),
          text: form.notes.trim(),
          author: form.owner.trim() || null,
        });
      }
    },
    onSuccess: () => {
      toast.success("Person added");
      logChange("Added a person");
      refresh();
      setForm(EMPTY_PERSON);
      setPhones([emptyDraft("phone", true)]);
      setEmails([emptyDraft("email", true)]);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add person"
      description="Only a name is required — everything else can come later."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl sm:flex-none"
            onClick={() => save.mutate()}
            disabled={save.isPending || ((duplicates ?? []).length > 0 && !saveAnyway)}
          >
            {(duplicates ?? []).length > 0 && !saveAnyway ? "Check the match above" : "Save person"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(duplicates ?? []).length > 0 && (
          <div className="rounded-xl border border-suggestion/50 bg-suggestion/15 p-3 text-sm sm:col-span-2">
            <p className="font-medium text-foreground">This may already be in the CRM</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {(duplicates ?? []).map((d) => (
                <li key={d.id}>
                  {personName(d)} · {d.email ?? (formatPhone(d.phone) || "no contact info")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              Check the existing record first so you do not create a duplicate.
            </p>
            <label className="mt-2 flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={saveAnyway}
                onChange={(e) => setSaveAnyway(e.target.checked)}
              />
              This is a different person — save it anyway
            </label>
          </div>
        )}
        <Field label="Contact type" className="sm:col-span-2">
          <select value={form.contact_type} onChange={(e) => set("contact_type", e.target.value)} className={selectClass}>
            <option value="individual">Individual</option>
            <option value="organization">Organization</option>
            <option value="foundation">Foundation</option>
          </select>
        </Field>
        {isOrg ? (
          <Field label="Organization name" className="sm:col-span-2">
            <Input className="text-base" value={form.org_name} onChange={(e) => set("org_name", e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="First name">
              <Input className="text-base" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
            </Field>
            <Field label="Last name">
              <Input className="text-base" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </Field>
            <ContactPicker
              label="Works for (organization or foundation)"
              className="sm:col-span-2"
              types={["foundation", "organization"]}
              value={form.parent_org_id}
              onChange={(id) => set("parent_org_id", id)}
              emptyLabel="Not linked"
              newLabel="New organization"
            />
          </>
        )}
        <div className="sm:col-span-2">
          <MethodDraftList kind="phone" drafts={phones} onChange={setPhones} />
        </div>
        <div className="sm:col-span-2">
          <MethodDraftList kind="email" drafts={emails} onChange={setEmails} />
        </div>

        <Field label="Where did we meet them?" className="sm:col-span-2">
          <div className="flex gap-2">
            <select value={form.met_source} onChange={(e) => set("met_source", e.target.value)} className={selectClass}>
              <option value="">Not sure yet</option>
              {(metSources ?? []).map((m) => (
                <option key={m.id} value={m.label}>
                  {m.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-xl"
              onClick={() => setShowNewSource((s) => !s)}
            >
              <Plus className="size-4" /> New
            </Button>
          </div>
          {showNewSource && (
            <div className="mt-2 flex gap-2">
              <Input
                className="text-base"
                placeholder="e.g. Farmers market"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
              />
              <Button
                type="button"
                className="shrink-0 rounded-xl"
                onClick={() => newSource.trim() && addSource.mutate(newSource)}
                disabled={addSource.isPending}
              >
                <Check className="size-4" /> Save option
              </Button>
            </div>
          )}
        </Field>

        <Field label="Date met">
          <Input className="text-base" type="date" value={form.met_date} onChange={(e) => set("met_date", e.target.value)} />
        </Field>
        <Field label="Adult or child">
          <select value={form.role} onChange={(e) => set("role", e.target.value)} className={selectClass}>
            <option value="Adult">Adult</option>
            <option value="Child">Child</option>
          </select>
        </Field>

        <Field label="Household">
          <select
            value={form.household_id}
            onChange={(e) => set("household_id", e.target.value)}
            className={selectClass}
            disabled={!!form.new_household.trim()}
          >
            <option value="">No household</option>
            {(households ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Or create a new household">
          <Input
            className="text-base"
            placeholder="e.g. The Cohen Family"
            value={form.new_household}
            onChange={(e) => set("new_household", e.target.value)}
          />
        </Field>

        <Field label="Address" className="sm:col-span-2">
          <Input className="text-base" value={form.address} onChange={(e) => set("address", e.target.value)} />
          {suggestHousehold && (
            <div className="mt-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="text-foreground">
                There's already a household at this address:{" "}
                <span className="font-semibold">{suggestHousehold.name}</span>
                {suggestHousehold.status === "address_only" ? " (address only — no contact yet)" : ""}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 rounded-xl"
                onClick={() => set("household_id", suggestHousehold.id)}
              >
                Add this person to it
              </Button>
            </div>
          )}
        </Field>

        <Field label="Birthday" hint={hebrew ? `Hebrew date: ${hebrew}` : null} className="sm:col-span-2">
          <Input className="text-base" type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
        </Field>

        <Field label="Programs (comma separated)">
          <Input className="text-base" value={form.programs} onChange={(e) => set("programs", e.target.value)} />
        </Field>
        <Field label="Tags (comma separated)">
          <Input className="text-base" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        <Field label="Owner" className="sm:col-span-2">
          <Input className="text-base" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* --------------------------------------------------------------- household */

export function AddHouseholdDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const [form, setForm] = useState({ name: "", address: "", phone: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const address = form.address.trim();
      const name = form.name.trim();
      if (!name && !address) throw new Error("Enter a household name or an address");

      if (address) {
        const existing = await findHouseholdAtAddress(address);
        if (existing) throw new Error(`There's already a household at this address: ${existing.name}`);
      }

      // No family name yet? It becomes an address-only household with a follow-up task.
      const addressOnly = !name;
      const { error } = await supabase.from("households").insert({
        name: name || nameFromAddress(address),
        address: address || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        status: addressOnly ? "address_only" : "active",
      });
      if (error) throw error;
      if (addressOnly) await createFindOutWhoTask(address);
    },
    onSuccess: () => {
      toast.success("Household added");
      logChange("Added a household");
      refresh();
      setForm({ name: "", address: "", phone: "", notes: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add household"
      description="An address on its own is enough — the family name can come later."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save household
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Household name (optional)">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Address">
          <Input className="text-base" value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input className="text-base" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ---------------------------------------------------------------- donation */

export function AddDonationDialog({
  open,
  onOpenChange,
  personId,
}: DialogProps & { personId?: string }) {
  const refresh = useRefresh();
  const { data: people } = usePeopleMini();
  const [form, setForm] = useState({
    person_id: personId ?? "",
    amount: "",
    date: todayISO(),
    campaign_id: "",
    grant_id: "",
    method: "",
    source: "",
    notes: "",
  });
  // Both start unchecked: a gift is not thanked until someone says so.
  const [thankYouSent, setThankYouSent] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  /** Events on or next to the gift's date — asked about once, before saving. */
  const [nearby, setNearby] = useState<NearbyEvent[] | null>(null);
  const [linkEventId, setLinkEventId] = useState("");
  const [attended, setAttended] = useState<"yes" | "sponsor" | "unsure">("yes");
  /** The same amount on the same day, already recorded against another contact. */
  const [elsewhere, setElsewhere] = useState<OtherContactGift[] | null>(null);
  const [elsewhereOk, setElsewhereOk] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pickOther, setPickOther] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-picker"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: grants } = useQuery({
    queryKey: ["grants-picker"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grants").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: allEvents } = useQuery({
    queryKey: ["events-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .is("deleted_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const campaignName = (campaigns ?? []).find((c) => c.id === form.campaign_id)?.name ?? "";

  const save = useMutation({
    mutationFn: async (link: { eventId: string; attended: boolean } | null) => {
      const pid = personId ?? form.person_id;
      const amount = Number(form.amount);
      if (!pid) throw new Error("Pick a donor");
      if (!amount || amount <= 0) throw new Error("Enter an amount");

      const { data: gift, error } = await supabase
        .from("donations")
        .insert({
        person_id: pid,
        amount,
        date: form.date || todayISO(),
        campaign_id: form.campaign_id || null,
        campaign: campaignName || null,
        grant_id: form.grant_id || null,
        method: form.method.trim() || null,
        source: form.source.trim() || null,
        notes: form.notes.trim() || null,
          thank_you_sent: thankYouSent,
          thank_you_sent_date: thankYouSent ? todayISO() : null,
          receipt_sent: receiptSent,
          receipt_sent_date: receiptSent ? todayISO() : null,
        })
        .select("id, people(display_name, first_name, last_name)")
        .single();
      if (error) throw error;

      // Attribute the gift to the event, and only record attendance when staff said yes.
      if (link && gift?.id) {
        await attributeGiftToEvent({
          donationId: gift.id,
          personId: pid,
          eventId: link.eventId,
          attended: link.attended,
        });
      }

      // Giving totals and last-activity are maintained by database triggers on
      // donations and interactions, so they stay correct for form, import and API writes.
      // The gift's timeline entry is written by the database and tied to the gift,
      // so archiving or deleting the gift takes the entry away with it.

      // No thank-you yet? Put a dated reminder on the task list so it can't slip.
      if (!thankYouSent && gift?.id) {
        const due = new Date();
        due.setDate(due.getDate() + 7);
        await supabase.from("tasks").insert({
          person_id: pid,
          donation_id: gift.id,
          text: `Send thank-you letter for ${personName(gift.people)}'s $${amount.toLocaleString()} gift`,
          due_date: due.toISOString().slice(0, 10),
          priority: "Normal",
          status: "upcoming",
        });
      }
    },
    onSuccess: () => {
      toast.success("Donation logged");
      logChange("Logged a donation");
      refresh();
      setForm({ person_id: personId ?? "", amount: "", date: todayISO(), campaign_id: "", grant_id: "", method: "", source: "", notes: "" });
      setThankYouSent(false);
      setReceiptSent(false);
      setNearby(null);
      setLinkEventId("");
      setAttended("yes");
      setPickOther(false);
      setElsewhere(null);
      setElsewhereOk(false);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      void friendlyDbError(e, "That donation didn't save.").then((why) => toast.error(why));
    },
  });

  /**
   * One lightweight question before saving: was this gift given at the event
   * that happened on this date? Dismissing it saves the gift unlinked.
   */
  async function handleSave() {
    // Duplicate protection that doesn't rely on the donor being matched right:
    // the same amount on the same day against a different contact is usually the
    // same gift landing on a second record.
    if (!elsewhereOk) {
      const amount = Number(form.amount);
      if (Number.isFinite(amount) && amount > 0) {
        setChecking(true);
        const found = await findGiftsOnOtherContacts(amount, form.date || todayISO(), [
          personId ?? form.person_id,
        ]);
        setChecking(false);
        if (found.length > 0) {
          setElsewhere(found);
          return;
        }
      }
      setElsewhereOk(true);
    }
    if (nearby === null) {
      setChecking(true);
      const found = await findEventsNearDate(form.date || todayISO());
      setChecking(false);
      if (found.length > 0) {
        setNearby(found);
        setLinkEventId(found[0]!.id);
        setAttended("yes");
        return;
      }
      setNearby([]);
    }
    save.mutate(null);
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log donation"
      description="Gifts always attach to a person, never to a household."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {nearby && nearby.length > 0 ? (
            <>
              <Button
                variant="outline"
                className="flex-1 rounded-xl sm:flex-none"
                disabled={save.isPending}
                onClick={() => save.mutate(null)}
              >
                No, it's unrelated
              </Button>
              <Button
                className="flex-1 rounded-xl sm:flex-none"
                disabled={save.isPending || !linkEventId}
                onClick={() => save.mutate({ eventId: linkEventId, attended: attended === "yes" })}
              >
                Yes, link it
              </Button>
            </>
          ) : elsewhere && elsewhere.length > 0 ? (
            <Button
              className="flex-1 rounded-xl sm:flex-none"
              disabled={save.isPending || checking}
              onClick={() => {
                setElsewhereOk(true);
                setElsewhere(null);
                void handleSave();
              }}
            >
              It's a different gift — save it
            </Button>
          ) : (
            <Button
              className="flex-1 rounded-xl sm:flex-none"
              onClick={() => void handleSave()}
              disabled={save.isPending || checking}
            >
              {checking ? "Checking…" : "Save donation"}
            </Button>
          )}
        </>
      }
    >
      {elsewhere && elsewhere.length > 0 && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-foreground">
            A ${Number(form.amount).toLocaleString()} gift on {form.date || todayISO()} is already recorded for{" "}
            {elsewhere.map((g) => g.name).join(", ")}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            If that's the same gift, this contact may be a duplicate of theirs — close this and merge the two contacts
            instead. If it's genuinely a separate gift, save it.
          </p>
        </div>
      )}
      {nearby && nearby.length > 0 && (
        <div className="mb-4 rounded-xl border border-suggestion/40 bg-suggestion/10 p-3">
          <p className="text-sm font-medium text-foreground">
            {nearby.length === 1
              ? `There was an event on this date: ${nearby[0]!.name}. Was this gift given at that event?`
              : "There were events around this date. Was this gift given at one of them?"}
          </p>
          {(nearby.length > 1 || pickOther) && (
            <select
              className={`${selectClass} mt-2`}
              value={linkEventId}
              onChange={(e) => setLinkEventId(e.target.value)}
            >
              {(pickOther ? (allEvents ?? []) : nearby).map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.date})
                </option>
              ))}
            </select>
          )}
          {!pickOther && (
            <button
              type="button"
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => setPickOther(true)}
            >
              Choose a different event
            </button>
          )}
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Did they attend?</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(
                [
                  ["yes", "Yes"],
                  ["sponsor", "No, just sponsored"],
                  ["unsure", "Not sure"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    attended === key ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"
                  }`}
                  onClick={() => setAttended(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              We only add them to the attendance list when you pick Yes.
            </p>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!personId && (
          <Field label="Donor" className="sm:col-span-2">
            <select value={form.person_id} onChange={(e) => set("person_id", e.target.value)} className={selectClass}>
              <option value="">Choose a person</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Amount">
          <Input
            className="text-base"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label="Date">
          <Input
            className="text-base"
            type="date"
            value={form.date}
            onChange={(e) => {
              set("date", e.target.value);
              // A new date means a new question — ask again about events on that day.
              setNearby(null);
              setLinkEventId("");
              setPickOther(false);
            }}
          />
        </Field>
        <Field label="Campaign">
          <select value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} className={selectClass}>
            <option value="">No campaign</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Grant payment (optional)" className="sm:col-span-2">
          <select value={form.grant_id} onChange={(e) => set("grant_id", e.target.value)} className={selectClass}>
            <option value="">Not a grant payment</option>
            {(grants ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Method">
          <Input className="text-base" placeholder="Check, card, cash…" value={form.method} onChange={(e) => set("method", e.target.value)} />
        </Field>
        <Field label="Source">
          <Input className="text-base" placeholder="Donorbox, Stripe, manual…" value={form.source} onChange={(e) => set("source", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="rounded-xl border border-border p-3 sm:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={thankYouSent}
              onChange={(e) => setThankYouSent(e.target.checked)}
            />
            Thank-you letter already sent
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={receiptSent}
              onChange={(e) => setReceiptSent(e.target.checked)}
            />
            Tax receipt already sent
          </label>
          {!thankYouSent && (
            <p className="mt-2 text-xs text-muted-foreground">
              A task to send the thank-you letter will be added, due in 7 days.
            </p>
          )}
        </div>
      </div>
    </ResponsiveModal>
  );
}

/* ------------------------------------------------------------------- event */

export function AddEventDialog({ open, onOpenChange }: DialogProps) {
  const refresh = useRefresh();
  const { data: programOptions } = useProgramOptions();
  const [newProgram, setNewProgram] = useState(false);
  const [form, setForm] = useState({
    name: "",
    date: todayISO(),
    time: "",
    location: "",
    program: "",
    capacity: "",
    staff_lead: "",
    description: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("An event name is required");
      const program = form.program.trim();
      if (program && !(programOptions ?? []).some((o) => o.label === program)) {
        await supabase.from("program_options").insert({ label: program });
      }
      const { error } = await supabase.from("events").insert({
        name: form.name.trim(),
        date: form.date || todayISO(),
        time: form.time || null,
        location: form.location.trim() || null,
        program: program || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        staff_lead: form.staff_lead.trim() || null,
        description: form.description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event added");
      logChange("Added an event");
      refresh();
      setForm({ name: "", date: todayISO(), time: "", location: "", program: "", capacity: "", staff_lead: "", description: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add event"
      description="Programs are a property of the event."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save event
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Event name" className="sm:col-span-2">
          <Input className="text-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Date">
          <Input className="text-base" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Time">
          <Input className="text-base" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
        </Field>
        <Field label="Location">
          <Input className="text-base" value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
        <Field label="Program / event type">
          {newProgram ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                className="text-base"
                placeholder="New program name"
                value={form.program}
                onChange={(e) => set("program", e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setNewProgram(false);
                  set("program", "");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                className={selectClass}
                value={form.program}
                onChange={(e) => set("program", e.target.value)}
              >
                <option value="">No program</option>
                {(programOptions ?? []).map((o) => (
                  <option key={o.id} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 rounded-xl"
                onClick={() => {
                  setNewProgram(true);
                  set("program", "");
                }}
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
          )}
        </Field>
        <Field label="Capacity">
          <Input className="text-base" type="number" inputMode="numeric" min="0" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
        </Field>
        <Field label="Staff lead">
          <Input className="text-base" value={form.staff_lead} onChange={(e) => set("staff_lead", e.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* -------------------------------------------------------------------- task */

export function AddTaskDialog({ open, onOpenChange, personId }: DialogProps & { personId?: string }) {
  const refresh = useRefresh();
  const { data: people } = usePeopleMini();
  const [form, setForm] = useState({
    person_id: personId ?? "",
    text: "",
    due_date: "",
    priority: "Normal",
    owner: "",
    notes: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.text.trim()) throw new Error("Describe the task");
      const due = form.due_date || null;
      const overdue = !!due && due < todayISO();
      const { error } = await supabase.from("tasks").insert({
        person_id: personId ?? (form.person_id || null),
        text: form.text.trim(),
        due_date: due,
        priority: form.priority,
        owner: form.owner.trim() || null,
        notes: form.notes.trim() || null,
        status: overdue ? "overdue" : "upcoming",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task added");
      logChange("Added a task");
      refresh();
      setForm({ person_id: personId ?? "", text: "", due_date: "", priority: "Normal", owner: "", notes: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add task"
      description="Anything dated in the past is marked overdue automatically."
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Save task
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!personId && (
          <Field label="Person" className="sm:col-span-2">
            <select value={form.person_id} onChange={(e) => set("person_id", e.target.value)} className={selectClass}>
              <option value="">No specific person</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="What needs doing?" className="sm:col-span-2">
          <Input className="text-base" value={form.text} onChange={(e) => set("text", e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input className="text-base" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => set("priority", e.target.value)} className={selectClass}>
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
          </select>
        </Field>
        <Field label="Assignee" className="sm:col-span-2">
          <Input className="text-base" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea className="text-base" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* ----------------------------------------------------------- complete task */

export type CompletableTask = {
  id: string;
  text: string;
  person_id?: string | null;
  owner?: string | null;
};

export function CompleteTaskDialog({
  task,
  onOpenChange,
}: {
  task: CompletableTask | null;
  onOpenChange: (v: boolean) => void;
}) {
  const refresh = useRefresh();
  const [kind, setKind] = useState<"note" | "call" | "meeting">("note");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!task) return;
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", completion_note: note.trim() || null, completed_at: new Date().toISOString() })
        .eq("id", task.id);
      if (error) throw error;

      if (task.person_id) {
        await supabase.from("interactions").insert({
          person_id: task.person_id,
          type: kind === "meeting" ? "note" : kind,
          date: todayISO(),
          text: note.trim() ? `${task.text} — ${note.trim()}` : `Completed: ${task.text}`,
          author: task.owner ?? null,
          // Tied to the task, so reopening it removes this entry again.
          source_kind: "task_completion",
          source_id: task.id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Task completed");
      logChange("Completed a task");
      refresh();
      setNote("");
      setKind("note");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveModal
      open={!!task}
      onOpenChange={onOpenChange}
      title="Complete task"
      description={task?.text}
      footer={
        <>
          <Button variant="outline" className="flex-1 rounded-xl sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl sm:flex-none" onClick={() => save.mutate()} disabled={save.isPending}>
            Mark done
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="What kind of activity was this?">
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {(["note", "call", "meeting"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize ${
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Add a note (optional)">
          <Textarea className="text-base" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </ResponsiveModal>
  );
}

/* --------------------------------------------------------------- checkbox */

export function TaskCheckbox({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? "Completed" : "Mark task complete"}
      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition ${
        done ? "border-money bg-money text-white" : "border-border bg-card hover:border-primary"
      }`}
    >
      {done ? <Check className="size-3.5" /> : null}
    </button>
  );
}