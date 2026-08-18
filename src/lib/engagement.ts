/**
 * Relationship reminders derived from the ledger, not stored anywhere.
 *
 * Rules staff asked for:
 *  - Someone engaged with us and then went quiet for 2 months, 6 months, a year
 *  - A donor gave and then nothing for 6 months, then a year
 *  - A donor gave this week -> call to say thank you
 *  - A gift over $180 -> call about a month later to check in
 */

export type EngagementReminder = {
  key: string;
  personId: string;
  name: string;
  label: string;
  detail: string;
  priority: string;
  dueDate: string;
  sort: number;
};

const DAY = 86_400_000;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - then.getTime()) / DAY);
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function money(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export type ReminderPerson = {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_activity_date?: string | null;
  last_gift_date?: string | null;
};

export type ReminderDonation = {
  id: string;
  person_id: string;
  amount: number | string;
  date: string;
  campaign?: string | null;
  source?: string | null;
  people?: {
    id: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

/** Quiet-contact and lapsed-donor reminders, one per person at the longest gap reached. */
export function quietReminders(
  people: ReminderPerson[],
  nameOf: (p: ReminderPerson) => string,
  now = new Date(),
): EngagementReminder[] {
  const today = iso(now);
  const out: EngagementReminder[] = [];

  for (const p of people) {
    const gift = daysSince(p.last_gift_date, now);
    if (gift !== null && gift >= 180) {
      const year = gift >= 365;
      out.push({
        key: `lapsed-${year ? "365" : "180"}-${p.id}`,
        personId: p.id,
        name: nameOf(p),
        label: `Reach out — no gift in ${year ? "over a year" : "6 months"}`,
        detail: `Last gift was ${gift} days ago`,
        priority: year ? "High" : "Normal",
        dueDate: today,
        sort: 100000 - gift,
      });
      continue;
    }

    const quiet = daysSince(p.last_activity_date, now);
    if (quiet === null || quiet < 60) continue;
    const step = quiet >= 365 ? "a year" : quiet >= 180 ? "6 months" : "2 months";
    out.push({
      key: `quiet-${quiet >= 365 ? "365" : quiet >= 180 ? "180" : "60"}-${p.id}`,
      personId: p.id,
      name: nameOf(p),
      label: `Reach out — quiet for ${step}`,
      detail: `Last activity was ${quiet} days ago`,
      priority: quiet >= 365 ? "High" : "Normal",
      dueDate: today,
      sort: 100000 - quiet,
    });
  }

  return out;
}

/** Thank-you calls for gifts this week, plus check-ins a month after a gift over $180. */
export function giftReminders(
  donations: ReminderDonation[],
  nameOf: (p: NonNullable<ReminderDonation["people"]>) => string,
  now = new Date(),
): EngagementReminder[] {
  const today = iso(now);
  const weekStart = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    return iso(d);
  })();
  const out: EngagementReminder[] = [];

  for (const d of donations) {
    if (!d.people) continue;
    const amount = Number(d.amount) || 0;
    const days = daysSince(d.date, now);
    if (days === null) continue;
    const where = [d.source, d.campaign].filter(Boolean).join(" / ");

    if (d.date.slice(0, 10) >= weekStart) {
      out.push({
        key: `thanks-${d.id}`,
        personId: d.people.id,
        name: nameOf(d.people),
        label: "Call to say thank you",
        detail: `${money(amount)} gift${where ? ` · ${where}` : ""} on ${d.date.slice(0, 10)}`,
        priority: "High",
        dueDate: today,
        sort: -1000 + days,
      });
    }

    if (amount > 180 && days >= 28 && days <= 40) {
      out.push({
        key: `checkin-${d.id}`,
        personId: d.people.id,
        name: nameOf(d.people),
        label: "Check in a month after their gift",
        detail: `${money(amount)} gift${where ? ` · ${where}` : ""} on ${d.date.slice(0, 10)}`,
        priority: "Normal",
        dueDate: today,
        sort: -500 + days,
      });
    }
  }

  return out;
}
