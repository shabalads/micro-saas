import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { toShopifyCsv } from "../full-export/csv-writer";
import type { RawOption, RawSupplierRow, SanitizeWarning, WarningKind } from "../types/csv";
import { MAX_WARNING_ROWS, sanitizeDataset, suggestUniqueSkus } from "./sanitizer";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });
const opt = (name: string, value: string, derived = false): RawOption => ({ name, value, derived });
/** Attribute columns headed "Size" and "Color": each only counts as an option if it differs between a product's variants. */
const sizeColor = (size: string, color: string): RawOption[] => [opt("Size", size, true), opt("Color", color, true)];
/** Option1 / Option2 Value style columns: always options. */
const sizeColorExplicit = (size: string, color: string): RawOption[] => [opt("Size", size), opt("Color", color)];

const warningOf = (warnings: SanitizeWarning[], kind: WarningKind): SanitizeWarning | undefined => warnings.find((warning) => warning.kind === kind);
const kindsOf = (warnings: SanitizeWarning[]): WarningKind[] => warnings.map((warning) => warning.kind);

function csvOf(raw: RawSupplierRow[], options = {}) {
  const { rows } = sanitizeDataset(raw, options);
  const parsed = Papa.parse<Record<string, string>>(toShopifyCsv(rows), { header: true, skipEmptyLines: true });
  return { headers: parsed.meta.fields ?? [], records: parsed.data };
}

