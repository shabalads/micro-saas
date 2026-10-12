// src/app/utils/csv-parser.ts

import Papa from "papaparse";
import type { RawSupplierRow } from "../types/csv";
import { weightUnitInHeader } from "./catalog-fields";
import { ATTRIBUTE_HEADERS, CODE_LIKE_SKU_HEADERS, type ColumnKey, HEADER_ALIASES } from "./header-aliases";
import { compactKey, matchHeaders } from "./header-match";
import { spreadsheetRow } from "./row-numbers";
import { type DecodedText, ENCODING_LABELS, type SupplierEncoding, decodeText } from "./text-encoding";

/* -------------------------------------------------------------------------- */
/*  Header mapping                                                             */
/* -------------------------------------------------------------------------- */

const COLUMN_KEYS = Object.keys(HEADER_ALIASES) as ColumnKey[];

/** With `header: true` PapaParse returns objects; rows wider than the header keep the overflow here. */
type ParsedRecord = Record<string, string> & { __parsed_extra?: string[] };

/* -------------------------------------------------------------------------- */
/*  Variant option columns                                                     */
/* -------------------------------------------------------------------------- */

/** Shopify allows three options per product. */
const MAX_OPTIONS = 3;

const optionValueAliases = (n: number): string[] => [
  `option${n}value`, `option${n}values`, `option${n}`, `optionvalue${n}`, `variantoption${n}`, `variantoption${n}value`,
  `attribute${n}value`, `attribute${n}values`, `attribute${n}`, `variation${n}`, `variation${n}value`,
];
const optionNameAliases = (n: number): string[] => [`option${n}name`, `optionname${n}`, `variantoption${n}name`, `attribute${n}name`, `variation${n}name`];

const ATTRIBUTE_SET = new Set(ATTRIBUTE_HEADERS);

interface OptionColumn {
  valueField: string;
  /** The column that holds the option's name, if the file has one. */
  nameField: string | null;
  /** The name to use when there is no name column. */
  fallbackName: string;
  derived: boolean;
}

function capitalizeHeader(header: string): string {
  const clean = header.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/** Finds the (at most three) option columns of a file, and the header names that did not fit. */
function resolveOptionColumns(fields: string[]): { columns: OptionColumn[]; ignored: string[] } {
  const normalized = fields.map(normalizeHeader);
  const explicit: OptionColumn[] = [];
  for (let n = 1; n <= MAX_OPTIONS; n++) {
    const valueIndex = normalized.findIndex((header) => optionValueAliases(n).includes(header));
    if (valueIndex === -1) continue;
    const nameIndex = normalized.findIndex((header) => optionNameAliases(n).includes(header));
    explicit.push({ valueField: fields[valueIndex], nameField: nameIndex === -1 ? null : fields[nameIndex], fallbackName: `Option ${n}`, derived: false });
  }
  if (explicit.length > 0) return { columns: explicit, ignored: [] };

  const attributes = fields.filter((_, index) => ATTRIBUTE_SET.has(normalized[index]));
  return {
    columns: attributes.slice(0, MAX_OPTIONS).map((field) => ({ valueField: field, nameField: null, fallbackName: capitalizeHeader(field), derived: true })),
    ignored: attributes.slice(MAX_OPTIONS),
  };
}
const OPTIONAL_WARNING_COLUMNS: ColumnKey[] = ["description", "images", "price", "sku"];

/** What a column is called in a sentence. */
const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: "the supplier id", title: "the title", description: "the description", images: "the images", price: "the retail price", cost: "the wholesale price (cost)", sku: "the SKU",
  handle: "the handle", productCode: "the product code", vendor: "the vendor", category: "the product type", tags: "the tags", stock: "the stock quantity", barcode: "the barcode",
  currency: "the currency", weight: "the weight",
};

function normalizeHeader(header: string): string {
  return compactKey(header);
}

interface ResolvedColumns {
  columns: Record<ColumnKey, string | null>;
  /** Headers that were read as a column on a close resemblance only (a misspelling), so the person can be told. */
  guessed: Array<{ header: string; column: ColumnKey; similarity: number }>;
}

