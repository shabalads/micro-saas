import { describe, expect, it } from "vitest";
import { ENCODING_FIXTURES, fixtureBytes } from "../../test/encoding-fixtures";
import { ENCODING_LABELS, SELECTABLE_ENCODINGS, countMojibake, decodeAs, decodeAuto, decodeBytes, decodeText, isSupplierEncoding } from "./text-encoding";

const utf8 = (text: string) => new TextEncoder().encode(text);
const bytes = (...values: number[]) => new Uint8Array(values);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/** Fixtures whose bytes read identically in two encodings (all the accented letters they use sit in the same places). */
const EQUIVALENT: Record<string, string> = { "hu as iso-8859-2": "windows-1250", "pt as iso-8859-15": "windows-1252" };

describe("legacy single-byte files, saved by an independent encoder", () => {
  it.each(ENCODING_FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s: the text comes back exactly", (_name, fixture) => {
    const decoded = decodeAuto(fixtureBytes(fixture));
    expect(decoded.text).toBe(fixture.text);
    expect(decoded.encoding).toBe(EQUIVALENT[fixture.name] ?? fixture.encoding);
    expect(decoded.auto).toBe(true);
    expect(decoded.invalidSequences).toBe(0);
    expect(decoded.mojibake).toBe(false);
  });

  it("is confident about the clear cases, and says why", () => {
    for (const name of ["cs as windows-1250", "pl as iso-8859-2", "ru as windows-1251", "de as iso-8859-15", "fr as windows-1252"]) {
      const fixture = ENCODING_FIXTURES.find((entry) => entry.name === name)!;
      const decoded = decodeAuto(fixtureBytes(fixture));
      expect(decoded.confidence, name).toBe("likely");
      expect(decoded.alternatives, name).toEqual([]);
      expect(decoded.why).toMatch(/letters fit/);
    }
  });

  it("does not mistake Latin text for Cyrillic or the reverse, whatever the code page", () => {
    for (const fixture of ENCODING_FIXTURES) {
      const decoded = decodeAuto(fixtureBytes(fixture));
      expect(decoded.encoding === "windows-1251", fixture.name).toBe(fixture.encoding === "windows-1251");
    }
  });

  it("tells a euro written as 0x80 (windows-1252) from one written as 0xA4 (ISO-8859-15)", () => {
    const row = (euro: number) => concat(utf8("Preis: 12,50 "), bytes(euro), utf8(" f"), bytes(0xfc), utf8("r Gr"), bytes(0xf6, 0xdf), utf8("e M"), bytes(0xe4, 0xe4), utf8("dchen"));
    expect(decodeAuto(row(0x80))).toMatchObject({ encoding: "windows-1252" });
    expect(decodeAuto(row(0x80)).text).toContain("12,50 €");
    expect(decodeAuto(row(0xa4))).toMatchObject({ encoding: "iso-8859-15" });
    expect(decodeAuto(row(0xa4)).text).toContain("12,50 €");
  });

  it("uses smart quotes and dashes (0x80-0x9F) as proof of a Windows code page rather than ISO-8859", () => {
    const text = concat(utf8("Women"), bytes(0x92), utf8("s "), bytes(0x93), utf8("classic"), bytes(0x94), utf8(" caf"), bytes(0xe9, 0x96), utf8(" na"), bytes(0xef), utf8("ve"));
    const decoded = decodeAuto(text);
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.text).toBe("Women’s “classic” café– naïve");
  });

  it("with very little to go on it says so, and names the other readings instead of pretending", () => {
    // "Kč" in windows-1250 is the single byte 0xE8: it is "è" in windows-1252 and "и" in windows-1251
    const decoded = decodeAuto(concat(utf8("Cena 100 K"), bytes(0xe8)));
    expect(decoded.confidence).toBe("uncertain");
    expect(decoded.why).toMatch(/too few/);
    expect(decoded.alternatives.length).toBeGreaterThan(0);
  });
});

