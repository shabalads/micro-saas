import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { toShopifyCsv } from "../full-export/csv-writer";
import type { RawOption, RawSupplierRow, SanitizeWarning, WarningKind } from "../types/csv";
import { parseSupplierText } from "./csv-parser";
import { brandSpelling, normalizeTitle, sanitizeDataset, shopifyColumnsFor } from "./sanitizer";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });
const opt = (name: string, value: string): RawOption => ({ name, value, derived: false });
const colourSize = (colour: string, size: string): RawOption[] => [opt("Colour", colour), opt("Size", size)];
const warning = (warnings: SanitizeWarning[], kind: WarningKind) => warnings.find((entry) => entry.kind === kind);
const kinds = (warnings: SanitizeWarning[]) => warnings.map((entry) => entry.kind);

describe("1. footer and summary rows", () => {
  const products = [row({ title: "Mug", sku: "M-1", price: "9", stock: "3" }), row({ title: "Cup", sku: "C-1", price: "7", stock: "2" })];

  it("a TOTAL line is not exported as a product, and is reported with its row number", () => {
    const { rows, report } = sanitizeDataset([...products, row({ firstCell: "TOTAL", sku: "TOTAL", price: "12345.67", cost: "28950.00", stock: "1420", sourceRow: 131 })]);
    expect(rows.map((entry) => entry.Title)).toEqual(["Mug", "Cup"]);
    expect(rows.some((entry) => /total/i.test(entry.Title + entry.Handle + entry.Variant_SKU))).toBe(false);
    expect(warning(report.warnings, "summary_rows")).toMatchObject({ count: 1, rows: [131], details: ['"TOTAL"'], title: "Summary rows removed" });
    expect(warning(report.warnings, "summary_rows")?.message).toMatch(/^1 summary row removed/);
    expect(report).toMatchObject({ sourceRows: 3, productCount: 2, rowsDropped: 1 });
  });

  it("says how many when there are several ('N summary rows removed')", () => {
    const { report } = sanitizeDataset([
      row({ title: "Mug", sku: "M-1", price: "9" }),
      row({ sku: "SUBTOTAL", price: "9" }),
      row({ firstCell: "Grand total", title: "Grand total", price: "9" }),
      row({ sku: "", cost: "12.50" }),
    ]);
    const entry = warning(report.warnings, "summary_rows");
    expect(entry).toMatchObject({ count: 3, rows: [3, 4, 5] });
    expect(entry?.message).toMatch(/^3 summary rows removed/);
  });

  it("a line of only numbers goes too, label or no label", () => {
    const { rows, report } = sanitizeDataset([...products, row({ price: "540.00", stock: "5" })]);
    expect(rows).toHaveLength(2);
    expect(warning(report.warnings, "summary_rows")).toMatchObject({ rows: [4], details: ["only numbers, no product"] });
  });

  it("a product whose name merely starts with Total, Sum or Count stays", () => {
    const { rows } = sanitizeDataset([
      row({ firstCell: "Total Recall T-Shirt", title: "Total Recall T-Shirt", price: "20", description: "Soft." }),
      row({ firstCell: "SUM-100", sku: "SUM-100", title: "Sum Wetsuit", price: "99" }),
    ]);
    expect(rows.map((entry) => entry.Title)).toEqual(["Total Recall T-Shirt", "Sum Wetsuit"]);
  });

  it("works from the CSV text: the footer of a spreadsheet export", () => {
    const { rows } = parseSupplierText("Item Code,Product Name,Wholesale Price,RRP,Qty\nM-1,Mug,4,9,3\nC-1,Cup,3,7,2\nTOTAL,,7,16,5\n");
    const result = sanitizeDataset(rows);
    expect(result.rows.map((entry) => entry.Title)).toEqual(["Mug", "Cup"]);
    expect(warning(result.report.warnings, "summary_rows")).toMatchObject({ rows: [4] }); // header = row 1, Mug 2, Cup 3, TOTAL 4
  });
});

describe("1. never a product called 'Untitled Product'", () => {
  it("a row with no title that belongs to nothing is left out, with a warning, and no title is invented", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Mug", sku: "M-1", price: "5" }),
      row({ sku: "ZX-9", price: "4" }),
      row({ id: "77", price: "4" }),
      row({ description: "Orphan description", price: "4" }),
    ]);
    expect(rows.map((entry) => entry.Title)).toEqual(["Mug"]);
    expect(JSON.stringify(rows)).not.toMatch(/untitled/i);
    expect(warning(report.warnings, "untitled_row")).toMatchObject({ count: 3, rows: [3, 4, 5], details: ["SKU ZX-9", "no title and no code", "no title and no code"] });
  });

  it("but a blank-title variant row that has a title above it in its product is still its variant", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S")] }),
      row({ handle: "tee", options: [opt("Size", "M")] }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["tee", "Tee"], ["tee", ""]]);
  });
});