/** Maps each logical column to the header name the file actually uses (or null when absent). See header-match.ts. */
function resolveColumns(fields: string[]): ResolvedColumns {
  const matches = matchHeaders(fields, HEADER_ALIASES, COLUMN_KEYS);
  const columns = {} as Record<ColumnKey, string | null>;
  const guessed: ResolvedColumns["guessed"] = [];
  for (const key of COLUMN_KEYS) {
    const match = matches.get(key);
    columns[key] = match?.header ?? null;
    if (match?.how === "similar") guessed.push({ header: match.header, column: key, similarity: match.similarity ?? 0 });
  }
  // "Product code" next to a real SKU column names the product (it groups variants); on its own it is the SKU.
  if (columns.productCode === null && columns.sku !== null) {
    const normalized = fields.map(normalizeHeader);
    const skuIndex = fields.indexOf(columns.sku);
    const codeIndex = normalized.findIndex((header, position) => position !== skuIndex && CODE_LIKE_SET.has(header) && !Object.values(columns).includes(fields[position]));
    if (codeIndex !== -1 && !CODE_LIKE_SET.has(normalized[skuIndex])) columns.productCode = fields[codeIndex];
  }
  return { columns, guessed };
}

const CODE_LIKE_SET = new Set(CODE_LIKE_SKU_HEADERS.map(compactKey));

/* -------------------------------------------------------------------------- */
/*  PapaParse result -> supplier rows                                          */
/* -------------------------------------------------------------------------- */

export interface ParsedSupplierFile {
  rows: RawSupplierRow[];
  warnings: string[];
}

/**
 * Turns a PapaParse `header: true` result into supplier rows plus non-fatal warnings.
 * Throws a human-readable error when the file cannot be used at all.
 */
export function mapParsedRows(
  results: Papa.ParseResult<ParsedRecord>,
  pipelineWarnings: string[] = [],
): ParsedSupplierFile {
  const fields = (results.meta.fields ?? []).filter((field) => field !== "");
  if (fields.length === 0) throw new Error("This file is empty.");

  const { columns, guessed } = resolveColumns(fields);
  const optionColumns = resolveOptionColumns(fields);
  const weightUnit = columns.weight === null ? "" : weightUnitInHeader(columns.weight);
  if (columns.title === null) {
    throw new Error(
      `No product title column found. Expected a header like "title" or "name", but the file has: ${fields.slice(0, 8).join(", ")}.`,
    );
  }
  // Rows with nothing in them are not products, but they still count for the row numbers the warnings give: the header is
  // row 1, so the fifth record under it is row 6 in the supplier's spreadsheet, blank lines and all.
  const isBlank = (record: ParsedRecord) => fields.every((field) => (record[field] ?? "").trim() === "") && !record.__parsed_extra?.some((cell) => cell.trim() !== "");
  const numbered = results.data.map((record, index) => ({ record, number: spreadsheetRow(index) })).filter(({ record }) => !isBlank(record));
  if (numbered.length === 0) throw new Error("The file has a header row but no product rows.");

  const warnings: string[] = [...pipelineWarnings];
  for (const guess of guessed) {
    warnings.push(`The column "${guess.header}" was read as ${COLUMN_LABELS[guess.column]}, because it looks like a misspelling of it. If that is wrong, rename the column.`);
  }
  const missing = OPTIONAL_WARNING_COLUMNS.filter((key) => columns[key] === null);
  if (missing.length > 0) {
    warnings.push(`No "${missing.join('", "')}" column detected, so those fields will be empty.`);
  }

  if (optionColumns.ignored.length > 0) {
    warnings.push(
      `Shopify allows three options per product, so ${optionColumns.ignored.map((name) => `"${name}"`).join(", ")} ${optionColumns.ignored.length === 1 ? "was" : "were"} not used as ${optionColumns.ignored.length === 1 ? "an option" : "options"}.`,
    );
  }

  let overflowRows = 0;
  const rows: RawSupplierRow[] = numbered.map(({ record, number }) => {
    if (record.__parsed_extra?.some((cell) => cell.trim() !== "")) overflowRows++;

    const cell = (key: ColumnKey): string => {
      const field = columns[key];
      return field === null ? "" : record[field] ?? "";
    };

    const row: RawSupplierRow = {
      id: cell("id"),
      title: cell("title"),
      description: cell("description"),
      images: cell("images"),
      price: cell("price"),
      sku: cell("sku"),
      sourceRow: number,
    };
    // The first cell with anything in it, in the file's own column order: a "TOTAL" line is recognised by it.
    const first = fields.map((field) => (record[field] ?? "").trim()).find((value) => value !== "");
    if (first !== undefined) row.firstCell = first;
    if (columns.handle !== null) row.handle = cell("handle");
    if (columns.cost !== null) row.cost = cell("cost");
    if (columns.productCode !== null) row.productCode = cell("productCode");
    if (columns.vendor !== null) row.vendor = cell("vendor");
    if (columns.category !== null) row.category = cell("category");
    if (columns.tags !== null) row.tags = cell("tags");
    if (columns.stock !== null) row.stock = cell("stock");
    if (columns.barcode !== null) row.barcode = cell("barcode");
    if (columns.currency !== null) row.currency = cell("currency");
    if (columns.weight !== null) {
      row.weight = cell("weight");
      row.weightUnit = weightUnit;
    }
    if (optionColumns.columns.length > 0) {
      row.options = optionColumns.columns.map((column) => ({
        name: column.nameField === null ? column.fallbackName : (record[column.nameField] ?? "").trim() || column.fallbackName,
        value: record[column.valueField] ?? "",
        derived: column.derived,
      }));
    }
    return row;
  });

  if (overflowRows > 0) {
    warnings.push(
      `${overflowRows.toLocaleString()} row${overflowRows === 1 ? " has" : "s have"} more columns than the header. This usually means an unquoted comma inside a description, so double-check ${overflowRows === 1 ? "that row" : "those rows"}.`,
    );
  }
  return { rows, warnings };
}

