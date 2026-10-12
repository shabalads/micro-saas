import { describe, expect, it } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import {
  buildPreviewPairs,
  cleanDescription,
  countFixes,
  generateHandle,
  normalizePrice,
  normalizeTitle,
  sanitizeDataset,
  splitImageUrls,
  toTitleCase,
} from "./sanitizer";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({
  id: "",
  title: "",
  description: "",
  images: "",
  price: "",
  sku: "",
  ...overrides,
});

describe("Title Case that preserves acronyms and units", () => {
  it.each([
    ["USB-C CHARGING CABLE 2M 100W LED", "USB-C Charging Cable 2m 100W LED"],
    ["STAINLESS STEEL WATER BOTTLE 750ML", "Stainless Steel Water Bottle 750ml"],
    ["CERAMIC COFFEE MUG 350ML SET OF 2", "Ceramic Coffee Mug 350ml Set of 2"],
    ["BLUE T-SHIRT 123", "Blue T-Shirt 123"],
    ["LORD OF THE RINGS BOX SET", "Lord of the Rings Box Set"],
    ["10X20CM POSTER", "10x20cm Poster"],
    ["XL SIZE T-SHIRT", "XL Size T-Shirt"],
    ["RTX3080 GRAPHICS CARD", "RTX3080 Graphics Card"],
    ["O'BRIEN & SONS GIFT SET", "O'Brien & Sons Gift Set"],
    ["WIRELESS BLUETOOTH HEADPHONES NOISE CANCELLING", "Wireless Bluetooth Headphones Noise Cancelling"],
    ["HDMI CABLE 2KG 5KM USB 3.0 HUB", "HDMI Cable 2kg 5km USB 3.0 Hub"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it("fixes all-lower-case titles the same way", () => {
    expect(normalizeTitle("leather wallet slim rfid blocking")).toBe("Leather Wallet Slim RFID Blocking");
  });

  it("leaves well-formed mixed-case titles alone", () => {
    expect(normalizeTitle("iPhone 15 Pro Case")).toBe("iPhone 15 Pro Case");
    expect(normalizeTitle("Blue T-Shirt")).toBe("Blue T-Shirt");
  });

  it("strips tags and entities and collapses rogue whitespace", () => {
    expect(normalizeTitle("  BLUE   &AMP; RED\t<B>MUG</B>  ")).toBe("Blue & Red Mug");
    expect(toTitleCase("a tale of two cities")).toBe("A Tale of Two Cities");
  });
});

describe("ALL CAPS descriptions (the 'after' panel must not shout)", () => {
  it("turns shouting body copy into sentence case", () => {
    expect(cleanDescription("<div>SOFT COTTON TEE. MACHINE WASHABLE AT 30C.</div>")).toBe(
      "<p>Soft cotton tee. Machine washable at 30C.</p>",
    );
  });

  it("keeps acronyms and units, and re-cases across inline tags", () => {
    expect(cleanDescription("<p>FAST <b>USB-C</b> CHARGING. 750ML BOTTLE WITH LED LIGHT.</p>")).toBe(
      "<p>Fast <strong>USB-C</strong> charging. 750ml bottle with LED light.</p>",
    );
  });

  it("capitalizes the start of every list item and paragraph", () => {
    expect(cleanDescription("<p>OVER-EAR HEADPHONES.</p><ul><li>ACTIVE NOISE CANCELLING</li><li>BLUETOOTH 5.3</li></ul>")).toBe(
      "<p>Over-ear headphones.</p><ul><li>Active noise cancelling</li><li>Bluetooth 5.3</li></ul>",
    );
  });

  it("re-cases plain text with line breaks", () => {
    expect(cleanDescription("HAND-PAINTED MUGS.\nDISHWASHER SAFE.")).toBe("<p>Hand-painted mugs.<br>Dishwasher safe.</p>");
  });

  it("keeps single-letter designators next to hyphens upper case", () => {
    expect(cleanDescription("<p>TYPE-C PORT. T-SHIRT FIT.</p>")).toBe("<p>Type-C port. T-shirt fit.</p>");
  });

  it("does not touch descriptions that are already mixed case or lower case", () => {
    expect(cleanDescription("<p>Soft tee, MACHINE washable. Great gift.</p>")).toBe("<p>Soft tee, MACHINE washable. Great gift.</p>");
    expect(cleanDescription("<p>all lowercase text here</p>")).toBe("<p>all lowercase text here</p>");
  });

  it("does not treat very short strings or bare acronyms as shouting", () => {
    expect(cleanDescription("<p>XL</p>")).toBe("<p>XL</p>");
    expect(cleanDescription("<p>USB LED</p>")).toBe("<p>USB LED</p>");
  });

  it("still strips legacy markup", () => {
    expect(cleanDescription('<div style="color:red"><font face="Arial">Soft <b>tee</b></font></div><div>&nbsp;</div>')).toBe(
      "<p>Soft <strong>tee</strong></p>",
    );
  });
});

describe("multi-row variant handles", () => {
  const TEE = [
    row({ handle: "Blue Tee", title: "BLUE TEE", description: "<div>Soft cotton</div>", images: "https://cdn.example.com/a.jpg|https://cdn.example.com/b.jpg", price: "$20.00", sku: "TEE-S" }),
    row({ handle: "blue-tee", title: "", price: "$22.00", sku: "TEE-M", images: "https://cdn.example.com/m.jpg" }),
    row({ handle: "blue-tee", title: "Blue Tee", price: "$24.00", sku: "TEE-L" }),
    row({ handle: "red-tee", title: "RED TEE", description: "Red", price: "$20.00", sku: "RED-S" }),
  ];

  it("keeps every variant on the shared handle: no -2 suffix, no 'Untitled Product'", () => {
    const { rows } = sanitizeDataset(TEE);
    expect(rows.map((r) => r.Handle)).toEqual(["blue-tee", "blue-tee", "blue-tee", "blue-tee", "red-tee"]);
    expect(rows.some((r) => r.Title === "Untitled Product")).toBe(false);
  });

  it("puts Title and Body only on the first row and keeps each variant's own price, SKU and image", () => {
    const { rows } = sanitizeDataset(TEE);
    expect(rows[0]).toMatchObject({ Title: "Blue Tee", Body_HTML: "<p>Soft cotton</p>", Variant_SKU: "TEE-S", Variant_Price: "20.00" });
    expect(rows[1]).toMatchObject({ Title: "", Body_HTML: "", Image_Src: "https://cdn.example.com/b.jpg", Variant_SKU: "" });
    expect(rows[2]).toMatchObject({ Title: "", Body_HTML: "", Variant_SKU: "TEE-M", Variant_Price: "22.00", Image_Src: "https://cdn.example.com/m.jpg" });
    expect(rows[3]).toMatchObject({ Title: "", Variant_SKU: "TEE-L", Variant_Price: "24.00" });
  });

  it("counts products and variants separately", () => {
    const { report } = sanitizeDataset(TEE);
    expect(report).toMatchObject({ sourceRows: 4, productCount: 2, variantRows: 2, titlesFixed: 2 });
  });

  it("never attaches a row that is NOT next to its product to the earlier product: it becomes a product of its own (and is warned about)", () => {
    const { rows, report } = sanitizeDataset([
      row({ handle: "mug", title: "Mug", sku: "M1" }),
      row({ handle: "cup", title: "Cup", sku: "C1" }),
      row({ handle: "mug", title: "Mug", sku: "M2" }),
    ]);
    expect(rows.map((r) => [r.Handle, r.Title, r.Variant_SKU])).toEqual([["mug", "Mug", "M1"], ["cup", "Cup", "C1"], ["mug-2", "Mug", "M2"]]);
    expect(report).toMatchObject({ productCount: 3, variantRows: 0, duplicateHandlesResolved: 1 });
    expect(report.warnings.map((warning) => warning.kind)).toEqual(["split_product"]);
    expect(report.warnings[0]).toMatchObject({ count: 1, rows: [4] }); // the third record: row 4, the header being row 1
  });

  it("a variant row with a blank title directly under its product still attaches to it", () => {
    const { rows } = sanitizeDataset([row({ handle: "mug", title: "Mug", sku: "M1" }), row({ handle: "mug", title: "", sku: "M2" }), row({ handle: "cup", title: "Cup", sku: "C1" })]);
    expect(rows.map((r) => [r.Handle, r.Title])).toEqual([["mug", "Mug"], ["mug", ""], ["cup", "Cup"]]);
  });

  it("still separates two different products that collide on one handle", () => {
    const { rows, report } = sanitizeDataset([row({ handle: "mug", title: "Blue Mug" }), row({ handle: "mug", title: "Red Mug" })]);
    expect(rows.map((r) => r.Handle)).toEqual(["mug", "mug-2"]);
    expect(report).toMatchObject({ variantRows: 0, duplicateHandlesResolved: 1 });
  });

  it("reports where each source row starts, so before/after pairs stay aligned", () => {
    const { rows, rowStarts } = sanitizeDataset(TEE);
    expect(rowStarts).toEqual([0, 2, 3, 4]); // the first product has 2 images, so 2 output rows
    const pairs = buildPreviewPairs(TEE, rows, rowStarts, 10);
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toMatchObject({ isVariantRow: false });
    expect(pairs[0].extraImageRows).toHaveLength(1);
    expect(pairs[1]).toMatchObject({ isVariantRow: true });
    expect(pairs[1].primary.Variant_SKU).toBe("TEE-M");
    expect(pairs[2].isVariantRow).toBe(true);
    expect(pairs[3].primary.Handle).toBe("red-tee");
  });
});

describe("handles", () => {
  it("slugs titles, transliterates accents and is URL-safe", () => {
    expect(generateHandle("BLUE T-SHIRT 123")).toBe("blue-t-shirt-123");
    expect(generateHandle("Čokoláda Hořká & Mléčná")).toBe("cokolada-horka-and-mlecna");
  });

  it("makes handles unique across identical titles", () => {
    const { rows } = sanitizeDataset([row({ title: "MUG", sku: "1" }), row({ title: "MUG", sku: "2" }), row({ title: "MUG", sku: "3" })]);
    expect(rows.map((r) => r.Handle)).toEqual(["mug", "mug-2", "mug-3"]);
  });

  it("falls back to SKU, id, then position when a title has nothing a URL can be made of", () => {
    const { rows } = sanitizeDataset([
      row({ title: "™", sku: "ZX-9" }), row({ title: "®®", id: "77" }), row({ title: "***" }),
    ]);
    expect(rows.map((r) => r.Handle)).toEqual(["zx-9", "77", "product-4"]);
  });

  it("a row with no title that belongs to no product is left out and said so: no 'Untitled Product', no title made up", () => {
    const { rows, report } = sanitizeDataset([row({ title: "Mug", sku: "M" }), row({ title: "", sku: "ZX-9", price: "5" }), row({ title: "", id: "77" })]);
    expect(rows.map((r) => r.Title)).toEqual(["Mug"]);
    expect(rows.some((r) => /untitled/i.test(r.Title))).toBe(false);
    expect(report.warnings.find((w) => w.kind === "untitled_row")).toMatchObject({ count: 2, rows: [3, 4], details: ["SKU ZX-9", "no title and no code"] });
    expect(report.rowsDropped).toBe(2);
  });
});

describe("prices and images", () => {
  it.each([
    ["$1,299.00", "1299.00"], ["1.299,00 EUR", "1299.00"], ["89,90 €", "89.90"], ["USD 19.9", "19.90"],
    ["1 299,00 Kč", "1299.00"], ["N/A", ""], ["-5", ""],
  ])("price %s -> %s", (input, expected) => {
    expect(normalizePrice(input)).toBe(expected);
  });

  it("splits clumped image cells on pipes, semicolons and commas, drops duplicates and relative paths", () => {
    expect(splitImageUrls("https://a.example.com/1.jpg|https://a.example.com/2.jpg;https://a.example.com/1.jpg, https://a.example.com/3.jpg|wallet.jpg")).toEqual({
      urls: ["https://a.example.com/1.jpg", "https://a.example.com/2.jpg", "https://a.example.com/3.jpg"],
      dropped: 1,
    });
  });
});

describe("fix counting (what telemetry records)", () => {
  it("sums the individual fixes and ignores variant grouping and processing time", () => {
    const { report } = sanitizeDataset([
      row({ title: "BLUE MUG", description: "<div>x</div>", images: "https://a.example.com/1.jpg|https://a.example.com/2.jpg", price: "$5.00" }),
    ]);
    // title + description + generated handle + split image cell + normalized price
    expect(countFixes(report)).toBe(5);
    expect(countFixes(sanitizeDataset([row({ title: "Blue Mug", handle: "blue-mug" })]).report)).toBe(0);
  });
});
