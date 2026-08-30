import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Import Center CSV runtime path", () => {
  it("profiles uploads through profileImportFile without parsing CSV inline", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
    expect(source).toMatch(/import\s*\{[\s\S]*profileImportFile[\s\S]*\}\s*from\s*["']@\/lib\/import-workbook["']/);
    expect(source).toMatch(/await\s+profileImportFile\(file\)/);
    expect(source).not.toMatch(/Papa\.parse\s*\(/);
    expect(source).not.toMatch(/from\s+["']papaparse["']/);
  });
});
