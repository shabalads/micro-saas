import { describe, expect, it } from "vitest";
import { parseSupplierText } from "./csv-parser";

const first = (text: string) => parseSupplierText(text).rows[0];

describe("the catalog columns are recognised by name, in several languages", () => {
  it("English", () => {
    expect(first("Title,Vendor,Category,Tags,Stock,EAN,Currency,Weight\nTee,Acme,Shirts,red,5,12345678,CZK,200")).toMatchObject({
      title: "Tee", vendor: "Acme", category: "Shirts", tags: "red", stock: "5", barcode: "12345678", currency: "CZK", weight: "200", weightUnit: "",
    });
  });

  it("Czech, with and without accents", () => {
    const expected = { title: "Tričko", description: "Popis", images: "http://x.example.com/a.jpg", price: "9,90", sku: "A-1", vendor: "Acme", category: "Móda", stock: "3", barcode: "12345678", currency: "CZK" };
    for (const header of [
      "Nazev;Popis;Obrazek;Cena;Kod produktu;Vyrobce;Kategorie;Skladem;EAN;Mena",
      "Název;Popis;Obrázek;Cena;Kód produktu;Výrobce;Kategorie;Skladem;EAN;Měna",
    ]) {
      expect(first(`${header}\nTričko;Popis;http://x.example.com/a.jpg;9,90;A-1;Acme;Móda;3;12345678;CZK`), header).toMatchObject(expected);
    }
  });

  it("Slovak, Polish, German, French and Spanish", () => {
    expect(first("Názov;Popis;Cena;Výrobca;Kategória;Skladom\nA;B;1;C;D;4")).toMatchObject({ title: "A", description: "B", price: "1", vendor: "C", category: "D", stock: "4" });
    expect(first("Nazwa;Opis;Cena;Producent;Kategoria;Waluta;Zdjęcie\nA;B;1;C;D;PLN;http://x.example.com/a.jpg")).toMatchObject({ title: "A", vendor: "C", category: "D", currency: "PLN", images: "http://x.example.com/a.jpg" });
    expect(first("Bezeichnung;Beschreibung;Preis;Hersteller;Bestand;Gewicht\nA;B;1;C;4;300")).toMatchObject({ title: "A", description: "B", price: "1", vendor: "C", stock: "4", weight: "300" });
    expect(first("Nom;Marque;Prix\nA;B;1")).toMatchObject({ title: "A", price: "1" });
    expect(first("Nombre;Descripción;Precio;Marca\nA;B;1;C")).toMatchObject({ title: "A", description: "B", price: "1", vendor: "C" });
  });

  it("size and colour columns in those languages are option columns named after their header", () => {
    expect(first("Nazev;Velikost;Barva\nTee;S;Černá").options).toEqual([{ name: "Velikost", value: "S", derived: true }, { name: "Barva", value: "Černá", derived: true }]);
    expect(first("Nazwa,Rozmiar,Kolor\nTee,S,Czerń").options?.map((option) => option.name)).toEqual(["Rozmiar", "Kolor"]);
  });

  it("only the columns a file has are on the rows (so the writer knows what to write)", () => {
    const row = first("Title,Price\nTee,9");
    for (const key of ["vendor", "category", "tags", "stock", "barcode", "currency", "weight", "productCode"] as const) expect(row[key], key).toBeUndefined();
  });

  it("a weight column that names its unit passes it on", () => {
    expect(first("Title,Weight (kg)\nTee,0.5")).toMatchObject({ weight: "0.5", weightUnit: "kg" });
    expect(first("Nazev,Hmotnost (g)\nTee,250")).toMatchObject({ weight: "250", weightUnit: "g" });
  });

  it("an EAN column is the barcode, not the SKU", () => {
    expect(first("Title,SKU,EAN\nTee,A-1,12345678")).toMatchObject({ sku: "A-1", barcode: "12345678" });
  });
});

describe("SKU and product code", () => {
  it("a lone 'Product code' column is the SKU", () => {
    const row = first("Title,Product code\nTee,P-1");
    expect(row.sku).toBe("P-1");
    expect(row.productCode).toBeUndefined();
  });

  it("next to a real SKU column it names the product (it groups the variants) and the SKU stays the SKU, wherever they sit in the file", () => {
    for (const text of ["Title,Product code,SKU\nTee,P-1,V-1", "Title,SKU,Product code\nTee,V-1,P-1"]) {
      expect(first(text)).toMatchObject({ sku: "V-1", productCode: "P-1" });
    }
  });

  it("a parent / group column is the product code", () => {
    expect(first("Title,SKU,Parent SKU\nTee,V-1,P-1")).toMatchObject({ sku: "V-1", productCode: "P-1" });
    expect(first("Title,SKU,Group ID\nTee,V-1,G-1")).toMatchObject({ sku: "V-1", productCode: "G-1" });
  });

  it("when several columns fit, the better name wins, not the first one in the file", () => {
    expect(first("Name,Title\nA,B").title).toBe("B");
    expect(first("Title,Code,SKU\nA,X,Y").sku).toBe("Y");
  });
});