describe("which rows are one product", () => {
  it("a product-code column groups the variants, and only the rows next to each other", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", productCode: "A", sku: "A-S", options: sizeColor("S", "Red") }),
      row({ title: "Tee", productCode: "A", sku: "A-M", options: sizeColor("M", "Red") }),
      row({ title: "Cap", productCode: "B", sku: "B-1", options: sizeColor("S", "Red") }),
      row({ title: "Tee", productCode: "A", sku: "A-L", options: sizeColor("L", "Red") }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["tee", "Tee"], ["tee", ""], ["cap", "Cap"], ["tee-2", "Tee"]]);
    expect(report).toMatchObject({ productCount: 3, variantRows: 1 });
    expect(warningOf(report.warnings, "split_product")).toMatchObject({ count: 1, rows: [4] });
  });

  it("the same title under a DIFFERENT product code, even right next to it, is a separate product (-2, -3) and is warned about", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", productCode: "A", options: sizeColor("S", "Red") }),
      row({ title: "Tee", productCode: "A", options: sizeColor("M", "Red") }),
      row({ title: "Tee", productCode: "B", options: sizeColor("S", "Red") }),
      row({ title: "Tee", productCode: "C", options: sizeColor("S", "Red") }),
    ]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["tee", "tee", "tee-2", "tee-3"]);
    expect(report.productCount).toBe(3);
    expect(warningOf(report.warnings, "split_product")).toMatchObject({ count: 2, rows: [3, 4] });
    expect(warningOf(report.warnings, "split_product")?.details?.[0]).toMatch(/"Tee" again \(first in row 1\) is now tee-2/);
  });

  it("the same product code on DIFFERENT titles is two products", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Jacket", productCode: "A", options: sizeColor("S", "Red") }),
      row({ title: "T-Shirt", productCode: "A", options: sizeColor("S", "Red") }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["jacket", "Jacket"], ["t-shirt", "T-Shirt"]]);
  });

  it("a SKU column that the variants of a product share is the product code (and a unique-per-variant SKU column is not)", () => {
    const shared = sanitizeDataset([
      row({ title: "Tee", sku: "SKU-1", options: sizeColor("S", "Red") }),
      row({ title: "Tee", sku: "SKU-1", options: sizeColor("M", "Red") }),
      row({ title: "Tee", sku: "SKU-2", options: sizeColor("S", "Red") }),
    ]);
    expect(shared.rows.map((entry) => entry.Handle)).toEqual(["tee", "tee", "tee-2"]);

    const perVariant = sanitizeDataset([
      row({ title: "Tee", sku: "TEE-S", options: sizeColor("S", "Red") }),
      row({ title: "Tee", sku: "TEE-M", options: sizeColor("M", "Red") }),
      row({ title: "Tee", sku: "TEE-L", options: sizeColor("L", "Red") }),
    ]);
    expect(perVariant.rows.map((entry) => entry.Handle)).toEqual(["tee", "tee", "tee"]);
    expect(perVariant.report.productCount).toBe(1);
  });

  it("without a code, the same title next to each other are variants only when they differ by an option", () => {
    expect(sanitizeDataset([row({ title: "Mug", sku: "1" }), row({ title: "Mug", sku: "2" })]).rows.map((entry) => entry.Handle)).toEqual(["mug", "mug-2"]);
    expect(sanitizeDataset([row({ title: "Mug", options: [opt("Size", "S", true)] }), row({ title: "Mug", options: [opt("Size", "M", true)] })]).rows.map((entry) => entry.Handle)).toEqual(["mug", "mug"]);
  });

  it("NEVER merges a non-adjacent row into an earlier product: A B A is three products, A again gets -2, a third -3", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", sku: "T1", options: sizeColor("S", "Red") }),
      row({ title: "Cap", sku: "C1", options: sizeColor("S", "Red") }),
      row({ title: "Tee", sku: "T2", options: sizeColor("M", "Red") }),
      row({ title: "Hat", sku: "H1", options: sizeColor("S", "Red") }),
      row({ title: "Tee", sku: "T3", options: sizeColor("L", "Red") }),
    ]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["tee", "cap", "tee-2", "hat", "tee-3"]);
    expect(report).toMatchObject({ productCount: 5, variantRows: 0, duplicateHandlesResolved: 2 });
    expect(warningOf(report.warnings, "split_product")).toMatchObject({ count: 2, rows: [3, 5] });
  });

  it("every handle is one block: no handle ever comes back after another", () => {
    const { rows } = sanitizeDataset(Array.from({ length: 30 }, (_, i) => row({ title: i % 3 === 0 ? "Tee" : `Item ${i % 5}`, sku: `S${i}`, options: sizeColor("S", `C${i}`) })));
    const seen = new Set<string>();
    let previous = "";
    for (const { Handle } of rows) {
      if (Handle !== previous) expect(seen.has(Handle), `${Handle} reappears`).toBe(false);
      seen.add(Handle);
      previous = Handle;
    }
  });

  it("duplicate option combinations under one handle are warned about with the rows, never silent", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", productCode: "A", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", productCode: "A", options: sizeColorExplicit("M", "Red") }),
      row({ title: "Tee", productCode: "A", options: sizeColorExplicit("s", "red") }),
      row({ title: "Tee", productCode: "A", options: sizeColorExplicit("M", "Red") }),
    ]);
    expect(new Set(rows.map((entry) => entry.Handle)).size).toBe(1); // still one product: the file said so
    expect(warningOf(report.warnings, "duplicate_variant")).toMatchObject({ count: 2, rows: [3, 4], details: ["repeats row 1: S / Red", "repeats row 2: M / Red"] });
  });
});

