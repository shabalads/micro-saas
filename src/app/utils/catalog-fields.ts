// src/app/utils/catalog-fields.ts
//
// Parsers for the catalog columns a supplier file carries besides title, price and images: stock, EAN, currency,
// weight and tags. Each one is pure and says what it made of the cell, so the cleaner can keep the good values and
// count the ones it could not use (a warning with row numbers) instead of silently dropping them.

import { isPlaceholderValue } from "./placeholder-values";

const collapse = (value: string): string => value.replace(/[\u0000-\u0008\u000E-\u001F​-‍﻿]/g, "").replace(/\s+/g, " ").trim();

/* -------------------------------------------------------------------------- */
/*  Stock -> Variant Inventory Qty                                             */
/* -------------------------------------------------------------------------- */

export interface StockResult {
  /** A whole number of items (0 included), or null when the cell gave none. */
  quantity: number | null;
  /** Why there is no quantity: the cell was blank, or it held something that is not a count ("skladem", "-3", "5+"). */
  problem: "blank" | "not_a_number" | null;
}

/** A count may carry a unit ("5 ks", "12 pcs") and thousands spaces ("1 200"), and a ".0" some spreadsheets add. */
const STOCK_RE = /^\+?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]0+)?(?:\s*(?:ks|kus|kusy|pcs?|stk|szt|units?|x)\.?)?$/i;

/** "  5 " becomes 5. Blank, non-numeric ("skladem") and negative values give no quantity, and say which. */
export function parseStock(input: string): StockResult {
  const text = collapse(input);
  if (text === "") return { quantity: null, problem: "blank" };
  const match = STOCK_RE.exec(text);
  if (!match) return { quantity: null, problem: "not_a_number" };
  const quantity = Number(match[1].replace(/[   ]/g, ""));
  return Number.isSafeInteger(quantity) && quantity <= 999_999_999 ? { quantity, problem: null } : { quantity: null, problem: "not_a_number" };
}

/* -------------------------------------------------------------------------- */
/*  EAN / GTIN -> Variant Barcode                                              */
/* -------------------------------------------------------------------------- */

export interface BarcodeResult {
  /** The barcode to write: digits only. Empty when the cell was blank or the value is not a barcode. */
  barcode: string;
  status: "empty" | "valid" | "invalid";
  /** What the cell contained once tidied (for the warning). */
  shown: string;
  /** For a barcode of a valid length whose last digit is NOT the GS1 check digit: the digit it should have. Otherwise null. */
  expectedCheckDigit: string | null;
}

/**
 * The GS1 check digit for the digits before the last one of a GTIN-8, 12, 13 or 14: counting from the right, the digits
 * are weighted 3, 1, 3, 1 ...; the check digit brings the sum up to a multiple of ten.
 */
export function gtinCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

/** GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) and GTIN-14. */
const BARCODE_RE = /^(?:\d{8}|\d{12,14})$/;

