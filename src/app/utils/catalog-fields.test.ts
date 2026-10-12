import { describe, expect, it } from "vitest";
import { checkBarcode, cleanTags, currencyCode, currencyInPrice, gtinCheckDigit, parseStock, parseWeight, weightUnitInHeader } from "./catalog-fields";

describe("parseStock", () => {
  it.each([
    ["12", 12],
    ["  5 ", 5],
    ["0", 0],
    ["+7", 7],
    ["12.0", 12],
    ["12,00", 12],
    ["5 ks", 5],
    ["12 pcs", 12],
    ["1 200", 1200],
    ["1 200", 1200], // a non-breaking space
  ])("%j is the whole number %i", (input, quantity) => {
    expect(parseStock(input)).toEqual({ quantity, problem: null });
  });

  it.each(["", "   "])("%j is blank", (input) => {
    expect(parseStock(input)).toEqual({ quantity: null, problem: "blank" });
  });

  it.each(["skladem", "In stock", "in stock", "Available", "-3", "<5", "Low", "1.5", "1e3", "N/A", "TBC", "ca. 5", "9999999999", ">99999999999"])("%j is not a stock count: nothing is made up", (input) => {
    expect(parseStock(input)).toEqual({ quantity: null, problem: "not_a_number" });
  });

  it.each([" 20 ", "  76   ", "0", "1 200"])("%j is the quantity it says, exactly", (input) => {
    expect(parseStock(input)).toEqual({ quantity: Number(input.replace(/\s/g, "")), problem: null });
  });

  it.each(["Out of stock", "out of stock", "OUT OF STOCK", "Sold out", "No stock", "vyprodáno", "není skladem", "ausverkauft", "épuisé", "agotado", "brak"])("%j means none left: 0, and it is not a problem", (input) => {
    expect(parseStock(input)).toEqual({ quantity: 0, problem: null });
  });

  it.each([
    [">100", 100],
    ["> 100", 100],
    [">=50", 50],
    ["≥ 25", 25],
    ["100+", 100],
    ["5+", 5],
    ["over 100", 100],
    ["More than 1 000", 1000],
    ["at least 12", 12],
  ])("%j is at least %i: written as that number, marked approximate", (input, quantity) => {
    expect(parseStock(input)).toEqual({ quantity, problem: null, approximate: true });
  });

  it("a plain number is never marked approximate", () => {
    expect(parseStock("100")).not.toHaveProperty("approximate");
    expect(parseStock("Out of stock")).not.toHaveProperty("approximate");
  });
});

describe("checkBarcode", () => {
  it.each(["12345678", "123456789012", "8371407742358", "12345678901234"])("%s (8, 12, 13 or 14 digits) is valid, whatever its last digit is", (input) => {
    expect(checkBarcode(input)).toMatchObject({ barcode: input, status: "valid", shown: input });
  });

  it.each(["12345670", "036000291452", "4006381333931", "10012345678902"])("%s has the right check digit", (input) => {
    expect(checkBarcode(input)).toEqual({ barcode: input, status: "valid", shown: input, expectedCheckDigit: null });
  });

  it("a wrong last digit is still a valid barcode (it is written as supplied), and says what the digit should have been", () => {
    expect(checkBarcode("12345678")).toEqual({ barcode: "12345678", status: "valid", shown: "12345678", expectedCheckDigit: "0" });
    expect(checkBarcode("8371407742358")).toMatchObject({ barcode: "8371407742358", status: "valid", expectedCheckDigit: "3" });
    expect(checkBarcode("4006381333932")).toMatchObject({ status: "valid", expectedCheckDigit: "1" });
  });

  it("tidies what a spreadsheet does to a number: spaces, hyphens, a .0, a leading apostrophe", () => {
    expect(checkBarcode("  8371407742358 ").barcode).toBe("8371407742358");
    expect(checkBarcode("859-0123 456789").barcode).toBe("8590123456789");
    expect(checkBarcode("8590123456789.0").barcode).toBe("8590123456789");
    expect(checkBarcode("'8590123456789").barcode).toBe("8590123456789");
  });

  it.each(["1234567", "123456789", "1234567890123456", "ABC12345678", "8371407742358X", "8.59E+12"])("%s is invalid, and nothing is written for it", (input) => {
    expect(checkBarcode(input)).toMatchObject({ barcode: "", status: "invalid" });
  });

  it("blank cells and placeholders are empty, not invalid", () => {
    for (const input of ["", "  ", "n/a", "-"]) expect(checkBarcode(input)).toEqual({ barcode: "", status: "empty", shown: "", expectedCheckDigit: null });
  });

  it("an invalid value has no check digit to speak of", () => {
    expect(checkBarcode("1234567")).toMatchObject({ status: "invalid", expectedCheckDigit: null });
  });
});

