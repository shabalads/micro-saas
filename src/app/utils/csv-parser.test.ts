import { describe, expect, it } from "vitest";
import { decodeSupplierBytes, parseSupplierFile, parseSupplierText } from "./csv-parser";
import { sanitizeDataset } from "./sanitizer";

const utf8 = (text: string) => new TextEncoder().encode(text);
/** Builds a byte array from a mix of ASCII strings and raw byte values. */
const bytesOf = (...parts: Array<string | number>) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "number" ? [part] : [...part].map((ch) => ch.charCodeAt(0)))));
const fileOf = (bytes: Uint8Array, name = "feed.csv") => new File([bytes as BlobPart], name, { type: "text/csv" });

describe("decodeSupplierBytes (encodings and BOMs)", () => {
  it("reads plain UTF-8, including multi-byte letters", () => {
    expect(decodeSupplierBytes(utf8("title\nČokoláda Kč 5€\n"))).toMatchObject({ text: "title\nČokoláda Kč 5€\n", encoding: "utf-8" });
  });

  it("drops a UTF-8 byte-order mark", () => {
    const { text, encoding } = decodeSupplierBytes(bytesOf(0xef, 0xbb, 0xbf, "id,title\n1,A\n"));
    expect(encoding).toBe("utf-8");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.startsWith("id,title")).toBe(true);
  });

  it("falls back to windows-1252 when the bytes are not valid UTF-8", () => {
    // "Café Crème 5€" saved by Excel as windows-1252: é=E9, è=E8, €=80
    const { text, encoding } = decodeSupplierBytes(bytesOf("Caf", 0xe9, " Cr", 0xe8, "me 5", 0x80));
    expect(encoding).toBe("windows-1252");
    expect(text).toBe("Café Crème 5€");
  });

  it("does not mistake legitimate UTF-8 for windows-1252 (the old U+FFFD check could)", () => {
    // A real U+FFFD in an otherwise valid UTF-8 file must stay UTF-8.
    expect(decodeSupplierBytes(utf8("title\nBroken � char\n")).encoding).toBe("utf-8");
  });

  it("reads UTF-16 LE and BE files (Excel 'Unicode text')", () => {
    const le = new Uint8Array([0xff, 0xfe, ...[..."id\tname\n1\tČaj\n"].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    const be = new Uint8Array([0xfe, 0xff, ...[..."id\tname\n1\tČaj\n"].flatMap((ch) => [ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff])]);
    expect(decodeSupplierBytes(le)).toMatchObject({ text: "id\tname\n1\tČaj\n", encoding: "utf-16le" });
    expect(decodeSupplierBytes(be)).toMatchObject({ text: "id\tname\n1\tČaj\n", encoding: "utf-16be" });
  });
});

describe("parseSupplierFile (bytes in, rows out)", () => {
  it("parses a windows-1252 file end to end, reports the encoding, and says it was not sure (three accents are little to go on)", async () => {
    const file = fileOf(bytesOf("id,title,price\n1,Caf", 0xe9, " Cr", 0xe8, "me,5", 0x80, "\n"));
    const { rows, warnings, encoding } = await parseSupplierFile(file);
    expect(rows[0].title).toBe("Café Crème");
    expect(rows[0].price).toBe("5€");
    expect(encoding).toMatchObject({ encoding: "windows-1252", auto: true, confidence: "uncertain" });
    expect(warnings[0]).toMatch(/Windows-1252/);
  });

  it("a clearly legacy file needs no warning: the detected encoding is shown next to the preview instead", async () => {
    const text = "id,title,description\n1,Dámské boty,příjemný materiál pro každodenní nošení\n2,Žlutý svetr,ručně šitý z ovčí vlny\n3,Čepice,zimní úsporná velikost šedá\n";
    // windows-1250 bytes for the text above, produced without any help from the code under test
    const table: Record<string, number> = { "á": 0xe1, "é": 0xe9, "í": 0xed, "ý": 0xfd, "č": 0xe8, "ě": 0xec, "ř": 0xf8, "š": 0x9a, "ž": 0x9e, "ů": 0xf9, "Ž": 0x8e, "Č": 0xc8, "ú": 0xfa, "ň": 0xf2, "ó": 0xf3 };
    const bytes = Uint8Array.from([...text].map((ch) => table[ch] ?? ch.charCodeAt(0)));
    const { rows, warnings, encoding } = await parseSupplierFile(fileOf(bytes));
    expect(encoding).toMatchObject({ encoding: "windows-1250", confidence: "likely", auto: true });
    expect(rows.map((row) => row.title)).toEqual(["Dámské boty", "Žlutý svetr", "Čepice"]);
    expect(rows[0].description).toBe("příjemný materiál pro každodenní nošení");
    expect(warnings.filter((warning) => /encoding|not valid in|converted/.test(warning))).toEqual([]);
  });

  it("an encoding chosen by the user re-parses the same bytes with it", async () => {
    const bytes = bytesOf("id,title\n1,Caf", 0xe9, " ", 0xe8, "\n");
    const as1252 = await parseSupplierFile(fileOf(bytes), "windows-1252");
    const as1251 = await parseSupplierFile(fileOf(bytes), "windows-1251");
    expect(as1252.rows[0].title).toBe("Café è");
    expect(as1251.rows[0].title).toBe("Cafй и");
    expect(as1252.encoding).toMatchObject({ encoding: "windows-1252", auto: false });
    expect(as1251.encoding).toMatchObject({ encoding: "windows-1251", auto: false });
  });

  it("warns when bytes are not valid in the chosen UTF-8, and when text was converted twice", async () => {
    const broken = await parseSupplierFile(fileOf(bytesOf("id,title\n1,Caf", 0xe9, "\n")), "utf-8");
    expect(broken.warnings.join(" ")).toMatch(/not valid in UTF-8/);
    const twice = await parseSupplierFile(fileOf(utf8("id,title\n1,Caf\u00c3\u00a9 cr\u00c3\u00a8me na\u00c3\u00afve \u00c5\u00a1kola\n")));
    expect(twice.warnings.join(" ")).toMatch(/converted to UTF-8 twice/);
  });

  it("parses a UTF-8 file with a BOM: the first header is not corrupted", async () => {
    const { rows, warnings } = await parseSupplierFile(fileOf(bytesOf(0xef, 0xbb, 0xbf, "id,title\r\n1,Mug\r\n2,Cup\r\n")));
    expect(rows.map((row) => [row.id, row.title])).toEqual([["1", "Mug"], ["2", "Cup"]]);
    expect(warnings.some((warning) => /windows-1252/.test(warning))).toBe(false);
  });

  it("also strips a BOM that survives into text (parseSupplierText)", () => {
    const { rows } = parseSupplierText("﻿id,title\n1,Mug\n");
    expect(rows[0]).toMatchObject({ id: "1", title: "Mug" });
  });
});

describe("delimiters", () => {
  it("parses semicolon-separated files and keeps decimal commas intact", () => {
    const { rows } = parseSupplierText("id;title;price;sku\n1;Mug;29,50;M-1\n2;Cup;1 299,00;C-1\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Mug", price: "29,50", sku: "M-1" });
    expect(rows[1].price).toBe("1 299,00");
  });

  it("parses tab-separated files", () => {
    const { rows } = parseSupplierText("id\ttitle\tprice\n1\tBlue Mug\t10\n2\tRed Mug\t12\n");
    expect(rows.map((row) => row.title)).toEqual(["Blue Mug", "Red Mug"]);
  });

  it("parses comma-separated files with quoted commas and quoted line breaks", () => {
    const { rows } = parseSupplierText('id,title,description\n1,"Mug, large","Line one\nLine two"\n');
    expect(rows[0].title).toBe("Mug, large");
    expect(rows[0].description).toBe("Line one\nLine two");
  });

  it("never treats the pipe image separator as a column delimiter", () => {
    const { rows } = parseSupplierText("title,images\nMug,a.jpg|b.jpg\nCup,c.jpg|d.jpg\n");
    expect(rows[0].images).toBe("a.jpg|b.jpg");
  });

  it("ignores blank, whitespace-only and delimiter-only lines", () => {
    const { rows } = parseSupplierText("id,title\n1,Mug\n\n   \n,\n2,Cup\n");
    expect(rows.map((row) => row.title)).toEqual(["Mug", "Cup"]);
  });
});

