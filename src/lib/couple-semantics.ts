import { splitFullName } from "@/lib/import-mapping";

export type CoupleDecisionKind =
  "single_person" | "confident_couple" | "household_only" | "ambiguous_couple";

export type CoupleNameClaim = {
  first: string;
  middle: string;
  last: string;
  display: string;
};

export type CoupleDecision = {
  kind: CoupleDecisionKind;
  raw: string;
  person1: CoupleNameClaim | null;
  person2: CoupleNameClaim | null;
  evidence: {
    connector: "&" | "and" | "/" | null;
    sharedSurname: string | null;
    organization: boolean;
    incompleteNames: boolean;
    contradictions: string[];
  };
  reason: string;
};

export type CouplePreview = {
  status: "single" | "couple" | "review";
  reason: string;
  willCreate: "contact" | "two contacts" | "review";
};

/** Present the same structured couple decision in the import preview. */
export function presentCoupleDecision(
  decision: CoupleDecision | undefined,
  identityStatus: "matched" | "new" | "ambiguous",
  resolution?: { kind: "safe" | "household_conflict" | "ambiguous"; reason: string } | null,
  activityOwnerReview = false,
): CouplePreview {
  if (resolution?.kind === "household_conflict" || resolution?.kind === "ambiguous")
    return { status: "review", reason: resolution.reason, willCreate: "review" };
  if (activityOwnerReview)
    return {
      status: "review",
      reason:
        "This couple row contains activity, but it is unclear which person the activity belongs to.",
      willCreate: "review",
    };
  if (decision?.kind === "confident_couple") {
    return {
      status: "couple",
      reason: "Confident couple: two named people",
      willCreate: "two contacts",
    };
  }
  if (decision?.kind === "ambiguous_couple" || decision?.kind === "household_only") {
    return { status: "review", reason: decision.reason, willCreate: "review" };
  }
  return {
    status: identityStatus === "ambiguous" ? "review" : "single",
    reason: identityStatus === "ambiguous" ? "Needs review" : "Single person",
    willCreate: identityStatus === "ambiguous" ? "review" : "contact",
  };
}

const ORGANIZATION_WORDS =
  /\b(?:foundation|fund|inc\.?|llc|corp\.?|corporation|company|trust|synagogue|temple|school|association|committee)\b/i;
const HONORIFIC_PAIR = /^\s*(?:mr\.?\s*(?:and|&)\s*mrs\.?|mrs\.?\s*(?:and|&)\s*mr\.?)\s+/i;

function claim(raw: string, inheritedLast = ""): CoupleNameClaim | null {
  const parsed = splitFullName(raw.trim());
  const last = parsed.last || inheritedLast;
  const first = parsed.first.trim();
  if (!first && !last) return null;
  return {
    first,
    middle: parsed.middle.trim(),
    last: last.trim(),
    display: [first, parsed.middle.trim(), last.trim()].filter(Boolean).join(" "),
  };
}

/** Decide whether a single mapped name safely describes one or two people. */
export function decideCoupleName(rawValue: string | null | undefined): CoupleDecision {
  const raw = (rawValue ?? "").trim().replace(/\s+/g, " ");
  const emptyEvidence: CoupleDecision["evidence"] = {
    connector: null,
    sharedSurname: null,
    organization: false,
    incompleteNames: false,
    contradictions: [],
  };
  if (!raw) {
    return {
      kind: "single_person",
      raw,
      person1: null,
      person2: null,
      evidence: emptyEvidence,
      reason: "No name supplied.",
    };
  }
  if (ORGANIZATION_WORDS.test(raw)) {
    return {
      kind: "single_person",
      raw,
      person1: null,
      person2: null,
      evidence: { ...emptyEvidence, organization: true },
      reason: "Organization wording takes precedence over couple parsing.",
    };
  }
  if (/\bfamily\b/i.test(raw)) {
    return {
      kind: "household_only",
      raw,
      person1: null,
      person2: null,
      evidence: { ...emptyEvidence, incompleteNames: true },
      reason: "Family label does not identify a person.",
    };
  }
  const honorific = HONORIFIC_PAIR.exec(raw);
  if (honorific) {
    return {
      kind: "ambiguous_couple",
      raw,
      person1: null,
      person2: null,
      evidence: {
        ...emptyEvidence,
        connector: /&/.test(honorific[0]) ? "&" : "and",
        incompleteNames: true,
      },
      reason: "Couple names are incomplete and need review.",
    };
  }
  const connectorMatch = /(?:\s+(&|and)\s+|\s*(\/+)\s*)/i.exec(raw);
  if (!connectorMatch) {
    return {
      kind: "single_person",
      raw,
      person1: claim(raw),
      person2: null,
      evidence: emptyEvidence,
      reason: "No couple connector found.",
    };
  }
  const connector = (connectorMatch[1] ?? connectorMatch[2])!.toLowerCase() as "&" | "and" | "/";
  const [left, right] = raw.split(/\s+(?:&|and)\s+|\s*\/\s*/i).map((part) => part.trim());
  const rightClaim = claim(right ?? "");
  const sharedSurname = rightClaim?.last || null;
  const leftWords = (left ?? "").split(" ").filter(Boolean);
  const leftClaim = claim(left ?? "", sharedSurname ?? "");
  const canReconstructSharedSurname = Boolean(
    leftClaim?.first && sharedSurname && leftWords.length === 1,
  );
  const fullNames = Boolean(
    leftClaim?.first && leftClaim.last && rightClaim?.first && rightClaim.last,
  );
  if (connector !== "/" && (canReconstructSharedSurname || fullNames)) {
    return {
      kind: "confident_couple",
      raw,
      person1: leftClaim,
      person2: rightClaim,
      evidence: { ...emptyEvidence, connector, sharedSurname },
      reason: "Two named people can be represented without inventing identity data.",
    };
  }
  return {
    kind: "ambiguous_couple",
    raw,
    person1: null,
    person2: null,
    evidence: { ...emptyEvidence, connector, sharedSurname, incompleteNames: true },
    reason: "Couple names are incomplete and need review.",
  };
}
