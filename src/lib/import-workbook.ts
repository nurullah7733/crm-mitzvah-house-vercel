import Papa from "papaparse";
import * as XLSX from "@e965/xlsx";
import type { ColumnGuess, FieldKey } from "@/lib/import-mapping";

export type SourceScalar = string | number | boolean | null;

export type SourceCell = {
  raw: SourceScalar;
  display: string;
  kind: "blank" | "string" | "number" | "boolean" | "date" | "formula";
  format?: string;
  formula?: string;
};

export type SourceRow = { physicalRowNumber: number; cells: SourceCell[] };

export type ColumnShape =
  | "email"
  | "phone"
  | "date"
  | "timestamp"
  | "currency"
  | "number"
  | "address"
  | "text"
  | "mostly_blank"
  | "unknown";

export type ColumnProfile = {
  columnIndex: number;
  columnId: string;
  header: string;
  shape: ColumnShape;
  nonBlank: number;
  total: number;
  samples: string[];
};

export type HeaderDetection = {
  rowNumber: number | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type WorkbookSheetProfile = {
  name: string;
  index: number;
  visibility: "visible" | "hidden" | "veryHidden";
  usedRange: string | null;
  physicalRowCount: number;
  columnCount: number;
  sampleRows: SourceRow[];
  rows: SourceRow[];
  detectedHeader: HeaderDetection;
};

export type WorkbookProfile = {
  filename: string;
  kind: "csv" | "xlsx";
  rawFileHash: string;
  sourceDataHash: string;
  sheets: WorkbookSheetProfile[];
};

const FATAL_CSV_ERRORS = new Set([
  "Quotes/MissingQuotes",
  "Quotes/InvalidQuotes",
  "FieldMismatch/TooManyFields",
  "FieldMismatch/TooFewFields",
]);

export function isFatalCsvParseError(error: Papa.ParseError) {
  return FATAL_CSV_ERRORS.has(`${error.type}/${error.code}`);
}

export type SelectedSheet = {
  filename: string;
  sheetName: string;
  sheetIndex: number;
  visibility: WorkbookSheetProfile["visibility"];
  usedRange: string | null;
  headerRowNumber: number | null;
  headerMode: "detected" | "manual" | "none";
  headers: string[];
  columnIds: string[];
  rows: string[][];
  rawRows: SourceRow[];
  physicalRowNumbers: number[];
  columnProfiles: ColumnProfile[];
  rawFileHash: string;
  sourceDataHash: string;
};

const HEADER_WORDS = new Set(
  [
    "name", "first name", "last name", "full name", "email", "email address", "phone",
    "phone number", "address", "street", "city", "state", "province", "zip", "zip code",
    "postal code", "date", "close date", "birth date", "date of birth", "amount", "total",
    "campaign", "event", "notes", "status", "submitted", "created at", "organization",
    "household", "spouse", "partner", "child", "registration",
  ].map((value) => value.toLowerCase()),
);

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function looksEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+()\d\s.-]+$/.test(value);
}

function looksTimestamp(value: string) {
  return /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}[ T]\d{1,2}:\d{2}/i.test(value);
}

function looksDate(value: string) {
  return (
    /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(value) ||
    /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(value)
  );
}

function looksCurrency(value: string) {
  return /^\s*[$€£]\s*-?[\d,]+(?:\.\d+)?(?:\s+[A-Za-z]+)?\s*$/.test(value);
}

function looksNumber(value: string) {
  return /^-?[\d,]+(?:\.\d+)?$/.test(value);
}

function looksAddress(value: string) {
  return /^\d+\s+.{3,}/.test(value) && /\b(st|street|rd|road|dr|drive|ct|court|ave|avenue|ln|lane|way|blvd|suite|apt)\b/i.test(value);
}

