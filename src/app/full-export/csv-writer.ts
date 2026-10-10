// src/app/full-export/csv-writer.ts
//
// Turns cleaned rows into the Shopify CSV text. Lives in the lazily loaded export chunk (it is imported by
// nothing else), so the main bundle contains no code that can write a complete file.

import type { CleanedShopifyRow } from "../types/csv";
import { shopifyColumnsFor } from "../utils/sanitizer";

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes cleaned rows to RFC 4180 CSV (CRLF line endings, quoted when needed). */
export function toShopifyCsv(rows: CleanedShopifyRow[]): string {
  const columns = shopifyColumnsFor(rows);
  const lines: string[] = new Array(rows.length + 1);
  lines[0] = columns.map((column) => escapeCsvField(column.header)).join(",");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines[i + 1] = columns.map((column) => escapeCsvField(row[column.key])).join(",");
  }
  return lines.join("\r\n") + "\r\n";
}

/** "supplier-feed.csv" becomes "supplier-feed-shopify-clean.csv". */
export function buildOutputFileName(originalName: string | null): string {
  const base = (originalName ?? "products").replace(/\.[^.]+$/, "").trim();
  const safe = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "products"}-shopify-clean.csv`;
}