describe("5a. exact duplicate rows", () => {
  const base = row({ title: "Tee", sku: "T-1", price: "9", options: colourSize("Red", "S") });
  const raw = [
    base,
    row({ title: "Tee", sku: "T-1", price: "9", options: colourSize("Red", "M") }),
    row({ title: "Cap", sku: "C-1", price: "5" }),
    { ...base, sourceRow: 5 }, // the first row again, not next to it (the 4th product row: row 5)
    row({ title: " Tee ", sku: " T-1", price: "9 ", options: colourSize(" Red", "M ") }), // the second row again, with stray spaces
  ];

  it("are removed by default, the first one stays, and the rows are listed with what they repeat", () => {
    const { rows, report } = sanitizeDataset(raw);
    expect(rows.map((entry) => [entry.Handle, entry.Option2_Value])).toEqual([["tee", "S"], ["tee", "M"], ["cap", ""]]);
    expect(warning(report.warnings, "duplicate_row")).toMatchObject({ severity: "warning", count: 2, rows: [5, 6], details: ["same as row 2", "same as row 3"] });
    expect(warning(report.warnings, "duplicate_row")?.message).toMatch(/^2 exact duplicate rows removed/);
    expect(report.options.removeDuplicates).toBe(true);
    expect(report.rowsDropped).toBe(2);
  });

  it("make no '-2' product and no duplicate variant", () => {
    const { rows, report } = sanitizeDataset(raw);
    expect(rows.every((entry) => !/-2$/.test(entry.Handle))).toBe(true);
    expect(kinds(report.warnings)).not.toContain("duplicate_variant");
    expect(kinds(report.warnings)).not.toContain("split_product");
  });

  it("stay when the toggle is off, and then show up as duplicate variants of their product (still no '-2' product)", () => {
    const { rows, report } = sanitizeDataset(raw, { removeDuplicates: false });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((entry) => entry.Handle))).toEqual(new Set(["tee", "cap"]));
    expect(kinds(report.warnings)).not.toContain("duplicate_row");
    expect(warning(report.warnings, "duplicate_variant")).toMatchObject({ count: 2, rows: [5, 6] });
    expect(warning(report.warnings, "variants_apart")).toMatchObject({ count: 2, rows: [5, 6] });
  });

  it("only a row that is the same in EVERY cell: a different price makes it another row", () => {
    const { rows } = sanitizeDataset([base, { ...base, price: "10" }]);
    expect(rows).toHaveLength(2);
  });

  it("the case of a cell counts: 'Red' and 'RED' are not the same cell", () => {
    expect(sanitizeDataset([base, row({ ...base, options: colourSize("RED", "S") })]).rows).toHaveLength(2);
  });
});

