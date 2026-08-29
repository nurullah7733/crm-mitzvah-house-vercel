import { describe, expect, it } from "vitest";
import { parseImportDate, parseImportDateResult } from "@/lib/import-dates";
import { hebrewDateFromEnglish } from "@/lib/hebrew";

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

  it("reads Excel serials only from typed date cells", () => {
    expect(parseImportDate("28563")).toBeNull();
    expect(parseImportDateResult({ raw: 28563, display: "3/14/1978", kind: "date", format: "m/d/yyyy" })).toMatchObject({
      value: "1978-03-14",
      status: "valid",
      confidence: "typed",
    });
  });

  it("does not guess ambiguous numeric dates", () => {
    expect(parseImportDateResult("04/05/1988")).toEqual({
      value: null,
      status: "ambiguous",
      confidence: "none",
      interpretations: ["1988-04-05", "1988-05-04"],
    });
    expect(parseImportDateResult("8.9.2023").status).toBe("ambiguous");
    expect(parseImportDate("13.9.2023")).toBe("2023-09-13");
  });

  it.each(["3/14/1978", "1978-03-14", "14-Mar-1978", "12/25/90", "2/29/1992"])(
    "keeps %s parseable through Hebrew-date conversion",
    (raw) => {
      const parsed = parseImportDate(raw);
      expect(parsed).not.toBeNull();
      expect(hebrewDateFromEnglish(parsed)).not.toBeNull();
    },
  );
});
