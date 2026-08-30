import { describe, expect, it } from "vitest";
import {
  REPEATABLE_FIELDS,
  addressKey,
  buildFileClaimGraph,
  correlateFileMatch,
  composeAddress,
  guessColumn,
  guessMapping,
  matchRow,
  matchRowOnce,
  newRowIdentityRegistry,
  resolveCoupleClaims,
  hasOwnershipSensitiveCoupleContent,
  needsCoupleActivityOwnerReview,
  roleFromRow,
  rowIdentityKeys,
  donationImportFingerprintFromCents,
  logicalFilePerson,
  splitFullName,
  splitName,
  splitPeopleList,
  type ExistingPerson,
  type FieldKey,
} from "@/lib/import-mapping";
import { buildRowValues } from "@/lib/import-rows";
import { decideCoupleName, presentCoupleDecision } from "@/lib/couple-semantics";
import { readFileSync } from "node:fs";

const fields = (headers: string[]) => guessMapping(headers).map((g) => g.field);

describe("header synonyms map to the right field", () => {
  it.each<[string, FieldKey]>([
    ["First Name", "first_name"],
    ["fname", "first_name"],
    ["Parent 1 First Name", "first_name"],
    ["Last Name", "last_name"],
    ["Surname", "last_name"],
    ["Full Name", "full_name"],
    ["Donor Name", "full_name"],
    ["E-Mail", "email"],
    ["Email Address", "email"],
    ["Work Email", "email_work"],
    ["Cell Phone", "phone_mobile"],
    ["Home Phone", "phone_home"],
    ["Office Phone", "phone_work"],
    ["Phone 2", "phone_other"],
    ["Street Address", "address"],
    ["Address 1", "address"],
    ["Mailing Street", "address"],
    ["Address Line 2", "address_line2"],
    ["Apt", "address_line2"],
    ["ZIP Code", "postal_code"],
    ["City", "city"],
    ["Mailing City", "city"],
    ["State", "state"],
    ["State/Province", "state"],
    ["Mailing State/Province", "state"],
    ["ZIP/Postal Code", "postal_code"],
    ["Mailing Zip/Postal Code", "postal_code"],
    ["Household Name", "household_name"],
    ["Date of Birth", "birth_date"],
    ["DOB", "birth_date"],
    ["Wedding Anniversary", "anniversary_date"],
    ["Gift Amount", "amount"],
    ["Gift Date", "date"],
    ["Appeal", "campaign"],
    ["Event Name", "event_name"],
    ["Tags", "tags"],
    ["Programs", "programs"],
    ["Lead Source", "met_source"],
    ["Spouse Name", "spouse_full_name"],
    ["Child 1 Name", "child_name"],
    ["Student School", "child_school"],
  ])("%s -> %s", (header, field) => {
    expect(guessColumn(header).field).toBe(field);
  });

  it("ignores punctuation, casing and separators in headers", () => {
    expect(guessColumn("  FIRST_NAME ").field).toBe("first_name");
    expect(guessColumn("Zip-Code").field).toBe("postal_code");
  });

  it("puts a header it doesn't understand on 'don't import' instead of guessing wildly", () => {
    expect(guessColumn("qqqqzzz internal ref 7").field).toBe("ignore");
    expect(guessColumn("").field).toBe("ignore");
  });

  it("never maps two columns onto the same single-value field", () => {
    const mapped = fields(["First Name", "First Name", "Email", "Email"]);
    expect(mapped[0]).toBe("first_name");
    expect(mapped[1]).toBe("ignore");
    expect(mapped[2]).toBe("email");
    // A second email column becomes an extra email rather than being dropped.
    expect(mapped[3]).toBe("email_other");
  });

  it("maps the sanitized live-QA structure without consuming the primary email target", () => {
    const headers = [
      "First Name",
      "Last Name",
      "Mailing Street",
      "Mailing City",
      "Mailing State/Province",
      "Mailing Zip/Postal Code",
      "Phone",
      "Email",
      "Close Date",
      "Amount",
      "Primary Campaign Source",
      "Date of Birth",
    ];
    expect(fields(headers)).toEqual([
      "first_name",
      "last_name",
      "address",
      "city",
      "state",
      "postal_code",
      "phone",
      "email",
      "date",
      "amount",
      "campaign",
      "birth_date",
    ]);
    expect(guessMapping(headers)[7]).toMatchObject({ field: "email", confidence: "high" });
  });

  it("keeps multiple genuine email columns on repeatable email targets", () => {
    expect(fields(["Email", "Work Email", "Other Email"])).toEqual([
      "email",
      "email_work",
      "email_other",
    ]);
  });

  it("lets repeatable child and phone columns all stay mapped", () => {
    const mapped = fields([
      "Child 1 Name",
      "Child 2 Name",
      "Child 3 Name",
      "Cell Phone",
      "Home Phone",
      "Work Phone",
    ]);
    expect(mapped).toEqual([
      "child_name",
      "child_name",
      "child_name",
      "phone_mobile",
      "phone_home",
      "phone_work",
    ]);
    for (const f of mapped) expect(REPEATABLE_FIELDS).toContain(f);
  });
});