export function detectHeader(rows: SourceRow[]): HeaderDetection {
  const candidates = rows.slice(0, 25).map((row) => {
    const values = row.cells.map((cell) => clean(cell.display));
    const nonBlank = values.filter(Boolean);
    const known = nonBlank.filter((value) => {
      const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
      return HEADER_WORDS.has(normalized) || [...HEADER_WORDS].some((word) => normalized.includes(word));
    }).length;
    const dataLike = nonBlank.filter(
      (value) => looksEmail(value) || looksPhone(value) || looksDate(value) || looksTimestamp(value) || looksCurrency(value) || looksNumber(value),
    ).length;
    const unique = new Set(nonBlank.map((value) => value.toLowerCase())).size;
    const score = known * 3 + Math.min(nonBlank.length, 8) * 0.2 + (unique === nonBlank.length ? 1 : 0) - dataLike * 2;
    return { rowNumber: row.physicalRowNumber, score, known, nonBlank: nonBlank.length, dataLike };
  });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.nonBlank < 2 || best.known < 2 || best.score < 5) {
    return { rowNumber: null, confidence: "low", reason: "No reliable header row was found." };
  }
  return {
    rowNumber: best.rowNumber,
    confidence: best.known >= 2 && best.dataLike === 0 ? "high" : "medium",
    reason: `Row ${best.rowNumber} contains ${best.known} recognizable column labels.`,
  };
}

function sourceCell(raw: unknown, display: unknown, cell?: XLSX.CellObject): SourceCell {
  const normalizedRaw: SourceScalar =
    raw === null || raw === undefined
      ? null
      : typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
        ? raw
        : String(raw);
  const shown = clean(display);
  const kind: SourceCell["kind"] = cell?.f
    ? "formula"
    : !shown && normalizedRaw === null
      ? "blank"
      : cell?.t === "d" || (cell?.t === "n" && /[dmy]/i.test(String(cell.z ?? "")))
        ? "date"
        : typeof normalizedRaw === "number"
          ? "number"
          : typeof normalizedRaw === "boolean"
            ? "boolean"
            : "string";
  return {
    raw: normalizedRaw,
    display: shown,
    kind,
    ...(cell?.z ? { format: String(cell.z) } : {}),
    ...(cell?.f ? { formula: cell.f } : {}),
  };
}

function xlsxRows(ws: XLSX.WorkSheet): SourceRow[] {
  if (!ws["!ref"]) return [];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows: SourceRow[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: SourceCell[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      cells.push(sourceCell(cell?.v, cell?.w ?? cell?.v, cell));
    }
    rows.push({ physicalRowNumber: r + 1, cells });
  }
  return rows;
}

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function canonicalWorkbookData(sheets: WorkbookSheetProfile[]) {
  return JSON.stringify(
    [...sheets]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sheet) => ({
        name: sheet.name,
        rows: sheet.rows.map((row) => row.cells.map((cell) => [cell.raw, cell.display, cell.kind, cell.format ?? ""])),
      })),
  );
}

export async function profileImportFile(file: File): Promise<WorkbookProfile> {
  const buffer = await file.arrayBuffer();
  const rawFileHash = await sha256(buffer);
  const isCsv = /\.csv$/i.test(file.name);
  let sheets: WorkbookSheetProfile[];
  if (isCsv) {
    const text = new TextDecoder().decode(buffer);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    const fatalErrors = parsed.errors.filter(isFatalCsvParseError);
    if (fatalErrors.length) {
      const first = fatalErrors[0]!;
      throw new Error(
        `CSV parsing failed${first.row === undefined ? "" : ` near row ${first.row + 1}`} ` +
        `(${first.code}): ${first.message}`,
      );
    }
    const width = Math.max(0, ...parsed.data.map((row) => row.length));
    const rows = parsed.data
      .map((row, index) => ({
        physicalRowNumber: index + 1,
        cells: Array.from({ length: width }, (_, column) => sourceCell(row[column] ?? "", row[column] ?? "")),
      }))
      .filter((row) => row.cells.some((cell) => cell.display));
    sheets = [{
      name: "CSV",
      index: 0,
      visibility: "visible",
      usedRange: rows.length && width ? `A1:${XLSX.utils.encode_col(width - 1)}${rows.at(-1)!.physicalRowNumber}` : null,
      physicalRowCount: rows.length,
      columnCount: width,
      sampleRows: rows.slice(0, 8),
      rows,
      detectedHeader: detectHeader(rows),
    }];
  } else {
    const wb = XLSX.read(buffer, { cellDates: false, cellNF: true, cellFormula: true, cellStyles: true });
    sheets = wb.SheetNames.map((name, index) => {
      const ws = wb.Sheets[name]!;
      const rows = xlsxRows(ws);
      const hidden = wb.Workbook?.Sheets?.[index]?.Hidden ?? 0;
      const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
      return {
        name,
        index,
        visibility: hidden === 2 ? "veryHidden" : hidden === 1 ? "hidden" : "visible",
        usedRange: ws["!ref"] ?? null,
        physicalRowCount: rows.length,
        columnCount: range ? range.e.c - range.s.c + 1 : 0,
        sampleRows: rows.filter((row) => row.cells.some((cell) => cell.display)).slice(0, 8),
        rows,
        detectedHeader: detectHeader(rows),
      } satisfies WorkbookSheetProfile;
    });
  }
  if (!sheets.length) throw new Error("That workbook has no sheets.");
  return {
    filename: file.name,
    kind: isCsv ? "csv" : "xlsx",
    rawFileHash,
    sourceDataHash: await sha256(canonicalWorkbookData(sheets)),
    sheets,
  };
}