describe("5b. variants that were not next to their product", () => {
  const tee = (colour: string, size: string, code = "TEE-1") => row({ title: "Verve Tee", productCode: code, sku: `${code}-${colour}-${size}`, options: colourSize(colour, size) });

  it("same product code and title, another combination: grouped with the product, which keeps its first position", () => {
    const { rows, report } = sanitizeDataset([tee("Black", "S"), tee("Black", "M"), row({ title: "Mug", productCode: "MUG-1", sku: "MUG-1" }), tee("Navy", "S")]);
    expect(rows.map((entry) => [entry.Handle, entry.Title, entry.Option1_Value, entry.Option2_Value])).toEqual([
      ["verve-tee", "Verve Tee", "Black", "S"],
      ["verve-tee", "", "Black", "M"],
      ["verve-tee", "", "Navy", "S"],
      ["mug", "Mug", "", ""],
    ]);
    expect(warning(report.warnings, "variants_apart")).toMatchObject({
      severity: "warning",
      title: "Variants were not next to their product",
      count: 1,
      rows: [5],
      details: ['joins "Verve Tee" (row 2), which keeps its first position'],
    });
    expect(report.productCount).toBe(2);
  });

  it("the title is compared without regard to case: the first row's wins", () => {
    const { rows } = sanitizeDataset([tee("Black", "S"), row({ title: "Mug", productCode: "MUG-1" }), row({ ...tee("Navy", "S"), title: "VERVE TEE" })]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["verve-tee", "Verve Tee"], ["verve-tee", ""], ["mug", "Mug"]]);
  });

  it("same code but a DIFFERENT title is another product, wherever it sits", () => {
    const { rows } = sanitizeDataset([tee("Black", "S"), row({ title: "Verve Hoodie", productCode: "TEE-1", options: colourSize("Black", "S") }), tee("Navy", "S")]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["verve-tee", "Verve Tee"], ["verve-tee", ""], ["verve-hoodie", "Verve Hoodie"]]);
  });

  it("a different code with the same title is another product, wherever it sits", () => {
    const { rows } = sanitizeDataset([tee("Black", "S"), row({ title: "Mug", productCode: "MUG-1" }), tee("Navy", "S", "TEE-2")]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["verve-tee", "mug", "verve-tee-2"]);
  });

  it("nothing is said when the rows were together all along", () => {
    expect(kinds(sanitizeDataset([tee("Black", "S"), tee("Black", "M")]).report.warnings)).not.toContain("variants_apart");
  });

  it("a row between them that is then removed as a duplicate still counts: in the file they were not together", () => {
    const filler = row({ title: "Mug", productCode: "MUG-1", sku: "MUG-1", price: "5" });
    const { report } = sanitizeDataset([tee("Black", "S"), filler, { ...filler, sourceRow: 4 }, tee("Black", "M")]);
    expect(warning(report.warnings, "duplicate_row")).toMatchObject({ rows: [4] });
    expect(warning(report.warnings, "variants_apart")).toMatchObject({ rows: [5] });
  });
});

describe("5c. identical option combinations in one product", () => {
  it("are warned about with the rows (never exported silently)", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", productCode: "T", sku: "a", options: colourSize("Red", "M") }),
      row({ title: "Tee", productCode: "T", sku: "b", options: colourSize("Blue", "M") }),
      row({ title: "Tee", productCode: "T", sku: "c", options: colourSize("red", "m") }),
    ]);
    expect(warning(report.warnings, "duplicate_variant")).toMatchObject({ count: 1, rows: [4], details: ["repeats row 2: Red / M"] });
  });

  it("including the pair that only becomes identical once 'Medium' and 'M' are one size", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", productCode: "T", sku: "a", options: colourSize("Black", "M") }),
      row({ title: "Tee", productCode: "T", sku: "b", options: colourSize("BLACK", "Medium") }),
    ]);
    expect(warning(report.warnings, "duplicate_variant")).toMatchObject({ rows: [3], details: ["repeats row 2: Black / M"] });
  });
});