describe("couple and household name semantics", () => {
  it.each([
    ["John & Sarah Smith", "John Smith", "Sarah Smith"],
    ["John and Sarah Smith", "John Smith", "Sarah Smith"],
    ["John Smith & Sarah Cohen", "John Smith", "Sarah Cohen"],
  ])("recognizes a representable couple: %s", (raw, first, second) => {
    const decision = decideCoupleName(raw);
    expect(decision.kind).toBe("confident_couple");
    expect(decision.person1?.display).toBe(first);
    expect(decision.person2?.display).toBe(second);
  });

  it.each(["John & Sarah", "Mr. & Mrs. Smith", "John/Sarah Smith"])(
    "routes incomplete couple names to review: %s",
    (raw) => expect(decideCoupleName(raw).kind).toBe("ambiguous_couple"),
  );

  it("treats family labels as household-only semantics", () => {
    expect(decideCoupleName("Smith Family").kind).toBe("household_only");
  });

  it("does not split organization names containing an ampersand", () => {
    const decision = decideCoupleName("Smith & Cohen Foundation");
    expect(decision.kind).toBe("single_person");
    expect(decision.evidence.organization).toBe(true);
  });

  it("maps a safe full-name couple into two explicit claims", () => {
    const values = buildRowValues(
      ["John & Sarah Smith"],
      [{ field: "full_name", header: "Name", confidence: "high" }],
    );
    expect(values.first_name).toBe("John");
    expect(values.last_name).toBe("Smith");
    expect(values.spouse_first_name).toBe("Sarah");
    expect(values.spouse_last_name).toBe("Smith");
    expect(values.couple_decision?.kind).toBe("confident_couple");
  });

  it("does not present a confident couple as a single new contact", () => {
    const decision = decideCoupleName("John & Sarah Smith");
    expect(presentCoupleDecision(decision, "new")).toEqual({
      status: "couple",
      reason: "Confident couple: two named people",
      willCreate: "two contacts",
    });
  });

  it("keeps the shared email on the row without collapsing the two claims", () => {
    const values = buildRowValues(
      ["John & Sarah Smith", "m2d.d1.smith@example.test"],
      [
        { field: "full_name", header: "Full Name", confidence: "high" },
        { field: "email", header: "Email", confidence: "high" },
      ],
    );
    expect(values.couple_decision?.person1?.display).toBe("John Smith");
    expect(values.couple_decision?.person2?.display).toBe("Sarah Smith");
    expect(values.email).toBe("m2d.d1.smith@example.test");
    expect(values.spouse_email).toBeUndefined();
  });

  it("classifies explicit partner columns as a couple", () => {
    const values = buildRowValues(
      [
        "David",
        "Levine",
        "m2d.d4.family@example.test",
        "Rachel",
        "Levine",
        "m2d.d4.family@example.test",
      ],
      [
        { field: "first_name", header: "First Name", confidence: "high" },
        { field: "last_name", header: "Last Name", confidence: "high" },
        { field: "email", header: "Email", confidence: "high" },
        { field: "spouse_first_name", header: "Partner First Name", confidence: "high" },
        { field: "spouse_last_name", header: "Partner Last Name", confidence: "high" },
        { field: "spouse_email", header: "Partner Email", confidence: "high" },
      ],
    );
    expect(values.couple_decision?.kind).toBe("confident_couple");
    expect(values.couple_decision?.person1?.display).toBe("David Levine");
    expect(values.couple_decision?.person2?.display).toBe("Rachel Levine");
    expect(values.email).toBe("m2d.d4.family@example.test");
    expect(values.spouse_email).toBe("m2d.d4.family@example.test");
  });

  it("resolves both existing spouses in one household without creating a partner", () => {
    const values = buildRowValues(
      ["Noah", "Bernstein", "noah@example.test", "Leah", "Bernstein", "leah@example.test"],
      [
        { field: "first_name", header: "First Name", confidence: "high" },
        { field: "last_name", header: "Last Name", confidence: "high" },
        { field: "email", header: "Email", confidence: "high" },
        { field: "spouse_first_name", header: "Partner First Name", confidence: "high" },
        { field: "spouse_last_name", header: "Partner Last Name", confidence: "high" },
        { field: "spouse_email", header: "Partner Email", confidence: "high" },
      ],
    );
    const people: ExistingPerson[] = [
      {
        id: "noah",
        first_name: "Noah",
        last_name: "Bernstein",
        email: "noah@example.test",
        phone: null,
        household_id: "h1",
      },
      {
        id: "leah",
        first_name: "Leah",
        last_name: "Bernstein",
        email: "leah@example.test",
        phone: null,
        household_id: "h1",
      },
    ];
    const result = resolveCoupleClaims(values, people);
    expect(result?.kind).toBe("safe");
    expect(result?.main.candidates[0]?.id).toBe("noah");
    expect(result?.partner.candidates[0]?.id).toBe("leah");
  });

  it("routes existing spouses in different households before any write", () => {
    const values = buildRowValues(
      ["Noah", "Bernstein", "noah@example.test", "Leah", "Bernstein", "leah@example.test"],
      [
        { field: "first_name", header: "First Name", confidence: "high" },
        { field: "last_name", header: "Last Name", confidence: "high" },
        { field: "email", header: "Email", confidence: "high" },
        { field: "spouse_first_name", header: "Partner First Name", confidence: "high" },
        { field: "spouse_last_name", header: "Partner Last Name", confidence: "high" },
        { field: "spouse_email", header: "Partner Email", confidence: "high" },
      ],
    );
    const people: ExistingPerson[] = [
      {
        id: "noah",
        first_name: "Noah",
        last_name: "Bernstein",
        email: "noah@example.test",
        phone: null,
        household_id: "h1",
      },
      {
        id: "leah",
        first_name: "Leah",
        last_name: "Bernstein",
        email: "leah@example.test",
        phone: null,
        household_id: "h2",
      },
    ];
    expect(resolveCoupleClaims(values, people)?.kind).toBe("household_conflict");
    expect(resolveCoupleClaims(values, people)?.reason).toBe(
      "Both people already exist but belong to different households.",
    );
  });

  it("keeps preview and approval on the structured couple decision path", () => {
    const source = readFileSync("src/routes/_authenticated/inbox.index.tsx", "utf8");
    expect(source).toContain("presentCoupleDecision(");
    expect(source).toContain("activityOwnerReview");
    expect(source).toContain("const coupleDecision = v.couple_decision");
    expect(source).toContain('action: "create"');
    expect(source).toContain("spouse_first_name");
    expect(source).not.toContain("first_name: v.full_name");
  });

  it("uses one ownership rule for couple activity-sensitive content", () => {
    const couple = decideCoupleName("John & Sarah Smith");
    expect(needsCoupleActivityOwnerReview({ couple_decision: couple, amount: "72" })).toBe(true);
    expect(needsCoupleActivityOwnerReview({ couple_decision: couple, event_name: "Dinner" })).toBe(
      true,
    );
    expect(needsCoupleActivityOwnerReview({ couple_decision: couple, notes: "Please call" })).toBe(
      true,
    );
    expect(needsCoupleActivityOwnerReview({ couple_decision: couple, tags: "Board" })).toBe(true);
    expect(needsCoupleActivityOwnerReview({ couple_decision: couple, programs: "Learning" })).toBe(
      true,
    );
    expect(
      needsCoupleActivityOwnerReview({ couple_decision: couple, campaign: "Annual Fund" }),
    ).toBe(false);
    expect(
      needsCoupleActivityOwnerReview({ couple_decision: couple, person_notes: "Member" }),
    ).toBe(false);
    expect(hasOwnershipSensitiveCoupleContent({ first_name: "John" })).toBe(false);
  });
});

