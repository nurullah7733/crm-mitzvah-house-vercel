import { Link } from "@tanstack/react-router";
import { currency, formatDate } from "@/components/AppShell";
import type { FullRecord } from "@/lib/review-record";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

/**
 * The whole contact we already have — every phone and email, the household and
 * who else lives there, giving, events, notes and labels — so the reviewer can
 * recognise the person on sight.
 */
export function ExistingRecordPanel({ record }: { record: FullRecord | null }) {
  if (!record)
    return <p className="text-sm text-muted-foreground">Loading the contact we already have…</p>;
  const p = record.person as Record<string, unknown>;

  return (
    <div className="space-y-2">
      <div>
        <p className="font-heading text-base font-semibold text-foreground">{record.name}</p>
        <Link
          to="/people/$personId"
          params={{ personId: record.person.id }}
          className="text-xs text-primary underline"
        >
          Open the full profile
        </Link>
      </div>

      <Row label="Phones">
        {record.phones.length === 0
          ? "—"
          : record.phones
              .map(
                (m) => `${m.value}${m.label ? ` (${m.label})` : ""}${m.primary ? " · main" : ""}`,
              )
              .join(", ")}
      </Row>
      <Row label="Emails">
        {record.emails.length === 0
          ? "—"
          : record.emails
              .map(
                (m) => `${m.value}${m.label ? ` (${m.label})` : ""}${m.primary ? " · main" : ""}`,
              )
              .join(", ")}
      </Row>
      <Row label="Address">{record.address || "—"}</Row>
      <Row label="Household">
        {record.household ? (
          <>
            <Link
              to="/households/$householdId"
              params={{ householdId: record.household.id }}
              className="text-primary underline"
            >
              {record.household.name}
            </Link>
            {record.householdMembers.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                — with{" "}
                {record.householdMembers
                  .map((m) => `${m.name}${m.relationship ? ` (${m.relationship})` : ""}`)
                  .join(", ")}
              </span>
            )}
          </>
        ) : (
          "Not in a household"
        )}
      </Row>
      <Row label="Birthday">{record.birthDate ? formatDate(record.birthDate) : "—"}</Row>
      <Row label="Giving">
        {record.giving.count === 0
          ? "No gifts on file"
          : `${currency(record.giving.lifetime)} across ${record.giving.count} gift${record.giving.count === 1 ? "" : "s"}${
              record.giving.lastDate
                ? ` · last ${currency(record.giving.lastAmount ?? 0)} on ${formatDate(record.giving.lastDate)}`
                : ""
            }`}
      </Row>
      {record.recentGifts.length > 0 && (
        <ul className="ml-24 space-y-0.5 text-xs text-muted-foreground">
          {record.recentGifts.map((g) => (
            <li key={g.id}>
              {formatDate(g.date)} · {currency(g.amount)}
              {g.campaign ? ` · ${g.campaign}` : ""}
            </li>
          ))}
        </ul>
      )}
      <Row label="Events">
        {record.events.length === 0
          ? "No event attendance yet"
          : record.events.map((e) => `${e.name} (${formatDate(e.date)})`).join(", ")}
      </Row>
      <Row label="Notes">
        {record.noteCount === 0 ? "—" : `${record.noteCount} on the timeline`}
      </Row>
      {record.notes.length > 0 && (
        <ul className="ml-24 space-y-0.5 text-xs text-muted-foreground">
          {record.notes.map((n) => (
            <li key={n.id} className="line-clamp-2">
              {formatDate(n.date)} · {n.text || n.type}
            </li>
          ))}
        </ul>
      )}
      <Row label="Tags">{record.tags.length ? record.tags.join(", ") : "—"}</Row>
      <Row label="Programs">{record.programs.length ? record.programs.join(", ") : "—"}</Row>
      <Row label="Where we met">{(p["met_source"] as string) || "—"}</Row>
      <Row label="Owner">{(p["owner"] as string) || "—"}</Row>
    </div>
  );
}
