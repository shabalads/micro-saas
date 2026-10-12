import { describe, expect, it } from "vitest";
import { toShopifyCsv } from "../full-export/csv-writer";
import type { RawOption, RawSupplierRow } from "../types/csv";
import { parseSupplierText } from "./csv-parser";
import { buildPreviewPairs, cleanOptionName, cleanOptionValue, sanitizeDataset, shopifyColumnsFor } from "./sanitizer";
import Papa from "papaparse";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });
const opt = (name: string, value: string, derived = false): RawOption => ({ name, value, derived });

/** The CSV the paid export would write, parsed back, so the assertions look at what Shopify would receive. */
function shopifyFile(raw: RawSupplierRow[]) {
  const { rows } = sanitizeDataset(raw);
  const parsed = Papa.parse<Record<string, string>>(toShopifyCsv(rows), { header: true, skipEmptyLines: true });
  return { headers: parsed.meta.fields ?? [], records: parsed.data };
}

describe("one handle per product, product-level fields only on the first row", () => {
  const tee = [
    row({ title: "CLASSIC TEE", handle: "classic-tee", description: "<p>SOFT COTTON.</p>", price: "19.90", sku: "TEE-S", images: "https://cdn.test/tee-s.jpg", options: [opt("size", "S"), opt("color", "NAVY BLUE")] }),
    row({ title: "", handle: "classic-tee", price: "19.90", sku: "TEE-M", options: [opt("size", "m"), opt("color", "NAVY BLUE")] }),
    row({ title: "", handle: "classic-tee", price: "21.90", sku: "TEE-L", options: [opt("size", "L"), opt("color", "Red")] }),
  ];

  it("writes Option1/2 Name on the first row only and every variant's own values", () => {
    const { headers, records } = shopifyFile(tee);
    expect(headers).toEqual(["Handle", "Title", "Body (HTML)", "Image Src", "Image Position", "Variant Price", "Variant SKU", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Status"]);
    expect(records.map((record) => [record.Handle, record.Title, record["Option1 Name"], record["Option1 Value"], record["Option2 Name"], record["Option2 Value"], record["Variant SKU"], record["Variant Price"]])).toEqual([
      ["classic-tee", "Classic Tee", "Size", "S", "Color", "Navy Blue", "TEE-S", "19.90"],
      ["classic-tee", "", "", "M", "", "Navy Blue", "TEE-M", "19.90"],
      ["classic-tee", "", "", "L", "", "Red", "TEE-L", "21.90"],
    ]);
  });

  it("title, body and every other product-level field appear once", () => {
    const { records } = shopifyFile(tee);
    expect(records.filter((record) => record.Title !== "")).toHaveLength(1);
    expect(records.filter((record) => record["Body (HTML)"] !== "")).toHaveLength(1);
    expect(new Set(records.map((record) => record.Handle)).size).toBe(1);
  });

  it("a variant keeps its own images, as an image-only extra row stays attached to the right handle", () => {
    const { records } = shopifyFile([
      row({ title: "Mug", handle: "mug", options: [opt("Color", "Blue")], images: "https://cdn.test/a.jpg|https://cdn.test/b.jpg" }),
      row({ title: "", handle: "mug", options: [opt("Color", "Red")], images: "https://cdn.test/c.jpg" }),
    ]);
    expect(records.map((record) => [record.Handle, record["Option1 Value"], record["Image Src"]])).toEqual([
      ["mug", "Blue", "https://cdn.test/a.jpg"],
      ["mug", "", "https://cdn.test/b.jpg"],
      ["mug", "Red", "https://cdn.test/c.jpg"],
    ]);
  });

  it("counts variants as variants, not as products", () => {
    const { report } = sanitizeDataset(tee);
    expect(report).toMatchObject({ sourceRows: 3, productCount: 1, variantRows: 2, optionRows: 3, warnings: [] });
  });

  it("a file without options gets no option columns at all (the output is unchanged)", () => {
    const { headers } = shopifyFile([row({ title: "Mug", sku: "M-1" }), row({ title: "Cup", sku: "C-1" })]);
    expect(headers).toEqual(["Handle", "Title", "Body (HTML)", "Image Src", "Variant Price", "Variant SKU", "Status"]);
  });

  it("only the options that are used get columns", () => {
    const rows = sanitizeDataset([row({ title: "Rug", handle: "rug", options: [opt("Size", "Large"), opt("Color", "")] }), row({ handle: "rug", options: [opt("Size", "Small"), opt("Color", "")] })]).rows;
    expect(shopifyColumnsFor(rows).map((column) => column.header)).toEqual(["Handle", "Title", "Body (HTML)", "Image Src", "Variant Price", "Variant SKU", "Option1 Name", "Option1 Value", "Status"]);
  });
});

describe("grouping without a handle column", () => {
  it("rows with the same title and option values become variants of ONE product", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "WOOL SOCKS", sku: "S-1", options: [opt("Size", "S")] }),
      row({ title: "Wool Socks", sku: "S-2", options: [opt("Size", "M")] }),
      row({ title: "wool socks", sku: "S-3", options: [opt("Size", "L")] }),
      row({ title: "Cotton Socks", sku: "C-1", options: [opt("Size", "M")] }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title, entry.Option1_Name, entry.Option1_Value])).toEqual([
      ["wool-socks", "Wool Socks", "Size", "S"],
      ["wool-socks", "", "", "M"],
      ["wool-socks", "", "", "L"],
      ["cotton-socks", "Cotton Socks", "Size", "M"],
    ]);
    expect(report).toMatchObject({ productCount: 2, variantRows: 2, handlesGenerated: 2, duplicateHandlesResolved: 0 });
  });

  it("the same title WITHOUT option values stays two products (handles get a suffix), as before", () => {
    const { rows } = sanitizeDataset([row({ title: "Mug", sku: "1" }), row({ title: "Mug", sku: "2" })]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["mug", "mug-2"]);
  });

  it("a repeated handle with a DIFFERENT title is a different product, even when it has options", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Blue Mug", handle: "mug", options: [opt("Size", "S")] }),
      row({ title: "Red Vase", handle: "mug", options: [opt("Size", "S")] }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title])).toEqual([["mug", "Blue Mug"], ["mug-2", "Red Vase"]]);
  });
});

