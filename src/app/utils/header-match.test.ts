import { describe, expect, it } from "vitest";
import { type ColumnKey, HEADER_ALIASES } from "./header-aliases";
import { compactKey, headerTokens, matchHeaders, similarity } from "./header-match";

const COLUMNS = Object.keys(HEADER_ALIASES) as ColumnKey[];
const resolve = (...headers: string[]) => {
  const matches = matchHeaders(headers, HEADER_ALIASES, COLUMNS);
  return Object.fromEntries([...matches].map(([column, match]) => [column, match.header]));
};
const how = (header: string, column: ColumnKey) => matchHeaders([header], HEADER_ALIASES, COLUMNS).get(column)?.how;

describe("compactKey and headerTokens: case, accents and punctuation do not matter", () => {
  it("Qty. in Stock, qty-in-stock and QTY IN STOCK are one name", () => {
    for (const header of ["Qty. in Stock", "qty-in-stock", "QTY IN STOCK", "  qty_in_stock "]) expect(compactKey(header), header).toBe("qtyinstock");
  });

  it("removes accents and writes ß, ø, ł the plain way", () => {
    expect(compactKey("Nákupní cena")).toBe("nakupnicena");
    expect(compactKey("Großhandelspreis")).toBe("grosshandelspreis");
    expect(compactKey("Cena zakupu (zł)")).toBe("cenazakupuzl");
    expect(headerTokens("Wholesale Price (USD)")).toEqual(["wholesale", "price", "usd"]);
  });
});

describe("the names the task lists, exactly", () => {
  it.each([
    ["stock", ["qty in stock", "stock qty", "quantity", "qty", "on hand", "available", "inventory", "stock level", "units in stock", "in stock"]],
    ["category", ["dept", "department", "category", "product group", "product type", "type", "class"]],
    ["cost", ["wholesale price", "wholesale", "trade price", "cost", "cost price", "net price", "buy price", "dealer price"]],
    ["price", ["rrp", "msrp", "retail", "retail price", "price", "list price", "sell price"]],
  ] as const)("%s", (column, names) => {
    for (const name of names) {
      expect(resolve(name)[column], `${name} -> ${column}`).toBe(name);
      expect(resolve(name.toUpperCase())[column], `${name.toUpperCase()}`).toBe(name.toUpperCase());
      expect(resolve(name.replace(/ /g, "_"))[column], name.replace(/ /g, "_")).toBe(name.replace(/ /g, "_"));
    }
  });
});

describe("the supplier file's headers", () => {
  const HEADERS = ["Item Code", "Product Name", "Long Description", "Wholesale Price (USD)", "RRP", "Qty In Stock", "Brand", "Dept", "Colour", "Size", "Image URL", "UPC", "Weight (kg)"];

  it("map to the columns they should, and Colour and Size are left for the option columns", () => {
    expect(resolve(...HEADERS)).toEqual({
      sku: "Item Code",
      title: "Product Name",
      description: "Long Description",
      cost: "Wholesale Price (USD)",
      price: "RRP",
      stock: "Qty In Stock",
      vendor: "Brand",
      category: "Dept",
      images: "Image URL",
      barcode: "UPC",
      weight: "Weight (kg)",
    });
  });

  it("wholesale is the cost and never the price, whichever column comes first", () => {
    expect(resolve("RRP", "Wholesale Price (USD)")).toEqual({ price: "RRP", cost: "Wholesale Price (USD)" });
    expect(resolve("Wholesale Price (USD)", "RRP")).toEqual({ price: "RRP", cost: "Wholesale Price (USD)" });
  });

  it("a lone wholesale or cost column is the cost, and leaves the price without a column", () => {
    expect(resolve("Product Name", "Wholesale Price")).toEqual({ title: "Product Name", cost: "Wholesale Price" });
    expect(resolve("Name", "Cost")).toEqual({ title: "Name", cost: "Cost" });
  });
});

