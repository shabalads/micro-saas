import { describe, expect, it } from "vitest";
import { SINGLE_BYTE_ENCODINGS, SINGLE_BYTE_TABLES } from "./single-byte-tables";

describe("single-byte decode tables", () => {
  it.each(SINGLE_BYTE_ENCODINGS)("%s has exactly one character for each byte 0x80-0xFF", (encoding) => {
    const table = SINGLE_BYTE_TABLES[encoding];
    expect(table).toHaveLength(128);
    // none maps to a replacement character or to something outside the BMP
    expect([...table].every((char) => char.codePointAt(0)! > 0 && char.codePointAt(0)! !== 0xfffd && char.codePointAt(0)! < 0x10000)).toBe(true);
  });

  // The runtime's TextDecoder is right for these four, so it is an independent check of every entry in them.
  it.each(["windows-1250", "windows-1251", "iso-8859-2", "iso-8859-15"] as const)("%s agrees with TextDecoder for all 128 bytes", (encoding) => {
    const decoder = new TextDecoder(encoding);
    for (let byte = 0x80; byte < 0x100; byte++) {
      expect(SINGLE_BYTE_TABLES[encoding][byte - 0x80], `${encoding} 0x${byte.toString(16)}`).toBe(decoder.decode(new Uint8Array([byte])));
    }
  });

  it("windows-1252 is the real thing even where Node's TextDecoder is not (euro sign, smart quotes, Y with diaeresis)", () => {
    const table = SINGLE_BYTE_TABLES["windows-1252"];
    expect(table[0x80 - 0x80]).toBe("€");
    expect(table[0x93 - 0x80]).toBe("“");
    expect(table[0x94 - 0x80]).toBe("”");
    expect(table[0x96 - 0x80]).toBe("–");
    expect(table[0x9f - 0x80]).toBe("Ÿ");
    expect(table[0xe9 - 0x80]).toBe("é");
    // the five bytes Microsoft left unassigned stay C1 controls (WHATWG), which the detector treats as evidence against it
    for (const byte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(table.charCodeAt(byte - 0x80)).toBe(byte);
  });

  it("iso-8859-15 differs from Latin-1 in exactly the eight places it should", () => {
    const table = SINGLE_BYTE_TABLES["iso-8859-15"];
    const changed = [...table].map((char, index) => (char.charCodeAt(0) !== index + 0x80 ? 0x80 + index : -1)).filter((byte) => byte !== -1);
    expect(changed).toEqual([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
    expect(table[0xa4 - 0x80]).toBe("€");
  });

  it("windows-1250 and windows-1251 hold the letters they exist for", () => {
    expect(SINGLE_BYTE_TABLES["windows-1250"][0xf8 - 0x80]).toBe("ř"); // ř
    expect(SINGLE_BYTE_TABLES["windows-1250"][0x9a - 0x80]).toBe("š"); // š
    expect(SINGLE_BYTE_TABLES["windows-1251"][0xe0 - 0x80]).toBe("а"); // а
    expect(SINGLE_BYTE_TABLES["windows-1251"][0xff - 0x80]).toBe("я"); // я
  });
});
