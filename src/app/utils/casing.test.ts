import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import { parseSupplierBytes } from "./csv-parser";
import { mergeSanitizeOptions, normalizeTitle, sampleTitleCasing, sanitizeDataset, toSentenceCaseTitle, toTitleCase } from "./sanitizer";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });

describe("Title Case (the default)", () => {
  it("still fixes ALL CAPS and all-lowercase titles, and leaves mixed case alone", () => {
    expect(normalizeTitle("BLUE T-SHIRT 123")).toBe("Blue T-Shirt 123");
    expect(normalizeTitle("wireless mouse for the office")).toBe("Wireless Mouse for the Office");
    expect(normalizeTitle("iPhone Case")).toBe("iPhone Case");
    expect(normalizeTitle("blue T-shirt")).toBe("blue T-shirt");
    expect(normalizeTitle("BEZDRÁTOVÁ MYŠ USB-C 2.4GHZ")).toBe("Bezdrátová Myš USB-C 2.4GHz");
  });

  it("is what you get without naming a casing", () => {
    expect(normalizeTitle("TERMOHRNEK NEREZ 750ML")).toBe(normalizeTitle("TERMOHRNEK NEREZ 750ML", "title"));
  });

  describe("company forms and their connectors are never capitalized", () => {
    it.each([
      ["ŁÓDŹ HURT SP. Z O.O.", "Łódź Hurt sp. z o.o."],
      ["ACME S.R.O.", "Acme s.r.o."],
      ["NOVAK A.S.", "Novak a.s."],
      ["NOVAK K.S.", "Novak k.s."],
      ["KOWALSKI S.A.", "Kowalski S.A."],
      ["MUELLER GMBH", "Mueller GmbH"],
      ["MUELLER GMBH & CO. KG", "Mueller GmbH & Co. KG"],
      ["SMITH LTD", "Smith Ltd"],
      ["SMITH LTD.", "Smith Ltd."],
      ["DOE LLC", "Doe LLC"],
      ["DOE INC", "Doe Inc"],
      ["DOE INC.", "Doe Inc."],
      ["BRAUN E.K.", "Braun e.K."],
      ["JANSEN B.V.", "Jansen B.V."],
      ["SIEMENS AG", "Siemens AG"],
      ["SPOL. S R.O. NOVAK", "spol. s r.o. Novak"],
      ["acme s.r.o.", "Acme s.r.o."],
      ["acme gmbh", "Acme GmbH"],
      ["ACME, S.R.O.", "Acme, s.r.o."],
      ["(ACME S.R.O.)", "(Acme s.r.o.)"],
      ["ACME S.R.O., PRAHA", "Acme s.r.o., Praha"],
    ])("%s -> %s", (input, expected) => {
      expect(normalizeTitle(input)).toBe(expected);
    });

    it("whole words only: 'as' and 'ag' inside a sentence are ordinary words, and 'z' is only a connector inside sp. z o.o.", () => {
      expect(normalizeTitle("MUG AS A GIFT")).toBe("Mug as a Gift");
      expect(normalizeTitle("PIVO Z BECHEROVKY")).toBe("Pivo Z Becherovky");
      expect(toTitleCase("TOP GMBHX")).not.toContain("GmbH");
    });

    it("a name that is already written correctly is not touched (mixed case is left alone)", () => {
      expect(normalizeTitle("Žďárské Textilie s.r.o.")).toBe("Žďárské Textilie s.r.o.");
      expect(normalizeTitle("Mueller GmbH")).toBe("Mueller GmbH");
    });
  });
});