describe("splitting names", () => {
  it("keeps separate first and last name columns exactly as given", () => {
    expect(splitName({ first_name: "Chana", last_name: "ben David" })).toMatchObject({
      first: "Chana",
      last: "ben David",
    });
  });

  it("splits a combined name column the same way", () => {
    expect(splitName({ full_name: "Chana ben David" })).toMatchObject({
      first: "Chana",
      last: "ben David",
    });
  });

  it("keeps multi-word surnames together", () => {
    expect(splitFullName("Chana ben David")).toMatchObject({
      first: "Chana",
      middle: "",
      last: "ben David",
    });
    expect(splitFullName("Yosef bat Sara")).toMatchObject({ first: "Yosef", last: "bat Sara" });
    expect(splitFullName("Maria van der Berg")).toMatchObject({
      first: "Maria",
      last: "van der Berg",
    });
    expect(splitFullName("Jean de la Cruz")).toMatchObject({ first: "Jean", last: "de la Cruz" });
  });

  it("handles titles, suffixes, middle names and 'Last, First'", () => {
    expect(splitFullName("Rabbi Levi Cohen Jr")).toMatchObject({
      first: "Levi",
      last: "Cohen",
      suffix: "Jr",
    });
    expect(splitFullName("Cohen, Levi")).toMatchObject({ first: "Levi", last: "Cohen" });
    expect(splitFullName("Cohen, Levi Jr")).toMatchObject({
      first: "Levi",
      last: "Cohen",
      suffix: "Jr",
    });
    expect(splitFullName("Sara Leah Goldberg")).toMatchObject({
      first: "Sara",
      middle: "Leah",
      last: "Goldberg",
    });
  });

  it("copes with one-word and empty names without inventing a surname", () => {
    expect(splitFullName("Miriam")).toMatchObject({ first: "Miriam", last: "" });
    expect(splitFullName("")).toMatchObject({ first: "", last: "" });
  });

  it("fills only the missing half from a combined column", () => {
    expect(splitName({ last_name: "Katz", full_name: "Devorah Katz" })).toMatchObject({
      first: "Devorah",
      last: "Katz",
    });
  });

  it("splits a cell holding several names", () => {
    expect(splitPeopleList("Leah, Moshe and Sara")).toEqual(["Leah", "Moshe", "Sara"]);
  });
});