/* -------------------------------------------------------------------------- */
/*  Reading bytes                                                              */
/* -------------------------------------------------------------------------- */

export type { SupplierEncoding } from "./text-encoding";

/**
 * Turns the raw bytes of an upload into text, detecting the encoding (or using the one the caller forces). See
 * text-encoding.ts for how: byte-order marks, strict UTF-8, then scoring windows-1252/1250/1251 and ISO-8859-2/15 by
 * how plausible their letters are. Decoding the bytes ourselves, with explicit tables, instead of letting FileReader
 * guess makes this deterministic and testable.
 */
export function decodeSupplierBytes(input: ArrayBuffer | ArrayBufferView, forced?: SupplierEncoding | "auto"): DecodedText {
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return decodeText(bytes, forced);
}

/* -------------------------------------------------------------------------- */
/*  Parsing entry points                                                       */
/* -------------------------------------------------------------------------- */

const PAPA_OPTIONS: Papa.ParseConfig<ParsedRecord> = {
  header: true,
  // Blank lines are kept here and dropped in mapParsedRows, which knows to count them: a row's number is where it sits in the file.
  skipEmptyLines: false,
  transformHeader: (header) => header.trim(),
  // Papa would also guess "|", which is the image separator inside cells, not a column separator.
  delimitersToGuess: [",", ";", "\t"],
};

/** More repairs than this means the file is not merely sloppy; the user should look at it. */
const MAX_QUOTE_REPAIRS = 5;

interface QuoteRepairOutcome {
  results: Papa.ParseResult<ParsedRecord>;
  /** Spreadsheet rows (the header is row 1) whose unclosed opening quote was dropped. */
  repairedRows: number[];
  /** The spreadsheet row of an unterminated quote that is still in the data after the repair budget ran out. */
  unrepairedRow: number | null;
}

/**
 * An opening quote that is never closed makes the CSV spec swallow everything up to the end of the file
 * into one cell, silently merging hundreds of products. PapaParse reports where that quote is, so drop that
 * one character and parse again, which restores the real row boundaries.
 */
function parseWithQuoteRepair(text: string): QuoteRepairOutcome {
  let current = text;
  const repairedRows: number[] = [];

  for (;;) {
    const results = Papa.parse<ParsedRecord>(current, PAPA_OPTIONS);
    const broken = results.errors.find((error) => error.code === "MissingQuotes");
    if (!broken) return { results, repairedRows, unrepairedRow: null };

    // Papa numbers the records with the header as 0, which makes its row the spreadsheet row minus one.
    const row = (broken.row ?? 0) + 1;
    // Papa reports the cursor just after the opening quote.
    const at = [(broken.index ?? 0) - 1, broken.index ?? 0].find((position) => current.charAt(position) === '"');
    if (at === undefined || repairedRows.length >= MAX_QUOTE_REPAIRS) {
      return { results, repairedRows, unrepairedRow: row };
    }
    repairedRows.push(row); // always: the loop ends because this list reaches MAX_QUOTE_REPAIRS
    current = current.slice(0, at) + current.slice(at + 1);
  }
}