describe("a code copied from the previous product", () => {
  // Rows of a "Jacket" coded J-1, then a "Tee" whose first row wrongly carries J-1 too, then the tee's real rows coded T-1.
  const jacket = [
    row({ title: "Jacket", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
    row({ title: "Jacket", sku: "J-1", options: sizeColorExplicit("M", "Red") }),
  ];

  it("is not trusted for grouping: the same title with other option values right below it is ONE product, whatever the first row's code says", () => {
    const { rows, report } = sanitizeDataset([
      ...jacket,
      row({ title: "Tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("M", "Red") }),
      row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("L", "Red") }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title, entry.Option1_Value])).toEqual([
      ["jacket", "Jacket", "S"], ["jacket", "", "M"],
      ["tee", "Tee", "S"], ["tee", "", "M"], ["tee", "", "L"],
    ]);
    expect(report).toMatchObject({ productCount: 2, variantRows: 3 });
    expect(kindsOf(report.warnings)).not.toContain("split_product");
    expect(warningOf(report.warnings, "sku_copied")).toMatchObject({
      severity: "warning",
      title: "SKU copied from previous product",
      count: 1,
      rows: [3],
      details: ['J-1 is also the code of "Jacket" above (row 1); grouped with the 2 rows below it'],
    });
  });

  it("works with a product-code column too, and the SKU column stays out of it", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Jacket", productCode: "J", sku: "J-S", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", productCode: "J", sku: "T-S", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", productCode: "T", sku: "T-M", options: sizeColorExplicit("M", "Red") }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Variant_SKU])).toEqual([["jacket", "J-S"], ["tee", "T-S"], ["tee", "T-M"]]);
  });

  it("the variants keep unique SKUs through the existing switch", () => {
    const raw = [
      ...jacket,
      row({ title: "Tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("M", "Red") }),
      row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("L", "Red") }),
    ];
    const on = sanitizeDataset(raw, { uniqueSkus: true });
    const skus = on.rows.map((entry) => entry.Variant_SKU);
    expect(new Set(skus.map((sku) => sku.toLowerCase())).size).toBe(skus.length);
    expect(skus).toEqual(["J-1-S-RED", "J-1-M-RED", "J-1", "T-1-M-RED", "T-1-L-RED"]);
    expect(sanitizeDataset(raw, { uniqueSkus: false }).rows.map((entry) => entry.Variant_SKU)).toEqual(["J-1", "J-1", "J-1", "T-1", "T-1"]);
  });

  describe("two genuinely different products with the same title stay separate", () => {
    it("when the rows have the SAME options (a second tee is not a variant of the first)", () => {
      const { rows, report } = sanitizeDataset([
        ...jacket,
        row({ title: "Tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("S", "Red") }),
      ]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "jacket", "tee", "tee-2"]);
      expect(report.productCount).toBe(3);
      expect(warningOf(report.warnings, "split_product")).toMatchObject({ count: 1, rows: [4] });
      expect(warningOf(report.warnings, "sku_copied")).toMatchObject({ rows: [3] });
    });

    it("when they are not next to each other, even with other options", () => {
      const { rows, report } = sanitizeDataset([
        ...jacket,
        row({ title: "Tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Cap", sku: "C-1", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("M", "Red") }),
      ]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "jacket", "tee", "cap", "tee-2"]);
      expect(warningOf(report.warnings, "split_product")).toMatchObject({ count: 1, rows: [5] });
    });

    it("when there are no option values to tell the rows apart", () => {
      const { rows } = sanitizeDataset([row({ title: "Jacket", sku: "J-1" }), row({ title: "Tee", sku: "J-1" }), row({ title: "Tee", sku: "T-1" })]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "tee", "tee-2"]);
    });

    it("when the code is NOT a copy: a different code, even next to it and with other options, is another product", () => {
      const { rows } = sanitizeDataset([
        ...jacket, // the file's SKUs are shared by the variants of a product, so they are product codes
        row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Tee", sku: "T-2", options: sizeColorExplicit("M", "Red") }),
      ]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "jacket", "tee", "tee-2"]);
    });

    it("whereas a file whose SKUs differ on every variant is grouped by title and options, as before", () => {
      const { rows } = sanitizeDataset([
        row({ title: "Tee", sku: "T-S", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Tee", sku: "T-M", options: sizeColorExplicit("M", "Red") }),
      ]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["tee", "tee"]);
    });

    it("once the row below has brought the product's real code, a row with yet another code is another product again", () => {
      const { rows } = sanitizeDataset([
        ...jacket,
        row({ title: "Jacket", sku: "J-1", options: sizeColorExplicit("L", "Red") }),
        row({ title: "Tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
        row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("M", "Red") }),
        row({ title: "Tee", sku: "T-9", options: sizeColorExplicit("L", "Red") }),
      ]);
      expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "jacket", "jacket", "tee", "tee", "tee-2"]);
    });
  });

  it("a code shared by rows of the SAME title is just a product, not a copy", () => {
    const { report } = sanitizeDataset([...jacket, row({ title: "Jacket", sku: "J-1", options: sizeColorExplicit("L", "Red") })]);
    expect(kindsOf(report.warnings)).not.toContain("sku_copied");
    expect(report.productCount).toBe(1);
  });

  it("a file with a handle column is grouped by its handles, so nothing is read as copied", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Jacket", handle: "jacket", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
      row({ title: "Tee", handle: "tee", sku: "J-1", options: sizeColorExplicit("S", "Red") }),
    ]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["jacket", "tee"]);
    expect(kindsOf(report.warnings)).not.toContain("sku_copied");
  });

  it("the grouping never depends on the casing chosen", () => {
    const raw = [...jacket, row({ title: "TEE", sku: "J-1", options: sizeColorExplicit("S", "Red") }), row({ title: "Tee", sku: "T-1", options: sizeColorExplicit("M", "Red") })];
    for (const casing of ["title", "sentence", "keep"] as const) {
      expect(sanitizeDataset(raw, { casing }).rows.map((entry) => entry.Handle), casing).toEqual(["jacket", "jacket", "tee", "tee"]);
    }
  });
});