describe("broken quotes", () => {
  const FILE = 'id,title,description\n1,Good,ok\n2,"Broken title,desc\n3,Next,fine\n4,Last,fine\n';

  it("repairs an unterminated quote instead of swallowing the rest of the file", () => {
    const { rows, warnings } = parseSupplierText(FILE);
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3", "4"]);
    expect(rows[1].title).toBe("Broken title");
    expect(rows[2]).toMatchObject({ title: "Next", description: "fine" });
    expect(warnings.join(" ")).toMatch(/never closed/);
    expect(warnings.join(" ")).toMatch(/row 2/);
  });

  it("keeps a bare inch mark inside an unquoted cell as text, with no warning", () => {
    const { rows, warnings } = parseSupplierText('id,title\n1,5" TALL VASE\n2,Cup\n');
    expect(rows[0].title).toBe('5" TALL VASE');
    expect(warnings.filter((warning) => /quote/i.test(warning))).toEqual([]);
  });

  it("keeps text with a misplaced quote and reports it", () => {
    const { rows, warnings } = parseSupplierText('id,title,description\n1,"Say "hello" now",ok\n2,Cup,fine\n');
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe("Cup");
    expect(warnings.join(" ")).toMatch(/misplaced quote/);
  });

  it("repairs several broken rows and says how many", () => {
    const text = 'id,title\n1,"a\n2,"b\n3,"c\n4,ok\n';
    const { rows, warnings } = parseSupplierText(text);
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3", "4"]);
    expect(warnings.join(" ")).toMatch(/3 quotes/);
  });

  it("gives up cleanly (and warns loudly) when the quotes are beyond repair", () => {
    const lines = ["id,title"];
    for (let i = 1; i <= 8; i++) lines.push(`${i},"broken ${i}`);
    const { warnings } = parseSupplierText(lines.join("\n") + "\n");
    expect(warnings.join(" ")).toMatch(/still has an unclosed quote/);
  });
});

