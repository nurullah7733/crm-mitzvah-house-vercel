import { distance } from "fastest-levenshtein";
import { nextBirthday } from "@/lib/hebrew";

/* ------------------------------------------------------------------ *
 * Fuzzy matching helpers
 * ------------------------------------------------------------------ */

/** More typos allowed in longer words. */
export function allowedTypos(term: string) {
  const n = term.length;
  if (n <= 2) return 0;
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  return 3;
}

/**
 * Damerau-Levenshtein (optimal string alignment) distance: like Levenshtein,
 * but swapping two neighbouring letters counts as ONE mistake, so "ruht"
 * is one error away from "ruth" and "klien" one away from "klein".
 */
export function damerau(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push(new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = v;
    }
  }
  return rows[a.length]![b.length]!;
}

/** Cheapest of plain Levenshtein and the transposition-aware variant. */
function editDistance(a: string, b: string) {
  return Math.min(distance(a, b), damerau(a, b));
}

/**
 * Score a search term against a haystack.
 * 0 = exact / starts-with hit, 1 = contains, 2+ = fuzzy (higher is worse),
 * null = no match at all. Lower ranks first.
 */
export function fuzzyScore(term: string, haystack: string): number | null {
  const t = term.trim().toLowerCase();
  const h = haystack.toLowerCase();
  if (!t) return 0;
  if (!h) return null;
  if (h === t || h.startsWith(t)) return 0;
  if (h.includes(t)) return 1;
  const budget = allowedTypos(t);
  if (budget === 0) return null;
  let best: number | null = null;
  for (const word of h.split(/[^a-z0-9']+/i)) {
    if (!word) continue;
    const d = editDistance(t, word);
    if (d <= budget && (best === null || d < best)) best = d;
    // also compare against the same-length prefix, so "klien" hits "kleinberg"
    if (word.length > t.length) {
      const p = editDistance(t, word.slice(0, t.length));
      if (p <= budget && (best === null || p < best)) best = p;
    }
  }
  return best === null ? null : 1 + best;
}

/** Best (lowest) score of a term across several fields. */
export function fuzzyScoreAny(term: string, fields: (string | null | undefined)[]) {
  let best: number | null = null;
  for (const f of fields) {
    const s = fuzzyScore(term, f ?? "");
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Intent parsing
 * ------------------------------------------------------------------ */

export type GivingBasis = "lifetime" | "this_year" | "last_year";

export type Intent =
  | { kind: "giving"; basis: GivingBasis; min?: number | undefined; max?: number | undefined }
  | { kind: "no_gift_this_year" }
  | { kind: "cold"; days: number }
  | { kind: "volunteers" }
  | { kind: "upcoming_birthdays"; days: number }
  | { kind: "met_at"; term: string }
  | { kind: "program"; program: string }
  | { kind: "tag"; tag: string }
  | { kind: "text"; term: string }
  | { kind: "all" };

export type SearchPerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name?: string | null;
  email: string | null;
  phone: string | null;
  met_source: string | null;
  birth_date: string | null;
  last_activity_date: string | null;
  lifetime_giving: number | null;
  this_year_giving: number | null;
  tags: string[] | null;
  programs: string[] | null;
  notes?: string | null;
  school?: string | null;
  household_name?: string | null;
  last_year_giving?: number;
  interaction_text?: string;
};

const NUM = String.raw`\$?\s*([\d,]+(?:\.\d+)?)`;

function num(raw: string | undefined) {
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function detectBasis(q: string): GivingBasis {
  if (/\blast\s+year\b/.test(q)) return "last_year";
  if (/\b(this|current)\s+year\b/.test(q) || /\bytd\b/.test(q)) return "this_year";
  return "lifetime";
}

export function basisLabel(basis: GivingBasis) {
  return basis === "last_year" ? "last year" : basis === "this_year" ? "this year" : "lifetime";
}

/**
 * Turn a plain-English question into structured filters.
 * `programs` and `tags` come from the editable Settings lists so new programs
 * are searchable without a code change.
 */
export function parseQuery(
  raw: string,
  options: { programs?: string[]; tags?: string[]; metSources?: string[] } = {},
): Intent[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [{ kind: "all" }];
  const intents: Intent[] = [];
  const basis = detectBasis(q);

  // gave between 500 and 2000
  const between = q.match(new RegExp(String.raw`between\s+${NUM}\s+(?:and|to|-)\s+${NUM}`));
  if (between) {
    intents.push({ kind: "giving", basis, min: num(between[1]), max: num(between[2]) });
  } else {
    const over = q.match(
      new RegExp(String.raw`(?:over|more than|above|greater than|at least|\bmin\b|\+)\s*${NUM}`),
    );
    const under = q.match(new RegExp(String.raw`(?:under|less than|below|at most|up to)\s*${NUM}`));
    if (over) intents.push({ kind: "giving", basis, min: num(over[1]) });
    else if (under) intents.push({ kind: "giving", basis, max: num(under[1]) });
    else if (/\b(donated|gave|giving|gift|donors?)\b/.test(q)) {
      const bare = q.match(new RegExp(String.raw`\$\s*([\d,]+)`));
      if (bare) intents.push({ kind: "giving", basis, min: num(bare[1]) });
    }
  }

  if (/(haven'?t|has ?n'?t|have not|no|not)\s+(given|donated|gift)/.test(q) && /this year/.test(q)) {
    intents.push({ kind: "no_gift_this_year" });
  } else if (/lapsed/.test(q)) {
    intents.push({ kind: "no_gift_this_year" });
  }

  if (/going cold|gone cold|\bcold\b|no recent activity|no activity|not heard from|falling off/.test(q)) {
    const days = num(q.match(/(\d+)\+?\s*days?/)?.[1]) ?? 60;
    intents.push({ kind: "cold", days });
  }

  if (/volunteer/.test(q)) intents.push({ kind: "volunteers" });

  if (/birthday/.test(q)) {
    const days = num(q.match(/(\d+)\s*days?/)?.[1]) ?? 30;
    intents.push({ kind: "upcoming_birthdays", days });
  }

  const met = q.match(/(?:met (?:at|through|via|on)|from)\s+(.{2,40})$/);
  if (met?.[1]) intents.push({ kind: "met_at", term: met[1].trim() });

  for (const p of options.programs ?? []) {
    const score = fuzzyScore(p.toLowerCase(), q);
    if (score !== null && score <= 1) {
      intents.push({ kind: "program", program: p });
      break;
    }
  }

  if (intents.length === 0) {
    for (const t of options.tags ?? []) {
      const score = fuzzyScore(t.toLowerCase(), q);
      if (score !== null && score <= 1) {
        intents.push({ kind: "tag", tag: t });
        break;
      }
    }
  }

  if (intents.length === 0) {
    for (const s of options.metSources ?? []) {
      const score = fuzzyScore(s.toLowerCase(), q);
      if (score !== null && score <= 1) {
        intents.push({ kind: "met_at", term: s });
        break;
      }
    }
  }

  if (intents.length === 0) intents.push({ kind: "text", term: q });
  return intents;
}

export function describeIntents(intents: Intent[]): string {
  const parts = intents.map((i) => {
    switch (i.kind) {
      case "giving": {
        const where = basisLabel(i.basis);
        if (i.min !== undefined && i.max !== undefined)
          return `gave between $${i.min.toLocaleString()} and $${i.max.toLocaleString()} (${where})`;
        if (i.min !== undefined) return `gave more than $${i.min.toLocaleString()} (${where})`;
        if (i.max !== undefined) return `gave less than $${i.max.toLocaleString()} (${where})`;
        return `giving (${where})`;
      }
      case "no_gift_this_year":
        return "donors who have not given this year";
      case "cold":
        return `no activity in ${i.days}+ days`;
      case "volunteers":
        return "volunteers";
      case "upcoming_birthdays":
        return `birthdays in the next ${i.days} days`;
      case "met_at":
        return `met at "${i.term}" (source and notes)`;
      case "program":
        return `program: ${i.program}`;
      case "tag":
        return `tag: ${i.tag}`;
      case "text":
        return `name, email or phone like "${i.term}"`;
      case "all":
        return "everyone";
    }
  });
  return parts.join(" · ");
}

function givingFor(p: SearchPerson, basis: GivingBasis) {
  if (basis === "this_year") return Number(p.this_year_giving ?? 0);
  if (basis === "last_year") return Number(p.last_year_giving ?? 0);
  return Number(p.lifetime_giving ?? 0);
}

function daysSinceISO(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (!y || !m || !d) return null;
  const t = new Date();
  return Math.round(
    (new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / 86400000,
  );
}

/** Runs the parsed intents against people, returning matches ranked best-first. */
export function runIntents(intents: Intent[], people: SearchPerson[]) {
  const scored: { person: SearchPerson; score: number }[] = [];

  for (const p of people) {
    let score = 0;
    let ok = true;
    for (const intent of intents) {
      if (!ok) break;
      switch (intent.kind) {
        case "all":
          break;
        case "giving": {
          const amount = givingFor(p, intent.basis);
          if (intent.min !== undefined && amount < intent.min) ok = false;
          if (intent.max !== undefined && amount > intent.max) ok = false;
          break;
        }
        case "no_gift_this_year":
          if (Number(p.this_year_giving ?? 0) > 0 || Number(p.lifetime_giving ?? 0) <= 0) ok = false;
          break;
        case "cold": {
          const since = daysSinceISO(p.last_activity_date);
          if (since !== null && since < intent.days) ok = false;
          break;
        }
        case "volunteers": {
          const hay = [...(p.tags ?? []), ...(p.programs ?? [])].join(" ").toLowerCase();
          if (!hay.includes("volunteer")) ok = false;
          break;
        }
        case "upcoming_birthdays": {
          const b = nextBirthday(p.birth_date);
          if (!b || b.days > intent.days) ok = false;
          break;
        }
        case "met_at": {
          const s = fuzzyScoreAny(intent.term, [p.met_source, p.interaction_text]);
          if (s === null) ok = false;
          else score += s;
          break;
        }
        case "program": {
          const hay = (p.programs ?? []).join(" ").toLowerCase();
          if (!hay.includes(intent.program.toLowerCase())) ok = false;
          break;
        }
        case "tag": {
          const hay = (p.tags ?? []).join(" ").toLowerCase();
          if (!hay.includes(intent.tag.toLowerCase())) ok = false;
          break;
        }
        case "text": {
          const terms = intent.term.split(/\s+/).filter(Boolean);
          let sum = 0;
          for (const term of terms) {
            const s = fuzzyScoreAny(term, [
              p.display_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
              p.first_name,
              p.last_name,
              p.email,
              (p.phone ?? "").replace(/\D/g, ""),
              p.household_name,
              p.met_source,
              p.notes,
              p.school,
              (p.tags ?? []).join(" "),
              (p.programs ?? []).join(" "),
            ]);
            if (s === null) {
              ok = false;
              break;
            }
            sum += s;
          }
          score += sum;
          break;
        }
      }
    }
    if (ok) scored.push({ person: p, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        sortKey(a.person).localeCompare(sortKey(b.person)),
    )
    .map((s) => s.person);
}

function sortKey(p: SearchPerson) {
  return `${p.last_name ?? p.display_name ?? ""} ${p.first_name ?? ""}`.trim();
}