import { describe, expect, it } from "vitest";
import { compareRecords, incomingPerson, type ReviewPerson } from "@/lib/review-merge";

const existing: ReviewPerson = {
  id: "p1",
  display_name: "Sarah Klein",
  first_name: " Sarah ",
  last_name: "Klein",
  email: "SARAH@EXAMPLE.COM ",
  phone: "(404) 555-1234",
  role: "Adult",
  birth_date: "1978-03-14",
  anniversary_date: null,
  school: null,
  notes: null,
  met_source: null,
  household_id: null,
  lifetime_giving: 0,
};

describe("import review compares meaning rather than formatting", () => {
  it("does not flag formatted phones, emails, names, or dates as conflicts", () => {
    const incoming = incomingPerson({
      first_name: "sarah",
      last_name: " klein ",
      email: " sarah@example.com",
      phone: "4045551234",
      birth_date: "3/14/1978",
    });
    const fields = compareRecords(existing, incoming);
    for (const key of ["first_name", "last_name", "email", "phone", "birth_date"])
      expect(fields.find((field) => field.key === key)?.state).toBe("same");
  });

  it("still flags a genuinely different phone number", () => {
    const fields = compareRecords(existing, incomingPerson({ phone: "4045559999" }));
    expect(fields.find((field) => field.key === "phone")?.state).toBe("conflict");
  });
});