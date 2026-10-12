// src/app/utils/summary-rows.ts
//
// Spreadsheet exports end (or break) with lines that are not products: "TOTAL,,12345.67,28950.00,1420". Left alone, such a
// line becomes a product with a nonsense price. This recognises them.

import type { RawSupplierRow } from "../types/csv";

/** What a summary line is called, English and the languages the headers are recognised in. The first cell must START with one of them. */
const LABEL_RE =
  /^(?:grand\s*total|sub\s*-?\s*total|totals?|sum|count|average|avg|overall|celkem|soucet|mezisoucet|suma|souhrn|razem|podsumowanie|summe|gesamt(?:summe)?|insgesamt|somme|totaux|sous\s*-?\s*total|totales)(?![a-z])/;

const plain = (text: string): string => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").trim();
const filled = (value: string | undefined): boolean => (value ?? "").trim() !== "";
const hasDigit = (value: string | undefined): boolean => /\d/.test(value ?? "");

/** The first cell with anything in it, as the file wrote it. */
function leadCell(raw: RawSupplierRow): string {
  if (raw.firstCell !== undefined) return raw.firstCell.trim();
  return [raw.productCode, raw.sku, raw.id, raw.title].map((value) => (value ?? "").trim()).find((value) => value !== "") ?? "";
}

export type SummaryReason = "label" | "numbers";

/**
 * Why this row is a summary line, or null when it is a product (or a variant of one).
 *  - "label": the first cell starts with TOTAL, SUBTOTAL, GRAND TOTAL, SUM, COUNT or the like, and there is no product data
 *    in the row (a product that merely starts with such a word has a description, an image, a vendor ...);
 *  - "numbers": no title, no SKU, no handle, no options, nothing that names anything, but a number in a price column.
 */
export function summaryRowReason(raw: RawSupplierRow): SummaryReason | null {
  const title = raw.title.trim();
  const lead = leadCell(raw);
  const optionValues = (raw.options ?? []).map((option) => option.value);
  const productData = [raw.description, raw.images, raw.barcode, raw.vendor, raw.category, raw.tags, raw.handle, ...optionValues].some(filled);

  if (lead !== "" && LABEL_RE.test(plain(lead)) && !productData && (title === "" || title === lead)) return "label";
  if (title === "" && !productData && !filled(raw.sku) && !filled(raw.id) && !filled(raw.productCode) && (hasDigit(raw.price) || hasDigit(raw.cost))) return "numbers";
  return null;
}

/** What the row says, for the message: the label as the file wrote it. */
export function summaryLabel(raw: RawSupplierRow): string {
  return leadCell(raw) || "numbers only";
}
