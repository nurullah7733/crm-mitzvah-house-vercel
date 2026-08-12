import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, currency, formatDate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/people/$personId")({
  head: () => ({
    meta: [
      { title: "Person profile | Mitzvah House CRM" },
      { name: "description", content: "One unified timeline of everything we know about this person." },
      { property: "og:title", content: "Person profile | Mitzvah House CRM" },
      { property: "og:description", content: "One unified timeline of everything we know about this person." },
    ],
  }),
  component: PersonPage,
});

const HEBREW_MONTHS = [
  "", "Nisan", "Iyyar", "Sivan", "Tammuz", "Av", "Elul", "Tishrei",
  "Cheshvan", "Kislev", "Tevet", "Shevat", "Adar", "Adar II",
];

function PersonPage() {
  const { personId } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["person", personId],
    queryFn: async () => {
      const [person, interactions, donations, tasks, yahrzeits, registrations, sources] = await Promise.all([
        supabase.from("people").select("*, households(id, name, address)").eq("id", personId).maybeSingle(),
        supabase.from("interactions").select("*").eq("person_id", personId).order("date", { ascending: false }),
        supabase.from("donations").select("*").eq("person_id", personId).order("date", { ascending: false }),
        supabase.from("tasks").select("*").eq("person_id", personId).order("due_date"),
        supabase.from("yahrzeits").select("*").eq("person_id", personId),
        supabase.from("registrations").select("status, events(id, name, date, program)").eq("person_id", personId),
        supabase.from("field_sources").select("*").eq("person_id", personId),
      ]);
      return {
        person: person.data,
        interactions: interactions.data ?? [],
        donations: donations.data ?? [],
        tasks: tasks.data ?? [],
        yahrzeits: yahrzeits.data ?? [],
        registrations: registrations.data ?? [],
        sources: sources.data ?? [],
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

  type Item = { key: string; date: string; kind: string; title: string; detail?: string | null };
  const timeline: Item[] = [
    ...(data?.interactions ?? []).map((i) => ({
      key: `i-${i.id}`,
      date: i.date,
      kind: i.type,
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
        key: `r-${r.events!.id}`,
        date: r.events!.date,
        kind: "event",
        title: `${r.events!.name} — ${r.status}`,
        detail: r.events!.program,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <AppShell
      title={`${p.first_name} ${p.last_name}`}
      subtitle={p.households?.name ?? "No household"}
      action={
        <Link
          to="/people"
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40"
        >
          <ArrowLeft className="size-4" /> People
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Lifetime giving" value={currency(p.lifetime_giving)} money />
        <Stat label="This year" value={currency(p.this_year_giving)} money={Number(p.this_year_giving) > 0} />
        <Stat label="Last gift" value={`${currency(p.last_gift_amount)} · ${formatDate(p.last_gift_date)}`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading font-semibold text-foreground">Timeline</h2>
          <p className="text-xs text-muted-foreground">Everything, newest first</p>
          <ol className="mt-4 space-y-4">
            {timeline.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            {timeline.map((item) => (
              <li key={item.key} className="flex gap-3">
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                    item.kind === "donation" ? "bg-money" : item.kind === "event" ? "bg-primary" : "bg-suggestion"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(item.date)} · {item.kind}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-5">
          <Card title="Contact">
            <Row label="Phone" value={p.phone} />
            <Row label="Email" value={p.email} />
            <Row label="Role" value={p.role} />
            <Row label="Birthday" value={formatDate(p.birth_date)} />
            <Row label="Owner" value={p.owner} />
            <Row label="Met at" value={p.met_source ? `${p.met_source} · ${formatDate(p.met_date)}` : null} />
            {p.households?.address && <Row label="Address" value={p.households.address} />}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[...(p.tags ?? []), ...(p.programs ?? [])].map((t) => (
                <Badge key={t} variant="secondary" className="rounded-full text-[11px] font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          </Card>

          <Card title="Open tasks">
            {(data?.tasks ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tasks.</p>}
            {(data?.tasks ?? []).map((t) => (
              <div key={t.id} className="border-b border-border py-2 last:border-0">
                <p className="text-sm text-foreground">{t.text}</p>
                <p className={`text-xs ${t.status === "overdue" ? "text-urgent" : "text-muted-foreground"}`}>
                  Due {formatDate(t.due_date)} · {t.status} · {t.owner ?? "Unassigned"}
                </p>
              </div>
            ))}
          </Card>

          <Card title="Yahrzeits">
            {(data?.yahrzeits ?? []).length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
            {(data?.yahrzeits ?? []).map((y) => (
              <div key={y.id} className="border-b border-border py-2 last:border-0">
                <p className="text-sm text-foreground">{y.deceased_name}</p>
                <p className="text-xs text-muted-foreground">
                  {y.relationship ?? "Relative"} · {HEBREW_MONTHS[y.hebrew_month] ?? y.hebrew_month} {y.hebrew_day}
                </p>
              </div>
            ))}
          </Card>

          <Card title="Where this data came from">
            {(data?.sources ?? []).length === 0 && <p className="text-sm text-muted-foreground">No sources recorded.</p>}
            {(data?.sources ?? []).map((s) => (
              <p key={s.id} className="py-1 text-xs text-muted-foreground">
                <span className="text-foreground">{s.field_name}</span> — {s.source}, {formatDate(s.recorded_date)}
              </p>
            ))}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-xl font-semibold ${money ? "text-money" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-heading font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value ?? "—"}</span>
    </div>
  );
}