describe("unpacking a row into people", () => {
  const build = (headers: string[], row: string[]) => buildRowValues(row, guessMapping(headers));

  it("creates one child record per child column", () => {
    const v = build(
      ["First Name", "Last Name", "Child 1 Name", "Child 2 Name", "Child 3 Name"],
      ["Yosef", "Katz", "Leah Katz", "Moshe Katz", ""],
    );
    expect(v.children).toHaveLength(2);
    expect(v.children?.map((c) => `${c.first} ${c.last ?? ""}`.trim())).toEqual([
      "Leah Katz",
      "Moshe Katz",
    ]);
  });

  it("creates children from paired first/last columns too, with their own details", () => {
    const v = build(
      ["Full Name", "Child 1 First Name", "Child 1 Last Name", "Child 1 DOB", "Child 1 School"],
      ["Yosef Katz", "Leah", "Katz", "2015-03-04", "atlanta jewish academy"],
    );
    expect(v.children).toHaveLength(1);
    expect(v.children?.[0]).toMatchObject({
      first: "Leah",
      last: "Katz",
      birth_date: "2015-03-04",
      school: "Atlanta Jewish Academy",
    });
  });

  it("collects every phone column, keeping the first as the primary", () => {
    const v = build(
      ["First Name", "Cell Phone", "Home Phone", "Work Phone"],
      ["Yosef", "404-555-0100", "404-555-0101", "404-555-0102"],
    );
    expect(v.phones).toHaveLength(3);
    expect(v.phones?.map((p) => p.method_type)).toEqual(["Mobile", "Home", "Work"]);
    expect(v.phone).toBe("4045550100");
  });

  it("splits several numbers inside one cell", () => {
    const v = build(["Cell Phone"], ["404-555-0100 / 404-555-0199"]);
    expect(v.phones?.map((p) => p.value)).toEqual(["4045550100", "4045550199"]);
  });

  it("collects several email columns and lower-cases them", () => {
    const v = build(["Email", "Work Email"], ["Yosef@Example.COM", "yk@work.com"]);
    expect(v.emails?.map((e) => e.value)).toEqual(["yosef@example.com", "yk@work.com"]);
    expect(v.email).toBe("yosef@example.com");
  });

  it("tidies capitalisation of names and addresses without touching spelling", () => {
    const v = build(
      ["Full Name", "Street Address", "City", "State"],
      ["yosef katz", "123 main st", "atlanta", "ga"],
    );
    expect(v.full_name).toBe("Yosef Katz");
    expect(v.address).toBe("123 Main St");
    expect(v.city).toBe("Atlanta");
    expect(v.state).toBe("GA"); // two-letter codes are upper-cased
  });

  it.each([
    ["3/14/1978", "1978-03-14"],
    ["1978-03-14", "1978-03-14"],
    ["14-Mar-1978", "1978-03-14"],
    ["12/25/90", "1990-12-25"],
    ["2/29/1992", "1992-02-29"],
  ])("carries a mapped birth date through the row builder: %s", (raw, expected) => {
    const v = build(["First Name", "Last Name", "Date of Birth"], ["Test", "Person", raw]);
    expect(v.birth_date).toBe(expected);
  });
});