describe("6. option values", () => {
  const tee = (colour: string, size: string, n: number) => row({ title: "Tee", productCode: "T", sku: `t${n}`, options: colourSize(colour, size) });

  it("are trimmed and have their spaces collapsed", () => {
    const { rows } = sanitizeDataset([tee("  Heather   Grey ", " S ", 1), tee("Navy", "M", 2)]);
    expect(rows.map((entry) => [entry.Option1_Value, entry.Option2_Value])).toEqual([["Heather Grey", "S"], ["Navy", "M"]]);
  });

  it("have one case per value in a column: 'BLACK', 'black' and 'Black' are 'Black'", () => {
    const { rows } = sanitizeDataset([tee("Black", "S", 1), tee("BLACK", "M", 2), tee("black", "L", 3), tee("Heather grey", "S", 4), tee("Heather Grey", "M", 5), tee("Heather Grey", "L", 6)]);
    expect(rows.map((entry) => entry.Option1_Value)).toEqual(["Black", "Black", "Black", "Heather Grey", "Heather Grey", "Heather Grey"]);
  });

  it("never turn a size code into 'Os': OS, XS, XL, XXL, S/M and L/XL stay as written, whatever their case", () => {
    const sizes = ["OS", "os", "XS", "xs", "XL", "xl", "XXL", "xxl", "2XL", "S/M", "s/m", "L/XL"];
    const { rows } = sanitizeDataset(sizes.map((size, index) => row({ title: `Item ${index}`, options: colourSize("Black", size) })));
    // "2XL" is XXL written another way, and XXL is what the file mostly says (2 against 1), so it becomes XXL
    expect(rows.map((entry) => entry.Option2_Value)).toEqual(["OS", "OS", "XS", "XS", "XL", "XL", "XXL", "XXL", "XXL", "S/M", "S/M", "L/XL"]);
    expect(rows.some((entry) => entry.Option2_Value === "Os")).toBe(false);
  });

  it("ordinary words in capitals are still fixed ('NAVY', 'ONE SIZE', 'MATTE BLACK')", () => {
    const { rows } = sanitizeDataset([tee("NAVY", "ONE SIZE", 1), tee("MATTE BLACK", "ONE SIZE", 2)]);
    expect(rows.map((entry) => [entry.Option1_Value, entry.Option2_Value])).toEqual([["Navy", "One Size"], ["Matte Black", "One Size"]]);
  });

  it("S/Small, M/Medium, L/Large, XL/X-Large, XXL/2XL and OS/One Size are merged, to the spelling the file uses most", () => {
    const { rows, report } = sanitizeDataset([
      tee("Black", "S", 1), tee("Navy", "Small", 2), tee("Grey", "S", 3),
      tee("Black", "M", 4), tee("Navy", "Medium", 5), tee("Grey", "Medium", 6),
      tee("Black", "XL", 7), tee("Navy", "X-Large", 8),
      tee("Black", "XXL", 9), tee("Navy", "2XL", 10), tee("Grey", "2XL", 11),
    ]);
    // S x2 / Small x1 -> S;  M x1 / Medium x2 -> Medium;  XL x1 / X-Large x1 (a tie) -> XL, the short form;  XXL x1 / 2XL x2 -> 2XL
    expect(rows.map((entry) => entry.Option2_Value)).toEqual(["S", "S", "S", "Medium", "Medium", "Medium", "XL", "XL", "2XL", "2XL", "2XL"]);
    expect(warning(report.warnings, "option_values_merged")).toMatchObject({
      severity: "info",
      count: 4,
      rows: [3, 5, 9, 10],
      details: ["Small -> S", "M -> Medium", "X-Large -> XL", "XXL -> 2XL"], // the second, fourth, eighth and ninth product rows
    });
  });

  it("OS and One Size are one size too", () => {
    const { rows } = sanitizeDataset([tee("Black", "One Size", 1), tee("Navy", "OS", 2), tee("Grey", "One Size", 3)]);
    expect(rows.map((entry) => entry.Option2_Value)).toEqual(["One Size", "One Size", "One Size"]);
  });

  it("colour abbreviations are only suggested: 'Blk' and 'Nv' stay as they are, and are listed as possible duplicates", () => {
    const { rows, report } = sanitizeDataset([
      tee("Black", "S", 1), tee("blk", "M", 2), tee("Navy", "S", 3), tee("nv", "M", 4), tee("Heather Grey", "S", 5),
    ]);
    expect(rows.map((entry) => entry.Option1_Value)).toEqual(["Black", "Blk", "Navy", "Nv", "Heather Grey"]);
    const entry = warning(report.warnings, "possible_duplicate_values");
    expect(entry).toMatchObject({ title: "Possible duplicates", severity: "info", count: 2, rows: [3, 5] });
    expect(entry?.details).toEqual(['"Blk" may be "Black" (same product)', '"Nv" may be "Navy" (same product)']);
  });

  it("an abbreviation of a value in ANOTHER product is not a suggestion", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", productCode: "T", sku: "1", options: colourSize("Black", "S") }),
      row({ title: "Tee", productCode: "T", sku: "2", options: colourSize("Navy", "M") }),
      row({ title: "Hat", productCode: "H", sku: "3", options: colourSize("Blk", "S") }),
      row({ title: "Hat", productCode: "H", sku: "4", options: colourSize("Navy", "M") }),
    ]);
    expect(kinds(report.warnings)).not.toContain("possible_duplicate_values");
  });
});

