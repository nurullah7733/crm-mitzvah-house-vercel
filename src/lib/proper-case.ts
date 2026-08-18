/**
 * Tidy up capitalisation on names, addresses and cities without ever changing
 * spelling. A word that already has capitals in the middle ("McDonald", "DeVito")
 * is treated as deliberate and left exactly as typed, so a manual correction
 * always survives a later import or edit.
 */

/** Small words inside a surname that stay lowercase unless they lead the name. */
const LOWER_PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "de",
  "del",
  "della",
  "di",
  "da",
  "dos",
  "du",
  "la",
  "le",
  "el",
  "al",
  "bin",
  "ibn",
  "ben",
  "bat",
  "bas",
  "of",
  "the",
  "and",
  "y",
]);

/** Tokens that belong in capitals: states, directionals, common abbreviations. */
const ALWAYS_UPPER = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
  "PR",
  "N",
  "S",
  "E",
  "W",
  "NE",
  "NW",
  "SE",
  "SW",
  "PO",
  "US",
  "USA",
  "UK",
  "LLC",
  "INC",
  "NGO",
  "JCC",
  "MD",
  "PHD",
  "DDS",
  "CPA",
  "II",
  "III",
  "IV",
  "V",
  "VI",
]);

/** Words that look like an abbreviation with a dot keep their own shape. */
const KNOWN_LOWER_SUFFIX = /^(st|nd|rd|th)$/;

function capitalizeWord(word: string, isFirst: boolean, isLast: boolean): string {
  if (!word) return word;

  // Deliberate internal capitals are left alone (McDonald, DeVito, iPhone).
  const letters = word.replace(/[^A-Za-z]/g, "");
  const hasInternalCapital = /[a-z][A-Z]/.test(word);
  if (hasInternalCapital) return word;

  const upper = letters.toUpperCase();
  if (letters && ALWAYS_UPPER.has(upper) && letters.length <= 4) {
    return word.replace(/[A-Za-z]+/, (m) => m.toUpperCase());
  }

  const lower = word.toLowerCase();

  // "3rd", "21st" — the number keeps its lowercase ordinal suffix.
  if (/^\d+[a-z]{2}$/i.test(word) && KNOWN_LOWER_SUFFIX.test(lower.replace(/^\d+/, "")))
    return lower;

  // "3b" / "12a" apartment numbers get an uppercase letter.
  if (/^\d+[a-z]$/i.test(word)) return word.slice(0, -1) + word.slice(-1).toUpperCase();

  if (!isFirst && !isLast && LOWER_PARTICLES.has(lower)) return lower;

  // Mc / Mac / O' prefixes.
  if (/^mc[a-z]{2,}$/.test(lower)) return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
  if (/^mac[a-z]{3,}$/.test(lower)) return "Mac" + lower.charAt(3).toUpperCase() + lower.slice(4);
  if (/^o'[a-z]{2,}$/.test(lower)) return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);

  // Hyphens, apostrophes and slashes each start a new capital (Bat-Sheva, Anne-Marie).
  return lower.replace(
    /(^|[-'’/.])([a-z])/g,
    (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
}

/** Proper-case a person or place name. Returns the input untouched if it is empty. */
export function properCase(raw: string | null | undefined): string {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  // A mixed-case string that someone typed deliberately is respected as-is.
  const words = value.split(" ");
  return words.map((w, i) => capitalizeWord(w, i === 0, i === words.length - 1)).join(" ");
}

/** Proper-case an address, keeping each line separate. */
export function properCaseAddress(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  return value
    .split("\n")
    .map((line) => properCase(line))
    .join("\n");
}

/** State codes are always upper case; anything longer is proper-cased. */
export function normalizeState(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.length <= 3) return value.toUpperCase();
  return properCase(value);
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}
