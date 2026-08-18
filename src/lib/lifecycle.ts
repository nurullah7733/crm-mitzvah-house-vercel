import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hebrewMilestone, startOfToday } from "@/lib/hebrew";

/**
 * Growing up: children become adults only when a staff member says so.
 *
 * Nothing in here writes to the database. It reads birth dates, works out the
 * Hebrew-calendar milestones, and hands staff a list to look at. Two milestones:
 *
 *  1. Bar/bat mitzvah age — boys 13, girls 12 — a program and outreach prompt
 *  2. The adult age (18 by default, configurable) — a prompt to review the role
 *
 * A child with no birth date on file is flagged as missing, never guessed at.
 */
export type LifecycleSettings = {
  adult_age: number;
  /** How many days ahead of a bar/bat mitzvah to start showing it. */
  bnm_lead_days: number;
};

export const LIFECYCLE_DEFAULTS: LifecycleSettings = { adult_age: 18, bnm_lead_days: 60 };

export function useLifecycleSettings() {
  return useQuery({
    queryKey: ["lifecycle-settings"],
    queryFn: async (): Promise<LifecycleSettings> => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "lifecycle")
        .maybeSingle();
      const v = (data?.value ?? {}) as Partial<LifecycleSettings>;
      return {
        adult_age: Number(v.adult_age ?? LIFECYCLE_DEFAULTS.adult_age),
        bnm_lead_days: Number(v.bnm_lead_days ?? LIFECYCLE_DEFAULTS.bnm_lead_days),
      };
    },
    staleTime: 60_000,
  });
}

export const CHILD_ROLE = "Child";
export const ADULT_ROLE = "Adult";

export function isChild(role: string | null | undefined) {
  return (role ?? "").toLowerCase() === "child";
}

/** Boys reach bar mitzvah age at 13, girls bat mitzvah age at 12. */
export function mitzvahAge(gender: string | null | undefined): number | null {
  const g = (gender ?? "").toLowerCase();
  if (g === "male") return 13;
  if (g === "female") return 12;
  return null;
}

export function mitzvahLabel(gender: string | null | undefined) {
  return (gender ?? "").toLowerCase() === "female" ? "bat mitzvah" : "bar mitzvah";
}

export type LifecyclePerson = {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type LifecycleKind = "mitzvah" | "adult" | "missing";

export type LifecycleItem = {
  kind: LifecycleKind;
  /** Stable key so a reminder disappears once it has been turned into a task. */
  key: string;
  personId: string;
  name: string;
  label: string;
  detail: string;
  dueDate: string;
  priority: string;
  sort: number;
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Everything worth reviewing about one child. */
export function lifecycleItemsFor(
  p: LifecyclePerson,
  nameOf: (p: LifecyclePerson) => string,
  settings: LifecycleSettings,
): LifecycleItem[] {
  if (!isChild(p.role)) return [];
  const name = nameOf(p);
  const out: LifecycleItem[] = [];

  if (!p.birth_date) {
    return [
      {
        kind: "missing",
        key: `dob-missing-${p.id}`,
        personId: p.id,
        name,
        label: `${name} has no birth date on file`,
        detail:
          "We can't work out bar/bat mitzvah or adult age without it. Ask the family — don't guess.",
        dueDate: iso(startOfToday()),
        priority: "Normal",
        sort: 500,
      },
    ];
  }

  const adult = hebrewMilestone(p.birth_date, settings.adult_age);
  if (adult && adult.days <= 0) {
    out.push({
      kind: "adult",
      key: `adult-${p.id}`,
      personId: p.id,
      name,
      label: `${name} turned ${settings.adult_age} — review whether to change role to Adult`,
      detail: `Hebrew birthday ${adult.hebrewLabel} fell on ${adult.date.toDateString()}. Nothing has changed yet.`,
      dueDate: iso(startOfToday()),
      priority: "Normal",
      sort: -1000 + adult.days,
    });
  }

  const age = mitzvahAge(p.gender);
  if (age === null) {
    const twelve = hebrewMilestone(p.birth_date, 12);
    if (twelve && twelve.days >= 0 && twelve.days <= settings.bnm_lead_days) {
      out.push({
        kind: "missing",
        key: `gender-missing-${p.id}`,
        personId: p.id,
        name,
        label: `${name} is close to bar/bat mitzvah age, but we don't have male or female on file`,
        detail:
          "Boys reach bar mitzvah age at 13, girls bat mitzvah age at 12 — add it and this will be exact.",
        dueDate: iso(startOfToday()),
        priority: "Normal",
        sort: 400,
      });
    }
  } else {
    const m = hebrewMilestone(p.birth_date, age);
    if (m && m.days >= 0 && m.days <= settings.bnm_lead_days) {
      out.push({
        kind: "mitzvah",
        key: `mitzvah-${age}-${p.id}`,
        personId: p.id,
        name,
        label: `${name} turns ${age} on ${m.hebrewLabel} — ${mitzvahLabel(p.gender)} age`,
        detail: `That falls on ${m.date.toDateString()}, in ${m.days} ${m.days === 1 ? "day" : "days"}. Program and outreach prompt — not a role change.`,
        dueDate: iso(m.date),
        priority: m.days <= 14 ? "High" : "Normal",
        sort: m.days,
      });
    }
  }

  return out;
}

export function lifecycleItems(
  people: LifecyclePerson[],
  nameOf: (p: LifecyclePerson) => string,
  settings: LifecycleSettings,
): LifecycleItem[] {
  return people
    .flatMap((p) => lifecycleItemsFor(p, nameOf, settings))
    .sort((a, b) => a.sort - b.sort);
}

/** True when this child is past the adult age and waiting for a staff decision. */
export function needsAdultReview(p: LifecyclePerson, settings: LifecycleSettings) {
  if (!isChild(p.role) || !p.birth_date) return false;
  const adult = hebrewMilestone(p.birth_date, settings.adult_age);
  return !!adult && adult.days <= 0;
}

/** True when this child reaches bar/bat mitzvah age within the lead window. */
export function approachingMitzvah(p: LifecyclePerson, settings: LifecycleSettings) {
  if (!isChild(p.role) || !p.birth_date) return false;
  const age = mitzvahAge(p.gender) ?? 12;
  const m = hebrewMilestone(p.birth_date, age);
  return !!m && m.days >= 0 && m.days <= settings.bnm_lead_days;
}