describe("6. a size has ONE spelling in the whole file, not one per product", () => {
  /** One product whose only option is `optionName`, one variant per value. */
  const product = (title: string, code: string, values: string[], optionName = "Size") =>
    values.map((value, n) => row({ title, productCode: code, sku: `${code}${n}`, options: [opt(optionName, value)] }));
  const sizes = (rows: Array<{ Option1_Value: string }>) => rows.map((entry) => entry.Option1_Value);

  it("a product with S/M and another with Small/Medium end up the same: a tie goes to the short form", () => {
    const { rows, report } = sanitizeDataset([...product("Tee", "T", ["S", "M"]), ...product("Hat", "H", ["Small", "Medium"])]);
    expect(rows.map((entry) => [entry.Handle, entry.Option1_Value])).toEqual([["tee", "S"], ["tee", "M"], ["hat", "S"], ["hat", "M"]]);
    expect(warning(report.warnings, "option_values_merged")).toMatchObject({ severity: "info", count: 2, rows: [4, 5], details: ["Small -> S", "Medium -> M"] });
  });

  it("whichever product comes first in the file", () => {
    const { rows } = sanitizeDataset([...product("Hat", "H", ["Small", "Medium"]), ...product("Tee", "T", ["S", "M"])]);
    expect(sizes(rows)).toEqual(["S", "M", "S", "M"]);
  });

  it("the spelling most used in the WHOLE file wins, even against the short form", () => {
    const { rows, report } = sanitizeDataset([
      ...product("Tee", "T", ["S", "M"]),
      ...product("Hat", "H", ["Small", "Medium"]),
      ...product("Cap", "C", ["Small", "Medium"]),
      ...product("Bag", "B", ["Small", "Medium"]),
    ]);
    expect(sizes(rows)).toEqual(["Small", "Medium", "Small", "Medium", "Small", "Medium", "Small", "Medium"]);
    expect(warning(report.warnings, "option_values_merged")).toMatchObject({ count: 2, rows: [2, 3], details: ["S -> Small", "M -> Medium"] });
    expect(warning(report.warnings, "option_values_merged")?.message).toMatch(/spelling the whole file uses most/);
  });

  it("each size is decided on its own: S can go one way and XL the other", () => {
    const { rows } = sanitizeDataset([...product("Tee", "T", ["S", "XL"]), ...product("Hat", "H", ["S", "X-Large"]), ...product("Cap", "C", ["Small", "X-Large"])]);
    expect(sizes(rows)).toEqual(["S", "X-Large", "S", "X-Large", "S", "X-Large"]);
  });

  it("a size written one way in the whole file is never touched", () => {
    const { rows, report } = sanitizeDataset([...product("Tee", "T", ["Medium", "Large"]), ...product("Hat", "H", ["Medium", "Large"])]);
    expect(sizes(rows)).toEqual(["Medium", "Large", "Medium", "Large"]);
    expect(kinds(report.warnings)).not.toContain("option_values_merged");
  });

  it("only options with the same NAME are compared: the 'Medium' of a Roast option is not a size", () => {
    const { rows } = sanitizeDataset([...product("Tee", "T", ["M", "L"]), ...product("Coffee", "C", ["Medium", "Dark"], "Roast")]);
    expect(rows.map((entry) => [entry.Handle, entry.Option1_Value])).toEqual([["tee", "M"], ["tee", "L"], ["coffee", "Medium"], ["coffee", "Dark"]]);
  });

  it("the same option name counts wherever it sits in a product, and whatever its case", () => {
    const tee = ["S", "M"].map((size, n) => row({ title: "Tee", productCode: "T", sku: `T${n}`, options: colourSize("Black", size) })); // Size is the 2nd option
    const hat = product("Hat", "H", ["Small", "Medium"], "size"); // and the 1st here
    const { rows } = sanitizeDataset([...tee, ...hat]);
    expect(rows.map((entry) => entry.Option2_Value || entry.Option1_Value)).toEqual(["S", "M", "S", "M"]);
  });
});

