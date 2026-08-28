import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import {
  isFatalCsvParseError,
  profileImportFile,
  selectWorkbookSheet,
  stagedRowPayload,
  validateImportMapping,
} from "@/lib/import-workbook";
import { guessMapping, type ColumnGuess } from "@/lib/import-mapping";

function workbookFile(
  name: string,
  sheets: { name: string; rows: unknown[][]; hidden?: 0 | 1 | 2 }[],
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  wb.Workbook = {
    Sheets: sheets.map((sheet) => ({ name: sheet.name, Hidden: sheet.hidden ?? 0 })),
  };
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  return new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function csvFile(name: string, text: string) {
  return new File([text], name, { type: "text/csv" });
}

describe("safe workbook discovery", () => {
  it("profiles every sheet and preserves its order", async () => {
    const profile = await profileImportFile(
      workbookFile("multi.xlsx", [
        { name: "Registrations", rows: [["Name"], ["Person One"]] },
        {
          name: "Gifts",
          rows: [
            ["Email", "Amount"],
            ["one@example.test", 18],
          ],
        },
      ]),
    );
    expect(profile.sheets.map((sheet) => [sheet.index, sheet.name])).toEqual([
      [0, "Registrations"],
      [1, "Gifts"],
    ]);
  });

  it("reports hidden sheets without dropping them", async () => {
    const profile = await profileImportFile(
      workbookFile("hidden.xlsx", [
        { name: "Visible", rows: [["Name"], ["Person One"]] },
        { name: "Hidden", rows: [["Email"], ["one@example.test"]], hidden: 1 },
      ]),
    );
    expect(profile.sheets).toHaveLength(2);
    expect(profile.sheets[1]!.visibility).toBe("hidden");
  });
});

describe("header detection and selection", () => {
  it("detects a header on physical row 1", async () => {
    const profile = await profileImportFile(
      csvFile("header.csv", "First Name,Email\nA,one@example.test"),
    );
    expect(profile.sheets[0]!.detectedHeader).toMatchObject({ rowNumber: 1, confidence: "high" });
  });

  it("detects a header after blank and title preamble rows", async () => {
    const profile = await profileImportFile(
      csvFile(
        "preamble.csv",
        "Donation report,,\n,,\nFirst Name,Email,Amount\nA,one@example.test,18",
      ),
    );
    expect(profile.sheets[0]!.detectedHeader.rowNumber).toBe(3);
    const selected = selectWorkbookSheet(profile, 0, 3, "detected");
    expect(selected.physicalRowNumbers).toEqual([4]);
  });

  it("classifies a headerless sheet and never discards its first data row", async () => {
    const profile = await profileImportFile(
      csvFile("headerless.csv", "Person One,one@example.test,18\nPerson Two,two@example.test,36"),
    );
    expect(profile.sheets[0]!.detectedHeader.rowNumber).toBeNull();
    const selected = selectWorkbookSheet(profile, 0, null, "none");
    expect(selected.rows).toHaveLength(2);
    expect(selected.physicalRowNumbers).toEqual([1, 2]);
    expect(selected.rows[0]![0]).toBe("Person One");
  });

  it("supports blank and duplicate header cells with stable column identities", async () => {
    const profile = await profileImportFile(
      csvFile("columns.csv", "Email,,Email\none@example.test,x,two@example.test"),
    );
    const selected = selectWorkbookSheet(profile, 0, 1, "manual");
    expect(selected.headers).toEqual(["Email", "", "Email"]);
    expect(selected.columnIds).toEqual(["column_1", "column_2", "column_3"]);
  });
});

describe("column profiles and source preservation", () => {
  it("profiles values independently of source-specific headers", async () => {
    const profile = await profileImportFile(
      csvFile("shapes.csv", "A,B,C,D\none@example.test,(404) 555-0100,3/4/2026,$18.00"),
    );
    const selected = selectWorkbookSheet(profile, 0, 1, "manual");
    expect(selected.columnProfiles.map((column) => column.shape)).toEqual([
      "email",
      "phone",
      "date",
      "currency",
    ]);
  });

  it("classifies plausible dotted dates before phone-like punctuation", async () => {
    const profile = await profileImportFile(
      csvFile("dates.csv", "Close Date,Label\n8.9.2023,a\n21.12.2024,b\n31.12.2025,c"),
    );
    const selected = selectWorkbookSheet(profile, 0, 1, "manual");
    expect(selected.columnProfiles[0]!.shape).toBe("date");
  });

  it("preserves physical row, selected sheet, raw cells, and unmapped columns", async () => {
    const profile = await profileImportFile(
      workbookFile("raw.xlsx", [
        { name: "Other", rows: [["Ignored"], ["x"]] },
        {
          name: "Import me",
          rows: [
            ["First Name", "Private raw"],
            ["A", "keep me"],
          ],
        },
      ]),
    );
    const selected = selectWorkbookSheet(profile, 1, 1, "manual");
    const mapping = guessMapping(selected.headers);
    const staged = stagedRowPayload(selected, mapping, [{ first_name: "A" }]);
    expect(selected.sheetName).toBe("Import me");
    expect(staged[0]!.physical_row_number).toBe(2);
    expect(staged[0]!.raw_cells[1]!.display).toBe("keep me");
    expect(staged[0]!.source_columns[1]).toMatchObject({
      column_id: "column_2",
      header: "Private raw",
    });
  });

  it("rebuilding canonical values after a mapping change does not mutate raw cells", async () => {
    const profile = await profileImportFile(
      csvFile("immutable.csv", "Name,Extra\nPerson One,raw value"),
    );
    const selected = selectWorkbookSheet(profile, 0, 1, "manual");
    const before = structuredClone(selected.rawRows);
    const firstMapping = guessMapping(selected.headers);
    const secondMapping = firstMapping.map((entry, index) =>
      index ? { ...entry, field: "notes" as const } : entry,
    );
    stagedRowPayload(selected, firstMapping, [{ full_name: "Person One" }]);
    stagedRowPayload(selected, secondMapping, [{ full_name: "Person One", notes: "raw value" }]);
    expect(selected.rawRows).toEqual(before);
  });

  it("retains raw and formatted Excel date and currency representations", async () => {
    const ws: XLSX.WorkSheet = {
      A1: { t: "s", v: "Date" },
      B1: { t: "s", v: "Amount" },
      A2: { t: "n", v: 45292, z: "m/d/yyyy" },
      B2: { t: "n", v: 18, z: "$0.00" },
      "!ref": "A1:B2",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const file = new File(
      [XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true })],
      "formatted.xlsx",
    );
    const profile = await profileImportFile(file);
    const row = profile.sheets[0]!.rows[1]!;
    expect(row.cells[0]).toMatchObject({ raw: 45292, kind: "date", format: "m/d/yyyy" });
    expect(row.cells[0]!.display).not.toBe("45292");
    expect(row.cells[1]).toMatchObject({ raw: 18, display: "$18.00", format: "$0.00" });
  });
});

