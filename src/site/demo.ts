// src/site/demo.ts
//
// Runs a guide's example through the REAL parser and sanitizer (at build time for the pages, and in tests), so what a
// guide shows as "after" is what the tool produces, never a hand-written mock-up.

import type { RawSupplierRow } from "../app/types/csv";
import { decodeSupplierBytes, parseSupplierText } from "../app/utils/csv-parser";
import { SINGLE_BYTE_TABLES } from "../app/utils/single-byte-tables";
import { ENCODING_LABELS } from "../app/utils/text-encoding";
import { buildPreviewPairs, sanitizeDataset, shopifyColumnsFor } from "../app/utils/sanitizer";
import type { DemoField, DemoSpec } from "./import-errors";

export interface DemoLine {
  before: string;
  after: string;
}

export interface DemoResult {
  /** What the "before" column is called, e.g. "What Shopify receives". */
  beforeLabel: string;
  afterLabel: string;
  lines: DemoLine[];
  /** A short extra sentence, such as a size comparison. */
  note: string | null;
}

const EMPTY = "(empty)";
const show = (value: string): string => (value === "" ? EMPTY : value);

const toRow = (partial: Partial<RawSupplierRow>): RawSupplierRow => ({
  id: "",
  title: "",
  description: "",
  images: "",
  price: "",
  sku: "",
  ...partial,
});

function fieldPair(field: DemoField, pair: ReturnType<typeof buildPreviewPairs>[number]): DemoLine {
  switch (field) {
    case "title": return { before: show(pair.raw.title), after: show(pair.primary.Title) };
    case "handle": return { before: show(pair.raw.handle ?? ""), after: show(pair.primary.Handle) };
    case "description": return { before: show(pair.raw.description), after: show(pair.primary.Body_HTML) };
    case "price": return { before: show(pair.raw.price), after: show(pair.primary.Variant_Price) };
    case "sku": return { before: show(pair.raw.sku), after: show(pair.primary.Variant_SKU) };
    case "images":
      return {
        before: show(pair.raw.images),
        after: show([pair.primary.Image_Src, ...pair.extraImageRows.map((row) => row.Image_Src)].filter(Boolean).join("\n")),
      };
  }
}

/** The bytes `text` has in a legacy single-byte encoding, built from the tables the detector itself decodes with. */
function encodeLegacy(text: string, encoding: "windows-1252" | "windows-1250" | "windows-1251"): Uint8Array {
  const table = SINGLE_BYTE_TABLES[encoding];
  return Uint8Array.from(
    [...text].map((ch) => {
      if (ch.charCodeAt(0) < 0x80) return ch.charCodeAt(0);
      const index = table.indexOf(ch);
      if (index === -1) throw new Error(`demo text uses "${ch}", which ${encoding} cannot hold`);
      return 0x80 + index;
    }),
  );
}

const OPTION_PAIRS = [
  ["Option1_Name", "Option1_Value"],
  ["Option2_Name", "Option2_Value"],
  ["Option3_Name", "Option3_Value"],
] as const;

export function runDemo(spec: DemoSpec): DemoResult {
  if (spec.kind === "rows") {
    const rows = spec.rows.map(toRow);
    const { rows: cleaned, rowStarts } = sanitizeDataset(rows);
    const pairs = buildPreviewPairs(rows, cleaned, rowStarts, rows.length);
    const lines = pairs.map((pair) => fieldPair(spec.field, pair));
    let note: string | null = null;
    if (spec.sizes) {
      const bytes = (text: string) => new TextEncoder().encode(text).length;
      note = `${bytes(rows.map((row) => row.description).join(""))} bytes of description before, ${bytes(pairs.map((pair) => pair.primary.Body_HTML).join(""))} after.`;
    }
    return { beforeLabel: "In your file", afterLabel: "What this tool writes", lines, note };
  }

  if (spec.kind === "csv") {
    const { rows } = parseSupplierText(spec.text);
    const cleaned = sanitizeDataset(rows).rows;
    if (spec.view === "options") {
      const used = OPTION_PAIRS.filter(([, value]) => cleaned.some((row) => row[value] !== ""));
      const cell = (value: string) => (value === "" ? " " : value);
      const header = ["Handle", "Title", ...used.flatMap((_, slot) => [`Option${slot + 1} Name`, `Option${slot + 1} Value`])].join(" | ");
      const body = cleaned.filter((row) => row.Title !== "" || row.Option1_Value !== "").map((row) => [cell(row.Handle), cell(row.Title), ...used.flatMap(([name, value]) => [cell(row[name]), cell(row[value])])].join(" | "));
      return {
        beforeLabel: "Your file, as it arrives",
        afterLabel: "Columns this tool writes",
        lines: [{ before: spec.text.trimEnd(), after: [header, ...body].join("\n") }],
        note: null,
      };
    }
    if (spec.view === "headers") {
      const firstLine = spec.text.replace(/^﻿/, "").split("\n")[0];
      return {
        beforeLabel: "First line of your file",
        afterLabel: "Header row this tool writes",
        lines: [{ before: JSON.stringify(spec.text.split("\n")[0]).slice(1, -1) || firstLine, after: shopifyColumnsFor(cleaned).map((column) => column.header).join(",") }],
        note: null,
      };
    }
    return {
      beforeLabel: "Your file, as it arrives",
      afterLabel: "Rows this tool writes (handle | title | price)",
      lines: [{ before: spec.text.trimEnd(), after: cleaned.filter((row) => row.Title !== "").map((row) => `${row.Handle} | ${row.Title} | ${row.Variant_Price || EMPTY}`).join("\n") }],
      note: null,
    };
  }

  const encoding = spec.encoding ?? "windows-1252";
  const bytes = encodeLegacy(spec.text, encoding);
  const decoded = decodeSupplierBytes(bytes);
  return {
    beforeLabel: "Read as UTF-8, as Shopify does",
    afterLabel: "Read correctly by this tool",
    lines: [{ before: new TextDecoder("utf-8").decode(bytes), after: decoded.text }],
    note: `The same bytes, a file saved in ${ENCODING_LABELS[encoding].replace(/ \(.*$/, "")}, read two ways. The tool settled on ${ENCODING_LABELS[decoded.encoding].replace(/ \(.*$/, "")}.`,
  };
}
