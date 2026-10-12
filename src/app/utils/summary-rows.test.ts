import { describe, expect, it } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import { summaryLabel, summaryRowReason } from "./summary-rows";

const row = (overrides: Partial<RawSupplierRow>): RawSupplierRow => ({ id: "", title: "", description: "", images: "", price: "", sku: "", ...overrides });

describe("a summary line is recognised by its first cell", () => {
  it.each([
    "TOTAL", "Total", "total", "TOTALS", "SUBTOTAL", "Sub-total", "Sub total", "GRAND TOTAL", "Grand Total:", "SUM", "Sum:", "COUNT", "Count (items)", "AVERAGE", "AVG", "Overall",
    "Celkem", "CELKEM:", "Součet", "Mezisoučet", "Suma", "Razem", "Podsumowanie", "Summe", "Gesamt", "Gesamtsumme", "Insgesamt", "Somme", "Totaux", "Sous-total", "Totales",
  ])("%s", (label) => {
    expect(summaryRowReason(row({ firstCell: label, sku: label, price: "12345.67", stock: "1420" }))).toBe("label");
  });

  it("whether the label is in the SKU column or the title column", () => {
    expect(summaryRowReason(row({ sku: "TOTAL", price: "10" }))).toBe("label");
    expect(summaryRowReason(row({ title: "TOTAL", price: "10" }))).toBe("label");
    expect(summaryRowReason(row({ title: "Grand total", price: "10", cost: "20", stock: "5" }))).toBe("label");
  });

  it("the label is read from the first cell WITH something in it, not the first column", () => {
    expect(summaryRowReason(row({ firstCell: "TOTAL", sku: "TOTAL" }))).toBe("label");
    expect(summaryRowReason(row({ firstCell: "ELE-1", sku: "ELE-1", title: "Total Control Gamepad", price: "30" }))).toBeNull();
  });
});

describe("a product that merely starts with such a word is not a summary", () => {
  it.each([
    row({ title: "Summit-Tech Jacket", sku: "APP-1", price: "40", description: "Warm." }),
    row({ title: "Total Recall T-Shirt", sku: "TEE-9", price: "20", vendor: "Studio" }),
    row({ title: "Count Chocula Mug", price: "9", images: "https://x.example.com/m.jpg" }),
    row({ title: "Sum Wetsuit", sku: "W-1", price: "99", options: [{ name: "Size", value: "M", derived: false }] }),
    row({ title: "Count Chocula Mug", firstCell: "Count Chocula Mug", price: "9", barcode: "12345670" }),
  ])("%j", (product) => {
    expect(summaryRowReason(product)).toBeNull();
  });

  it("a SKU that starts with such a word does not make a variant row a summary", () => {
    expect(summaryRowReason(row({ firstCell: "SUM-100", sku: "SUM-100", title: "Sum Wetsuit", price: "99" }))).toBeNull();
    expect(summaryRowReason(row({ firstCell: "TOTAL-1", sku: "TOTAL-1", price: "5", options: [{ name: "Size", value: "M", derived: false }] }))).toBeNull();
  });

  it("'Summit' and 'Counter' are not 'sum' and 'count'", () => {
    expect(summaryRowReason(row({ firstCell: "Summit", sku: "Summit", price: "5" }))).toBeNull();
    expect(summaryRowReason(row({ firstCell: "Counterfeit", sku: "Counterfeit" }))).toBeNull();
  });
});

describe("a line with no title and no variant data but a number in a price column", () => {
  it("is a summary even without a label", () => {
    expect(summaryRowReason(row({ price: "12345.67" }))).toBe("numbers");
    expect(summaryRowReason(row({ cost: "28950.00", stock: "1420" }))).toBe("numbers");
    expect(summaryRowReason(row({ firstCell: "28950.00", cost: "28950.00" }))).toBe("numbers");
  });

  it("but not when it has a SKU, an id, a code, a handle, options or a barcode: that is a variant", () => {
    for (const variant of [
      row({ sku: "A-1", price: "9" }),
      row({ id: "77", price: "9" }),
      row({ productCode: "P", price: "9" }),
      row({ handle: "tee", price: "9" }),
      row({ options: [{ name: "Size", value: "M", derived: false }], price: "9" }),
      row({ barcode: "12345670", price: "9" }),
    ]) {
      expect(summaryRowReason(variant), JSON.stringify(variant)).toBeNull();
    }
  });

  it("and a row with a number only in the stock is not a price row", () => {
    expect(summaryRowReason(row({ stock: "5" }))).toBeNull();
  });

  it("a normal product is never one", () => {
    expect(summaryRowReason(row({ title: "Mug", sku: "M-1", price: "9" }))).toBeNull();
  });
});

describe("summaryLabel", () => {
  it("is the label as the file wrote it, or says numbers only", () => {
    expect(summaryLabel(row({ firstCell: "TOTAL" }))).toBe("TOTAL");
    expect(summaryLabel(row({ price: "5" }))).toBe("numbers only");
  });
});
