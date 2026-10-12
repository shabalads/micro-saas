// The two real supplier files in test-data/: the same 150 rows with English and with Czech column names, saved in
// windows-1250, with semicolons, a SKU column that every variant of a product shares, titles that come back under another
// code, stock like "skladem", prices like "Kč 1.899,00", placeholder descriptions and barcodes. Every expected value below
// was worked out from the CSV itself (not by running the cleaner), so these tests say what the output has to be.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { toShopifyCsv } from "../full-export/csv-writer";
import type { WarningKind } from "../types/csv";
import { parseSupplierBytes } from "./csv-parser";
import { sanitizeDataset } from "./sanitizer";

const FILES = [
  { name: "messy-150-en.csv", headers: ["SKU", "Title", "Description", "Price", "Currency", "Stock", "Vendor", "Category", "Size", "Color", "Image", "EAN"], optionNames: ["Size", "Color"] },
  { name: "messy-150.csv", headers: ["Kod produktu", "Nazev", "Popis", "Cena", "Mena", "Skladem", "Vyrobce", "Kategorie", "Velikost", "Barva", "Obrazek", "EAN"], optionNames: ["Velikost", "Barva"] },
] as const;

const load = (name: string) => parseSupplierBytes(readFileSync(join(__dirname, "../../../test-data", name)));

/** "Kč 1.299,50" -> "1299.50", worked out independently of normalizePrice. */
function expectedPrice(cell: string): string {
  const digits = cell.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(digits).toFixed(2);
}

// Two ways of counting rows below. "Row N" in a test title, or an index into the output, is the Nth product row under the header
// (this file has one output row per source row, so that is how a row is found). Row numbers in WARNINGS are the spreadsheet's:
// the header is row 1, so the Nth product row is row N + 1.

/** The cleaned file as Shopify would receive it: written to CSV text and parsed back, one record per output row. */
function shopifyRecords(name: string, options = {}) {
  const { rows: raw } = load(name);
  const result = sanitizeDataset(raw, options);
  const parsed = Papa.parse<Record<string, string>>(toShopifyCsv(result.rows), { header: true, skipEmptyLines: true });
  return { raw, ...result, headers: parsed.meta.fields ?? [], records: parsed.data };
}

