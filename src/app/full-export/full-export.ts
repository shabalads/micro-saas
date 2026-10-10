// src/app/full-export/full-export.ts
//
// THE PAID CODE PATH. This module is only ever loaded with a dynamic import() from utils/unlock-client.ts, and that
// loader refuses to import it for a file over FREE_ROW_LIMIT rows until the server has accepted an unlock token
// (POST /api/unlock/verify). Nothing else in the app cleans more than the free preview or writes a complete CSV, so
// before payment the full output is never computed, serialized or rendered.
//
// Be clear about what this is: cleaning runs in the visitor's browser, so this separation stops the app from
// producing the full file before payment, but it cannot stop someone who reverse-engineers the bundle from
// running the cleaner themselves. Hard enforcement would mean doing this work on the server.

import type { RawSupplierRow } from "../types/csv";
import { FREE_ROW_LIMIT } from "../utils/pricing";
import { sanitizeDataset } from "../utils/sanitizer";
import { buildOutputFileName, toShopifyCsv } from "./csv-writer";

export interface ExportResult {
  products: number;
  outputRows: number;
}

/** Cleans EVERY row, builds the Shopify CSV and hands it to the browser as a download. */
export function exportCleanedCsv(params: {
  rows: RawSupplierRow[];
  fileName: string | null;
  /** The token the server issued after payment. Not needed for files within the free limit. */
  token: string | null;
}): ExportResult {
  if (params.rows.length > FREE_ROW_LIMIT && !params.token) {
    throw new Error(`Exporting more than ${FREE_ROW_LIMIT} rows requires an unlock token.`);
  }

  const { rows: cleaned, report } = sanitizeDataset(params.rows);
  const csv = toShopifyCsv(cleaned);
  // The BOM makes Excel open accented characters correctly; Shopify's importer accepts it.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = buildOutputFileName(params.fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { products: report.productCount, outputRows: report.outputRowCount };
}
