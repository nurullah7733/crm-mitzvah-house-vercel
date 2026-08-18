import { describe, expect, it } from "vitest";
import { parseImportDate } from "@/lib/import-dates";

describe("parseImportDate", () => {
  it("reads the formats our files actually contain", () => {
    expect(parseImportDate("3/14/1978")).toBe("1978-03-14");
    expect(parseImportDate("1978-03-14")).toBe("1978-03-14");
    expect(parseImportDate("14-Mar-1978")).toBe("1978-03-14");
    expect(parseImportDate("March 14, 1978")).toBe("1978-03-14");
    expect(parseImportDate("14 March 1978")).toBe("1978-03-14");
    expect(parseImportDate("12/25/90")).toBe("1990-12-25");
    expect(parseImportDate("1978-03-14T00:00:00Z")).toBe("1978-03-14");
  });

  it("reads day-first dates without swapping the month", () => {
    expect(parseImportDate("14.3.1978")).toBe("1978-03-14");
    expect(parseImportDate("25/12/1990")).toBe("1990-12-25");
  });

  it("refuses anything it cannot trust instead of falling back to today", () => {
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate("not a date")).toBeNull();
    expect(parseImportDate("2/31/1978")).toBeNull();
    expect(parseImportDate(null)).toBeNull();
  });

  it("reads Excel serial numbers", () => {
    expect(parseImportDate("28564")).toBe("1978-03-14");
  });
});