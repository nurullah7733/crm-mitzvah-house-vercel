import { describe, expect, it } from "vitest";
import {
  REPEATABLE_FIELDS,
  addressKey,
  composeAddress,
  guessColumn,
  guessMapping,
  matchRow,
  matchRowOnce,
  newRowIdentityRegistry,
  roleFromRow,
  rowIdentityKeys,
  splitFullName,
  splitName,
  splitPeopleList,
  type ExistingPerson,
  type FieldKey,
} from "@/lib/import-mapping";
import { buildRowValues } from "@/lib/import-rows";

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
      "First Name", "Last Name", "Mailing Street", "Mailing City",
      "Mailing State/Province", "Mailing Zip/Postal Code", "Phone", "Email",
      "Close Date", "Amount", "Primary Campaign Source", "Date of Birth",
    ];
    expect(fields(headers)).toEqual([
      "first_name", "last_name", "address", "city", "state", "postal_code",
      "phone", "email", "date", "amount", "campaign", "birth_date",
    ]);
    expect(guessMapping(headers)[7]).toMatchObject({ field: "email", confidence: "high" });
  });

  it("keeps multiple genuine email columns on repeatable email targets", () => {
    expect(fields(["Email", "Work Email", "Other Email"])).toEqual([
      "email", "email_work", "email_other",
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
    expect(v.phone).toBe("404-555-0100");
  });

  it("splits several numbers inside one cell", () => {
    const v = build(["Cell Phone"], ["404-555-0100 / 404-555-0199"]);
    expect(v.phones?.map((p) => p.value)).toEqual(["404-555-0100", "404-555-0199"]);
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
    ["3/14/1978", "3/14/1978"],
    ["1978-03-14", "1978-03-14"],
    ["14-Mar-1978", "14-Mar-1978"],
    ["12/25/90", "12/25/90"],
    ["2/29/1992", "2/29/1992"],
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
  it("flags the second appearance instead of creating them again", () => {
    const seen = newRowIdentityRegistry();
    const row = { first_name: "Yosef", last_name: "Katz", email: "yosef@example.com" };
    expect(matchRowOnce(row, [], seen, 0).status).toBe("new");
    const second = matchRowOnce({ ...row }, [], seen, 1);
    expect(second.status).toBe("ambiguous");
    expect(second.reason).toContain("row 1");
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

  it("catches a repeat that only shares a phone number", () => {
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

  it("rules out a same-name person with a different birth date", () => {
    const r = matchRow(
      { first_name: "Sarah", last_name: "Klein", birth_date: "1990-01-02" },
      people,
    );
    expect(r.status).toBe("new");
  });

  it("treats a typo in the name as a signal only with an address or birth date", () => {
    expect(matchRow({ first_name: "Sara", last_name: "Klein" }, people).status).toBe("ambiguous");
    expect(
      matchRow({ first_name: "Sara", last_name: "Klein", birth_date: "1990-01-02" }, people).status,
    ).toBe("new");
  });
});