describe("header mapping and fatal problems", () => {
  it("maps common supplier header names, ignoring case, spaces and punctuation", () => {
    const { rows } = parseSupplierText(" PRODUCT_NAME , Body-HTML ,IMAGE SRC,Retail Price,Item Code\nMug,<p>x</p>,u.jpg,9.99,M-1\n");
    expect(rows[0]).toMatchObject({ title: "Mug", description: "<p>x</p>", images: "u.jpg", price: "9.99", sku: "M-1" });
  });

  it("keeps a supplier handle column for variant grouping", () => {
    expect(parseSupplierText("handle,title\nmug,Mug\n").rows[0].handle).toBe("mug");
  });

  it("rejects files with no title column, no rows, or nothing at all", () => {
    expect(() => parseSupplierText("foo,bar\n1,2\n")).toThrow(/No product title column/);
    expect(() => parseSupplierText("title,price\n")).toThrow(/no product rows/);
    expect(() => parseSupplierText("   \n\n  ")).toThrow();
  });

  it("warns about rows that are wider than the header", () => {
    const { warnings } = parseSupplierText("title,price\nA,1\nB,2,oops,more\n");
    expect(warnings.join(" ")).toMatch(/1 row has more columns/);
  });
});

describe("5,000+ rows", () => {
  const ROWS = 6000;
  const build = () => {
    const lines = ["id,title,description,images,price,sku,handle"];
    for (let i = 1; i <= ROWS; i++) {
      // every 10th description spans two lines inside quotes; titles repeat every 500 rows to stress handle uniqueness
      const description = i % 10 === 0 ? `"Line one ${i}\nLine two ${i}"` : `<div>Desc ${i}</div>`;
      lines.push(`${i},WIDGET ${i % 500},${description},https://cdn.example.com/${i}-a.jpg|https://cdn.example.com/${i}-b.jpg,$${i}.50,SKU-${i},`);
    }
    return lines.join("\r\n") + "\r\n";
  };

  it("parses every row, in order, without losing multi-line cells", async () => {
    const started = performance.now();
    const { rows } = await parseSupplierFile(fileOf(utf8(build())));
    expect(rows).toHaveLength(ROWS);
    expect(rows[ROWS - 1]).toMatchObject({ id: String(ROWS), sku: `SKU-${ROWS}` });
    expect(rows[9].description).toBe("Line one 10\nLine two 10");
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("cleans them all with unique handles in a reasonable time", async () => {
    const { rows } = await parseSupplierFile(fileOf(utf8(build())));
    const started = performance.now();
    const { rows: cleaned, report } = sanitizeDataset(rows);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(report.sourceRows).toBe(ROWS);
    const handles = cleaned.filter((row) => row.Title !== "").map((row) => row.Handle);
    expect(handles).toHaveLength(ROWS);
    expect(new Set(handles).size).toBe(ROWS);
    expect(report.extraImageRows).toBe(ROWS);
  });
});
