// test-data/supplier-A-comma-utf8.csv: a comma-separated UTF-8 wholesale export (Item Code, Product Name, Long Description,
// Wholesale Price (USD), RRP, Qty In Stock, Brand, Dept, Colour, Size, Image URL, UPC, Weight (kg)) with a TOTAL footer, four
// blank lines, three exact duplicate rows, prices like "TBC" and "POA", stock like "Out of stock" and ">100", S/Small and
// blk/Black, and ALL CAPS titles of mixed-case brands. Expected values were worked out from the CSV itself (see the comments).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { toShopifyCsv } from "../full-export/csv-writer";
import type { SanitizeWarning, WarningKind } from "../types/csv";
import { parseSupplierBytes } from "./csv-parser";
import { generateHandle, sanitizeDataset } from "./sanitizer";

const FILE = join(__dirname, "../../../test-data/supplier-A-comma-utf8.csv");
const parsed = parseSupplierBytes(readFileSync(FILE));

function clean(options = {}) {
  const result = sanitizeDataset(parsed.rows, options);
  const csv = Papa.parse<Record<string, string>>(toShopifyCsv(result.rows), { header: true, skipEmptyLines: true });
  return { ...result, headers: csv.meta.fields ?? [], records: csv.data };
}
const find = (warnings: SanitizeWarning[], kind: WarningKind) => warnings.find((entry) => entry.kind === kind);
// A product's variants: its rows with a SKU (the other rows only carry a further image).
const variantsOf = <T extends { Handle: string; Title: string; Variant_SKU: string }>(rows: T[], titlePart: string): T[] => {
  const handle = rows.find((entry) => entry.Title.includes(titlePart))?.Handle;
  return rows.filter((entry) => entry.Handle === handle && entry.Variant_SKU !== "");
};
// The output row of a source row, by its spreadsheet row number (the output has image-only rows, so the positions differ).
const outputOf = <T,>(result: { rowStarts: number[]; records: T[] }, fileRow: number): T => result.records[result.rowStarts[parsed.rows.findIndex((entry) => entry.sourceRow === fileRow)]];

describe("reading supplier-A-comma-utf8.csv", () => {
  it("is UTF-8, has every column recognised, and 127 rows (the four blank lines are not rows)", () => {
    expect(parsed.encoding.encoding).toBe("utf-8");
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(127);
    expect(parsed.rows[0]).toMatchObject({
      sku: "ELE-PW-20K",
      title: "PROGLOW™ 20000MAH USB-C POWER BANK ULTRA-FAST",
      cost: "$22.50",
      price: "50.0 USD",
      stock: " 20 ",
      vendor: "ProGlow™",
      category: " electronics ",
      barcode: "012345678905",
      weight: "0.5",
      weightUnit: "kg",
      sourceRow: 2,
      firstCell: "ELE-PW-20K",
    });
    expect(parsed.rows[0].options?.map((option) => [option.name, option.value])).toEqual([["Colour", "Black"], ["Size", "Standard"]]);
  });

  it("numbers the rows as the spreadsheet does (header = row 1): the TOTAL line is row 132, not the 128th record", () => {
    expect(parsed.rows.at(-1)).toMatchObject({ sku: "TOTAL", sourceRow: 132 });
    expect(parsed.rows[32].sourceRow).toBe(35); // after the blank line 34
  });
});

describe("1. footer and summary rows", () => {
  const { rows, report } = clean();

  it("drops the TOTAL line and says so, with its row", () => {
    expect(find(report.warnings, "summary_rows")).toMatchObject({ count: 1, rows: [132], details: ['"TOTAL"'] });
    expect(find(report.warnings, "summary_rows")?.message).toMatch(/^1 summary row removed/);
  });

  it("exports no product called total or Untitled Product", () => {
    const titles = rows.filter((entry) => entry.Title !== "").map((entry) => entry.Title);
    expect(titles.some((title) => /^total$|untitled/i.test(title))).toBe(false);
    expect(rows.some((entry) => /total/i.test(entry.Handle) || /untitled/i.test(entry.Title))).toBe(false);
    expect(rows.some((entry) => entry.Variant_SKU === "TOTAL")).toBe(false);
    expect(find(report.warnings, "untitled_row")).toBeUndefined();
  });
});