describe("attribute columns (a column headed 'Size') only become options when they separate variants", () => {
  it("'Style: Casual' on every product is a description, not an option", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Shirt A", options: [opt("Style", "Casual", true)] }),
      row({ title: "Shirt B", options: [opt("Style", "Casual", true)] }),
    ]);
    expect(rows.every((entry) => entry.Option1_Name === "" && entry.Option1_Value === "")).toBe(true);
  });

  it("'Size' that differs between the rows of one product is an option, for every product in the file", () => {
    const { rows } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S", true)] }),
      row({ title: "", handle: "tee", options: [opt("Size", "M", true)] }),
      row({ title: "Hat", handle: "hat", options: [opt("Size", "One Size", true)] }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Option1_Name, entry.Option1_Value])).toEqual([["tee", "Size", "S"], ["tee", "", "M"], ["hat", "Size", "One Size"]]);
  });

  it("explicit Option1 Value columns are always used, even for single-variant products", () => {
    const { rows } = sanitizeDataset([row({ title: "Hat", options: [opt("Size", "One Size", false)] })]);
    expect(rows[0]).toMatchObject({ Option1_Name: "Size", Option1_Value: "One Size" });
  });
});

describe("what the tool cannot fix, it says", () => {
  const kinds = (report: { warnings: Array<{ kind: string }> }) => report.warnings.map((warning) => warning.kind);

  it("duplicate option combinations (Shopify: 'Option values are not unique'), with the rows", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "M"), opt("Color", "Red")] }),
      row({ handle: "tee", options: [opt("Size", "L"), opt("Color", "Red")] }),
      row({ handle: "tee", options: [opt("Size", "m"), opt("Color", "red")] }),
    ]);
    expect(kinds(report)).toEqual(["duplicate_variant"]);
    const [warning] = report.warnings;
    expect(warning).toMatchObject({ severity: "warning", count: 1, rows: [4], details: ["repeats row 2: M / Red"] });
    expect(warning.message).toMatch(/1 variant repeats the option values of another variant/);
    expect(warning.message).toMatch(/Option values are not unique/);
  });

  it("variants with no option values at all, under one product, are duplicates too: never exported silently", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", sku: "A" }),
      row({ handle: "tee", sku: "B" }),
    ]);
    expect(report.warnings.find((warning) => warning.kind === "duplicate_variant")).toMatchObject({ count: 1, rows: [3], details: ["repeats row 2: (no option values)"] });
  });

  it("a variant with no value for an option its siblings have", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "M")] }),
      row({ handle: "tee", options: [opt("Size", "")] }),
      row({ handle: "tee", options: [opt("Size", "L")] }),
    ]);
    expect(kinds(report)).toEqual(["missing_option_value"]);
    expect(report.warnings[0]).toMatchObject({ count: 1, rows: [3], details: ['no value for "Size"'] });
  });

  it("names the options on the first row even when that row has no value of its own, so the variants below are not nameless", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "")] }),
      row({ handle: "tee", options: [opt("Size", "L")] }),
    ]);
    expect(rows[0].Option1_Name).toBe("Size");
    expect(rows[1]).toMatchObject({ Option1_Name: "", Option1_Value: "L" });
    expect(report.warnings.find((warning) => warning.kind === "missing_option_value")?.details).toEqual(['no value for "Size"']);
  });

  it("a variant row (no title of its own) that is not next to its product is written WITH it, and warned about: the alternative is a product with no title", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S")] }),
      row({ title: "Hat", handle: "hat", options: [opt("Size", "S")] }),
      row({ handle: "tee", options: [opt("Size", "M")] }),
    ]);
    expect(rows.map((entry) => [entry.Handle, entry.Title, entry.Option1_Value])).toEqual([["tee", "Tee", "S"], ["tee", "", "M"], ["hat", "Hat", "S"]]);
    expect(kinds(report)).toEqual(["variants_apart"]);
    expect(report.warnings[0]).toMatchObject({ count: 1, rows: [4], details: ['joins "Tee" (row 2), which keeps its first position'] });
  });

  it("but a row WITH a title and the same handle further down is still its own product (-2)", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S")] }),
      row({ title: "Hat", handle: "hat", options: [opt("Size", "S")] }),
      row({ title: "Tee", handle: "tee", options: [opt("Size", "M")] }),
    ]);
    expect(rows.map((entry) => entry.Handle)).toEqual(["tee", "hat", "tee-2"]);
    expect(kinds(report)).toEqual(["split_product"]);
  });

  it("an option that a later row calls something else: the first row's name wins, and it is mentioned", () => {
    const { rows, report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S")] }),
      row({ handle: "tee", options: [opt("Colour", "M")] }),
    ]);
    expect(rows[0].Option1_Name).toBe("Size");
    expect(rows[1].Option1_Name).toBe("");
    expect(kinds(report)).toEqual(["option_name_conflict"]);
    expect(report.warnings[0].message).toMatch(/names an option differently/);
    expect(report.warnings[0]).toMatchObject({ rows: [3], details: ['"Colour" here, "Size" in row 2'] });
  });

  it("a clean multi-variant file raises nothing", () => {
    const { report } = sanitizeDataset([
      row({ title: "Tee", handle: "tee", options: [opt("Size", "S"), opt("Color", "Red")] }),
      row({ handle: "tee", options: [opt("Size", "S"), opt("Color", "Blue")] }),
      row({ handle: "tee", options: [opt("Size", "M"), opt("Color", "Red")] }),
    ]);
    expect(report.warnings).toEqual([]);
  });
});

