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

/** English (Gregorian) date string -> Hebrew date, e.g. "21st of Av, 5750". */
export function hebrewDateFromEnglish(value: string | null | undefined): string | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  try {
    return new HDate(new Date(y, m - 1, d)).render("en");
  } catch {
    return null;
  }
}

function startOfToday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

export function daysUntil(date: Date) {
  return Math.round((date.getTime() - startOfToday().getTime()) / 86400000);
}

/** Next Gregorian occurrence of a birthday (month/day only, year ignored). */
export function nextBirthday(value: string | null | undefined) {
  if (!value) return null;
  const [, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!m || !d) return null;
  const today = startOfToday();
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return { date: next, days: daysUntil(next) };
}

/**
 * Next occurrence of a yahrzeit stored as a Hebrew month + day.
 * In a Hebrew leap year an Adar (12) yahrzeit defaults to Adar II.
 */
export function nextYahrzeit(month: number, day: number) {
  const today = startOfToday();
  const thisHYear = new HDate(today).getFullYear();
  for (const hYear of [thisHYear, thisHYear + 1, thisHYear + 2]) {
    const leap = HDate.isLeapYear(hYear);
    let mon = month;
    if (leap && month === 12) mon = 13; // Adar -> Adar II
    if (!leap && month === 13) mon = 12; // Adar II -> Adar
    const maxDay = HDate.daysInMonth(mon, hYear);
    const hd = new HDate(Math.min(day, maxDay), mon, hYear);
    const greg = hd.greg();
    const g = new Date(greg.getFullYear(), greg.getMonth(), greg.getDate());
    if (g >= today) {
      return { date: g, days: daysUntil(g), hebrew: hd.render("en") };
    }
  }
  return null;
}
