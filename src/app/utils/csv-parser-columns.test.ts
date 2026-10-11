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
