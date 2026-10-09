// src/app/utils/csv-parser.ts

import Papa from "papaparse";
import type { RawSupplierRow } from "../types/csv";

/* -------------------------------------------------------------------------- */
/*  Header mapping                                                             */
/* -------------------------------------------------------------------------- */

type ColumnKey = keyof RawSupplierRow;

/** With `header: true` PapaParse returns objects; rows wider than the header keep the overflow here. */
type ParsedRecord = Record<string, string> & { __parsed_extra?: string[] };

/** Header names suppliers commonly use, compared after lower-casing and removing punctuation. */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  id: ["id", "productid", "itemid", "supplierid", "supplierproductid", "externalid", "ref", "reference"],
  title: ["title", "name", "productname", "producttitle", "itemname", "itemtitle", "product"],
  description: ["description", "desc", "body", "bodyhtml", "longdescription", "productdescription", "details", "html"],
  images: ["images", "image", "imageurl", "imageurls", "imagesrc", "imagelinks", "photos", "photo", "pictures", "picture", "img", "imgurl", "gallery"],
  price: ["price", "retailprice", "unitprice", "sellingprice", "saleprice", "variantprice", "msrp", "rrp"],
  sku: ["sku", "variantsku", "itemcode", "productcode", "partnumber", "partno", "articlenumber", "article", "code"],
  handle: ["handle", "slug", "urlhandle", "urlkey"],
};

const COLUMN_KEYS = Object.keys(HEADER_ALIASES) as ColumnKey[];
const OPTIONAL_WARNING_COLUMNS: ColumnKey[] = ["description", "images", "price", "sku"];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Maps each logical column to the header name the file actually uses (or null when absent). */
function resolveColumns(fields: string[]): Record<ColumnKey, string | null> {
  const normalized = fields.map(normalizeHeader);
  const resolved = {} as Record<ColumnKey, string | null>;
  for (const key of COLUMN_KEYS) {
    const index = normalized.findIndex((header) => HEADER_ALIASES[key].includes(header));
    resolved[key] = index === -1 ? null : fields[index];
  }
  return resolved;
}

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
export function mapParsedRows(results: Papa.ParseResult<ParsedRecord>): ParsedSupplierFile {
  const fields = (results.meta.fields ?? []).filter((field) => field !== "");
  if (fields.length === 0) throw new Error("This file is empty.");

  const columns = resolveColumns(fields);
  if (columns.title === null) {
    throw new Error(
      `No product title column found. Expected a header like "title" or "name", but the file has: ${fields.slice(0, 8).join(", ")}.`,
    );
  }
  if (results.data.length === 0) throw new Error("The file has a header row but no product rows.");

  const warnings: string[] = [];
  const missing = OPTIONAL_WARNING_COLUMNS.filter((key) => columns[key] === null);
  if (missing.length > 0) {
    warnings.push(`No "${missing.join('", "')}" column detected, so those fields will be empty.`);
  }

  let overflowRows = 0;
  const rows: RawSupplierRow[] = results.data.map((record) => {
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
    };
    if (columns.handle !== null) row.handle = cell("handle");
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
/*  Parsing entry points                                                       */
/* -------------------------------------------------------------------------- */

const PAPA_OPTIONS: Papa.ParseConfig<ParsedRecord> = {
  header: true,
  // "greedy" also drops lines that only contain whitespace or bare delimiters.
  skipEmptyLines: "greedy",
  transformHeader: (header) => header.trim(),
  // Papa would also guess "|", which is the image separator inside cells, not a column separator.
  delimitersToGuess: [",", ";", "\t"],
};

function containsReplacementChar(results: Papa.ParseResult<ParsedRecord>): boolean {
  return results.data.some((record) =>
    Object.values(record).some((value) => typeof value === "string" && value.includes("�")),
  );
}

function parseFileWithEncoding(file: File, encoding: string): Promise<Papa.ParseResult<ParsedRecord>> {
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedRecord>(file, {
      ...PAPA_OPTIONS,
      encoding,
      complete: (results) => resolve(results),
      error: (error) => reject(error),
    });
  });
}

/** Reads and parses an uploaded file entirely in the browser. */
export async function parseSupplierFile(file: File): Promise<ParsedSupplierFile> {
  let results = await parseFileWithEncoding(file, "utf-8");
  // Replacement characters mean the file is not UTF-8 (typical for older supplier exports).
  if (containsReplacementChar(results)) results = await parseFileWithEncoding(file, "windows-1252");
  return mapParsedRows(results);
}

/** Parses CSV text that is already in memory (used for the built-in sample feed). */
export function parseSupplierText(text: string): ParsedSupplierFile {
  return mapParsedRows(Papa.parse<ParsedRecord>(text, PAPA_OPTIONS));
}