describe("mapping safety gate", () => {
  const ignored = (count: number): ColumnGuess[] =>
    Array.from({ length: count }, (_, index) => ({
      header: `Column ${index + 1}`,
      field: "ignore",
      confidence: "low",
    }));

  it("blocks an all-ignore mapping", () => {
    expect(validateImportMapping(ignored(2), 2)).toMatchObject({ valid: false });
  });

  it("blocks a mapping whose column count is stale", () => {
    expect(
      validateImportMapping([{ header: "Email", field: "email", confidence: "high" }], 2).valid,
    ).toBe(false);
  });

  it("blocks duplicate non-repeatable targets", () => {
    const mapping: ColumnGuess[] = [
      { header: "Email 1", field: "email", confidence: "high" },
      { header: "Email 2", field: "email", confidence: "high" },
    ];
    expect(validateImportMapping(mapping, 2).errors).toContain(
      "The field email is mapped more than once.",
    );
  });

  it("allows a structurally valid person or activity mapping", () => {
    expect(
      validateImportMapping([{ header: "Name", field: "full_name", confidence: "high" }], 1).valid,
    ).toBe(true);
    expect(
      validateImportMapping([{ header: "Event", field: "event_name", confidence: "high" }], 1)
        .valid,
    ).toBe(true);
  });

  it("blocks an incompatible automatic address-to-email proposal", () => {
    const mapping: ColumnGuess[] = [{ header: "Street", field: "email", confidence: "medium" }];
    const profiles = [
      {
        columnIndex: 0,
        columnId: "column_1",
        header: "Street",
        shape: "address" as const,
        nonBlank: 2,
        total: 2,
        samples: ["12 Main St"],
      },
    ];
    expect(validateImportMapping(mapping, 1, profiles)).toMatchObject({ valid: false });
  });

  it("allows an explicit high-confidence override of a profile mismatch", () => {
    const mapping: ColumnGuess[] = [{ header: "Street", field: "email", confidence: "high" }];
    const profiles = [
      {
        columnIndex: 0,
        columnId: "column_1",
        header: "Street",
        shape: "address" as const,
        nonBlank: 2,
        total: 2,
        samples: ["12 Main St"],
      },
    ];
    expect(validateImportMapping(mapping, 1, profiles).valid).toBe(true);
  });

  it("accepts partner first/last name as partner identity evidence", () => {
    const mapping: ColumnGuess[] = [
      { header: "Partner Email", field: "spouse_email", confidence: "high" },
      { header: "Partner First Name", field: "spouse_first_name", confidence: "high" },
      { header: "Partner Last Name", field: "spouse_last_name", confidence: "high" },
    ];
    expect(validateImportMapping(mapping, 3).warnings).not.toContain(
      "Partner email is mapped but no partner name column is.",
    );
  });

  it("rejects partner email when no partner name evidence is mapped", () => {
    const mapping: ColumnGuess[] = [
      { header: "Partner Email", field: "spouse_email", confidence: "high" },
    ];
    expect(validateImportMapping(mapping, 1).warnings).toContain(
      "Partner email is mapped but no partner name column is.",
    );
  });
});