describe.each(FILES)("$name", ({ name, headers: sourceHeaders, optionNames }) => {
  const kinds = (warnings: Array<{ kind: WarningKind }>) => warnings.map((warning) => warning.kind);

  it("is read as windows-1250 with every column recognised, whatever language its headers are in", () => {
    const parsed = load(name);
    expect(parsed.encoding.encoding).toBe("windows-1250");
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(150);
    expect(parsed.rows[0]).toMatchObject({ id: "", sku: "SKU-1000", vendor: "ŁÓDŹ HURT SP. Z O.O.", category: "Móda", stock: "12", currency: "CZK" });
    expect(parsed.rows[2]).toMatchObject({ barcode: "8371407742358", stock: "skladem" });
    expect(parsed.rows[1].options?.map((option) => option.name)).toEqual([...optionNames]);
    expect(sourceHeaders).toHaveLength(12);
  });

  it("keeps all 150 rows, in order, each with its own price", () => {
    const { raw, rows, rowStarts, report, records } = shopifyRecords(name);
    expect(report.sourceRows).toBe(150);
    expect(rowStarts).toHaveLength(150);
    expect(rows).toHaveLength(150);
    expect(records).toHaveLength(150);
    expect(records.map((record) => record["Variant Price"])).toEqual(raw.map((entry) => expectedPrice(entry.price)));
    expect(report).toMatchObject({ productCount: 57, variantRows: 93, outputRowCount: 150 });
  });

  it("no handle appears in two non-adjacent blocks", () => {
    const { rows } = shopifyRecords(name);
    const blocks = new Map<string, number>();
    let previous = "";
    for (const { Handle } of rows) {
      if (Handle !== previous) blocks.set(Handle, (blocks.get(Handle) ?? 0) + 1);
      previous = Handle;
    }
    expect([...blocks].filter(([, count]) => count > 1)).toEqual([]);
    expect(blocks.size).toBe(57);
  });

  it("a title that comes back further down is its own product: -2, -3", () => {
    const { rows } = shopifyRecords(name);
    // "PÁNSKÉ TRIČKO BAVLNA" is one product (rows 25-29, see below) and comes back as a different one at row 128 (SKU-1047).
    expect([25, 29, 128].map((row) => rows[row - 1].Handle)).toEqual(["panske-tricko-bavlna", "panske-tricko-bavlna", "panske-tricko-bavlna-2"]);
    // SKU-1040 repeats the title of SKU-1000 from row 1.
    expect([1, 99].map((row) => rows[row - 1].Handle)).toEqual(["profesionalni-penova-matrace-xl", "profesionalni-penova-matrace-xl-2"]);
    // A product code used by two different titles (SKU-1024 on a suitcase and on a yoga mat) is two products.
    expect([67, 70].map((row) => rows[row - 1].Handle)).toEqual(["cestovni-kufr-abs-65l", "yoga-podlozka-6mm"]);
  });

  describe("a SKU copied from the previous product does not split a product", () => {
    // Rows 25, 39 and 43 start with the code of the DIFFERENT product right above them (SKU-1006, SKU-1011, SKU-1013) and are
    // followed by rows of the same title with the product's real code (SKU-1007, SKU-1012, SKU-1014).
    it.each([
      ["Pánské Tričko Bavlna", 25, 29, "panske-tricko-bavlna", 5],
      ["Žehlička Na Vlasy Keramická", 39, 41, "zehlicka-na-vlasy-keramicka", 3],
      ["Koberec Shaggy 160x230", 43, 47, "koberec-shaggy-160x230", 5],
    ])("%s is ONE product of %i variants (rows %i-%i)", (title, first, last, handle, variants) => {
      const { records } = shopifyRecords(name);
      const rowsOfProduct = records.slice(first - 1, last);
      expect(rowsOfProduct).toHaveLength(variants);
      expect(new Set(rowsOfProduct.map((record) => record.Handle))).toEqual(new Set([handle]));
      expect(rowsOfProduct.map((record) => record.Title)).toEqual([title, ...Array(variants - 1).fill("")]);
      expect(records.filter((record) => record.Handle === handle)).toHaveLength(variants);
      // the option names come from the product's first row, and every variant has its own combination
      expect([rowsOfProduct[0]["Option1 Name"], rowsOfProduct[0]["Option2 Name"]]).toEqual(["Size", "Color"].map((option, index) => (name === "messy-150.csv" ? ["Velikost", "Barva"][index] : option)));
      expect(new Set(rowsOfProduct.map((record) => `${record["Option1 Value"]}/${record["Option2 Value"]}`)).size).toBe(variants);
    });

    it("so the file has 57 products, not 60, and only the products that really come back later carry -2", () => {
      const { records, report } = shopifyRecords(name);
      expect(report.productCount).toBe(57);
      // the rows that used to be split off (26, 40, 44) are variants now; the later, non-adjacent rows are different products
      expect([26, 40, 44].map((row) => records[row - 1].Title)).toEqual(["", "", ""]);
      expect([128, 141, 143].map((row) => records[row - 1].Handle)).toEqual(["panske-tricko-bavlna-2", "zehlicka-na-vlasy-keramicka-2", "koberec-shaggy-160x230-2"]);
    });

    it("every variant keeps a unique SKU (the first row keeps its own, the others get their option values)", () => {
      const { records } = shopifyRecords(name);
      expect(records.slice(24, 29).map((record) => record["Variant SKU"])).toEqual(["SKU-1006", "SKU-1007-M-CERNA", "SKU-1007-M-SEDA", "SKU-1007-L-CERNA", "SKU-1007-XL-CERNA"]);
      expect(new Set(records.map((record) => record["Variant SKU"].toLowerCase())).size).toBe(150);
    });

    it("is reported as 'SKU copied from previous product' for rows 26, 40, 44 and 71 (the spreadsheet's numbers), saying what became of each", () => {
      const { report } = shopifyRecords(name);
      const warning = report.warnings.find((entry) => entry.kind === "sku_copied");
      expect(warning).toMatchObject({ severity: "warning", title: "SKU copied from previous product", count: 4, rows: [26, 40, 44, 71] });
      expect(warning?.details).toEqual([
        'SKU-1006 is also the code of "Dětská Zimní Bunda" above (row 22); grouped with the 4 rows below it',
        'SKU-1011 is also the code of "Batoh Na Notebook 15.6" above (row 37); grouped with the 2 rows below it',
        'SKU-1013 is also the code of "Pokojová Rostlina Kaktus" above (row 43); grouped with the 4 rows below it',
        'SKU-1024 is also the code of "Cestovní Kufr ABS 65L" above (row 68); kept as its own product',
      ]);
    });
  });

  it("no handle has two variants with the same option values", () => {
    const { rows, report } = shopifyRecords(name);
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.Handle}|${row.Option1_Value.toLowerCase()}|${row.Option2_Value.toLowerCase()}`;
      expect(seen.has(key), `${row.Handle} repeats ${row.Option1_Value} / ${row.Option2_Value}`).toBe(false);
      seen.add(key);
    }
    expect(kinds(report.warnings)).not.toContain("duplicate_variant");
  });

  it("writes the catalog columns", () => {
    const { headers } = shopifyRecords(name);
    expect(headers).toEqual([
      "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Image Src", "Image Position", "Variant Price", "Variant SKU",
      "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Variant Barcode", "Variant Inventory Tracker", "Variant Inventory Qty", "Status",
    ]);
  });

  describe("known rows", () => {
    // [source row, what the output row must hold], read off the CSV: row 3 is "S, Šedá" of the first chair with an EAN and stock "skladem" ...
    it.each([
      [1, { Handle: "profesionalni-penova-matrace-xl", Title: "Profesionální Pěnová Matrace XL", Vendor: "Łódź Hurt sp. z o.o.", Type: "Móda", "Variant SKU": "SKU-1000", "Variant Inventory Qty": "12", "Variant Inventory Tracker": "shopify", "Variant Barcode": "", "Variant Price": "1899.00", "Image Position": "1", Status: "draft" }],
      [2, { Vendor: "Tech-Import", Type: "Dům a zahrada", "Variant SKU": "SKU-1001-S-CERNA", "Option1 Value": "S", "Option2 Value": "Černá", "Variant Inventory Qty": "", "Variant Inventory Tracker": "", "Variant Price": "799.00", Status: "draft" }],
      [3, { Vendor: "", Type: "", Title: "", "Variant SKU": "SKU-1001-S-SEDA", "Option2 Value": "Šedá", "Variant Barcode": "8371407742358", "Variant Inventory Qty": "", "Variant Price": "149.50", Status: "" }],
      [4, { "Variant SKU": "SKU-1001-M-CERNA", "Variant Inventory Qty": "12", "Variant Inventory Tracker": "shopify", "Variant Price": "1899.00" }],
      [5, { "Variant SKU": "SKU-1001-L-CERNA", "Variant Inventory Qty": "5", "Variant Inventory Tracker": "shopify", "Variant Price": "499.50" }],
      [7, { Vendor: "Tech-Import", "Variant SKU": "SKU-1002-S-CERNA", "Variant Barcode": "9026421533917", "Variant Inventory Qty": "12", "Variant Price": "399.90" }],
      [14, { Vendor: "Říčany Wholesale", Type: "Kuchyně", "Variant Barcode": "2181934668157", "Variant Inventory Qty": "5", "Variant Price": "199.00" }],
      [25, { Handle: "panske-tricko-bavlna", Title: "Pánské Tričko Bavlna", "Variant SKU": "SKU-1006", "Option1 Value": "S", "Option2 Value": "Černá", "Variant Barcode": "9814531173585", "Variant Inventory Qty": "", "Body (HTML)": "" }],
      [26, { Handle: "panske-tricko-bavlna", Title: "", "Variant SKU": "SKU-1007-M-CERNA", "Option1 Value": "M", "Variant Inventory Qty": "0", "Variant Inventory Tracker": "shopify", "Variant Price": "1899.00" }],
      [70, { Vendor: "DomoPlus", Type: "Elektronika", "Variant SKU": "SKU-1024", "Variant Barcode": "1971982872522", "Variant Inventory Qty": "0", "Variant Inventory Tracker": "shopify", "Variant Price": "1299.90" }],
    ])("source row %i", (row, expected) => {
      const { records } = shopifyRecords(name);
      expect(records[row - 1]).toMatchObject(expected);
    });

    it("the vendors are tidied: ALL CAPS fixed, spaces trimmed, mixed case left alone", () => {
      const { raw, records } = shopifyRecords(name);
      const productVendors = new Map<string, string>();
      for (const record of records) if (record.Vendor !== "") productVendors.set(record.Handle, record.Vendor);
      const vendors = new Set(productVendors.values());
      expect([...vendors].sort()).toEqual(["DomoPlus", "Tech-Import", "Příbramská Výroba", "Říčany Wholesale", "Łódź Hurt sp. z o.o.", "Žďárské Textilie s.r.o."].sort());
      expect(raw.some((entry) => entry.vendor === "  DomoPlus  ")).toBe(true); // it really arrived with spaces around it
    });

    it("the types are tidied the same way ('ELEKTRONIKA' -> 'Elektronika')", () => {
      const { records } = shopifyRecords(name);
      const types = new Set(records.map((record) => record.Type).filter(Boolean));
      expect([...types].sort()).toEqual(["Dům a zahrada", "Elektronika", "Kuchyně", "Móda", "Sport & Outdoor"].sort());
    });

    it("the stock that is a number is kept for every such row, and the tracker is on exactly then", () => {
      const { raw, records } = shopifyRecords(name);
      raw.forEach((entry, index) => {
        const numeric = /^\s*\d+\s*$/.test(entry.stock ?? "");
        expect(records[index]["Variant Inventory Qty"], `row ${index + 1}`).toBe(numeric ? String(Number((entry.stock ?? "").trim())) : "");
        expect(records[index]["Variant Inventory Tracker"], `row ${index + 1}`).toBe(numeric ? "shopify" : "");
      });
    });

    it("every barcode of the file (42) is written to its own row, the 36 with a wrong check digit too", () => {
      const { raw, records } = shopifyRecords(name);
      const given = raw.filter((entry) => (entry.barcode ?? "") !== "");
      expect(given).toHaveLength(42);
      raw.forEach((entry, index) => expect(records[index]["Variant Barcode"], `row ${index + 1}`).toBe(entry.barcode ?? ""));
    });
  });

  describe("duplicate SKUs", () => {
    it("are reported: 90 variants share a SKU within their product, and 4 reuse another product's SKU", () => {
      const { report } = shopifyRecords(name);
      const within = report.warnings.find((warning) => warning.kind === "duplicate_sku_in_product");
      const across = report.warnings.find((warning) => warning.kind === "duplicate_sku_across_products");
      expect(within).toMatchObject({ count: 90, rows: [4, 5, 6, 7, 9, 10, 11, 12, 13, 14] });
      expect(across).toMatchObject({ count: 4, rows: [26, 40, 44, 71] });
      expect(across?.details?.slice(0, 2)).toEqual(["SKU-1006 (first used in row 22)", "SKU-1011 (first used in row 37)"]);
    });

    it("are reported with the switch off too, and then written as supplied", () => {
      const { report, records } = shopifyRecords(name, { uniqueSkus: false });
      expect(report.warnings.find((warning) => warning.kind === "duplicate_sku_in_product")).toMatchObject({ count: 90 });
      expect(report.skuChanges).toEqual([]);
      expect(records.filter((record) => record["Variant SKU"] === "SKU-1001")).toHaveLength(5);
    });

    it("with the switch on (its default for this file) every SKU is unique, built from ASCII-slugged option values, and the changed rows are listed", () => {
      const { report, records } = shopifyRecords(name);
      expect(report.options.uniqueSkus).toBe(true);
      const skus = records.map((record) => record["Variant SKU"].toLowerCase());
      expect(new Set(skus).size).toBe(150);
      expect(records.slice(1, 6).map((record) => record["Variant SKU"])).toEqual(["SKU-1001-S-CERNA", "SKU-1001-S-SEDA", "SKU-1001-M-CERNA", "SKU-1001-L-CERNA", "SKU-1001-XL-CERNA"]);
      expect(records.every((record) => /^[A-Za-z0-9-]*$/.test(record["Variant SKU"]))).toBe(true);
      expect(report.skuChanges.length).toBeGreaterThan(0);
      for (const change of report.skuChanges) {
        expect(change.to.startsWith(change.from), `${change.from} -> ${change.to}`).toBe(true);
        expect(records[change.row - 2]["Variant SKU"]).toBe(change.to);
      }
      const listed = report.warnings.find((warning) => warning.kind === "sku_changed");
      expect(listed).toMatchObject({ count: report.skuChanges.length, rows: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
      expect(listed?.details?.[0]).toBe("SKU-1001 -> SKU-1001-S-CERNA");
    });
  });

  describe("placeholder descriptions", () => {
    it("are reported, and empty in the output (15 rows say 'popis není k dispozici')", () => {
      const { report, records } = shopifyRecords(name);
      expect(report.warnings.find((warning) => warning.kind === "placeholder_description")).toMatchObject({ count: 15, rows: [26, 27, 28, 29, 30, 49, 73, 74, 85, 86] });
      expect(records.some((record) => /dispozici/i.test(record["Body (HTML)"]))).toBe(false);
    });

    it("a product whose rows all say so has no description at all", () => {
      const { records } = shopifyRecords(name);
      // first rows of the products made of placeholder rows only: 25, 26-29, 48, 72, 73, 84-89, 124
      for (const row of [25, 26, 48, 72, 73, 84, 124]) expect(records[row - 1]["Body (HTML)"], `row ${row}`).toBe("");
      expect(records[1]["Body (HTML)"]).toMatch(/^<p>Odolný materiál/); // a real one is kept
    });
  });

  it("images: written once per product, numbered 1, 2, 3 in order, and nothing is lost that was on the first variant", () => {
    const { records } = shopifyRecords(name);
    const byHandle = new Map<string, Array<{ src: string; position: string }>>();
    for (const record of records) {
      if (record["Image Src"] === "") {
        expect(record["Image Position"]).toBe("");
        continue;
      }
      byHandle.set(record.Handle, [...(byHandle.get(record.Handle) ?? []), { src: record["Image Src"], position: record["Image Position"] }]);
    }
    for (const [handle, images] of byHandle) {
      expect(images.map((image) => image.position), handle).toEqual(images.map((_, index) => String(index + 1)));
      expect(new Set(images.map((image) => image.src)).size, handle).toBe(images.length);
      for (const image of images) expect(image.src).toMatch(/^https?:\/\//);
    }
    expect(records[0]["Image Position"]).toBe("1");
    expect(records[2]).toMatchObject({ "Image Src": "https://example.com/img/SKU-1001.jpg", "Image Position": "2" }); // row 3: the chair's second picture
    expect(records[3]["Image Src"]).toBe(""); // row 4 repeats the first picture
  });

  it("the other warnings are what the file contains: 17 split products, 36 barcodes with a wrong check digit, 47 unusable stock values, 59 prices with a symbol, nothing else", () => {
    const { report } = shopifyRecords(name);
    expect(kinds(report.warnings)).toEqual([
      "split_product",
      "sku_copied",
      "duplicate_sku_in_product",
      "duplicate_sku_across_products",
      "sku_changed",
      "ean_check_digit",
      "non_numeric_stock",
      "placeholder_description",
      "currency_symbol_in_price",
    ]);
    expect(report.warnings.find((warning) => warning.kind === "non_numeric_stock")).toMatchObject({ count: 47, rows: [3, 4, 14, 16, 19, 23, 25, 26, 28, 29] });
    expect(report.warnings.find((warning) => warning.kind === "currency_symbol_in_price")).toMatchObject({ count: 59, rows: [13, 15, 16, 17, 21, 23, 27, 28, 30, 31], severity: "info" });
    expect(report.warnings.find((warning) => warning.kind === "split_product")).toMatchObject({ count: 17, rows: [100, 105, 107, 112, 119, 125, 126, 129, 130, 131] });
    expect(report.warnings.find((warning) => warning.kind === "ean_check_digit")).toMatchObject({ count: 36, rows: [4, 8, 10, 13, 15, 16, 21, 24, 25, 26] });
    // CZK and Kč are one currency, and all 42 EANs have a valid length (6 of them also the right check digit): neither is a warning
    expect(kinds(report.warnings)).not.toContain("mixed_currencies");
    expect(kinds(report.warnings)).not.toContain("invalid_ean");
  });

  it("Import as active: every product's first row says active", () => {
    const { records } = shopifyRecords(name, { status: "active" });
    const statuses = records.filter((record) => record.Title !== "").map((record) => record.Status);
    expect(statuses).toHaveLength(57);
    expect(new Set(statuses)).toEqual(new Set(["active"]));
    expect(records.filter((record) => record.Title === "").every((record) => record.Status === "")).toBe(true);
  });
});

describe("the English and the Czech file", () => {
  it("produce the same Shopify file, apart from what the options are called", () => {
    const strip = (records: Array<Record<string, string>>) => records.map((record) => ({ ...record, "Option1 Name": "", "Option2 Name": "" }));
    const english = shopifyRecords("messy-150-en.csv");
    const czech = shopifyRecords("messy-150.csv");
    expect(strip(czech.records)).toEqual(strip(english.records));
    expect(english.records[1]["Option1 Name"]).toBe("Size");
    expect(czech.records[1]["Option1 Name"]).toBe("Velikost");
    expect(czech.records[1]["Option2 Name"]).toBe("Barva");
    expect(czech.report.warnings).toEqual(english.report.warnings);
  });
});