describe("addresses", () => {
  it("builds one readable address from the columns present", () => {
    expect(
      composeAddress({
        address: "123 Main St",
        address_line2: "Apt 4",
        city: "Atlanta",
        state: "GA",
        postal_code: "30329",
      }),
    ).toBe("123 Main St\nApt 4\nAtlanta, GA 30329");
    expect(composeAddress({})).toBeNull();
  });

  it("gives two spellings of the same address the same grouping key", () => {
    const a = addressKey("123 Main Street\nApt 4\nAtlanta, GA 30329");
    expect(a).toBe(addressKey("123 main st apt 4, atlanta ga 30329"));
    expect(a).not.toBeNull();
  });

  it("refuses to group on a scrap of an address", () => {
    expect(addressKey("apt")).toBeNull();
    expect(addressKey("")).toBeNull();
  });
});

describe("adult or child", () => {
  it("reads the role column first", () => {
    expect(roleFromRow({ role: "Student" })).toBe("Child");
    expect(roleFromRow({ role: "Parent" })).toBe("Adult");
  });

  it("falls back to age, then birth date", () => {
    expect(roleFromRow({ age: "9" })).toBe("Child");
    expect(roleFromRow({ age: "42" })).toBe("Adult");
    expect(roleFromRow({ birth_date: "2015-01-01" })).toBe("Child");
    expect(roleFromRow({ birth_date: "1975-01-01" })).toBe("Adult");
  });

  it("defaults to adult when nothing says otherwise", () => {
    expect(roleFromRow({})).toBe("Adult");
  });
});

describe("matching a row to existing contacts", () => {
  const person = (over: Partial<ExistingPerson>): ExistingPerson => ({
    id: "p1",
    first_name: "Yosef",
    last_name: "Katz",
    email: "yosef@example.com",
    phone: "404-555-0100",
    household_id: "h1",
    households: { name: "Katz", address: "123 Main St" },
    contact_methods: [],
    ...over,
  });

  it("matches on email, phone, then name + address", () => {
    const people = [person({})];
    expect(matchRow({ email: "YOSEF@example.com" }, people).status).toBe("matched");
    expect(matchRow({ phone: "(404) 555-0100" }, people).reason).toBe("Same phone number");
    expect(
      matchRow({ first_name: "Yosef", last_name: "Katz", address: "123 Main St" }, people).status,
    ).toBe("matched");
  });

  it("normalizes road and apartment spellings during duplicate detection", () => {
    const people = [person({ households: { name: "Katz", address: "123 Main Road #3B" } })];
    const result = matchRow(
      { first_name: "Yosef", last_name: "Katz", address: "123 Main Rd", address_line2: "Apt 3B" },
      people,
    );
    expect(result.status).toBe("matched");
    expect(result.reason).toBe("Same name and same address");
  });

  it("matches a secondary phone or email held on the contact", () => {
    const people = [
      person({
        email: null,
        phone: null,
        contact_methods: [{ kind: "phone", value: "404-555-0199" }],
      }),
    ];
    expect(matchRow({ phone: "4045550199" }, people).status).toBe("matched");
  });

  it("flags rather than merges when the same name lives at a different address", () => {
    const r = matchRow({ first_name: "Yosef", last_name: "Katz", address: "999 Other Rd" }, [
      person({ email: null, phone: null }),
    ]);
    expect(r.status).toBe("ambiguous");
    expect(r.reason).toBe("Same name, but a different address");
  });

  it("flags when two contacts share the email", () => {
    const r = matchRow({ email: "yosef@example.com" }, [person({}), person({ id: "p2" })]);
    expect(r.status).toBe("ambiguous");
  });

  it("calls a genuinely unknown person new", () => {
    expect(
      matchRow({ first_name: "New", last_name: "Person", email: "new@example.com" }, [person({})])
        .status,
    ).toBe("new");
  });
});