function profileColumn(values: string[], columnIndex: number, header: string): ColumnProfile {
  const nonBlank = values.map(clean).filter(Boolean);
  const ratio = (predicate: (value: string) => boolean) =>
    nonBlank.length ? nonBlank.filter(predicate).length / nonBlank.length : 0;
  let shape: ColumnShape = "unknown";
  if (!nonBlank.length || nonBlank.length / Math.max(values.length, 1) < 0.2) shape = "mostly_blank";
  else if (ratio(looksEmail) >= 0.7) shape = "email";
  else if (ratio(looksTimestamp) >= 0.7) shape = "timestamp";
  else if (ratio(looksDate) >= 0.7) shape = "date";
  else if (ratio(looksPhone) >= 0.7) shape = "phone";
  else if (ratio(looksCurrency) >= 0.7) shape = "currency";
  else if (ratio(looksNumber) >= 0.8) shape = "number";
  else if (ratio(looksAddress) >= 0.5) shape = "address";
  else if (nonBlank.length) shape = "text";
  return {
    columnIndex,
    columnId: `column_${columnIndex + 1}`,
    header,
    shape,
    nonBlank: nonBlank.length,
    total: values.length,
    samples: [...new Set(nonBlank)].slice(0, 3),
  };
}

export function selectWorkbookSheet(
  workbook: WorkbookProfile,
  sheetIndex: number,
  headerRowNumber: number | null,
  headerMode: SelectedSheet["headerMode"] = headerRowNumber === null ? "none" : "manual",
): SelectedSheet {
  const source = workbook.sheets[sheetIndex];
  if (!source) throw new Error("Select a worksheet that exists in this workbook.");
  const width = source.columnCount;
  const headerRow = headerRowNumber === null ? null : source.rows.find((row) => row.physicalRowNumber === headerRowNumber);
  if (headerRowNumber !== null && !headerRow) throw new Error("The selected header row is outside the used worksheet range.");
  const headers = Array.from({ length: width }, (_, index) => clean(headerRow?.cells[index]?.display));
  const columnIds = headers.map((_, index) => `column_${index + 1}`);
  const rawRows = source.rows.filter(
    (row) =>
      (headerRowNumber === null || row.physicalRowNumber > headerRowNumber) &&
      row.cells.some((cell) => cell.display || cell.raw !== null),
  );
  const rows = rawRows.map((row) => Array.from({ length: width }, (_, index) => clean(row.cells[index]?.display)));
  const columnProfiles = headers.map((header, index) => profileColumn(rows.map((row) => row[index] ?? ""), index, header));
  return {
    filename: workbook.filename,
    sheetName: source.name,
    sheetIndex: source.index,
    visibility: source.visibility,
    usedRange: source.usedRange,
    headerRowNumber,
    headerMode,
    headers,
    columnIds,
    rows,
    rawRows,
    physicalRowNumbers: rawRows.map((row) => row.physicalRowNumber),
    columnProfiles,
    rawFileHash: workbook.rawFileHash,
    sourceDataHash: workbook.sourceDataHash,
  };
}

