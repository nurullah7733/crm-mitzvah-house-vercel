/**
 * One date reader for everything that arrives from a spreadsheet.
 *
 * Files come from Salesforce, Donorbox, Excel and hand-typed lists, so the same
 * column can hold "3/14/1978", "1978-03-14", "14-Mar-1978", "12/25/90", or an
 * Excel serial number. `new Date(...)` silently returns Invalid Date for several
 * of those, which is how birth dates and gift dates went missing.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Is this a real calendar day? Catches the 31st of February. */
function valid(year: number, month: number, day: number) {
  if (!Number.isFinite(year) || year < 1800 || year > 2200) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function iso(year: number, month: number, day: number) {
  return valid(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** "90" means 1990, "26" means 2026 — anything more than ten years ahead is the last century. */
function fullYear(raw: number) {
  if (raw >= 100) return raw;
  const nowShort = new Date().getFullYear() % 100;
  return raw <= nowShort + 10 ? 2000 + raw : 1900 + raw;
}

/**
 * Read a spreadsheet date and return it as `YYYY-MM-DD`, or null when the cell
 * holds nothing we can trust. Nothing is ever guessed into today's date.
 */
export function parseImportDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // Already ISO, possibly with a time attached.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (isoMatch) return iso(+isoMatch[1]!, +isoMatch[2]!, +isoMatch[3]!);

  // Excel stores dates as days since 1899-12-30.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20000 && serial <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }

  // 14-Mar-1978 · 14 March 1978 · Mar 14, 1978 · March 14 1978
  const words = text.replace(/,/g, " ").split(/[\s./-]+/).filter(Boolean);
  if (words.length >= 3) {
    const monthIndex = words.findIndex((w) => MONTHS[w.toLowerCase()] !== undefined);
    if (monthIndex >= 0) {
      const month = MONTHS[words[monthIndex]!.toLowerCase()]!;
      const numbers = words
        .filter((_, i) => i !== monthIndex)
        .map((w) => Number(w.replace(/(st|nd|rd|th)$/i, "")))
        .filter((n) => Number.isFinite(n));
      if (numbers.length >= 2) {
        const yearRaw = numbers.find((n) => n > 31) ?? numbers[numbers.length - 1]!;
        const day = numbers.find((n) => n !== yearRaw) ?? numbers[0]!;
        return iso(fullYear(yearRaw), month, day);
      }
    }
  }

  // Numeric: 3/14/1978 · 14.3.1978 · 1978/03/14 · 12-25-90
  const parts = text.split(/[./-]/).map((p) => p.trim());
  if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    const [a, b, c] = parts.map(Number) as [number, number, number];
    if (parts[0]!.length === 4) return iso(a, b, c);
    const year = fullYear(c);
    const dayFirst = a > 12 || (text.includes(".") && b <= 12);
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    return iso(year, month, day) ?? iso(year, day, month);
  }

  return null;
}

/** Today, as the database stores it. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}