describe("exact, then contains, then similar", () => {
  it("a currency or unit in brackets does not change what a column is", () => {
    expect(how("Price (EUR)", "price")).toBe("exact");
    expect(how("Retail Price (USD)", "price")).toBe("exact");
    expect(how("Weight (kg)", "weight")).toBe("exact");
  });

  it("'per unit' and 'each' say nothing about what a column holds", () => {
    expect(resolve("Product Name", "Wholesale Price per Unit")).toEqual({ title: "Product Name", cost: "Wholesale Price per Unit" });
    expect(how("Wholesale Price per Unit", "cost")).toBe("exact");
    expect(how("Cost per Item", "cost")).toBe("exact");
  });

  it("a known name inside a longer header is found when it says most of the header", () => {
    expect(resolve("Product Name", "Standard Wholesale Price")).toEqual({ title: "Product Name", cost: "Standard Wholesale Price" });
    expect(how("Standard Wholesale Price", "cost")).toBe("contains");
    expect(how("Qty In Stock Now", "stock")).toBe("contains");
    expect(how("Current Retail Price", "price")).toBe("contains");
  });

  it("but not when it is only a small part of it ('Colour Code' is no SKU, 'Image Type' no category)", () => {
    expect(resolve("Name", "Colour Code")).toEqual({ title: "Name" });
    expect(resolve("Name", "Image Type")).toEqual({ title: "Name" });
    expect(resolve("Name", "Shipping Class Notes Internal")).toEqual({ title: "Name" });
  });

  it("a misspelling is read as the column it looks like, and says so", () => {
    const matches = matchHeaders(["Product Name", "Descripton", "Wholesale Pricee"], HEADER_ALIASES, COLUMNS);
    expect(matches.get("description")).toMatchObject({ header: "Descripton", how: "similar" });
    expect(matches.get("cost")).toMatchObject({ header: "Wholesale Pricee", how: "similar" });
    expect(matches.get("description")?.similarity).toBeGreaterThan(0.85);
  });

  it("does not guess when nothing is close", () => {
    expect(resolve("Product Name", "Warehouse Bin", "Supplier Notes")).toEqual({ title: "Product Name" });
  });

  it("an exact name always beats a guess for the same column", () => {
    const matches = matchHeaders(["Descripton", "Description"], HEADER_ALIASES, COLUMNS);
    expect(matches.get("description")).toMatchObject({ header: "Description", how: "exact" });
  });
});

describe("when several columns fit one, the name listed first wins, not the column that comes first in the file", () => {
  it.each([
    [["Code", "SKU"], "sku", "SKU"],
    [["Name", "Title"], "title", "Title"],
    [["Price", "RRP"], "price", "Price"],
    [["Qty", "Qty In Stock"], "stock", "Qty In Stock"],
  ] as const)("%j", (headers, column, expected) => {
    expect(resolve(...headers)[column]).toBe(expected);
  });

  it("and one header is never two columns", () => {
    const matches = matchHeaders(["Price"], HEADER_ALIASES, COLUMNS);
    expect([...matches.keys()]).toEqual(["price"]);
  });
});

describe("multilingual", () => {
  it.each([
    [["Nákupní cena", "Prodejní cena", "Skladem", "Kategorie", "Výrobce"], { cost: "Nákupní cena", price: "Prodejní cena", stock: "Skladem", category: "Kategorie", vendor: "Výrobce" }],
    [["Cena hurtowa", "Cena detaliczna", "Stan magazynowy", "Producent"], { cost: "Cena hurtowa", price: "Cena detaliczna", stock: "Stan magazynowy", vendor: "Producent" }],
    [["Einkaufspreis", "Verkaufspreis", "Lagerbestand", "Warengruppe", "Hersteller"], { cost: "Einkaufspreis", price: "Verkaufspreis", stock: "Lagerbestand", category: "Warengruppe", vendor: "Hersteller" }],
    [["Prix de gros", "Prix de vente", "Quantité", "Rayon"], { cost: "Prix de gros", price: "Prix de vente", stock: "Quantité", category: "Rayon" }],
    [["Precio mayorista", "Precio de venta", "Existencias", "Departamento"], { cost: "Precio mayorista", price: "Precio de venta", stock: "Existencias", category: "Departamento" }],
  ] as const)("%j", (headers, expected) => {
    expect(resolve(...headers)).toEqual(expected);
  });
});

describe("similarity", () => {
  it("is 1 for the same text, and falls with every edit", () => {
    expect(similarity("price", "price")).toBe(1);
    expect(similarity("descripton", "description")).toBeCloseTo(1 - 1 / 11, 5);
    expect(similarity("abc", "xyz")).toBe(0);
    expect(similarity("", "")).toBe(1);
  });
});