describe("gtinCheckDigit (GS1: weights 3, 1, 3, 1 ... from the right)", () => {
  it.each([
    ["1234567", "0"], // GTIN-8
    ["03600029145", "2"], // UPC-A 036000291452
    ["400638133393", "1"], // EAN-13 4006381333931
    ["1001234567890", "2"], // GTIN-14 10012345678902
    ["837140774235", "3"], // the first EAN of test-data/messy-150-en.csv, 8371407742358, is one off
  ])("%s -> %s", (body, digit) => {
    expect(gtinCheckDigit(body)).toBe(digit);
  });
});

describe("currencies", () => {
  it("different spellings of one currency are one currency", () => {
    for (const spelling of ["CZK", "czk", "Kč", "KC", "kc"]) expect(currencyCode(spelling)).toBe("CZK");
    for (const spelling of ["EUR", "€", "Euro"]) expect(currencyCode(spelling)).toBe("EUR");
    for (const spelling of ["USD", "$", "US$"]) expect(currencyCode(spelling)).toBe("USD");
    expect(currencyCode("zł")).toBe("PLN");
    expect(currencyCode("£")).toBe("GBP");
    expect(currencyCode("Ft")).toBe("HUF");
  });

  it("keeps an unknown three-letter code, and has nothing for words and blanks", () => {
    expect(currencyCode("xyz")).toBe("XYZ");
    expect(currencyCode("")).toBe("");
    expect(currencyCode("not a currency")).toBe("");
    expect(currencyCode("n/a")).toBe("");
  });

  it.each([
    ["1.299,00 Kč", "CZK"],
    ["Kč 999,99", "CZK"],
    ["199,00 CZK", "CZK"],
    ["$12.50", "USD"],
    ["€ 9", "EUR"],
    ["EUR 9,50", "EUR"],
    ["12,50 zł", "PLN"],
    ["12,50", ""],
    ["1 299", ""],
    ["", ""],
  ])("the price %j names the currency %j", (price, expected) => {
    expect(currencyInPrice(price)).toBe(expected);
  });
});

describe("weight", () => {
  it("converts to whole grams from the unit in the cell, else the header's, else assumes grams", () => {
    expect(parseWeight("0,5 kg")).toMatchObject({ grams: 500, invalid: false, assumedGrams: false });
    expect(parseWeight("250", "g")).toMatchObject({ grams: 250, assumedGrams: false });
    expect(parseWeight("2", "kg")).toMatchObject({ grams: 2000 });
    expect(parseWeight("1.2 lb")).toMatchObject({ grams: 544 });
    expect(parseWeight("12 oz")).toMatchObject({ grams: 340 });
    expect(parseWeight("250")).toMatchObject({ grams: 250, assumedGrams: true });
  });

  it("says when it cannot read a weight, and treats blank and zero as no weight", () => {
    expect(parseWeight("heavy")).toMatchObject({ grams: null, invalid: true });
    expect(parseWeight("-5")).toMatchObject({ grams: null, invalid: true });
    expect(parseWeight("")).toEqual({ grams: null, invalid: false, assumedGrams: false });
    expect(parseWeight("0")).toEqual({ grams: null, invalid: false, assumedGrams: false });
    expect(parseWeight("n/a")).toEqual({ grams: null, invalid: false, assumedGrams: false });
  });

  it.each([
    ["Weight (kg)", "kg"],
    ["Hmotnost kg", "kg"],
    ["Hmotnost v g", "g"],
    ["Variant Grams", "g"],
    ["Net weight (lbs)", "lbs"],
    ["Weight", ""],
    ["Hmotnost", ""],
  ])("the header %j names the unit %j", (header, unit) => {
    expect(weightUnitInHeader(header)).toBe(unit);
  });
});

describe("cleanTags", () => {
  it("splits on commas, semicolons and pipes, trims, and drops repeats in any case", () => {
    expect(cleanTags("red; Sale | red, new")).toBe("red, Sale, new");
    expect(cleanTags("  summer ,, SUMMER ,Summer ")).toBe("summer");
  });

  it("drops placeholders, and is empty for nothing", () => {
    expect(cleanTags("n/a, blue, -")).toBe("blue");
    expect(cleanTags("")).toBe("");
    expect(cleanTags(" , ; ")).toBe("");
  });
});