describe("7. brand casing and technical terms", () => {
  it("an ALL CAPS title that starts with the brand uses the vendor's spelling for it", () => {
    expect(normalizeTitle("PROGLOW™ 20000MAH USB-C POWER BANK", "title", "ProGlow™")).toBe("ProGlow™ 20000mAh USB-C Power Bank");
    expect(normalizeTitle("AEROVENT 2.4GHZ WIRELESS MOUSE", "title", "AeroVent")).toBe("AeroVent 2.4GHz Wireless Mouse");
    expect(normalizeTitle("VOLTCHARGE 65W GAN DUAL USB-C CHARGER", "title", "VoltCharge")).toBe("VoltCharge 65W GaN Dual USB-C Charger");
    expect(normalizeTitle("NORDICKUP® 750ML DOUBLE-WALL", "title", "NordicKup®")).toBe("NordicKup® 750ml Double-Wall");
    expect(normalizeTitle("ELEMENT SHIELD PACKABLE RAIN JACKET", "title", "Element")).toBe("Element Shield Packable Rain Jacket");
  });

  it("a brand of several words and in sentence case", () => {
    expect(normalizeTitle("ALPINE BIVY RIPSTOP NYLON TENT", "title", "Alpine Bivy")).toBe("Alpine Bivy Ripstop Nylon Tent");
    expect(normalizeTitle("PROGLOW™ 20000MAH USB-C POWER BANK", "sentence", "ProGlow™")).toBe("ProGlow™ 20000mAh USB-C power bank");
    expect(normalizeTitle("VOLTCHARGE 65W GAN DUAL CHARGER", "sentence", "VoltCharge")).toBe("VoltCharge 65W GaN dual charger");
  });

  it("only when the title STARTS with the brand and is ALL CAPS", () => {
    expect(normalizeTitle("THE PROGLOW™ POWER BANK", "title", "ProGlow™")).toBe("The Proglow™ Power Bank");
    expect(normalizeTitle("ProGlow™ Power Bank", "title", "ProGlow™")).toBe("ProGlow™ Power Bank");
    expect(normalizeTitle("proglow power bank", "title", "ProGlow™")).toBe("Proglow Power Bank"); // not shouting: nothing to take the spelling for
    expect(normalizeTitle("PROGLOWX POWER BANK", "title", "ProGlow")).toBe("Proglowx Power Bank");
  });

  it("only a vendor with its own capitals has a spelling to give: 'TECH-IMPORT' tells nothing", () => {
    expect(brandSpelling("ProGlow™")).toBe("ProGlow™");
    expect(brandSpelling("  AeroVent ")).toBe("AeroVent");
    expect(brandSpelling("TECH-IMPORT")).toBe("");
    expect(brandSpelling(undefined)).toBe("");
    expect(normalizeTitle("TECH-IMPORT MOUSE", "title", brandSpelling("TECH-IMPORT"))).toBe("Tech-Import Mouse");
  });

  it("is applied through the whole pipeline, from the vendor column, in all casings (and not in 'keep')", () => {
    const raw = [row({ title: "PROGLOW™ 20000MAH USB-C POWER BANK", vendor: "ProGlow™", sku: "P" })];
    expect(sanitizeDataset(raw).rows[0].Title).toBe("ProGlow™ 20000mAh USB-C Power Bank");
    expect(sanitizeDataset(raw, { casing: "sentence" }).rows[0].Title).toBe("ProGlow™ 20000mAh USB-C power bank");
    expect(sanitizeDataset(raw, { casing: "keep" }).rows[0].Title).toBe("PROGLOW™ 20000MAH USB-C POWER BANK");
    expect(sanitizeDataset(raw)).toBeDefined();
  });

  it("and never changes the handle", () => {
    const raw = [row({ title: "PROGLOW™ 20000MAH USB-C POWER BANK", vendor: "ProGlow™", sku: "P" })];
    const handles = (["title", "sentence", "keep"] as const).map((casing) => sanitizeDataset(raw, { casing }).rows[0].Handle);
    expect(new Set(handles).size).toBe(1);
  });

  describe("technical terms keep their capitals in Title Case and in sentence case", () => {
    it.each([
      ["VOLTCHARGE 65W GAN CHARGER", "VOLTCHARGE 65W GaN CHARGER".replace("VOLTCHARGE", "Voltcharge").replace("CHARGER", "Charger"), "Voltcharge 65W GaN charger"],
      ["NOISE CANCELLING ANC HEADPHONES", "Noise Cancelling ANC Headphones", "Noise cancelling ANC headphones"],
      ["CONTACTLESS NFC READER", "Contactless NFC Reader", "Contactless NFC reader"],
      ["55 INCH OLED SMART TV", "55 Inch OLED Smart TV", "55 inch OLED smart TV"],
      ["POE SWITCH 8 PORT", "PoE Switch 8 Port", "PoE switch 8 port"],
      ["WATERPROOF SPEAKER IPX7", "Waterproof Speaker IPX7", "Waterproof speaker IPX7"],
      ["USB-C HUB WITH HDMI", "USB-C Hub with HDMI", "USB-C hub with HDMI"],
      ["LED STRIP RGB 5M", "LED Strip RGB 5m", "LED strip RGB 5m"],
      ["4K MONITOR 27 INCH", "4K Monitor 27 Inch", "4K monitor 27 inch"],
      ["PORTABLE SSD 1TB", "Portable SSD 1TB", "Portable SSD 1TB"],
      ["GPS RUNNING WATCH", "GPS Running Watch", "GPS running watch"],
      ["UPF 50+ SUN HAT", "UPF 50+ Sun Hat", "UPF 50+ sun hat"],
    ])("%s", (input, title, sentence) => {
      expect(normalizeTitle(input, "title")).toBe(title);
      expect(normalizeTitle(input, "sentence")).toBe(sentence);
    });

    it("also when the title is typed in lower case, and when it already has them (left alone)", () => {
      expect(normalizeTitle("gan charger with anc and nfc", "title")).toBe("GaN Charger with ANC and NFC");
      expect(normalizeTitle("GaN Charger", "title")).toBe("GaN Charger");
      expect(normalizeTitle("Router with PoE and 4K", "sentence")).toBe("Router with PoE and 4K");
    });
  });
});