describe("Sentence case", () => {
  it.each([
    ["PROFESIONÁLNÍ PĚNOVÁ MATRACE XL", "Profesionální pěnová matrace XL"],
    ["ERGONOMICKÁ KANCELÁŘSKÁ ŽIDLE", "Ergonomická kancelářská židle"],
    ["BEZDRÁTOVÁ MYŠ USB-C 2.4GHZ", "Bezdrátová myš USB-C 2.4GHz"],
    ["TERMOHRNEK NEREZ 750ML", "Termohrnek nerez 750ml"],
    ["KOBEREC SHAGGY 160X230", "Koberec shaggy 160x230"],
    ["CESTOVNÍ KUFR ABS 65L", "Cestovní kufr ABS 65L"],
    ["LED STOLNÍ LAMPA S USB", "LED stolní lampa S USB"],
    ["BATOH NA NOTEBOOK 15.6", "Batoh na notebook 15.6"],
    ["SPACÁK ZIMNÍ -10°C", "Spacák zimní -10°C"],
    ["POWERBANKA 20000MAH USB-C", "Powerbanka 20000mAh USB-C"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTitle(input, "sentence")).toBe(expected);
  });

  it("puts a Title Case title into sentence case too (it is not only for shouting titles)", () => {
    expect(normalizeTitle("Blue Cotton T-Shirt", "sentence")).toBe("Blue cotton T-shirt");
    expect(normalizeTitle("Ergonomic Office Chair", "sentence")).toBe("Ergonomic office chair");
    expect(normalizeTitle("wireless mouse", "sentence")).toBe("Wireless mouse");
  });

  describe("keeps what should keep its capitals", () => {
    it("the first letter", () => {
      expect(normalizeTitle("ŠÁLEK KERAMICKÝ MODRÝ", "sentence")).toBe("Šálek keramický modrý");
      expect(normalizeTitle("łódź retro plakát", "sentence")).toBe("Łódź retro plakát");
    });

    it("acronyms: known ones in a shouting title, and any capitals typed among lower case words", () => {
      expect(normalizeTitle("WIRELESS USB LED LAMP", "sentence")).toBe("Wireless USB LED lamp");
      expect(normalizeTitle("Wireless NASA mug with HD print", "sentence")).toBe("Wireless NASA mug with HD print");
      expect(normalizeTitle("Mug for the EU market", "sentence")).toBe("Mug for the EU market");
    });

    it("tokens with digits: units are tidied, model codes keep their letters upper case", () => {
      expect(normalizeTitle("Bottle 750ML steel", "sentence")).toBe("Bottle 750ml steel");
      expect(normalizeTitle("Router 2.4GHZ dual band", "sentence")).toBe("Router 2.4GHz dual band");
      expect(normalizeTitle("Graphics card rtx3080 12gb", "sentence")).toBe("Graphics card RTX3080 12GB");
      expect(normalizeTitle("Paper a4 80g", "sentence")).toBe("Paper A4 80g");
    });

    it("words that were already mixed-case: iPhone, DomoPlus, McDonald, eBay, 2.4GHz", () => {
      expect(normalizeTitle("iPhone 15 Pro Case", "sentence")).toBe("iPhone 15 pro case");
      expect(normalizeTitle("Soft DomoPlus Mug", "sentence")).toBe("Soft DomoPlus mug");
      expect(normalizeTitle("The McDonald Collection", "sentence")).toBe("The McDonald collection");
      expect(normalizeTitle("Router 2.4GHz", "sentence")).toBe("Router 2.4GHz");
    });

    it("single letters and designators: sizes, the C of USB-C, the T of T-shirt", () => {
      expect(normalizeTitle("Tričko M modré", "sentence")).toBe("Tričko M modré");
      expect(normalizeTitle("Cable Type-C", "sentence")).toBe("Cable type-C");
      expect(normalizeTitle("Plain T-Shirt", "sentence")).toBe("Plain T-shirt");
    });

    it("known brand spellings, hyphenated or not", () => {
      expect(normalizeTitle("WIRELESS BLUETOOTH SPEAKER", "sentence")).toBe("Wireless Bluetooth speaker");
      expect(normalizeTitle("WIFI ROUTER", "sentence")).toBe("Wi-Fi router");
      expect(normalizeTitle("WI-FI ROUTER", "sentence")).toBe("Wi-Fi router");
    });
  });

  it("writes company forms the way they are conventionally written", () => {
    expect(normalizeTitle("ŁÓDŹ HURT SP. Z O.O.", "sentence")).toBe("Łódź hurt sp. z o.o.");
    expect(normalizeTitle("MUELLER GMBH", "sentence")).toBe("Mueller GmbH");
    expect(normalizeTitle("ACME S.R.O.", "sentence")).toBe("Acme s.r.o.");
    expect(normalizeTitle("KOWALSKI S.A.", "sentence")).toBe("Kowalski S.A.");
  });

  it("vendors: TECH-IMPORT -> Tech-import, a mixed-case name is kept", () => {
    expect(toSentenceCaseTitle("TECH-IMPORT")).toBe("Tech-import");
    expect(toSentenceCaseTitle("DomoPlus")).toBe("DomoPlus");
    expect(toSentenceCaseTitle("Říčany Wholesale")).toBe("Říčany wholesale");
  });

  it("is idempotent", () => {
    for (const title of ["PROFESIONÁLNÍ PĚNOVÁ MATRACE XL", "BEZDRÁTOVÁ MYŠ USB-C 2.4GHZ", "ŁÓDŹ HURT SP. Z O.O.", "Wireless NASA mug"]) {
      const once = normalizeTitle(title, "sentence");
      expect(normalizeTitle(once, "sentence"), title).toBe(once);
    }
  });

  it("leaves nothing and numbers alone", () => {
    expect(normalizeTitle("", "sentence")).toBe("");
    expect(normalizeTitle("  12345  ", "sentence")).toBe("12345");
  });
});

