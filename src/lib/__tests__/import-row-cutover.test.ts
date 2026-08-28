import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  new URL("../../routes/_authenticated/inbox.index.tsx", import.meta.url),
  "utf8",
);
const rowLoop = route.slice(
  route.indexOf("for (let index = 0; index < analysed.length; index++)"),
  route.indexOf("const { data: outcomeRows"),
);
const transactional = rowLoop.slice(
  rowLoop.indexOf("const transactionalRow = true as const"),
  rowLoop.indexOf("} else {", rowLoop.indexOf("const transactionalRow = true as const")),
);
const legacy = rowLoop.slice(
  rowLoop.indexOf("} else {", rowLoop.indexOf("const transactionalRow = true as const")),
  rowLoop.indexOf("} catch (rowError)"),
);

describe("normal CSV transactional row cutover", () => {
  it("calls resolve_import_row once for every direct row", () => {
    expect(transactional.match(/\.rpc\(\s*"resolve_import_row"/g)).toHaveLength(1);
    expect(rowLoop).toContain("for (let index = 0; index < analysed.length; index++)");
    expect(rowLoop).toContain("const transactionalRow = true as const");
  });

  it("keeps review-routed rows out of the transactional RPC", () => {
    const reviewContinue = rowLoop.indexOf("await recordOutcome(index, \"flagged\"");
    const rpcCall = rowLoop.indexOf('"resolve_import_row"');
    expect(reviewContinue).toBeGreaterThan(-1);
    expect(reviewContinue).toBeLessThan(rpcCall);
    expect(rowLoop.slice(reviewContinue, rpcCall)).toContain("continue;");
  });

  it("sends resolved spouse, children, and the complete registration array", () => {
    expect(transactional).toContain("_spouse: spousePayload as Json");
    expect(transactional).toContain("_children: childrenPayload as Json");
    expect(transactional).toContain("registrations: [...registrations.values()]");
    expect(transactional).toContain("registrations.set(targetEventId");
    expect(transactional).toContain("registrations.set(nearbyGroup.event.id");
  });

  it("uses one shared donation plan for net amount and fingerprint", () => {
    expect(transactional).toMatch(
      /const\s*\{\s*nearbyGroup,\s*nearbyDecision,\s*registrationFee,\s*donationAmount,\s*fingerprint,?\s*\}\s*=\s*giftPlan/,
    );
    expect(transactional).toContain("amount: donationAmount");
    expect(transactional).toContain("import_fingerprint: fingerprint");
    expect(transactional).not.toContain("donationFingerprintAfterRegistrationFee(");
  });

  it("does not execute the legacy independent write branch", () => {
    expect(transactional).toContain("if (transactionalRow)");
    expect(legacy).toContain('.from("people")');
    expect(route).toContain("Legacy household write path is disabled");
    expect(transactional).not.toContain('.from("people").insert');
    expect(transactional).not.toContain('.from("donations").insert');
    expect(transactional).not.toContain('.from("interactions").insert');
    expect(transactional).not.toContain("recordAttendance(");
    expect(transactional).not.toContain("attributeGiftToEvent(");
  });

  it("records RPC failure separately without marking success", () => {
    const rpcError = rowLoop.indexOf("if (resolveError) throw resolveError");
    const committed = rowLoop.indexOf("rowCommitted = true");
    const success = rowLoop.indexOf(
      'await recordOutcome(index, match.status === "new" ? "created" : "matched"',
    );
    const failure = rowLoop.indexOf("await recordImportRowFailureAndRethrow(");
    expect(rpcError).toBeLessThan(committed);
    expect(committed).toBeLessThan(success);
    expect(failure).toBeGreaterThan(success);
    expect(rowLoop.slice(rowLoop.indexOf("} catch (rowError)"))).not.toContain(
      'recordOutcome(index, "failed"',
    );
  });

  it("keeps successful rows committed independently", () => {
    expect(rowLoop).toContain("let rowCommitted = false");
    expect(rowLoop).toContain("if (rowCommitted) throw rowError");
    expect(rowLoop).toContain("rowNumber: index + 1");
  });
});