describe("everything that is not a legacy single-byte file", () => {
  it("plain ASCII is UTF-8 with full confidence", () => {
    expect(decodeAuto(utf8("id,title\n1,Shirt"))).toMatchObject({ encoding: "utf-8", confidence: "certain", text: "id,title\n1,Shirt", alternatives: [] });
  });

  it("valid UTF-8 with accents is UTF-8 with full confidence", () => {
    expect(decodeAuto(utf8("Žlutý kůň, 9,99 €, 日本語"))).toMatchObject({ encoding: "utf-8", confidence: "certain", text: "Žlutý kůň, 9,99 €, 日本語" });
  });

  it("byte-order marks decide, and are removed", () => {
    expect(decodeAuto(concat(bytes(0xef, 0xbb, 0xbf), utf8("Café")))).toMatchObject({ encoding: "utf-8", text: "Café", confidence: "certain" });
    const le = concat(bytes(0xff, 0xfe), ...[..."Café"].map((char) => bytes(char.charCodeAt(0) & 255, char.charCodeAt(0) >> 8)));
    expect(decodeAuto(le)).toMatchObject({ encoding: "utf-16le", text: "Café", confidence: "certain" });
    const be = concat(bytes(0xfe, 0xff), ...[..."Café"].map((char) => bytes(char.charCodeAt(0) >> 8, char.charCodeAt(0) & 255)));
    expect(decodeAuto(be)).toMatchObject({ encoding: "utf-16be", text: "Café", confidence: "certain" });
  });

  it("recognises UTF-16 without a byte-order mark by its empty bytes", () => {
    const text = "id,title,price\n1,Žlutý svetr,12.50\n2,Zimní čepice,8.00\n";
    const le = concat(...[...text].map((char) => bytes(char.charCodeAt(0) & 255, char.charCodeAt(0) >> 8)));
    const be = concat(...[...text].map((char) => bytes(char.charCodeAt(0) >> 8, char.charCodeAt(0) & 255)));
    expect(decodeAuto(le)).toMatchObject({ encoding: "utf-16le", text, confidence: "likely" });
    expect(decodeAuto(be)).toMatchObject({ encoding: "utf-16be", text, confidence: "likely" });
  });

  it("UTF-8 with a few broken bytes stays UTF-8: the bad bytes become U+FFFD and are counted, nothing else is mangled", () => {
    const damaged = concat(utf8("Žlutý svetr, černé boty, příliš žluťoučký kůň, "), bytes(0xe9), utf8(" konec"));
    const decoded = decodeAuto(damaged);
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.invalidSequences).toBe(1);
    expect(decoded.text).toBe("Žlutý svetr, černé boty, příliš žluťoučký kůň, � konec");
    expect(decoded.confidence).toBe("likely");
  });

  it("flags text that was converted twice (UTF-8 read as windows-1252 and saved again as UTF-8)", () => {
    const doubled = utf8("CafÃ© crÃ¨me, naÃ¯ve, Å¡kola, Ä\u008d aj, â€™s");
    const decoded = decodeAuto(doubled);
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.mojibake).toBe(true);
    expect(countMojibake("Café crème naïve Žlutý")).toBe(0);
  });

  it("does not crash on empty input or on binary noise, and always returns text", () => {
    expect(decodeAuto(new Uint8Array(0))).toMatchObject({ text: "", encoding: "utf-8" });
    const noise = Uint8Array.from({ length: 5000 }, (_, i) => (i * 131 + 17) % 256);
    expect(typeof decodeAuto(noise).text).toBe("string");
  });

  it("is deterministic", () => {
    const fixture = ENCODING_FIXTURES[0];
    expect(decodeAuto(fixtureBytes(fixture))).toEqual(decodeAuto(fixtureBytes(fixture)));
  });

  it("handles a 25 MB file quickly: scoring reads a histogram, not the whole text", () => {
    const row = concat(utf8("1,Dámské boty "), bytes(0xe8, 0xe9, 0xf8), utf8(",12.50\n"));
    const big = new Uint8Array(25 * 1024 * 1024);
    for (let offset = 0; offset + row.length <= big.length; offset += row.length) big.set(row, offset);
    const started = performance.now();
    const decoded = decodeAuto(big);
    expect(decoded.text.length).toBeGreaterThan(20_000_000);
    expect(performance.now() - started).toBeLessThan(6000);
  });
});

describe("choosing the encoding yourself", () => {
  const czech1250 = () => fixtureBytes(ENCODING_FIXTURES.find((entry) => entry.name === "cs as windows-1250")!);

  it("decodes exactly as asked, even when the detector would have said something else", () => {
    const forced = decodeAs(czech1250(), "windows-1252");
    expect(forced).toMatchObject({ encoding: "windows-1252", auto: false, confidence: "certain", why: "you chose it" });
    expect(forced.text).toContain("pøíjemný"); // ø where ř should be: the user asked for it
    expect(decodeText(czech1250(), "windows-1250").text).toBe(ENCODING_FIXTURES.find((entry) => entry.name === "cs as windows-1250")!.text);
  });

  it("'auto' (or nothing) means detect", () => {
    expect(decodeText(czech1250(), "auto").auto).toBe(true);
    expect(decodeText(czech1250()).encoding).toBe("windows-1250");
  });

  it("every selectable encoding has a label and a decoder", () => {
    for (const encoding of SELECTABLE_ENCODINGS) {
      expect(ENCODING_LABELS[encoding]).toBeTruthy();
      expect(isSupplierEncoding(encoding)).toBe(true);
      expect(typeof decodeBytes(utf8("abc"), encoding === "utf-16le" || encoding === "utf-16be" ? "utf-8" : encoding)).toBe("string");
    }
    expect(isSupplierEncoding("klingon")).toBe(false);
    expect(isSupplierEncoding(undefined)).toBe(false);
  });

  it("UTF-8 chosen by hand on a file that is not UTF-8 reports the damage instead of hiding it", () => {
    const forced = decodeAs(czech1250(), "utf-8");
    expect(forced.invalidSequences).toBeGreaterThan(0);
    expect(forced.text).toContain("�");
  });
});