describe("Keep as supplied", () => {
  it("does not touch the case, only the whitespace and markup", () => {
    expect(normalizeTitle("PROFESIONÁLNÍ PĚNOVÁ MATRACE XL", "keep")).toBe("PROFESIONÁLNÍ PĚNOVÁ MATRACE XL");
    expect(normalizeTitle("  blue   TEE <b>x</b> &amp; y ", "keep")).toBe("blue TEE x & y");
    expect(normalizeTitle("ACME S.R.O.", "keep")).toBe("ACME S.R.O.");
  });
});

describe("the casing choice in a cleaned file", () => {
  const raw = [
    row({ title: "BLUE MUG 300ML", vendor: "ACME TOOLS S.R.O.", category: "KITCHEN", sku: "A" }),
    row({ title: "iPhone Case", vendor: "  DomoPlus  ", category: "ELEKTRONIKA", sku: "B" }),
  ];
  const casings = (casing: "title" | "sentence" | "keep") => sanitizeDataset(raw, { casing }).rows.map((entry) => [entry.Title, entry.Vendor, entry.Type]);

  it("is Title Case unless another is chosen, and the report says which was used", () => {
    expect(sanitizeDataset(raw).report.options.casing).toBe("title");
    expect(sanitizeDataset(raw).rows.map((entry) => entry.Title)).toEqual(["Blue Mug 300ml", "iPhone Case"]);
  });

  it("applies to the Title and the Vendor", () => {
    expect(casings("title")).toEqual([["Blue Mug 300ml", "Acme Tools s.r.o.", "Kitchen"], ["iPhone Case", "DomoPlus", "Elektronika"]]);
    expect(casings("sentence")).toEqual([["Blue mug 300ml", "Acme tools s.r.o.", "Kitchen"], ["iPhone case", "DomoPlus", "Elektronika"]]);
    expect(casings("keep")).toEqual([["BLUE MUG 300ML", "ACME TOOLS S.R.O.", "Kitchen"], ["iPhone Case", "DomoPlus", "Elektronika"]]);
  });

  it("but not to the Type, which is tidied the same way whatever is chosen", () => {
    for (const casing of ["title", "sentence", "keep"] as const) expect(casings(casing).map(([, , type]) => type), casing).toEqual(["Kitchen", "Elektronika"]);
  });

  it("never changes a handle: a URL does not move because a casing was chosen", () => {
    const withWifi = [row({ title: "WIFI ROUTER 4G", sku: "A" })];
    const handles = (["title", "sentence", "keep"] as const).map((casing) => sanitizeDataset(withWifi, { casing }).rows[0].Handle);
    expect(new Set(handles).size).toBe(1);
    expect(handles[0]).toBe("wi-fi-router-4g");
  });

  it("never changes which rows form a product", () => {
    const variants = [
      row({ title: "TEE", sku: "A", options: [{ name: "Size", value: "S", derived: false }] }),
      row({ title: "Tee", sku: "B", options: [{ name: "Size", value: "M", derived: false }] }),
      row({ title: "tee", sku: "C", options: [{ name: "Size", value: "L", derived: false }] }),
    ];
    for (const casing of ["title", "sentence", "keep"] as const) {
      const { rows, report } = sanitizeDataset(variants, { casing });
      expect(report.productCount, casing).toBe(1);
      expect(rows[0].Title, casing).toBe({ title: "Tee", sentence: "Tee", keep: "TEE" }[casing]);
    }
  });
});

