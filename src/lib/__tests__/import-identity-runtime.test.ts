import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Import Center identity review gate", () => {
  it("queues an ambiguous live match and stops before selecting a person or writing activity", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
    const loop = source.indexOf("for (let index = 0; index < analysed.length; index++)");
    const ambiguousGate = source.indexOf('live.status === "ambiguous"', loop);
    const queue = source.indexOf("await queueForReview(", ambiguousGate);
    const stop = source.indexOf("continue;", queue);
    const personSelection = source.indexOf("let personId", ambiguousGate);

    expect(loop).toBeGreaterThan(-1);
    expect(ambiguousGate).toBeGreaterThan(loop);
    expect(queue).toBeGreaterThan(ambiguousGate);
    expect(stop).toBeGreaterThan(queue);
    expect(personSelection).toBeGreaterThan(stop);
  });

  it("preserves matcher candidates and reasons when creating review work", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
    expect(source).toContain("live.candidates.map((c) => c.id)");
    expect(source).toContain("live.status === \"ambiguous\" ? live.reason");
  });
});
