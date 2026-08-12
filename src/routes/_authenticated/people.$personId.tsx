import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, CalendarDays, FileText, HandCoins, Phone, StickyNote, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, daysSince, formatDate, initials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { MergeContactsDialog } from "@/components/MergeContactsDialog";
import { EditRecordDialog } from "@/components/forms/EditRecordDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HEBREW_MONTHS, hebrewDateFromEnglish, hebrewMonthName, nextBirthday, nextYahrzeit } from "@/lib/hebrew";
import { ChipEditor } from "@/components/ChipEditor";
import { personInitials, personName } from "@/lib/names";

export const Route = createFileRoute("/_authenticated/people/$personId")({
  head: () => ({
    meta: [
      { title: "Person profile | Mitzvah House CRM" },
      { name: "description", content: "One unified timeline of everything we know about this person." },
      { property: "og:title", content: "Person profile | Mitzvah House CRM" },
      { property: "og:description", content: "One unified timeline of everything we know about this person." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PersonPage,
});

const KIND_ICON: Record<string, { icon: typeof StickyNote; className: string }> = {
  donation: { icon: HandCoins, className: "bg-money/15 text-money" },
  event: { icon: CalendarDays, className: "bg-primary/10 text-primary" },
  call: { icon: Phone, className: "bg-suggestion/20 text-suggestion-foreground" },
  form: { icon: FileText, className: "bg-secondary text-secondary-foreground" },
  note: { icon: StickyNote, className: "bg-secondary text-secondary-foreground" },
  volunteer: { icon: CalendarDays, className: "bg-money/15 text-money" },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function PersonPage() {
  const { personId } = Route.useParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<null | "note" | "call" | "donation" | "event" | "yahrzeit">(null);
  const [showAllGifts, setShowAllGifts] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: options } = useQuery({
    queryKey: ["chip-options"],
    queryFn: async () => {
      const [tags, programs] = await Promise.all([
        supabase.from("tag_options").select("label").order("label"),
        supabase.from("program_options").select("label").order("label"),
      ]);
      return {
        tags: (tags.data ?? []).map((t) => t.label),
        programs: (programs.data ?? []).map((t) => t.label),
      };
    },
  });

  const saveChips = useMutation({
    mutationFn: async (patch: { tags?: string[]; programs?: string[] }) => {
      const { error } = await supabase.from("people").update(patch).eq("id", personId);
      if (error) throw error;
      const table = patch.tags ? "tag_options" : "program_options";
      const list = patch.tags ?? patch.programs ?? [];
      const known = (patch.tags ? options?.tags : options?.programs) ?? [];
      const fresh = list.filter((v) => !known.includes(v));
      if (fresh.length) await supabase.from(table).insert(fresh.map((label) => ({ label })));
    },
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["person", personId] });
      queryClient.invalidateQueries({ queryKey: ["chip-options"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["person", personId],
    queryFn: async () => {
      const [person, interactions, donations, tasks, yahrzeits, registrations, sources] = await Promise.all([
        supabase.from("people").select("*, households(id, name, address, billing_address, phone)").eq("id", personId).maybeSingle(),
        supabase.from("interactions").select("*").eq("person_id", personId).order("date", { ascending: false }),
        supabase
          .from("donations")
          .select("*, campaigns(id, name), grants(id, name)")
          .is("deleted_at", null)
          .eq("person_id", personId)
          .order("date", { ascending: false }),
        supabase.from("tasks").select("*").is("deleted_at", null).eq("person_id", personId).order("due_date"),
        supabase.from("yahrzeits").select("*").eq("person_id", personId),
        supabase.from("registrations").select("id, status, events(id, name, date, program)").eq("person_id", personId),
        supabase.from("field_sources").select("*").eq("person_id", personId),
      ]);
      const householdId = person.data?.household_id ?? null;
      const relatives = householdId
        ? await supabase
            .from("people")
            .select("id, first_name, last_name, display_name, role, phone, email")
            .eq("household_id", householdId)
            .neq("id", personId)
            .is("deleted_at", null)
            .order("role")
        : { data: [] };
      return {
        person: person.data,
        interactions: interactions.data ?? [],
        donations: donations.data ?? [],
        tasks: tasks.data ?? [],
        yahrzeits: yahrzeits.data ?? [],
        registrations: registrations.data ?? [],
        sources: sources.data ?? [],
        relatives: relatives.data ?? [],
      };
    },
  });

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <EmptyState label="Loading this person…" />
      </AppShell>
    );
  }
  const p = data?.person;
  if (!p) {
    return (
      <AppShell title="Not found">
        <EmptyState label="We couldn't find that person." />
      </AppShell>
    );
  }

  const sourceFor = (field: string) => {
    const s = (data?.sources ?? []).find((x) => x.field_name === field);
    return s ? `${s.source}, ${formatDate(s.recorded_date)}` : "Manual entry";
  };

  type Item = { key: string; date: string; kind: string; title: string; detail?: string | null };
  const timeline: Item[] = [
    ...(data?.interactions ?? []).map((i) => ({
      key: `i-${i.id}`,
      date: i.date,
      kind: i.type ?? "note",
      title: i.text ?? "(no text)",
      detail: i.author ? `Logged by ${i.author}` : null,
    })),
    ...(data?.donations ?? []).map((d) => ({
      key: `d-${d.id}`,
      date: d.date,
      kind: "donation",
      title: `${currency(d.amount)} — ${d.campaign ?? "General"}`,
      detail: [d.method, d.source].filter(Boolean).join(" · "),
    })),
    ...(data?.registrations ?? [])
      .filter((r) => r.events)
      .map((r) => ({
        key: `r-${r.id}`,
        date: r.events!.date,
        kind: "event",
        title: `${r.events!.name} — ${r.status}`,
        detail: r.events!.program,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const since = daysSince(p.last_activity_date);
  const bday = nextBirthday(p.birth_date);
  const anniversary = nextBirthday(p.anniversary_date);

  const gifts = data?.donations ?? [];
  const lifetime = gifts.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const currentYear = new Date().getFullYear();
  const thisYear = gifts
    .filter((d) => (d.date ?? "").slice(0, 4) === String(currentYear))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const giftSource = (d: (typeof gifts)[number]) =>
    [d.source, d.campaigns?.name ?? d.campaign, d.grants?.name, d.method].filter(Boolean).join(" / ") || "Manual entry";

  return (
    <AppShell
      title={personName(p)}
      subtitle={p.households?.name ?? "No household"}
      action={
        <>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
          >
            Edit contact
          </button>
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
          >
            Merge duplicate
          </button>
          <Link
            to="/people"
            search={{}}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
          >
            <ArrowLeft className="size-4" /> People
          </Link>
        </>
      }
    >
      <MergeContactsDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        primaryId={personId}
        onMerged={(survivingId) => {
          if (survivingId !== personId) navigate({ to: "/people/$personId", params: { personId: survivingId } });
        }}
      />
      <EditRecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        table="people"
        id={personId}
        record={p as unknown as Record<string, unknown>}
        title="Edit contact"
        deleteLabel="Remove this contact"
        onDeleted={() => navigate({ to: "/people", search: {} })}
        fields={[
          { key: "first_name", label: "First name" },
          { key: "last_name", label: "Last name" },
          { key: "display_name", label: "Name shown" },
          { key: "email", label: "Email", type: "email" },
          { key: "phone", label: "Phone", type: "tel" },
          { key: "birth_date", label: "Birth date", type: "date" },
          { key: "anniversary_date", label: "Anniversary", type: "date" },
          { key: "owner", label: "Owner" },
          { key: "met_source", label: "Where we met" },
          { key: "met_date", label: "Date we met", type: "date" },
          { key: "school", label: "School" },
          { key: "notes", label: "Notes", type: "textarea" },
        ]}
      />
      {/* Profile header */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 font-heading text-lg font-semibold text-primary">
            {personInitials(p)}
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-semibold">
              {personName(p)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {p.households ? (
                <Link to="/households" className="text-primary hover:underline">
                  {p.households.name}
                </Link>
              ) : (
                "No household"
              )}
              {" · "}
              {p.role ?? "Adult"}
              {" · "}
              {since === null ? "No activity yet" : `last activity: ${since} days ago`}
            </p>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
              <ChipEditor
                values={p.tags ?? []}
                options={options?.tags ?? []}
                emptyLabel="No tags yet."
                placeholder="New tag…"
                onChange={(next) => saveChips.mutate({ tags: next })}
              />
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Programs</p>
              <ChipEditor
                values={p.programs ?? []}
                options={options?.programs ?? []}
                tone="primary"
                emptyLabel="No programs yet."
                placeholder="New program…"
                onChange={(next) => saveChips.mutate({ programs: next })}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {/* Left column — contact and details */}
        <div className="order-1 space-y-5 md:col-start-1 md:row-start-1">
          <Card title="Contact info">
            <SourceRow label="Phone" value={p.phone} source={sourceFor("phone")} />
            <SourceRow label="Email" value={p.email} source={sourceFor("email")} />
            <SourceRow label="Address" value={p.households?.address} source={sourceFor("address")} />
          </Card>

          <Card title="Additional info">
            {p.households?.billing_address && p.households.billing_address !== p.households.address && (
              <SourceRow
                label="Billing address"
                value={p.households.billing_address}
                source={sourceFor("billing_address")}
              />
            )}
            <SourceRow label="School" value={p.school} source={sourceFor("school")} />
            <SourceRow label="Notes" value={p.notes} source={sourceFor("notes")} />
            <SourceRow
              label="How we met"
              value={p.met_source ? `${p.met_source} · ${formatDate(p.met_date)}` : null}
              source={sourceFor("met_source")}
            />
            <SourceRow label="Owner" value={p.owner} source={sourceFor("owner")} />
          </Card>

          <Card title="Giving">
            <Stat label="Lifetime" value={currency(lifetime)} money />
            <Stat label="This year" value={currency(thisYear)} money />
            <div className="pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {showAllGifts ? `All donations (${gifts.length})` : "Most recent donations"}
              </p>
              {gifts.length === 0 && <p className="text-sm text-muted-foreground">No donations yet.</p>}
              {(showAllGifts ? gifts : gifts.slice(0, 3)).map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{formatDate(d.date)}</p>
                    <p className="text-xs text-muted-foreground">{giftSource(d)}</p>
                  </div>
                  <p className="shrink-0 font-heading text-sm font-semibold text-money">{currency(d.amount)}</p>
                </div>
              ))}
              {gifts.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllGifts((s) => !s)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  {showAllGifts ? "Show less" : `Show all ${gifts.length} donations`}
                </button>
              )}
            </div>
          </Card>

          <Card
            title="Special dates"
            action={
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setDialog("yahrzeit")}>
                <Plus className="size-3.5" /> Add yahrzeit
              </Button>
            }
          >
            <div className="border-b border-border pb-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Birthday</p>
              {p.birth_date ? (
                <>
                  <p className="text-sm text-foreground">{formatDate(p.birth_date)}</p>
                  <p className="text-sm text-primary">{hebrewDateFromEnglish(p.birth_date)}</p>
                  {bday && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next birthday {formatDate(bday.date.toISOString())} — in {bday.days} days
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Source: {sourceFor("birth_date")}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No birthday on file.</p>
              )}
            </div>

            <div className="border-b border-border py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Anniversary</p>
              {p.anniversary_date ? (
                <>
                  <p className="text-sm text-foreground">{formatDate(p.anniversary_date)}</p>
                  <p className="text-sm text-primary">{hebrewDateFromEnglish(p.anniversary_date)}</p>
                  {anniversary && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next anniversary {formatDate(anniversary.date.toISOString())} — in {anniversary.days} days
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No anniversary on file.</p>
              )}
            </div>

            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Yahrzeits</p>
            {(data?.yahrzeits ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No yahrzeits recorded.</p>
            )}
            {(data?.yahrzeits ?? []).map((y) => {
              const next = nextYahrzeit(y.hebrew_month, y.hebrew_day);
              return (
                <div key={y.id} className="border-b border-border py-2 last:border-0">
                  <p className="text-sm text-foreground">{y.deceased_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {y.relationship ?? "Relative"} · {hebrewMonthName(y.hebrew_month)} {y.hebrew_day}
                  </p>
                  {next && (
                    <p className="text-xs text-primary">
                      next: in {next.days} days ({formatDate(next.date.toISOString())})
                    </p>
                  )}
                </div>
              );
            })}
          </Card>
        </div>

        {/* Activity — the other half of the page */}
        <section className="order-3 rounded-2xl border border-border bg-card p-5 shadow-sm md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <h2 className="font-heading font-semibold text-foreground">Activity</h2>
              <p className="text-xs text-muted-foreground">Everything in one feed, newest first</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setDialog("note")}>
              <Plus className="size-3.5" /> Note
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setDialog("call")}>
              <Plus className="size-3.5" /> Call
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setDialog("donation")}>
              <Plus className="size-3.5" /> Donation
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setDialog("event")}>
              <Plus className="size-3.5" /> Event
            </Button>
          </div>
          <ol className="mt-4 space-y-4">
            {timeline.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            {timeline.map((item) => {
              const meta = KIND_ICON[item.kind] ?? KIND_ICON["note"]!;
              const Icon = meta.icon;
              return (
                <li key={item.key} className="flex gap-3">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${meta.className}`}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.date)} · {item.kind}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Left column continued — tasks and programs */}
        <div className="order-2 space-y-5 md:col-start-1 md:row-start-2">
          <Card title="Open tasks">
            {(data?.tasks ?? []).filter((t) => t.status !== "done").length === 0 && (
              <p className="text-sm text-muted-foreground">No open tasks.</p>
            )}
            {(data?.tasks ?? [])
              .filter((t) => t.status !== "done")
              .map((t) => (
                <div key={t.id} className="border-b border-border py-2 last:border-0">
                  <p className="text-sm text-foreground">{t.text}</p>
                  <p className={`text-xs ${t.status === "overdue" ? "text-urgent" : "text-muted-foreground"}`}>
                    Due {formatDate(t.due_date)} · {t.owner ?? "Unassigned"}
                  </p>
                </div>
              ))}
          </Card>

        </div>
      </div>

      {/* Relatives — everyone else we have in this household */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-heading font-semibold text-foreground">Relatives</h2>
        <p className="text-xs text-muted-foreground">
          Other people we have in {p.households?.name ?? "this household"} — tap to open their profile
        </p>
        {(data?.relatives ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No relatives linked yet. Adding people to the same household links them here.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(data?.relatives ?? []).map((r) => (
              <Link
                key={r.id}
                to="/people/$personId"
                params={{ personId: r.id }}
                className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary/40"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-semibold text-primary">
                  {personInitials(r)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{personName(r)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[r.role ?? "Adult", r.phone, r.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <ActivityDialog kind={dialog} personId={personId} onClose={() => setDialog(null)} />
    </AppShell>
  );
}

function ActivityDialog({
  kind,
  personId,
  onClose,
}: {
  kind: null | "note" | "call" | "donation" | "event" | "yahrzeit";
  personId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [campaign, setCampaign] = useState("");
  const [eventId, setEventId] = useState("");
  const [deceased, setDeceased] = useState("");
  const [relationship, setRelationship] = useState("");
  const [hMonth, setHMonth] = useState("1");
  const [hDay, setHDay] = useState("1");

  const { data: events } = useQuery({
    queryKey: ["events-mini"],
    enabled: kind === "event",
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("id, name, date").order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (kind === "note" || kind === "call") {
        const { error } = await supabase.from("interactions").insert({
          person_id: personId,
          type: kind,
          date,
          text,
        });
        if (error) throw error;
      } else if (kind === "donation") {
        const { error } = await supabase.from("donations").insert({
          person_id: personId,
          amount: Number(amount),
          date,
          campaign: campaign || null,
          method: "Manual",
          source: "Manual entry",
        });
        if (error) throw error;
      } else if (kind === "event") {
        const { error } = await supabase
          .from("registrations")
          .insert({ person_id: personId, event_id: eventId, status: "attended" });
        if (error) throw error;
      } else if (kind === "yahrzeit") {
        const { error } = await supabase.from("yahrzeits").insert({
          person_id: personId,
          deceased_name: deceased,
          relationship: relationship || null,
          hebrew_month: Number(hMonth),
          hebrew_day: Number(hDay),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["person", personId] });
      setText("");
      setAmount("");
      setCampaign("");
      setDeceased("");
      setRelationship("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const titles: Record<string, string> = {
    note: "Add note",
    call: "Log a call",
    donation: "Add donation",
    event: "Record event attendance",
    yahrzeit: "Add yahrzeit",
  };

  const disabled =
    (kind === "note" || kind === "call" ? !text.trim() : false) ||
    (kind === "donation" ? !amount : false) ||
    (kind === "event" ? !eventId : false) ||
    (kind === "yahrzeit" ? !deceased.trim() : false) ||
    save.isPending;

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{kind ? titles[kind] : ""}</DialogTitle>
          <DialogDescription>This is added to the person's timeline right away.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(kind === "note" || kind === "call") && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input className="mt-1 text-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">What happened</Label>
                <Textarea className="mt-1 text-base" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            </>
          )}

          {kind === "donation" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input
                  className="mt-1 text-base"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input className="mt-1 text-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Campaign</Label>
                <Input className="mt-1 text-base" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
              </div>
            </>
          )}

          {kind === "event" && (
            <div>
              <Label className="text-xs text-muted-foreground">Event</Label>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-base"
              >
                <option value="">Choose an event</option>
                {(events ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {formatDate(e.date)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === "yahrzeit" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Name of deceased</Label>
                <Input className="mt-1 text-base" value={deceased} onChange={(e) => setDeceased(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Relationship</Label>
                <Input
                  className="mt-1 text-base"
                  placeholder="Father, mother, grandparent…"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Hebrew month</Label>
                  <select
                    value={hMonth}
                    onChange={(e) => setHMonth(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-base"
                  >
                    {HEBREW_MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Hebrew day</Label>
                  <Input
                    className="mt-1 text-base"
                    type="number"
                    min={1}
                    max={30}
                    value={hDay}
                    onChange={(e) => setHDay(e.target.value)}
                  />
                </div>
              </div>
              {(() => {
                const next = nextYahrzeit(Number(hMonth), Number(hDay));
                return next ? (
                  <p className="text-xs text-primary">
                    Next observance: {next.hebrew} — {formatDate(next.date.toISOString())} (in {next.days} days)
                  </p>
                ) : null;
              })()}
              <p className="text-xs text-muted-foreground">
                In a Hebrew leap year, an Adar yahrzeit is observed in Adar II.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-xl" disabled={disabled} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 className="truncate font-heading font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${money ? "text-money" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function SourceRow({ label, value, source }: { label: string; value?: string | null | undefined; source: string }) {
  return (
    <div className="border-b border-border py-2 last:border-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words text-sm text-foreground">{value ?? "—"}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{source}</p>
    </div>
  );
}