describe("file identity", () => {
  it("detects a renamed identical file by raw and normalized hashes", async () => {
    const original = workbookFile("original.xlsx", [
      { name: "Data", rows: [["Email"], ["one@example.test"]] },
    ]);
    const renamed = new File([await original.arrayBuffer()], "renamed.xlsx");
    const [a, b] = await Promise.all([profileImportFile(original), profileImportFile(renamed)]);
    expect(a.rawFileHash).toBe(b.rawFileHash);
    expect(a.sourceDataHash).toBe(b.sourceDataHash);
  });

  it("uses an order-independent normalized workbook identity", async () => {
    const a = await profileImportFile(
      workbookFile("a.xlsx", [
        { name: "A", rows: [["Name"], ["One"]] },
        { name: "B", rows: [["Amount"], [18]] },
      ]),
    );
    const b = await profileImportFile(
      workbookFile("b.xlsx", [
        { name: "B", rows: [["Amount"], [18]] },
        { name: "A", rows: [["Name"], ["One"]] },
      ]),
    );
    expect(a.rawFileHash).not.toBe(b.rawFileHash);
    expect(a.sourceDataHash).toBe(b.sourceDataHash);
  });
});

describe("malformed CSV", () => {
  it("classifies only structural Papa errors as fatal", () => {
    type ParseError = Parameters<typeof isFatalCsvParseError>[0];
    const error = (type: ParseError["type"], code: ParseError["code"]): ParseError => ({
      type,
      code,
      message: code,
    });
    expect(isFatalCsvParseError(error("Quotes", "MissingQuotes"))).toBe(true);
    expect(isFatalCsvParseError(error("Quotes", "InvalidQuotes"))).toBe(true);
    expect(isFatalCsvParseError(error("FieldMismatch", "TooManyFields"))).toBe(true);
    expect(isFatalCsvParseError(error("FieldMismatch", "TooFewFields"))).toBe(true);
    expect(isFatalCsvParseError(error("Delimiter", "UndetectableDelimiter"))).toBe(false);
  });

  it("rejects the exact live-QA multiline MissingQuotes fixture", async () => {
    const result = profileImportFile(
      csvFile(
        "m2b-malformed.csv",
        'First Name,Last Name,Email\nBroken,Row,"broken\\@example.com\nSecond,Row,second\\@example.com',
      ),
    );
    await expect(result).rejects.toThrow(
      /CSV parsing failed near row 2 \(MissingQuotes\): Quoted field unterminated/,
    );
  });

  it("rejects InvalidQuotes", async () => {
    await expect(profileImportFile(csvFile("invalid-quotes.csv", 'A,B\n1,"x"y'))).rejects.toThrow(
      /CSV parsing failed near row 2 \(InvalidQuotes\)/,
    );
  });

  it("accepts a properly closed quoted multiline field", async () => {
    const profile = await profileImportFile(
      csvFile("multiline.csv", 'Name,Notes\nPerson One,"first line\nsecond line"'),
    );
    expect(profile.sheets[0]!.rows[1]!.cells[1]!.display).toBe("first line second line");
  });

  it("accepts escaped double quotes", async () => {
    const profile = await profileImportFile(
      csvFile("escaped-quotes.csv", 'Name,Notes\nPerson One,"She said ""hello"""'),
    );
    expect(profile.sheets[0]!.rows[1]!.cells[1]!.display).toBe('She said "hello"');
  });

  it("keeps a legitimate single-column CSV usable when delimiter detection only warns", async () => {
    const profile = await profileImportFile(
      csvFile("single-column.csv", "Name\nPerson One\nPerson Two"),
    );
    expect(profile.sheets[0]!.rows.map((row) => row.cells[0]!.display)).toEqual([
      "Name",
      "Person One",
      "Person Two",
    ]);
  });
});