describe("the casing choice on the real files", () => {
  const raw = parseSupplierBytes(readFileSync(join(__dirname, "../../../test-data/messy-150-en.csv"))).rows;

  it("sentence case: titles and vendors of known rows", () => {
    const { rows } = sanitizeDataset(raw, { casing: "sentence" });
    expect(rows[0]).toMatchObject({ Title: "Profesionální pěnová matrace XL", Vendor: "Łódź hurt sp. z o.o." });
    expect(rows[1]).toMatchObject({ Title: "Ergonomická kancelářská židle", Vendor: "Tech-import" });
    expect(rows[6]).toMatchObject({ Title: "Bezdrátová myš USB-C 2.4GHz" });
    expect(rows[13]).toMatchObject({ Title: "Termohrnek nerez 750ml", Vendor: "Říčany wholesale" });
    expect(rows[69]).toMatchObject({ Title: "Yoga podložka 6mm", Vendor: "DomoPlus" });
  });

  it("keep: exactly as supplied", () => {
    const { rows } = sanitizeDataset(raw, { casing: "keep" });
    expect(rows[0]).toMatchObject({ Title: "PROFESIONÁLNÍ PĚNOVÁ MATRACE XL", Vendor: "ŁÓDŹ HURT SP. Z O.O." });
    expect(rows[69]).toMatchObject({ Vendor: "DomoPlus" });
  });

  it("the products, handles and SKUs are the same in all three", () => {
    const outcomes = (["title", "sentence", "keep"] as const).map((casing) => {
      const { rows, report } = sanitizeDataset(raw, { casing });
      return { products: report.productCount, handles: rows.map((entry) => entry.Handle), skus: rows.map((entry) => entry.Variant_SKU) };
    });
    expect(outcomes[0].products).toBe(57);
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });
});

describe("sample titles for the selector", () => {
  const raw = [row({ title: "  BLUE   MUG " }), row({ title: "BLUE MUG" }), row({ title: "" }), row({ title: "Red Vase" }), row({ title: "ŠÁLEK MODRÝ 300ML" }), row({ title: "FOURTH ONE" })];

  it("are the first three different titles of the file, as supplied and as the casing writes them", () => {
    expect(sampleTitleCasing(raw, "sentence")).toEqual([
      { before: "BLUE MUG", after: "Blue mug" },
      { before: "Red Vase", after: "Red vase" },
      { before: "ŠÁLEK MODRÝ 300ML", after: "Šálek modrý 300ml" },
    ]);
    expect(sampleTitleCasing(raw, "title")[0]).toEqual({ before: "BLUE MUG", after: "Blue Mug" });
    expect(sampleTitleCasing(raw, "keep")[2]).toEqual({ before: "ŠÁLEK MODRÝ 300ML", after: "ŠÁLEK MODRÝ 300ML" });
  });

  it("are fewer when the file has fewer, and none for a file without titles", () => {
    expect(sampleTitleCasing([row({ title: "Only one" })], "title")).toHaveLength(1);
    expect(sampleTitleCasing([row({ title: "" })], "title")).toEqual([]);
    expect(sampleTitleCasing(raw, "title", 10)).toHaveLength(4); // BLUE MUG, Red Vase, ŠÁLEK MODRÝ 300ML, FOURTH ONE
  });
});

describe("the options a parked file comes back with (the Stripe round trip)", () => {
  const defaults = { uniqueSkus: true, status: "draft", casing: "title" } as const;

  it("keeps every choice that was made", () => {
    expect(mergeSanitizeOptions(defaults, { uniqueSkus: false, status: "active", casing: "sentence" })).toEqual({ uniqueSkus: false, status: "active", casing: "sentence" });
    expect(mergeSanitizeOptions(defaults, { casing: "keep" })).toEqual({ uniqueSkus: true, status: "draft", casing: "keep" });
  });

  it("falls back to the defaults for a file parked before the option existed, and ignores anything invalid", () => {
    expect(mergeSanitizeOptions(defaults, { uniqueSkus: false, status: "active" })).toEqual({ uniqueSkus: false, status: "active", casing: "title" });
    expect(mergeSanitizeOptions(defaults, undefined)).toEqual(defaults);
    expect(mergeSanitizeOptions(defaults, null)).toEqual(defaults);
    expect(mergeSanitizeOptions(defaults, { casing: "shouting" as never, status: "published" as never, uniqueSkus: "yes" as never })).toEqual(defaults);
  });
});
