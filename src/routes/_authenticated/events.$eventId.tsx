import { personInitials, personName } from "@/lib/names";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, formatDate, initials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/events/$eventId")({
  head: () => ({
    meta: [
      { title: "Event | Mitzvah House CRM" },
      { name: "description", content: "Attendees, registration status and suggested invitees for this event." },
      { property: "og:title", content: "Event | Mitzvah House CRM" },
      { property: "og:description", content: "Attendees, registration status and suggested invitees for this event." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EventPage,
});

const STATUSES = ["registered", "attended", "no_show"] as const;

function EventPage() {
  const { eventId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const { data: event, error } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
      if (error) throw error;
      const [registrations, people] = await Promise.all([
        fetchAll((f, t) =>
          supabase
            .from("registrations")
            .select("id, status, people(id, display_name, first_name, last_name, email, phone)")
            .eq("event_id", eventId)
            .order("id")
            .range(f, t),
        ),
        fetchAll((f, t) =>
          supabase
            .from("people")
            .select("id, display_name, first_name, last_name, programs, tags")
            .order("id")
            .range(f, t),
        ),
      ]);
      return { event, registrations, people };
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("registrations").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });

  const invite = useMutation({
    mutationFn: async (personId: string) => {
      const { error } = await supabase
        .from("registrations")
        .insert({ event_id: eventId, person_id: personId, status: "registered" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registered");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <AppShell title="Loading…">
        <EmptyState label="Loading this event…" />
      </AppShell>
    );
  }

  const e = data?.event;
  if (!e) {
    return (
      <AppShell title="Not found">
        <EmptyState label="That event no longer exists." />
      </AppShell>
    );
  }

  const registered = data?.registrations ?? [];
  const registeredIds = new Set(registered.map((r) => r.people?.id).filter(Boolean) as string[]);
  const suggested = (data?.people ?? []).filter(
    (p) =>
      !registeredIds.has(p.id) &&
      !!e.program &&
      [...(p.programs ?? []), ...(p.tags ?? [])].some((v) => v.toLowerCase() === e.program!.toLowerCase()),
  );

  return (
    <AppShell
      title={e.name}
      subtitle={`${formatDate(e.date)}${e.time ? ` · ${e.time}` : ""} · ${e.location ?? "Location TBD"}`}
    >
      <Link to="/events" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" /> All events
      </Link>

      <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        {e.program && <p className="text-xs text-primary">{e.program}</p>}
        <p className="mt-1 text-sm text-muted-foreground">
          {registered.length}
          {e.capacity ? ` / ${e.capacity}` : ""} registered
          {e.staff_lead ? ` · Lead: ${e.staff_lead}` : ""}
        </p>
        {e.description && <p className="mt-2 text-sm text-muted-foreground">{e.description}</p>}
      </section>

      <section className="mt-5">
        <h2 className="font-heading font-semibold text-foreground">Attendees</h2>
        <div className="mt-3 space-y-3">
          {registered.map((r) =>
            r.people ? (
              <div
                key={r.id}
                className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-xs font-semibold text-primary">
                    {personInitials(r.people)}
                  </span>
                  <div className="min-w-0">
                    <Link
                      to="/people/$personId"
                      params={{ personId: r.people.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {personName(r.people)}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.people.email ?? r.people.phone ?? "No contact on file"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 rounded-xl border border-border p-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus.mutate({ id: r.id, status: s })}
                      className={`rounded-lg px-3 py-1.5 text-xs capitalize ${
                        r.status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {s === "no_show" ? "No show" : s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          {registered.length === 0 && <EmptyState label="Nobody is registered yet." />}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-suggestion/40 bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-heading font-semibold text-foreground">
          <Sparkles className="size-4 text-suggestion" /> Suggested invitees
        </h2>
        <p className="text-xs text-muted-foreground">
          {e.program
            ? `People involved in ${e.program} who aren't registered yet.`
            : "Add a program to this event to get suggestions."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggested.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-1 rounded-full border border-border bg-card pl-1 pr-1"
            >
              <Link
                to="/people/$personId"
                params={{ personId: p.id }}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-foreground hover:text-primary"
              >
                {personName(p)}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-primary"
                onClick={() => invite.mutate(p.id)}
                disabled={invite.isPending}
                aria-label={`Register ${personName(p)}`}
                title="Register for this event"
              >
                <UserPlus className="size-4" />
              </Button>
            </div>
          ))}
          {suggested.length === 0 && <p className="text-sm text-muted-foreground">No suggestions right now.</p>}
        </div>
      </section>
    </AppShell>
  );
}