describe("the same person twice inside one file", () => {
  const f12 = (transaction_id: string) => ({
    first_name: "F12",
    last_name: "TxDonor",
    email: "m2f.f12@example.test",
    amount: "72",
    date: "2026-08-29",
    campaign: "M2F Shared Campaign",
    transaction_id,
  });

  it.each([
    ["TX-1", "TX-2"],
    ["TX-2", "TX-1"],
  ])("keeps distinct transaction gifts safe in either order (%s then %s)", (firstId, secondId) => {
    const rows = [f12(firstId), f12(secondId)];
    const graph = buildFileClaimGraph(rows);
    const seen = newRowIdentityRegistry();
    const matches = rows.map((row, index) =>
      correlateFileMatch(matchRowOnce(row, [], seen, index), graph, index),
    );
    expect(matches.map((match) => match.status)).toEqual(["matched", "matched"]);
    expect(matches.map((match) => match.reason)).toEqual([
      "Same person elsewhere in this file",
      "Same person elsewhere in this file",
    ]);
    expect(logicalFilePerson(graph, 0)?.id).toBe(logicalFilePerson(graph, 1)?.id);
  });

  it("still detects the same external transaction twice", () => {
    const seen = newRowIdentityRegistry();
    expect(matchRowOnce(f12("TX-1"), [], seen, 0).status).toBe("new");
    const duplicate = matchRowOnce(f12(" tx-1 "), [], seen, 1);
    expect(duplicate.status).toBe("ambiguous");
    expect(duplicate.reason).toBe("Appears more than once in this file (also row 1)");
  });

  it("keeps the existing date, amount, and campaign fallback when transaction ID is blank", () => {
    const seen = newRowIdentityRegistry();
    expect(matchRowOnce(f12(""), [], seen, 0).status).toBe("new");
    expect(matchRowOnce(f12("  "), [], seen, 1).reason).toBe(
      "Appears more than once in this file (also row 1)",
    );
  });

  it("keeps TX-1 and TX-2 donation fingerprints distinct", () => {
    expect(donationImportFingerprintFromCents(f12("TX-1"), 7200, "2026-08-29"))
      .toBe("email:m2f.f12@example.test|transaction|tx-1");
    expect(donationImportFingerprintFromCents(f12("TX-2"), 7200, "2026-08-29"))
      .toBe("email:m2f.f12@example.test|transaction|tx-2");
  });

  it("does not confuse a repeated person with a repeated activity occurrence", () => {
    const seen = newRowIdentityRegistry();
    const row = { first_name: "Yosef", last_name: "Katz", email: "yosef@example.com" };
    expect(matchRowOnce(row, [], seen, 0).status).toBe("new");
    const second = matchRowOnce({ ...row }, [], seen, 1);
    expect(second.status).toBe("new");
  });

  it("allows separate gifts for the same person while still catching an identical gift", () => {
    const seen = newRowIdentityRegistry();
    const first = {
      first_name: "Yosef",
      last_name: "Katz",
      amount: "18",
      date: "3/14/2025",
    };
    expect(matchRowOnce(first, [], seen, 0).status).toBe("new");
    expect(matchRowOnce({ ...first, amount: "36" }, [], seen, 1).status).toBe("new");
    expect(matchRowOnce({ ...first }, [], seen, 2).status).toBe("ambiguous");
  });

  it("keeps a repeated phone with a conflicting name in identity review", () => {
    const seen = newRowIdentityRegistry();
    matchRowOnce({ first_name: "Yosef", last_name: "Katz", phone: "404-555-0100" }, [], seen, 0);
    const second = matchRowOnce(
      { first_name: "Joe", last_name: "Katz", phone: "(404) 555-0100" },
      [],
      seen,
      1,
    );
    expect(second.status).toBe("ambiguous");
  });

  it("re-checking the same row index stays stable, so a preview and the import agree", () => {
    const seen = newRowIdentityRegistry();
    const row = { email: "a@example.com", first_name: "A", last_name: "B" };
    expect(matchRowOnce(row, [], seen, 0).status).toBe("new");
    expect(matchRowOnce(row, [], seen, 0).status).toBe("new");
  });

  it("lists every identity a row carries, email first", () => {
    const keys = rowIdentityKeys({
      email: "a@example.com",
      phone: "404-555-0100",
      first_name: "A",
      last_name: "B",
    });
    expect(keys[0]).toBe("email:a@example.com");
    expect(keys).toContain("phone:4045550100");
    expect(keys).toContain("name:a b");
  });
});