describe("EAN check digit", () => {
  it("a barcode with the right length and a wrong last digit is written as supplied, and warned about with the digit it should have", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "A", barcode: "12345670" }), // right
      row({ title: "B", barcode: "12345678" }), // wrong
      row({ title: "C", barcode: "8371407742358" }), // wrong
      row({ title: "D", barcode: "4006381333931" }), // right
      row({ title: "E", barcode: "" }),
    ]);
    expect(rows.map((entry) => entry.Variant_Barcode)).toEqual(["12345670", "12345678", "8371407742358", "4006381333931", ""]);
    expect(warningOf(report.warnings, "ean_check_digit")).toMatchObject({
      severity: "warning",
      count: 2,
      rows: [2, 3],
      details: ["12345678 (the last digit should be 0)", "8371407742358 (the last digit should be 3)"],
    });
    expect(kindsOf(report.warnings)).not.toContain("invalid_ean");
  });

  it("is separate from the invalid-length warning, and a barcode that is not a barcode gets only that one", () => {
    const { report } = sanitizeDataset([row({ title: "A", barcode: "1234567" }), row({ title: "B", barcode: "12345678" })]);
    expect(warningOf(report.warnings, "invalid_ean")).toMatchObject({ count: 1, rows: [1] });
    expect(warningOf(report.warnings, "ean_check_digit")).toMatchObject({ count: 1, rows: [2] });
  });

  it("lists at most 10 rows but counts them all", () => {
    const { report } = sanitizeDataset(Array.from({ length: 14 }, (_, i) => row({ title: `Item ${i}`, barcode: "12345678" })));
    expect(warningOf(report.warnings, "ean_check_digit")).toMatchObject({ count: 14, rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });
});

