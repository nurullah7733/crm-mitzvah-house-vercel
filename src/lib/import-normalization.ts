export type ParseStatus = "valid" | "ambiguous" | "invalid" | "blank";

export type ImportAmountResult = {
  cents: number | null;
  canonical: string | null;
  status: "valid" | "ambiguous_locale" | "invalid" | "blank";
  sign: "positive" | "negative" | "zero";
};

const amountBlank = (): ImportAmountResult => ({
  cents: null,
  canonical: null,
  status: "blank",
  sign: "zero",
});

export function parseImportAmount(raw: string | number | null | undefined): ImportAmountResult {
  if (raw === null || raw === undefined || String(raw).trim() === "") return amountBlank();
  let text = String(raw).trim();
  const parenthesized = /^\(.*\)$/.test(text);
  if (parenthesized) text = text.slice(1, -1).trim();
  text = text.replace(/^[$£€]\s*/, "").replace(/\s*[A-Za-z]{3}\s*$/, "").trim();
  if (!text || !/^-?[\d.,]+$/.test(text))
    return { cents: null, canonical: null, status: "invalid", sign: "zero" };
  if (text.includes(",")) {
    const usThousands = /^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text);
    if (!usThousands)
      return { cents: null, canonical: null, status: "ambiguous_locale", sign: "zero" };
    text = text.replace(/,/g, "");
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text))
    return { cents: null, canonical: null, status: "invalid", sign: "zero" };
  const negative = parenthesized || text.startsWith("-");
  const unsigned = text.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const absoluteCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(absoluteCents))
    return { cents: null, canonical: null, status: "invalid", sign: "zero" };
  const cents = negative ? -absoluteCents : absoluteCents;
  return {
    cents,
    canonical: `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`,
    status: "valid",
    sign: cents < 0 ? "negative" : cents > 0 ? "positive" : "zero",
  };
}

export function centsToAmount(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export function amountToCents(raw: string | number | null | undefined) {
  const result = parseImportAmount(raw);
  return result.status === "valid" ? result.cents : null;
}

export function allocateRegistrationCents(grossCents: number, configuredFee: number) {
  const feeCents = Math.min(
    Math.max(Math.round(configuredFee * 100), 0),
    Math.max(grossCents, 0),
  );
  return { grossCents, feeCents, donationCents: grossCents - feeCents };
}

export type ImportEmailResult = {
  raw: string;
  canonical: string | null;
  status: "valid" | "invalid" | "blank";
};

const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function parseImportEmails(raw: string | null | undefined): ImportEmailResult[] {
  const text = (raw ?? "").trim();
  if (!text) return [{ raw: "", canonical: null, status: "blank" }];
  return text
    .split(/[;,|]+/)
    .flatMap((part) => {
      const trimmed = part.trim();
      const display = /^(?:[^<>]*)<\s*([^<>]+)\s*>$/.exec(trimmed);
      const candidates = display ? [display[1]!] : trimmed.split(/\s+/);
      return candidates.filter(Boolean).map((candidate) => {
        const canonical = candidate.trim().toLowerCase();
        return EMAIL.test(canonical)
          ? { raw: trimmed, canonical, status: "valid" as const }
          : { raw: trimmed, canonical: null, status: "invalid" as const };
      });
    });
}

export type ImportPhoneResult = {
  raw: string;
  base: string | null;
  extension: string | null;
  identityKey: string | null;
  status: "valid" | "unsafe" | "invalid" | "blank";
  confidence: "us" | "none";
};

export function parseImportPhone(raw: string | number | null | undefined): ImportPhoneResult {
  const text = String(raw ?? "").trim();
  if (!text)
    return { raw: text, base: null, extension: null, identityKey: null, status: "blank", confidence: "none" };
  const extensionMatch = /(?:\s*(?:ext\.?|extension|x|#)\s*(\d+))\s*$/i.exec(text);
  const extension = extensionMatch?.[1] ?? null;
  const baseText = extensionMatch ? text.slice(0, extensionMatch.index).trim() : text;
  if (!/^[+()\d\s.-]+$/.test(baseText))
    return { raw: text, base: null, extension, identityKey: null, status: "invalid", confidence: "none" };
  const digits = baseText.replace(/\D/g, "");
  if (digits.length === 10)
    return { raw: text, base: digits, extension, identityKey: digits, status: "valid", confidence: "us" };
  if (digits.length === 11 && digits.startsWith("1"))
    return { raw: text, base: digits, extension, identityKey: digits.slice(1), status: "valid", confidence: "us" };
  if (digits.length >= 7 && digits.length <= 15)
    return { raw: text, base: digits, extension, identityKey: null, status: "unsafe", confidence: "none" };
  return { raw: text, base: digits || null, extension, identityKey: null, status: "invalid", confidence: "none" };
}