describe("D10 file person claim graph", () => {
  const couple = decideCoupleName("Noah Adler & Rivka Adler");
  const coupleRow = {
    first_name: "Noah",
    last_name: "Adler",
    email: "m2d.d10.noah@example.test",
    spouse_first_name: "Rivka",
    spouse_last_name: "Adler",
    spouse_email: "m2d.d10.rivka@example.test",
    couple_decision: couple,
  };
  const noah = {
    first_name: "Noah",
    last_name: "Adler",
    email: "m2d.d10.noah@example.test",
  };
  const rivka = {
    first_name: "Rivka",
    last_name: "Adler",
    email: "m2d.d10.rivka@example.test",
  };

  it.each([
    [coupleRow, noah, rivka],
    [noah, rivka, coupleRow],
    [rivka, coupleRow, noah],
  ])("finds exactly two people independent of row ordering", (...rows) => {
    const graph = buildFileClaimGraph(rows);
    expect(graph.people).toHaveLength(2);
    expect(graph.people.map((person) => person.claims.length).sort()).toEqual([2, 2]);
  });

  it("correlates the main and partner claims with their individual rows", () => {
    const graph = buildFileClaimGraph([coupleRow, noah, rivka]);
    expect(logicalFilePerson(graph, 0, "main")?.id).toBe(logicalFilePerson(graph, 1)?.id);
    expect(logicalFilePerson(graph, 0, "partner")?.id).toBe(logicalFilePerson(graph, 2)?.id);
  });

  it("keeps an agreeing email with a conflicting birth date in review", () => {
    const graph = buildFileClaimGraph([
      { ...noah, birth_date: "1980-01-01" },
      { ...noah, birth_date: "1990-01-01" },
    ]);
    expect(graph.people.some((person) => person.conflicted)).toBe(true);
  });

  it("keeps a shared phone with incompatible identity details in review", () => {
    const graph = buildFileClaimGraph([
      { first_name: "Noah", last_name: "Adler", phone: "4045550100", birth_date: "1980-01-01" },
      { first_name: "Rachel", last_name: "Cohen", phone: "4045550100", birth_date: "1990-01-01" },
    ]);
    expect(graph.people.some((person) => person.conflicted)).toBe(true);
    expect(graph.people).toHaveLength(2);
  });

  it("does not correlate exact names without a strong identity signal", () => {
    expect(buildFileClaimGraph([{ first_name: "Noah", last_name: "Adler" }, { first_name: "Noah", last_name: "Adler" }]).people).toHaveLength(2);
  });

  it("does not collapse spouses that share a contact method on one row", () => {
    const graph = buildFileClaimGraph([
      { ...coupleRow, spouse_email: coupleRow.email },
    ]);
    expect(graph.people).toHaveLength(2);
  });
});

describe("duplicate matching only fires on real signals", () => {
  const people = [
    {
      id: "p1",
      first_name: "Sarah",
      last_name: "Klein",
      email: null,
      phone: null,
      birth_date: "1978-03-14",
      household_id: null,
      households: { name: "Klein", address: "12 Oak St" },
    },
  ];

  it("does not flag an unrelated person who only shares being an adult", () => {
    const r = matchRow({ first_name: "David", last_name: "Rosen", role: "Adult" }, people);
    expect(r.status).toBe("new");
  });

  it("confirms a match when the name and birth date agree", () => {
    const r = matchRow(
      { first_name: "Sarah", last_name: "Klein", birth_date: "3/14/1978" },
      people,
    );
    expect(r.status).toBe("matched");
    expect(r.reason).toBe("Same name and same birth date");
  });

  it("routes a same-name person with a different birth date to review", () => {
    const r = matchRow(
      { first_name: "Sarah", last_name: "Klein", birth_date: "1990-01-02" },
      people,
    );
    expect(r.status).toBe("ambiguous");
    expect(r.reason).toContain("birth date differs");
  });

  it("treats a typo in the name as a signal only with an address or birth date", () => {
    expect(matchRow({ first_name: "Sara", last_name: "Klein" }, people).status).toBe("ambiguous");
    expect(
      matchRow({ first_name: "Sara", last_name: "Klein", birth_date: "1990-01-02" }, people).status,
    ).toBe("ambiguous");
  });
});