describe("prices: retail goes to Variant Price, wholesale to Cost per item", () => {
  const priced = [
    row({ title: "Mug", sku: "M", price: "50.0 USD", cost: "$22.50" }),
    row({ title: "Cup", sku: "C", price: "52,99", cost: "24.00" }),
    row({ title: "Jug", sku: "J", price: "TBC", cost: "4.2 USD" }),
    row({ title: "Pot", sku: "P", price: "POA", cost: "11,0" }),
    row({ title: "Pan", sku: "A", price: "", cost: "12" }),
    row({ title: "Urn", sku: "U", price: "35.95", cost: "TBC" }),
  ];

  it("Variant Price is the retail price only, and Cost per item the wholesale price", () => {
    const { rows } = sanitizeDataset(priced);
    expect(rows.map((entry) => [entry.Variant_Price, entry.Cost_Per_Item])).toEqual([
      ["50.00", "22.50"], ["52.99", "24.00"], ["", "4.20"], ["", "11.00"], ["", "12.00"], ["35.95", ""],
    ]);
  });

  it("a retail price is never replaced by the wholesale one", () => {
    expect(sanitizeDataset([row({ title: "Mug", price: "9", cost: "3" })]).rows[0]).toMatchObject({ Variant_Price: "9.00", Cost_Per_Item: "3.00" });
  });

  it("variants without a retail price (TBC, POA, blank) are counted with their rows", () => {
    const { report } = sanitizeDataset(priced);
    expect(warning(report.warnings, "missing_price")).toMatchObject({
      severity: "warning",
      title: "Variants without a price",
      count: 3,
      rows: [4, 5, 6],
      details: ['"TBC", wholesale 4.20', '"POA", wholesale 11.00', "(blank), wholesale 12.00"],
    });
    expect(kinds(report.warnings)).not.toContain("price_from_cost");
  });

  it("'leave empty' is the default", () => {
    expect(sanitizeDataset(priced).report.options).toMatchObject({ noRetailPrice: "empty", markupPercent: 100 });
  });

  describe("export option: for rows without a retail price, use wholesale x markup", () => {
    it("100% (the default markup) doubles the wholesale price, for those rows only", () => {
      const { rows, report } = sanitizeDataset(priced, { noRetailPrice: "markup" });
      expect(rows.map((entry) => entry.Variant_Price)).toEqual(["50.00", "52.99", "8.40", "22.00", "24.00", "35.95"]);
      expect(rows.map((entry) => entry.Cost_Per_Item)).toEqual(["22.50", "24.00", "4.20", "11.00", "12.00", ""]);
      expect(kinds(report.warnings)).not.toContain("missing_price");
      expect(warning(report.warnings, "price_from_cost")).toMatchObject({ severity: "info", count: 3, rows: [4, 5, 6], details: ["4.20 + 100% = 8.40", "11.00 + 100% = 22.00", "12.00 + 100% = 24.00"] });
    });

    it("takes any markup, rounded to the cent", () => {
      expect(sanitizeDataset(priced, { noRetailPrice: "markup", markupPercent: 40 }).rows.map((entry) => entry.Variant_Price)).toEqual(["50.00", "52.99", "5.88", "15.40", "16.80", "35.95"]);
      expect(sanitizeDataset([row({ title: "Mug", cost: "3.33" })], { noRetailPrice: "markup", markupPercent: 33 }).rows[0].Variant_Price).toBe("4.43");
      expect(sanitizeDataset([row({ title: "Mug", cost: "10" })], { noRetailPrice: "markup", markupPercent: 0 }).rows[0].Variant_Price).toBe("10.00");
    });

    it("cannot invent a price where there is no wholesale price either: that variant is still reported", () => {
      const { rows, report } = sanitizeDataset([row({ title: "Mug", sku: "M", price: "TBC", cost: "POA" }), row({ title: "Cup", sku: "C", price: "5", cost: "2" })], { noRetailPrice: "markup" });
      expect(rows[0].Variant_Price).toBe("");
      expect(warning(report.warnings, "missing_price")).toMatchObject({ count: 1, rows: [2] });
      expect(warning(report.warnings, "missing_price")?.message).toContain("No wholesale price to work one out from");
    });

    it("a file with only a wholesale column: every variant is priced from it", () => {
      const { rows } = sanitizeDataset([row({ title: "Mug", cost: "4" }), row({ title: "Cup", cost: "3.5" })], { noRetailPrice: "markup", markupPercent: 50 });
      expect(rows.map((entry) => [entry.Variant_Price, entry.Cost_Per_Item])).toEqual([["6.00", "4.00"], ["5.25", "3.50"]]);
    });
  });

  it("a file without any price data says nothing about missing prices (the parser already warns about the missing column)", () => {
    expect(kinds(sanitizeDataset([row({ title: "Mug" }), row({ title: "Cup" })]).report.warnings)).not.toContain("missing_price");
  });

  it("Cost per item is a column only when the file has wholesale prices", () => {
    const headers = (raw: RawSupplierRow[]) => shopifyColumnsFor(sanitizeDataset(raw).rows).map((column) => column.header);
    expect(headers([row({ title: "Mug", price: "9", cost: "3" })])).toContain("Cost per item");
    expect(headers([row({ title: "Mug", price: "9" })])).not.toContain("Cost per item");
  });

  it("the written CSV carries it", () => {
    const parsed = Papa.parse<Record<string, string>>(toShopifyCsv(sanitizeDataset(priced).rows), { header: true, skipEmptyLines: true });
    expect(parsed.data.map((record) => [record["Variant Price"], record["Cost per item"]])).toEqual([
      ["50.00", "22.50"], ["52.99", "24.00"], ["", "4.20"], ["", "11.00"], ["", "12.00"], ["35.95", ""],
    ]);
  });
});