describe("keeping the catalog data", () => {
  const base = { title: "Tee", productCode: "A" };

  it("Vendor: trimmed, spaces collapsed, ALL CAPS fixed like a title, placeholders empty", () => {
    const vendors = (...values: string[]) => sanitizeDataset(values.map((vendor, i) => row({ title: `Item ${i}`, vendor }))).rows.map((entry) => entry.Vendor);
    expect(vendors("  Domo   Plus  ", "TECH-IMPORT", "DomoPlus", "ŁÓDŹ HURT SP. Z O.O.", "N/A", "")).toEqual(["Domo Plus", "Tech-Import", "DomoPlus", "Łódź Hurt sp. z o.o.", "", ""]);
  });

  it("Type comes from the category, tidied the same way, so 'ELEKTRONIKA' and 'Elektronika' are one type", () => {
    const { rows } = sanitizeDataset([row({ title: "A", category: "ELEKTRONIKA" }), row({ title: "B", category: "Elektronika" }), row({ title: "C", category: "Sport & Outdoor" }), row({ title: "D", category: "  " })]);
    expect(rows.map((entry) => entry.Type)).toEqual(["Elektronika", "Elektronika", "Sport & Outdoor", ""]);
  });

  it("Tags: split, deduplicated across the product's rows", () => {
    const { rows } = sanitizeDataset([row({ ...base, tags: "red; sale", options: sizeColor("S", "R") }), row({ ...base, tags: "Sale | new", options: sizeColor("M", "R") })]);
    expect(rows[0].Tags).toBe("red, sale, new");
  });

  it("product-level fields are on the product's first row only, and come from the first row that has them", () => {
    const { rows } = sanitizeDataset([
      row({ ...base, vendor: "", category: "", options: sizeColor("S", "R") }),
      row({ ...base, vendor: "ACME", category: "Moda", options: sizeColor("M", "R") }),
    ]);
    expect(rows.map((entry) => [entry.Vendor, entry.Type, entry.Status])).toEqual([["Acme", "Moda", "draft"], ["", "", ""]]);
  });

  it("Stock becomes Variant Inventory Qty (trimmed integers, 0 included), and a quantity switches the tracker to shopify", () => {
    const { rows, report } = sanitizeDataset([row({ title: "A", stock: "12" }), row({ title: "B", stock: "  5 " }), row({ title: "C", stock: "0" })]);
    expect(rows.map((entry) => [entry.Variant_Inventory_Qty, entry.Variant_Inventory_Tracker])).toEqual([["12", "shopify"], ["5", "shopify"], ["0", "shopify"]]);
    expect(report.warnings).toEqual([]);
  });

  it("non-numeric stock ('skladem') and blank stock stay empty, get no tracker, and are COUNTED with their rows", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "A", stock: "skladem" }),
      row({ title: "B", stock: "7" }),
      row({ title: "C", stock: "" }),
      row({ title: "D", stock: "-2" }),
    ]);
    expect(rows.map((entry) => [entry.Variant_Inventory_Qty, entry.Variant_Inventory_Tracker])).toEqual([["", ""], ["7", "shopify"], ["", ""], ["", ""]]);
    expect(warningOf(report.warnings, "non_numeric_stock")).toMatchObject({ count: 3, rows: [1, 3, 4], details: ['"skladem"', "(blank)", '"-2"'] });
  });

  it("a file without a stock column gets no inventory columns and no stock warning", () => {
    const { headers } = csvOf([row({ title: "A" })]);
    expect(headers).not.toContain("Variant Inventory Qty");
    expect(headers).not.toContain("Variant Inventory Tracker");
  });

  it("Variant Barcode comes from the EAN; 8, 12, 13 and 14 digits are valid, anything else is warned about and left out", () => {
    const eans = ["12345678", "123456789012", "8371407742358", "12345678901234", "1234567", "ABC", "", "859 012 345 6789"];
    const { rows, report } = sanitizeDataset(eans.map((barcode, i) => row({ title: `Item ${i}`, barcode })));
    expect(rows.map((entry) => entry.Variant_Barcode)).toEqual(["12345678", "123456789012", "8371407742358", "12345678901234", "", "", "", "8590123456789"]);
    expect(warningOf(report.warnings, "invalid_ean")).toMatchObject({ count: 2, rows: [5, 6], details: ['"1234567"', '"ABC"'] });
  });

  it("weight becomes Variant Grams in whole grams (unit from the cell or the header)", () => {
    const { rows, report } = sanitizeDataset([row({ title: "A", weight: "0,5 kg" }), row({ title: "B", weight: "250", weightUnit: "g" }), row({ title: "C", weight: "heavy" }), row({ title: "D", weight: "" })]);
    expect(rows.map((entry) => entry.Variant_Grams)).toEqual(["500", "250", "", ""]);
    expect(warningOf(report.warnings, "invalid_weight")).toMatchObject({ count: 1, rows: [3] });
  });

  it("writes the catalog columns only when the file has the data, and Status always", () => {
    expect(csvOf([row({ title: "A" })]).headers).toEqual(["Handle", "Title", "Body (HTML)", "Image Src", "Variant Price", "Variant SKU", "Status"]);
    const full = csvOf([row({ title: "A", vendor: "V", category: "T", tags: "x", stock: "3", barcode: "12345678", weight: "10", images: "https://a.example.com/1.jpg" })]);
    expect(full.headers).toEqual(["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Image Src", "Image Position", "Variant Price", "Variant SKU", "Variant Barcode", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty", "Status"]);
    expect(full.records[0]).toMatchObject({ Vendor: "V", Type: "T", Tags: "x", "Variant Barcode": "12345678", "Variant Grams": "10", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "3", Status: "draft" });
  });
});