describe("option names and values are tidied, not invented", () => {
  it.each([
    ["navy blue", "Navy Blue"],
    ["NAVY BLUE", "Navy Blue"],
    ["xl", "XL"],
    ["XL", "XL"],
    ["42", "42"],
    ["Small / Medium", "Small / Medium"],
    ["  Red  Wine ", "Red Wine"],
    ["iPhone 15", "iPhone 15"],
    ["N/A", ""],
    ["-", ""],
    ["&amp; more", "& More"],
  ])("value %j -> %j", (input, expected) => {
    expect(cleanOptionValue(input)).toBe(expected);
  });

  it("names: 'size' -> 'Size', 'COLOR' -> 'Color', anything long is capped", () => {
    expect(cleanOptionName("size")).toBe("Size");
    expect(cleanOptionName("COLOR")).toBe("Color");
    expect(cleanOptionName("x".repeat(400))).toHaveLength(255);
  });
});

describe("the CSV file maps to options (parser)", () => {
  it("Option1 Name / Option1 Value style columns, including names and values from different spellings", () => {
    const { rows } = parseSupplierText("Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU\ntee,Tee,Size,S,Color,Red,T-1\ntee,,Size,M,Color,Red,T-2\n");
    expect(rows[0].options).toEqual([{ name: "Size", value: "S", derived: false }, { name: "Color", value: "Red", derived: false }]);
    expect(rows[1].options?.map((option) => option.value)).toEqual(["M", "Red"]);
    const woo = parseSupplierText("Name,Attribute 1 name,Attribute 1 value(s)\nTee,Size,S\n").rows;
    expect(woo[0].options).toEqual([{ name: "Size", value: "S", derived: false }]);
  });

  it("a value column without a name column gets a neutral name instead of none", () => {
    const { rows } = parseSupplierText("title,option1\nTee,S\n");
    expect(rows[0].options).toEqual([{ name: "Option 1", value: "S", derived: false }]);
  });

  it("plain Size / Colour columns are attribute columns named after their header", () => {
    const { rows } = parseSupplierText("title,SIZE,Colour,price\nTee,S,Red,9\n");
    expect(rows[0].options).toEqual([{ name: "Size", value: "S", derived: true }, { name: "Colour", value: "Red", derived: true }]);
  });

  it("more than three attribute columns: three are used and the rest are named in a warning", () => {
    const { rows, warnings } = parseSupplierText("title,size,color,material,style\nTee,S,Red,Cotton,Casual\n");
    expect(rows[0].options).toHaveLength(3);
    expect(warnings.join(" ")).toMatch(/three options per product, so "style" was not used as an option/);
  });

  it("explicit option columns win over attribute columns", () => {
    const { rows } = parseSupplierText("title,Option1 Name,Option1 Value,size\nTee,Material,Cotton,S\n");
    expect(rows[0].options).toEqual([{ name: "Material", value: "Cotton", derived: false }]);
  });

  it("a file without any option column has no options on its rows", () => {
    expect(parseSupplierText("title,price\nTee,9\n").rows[0].options).toBeUndefined();
  });
});