/** Spaces and hyphens inside a barcode and the ".0" a spreadsheet adds to numbers are dropped; then it must be 8, 12, 13 or 14 digits. */
export function checkBarcode(input: string): BarcodeResult {
  const text = collapse(input).replace(/^['’`]+/, "");
  if (text === "" || isPlaceholderValue(text)) return { barcode: "", status: "empty", shown: "", expectedCheckDigit: null };
  const digits = text.replace(/[\s\-\u00A0]/g, "").replace(/\.0+$/, "");
  if (!BARCODE_RE.test(digits)) return { barcode: "", status: "invalid", shown: text, expectedCheckDigit: null };
  const expected = gtinCheckDigit(digits.slice(0, -1));
  return { barcode: digits, status: "valid", shown: digits, expectedCheckDigit: expected === digits.slice(-1) ? null : expected };
}

/* -------------------------------------------------------------------------- */
/*  Currency (not exported, but a file must not mix them)                      */
/* -------------------------------------------------------------------------- */

/** Spellings of currencies, compared lower case without accents or dots. "kr" is deliberately absent: it is the krone of three countries. */
const CURRENCY_SPELLINGS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["CZK", ["czk", "kc", "kč", "czech koruna", "koruna", "korun"]],
  ["EUR", ["eur", "€", "euro", "euros"]],
  ["USD", ["usd", "$", "us$", "dollar", "dollars", "dolar", "dolary"]],
  ["GBP", ["gbp", "£", "pound", "pounds"]],
  ["PLN", ["pln", "zl", "zł", "zloty", "złoty"]],
  ["HUF", ["huf", "ft"]],
  ["CHF", ["chf"]],
  ["RON", ["ron", "lei", "leu"]],
  ["SEK", ["sek"]],
  ["NOK", ["nok"]],
  ["DKK", ["dkk"]],
  ["RUB", ["rub", "₽"]],
  ["BGN", ["bgn", "lv", "лв"]],
];

const stripAccents = (value: string): string => value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const spellingKey = (value: string): string => stripAccents(value).toLowerCase().replace(/[.\s]/g, "");

const CURRENCY_BY_SPELLING = new Map<string, string>(
  CURRENCY_SPELLINGS.flatMap(([code, spellings]) => spellings.map((spelling) => [spellingKey(spelling), code] as const)),
);

/** "Kč", "czk" and "CZK" are all CZK. An unknown three-letter code is kept (upper case); anything else is "". */
export function currencyCode(input: string): string {
  const text = collapse(input);
  if (text === "" || isPlaceholderValue(text)) return "";
  const known = CURRENCY_BY_SPELLING.get(spellingKey(text));
  if (known) return known;
  return /^[A-Za-z]{3}$/.test(text) ? text.toUpperCase() : "";
}

const PRICE_CURRENCY_RE = /(?<![\p{L}])(czk|kč|kc|eur|usd|gbp|pln|zł|zl|huf|ft|chf|ron|lei|sek|nok|dkk|rub|us\$)(?![\p{L}])|[€$£₽]/iu;

/** The currency written into a price cell ("1.299,00 Kč", "$12.50"), or "" when the price is a bare number. */
export function currencyInPrice(price: string): string {
  const match = PRICE_CURRENCY_RE.exec(price);
  return match ? currencyCode(match[0]) : "";
}

/* -------------------------------------------------------------------------- */
/*  Weight -> Variant Grams                                                    */
/* -------------------------------------------------------------------------- */

const GRAMS_PER_UNIT: Record<string, number> = { mg: 0.001, g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 };

export interface WeightResult {
  /** Whole grams, or null when there is no usable weight (blank, not a number, zero or negative). */
  grams: number | null;
  /** The cell was not blank but could not be read as a weight. */
  invalid: boolean;
  /** The cell had no unit and neither had the column header, so grams were assumed. */
  assumedGrams: boolean;
}

/** "0,5 kg" -> 500, "250" in a column headed "Weight (g)" -> 250, "1.2 lb" -> 544. The unit comes from the cell, else the header, else grams. */
export function parseWeight(input: string, headerUnit = ""): WeightResult {
  const text = collapse(input);
  if (text === "" || isPlaceholderValue(text)) return { grams: null, invalid: false, assumedGrams: false };
  const match = /^(\d+(?:[.,]\d+)?)\s*(mg|g|kg|lbs?|oz)?\.?$/i.exec(text);
  if (!match) return { grams: null, invalid: true, assumedGrams: false };
  const unit = (match[2] ?? headerUnit).toLowerCase();
  const factor = GRAMS_PER_UNIT[unit];
  const grams = Math.round(Number(match[1].replace(",", ".")) * (factor ?? 1));
  if (!Number.isFinite(grams) || grams <= 0) return { grams: null, invalid: false, assumedGrams: false };
  return { grams, invalid: false, assumedGrams: factor === undefined };
}

/** The weight unit a column header names ("Weight (kg)", "Hmotnost v g"), or "". */
export function weightUnitInHeader(header: string): string {
  if (/kilogram/i.test(header)) return "kg";
  if (/\bgrams?\b/i.test(header)) return "g";
  const match = /(?:^|[\s(\[_/-])(mg|kg|g|lbs?|oz)(?:$|[\s)\]_/-])/i.exec(header);
  return match ? match[1].toLowerCase() : "";
}

/* -------------------------------------------------------------------------- */
/*  Tags                                                                       */
/* -------------------------------------------------------------------------- */

const MAX_TAG_LENGTH = 255;

/** "red; Sale | red, new" becomes "red, Sale, new": split, trimmed, placeholders and repeats (any case) dropped. */
export function cleanTags(input: string): string {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of input.split(/[,;|\n\r]+/)) {
    const tag = collapse(piece).slice(0, MAX_TAG_LENGTH);
    if (tag === "" || isPlaceholderValue(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.join(", ");
}
