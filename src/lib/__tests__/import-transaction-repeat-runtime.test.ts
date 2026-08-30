import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url), "utf8");

describe("transaction repeat import routing", () => {
  it("only bypasses duplicate-gift review for an exact matched transaction repeat", () => {
    expect(route).toMatch(/const exactTransactionRepeat\s*=\s*live\.status === "matched"/);
    expect(route).toContain("isExactTransactionDonationRepeat({");
    expect(route).toContain("(giftAlreadyImported && !exactTransactionRepeat)");
  });

  it("still sends the donation through the idempotent transactional activity core", () => {
    expect(route).toContain("donation: donationPayload");
    expect(route).toContain("import_fingerprint: fingerprint");
    expect(route).toContain('await recordOutcome(index, match.status === "new" ? "created" : "matched"');
  });
});