describe("3. stock", () => {
  const stocks = (...values: string[]) => sanitizeDataset(values.map((stock, index) => row({ title: `Item ${index}`, stock })));

  it("turns what the cell says into a quantity, and never invents one", () => {
    const { rows } = stocks(" 20 ", "0", "Out of stock", ">100", "In stock", "N/A", "", "  76  ");
    expect(rows.map((entry) => [entry.Variant_Inventory_Qty, entry.Variant_Inventory_Tracker])).toEqual([
      ["20", "shopify"], ["0", "shopify"], ["0", "shopify"], ["100", "shopify"], ["", ""], ["", ""], ["", ""], ["76", "shopify"],
    ]);
  });

  it("'>100' is written as 100 and listed as approximate", () => {
    const { report } = stocks("5", ">100", "100+", "over 250");
    expect(warning(report.warnings, "approximate_stock")).toMatchObject({
      severity: "warning",
      title: "Approximate stock",
      count: 3,
      rows: [3, 4, 5],
      details: ['">100" written as 100 (at least)', '"100+" written as 100 (at least)', '"over 250" written as 250 (at least)'],
    });
  });

  it("'In stock', 'N/A' and blank stay empty and are counted", () => {
    const { report } = stocks("In stock", "N/A", "", "12");
    expect(warning(report.warnings, "non_numeric_stock")).toMatchObject({ count: 3, rows: [2, 3, 4], details: ['"In stock"', '"N/A"', "(blank)"] });
  });

  it("'Out of stock' is 0 and not a problem", () => {
    expect(kinds(stocks("Out of stock", "sold out", "0").report.warnings)).toEqual([]);
  });
});

describe("the real row numbers", () => {
  it("count blank rows, so a warning's number is the number in the supplier's spreadsheet", () => {
    const parsed = parseSupplierText("Name,SKU,Qty\nMug,M,3\n,,\nCup,C,skladem\n\nPot,P,4\nTOTAL,,7\n");
    // line 1 is the header; Mug is row 2, the ",," line row 3 (blank), Cup row 4, the empty line row 5, Pot row 6, TOTAL row 7
    expect(parsed.rows.map((entry) => entry.sourceRow)).toEqual([2, 4, 6, 7]);
    const { report } = sanitizeDataset(parsed.rows);
    expect(warning(report.warnings, "non_numeric_stock")).toMatchObject({ rows: [4] });
    expect(warning(report.warnings, "summary_rows")).toMatchObject({ rows: [7] });
  });
});
