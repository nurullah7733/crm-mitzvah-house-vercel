import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, HandCoins, Phone, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, daysSince, formatDate, initials } from "@/components/AppShell";
import { EditableCard } from "@/components/EditableCard";
import { logChange } from "@/lib/session-log";

export const Route = createFileRoute("/_authenticated/households/$householdId")({
  head: () => ({
    meta: [
      { title: "Household | Mitzvah House CRM" },
      { name: "description", content: "Household mailing view with members, giving and a merged activity feed." },
      { property: "og:title", content: "Household | Mitzvah House CRM" },
      { property: "og:description", content: "Household mailing view with members, giving and a merged activity feed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HouseholdPage,
});

const ICONS: Record<string, typeof StickyNote> = {
  donation: HandCoins,
  event: CalendarDays,
  call: Phone,
  note: StickyNote,
};

function HouseholdPage() {
  const { householdId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["household", householdId],
    queryFn: async () => {
      const { data: household, error } = await supabase
        .from("households")
        .select("*, people(*)")
        .eq("id", householdId)
        .maybeSingle();
      if (error) throw error;
      const ids = (household?.people ?? []).map((p) => p.id);
      if (ids.length === 0) return { household, interactions: [], donations: [], tasks: [] };
      const [interactions, donations, tasks] = await Promise.all([
        supabase.from("interactions").select("*").in("person_id", ids).order("date", { ascending: false }),
        supabase.from("donations").select("*").is("deleted_at", null).in("person_id", ids).order("date", { ascending: false }),
        supabase.from("tasks").select("*").is("deleted_at", null).in("person_id", ids).neq("status", "done").order("due_date"),
      ]);
      return {
        household,
        interactions: interactions.data ?? [],
        donations: donations.data ?? [],
        tasks: tasks.data ?? [],
      };
    },
  });

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <EmptyState label="Loading this household…" />
      </AppShell>
    );
  }

  const h = data?.household;
  if (!h) {
    return (
      <AppShell title="Not found">
        <EmptyState label="That household no longer exists." />
      </AppShell>
    );
  }

  const members = h.people ?? [];
  const nameOf = (id: string) => {
    const m = members.find((p) => p.id === id);
    return m ? `${m.first_name} ${m.last_name}` : "Someone";
  };
  const lifetime = members.reduce((s, p) => s + Number(p.lifetime_giving ?? 0), 0);
  const thisYear = members.reduce((s, p) => s + Number(p.this_year_giving ?? 0), 0);

  async function saveHousehold(patch: Record<string, string | null>) {
    const { error } = await supabase.from("households").update(patch as never).eq("id", householdId);
    if (error) throw error;
    toast.success("Saved");
    logChange("Edited a household");
    await queryClient.invalidateQueries({ queryKey: ["household", householdId] });
    await queryClient.invalidateQueries({ queryKey: ["households"] });
  }

  const feed = [
    ...(data?.interactions ?? []).map((i) => ({
      id: `i-${i.id}`,
      date: i.date,
      kind: i.type,
      person_id: i.person_id,
      text: i.text ?? "",
    })),
    ...(data?.donations ?? []).map((d) => ({
      id: `d-${d.id}`,
      date: d.date,
      kind: "donation",
      person_id: d.person_id,
      text: `${currency(d.amount)} · ${d.campaign ?? "General"}`,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <AppShell title={h.name} subtitle={h.address ?? "No address on file"}>
      <Link to="/households" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" /> All households
      </Link>

      <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Combined lifetime giving</p>
            <p className="font-heading text-2xl font-semibold text-money">{currency(lifetime)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Combined this year</p>
            <p className="font-heading text-2xl font-semibold text-money">{currency(thisYear)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          These totals are a mailing view only — every gift stays attached to the individual who gave it.
        </p>
        {h.phone && <p className="mt-2 text-sm text-muted-foreground">Phone: {h.phone}</p>}
        {h.notes && <p className="mt-1 text-sm text-muted-foreground">{h.notes}</p>}
      </section>

      <EditableCard
        className="mt-5"
        title="Household details"
        values={h as unknown as Record<string, unknown>}
        fields={[
          { key: "name", label: "Household name", full: true },
          { key: "address", label: "Address", full: true },
          { key: "address_line2", label: "Address line 2" },
          { key: "address_line3", label: "Address line 3" },
          { key: "city", label: "City" },
          { key: "state", label: "State" },
          { key: "postal_code", label: "ZIP / postal code" },
          { key: "county", label: "County" },
          { key: "billing_address", label: "Billing address", full: true },
          { key: "phone", label: "Phone", type: "tel" },
          { key: "notes", label: "Notes", type: "textarea" },
        ]}
        onSave={saveHousehold}
        editHint="Used for mailings. Gifts always stay attached to the individual who gave them."
      >
        <div className="space-y-2 text-sm">
          {(
            [
              ["Address", h.address],
              ["Address line 2", h.address_line2],
              ["Address line 3", h.address_line3],
              ["City", h.city],
              ["State", h.state],
              ["ZIP / postal code", h.postal_code],
              ["County", h.county],
              ["Billing address", h.billing_address],
              ["Phone", h.phone],
              ["Notes", h.notes],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="grid gap-0.5 border-b border-border py-1.5 last:border-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="break-words text-sm text-foreground">{value ?? "—"}</p>
            </div>
          ))}
        </div>
      </EditableCard>

      <section className="mt-5">
        <h2 className="font-heading font-semibold text-foreground">Members</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {members.map((p) => (
            <Link
              key={p.id}
              to="/people/$personId"
              params={{ personId: p.id }}
              className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/50"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-sm font-semibold text-primary">
                {initials(p.first_name, p.last_name)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-heading font-semibold text-foreground">
                  {p.first_name} {p.last_name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{p.role}</span>
                </p>
                <p className="truncate text-sm text-muted-foreground">{p.email ?? p.phone ?? "No contact on file"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currency(p.lifetime_giving)} lifetime · {currency(p.this_year_giving)} this year
                </p>
                <p className="text-xs text-muted-foreground">
                  {daysSince(p.last_activity_date) === null
                    ? "No activity yet"
                    : `Last activity ${daysSince(p.last_activity_date)} days ago`}
                </p>
              </div>
            </Link>
          ))}
          {members.length === 0 && <EmptyState label="No one is in this household yet." />}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-heading font-semibold text-foreground">Open tasks across the household</h2>
        {(data?.tasks ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing open.</p>
        ) : (
          <div className="mt-2">
            {(data?.tasks ?? []).map((t) => (
              <div key={t.id} className="border-b border-border py-2.5 last:border-0">
                <p className="text-sm text-foreground">{t.text}</p>
                <p className="text-xs text-muted-foreground">
                  Due {formatDate(t.due_date)} · {t.person_id ? nameOf(t.person_id) : "Unassigned"}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-heading font-semibold text-foreground">Household activity</h2>
        <p className="text-xs text-muted-foreground">Every member's timeline, merged.</p>
        <div className="mt-3 space-y-3">
          {feed.map((f) => {
            const Icon = ICONS[f.kind] ?? StickyNote;
            return (
              <div key={f.id} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{f.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(f.date)} · {nameOf(f.person_id)} · {f.kind}
                  </p>
                </div>
              </div>
            );
          })}
          {feed.length === 0 && <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
        </div>
      </section>
    </AppShell>
  );
}