describe("5. grouping", () => {
  it("makes about 50 products, exactly 50: 12 in each of four departments, and the two that share SKU-COLLIDE-99", () => {
    const { report, rows } = clean();
    expect(report.productCount).toBe(50);
    expect(rows.filter((entry) => entry.Title !== "")).toHaveLength(50);
    expect(report.sourceRows).toBe(127);
    expect(report.rowsDropped).toBe(4); // TOTAL and three exact duplicates
  });

  it("two products that share a code but not a title stay two products (the second SKU is made unique)", () => {
    const { rows, report } = clean();
    const collide = rows.filter((entry) => entry.Variant_SKU.startsWith("SKU-COLLIDE-99"));
    expect(collide.map((entry) => entry.Variant_SKU)).toEqual(["SKU-COLLIDE-99", "SKU-COLLIDE-99-2"]);
    expect(new Set(collide.map((entry) => entry.Handle)).size).toBe(2);
    expect(collide.map((entry) => entry.Title)).toEqual(["Kitchenware Retro Mechanical Timer 60-Min", "Expedition Tactical Locking Carabiner 4-Pack"]);
    expect(find(report.warnings, "sku_copied")?.rows).toContain(130);
  });

  describe("5a. exact duplicates", () => {
    it("rows 22, 63 and 109 are removed, with what they repeat", () => {
      const { report } = clean();
      expect(find(report.warnings, "duplicate_row")).toMatchObject({ count: 3, rows: [22, 63, 109], details: ["same as row 17", "same as row 56", "same as row 101"] });
    });

    it("so no '-2' product comes from them: every handle is simply its title's", () => {
      const { rows } = clean();
      for (const product of rows.filter((entry) => entry.Title !== "")) expect(product.Handle, product.Title).toBe(generateHandle(product.Title));
      expect(new Set(rows.map((entry) => entry.Handle)).size).toBe(50);
    });

    it("with the toggle off they stay as variants of their products (still 50 products, no '-2'), and are reported as duplicate variants", () => {
      const { rows, report } = clean({ removeDuplicates: false });
      expect(report.productCount).toBe(50);
      expect(rows).toHaveLength(clean().rows.length + 3); // the three duplicates are variants again
      expect(new Set(rows.map((entry) => entry.Handle)).size).toBe(50);
      for (const product of rows.filter((entry) => entry.Title !== "")) expect(product.Handle, product.Title).toBe(generateHandle(product.Title));
      expect(find(report.warnings, "duplicate_row")).toBeUndefined();
      expect(find(report.warnings, "duplicate_variant")?.rows).toEqual([22, 49, 51, 63, 109]);
    });
  });

  describe("5b. variants that were not next to their product", () => {
    it("the keyboard's two variants are one product (rows 21 and 23, with a duplicate of another product between them)", () => {
      const keyboard = variantsOf(clean().rows, "Mechanical Gaming Keyboard");
      expect(keyboard).toHaveLength(2);
      expect(keyboard.map((entry) => [entry.Option1_Value, entry.Option2_Value])).toEqual([["Black", "Clicky Blue"], ["Black", "Linear Red"]]);
    });

    it("the jacket's six variants are one product (row 64 comes after a duplicate of a tee)", () => {
      const jacket = variantsOf(clean().rows, "All-Weather");
      expect(jacket).toHaveLength(6);
      expect(jacket.map((entry) => `${entry.Option1_Value}/${entry.Option2_Value}`)).toEqual(["Dark Olive/S", "Dark Olive/M", "Dark Olive/XL", "Royal Blue/S", "Royal Blue/M", "Royal Blue/XL"]);
    });

    it("both are reported as not next to their product, by their row numbers in the file", () => {
      const entry = find(clean().report.warnings, "variants_apart");
      expect(entry).toMatchObject({ title: "Variants were not next to their product", count: 2, rows: [23, 64] });
      expect(entry?.details?.[0]).toMatch(/^joins "AeroVent Mechanical Gaming Keyboard/);
    });

    it("with the duplicates kept, they still join their products (rows 22 and 63 sit between)", () => {
      const { rows, report } = clean({ removeDuplicates: false });
      expect(variantsOf(rows, "Mechanical Gaming Keyboard")).toHaveLength(2);
      expect(variantsOf(rows, "All-Weather")).toHaveLength(6);
      expect(find(report.warnings, "variants_apart")?.rows).toEqual([22, 23, 63, 64, 109]); // the three duplicates join their products too
    });
  });

  it("5c. the Verve tee has two pairs that become identical once their sizes and colours are tidied, and both are listed", () => {
    expect(find(clean().report.warnings, "duplicate_variant")).toMatchObject({ count: 2, rows: [49, 51], details: ["repeats row 48: Black / M", "repeats row 50: Black / XL"] });
  });
});

describe("2. the columns", () => {
  const result = clean();
  const { headers, records } = result;

  it("writes Type, Variant Inventory Qty and Tracker, Cost per item, Variant Barcode and Variant Grams", () => {
    for (const header of ["Vendor", "Type", "Variant Inventory Tracker", "Variant Inventory Qty", "Cost per item", "Variant Barcode", "Variant Grams", "Variant Price", "Status"]) expect(headers, header).toContain(header);
  });

  it.each([
    // spreadsheet row (the header is row 1), [type, qty, tracker, price, cost, grams]
    [2, ["Electronics", "20", "shopify", "50.00", "22.50", "500"]],
    [3, ["", "0", "shopify", "52.99", "24.00", "500"]],
    [4, ["", "", "", "55.00", "25.00", "1200"]],
    [5, ["Electronics", "0", "shopify", "", "4.20", "907"]],
    [6, ["Electronics", "100", "shopify", "", "11.00", ""]],
    [10, ["Electronics", "76", "shopify", "99.00", "", "285"]],
  ])("spreadsheet row %i", (row, [type, qty, tracker, price, cost, grams]) => {
    const record = outputOf(result, row);
    expect(record["Variant Inventory Qty"]).toBe(qty);
    expect(record["Variant Inventory Tracker"]).toBe(tracker);
    expect(record["Variant Price"]).toBe(price);
    expect(record["Cost per item"]).toBe(cost);
    expect(record["Variant Grams"]).toBe(grams);
    if (type !== "") expect(record.Type).toBe(type); // the type is on a product's first row only
  });

  it("a product's type is tidied: ' electronics ' and 'ELECTRONICS' are 'Electronics'", () => {
    expect(new Set(records.map((record) => record.Type).filter(Boolean))).toEqual(new Set(["Electronics", "Homeware", "Apparel", "Outdoor"]));
  });

  it("every variant with a numeric stock has the tracker on, and nothing else does", () => {
    const withQty = records.filter((record) => record["Variant Inventory Qty"] !== "");
    expect(withQty).toHaveLength(86); // 62 numbers, 12 'Out of stock', 12 '>100'
    expect(withQty.every((record) => record["Variant Inventory Tracker"] === "shopify")).toBe(true);
    expect(records.filter((record) => record["Variant Inventory Tracker"] !== "")).toHaveLength(86);
  });

  it("87 variants have a wholesale price and 87 a retail price (36 have neither TBC, POA nor blank in one of them)", () => {
    expect(records.filter((record) => record["Cost per item"] !== "")).toHaveLength(87);
    expect(records.filter((record) => record["Variant Price"] !== "")).toHaveLength(87);
  });
});

describe("3. stock", () => {
  it("'>100' is written as 100 and reported as approximate (12 rows); 'In stock', 'N/A' and blank are left empty and counted (37)", () => {
    const { report } = clean();
    expect(find(report.warnings, "approximate_stock")).toMatchObject({ count: 12, rows: [6, 16, 27, 38, 48, 58, 69, 80, 90, 100] });
    expect(find(report.warnings, "non_numeric_stock")).toMatchObject({ count: 37, rows: [4, 7, 8, 14, 17, 18, 25, 28, 29, 36] });
  });
});

describe("4. prices", () => {
  it("36 variants have no retail price (TBC, POA or blank), listed with their row numbers", () => {
    const entry = find(clean().report.warnings, "missing_price");
    expect(entry).toMatchObject({ severity: "warning", title: "Variants without a price", count: 36, rows: [5, 6, 7, 15, 16, 17, 26, 27, 28, 37] });
    expect(entry?.details?.slice(0, 3)).toEqual(['"TBC", wholesale 4.20', '"POA", wholesale 11.00', "(blank), wholesale 12.00"]);
  });

  it("38 with the exact duplicates kept: the two duplicates that also have no retail price count as variants then", () => {
    expect(find(clean({ removeDuplicates: false }).report.warnings, "missing_price")?.count).toBe(38);
  });

  it("wholesale x markup fills them in: 100% doubles, and nothing is left to report", () => {
    const result = clean({ noRetailPrice: "markup" });
    expect(outputOf(result, 5)["Variant Price"]).toBe("8.40"); // row 5: TBC, wholesale 4.20
    expect(outputOf(result, 5)["Cost per item"]).toBe("4.20");
    expect(outputOf(result, 6)["Variant Price"]).toBe("22.00"); // row 6: POA, wholesale 11.00
    expect(outputOf(result, 2)["Variant Price"]).toBe("50.00"); // a retail price is never touched
    expect(find(result.report.warnings, "missing_price")).toBeUndefined();
    expect(find(result.report.warnings, "price_from_cost")).toMatchObject({ count: 36, severity: "info" });
  });

  it("every price is in one currency (USD, written four ways), which is noted but is no mix", () => {
    const { report } = clean();
    expect(find(report.warnings, "mixed_currencies")).toBeUndefined();
    expect(find(report.warnings, "currency_symbol_in_price")).toMatchObject({ severity: "info" });
  });
});

describe("6. option values", () => {
  const { records, report } = clean();
  const values = [...records.map((record) => record["Option2 Value"]), ...records.map((record) => record["Option1 Value"])];

  it("never output 'Os'", () => {
    expect(values).not.toContain("Os");
  });

  it("one size has ONE spelling in the whole file: 'One Size', which the file uses 5 times against 4 for OS (once the duplicate is gone)", () => {
    expect(values).toContain("One Size");
    expect(values).not.toContain("OS");
    expect(values).not.toContain("ONE SIZE");
  });

  it("and with the duplicate row kept it is 5 against 5, a tie, which goes to the short form: OS", () => {
    const kept = clean({ removeDuplicates: false }).records;
    const keptValues = [...kept.map((record) => record["Option2 Value"]), ...kept.map((record) => record["Option1 Value"])];
    expect(keptValues).toContain("OS");
    expect(keptValues).not.toContain("One Size");
  });

  it("every size is spelled one way in the whole file, not one way per product", () => {
    const sizes = new Set(values);
    for (const [short, long] of [["S", "Small"], ["M", "Medium"], ["L", "Large"], ["XL", "X-Large"]]) expect(sizes.has(short) && sizes.has(long), `${short} and ${long}`).toBe(false);
  });

  it("the Verve tee has no S/Small, M/Medium or XL/X-Large pair: one spelling of each", () => {
    const tee = variantsOf(clean().rows, "Organic Cotton Crew Tee");
    expect(tee).toHaveLength(12);
    const sizes = new Set(tee.map((entry) => entry.Option2_Value));
    expect(sizes).toEqual(new Set(["S", "M", "XL"]));
    expect(sizes.has("Small") || sizes.has("Medium") || sizes.has("X-Large")).toBe(false);
  });

  it("its colours are one case each: Black, Navy, Heather Grey (and Blk and Nv, left alone)", () => {
    const tee = variantsOf(clean().rows, "Organic Cotton Crew Tee");
    expect(new Set(tee.map((entry) => entry.Option1_Value))).toEqual(new Set(["Black", "Blk", "Navy", "Nv", "Heather Grey"]));
  });

  it("the merges are listed with the rows that changed", () => {
    const entry = find(report.warnings, "option_values_merged");
    // the whole file's spelling, so more rows than a product at a time would change (M 13 against Medium 9, S 10 against Small 2 ...)
    expect(entry).toMatchObject({ severity: "info", count: 16, rows: [6, 7, 8, 15, 16, 17, 47, 49, 51, 56] });
    expect(entry?.details).toEqual(["Medium -> M", "Medium -> M", "Medium -> M", "OS -> One Size", "OS -> One Size", "OS -> One Size", "Small -> S", "Medium -> M", "X-Large -> XL", "Medium -> M"]);
    expect(entry?.message).toMatch(/spelling the whole file uses most/);
  });

  it("blk and nv are only suggestions: listed as possible duplicates, not changed", () => {
    const entry = find(report.warnings, "possible_duplicate_values");
    expect(entry).toMatchObject({ title: "Possible duplicates", count: 3, rows: [4, 47, 54] });
    expect(entry?.details).toEqual(['"Blk" may be "Black" (same product)', '"Blk" may be "Black" (same product)', '"Nv" may be "Navy" (same product)']);
  });
});

describe("7. brand casing and technical terms", () => {
  const { rows } = clean();
  const title = (part: string) => rows.find((entry) => entry.Title.toLowerCase().includes(part.toLowerCase()))?.Title ?? "";

  it("ProGlow™, AeroVent and VoltCharge keep the vendor's spelling although their titles are ALL CAPS", () => {
    expect(title("20000mAh USB-C")).toBe("ProGlow™ 20000mAh USB-C Power Bank Ultra-Fast");
    expect(title("2.4GHz Wireless")).toMatch(/^AeroVent 2\.4GHz Wireless Ergonomic Mouse/);
    expect(title("65W")).toMatch(/^VoltCharge 65W GaN /);
    expect(rows.filter((entry) => /^(Proglow|Aerovent|Voltcharge)/.test(entry.Title))).toEqual([]);
  });

  it("GaN survives, and so do the other terms of the file", () => {
    expect(title("65W")).toContain("GaN");
    expect(title("SoundWave")).toMatch(/^SoundWave ANC Bluetooth /);
    expect(title("PulseBeat")).toMatch(/IPX7/);
    expect(title("Apex")).toMatch(/4K HDMI 2\.1 Ultra HD/);
    expect(title("Gaming Keyboard")).toMatch(/RGB/);
    expect(title("UrbanDrift")).not.toMatch(/ upf /i);
    expect(title("SunDefend")).toMatch(/UPF 50\+/);
  });

  it("the brands stay right in sentence case too, and GaN survives", () => {
    const sentence = clean({ casing: "sentence" }).rows;
    const first = (part: string) => sentence.find((entry) => entry.Title.toLowerCase().includes(part.toLowerCase()))?.Title ?? "";
    expect(first("20000mAh")).toMatch(/^ProGlow™ 20000mAh USB-C power bank/);
    expect(first("2.4GHz")).toMatch(/^AeroVent 2\.4GHz wireless/);
    expect(first("65W")).toMatch(/^VoltCharge 65W GaN dual/);
    expect(first("SoundWave")).toMatch(/ANC/);
    expect(first("SunDefend")).toMatch(/UPF 50\+/);
  });

  it("and the handles are the same in every casing", () => {
    const handles = (casing: "title" | "sentence" | "keep") => clean({ casing }).rows.map((entry) => entry.Handle);
    expect(handles("sentence")).toEqual(handles("title"));
    expect(handles("keep")).toEqual(handles("title"));
  });
});

describe("row numbers are the spreadsheet's: the header is row 1, blank lines count, a record with line breaks is one row", () => {
  // The file read by Papa alone, no code of ours: spreadsheet row r is records[r - 1].
  const records = Papa.parse<string[]>(readFileSync(FILE, "utf8").replace(/^\uFEFF/, ""), { header: false, skipEmptyLines: false }).data;
  const { report } = clean();
  const cell = (row: number, column: number) => records[row - 1][column];

  it("the header is row 1 and the first product is row 2", () => {
    expect(cell(1, 0)).toBe("Item Code");
    expect(cell(2, 0)).toBe("ELE-PW-20K");
    expect(parsed.rows[0].sourceRow).toBe(2);
  });

  it("the TOTAL line is row 132", () => {
    expect(cell(132, 0)).toBe("TOTAL");
    expect(find(report.warnings, "summary_rows")?.rows).toEqual([132]);
  });

  it("the exact duplicates are rows 22, 63 and 109, each the same cell for cell as the row it repeats (17, 56, 101)", () => {
    expect(find(report.warnings, "duplicate_row")?.rows).toEqual([22, 63, 109]);
    for (const [duplicate, original] of [[22, 17], [63, 56], [109, 101]]) expect(records[duplicate - 1], `row ${duplicate}`).toEqual(records[original - 1]);
  });

  it("the keyboard variant that was not next to its product is row 23 and the jacket variant row 64", () => {
    expect(find(report.warnings, "variants_apart")?.rows).toEqual([23, 64]);
    expect(cell(23, 0)).toBe("ELE-KBD-TKL");
    expect(cell(23, 9)).toBe("Linear Red");
    expect(cell(64, 0)).toBe("APP-JCK-TRL");
    expect(cell(64, 9)).toBe("XL");
  });

  it("the second row with SKU-COLLIDE-99 is row 130", () => {
    expect(cell(129, 0)).toBe("SKU-COLLIDE-99");
    expect(cell(130, 0)).toBe("SKU-COLLIDE-99");
    expect(find(report.warnings, "sku_copied")).toMatchObject({ rows: [130] });
    expect(find(report.warnings, "duplicate_sku_across_products")).toMatchObject({ rows: [130], details: ["SKU-COLLIDE-99 (first used in row 129)"] });
  });

  it("the row numbers inside the messages are the same kind of number", () => {
    expect(find(report.warnings, "duplicate_row")?.details).toEqual(["same as row 17", "same as row 56", "same as row 101"]);
    expect(find(report.warnings, "variants_apart")?.details?.[0]).toMatch(/\(row 21\)/);
    expect(find(report.warnings, "sku_copied")?.details?.[0]).toMatch(/\(row 129\)/);
  });

  it("every row a warning lists exists in the file, and none is the header", () => {
    for (const entry of report.warnings) for (const row of entry.rows) expect(row, entry.kind).toBeGreaterThanOrEqual(2);
    for (const entry of report.warnings) for (const row of entry.rows) expect(row, entry.kind).toBeLessThanOrEqual(records.length);
  });
});

describe("the rest of the file", () => {
  const { report, records } = clean();

  it("a barcode in scientific notation is invalid, one with spaces is read", () => {
    expect(find(report.warnings, "invalid_ean")).toMatchObject({ count: 1, rows: [13], details: ['"7.89123E+11"'] });
    expect(records.find((record) => record["Variant Barcode"] === "019283746505")).toBeDefined();
  });

  it("weights in kg, g, lb and oz become grams", () => {
    const grams = new Set(records.map((record) => record["Variant Grams"]).filter(Boolean));
    for (const expected of ["500", "1200", "907", "850", "397", "1500", "285"]) expect(grams.has(expected), expected).toBe(true);
    expect(find(report.warnings, "weight_unit_assumed")).toBeUndefined();
  });

  it("relative image paths are reported, not exported", () => {
    expect(find(report.warnings, "invalid_image_url")).toMatchObject({ count: 20, rows: [5, 11, 17, 24, 30, 37, 43, 49, 55, 61] });
    expect(records.every((record) => record["Image Src"] === "" || /^https?:\/\//.test(record["Image Src"]))).toBe(true);
  });

  it("all of it is stable: the same file twice gives the same output", () => {
    expect(toShopifyCsv(sanitizeDataset(parsed.rows).rows)).toBe(toShopifyCsv(sanitizeDataset(parsed.rows).rows));
  });
});