function describeRows(rows: number[]): string {
  const shown = rows.slice(0, 3).join(", ");
  return rows.length > 3 ? `${shown} and ${rows.length - 3} more` : shown;
}

function quoteWarnings(outcome: QuoteRepairOutcome): string[] {
  const warnings: string[] = [];
  const { repairedRows, unrepairedRow, results } = outcome;

  if (repairedRows.length > 0) {
    warnings.push(
      `${repairedRows.length === 1 ? "A quote" : `${repairedRows.length} quotes`} in row ${describeRows(repairedRows)} was never closed, so the stray quote was ignored to keep the rows apart. Check ${repairedRows.length === 1 ? "that row" : "those rows"}.`,
    );
  }
  if (unrepairedRow !== null) {
    warnings.push(
      `The file still has an unclosed quote at row ${unrepairedRow}, so the rows after it may be merged into one. Open the file in a text editor and fix the quotes.`,
    );
  }
  const misplaced = new Set(results.errors.filter((error) => error.code === "InvalidQuotes").map((error) => error.row));
  if (misplaced.size > 0) {
    warnings.push(`${misplaced.size.toLocaleString()} row${misplaced.size === 1 ? " has" : "s have"} a misplaced quote inside a quoted cell. The text was kept as typed.`);
  }
  return warnings;
}

/** Parses CSV text that is already in memory. */
export function parseSupplierText(text: string): ParsedSupplierFile {
  // Strip a BOM here so the character offsets Papa reports line up with the text we may repair.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const outcome = parseWithQuoteRepair(clean);
  return mapParsedRows(outcome.results, quoteWarnings(outcome));
}

/** What the UI shows about how the bytes were read, and what it needs to offer a different choice. */
export interface EncodingReport {
  encoding: SupplierEncoding;
  /** True when the encoding was detected rather than chosen by the user. */
  auto: boolean;
  confidence: DecodedText["confidence"];
  why: string;
  /** Other encodings that would be plausible and read differently. */
  alternatives: SupplierEncoding[];
}

export interface ParsedSupplierBytes extends ParsedSupplierFile {
  encoding: EncodingReport;
}

/** The warnings that belong to how the bytes were decoded (everything else about the file is in the parse). */
function encodingWarnings(decoded: DecodedText): string[] {
  const warnings: string[] = [];
  if (decoded.auto && decoded.confidence === "uncertain" && decoded.encoding !== "utf-8") {
    warnings.push(
      `We weren't sure which text encoding this file uses and read it as ${ENCODING_LABELS[decoded.encoding]}. If accented or non-Latin letters look wrong, choose another encoding from the menu above the preview.`,
    );
  }
  if (decoded.invalidSequences > 0) {
    warnings.push(
      `${decoded.invalidSequences.toLocaleString()} byte${decoded.invalidSequences === 1 ? " in this file is" : "s in this file are"} not valid in ${ENCODING_LABELS[decoded.encoding]} and ${decoded.invalidSequences === 1 ? "was" : "were"} shown as \ufffd. If many letters are missing, choose another encoding from the menu above the preview.`,
    );
  }
  if (decoded.mojibake) {
    warnings.push(
      "Some text looks like it was converted to UTF-8 twice (for example \u00c3\u00a9 where \u00e9 should be). That happened before the file reached us, so re-export it from the source if you can.",
    );
  }
  return warnings;
}

/**
 * Bytes in, rows out. The encoding is detected unless `forced` names one (the "Encoding" menu in the UI re-parses with it).
 * The same bytes always give the same rows.
 */
export function parseSupplierBytes(input: ArrayBuffer | ArrayBufferView, forced?: SupplierEncoding | "auto"): ParsedSupplierBytes {
  const decoded = decodeSupplierBytes(input, forced);
  const parsed = parseSupplierText(decoded.text);
  parsed.warnings.unshift(...encodingWarnings(decoded));
  return {
    ...parsed,
    encoding: { encoding: decoded.encoding, auto: decoded.auto, confidence: decoded.confidence, why: decoded.why, alternatives: decoded.alternatives },
  };
}

/** Reads and parses an uploaded file entirely in the browser. */
export async function parseSupplierFile(file: File, forced?: SupplierEncoding | "auto"): Promise<ParsedSupplierBytes> {
  return parseSupplierBytes(await file.arrayBuffer(), forced);
}
