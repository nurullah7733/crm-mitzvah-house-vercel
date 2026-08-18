import { supabase } from "@/integrations/supabase/client";
import type { EngagementReminder } from "@/lib/engagement";

/**
 * Pledges and recurring gifts: what a donor has *promised*, kept apart from the
 * money that has actually arrived. Payments stay in donations, linked back to
 * the pledge, so giving totals never count a gift twice.
 */

export type PledgeFrequency = "one_time" | "monthly" | "quarterly" | "annual";
export type PledgeStatus = "active" | "paused" | "completed" | "lapsed";

export type Pledge = {
  id: string;
  person_id: string;
  amount: number;
  frequency: PledgeFrequency;
  start_date: string;
  end_date: string | null;
  status: PledgeStatus;
  campaign_id: string | null;
  grace_days: number;
  notes: string | null;
  external_ref: string | null;
};

export const FREQUENCY_LABELS: Record<PledgeFrequency, string> = {
  one_time: "One-off pledge",
  monthly: "Every month",
  quarterly: "Every three months",
  annual: "Once a year",
};

export const FREQUENCY_SHORT: Record<PledgeFrequency, string> = {
  one_time: "one-off",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "yearly",
};

export const STATUS_LABELS: Record<PledgeStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Finished",
  lapsed: "Lapsed",
};

const MONTHS_PER: Record<PledgeFrequency, number> = {
  one_time: 0,
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/** What a recurring pledge is worth each month, so totals can be compared. */
export function monthlyEquivalent(p: {
  amount: number | string;
  frequency: PledgeFrequency;
}): number {
  const amount = Number(p.amount) || 0;
  const months = MONTHS_PER[p.frequency];
  return months === 0 ? 0 : amount / months;
}

/** A recurring pledge's promised value over a year. */
export function annualValue(p: { amount: number | string; frequency: PledgeFrequency }): number {
  return monthlyEquivalent(p) * 12;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** When the next payment is due, counting from the last one that arrived. */
export function nextExpectedDate(
  p: { frequency: PledgeFrequency; start_date: string },
  lastGiftDate: string | null,
): string | null {
  const months = MONTHS_PER[p.frequency];
  if (months === 0) return lastGiftDate ? null : p.start_date;
  return addMonths(lastGiftDate ?? p.start_date, months);
}

export type MissedPayment = {
  pledge_id: string;
  person_id: string;
  name: string;
  amount: number;
  frequency: PledgeFrequency;
  last_gift_date: string | null;
  expected_date: string;
  days_late: number;
};

/** Pledges whose expected payment hasn't arrived, straight from the database. */
export async function fetchMissedPledgePayments(): Promise<MissedPayment[]> {
  const { data, error } = await supabase.rpc("pledges_missing_payments");
  if (error) return [];
  return (data ?? []) as MissedPayment[];
}

/** Missed payments in the same shape as the other follow-up reminders. */
export function missedPledgeReminders(rows: MissedPayment[]): EngagementReminder[] {
  return rows.map((r) => ({
    key: `pledge-${r.pledge_id}-${r.expected_date}`,
    personId: r.person_id,
    name: r.name || "This donor",
    label: `Recurring gift missed — check in`,
    detail: `$${Number(r.amount).toLocaleString()} ${FREQUENCY_SHORT[r.frequency]} pledge, expected ${r.expected_date}, ${r.days_late} day${r.days_late === 1 ? "" : "s"} late`,
    priority: r.days_late > 30 ? "High" : "Normal",
    dueDate: new Date().toISOString().slice(0, 10),
    sort: -r.days_late,
  }));
}

/** Everything one donor has pledged, with how much of it has arrived. */
export type PledgeWithProgress = Pledge & { received: number; lastGiftDate: string | null };

export async function fetchPledgesForPerson(personId: string): Promise<PledgeWithProgress[]> {
  const [{ data: pledges, error }, { data: gifts }] = await Promise.all([
    supabase
      .from("pledges")
      .select("*")
      .eq("person_id", personId)
      .order("created_at", { ascending: false }),
    supabase
      .from("donations")
      .select("amount, date, pledge_id")
      .eq("person_id", personId)
      .is("deleted_at", null),
  ]);
  if (error) throw error;
  return ((pledges ?? []) as Pledge[]).map((p) => {
    const paid = (gifts ?? []).filter((g) => g.pledge_id === p.id);
    return {
      ...p,
      received: paid.reduce((n, g) => n + Number(g.amount ?? 0), 0),
      lastGiftDate:
        paid
          .map((g) => g.date)
          .sort()
          .at(-1) ?? null,
    };
  });
}