describe("currencies", () => {
  it("are not exported, but a file that mixes them is warned about, row by row", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "A", price: "9,90", currency: "CZK" }),
      row({ title: "B", price: "9,90", currency: "CZK" }),
      row({ title: "C", price: "9,90", currency: "EUR" }),
      row({ title: "D", price: "9,90", currency: "USD" }),
    ]);
    expect(rows.every((entry) => !JSON.stringify(entry).includes("EUR"))).toBe(true);
    expect(warningOf(report.warnings, "mixed_currencies")).toMatchObject({ count: 2, rows: [3, 4] });
    expect(warningOf(report.warnings, "mixed_currencies")?.message).toContain("CZK, EUR, USD");
  });

  it("CZK, czk and Kč are one currency", () => {
    const { report } = sanitizeDataset([row({ title: "A", currency: "CZK" }), row({ title: "B", currency: "Kč" }), row({ title: "C", currency: "czk" }), row({ title: "D", currency: "" })]);
    expect(kindsOf(report.warnings)).not.toContain("mixed_currencies");
  });

  it("a symbol in the price is noted (and removed from the price); a symbol that contradicts the currency column is a mix", () => {
    const { rows, report } = sanitizeDataset([row({ title: "A", price: "199,00 Kč", currency: "CZK" }), row({ title: "B", price: "$12.50", currency: "CZK" }), row({ title: "C", price: "12,50" })]);
    expect(rows.map((entry) => entry.Variant_Price)).toEqual(["199.00", "12.50", "12.50"]);
    expect(warningOf(report.warnings, "currency_symbol_in_price")).toMatchObject({ severity: "info", count: 2, rows: [1, 2], details: ["199,00 Kč", "$12.50"] });
    expect(warningOf(report.warnings, "mixed_currencies")).toMatchObject({ count: 1, rows: [2], details: ["USD (most rows are CZK)"] });
  });
});

describe("placeholder descriptions", () => {
  it("are empty in the output, and counted with their rows", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "A", description: "POPIS NENÍ K DISPOZICI" }),
      row({ title: "B", description: "n/a" }),
      row({ title: "C", description: "<p>brak opisu</p>" }),
      row({ title: "D", description: "A real description." }),
      row({ title: "E", description: "" }),
    ]);
    expect(rows.map((entry) => entry.Body_HTML)).toEqual(["", "", "", "<p>A real description.</p>", ""]);
    expect(warningOf(report.warnings, "placeholder_description")).toMatchObject({ count: 3, rows: [1, 2, 3] });
  });

  it("a real description on a later variant is used when the first one is a placeholder", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Tee", productCode: "A", description: "popis není k dispozici", options: sizeColor("S", "R") }),
      row({ title: "Tee", productCode: "A", description: "Soft cotton.", options: sizeColor("M", "R") }),
    ]);
    expect(rows.map((entry) => entry.Body_HTML)).toEqual(["<p>Soft cotton.</p>", ""]);
  });
});

describe("images", () => {
  it("an image repeated on several variants is written once, and positions run 1, 2, 3 across the product", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", productCode: "A", images: "https://cdn.example.com/a.jpg|https://cdn.example.com/b.jpg", options: sizeColor("S", "R") }),
      row({ title: "Tee", productCode: "A", images: "https://cdn.example.com/a.jpg", options: sizeColor("M", "R") }),
      row({ title: "Tee", productCode: "A", images: "https://cdn.example.com/c.jpg|https://cdn.example.com/b.jpg", options: sizeColor("L", "R") }),
    ]);
    expect(rows.map((entry) => [entry.Image_Src.slice(-5), entry.Image_Position, entry.Option1_Value])).toEqual([
      ["a.jpg", "1", "S"],
      ["b.jpg", "2", ""],
      ["", "", "M"],
      ["c.jpg", "3", "L"],
    ]);
    expect(report.duplicateImagesRemoved).toBe(2);
  });

  it("the position starts again at 1 for the next product", () => {
    const { rows } = sanitizeDataset([
      row({ title: "A", images: "https://cdn.example.com/1.jpg|https://cdn.example.com/2.jpg" }),
      row({ title: "B", images: "https://cdn.example.com/3.jpg" }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Image_Position])).toEqual([["a", "1"], ["a", "2"], ["b", "1"]]);
  });

  it("only the same URL is a duplicate: http and https, or two file types, are two images", () => {
    const { rows } = sanitizeDataset([row({ title: "A", images: "http://x.example.com/1.png|https://x.example.com/1.png|https://x.example.com/1.jpg" })]);
    expect(rows.map((entry) => entry.Image_Position)).toEqual(["1", "2", "3"]);
  });

  it("links that are not http(s) are left out and warned about with the row", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "A", images: "ftp://x.example.com/a.jpg|https://x.example.com/ok.jpg" }),
      row({ title: "B", images: "images/b.jpg" }),
      row({ title: "C", images: "https://x.example.com/c.jpg" }),
    ]);
    expect(rows.map((entry) => entry.Image_Src)).toEqual(["https://x.example.com/ok.jpg", "", "https://x.example.com/c.jpg"]);
    expect(warningOf(report.warnings, "invalid_image_url")).toMatchObject({ count: 2, rows: [1, 2], details: ['"ftp://x.example.com/a.jpg"', '"images/b.jpg"'] });
    expect(report.invalidImagesDropped).toBe(2);
  });
});

