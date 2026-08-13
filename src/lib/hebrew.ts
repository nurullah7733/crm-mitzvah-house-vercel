import { HDate } from "@hebcal/core";

export const HEBREW_MONTHS = [
  { value: 1, label: "Nisan" },
  { value: 2, label: "Iyyar" },
  { value: 3, label: "Sivan" },
  { value: 4, label: "Tammuz" },
  { value: 5, label: "Av" },
  { value: 6, label: "Elul" },
  { value: 7, label: "Tishrei" },
  { value: 8, label: "Cheshvan" },
  { value: 9, label: "Kislev" },
  { value: 10, label: "Tevet" },
  { value: 11, label: "Shevat" },
  { value: 12, label: "Adar (Adar I)" },
  { value: 13, label: "Adar II" },
];

export function hebrewMonthName(month: number) {
  return HEBREW_MONTHS.find((m) => m.value === month)?.label ?? String(month);
}

/** English (Gregorian) date string -> { month, day } on the Hebrew calendar. */
export function hebrewMonthDayFromEnglish(value: string | null | undefined): { month: number; day: number } | null {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (!y || !m || !d) return null;
  try {
    const hd = new HDate(new Date(y, m - 1, d));
    return { month: hd.getMonth(), day: hd.getDate() };
  } catch {
    return null;
  }
}

/** English (Gregorian) date string -> Hebrew date, e.g. "21st of Av, 5750". */
export function hebrewDateFromEnglish(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (!y || !m || !d) return null;
  try {
    return new HDate(new Date(y, m - 1, d)).render("en");
  } catch {
    return null;
  }
}

export function startOfToday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

export function daysUntil(date: Date) {
  return Math.round((date.getTime() - startOfToday().getTime()) / 86400000);
}

/**
 * One occurrence of a date on the Hebrew calendar.
 *
 *  - `date` is the Gregorian day this year's (or next year's) Hebrew date falls on
 *  - `days` counts down to that day
 *  - `eve` is the evening before, because a Hebrew day begins at sunset
 */
export type HebrewOccurrence = {
  hebrewMonth: number;
  hebrewDay: number;
  /** e.g. "14 Nisan" */
  hebrewLabel: string;
  /** e.g. "14th of Nisan, 5786" */
  hebrewFull: string;
  date: Date;
  days: number;
  eve: Date;
  /** True when the stored day doesn't exist this year (e.g. 30 Kislev) and we used the last day. */
  clamped: boolean;
};

function occurrenceInHebrewYear(month: number, day: number, hYear: number): HebrewOccurrence {
  const leap = HDate.isLeapYear(hYear);
  let mon = month;
  if (leap && month === 12) mon = 13; // Adar -> Adar II in a leap year
  if (!leap && month === 13) mon = 12; // Adar II -> Adar in a common year
  const maxDay = HDate.daysInMonth(mon, hYear);
  const useDay = Math.min(day, maxDay);
  const hd = new HDate(useDay, mon, hYear);
  const greg = hd.greg();
  const date = new Date(greg.getFullYear(), greg.getMonth(), greg.getDate());
  const eve = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  return {
    hebrewMonth: mon,
    hebrewDay: useDay,
    hebrewLabel: `${useDay} ${hebrewMonthName(mon)}`,
    hebrewFull: hd.render("en"),
    date,
    days: daysUntil(date),
    eve,
    clamped: useDay !== day,
  };
}

/**
 * Next occurrence of a Hebrew month + day, from today forward.
 * Leap years, Adar and short months are all handled by @hebcal/core.
 */
export function nextHebrewOccurrence(month: number, day: number): HebrewOccurrence | null {
  if (!month || !day) return null;
  const today = startOfToday();
  const thisHYear = new HDate(today).getFullYear();
  for (const hYear of [thisHYear, thisHYear + 1, thisHYear + 2]) {
    const occ = occurrenceInHebrewYear(month, day, hYear);
    if (occ.date >= today) return occ;
  }
  return null;
}

/**
 * Next occurrence of an English birthday or anniversary, counted on the HEBREW
 * calendar — the Hebrew month and day of the original date is what recurs.
 */
export function nextHebrewAnniversary(value: string | null | undefined): HebrewOccurrence | null {
  const md = hebrewMonthDayFromEnglish(value);
  if (!md) return null;
  return nextHebrewOccurrence(md.month, md.day);
}

/** Kept for older call sites: the next Hebrew occurrence of an English date. */
export const nextBirthday = nextHebrewAnniversary;

/**
 * The Gregorian day someone turns `years` old on the Hebrew calendar.
 * Returns null when the birth date can't be read.
 */
export function hebrewMilestone(
  birthDate: string | null | undefined,
  years: number,
): (HebrewOccurrence & { hebrewYear: number }) | null {
  const md = hebrewMonthDayFromEnglish(birthDate);
  if (!md) return null;
  const parts = (birthDate ?? "").slice(0, 10).split("-").map(Number);
  const born = new HDate(new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  const hYear = born.getFullYear() + years;
  return { ...occurrenceInHebrewYear(md.month, md.day, hYear), hebrewYear: hYear };
}

/**
 * Next occurrence of a yahrzeit stored as a Hebrew month + day.
 * In a Hebrew leap year an Adar (12) yahrzeit defaults to Adar II.
 */
export function nextYahrzeit(month: number, day: number) {
  const occ = nextHebrewOccurrence(month, day);
  return occ ? { ...occ, hebrew: occ.hebrewFull } : null;
}
