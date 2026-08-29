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
export type ImportDateSource = {
  raw: string | number | boolean | null;
  display: string;
  kind: "blank" | "string" | "number" | "boolean" | "date" | "formula";
  format?: string;
};

export type ImportDateResult = {
  value: string | null;
  status: "valid" | "ambiguous" | "invalid" | "blank";
  confidence: "typed" | "source-format" | "unambiguous-text" | "none";
  interpretations?: string[];
  sourceFormat?: string;
};

function excelSerial(raw: number) {
  if (!Number.isFinite(raw) || raw < 1 || raw > 2958465) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseImportDateResult(
  raw: string | number | null | undefined | ImportDateSource,
): ImportDateResult {
  const source = typeof raw === "object" && raw !== null ? raw : null;
  if (source?.kind === "date" && typeof source.raw === "number") {
    const value = excelSerial(source.raw);
    return value
      ? { value, status: "valid", confidence: "typed", ...(source.format ? { sourceFormat: source.format } : {}) }
      : { value: null, status: "invalid", confidence: "none", ...(source.format ? { sourceFormat: source.format } : {}) };
  }
  const scalar = source ? source.display : raw;
  if (scalar === null || scalar === undefined) return { value: null, status: "blank", confidence: "none" };
  const text = String(scalar).trim();
  if (!text) return { value: null, status: "blank", confidence: "none" };

  // Already ISO, possibly with a time attached.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (isoMatch) {
    const value = iso(+isoMatch[1]!, +isoMatch[2]!, +isoMatch[3]!);
    return value ? { value, status: "valid", confidence: "unambiguous-text" } : { value: null, status: "invalid", confidence: "none" };
  }
  if (/^\d+(\.\d+)?$/.test(text)) return { value: null, status: "invalid", confidence: "none" };

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
        const value = iso(fullYear(yearRaw), month, day);
        return value ? { value, status: "valid", confidence: "unambiguous-text" } : { value: null, status: "invalid", confidence: "none" };
      }
    }
  }

  // Numeric: 3/14/1978 · 14.3.1978 · 1978/03/14 · 12-25-90
  const parts = text.split(/[./-]/).map((p) => p.trim());
  if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    const [a, b, c] = parts.map(Number) as [number, number, number];
    if (parts[0]!.length === 4) {
      const value = iso(a, b, c);
      return value ? { value, status: "valid", confidence: "unambiguous-text" } : { value: null, status: "invalid", confidence: "none" };
    }
    const year = fullYear(c);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12) {
      const interpretations = [...new Set([iso(year, a, b), iso(year, b, a)].filter((value): value is string => Boolean(value)))];
      if (interpretations.length > 1)
        return { value: null, status: "ambiguous", confidence: "none", interpretations };
      if (interpretations.length === 1)
        return { value: interpretations[0]!, status: "valid", confidence: "unambiguous-text" };
      return { value: null, status: "invalid", confidence: "none" };
    }
    const value = a > 12 ? iso(year, b, a) : b > 12 ? iso(year, a, b) : null;
    return value ? { value, status: "valid", confidence: "unambiguous-text" } : { value: null, status: "invalid", confidence: "none" };
  }
  return { value: null, status: "invalid", confidence: "none" };
}

export function parseImportDate(raw: string | number | null | undefined): string | null {
  return parseImportDateResult(raw).value;
}

/** Blank dates may use an explicit caller fallback; bad nonblank dates never do. */
export function resolveImportDonationDate(
  raw: string | null | undefined,
  blankFallback: string,
): string | null {
  const result = parseImportDateResult(raw);
  return result.status === "blank" ? blankFallback : result.status === "valid" ? result.value : null;
}

/** Today, as the database stores it. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