const PERSON_FIELDS = new Set<FieldKey>([
  "first_name", "last_name", "full_name", "email", "email_work", "email_other", "phone",
  "phone_mobile", "phone_home", "phone_work", "phone_other",
]);
const ACTIVITY_FIELDS = new Set<FieldKey>(["amount", "date", "campaign", "event_name", "notes"]);
const REPEATABLE = new Set<FieldKey>([
  "phone_mobile", "phone_home", "phone_work", "phone_other", "email_work", "email_other",
  "child_name", "child_first_name", "child_last_name", "child_birth_date", "child_age", "child_school",
]);

const TARGET_SHAPES: Partial<Record<FieldKey, Set<ColumnShape>>> = {
  email: new Set(["email"]),
  email_work: new Set(["email"]),
  email_other: new Set(["email"]),
  phone: new Set(["phone"]),
  phone_mobile: new Set(["phone"]),
  phone_home: new Set(["phone"]),
  phone_work: new Set(["phone"]),
  phone_other: new Set(["phone"]),
  address: new Set(["address"]),
  date: new Set(["date", "timestamp"]),
  birth_date: new Set(["date", "timestamp"]),
  anniversary_date: new Set(["date", "timestamp"]),
  child_birth_date: new Set(["date", "timestamp"]),
  amount: new Set(["currency", "number"]),
};

const DISTINCT_VALUE_SHAPES = new Set<ColumnShape>([
  "email", "phone", "address", "date", "timestamp", "currency", "number",
]);

export function validateImportMapping(
  mapping: ColumnGuess[],
  columnCount: number,
  columnProfiles: ColumnProfile[] = [],
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (mapping.length !== columnCount) errors.push("The mapping no longer matches the selected sheet's columns.");
  const active = mapping.filter((entry) => entry.field !== "ignore");
  if (!active.length) errors.push("Map at least one usable person or activity column before importing.");
  const fields = new Set(active.map((entry) => entry.field));
  const hasPerson = [...fields].some((field) => PERSON_FIELDS.has(field));
  const hasActivity = [...fields].some((field) => ACTIVITY_FIELDS.has(field));
  if (!hasPerson && !hasActivity) errors.push("The selected mapping has neither a usable person identity nor activity field.");
  const counts = new Map<FieldKey, number>();
  for (const entry of active) counts.set(entry.field, (counts.get(entry.field) ?? 0) + 1);
  for (const [field, count] of counts) {
    if (count > 1 && !REPEATABLE.has(field)) errors.push(`The field ${field} is mapped more than once.`);
  }
  for (const [index, entry] of mapping.entries()) {
    const shape = columnProfiles[index]?.shape;
    const expected = TARGET_SHAPES[entry.field];
    if (
      entry.field !== "ignore" && entry.confidence !== "high" && shape &&
      DISTINCT_VALUE_SHAPES.has(shape) && expected && !expected.has(shape)
    ) {
      errors.push(
        `Column "${entry.header || `Column ${index + 1}`}" looks like ${shape} but was automatically mapped to ${entry.field}. Review this mapping.`,
      );
    }
  }
  if (fields.has("amount") !== fields.has("date")) warnings.push("Donation amount and donation date should be mapped together.");
  return { valid: errors.length === 0, errors, warnings, hasPerson, hasActivity };
}

export function stagedRowPayload(sheet: SelectedSheet, mapping: ColumnGuess[], normalizedRows: unknown[]) {
  return sheet.rawRows.map((row, index) => ({
    physical_row_number: row.physicalRowNumber,
    raw_cells: row.cells,
    source_columns: sheet.headers.map((header, columnIndex) => ({
      column_id: sheet.columnIds[columnIndex],
      header,
      column_index: columnIndex,
    })),
    mapping: mapping.map((entry, columnIndex) => ({ ...entry, column_id: sheet.columnIds[columnIndex] })),
    normalized_values: normalizedRows[index] ?? {},
  }));
}
