import { describe, expect, it } from "vitest";
import { hebrewDateFromDeath, hebrewMonthDayFromDeath, hebrewMonthDayFromEnglish } from "@/lib/hebrew";
import { buildAcknowledgment, buildStatement, renderDocumentsHtml } from "@/lib/documents";
import { ORG_DEFAULTS } from "@/lib/org-settings";

const org = { ...ORG_DEFAULTS, name: "Mitzvah House", ein: "12-3456789" };
const donor = { id: "p1", name: "Anna Stronquist", addressLines: ["1 Peachtree St", "Atlanta, GA 30303"] };

describe("Hebrew sunset rule", () => {
  it("keeps the civil-date conversion when the passing was before sunset", () => {
    const plain = hebrewMonthDayFromEnglish("2024-03-10");
    expect(hebrewMonthDayFromDeath("2024-03-10", false)).toEqual(plain);
  });

  it("rolls to the next Hebrew day when the passing was after sunset", () => {
    const before = hebrewMonthDayFromDeath("2024-03-10", false)!;
    const after = hebrewMonthDayFromDeath("2024-03-10", true)!;
    expect(after).not.toEqual(before);
    // One Hebrew day later: either the day advances or the month rolls over.
    expect(after.day === before.day + 1 || after.day === 1).toBe(true);
  });

  it("renders a readable Hebrew date for both answers", () => {
    expect(hebrewDateFromDeath("2024-03-10", false)).toBeTruthy();
    expect(hebrewDateFromDeath("2024-03-10", true)).toBeTruthy();
    expect(hebrewDateFromDeath("2024-03-10", true)).not.toBe(
      hebrewDateFromDeath("2024-03-10", false),
    );
  });

  it("returns null for a missing death date instead of guessing", () => {
    expect(hebrewMonthDayFromDeath(null, true)).toBeNull();
    expect(hebrewMonthDayFromDeath("", false)).toBeNull();
  });
});

describe("year-end tax statements", () => {
  const gifts = [
    {
      id: "g2",
      date: "2025-06-01",
      amount: 100,
      designation: "Mitzvah Kitchen",
      method: "check",
      goods_or_services_provided: false,
      goods_or_services_description: null,
    },
    {
      id: "g1",
      date: "2025-01-15",
      amount: 18,
      designation: "General",
      method: "card",
      goods_or_services_provided: false,
      goods_or_services_description: null,
    },
  ];

  it("lists every gift oldest first and totals them", () => {
    const doc = buildStatement({ donor, taxYear: 2025, gifts, org });
    expect(doc.gifts.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(doc.total).toBe(118);
    expect(doc.taxYear).toBe(2025);
  });

  it("includes the organization identity, EIN and IRS substantiation language", () => {
    const doc = buildStatement({ donor, taxYear: 2025, gifts, org });
    expect(doc.substantiation).toMatch(/no goods or services were provided/i);
    const html = renderDocumentsHtml([doc], "2025 statement");
    expect(html).toContain("Mitzvah House");
    expect(html).toContain("12-3456789");
    expect(html).toContain("Anna Stronquist");
  });

  it("notes gifts that did receive goods or services instead of claiming none did", () => {
    const doc = buildStatement({
      donor,
      taxYear: 2025,
      gifts: [
        {
          ...gifts[0]!,
          goods_or_services_provided: true,
          goods_or_services_description: "Gala dinner, $60 value",
        },
      ],
      org,
    });
    expect(doc.quidProQuoNotes.join(" ")).toContain("Gala dinner");
  });
});

describe("acknowledgment letters", () => {
  it("merges donor name, amount, date and designation into the body", () => {
    const doc = buildAcknowledgment({
      donor,
      gift: {
        id: "g1",
        date: "2025-01-15",
        amount: 18,
        designation: "Mitzvah Kitchen",
        method: "card",
        goods_or_services_provided: false,
        goods_or_services_description: null,
      },
      org,
    });
    const text = `${doc.body} ${doc.greeting ?? ""}`;
    expect(text).toContain("Anna Stronquist");
    expect(text).toContain("18");
    expect(text).toContain("Mitzvah Kitchen");
  });
});
