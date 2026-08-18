import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HDate } from "@hebcal/core";
import {
  hebrewDateFromEnglish,
  hebrewMilestone,
  hebrewMonthDayFromEnglish,
  hebrewMonthName,
  nextHebrewAnniversary,
  nextHebrewOccurrence,
  nextYahrzeit,
} from "@/lib/hebrew";

/** A yahrzeit on the wrong day is the error the community would notice first. */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Freeze "today" so next-occurrence answers are deterministic. */
function freeze(dateISO: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${dateISO}T09:00:00`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Gregorian -> Hebrew conversion (reference dates verified against hebcal.com)", () => {
  it.each([
    // English date        month  day  rendered
    ["1990-08-12", 5, 21, "21st of Av, 5750"],
    ["2001-09-11", 6, 23, "23rd of Elul, 5761"],
    ["2024-03-24", 13, 14, "14th of Adar II, 5784"], // Purim 5784, a leap year
    ["2025-04-13", 1, 15, "15th of Nisan, 5785"], // first day of Pesach 5785
    ["2025-09-23", 7, 1, "1st of Tishrei, 5786"], // Rosh Hashanah 5786
  ])("%s is %i/%i on the Hebrew calendar", (english, month, day, rendered) => {
    expect(hebrewMonthDayFromEnglish(english)).toEqual({ month, day });
    expect(hebrewDateFromEnglish(english)).toBe(rendered);
  });

  it("reads only the date part of a timestamp", () => {
    expect(hebrewMonthDayFromEnglish("1990-08-12T00:00:00.000Z")).toEqual({ month: 5, day: 21 });
  });

  it("returns null rather than a wrong date for unusable input", () => {
    for (const bad of [null, undefined, "", "not-a-date", "1990-08"]) {
      expect(hebrewMonthDayFromEnglish(bad)).toBeNull();
      expect(hebrewDateFromEnglish(bad)).toBeNull();
    }
  });

  it("names months with Adar I and Adar II kept apart", () => {
    expect(hebrewMonthName(7)).toBe("Tishrei");
    expect(hebrewMonthName(12)).toBe("Adar (Adar I)");
    expect(hebrewMonthName(13)).toBe("Adar II");
  });
});

describe("next occurrence of a Hebrew month and day", () => {
  it("lands on the right Gregorian day and counts the days to it", () => {
    freeze("2025-09-01");
    const occ = nextHebrewOccurrence(7, 1); // 1 Tishrei -> 23 Sep 2025
    expect(occ).not.toBeNull();
    expect(iso(occ!.date)).toBe("2025-09-23");
    expect(occ!.days).toBe(22);
    expect(iso(occ!.eve)).toBe("2025-09-22"); // the Hebrew day begins the evening before
    expect(occ!.clamped).toBe(false);
  });

  it("fires on the day itself, not the day after", () => {
    freeze("2025-09-23");
    const occ = nextHebrewOccurrence(7, 1);
    expect(iso(occ!.date)).toBe("2025-09-23");
    expect(occ!.days).toBe(0);
  });

  it("rolls into the next Hebrew year once the date has passed", () => {
    freeze("2025-09-24");
    const occ = nextHebrewOccurrence(7, 1);
    expect(occ!.date.getFullYear()).toBe(2026);
    expect(new HDate(occ!.date).getFullYear()).toBe(5787);
  });

  it("returns null when there is no month or day stored", () => {
    freeze("2025-09-01");
    expect(nextHebrewOccurrence(0, 5)).toBeNull();
    expect(nextHebrewOccurrence(7, 0)).toBeNull();
  });
});

describe("Adar in leap years", () => {
  it("moves an Adar (12) yahrzeit to Adar II in a leap year", () => {
    freeze("2024-01-01"); // inside 5784, a leap year
    const occ = nextYahrzeit(12, 10);
    expect(occ).not.toBeNull();
    expect(occ!.hebrewMonth).toBe(13); // Adar II
    expect(iso(occ!.date)).toBe("2024-03-20");
    expect(occ!.hebrew).toContain("Adar II");
  });

  it("keeps an Adar (12) yahrzeit in Adar in a common year", () => {
    freeze("2026-01-01"); // inside 5786, not a leap year
    const occ = nextYahrzeit(12, 10);
    expect(occ!.hebrewMonth).toBe(12);
    expect(iso(occ!.date)).toBe("2026-02-27");
    expect(occ!.hebrew).not.toContain("Adar II");
  });

  it("folds an Adar II (13) date back to Adar when the year has only one Adar", () => {
    freeze("2026-01-01");
    const occ = nextHebrewOccurrence(13, 10);
    expect(occ!.hebrewMonth).toBe(12);
    expect(iso(occ!.date)).toBe("2026-02-27");
  });

  it("Purim-time dates in consecutive leap and common years both resolve", () => {
    expect(HDate.isLeapYear(5784)).toBe(true);
    expect(HDate.isLeapYear(5786)).toBe(false);
  });
});

describe("day clamping for short Cheshvan and Kislev", () => {
  it("clamps 30 Kislev to 29 Kislev in a year where Kislev is short", () => {
    expect(HDate.daysInMonth(9, 5784)).toBe(29);
    freeze("2023-10-01"); // inside 5784
    const occ = nextHebrewOccurrence(9, 30);
    expect(occ!.hebrewDay).toBe(29);
    expect(occ!.clamped).toBe(true);
    expect(iso(occ!.date)).toBe(iso(new HDate(29, 9, 5784).greg()));
  });

  it("clamps 30 Cheshvan to 29 Cheshvan in a year where Cheshvan is short", () => {
    expect(HDate.daysInMonth(8, 5784)).toBe(29);
    freeze("2023-10-01");
    const occ = nextHebrewOccurrence(8, 30);
    expect(occ!.hebrewDay).toBe(29);
    expect(occ!.clamped).toBe(true);
  });

  it("keeps day 30 when the month is long that year", () => {
    expect(HDate.daysInMonth(9, 5785)).toBe(30);
    freeze("2024-10-10"); // inside 5785
    const occ = nextHebrewOccurrence(9, 30);
    expect(occ!.hebrewDay).toBe(30);
    expect(occ!.clamped).toBe(false);
  });
});

describe("birthdays and anniversaries recur on the Hebrew date", () => {
  it("uses the Hebrew month and day of the English date, not the English one", () => {
    freeze("2025-07-01");
    const occ = nextHebrewAnniversary("1990-08-12"); // 21 Av
    expect(occ!.hebrewMonth).toBe(5);
    expect(occ!.hebrewDay).toBe(21);
    expect(iso(occ!.date)).toBe(iso(new HDate(21, 5, 5785).greg()));
    // The Gregorian day drifts year to year — that is the point.
    expect(iso(occ!.date)).not.toBe("2025-08-12");
  });

  it("returns null for a missing birth date instead of guessing", () => {
    freeze("2025-07-01");
    expect(nextHebrewAnniversary(null)).toBeNull();
    expect(nextHebrewAnniversary("")).toBeNull();
  });
});

describe("Hebrew-age milestones", () => {
  it("puts a bar mitzvah 13 Hebrew years after the Hebrew birthday", () => {
    const m = hebrewMilestone("2013-05-01", 13);
    expect(m).not.toBeNull();
    const born = new HDate(new Date(2013, 4, 1));
    expect(m!.hebrewYear).toBe(born.getFullYear() + 13);
    expect(m!.hebrewMonth).toBe(born.getMonth());
    expect(new HDate(m!.date).getFullYear()).toBe(born.getFullYear() + 13);
  });

  it("puts an 18th birthday 18 Hebrew years on", () => {
    const m = hebrewMilestone("2008-11-20", 18);
    const born = new HDate(new Date(2008, 10, 20));
    expect(m!.hebrewYear).toBe(born.getFullYear() + 18);
    expect(m!.date.getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("returns null without a birth date", () => {
    expect(hebrewMilestone(null, 13)).toBeNull();
  });
});