describe("wholesale, retail, stock and type columns (supplier price lists)", () => {
  it("wholesale price is the cost and RRP the retail price, whatever the currency note in brackets", () => {
    expect(first("Item Code,Product Name,Wholesale Price (USD),RRP\nA-1,Tee,22.50,50")).toMatchObject({ sku: "A-1", title: "Tee", cost: "22.50", price: "50" });
    expect(first("Title,Trade Price EUR,MSRP\nTee,5,9")).toMatchObject({ cost: "5", price: "9" });
  });

  it.each([
    ["Qty In Stock", "stock"], ["Stock Qty", "stock"], ["Quantity", "stock"], ["On Hand", "stock"], ["Units in Stock", "stock"], ["Skladem", "stock"],
    ["Dept", "category"], ["Department", "category"], ["Product Group", "category"], ["Product Type", "category"],
    ["Cost Price", "cost"], ["Dealer Price", "cost"], ["Buy Price", "cost"], ["Nákupní cena", "cost"],
    ["List Price", "price"], ["Retail Price", "price"], ["Sell Price", "price"], ["Prodejní cena", "price"],
  ] as const)("the header %s is read as %s", (header, field) => {
    expect(first(`Title,${header}\nTee,42`)[field]).toBe("42");
  });

  it("case, accents and punctuation do not matter", () => {
    expect(first("TITLE,qty. in stock,DEPT.\nTee,7,Shirts")).toMatchObject({ stock: "7", category: "Shirts" });
  });

  it("with both a wholesale and a retail column, neither takes the other's place", () => {
    expect(first("Title,Price,Wholesale\nTee,10,4")).toMatchObject({ price: "10", cost: "4" });
    expect(first("Title,Wholesale,Price\nTee,4,10")).toMatchObject({ price: "10", cost: "4" });
  });

  it("a misspelled header is read like the real one, and the file says so", () => {
    const parsed = parseSupplierText("Title,Descripton,Price\nTee,Soft,9");
    expect(parsed.rows[0].description).toBe("Soft");
    expect(parsed.warnings.join(" ")).toMatch(/The column "Descripton" was read as .* misspelling/);
  });
});

describe("row numbers and the rows that are not products", () => {
  it("number the rows as the spreadsheet does: the header is row 1, the first product row is row 2", () => {
    expect(parseSupplierText("Title,SKU\nA,1\nB,2\nC,3").rows.map((row) => [row.title, row.sourceRow])).toEqual([["A", 2], ["B", 3], ["C", 4]]);
  });

  it("blank lines count as rows, they are just not products", () => {
    const parsed = parseSupplierText("Title,SKU\nA,1\n\n,\nB,2\n\nC,3");
    expect(parsed.rows.map((row) => [row.title, row.sourceRow])).toEqual([["A", 2], ["B", 5], ["C", 7]]);
  });

  it("a record with line breaks inside quotes is ONE row, however many lines it takes", () => {
    const parsed = parseSupplierText('Title,Description\nA,"first line\nsecond line\n\nfourth line"\nB,plain\n\nC,"one\ntwo"\nD,last');
    expect(parsed.rows.map((row) => [row.title, row.sourceRow])).toEqual([["A", 2], ["B", 3], ["C", 5], ["D", 6]]);
  });

  it("also with Windows line endings and a byte-order mark, as Excel saves them", () => {
    const parsed = parseSupplierText('\ufeffTitle,SKU\r\nA,1\r\n\r\nB,2\r\n');
    expect(parsed.rows.map((row) => [row.title, row.sourceRow])).toEqual([["A", 2], ["B", 4]]);
  });

  it("a file of blank lines under the header has no products", () => {
    expect(() => parseSupplierText("Title,SKU\n\n,\n")).toThrow(/no product rows/);
  });

  it("remember the first cell with anything in it, which is how a TOTAL line is told from a product", () => {
    const parsed = parseSupplierText("Item Code,Product Name,Price\nA-1,Tee,5\nTOTAL,,125.50\n,Lamp,9");
    expect(parsed.rows.map((row) => row.firstCell)).toEqual(["A-1", "TOTAL", "Lamp"]);
    expect(parsed.rows[1]).toMatchObject({ title: "", sku: "TOTAL", price: "125.50" });
  });

  it("a row that has only a stray cell far to the right is still a row", () => {
    const parsed = parseSupplierText("Title,SKU,Price\nA,1,5\n,,9");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ title: "", price: "9", sourceRow: 3 });
  });
});
