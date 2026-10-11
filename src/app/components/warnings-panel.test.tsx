import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import { sanitizeDataset } from "../utils/sanitizer";
import ExportOptions from "./export-options";
import WarningsPanel from "./warnings-panel";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
/** Whether the rendered checkbox with this id is ticked (React writes checked="" after the class attribute). */
const ticked = (markup: string, id: string) => new RegExp(`<input id="${id}"[^>]*checked=""`).test(markup);

describe("the warnings panel", () => {
  const rows = [
    ...Array.from({ length: 25 }, (_, i) => row({ title: `Item ${i}`, stock: "skladem", barcode: i < 3 ? "123" : "" })),
    row({ title: "Placeholder", description: "popis není k dispozici" }),
  ];
  const { report } = sanitizeDataset(rows);
  const markup = renderToStaticMarkup(<WarningsPanel report={report} scope="Checked the free preview: the first 26 of your 200 rows." />);

  it("has a heading, says how much of the file it looked at, and one entry per kind of problem", () => {
    expect(markup).toContain('id="warnings-heading"');
    expect(text(markup)).toContain("Checked the free preview: the first 26 of your 200 rows.");
    expect(markup.match(/data-warning-kind="/g)).toHaveLength(report.warnings.length);
    for (const kind of ["non_numeric_stock", "invalid_ean", "placeholder_description"]) expect(markup).toContain(`data-warning-kind="${kind}"`);
  });

  it("shows the count and only the first ten row numbers of a warning, then how many more", () => {
    const stock = markup.slice(markup.indexOf('data-warning-kind="non_numeric_stock"'));
    const entry = text(stock.slice(0, stock.indexOf("</li>")));
    expect(entry).toContain("Stock without a number");
    expect(entry).toContain("Stock without a number 25"); // the count is the full count
    expect(entry).toContain("Rows 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 15 more");
    expect(entry).not.toContain("10, 11");
  });

  it("a single row is 'Row 5', not 'Rows 5'", () => {
    const single = sanitizeDataset([row({ title: "A" }), row({ title: "B", description: "n/a" })]).report;
    expect(text(renderToStaticMarkup(<WarningsPanel report={single} scope="x" />))).toContain("Row 2");
  });

  it("offers what is in the listed rows (the SKU that changed, the value that was not a barcode)", () => {
    expect(markup).toContain("<details");
    expect(text(markup)).toContain('row 1: "123"');
  });

  it("says when the cleaner already fixed something, and when there is nothing to flag", () => {
    const fixed = sanitizeDataset(
      [row({ title: "Tee", sku: "A", options: [{ name: "Size", value: "S", derived: false }] }), row({ title: "Tee", sku: "A", options: [{ name: "Size", value: "M", derived: false }] })],
      { uniqueSkus: true },
    ).report;
    const fixedMarkup = text(renderToStaticMarkup(<WarningsPanel report={fixed} scope="x" />));
    expect(fixedMarkup).toContain("Made unique by adding each variant's option values");
    expect(fixedMarkup).toContain("A -> A-S");

    const clean = sanitizeDataset([row({ title: "Mug", sku: "M-1", price: "9,50" })]).report;
    expect(text(renderToStaticMarkup(<WarningsPanel report={clean} scope="x" />))).toContain("Nothing to flag");
  });
});

describe("the title casing selector", () => {
  const samples = [
    { before: "PROFESIONÁLNÍ PĚNOVÁ MATRACE XL", after: "Profesionální pěnová matrace XL" },
    { before: "BEZDRÁTOVÁ MYŠ USB-C 2.4GHZ", after: "Bezdrátová myš USB-C 2.4GHz" },
    { before: "TERMOHRNEK NEREZ 750ML", after: "Termohrnek nerez 750ml" },
  ];
  const render = (casing: "title" | "sentence" | "keep", given = samples) =>
    renderToStaticMarkup(<ExportOptions options={{ uniqueSkus: false, status: "draft", casing }} skusShared={false} samples={given} onChange={() => {}} />);

  it("offers Title Case, Sentence case and Keep as supplied, with the current choice selected", () => {
    const markup = render("sentence");
    expect(text(markup)).toContain("Title casing");
    expect(markup).toContain('<select id="option-casing"');
    expect([...markup.matchAll(/<option value="([a-z]+)"( selected="")?>([^<]+)<\/option>/g)].map((match) => [match[1], match[3], Boolean(match[2])])).toEqual([
      ["title", "Title Case", false],
      ["sentence", "Sentence case", true],
      ["keep", "Keep as supplied", false],
    ]);
  });

  it("starts on Title Case", () => {
    expect(render("title")).toMatch(/<option value="title" selected="">Title Case<\/option>/);
  });

  it("says that it applies to titles and vendors, and what the chosen casing does", () => {
    expect(text(render("title"))).toContain("Applies to titles and vendors.");
    expect(text(render("title"))).toContain("ALL CAPS and all-lowercase titles become Title Case");
    expect(text(render("sentence"))).toContain("Only the first letter, acronyms, tokens with digits (750ml, USB-C)");
    expect(text(render("keep"))).toContain("exactly as your supplier typed them");
  });

  it("shows three sample titles from the file under the selector, before and after", () => {
    const markup = render("sentence");
    const list = markup.slice(markup.indexOf('data-testid="casing-samples"'));
    expect(list.match(/<li/g)).toHaveLength(3);
    expect(text(list)).toContain("PROFESIONÁLNÍ PĚNOVÁ MATRACE XL → Profesionální pěnová matrace XL");
    expect(text(list)).toContain("BEZDRÁTOVÁ MYŠ USB-C 2.4GHZ → Bezdrátová myš USB-C 2.4GHz");
    expect(text(list)).toContain("TERMOHRNEK NEREZ 750ML → Termohrnek nerez 750ml");
    // the selector comes first, the examples under it
    expect(markup.indexOf('id="option-casing"')).toBeLessThan(markup.indexOf('data-testid="casing-samples"'));
  });

  it("shows no list when the file has no titles", () => {
    expect(render("title", [])).not.toContain("casing-samples");
  });
});

describe("the export options", () => {
  it("shows both switches with their current state, and says why unique SKUs started on", () => {
    const markup = renderToStaticMarkup(<ExportOptions options={{ uniqueSkus: true, status: "draft", casing: "title" }} skusShared samples={[]} onChange={() => {}} />);
    expect(ticked(markup, "option-unique-skus")).toBe(true);
    expect(ticked(markup, "option-active")).toBe(false);
    expect(text(markup)).toContain("Make SKUs unique per variant");
    expect(text(markup)).toContain("Import as active");
    expect(text(markup)).toContain("share one SKU");
  });

  it("'Import as active' is ticked for active products", () => {
    const markup = renderToStaticMarkup(<ExportOptions options={{ uniqueSkus: false, status: "active", casing: "title" }} skusShared={false} samples={[]} onChange={() => {}} />);
    expect(ticked(markup, "option-active")).toBe(true);
    expect(ticked(markup, "option-unique-skus")).toBe(false);
    expect(text(markup)).toContain("Your variants already have different SKUs");
  });
});