describe("Status", () => {
  const raw = [row({ title: "Tee", productCode: "A", options: sizeColor("S", "R") }), row({ title: "Tee", productCode: "A", options: sizeColor("M", "R") }), row({ title: "Cap" })];

  it("is draft by default, on each product's first row", () => {
    const { rows, report } = sanitizeDataset(raw);
    expect(rows.map((entry) => entry.Status)).toEqual(["draft", "", "draft"]);
    expect(report.options.status).toBe("draft");
  });

  it("is active when asked for", () => {
    const { records } = csvOf(raw, { status: "active" });
    expect(records.map((record) => record.Status)).toEqual(["active", "", "active"]);
  });
});

describe("SKUs", () => {
  const tee = [
    row({ title: "Tee", sku: "SKU-1001", options: sizeColor("S", "Černá") }),
    row({ title: "Tee", sku: "SKU-1001", options: sizeColor("S", "Šedá") }),
    row({ title: "Tee", sku: "SKU-1001", options: sizeColor("M", "Navy Blue") }),
  ];

  it("starts switched on when the variants of a product share one SKU, and off when they do not", () => {
    expect(suggestUniqueSkus(tee)).toBe(true);
    expect(suggestUniqueSkus([row({ title: "Tee", sku: "A", options: sizeColor("S", "R") }), row({ title: "Tee", sku: "B", options: sizeColor("M", "R") })])).toBe(false);
    expect(suggestUniqueSkus([row({ title: "Tee", sku: "A" }), row({ title: "Cap", sku: "B" })])).toBe(false);
  });

  it("makes them unique from ASCII-slugged option values (SKU-1001-S-CERNA) and lists every row it changed", () => {
    const { rows, report } = sanitizeDataset(tee, { uniqueSkus: true });
    expect(rows.map((entry) => entry.Variant_SKU)).toEqual(["SKU-1001-S-CERNA", "SKU-1001-S-SEDA", "SKU-1001-M-NAVY-BLUE"]);
    expect(report.skuChanges).toEqual([
      { row: 1, from: "SKU-1001", to: "SKU-1001-S-CERNA" },
      { row: 2, from: "SKU-1001", to: "SKU-1001-S-SEDA" },
      { row: 3, from: "SKU-1001", to: "SKU-1001-M-NAVY-BLUE" },
    ]);
    expect(warningOf(report.warnings, "sku_changed")).toMatchObject({ severity: "info", count: 3, rows: [1, 2, 3], details: ["SKU-1001 -> SKU-1001-S-CERNA", "SKU-1001 -> SKU-1001-S-SEDA", "SKU-1001 -> SKU-1001-M-NAVY-BLUE"] });
  });

  it("is on by default for such a file (no options given), and does nothing for a file whose SKUs already differ", () => {
    expect(sanitizeDataset(tee).report.options.uniqueSkus).toBe(true);
    expect(sanitizeDataset(tee).rows[0].Variant_SKU).toBe("SKU-1001-S-CERNA");
    const distinct = sanitizeDataset([row({ title: "Tee", sku: "A", options: sizeColor("S", "R") }), row({ title: "Tee", sku: "B", options: sizeColor("M", "R") })]);
    expect(distinct.report.options.uniqueSkus).toBe(false);
    expect(distinct.report.skuChanges).toEqual([]);
  });

  it("switched off, the SKUs are written as supplied and the duplicates are still reported", () => {
    const { rows, report } = sanitizeDataset(tee, { uniqueSkus: false });
    expect(rows.map((entry) => entry.Variant_SKU)).toEqual(["SKU-1001", "SKU-1001", "SKU-1001"]);
    expect(report.skuChanges).toEqual([]);
    const duplicate = warningOf(report.warnings, "duplicate_sku_in_product");
    expect(duplicate).toMatchObject({ count: 2, rows: [2, 3], details: ["SKU-1001 (also in row 1)", "SKU-1001 (also in row 1)"] });
    expect(duplicate?.message).toContain('Switch on "Make SKUs unique per variant"');
    expect(duplicate?.resolution).toBeUndefined();
  });

  it("duplicates are reported whether or not they were fixed; fixed ones say so", () => {
    const { report } = sanitizeDataset(tee, { uniqueSkus: true });
    const duplicate = warningOf(report.warnings, "duplicate_sku_in_product");
    expect(duplicate).toMatchObject({ count: 2, rows: [2, 3] });
    expect(duplicate?.resolution).toMatch(/Made unique/);
  });

  it("the same SKU on different products is reported, and made unique with -2 when it is still shared", () => {
    const raw = [row({ title: "Cap", sku: "X-1" }), row({ title: "Hat", sku: "X-1" }), row({ title: "Mug", sku: "X-1" })];
    const off = sanitizeDataset(raw, { uniqueSkus: false });
    expect(off.rows.map((entry) => entry.Variant_SKU)).toEqual(["X-1", "X-1", "X-1"]);
    expect(warningOf(off.report.warnings, "duplicate_sku_across_products")).toMatchObject({ count: 2, rows: [2, 3], details: ["X-1 (first used in row 1)", "X-1 (first used in row 1)"] });
    const on = sanitizeDataset(raw, { uniqueSkus: true });
    expect(on.rows.map((entry) => entry.Variant_SKU)).toEqual(["X-1", "X-1-2", "X-1-3"]);
    expect(on.report.skuChanges.map((change) => change.row)).toEqual([2, 3]);
  });

  it("with the switch on, every SKU in the file is unique, whatever the file looks like", () => {
    const raw = [
      ...tee,
      row({ title: "Tee", sku: "SKU-1001", options: sizeColor("S", "Černá") }), // the same combination again (a duplicate variant)
      row({ title: "Other", sku: "SKU-1001" }),
      row({ title: "Other 2", sku: "sku-1001" }),
    ];
    const skus = sanitizeDataset(raw, { uniqueSkus: true }).rows.map((entry) => entry.Variant_SKU.toLowerCase());
    expect(new Set(skus).size).toBe(skus.length);
  });

  it("rows without a SKU stay without one", () => {
    const { rows } = sanitizeDataset([row({ title: "A", sku: "" }), row({ title: "B", sku: "" })], { uniqueSkus: true });
    expect(rows.map((entry) => entry.Variant_SKU)).toEqual(["", ""]);
  });
});

describe("the warnings list", () => {
  it("lists at most the first 10 row numbers but always the full count", () => {
    const { report } = sanitizeDataset(Array.from({ length: 25 }, (_, i) => row({ title: `Item ${i}`, stock: "skladem" })));
    const warning = warningOf(report.warnings, "non_numeric_stock");
    expect(MAX_WARNING_ROWS).toBe(10);
    expect(warning?.count).toBe(25);
    expect(warning?.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(warning?.details).toHaveLength(10);
  });

  it("is empty for a clean file", () => {
    expect(sanitizeDataset([row({ title: "Mug", sku: "M-1", price: "9,50", stock: "4", barcode: "12345670", description: "Nice." })]).report.warnings).toEqual([]);
  });

  it("puts the problems that break an import before the notes about what was fixed", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", sku: "A", price: "9 Kč", stock: "x", options: sizeColor("S", "R") }),
      row({ title: "Tee", sku: "A", price: "9 Kč", stock: "x", options: sizeColor("S", "R") }),
    ]);
    expect(kindsOf(report.warnings)).toEqual(["duplicate_variant", "duplicate_sku_in_product", "sku_changed", "non_numeric_stock", "currency_symbol_in_price"]);
  });
});