describe("end to end: a supplier file with variants in, an importable Shopify file out", () => {
  const FILE = [
    "Handle,Title,Description,Option1 Name,Option1 Value,Option2 Name,Option2 Value,SKU,Price,Images",
    "classic-tee,CLASSIC TEE,<p>SOFT COTTON</p>,size,S,color,NAVY,TEE-S-NAVY,\"19,90\",https://cdn.test/tee.jpg",
    "classic-tee,,,size,M,color,NAVY,TEE-M-NAVY,\"19,90\",",
    "classic-tee,,,size,S,color,RED,TEE-S-RED,\"21,90\",https://cdn.test/tee-red.jpg",
    "wool-hat,Wool Hat,Warm,size,One Size,,,HAT-1,\"14,50\",",
  ].join("\n");

  it("produces one handle per product, names once, values on every variant, tidy prices", () => {
    const { rows } = parseSupplierText(FILE);
    const { headers, records } = shopifyFile(rows);
    expect(headers).toContain("Option1 Name");
    expect(headers).toContain("Option2 Value");
    expect(records.map((record) => [record.Handle, record.Title, record["Option1 Name"], record["Option1 Value"], record["Option2 Name"], record["Option2 Value"], record["Variant Price"]])).toEqual([
      ["classic-tee", "Classic Tee", "Size", "S", "Color", "Navy", "19.90"],
      ["classic-tee", "", "", "M", "", "Navy", "19.90"],
      ["classic-tee", "", "", "S", "", "Red", "21.90"],
      ["wool-hat", "Wool Hat", "Size", "One Size", "", "", "14.50"],
    ]);
    // no variant repeats another
    const combos = records.filter((record) => record.Handle === "classic-tee").map((record) => `${record["Option1 Value"]}/${record["Option2 Value"]}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("the before/after preview still lines up with the source rows when some of them are variants", () => {
    const { rows: raw } = parseSupplierText(FILE);
    const { rows, rowStarts } = sanitizeDataset(raw);
    const pairs = buildPreviewPairs(raw, rows, rowStarts, 10);
    expect(pairs.map((pair) => [pair.primary.Handle, pair.isVariantRow])).toEqual([["classic-tee", false], ["classic-tee", true], ["classic-tee", true], ["wool-hat", false]]);
    expect(pairs[2].primary.Option2_Value).toBe("Red");
  });
});