describe("identity conflict engine", () => {
  const person = (over: Partial<ExistingPerson> = {}): ExistingPerson => ({
    id: "p1",
    first_name: "Sarah",
    last_name: "Klein",
    email: "same@example.test",
    phone: "404-555-0100",
    birth_date: "1980-01-01",
    household_id: "h1",
    households: { name: "Klein", address: "120 Oak Street" },
    contact_methods: [],
    ...over,
  });

  it("vetoes an email match when birth dates conflict", () => {
    const result = matchRow(
      {
        first_name: "Sarah",
        last_name: "Klein",
        email: "same@example.test",
        birth_date: "1995-07-12",
      },
      [person()],
    );
    expect(result.status).toBe("ambiguous");
    expect(result.reason).toBe("Email matches, but birth date differs.");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["p1"]);
  });

  it("vetoes a phone match when birth dates conflict", () => {
    const result = matchRow({ phone: "4045550100", birth_date: "1995-07-12" }, [person()]);
    expect(result.status).toBe("ambiguous");
    expect(result.reason).toBe("Phone matches, but birth date differs.");
  });

  it("matches agreeing email, birth date, and close name", () => {
    expect(
      matchRow(
        {
          first_name: "Sara",
          last_name: "Klein",
          email: "SAME@EXAMPLE.TEST",
          birth_date: "1/1/1980",
        },
        [person()],
      ).status,
    ).toBe("matched");
  });

  it("does not auto-match an exact name by itself", () => {
    const result = matchRow({ first_name: "Sarah", last_name: "Klein" }, [person()]);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["p1"]);
  });

  it("matches an exact name plus exact birth date", () => {
    expect(
      matchRow(
        {
          first_name: "Sarah",
          last_name: "Klein",
          birth_date: "1980-01-01",
        },
        [person()],
      ).status,
    ).toBe("matched");
  });

  it("normalizes formatted phones and email casing", () => {
    expect(matchRow({ phone: "+1 (404) 555-0100" }, [person()]).status).toBe("matched");
    expect(matchRow({ email: "SAME@EXAMPLE.TEST" }, [person()]).status).toBe("matched");
  });

  it("preserves every candidate sharing an email or phone", () => {
    const people = [person(), person({ id: "p2", first_name: "Rachel" })];
    const email = matchRow({ email: "same@example.test" }, people);
    const phone = matchRow({ phone: "4045550100" }, people);
    expect(email.status).toBe("ambiguous");
    expect(email.candidates.map((candidate) => candidate.id)).toEqual(["p1", "p2"]);
    expect(phone.status).toBe("ambiguous");
    expect(phone.candidates.map((candidate) => candidate.id)).toEqual(["p1", "p2"]);
  });

  it("does not invent a DOB conflict when the incoming DOB is blank", () => {
    expect(matchRow({ email: "same@example.test" }, [person()]).status).toBe("matched");
  });

  it("allows a changed address when strong identity otherwise agrees", () => {
    expect(
      matchRow(
        {
          first_name: "Sarah",
          last_name: "Klein",
          email: "same@example.test",
          address: "99 New Road",
        },
        [person()],
      ).status,
    ).toBe("matched");
  });

  it("does not auto-match address alone or same address with a different name", () => {
    expect(matchRow({ address: "120 Oak St" }, [person()]).status).toBe("ambiguous");
    expect(
      matchRow({ first_name: "Rachel", last_name: "Cohen", address: "120 Oak St" }, [person()])
        .status,
    ).toBe("ambiguous");
  });

  it("accepts a nickname with an agreeing phone", () => {
    expect(
      matchRow({ first_name: "Sara", last_name: "Klein", phone: "4045550100" }, [person()]).status,
    ).toBe("matched");
  });

  it("prevents a same-file shared contact method from hiding contradictory identity", () => {
    const seen = newRowIdentityRegistry();
    expect(
      matchRowOnce(
        {
          first_name: "Sarah",
          last_name: "Klein",
          email: "family@example.test",
          birth_date: "1980-01-01",
          amount: "18",
          date: "2026-01-01",
        },
        [],
        seen,
        0,
      ).status,
    ).toBe("new");
    const second = matchRowOnce(
      {
        first_name: "Rachel",
        last_name: "Klein",
        email: "family@example.test",
        birth_date: "1995-07-12",
        amount: "36",
        date: "2026-01-02",
      },
      [],
      seen,
      1,
    );
    expect(second.status).toBe("ambiguous");
    expect(second.reason).toContain("birth date differs");
    expect(second.reason).toContain("row 1");
  });

  it("keeps legitimate separate gifts for an agreeing same-file identity", () => {
    const seen = newRowIdentityRegistry();
    const identity = {
      first_name: "Sarah",
      last_name: "Klein",
      email: "same@example.test",
      birth_date: "1980-01-01",
    };
    expect(
      matchRowOnce({ ...identity, amount: "18", date: "2026-01-01" }, [], seen, 0).status,
    ).toBe("new");
    expect(
      matchRowOnce({ ...identity, amount: "36", date: "2026-01-02" }, [], seen, 1).status,
    ).toBe("new");
  });
});
