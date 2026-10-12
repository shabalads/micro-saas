import { describe, expect, it } from "vitest";
import { isShortSize, mergeEquivalentSizes, possibleAbbreviations, sizeClassOf, unifyCase } from "./option-values";

describe("sizeClassOf: sizes that are the same size", () => {
  it.each([
    ["S", "Small"], ["s", "SMALL"], ["M", "Medium"], ["L", "Large"], ["XL", "X-Large"], ["XL", "Extra Large"], ["XL", "x large"],
    ["XXL", "2XL"], ["XXL", "XX-Large"], ["OS", "One Size"], ["OS", "OSFA"], ["OS", "One-Size"], ["XS", "X-Small"], ["XXXL", "3XL"],
  ])("%s is %s", (a, b) => {
    expect(sizeClassOf(a)).not.toBeNull();
    expect(sizeClassOf(a)).toBe(sizeClassOf(b));
  });

  it("and different sizes are different", () => {
    expect(sizeClassOf("S")).not.toBe(sizeClassOf("M"));
    expect(sizeClassOf("XL")).not.toBe(sizeClassOf("XXL"));
    expect(sizeClassOf("L")).not.toBe(sizeClassOf("XL"));
  });

  it("anything else is not a size", () => {
    for (const value of ["Black", "750ml", "30x32", "S/M", "Standard", "", "5-Quart"]) expect(sizeClassOf(value), value).toBeNull();
  });
});

describe("unifyCase: one spelling per value in a column", () => {
  it("makes the case variants one, in favour of the most frequent spelling (the first one wins a tie)", () => {
    expect(unifyCase(["Heather Grey", "Heather grey", "Heather Grey", "Navy", "navy"])).toEqual(["Heather Grey", "Heather Grey", "Heather Grey", "Navy", "Navy"]);
    expect(unifyCase(["One size", "One Size"])).toEqual(["One size", "One size"]);
  });

  it("leaves different values, blanks and the order alone", () => {
    expect(unifyCase(["Black", "", "White", "Black"])).toEqual(["Black", "", "White", "Black"]);
    expect(unifyCase([])).toEqual([]);
  });
});

describe("isShortSize: the short form of a size", () => {
  it.each(["S", "s", "M", "L", "XL", "xl", "XXL", "XXXL", "XS", "XXS", "OS"])("%s is the short form", (value) => {
    expect(isShortSize(value)).toBe(true);
  });

  it.each(["Small", "Medium", "Large", "X-Large", "2XL", "3XL", "One Size", "OSFA", "S/M", "Black", "30x32", ""])("%s is not", (value) => {
    expect(isShortSize(value)).toBe(false);
  });
});

describe("mergeEquivalentSizes: one spelling among all the values given (a whole file's)", () => {
  it("S and Small become the spelling most variants use, and every change is listed", () => {
    const { values, changes } = mergeEquivalentSizes(["S", "Small", "M", "Medium", "XL", "X-Large", "S", "XL", "XL"]);
    expect(values).toEqual(["S", "S", "M", "M", "XL", "XL", "S", "XL", "XL"]);
    expect(changes).toEqual([
      { index: 1, from: "Small", to: "S" },
      { index: 3, from: "Medium", to: "M" }, // a tie: the short form wins
      { index: 5, from: "X-Large", to: "XL" },
    ]);
  });

  it("a tie goes to the short form, whichever was seen first", () => {
    expect(mergeEquivalentSizes(["Small", "S"]).values).toEqual(["S", "S"]);
    expect(mergeEquivalentSizes(["Medium", "M"]).values).toEqual(["M", "M"]);
    expect(mergeEquivalentSizes(["Large", "L", "Large", "L"]).values).toEqual(["L", "L", "L", "L"]);
    expect(mergeEquivalentSizes(["X-Large", "XL"]).values).toEqual(["XL", "XL"]);
    expect(mergeEquivalentSizes(["One Size", "OS"]).values).toEqual(["OS", "OS"]);
    expect(mergeEquivalentSizes(["2XL", "XXL"]).values).toEqual(["XXL", "XXL"]);
  });

  it("with no short form among the tied ones, the one seen first stays", () => {
    expect(mergeEquivalentSizes(["Extra Large", "X-Large"]).values).toEqual(["Extra Large", "Extra Large"]);
    expect(mergeEquivalentSizes(["X-Large", "Extra Large"]).values).toEqual(["X-Large", "X-Large"]);
  });

  it("the majority beats the short form: S x2 against Small x3 is Small", () => {
    expect(mergeEquivalentSizes(["S", "Small", "S", "Small", "Small"]).values).toEqual(["Small", "Small", "Small", "Small", "Small"]);
  });

  it("two products' worth of values: S/M and Small/Medium become one spelling (a tie, so the short form)", () => {
    const { values, changes } = mergeEquivalentSizes(["S", "M", "Small", "Medium"]);
    expect(values).toEqual(["S", "M", "S", "M"]);
    expect(changes).toEqual([{ index: 2, from: "Small", to: "S" }, { index: 3, from: "Medium", to: "M" }]);
  });

  it("goes with the majority, even when that is the long spelling", () => {
    expect(mergeEquivalentSizes(["Small", "S", "Small", "Small"]).values).toEqual(["Small", "Small", "Small", "Small"]);
  });

  it("XXL and 2XL, OS and One Size", () => {
    expect(mergeEquivalentSizes(["XXL", "2XL", "XXL"]).values).toEqual(["XXL", "XXL", "XXL"]);
    expect(mergeEquivalentSizes(["One Size", "OS", "One Size"]).values).toEqual(["One Size", "One Size", "One Size"]);
  });

  it("a size written only one way is never touched, even when its twin is not in the list", () => {
    expect(mergeEquivalentSizes(["Medium", "Large", "XL"])).toEqual({ values: ["Medium", "Large", "XL"], changes: [] });
  });

  it("never mixes up two different sizes, and ignores values that are not sizes", () => {
    expect(mergeEquivalentSizes(["S", "M", "Black", "Medium", "30x32"]).values).toEqual(["S", "M", "Black", "M", "30x32"]);
  });
});

describe("possibleAbbreviations: only pointed out", () => {
  it("finds blk/Black, nv/Navy, wht/White", () => {
    expect(possibleAbbreviations(["Black", "Blk", "Navy", "Nv", "White", "Wht", "Heather Grey"])).toEqual([
      { short: "Blk", long: "Black" },
      { short: "Nv", long: "Navy" },
      { short: "Wht", long: "White" },
    ]);
  });

  it("ignores a value that is no abbreviation of anything in the product, and sizes", () => {
    expect(possibleAbbreviations(["Black", "Red", "S", "Small", "M", "OS", "One Size"])).toEqual([]);
  });

  it("needs the same first letter, in order, and the longer word really longer", () => {
    expect(possibleAbbreviations(["Black", "Klb"])).toEqual([]);
    expect(possibleAbbreviations(["Black", "Bkl"])).toEqual([]);
    expect(possibleAbbreviations(["Red", "Red"])).toEqual([]);
    expect(possibleAbbreviations(["Navy Blue", "NB"])).toEqual([]);
  });
});
