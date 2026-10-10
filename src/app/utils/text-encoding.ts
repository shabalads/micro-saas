// src/app/utils/text-encoding.ts
//
// Turns the raw bytes of an upload into text, and says how sure it is about the encoding. Pure functions, no browser or
// Node APIs beyond TextDecoder for UTF-8/UTF-16, so the result is the same everywhere and easy to test.
//
// How the encoding is chosen (decodeAuto):
//   1. A byte-order mark decides (UTF-8, UTF-16 LE/BE). UTF-16 without a mark shows up as every second byte being 0.
//   2. Pure ASCII, or strictly valid UTF-8: UTF-8. Real legacy text almost never happens to be valid UTF-8.
//   3. Mostly valid UTF-8 with a few broken bytes (a truncated or pasted-in character): still UTF-8, the bad bytes become
//      U+FFFD and the caller is told how many.
//   4. Otherwise it is a legacy single-byte file. Each candidate (windows-1252, windows-1250, windows-1251, ISO-8859-15,
//      ISO-8859-2) is scored by how plausible the letters it produces are, see scoreCandidate. The scoring works on a
//      histogram of the high bytes, so it is cheap for a 25 MB file and uses all of it.
//
// No language is special-cased in the code: the evidence is a table of alphabets (ALPHABETS) that can be extended by
// adding a line. Detection is a judgement call for short files, so the result carries a confidence and the other
// plausible encodings, and the UI lets the user override it.

import { SINGLE_BYTE_ENCODINGS, SINGLE_BYTE_TABLES, type SingleByteEncoding } from "./single-byte-tables";

export type SupplierEncoding = "utf-8" | "utf-16le" | "utf-16be" | SingleByteEncoding;

export const ENCODING_LABELS: Record<SupplierEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252 (Western European)",
  "windows-1250": "Windows-1250 (Central European)",
  "windows-1251": "Windows-1251 (Cyrillic)",
  "iso-8859-15": "ISO-8859-15 (Western European, with euro)",
  "iso-8859-2": "ISO-8859-2 (Central European)",
};

/** What the override dropdown offers, most common first. */
export const SELECTABLE_ENCODINGS: readonly SupplierEncoding[] = [
  "utf-8",
  "windows-1252",
  "windows-1250",
  "windows-1251",
  "iso-8859-2",
  "iso-8859-15",
  "utf-16le",
  "utf-16be",
];

export function isSupplierEncoding(value: unknown): value is SupplierEncoding {
  return typeof value === "string" && value in ENCODING_LABELS;
}

export type Confidence = "certain" | "likely" | "uncertain";

export interface DecodedText {
  text: string;
  encoding: SupplierEncoding;
  /** True when the encoding was detected, false when the caller chose it. */
  auto: boolean;
  confidence: Confidence;
  /** One short phrase saying why, for the UI. */
  why: string;
  /** Other encodings that would be plausible AND read differently. Empty when the choice is clear. */
  alternatives: SupplierEncoding[];
  /** UTF-8 only: bytes that were not valid and became U+FFFD. */
  invalidSequences: number;
  /** The decoded text still contains typical "text converted twice" patterns such as "Ã©" for "é". */
  mojibake: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Decoding                                                                   */
/* -------------------------------------------------------------------------- */

const CHUNK = 0x4000;

function decodeSingleByte(bytes: Uint8Array, encoding: SingleByteEncoding): string {
  const table = SINGLE_BYTE_TABLES[encoding];
  const pieces: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const codes = new Array<number>(end - start);
    for (let i = start; i < end; i++) {
      const byte = bytes[i];
      codes[i - start] = byte < 0x80 ? byte : table.charCodeAt(byte - 0x80);
    }
    pieces.push(String.fromCharCode(...codes));
  }
  return pieces.join("");
}

/** Decodes with a specific encoding. UTF-8 and UTF-16 drop a leading byte-order mark; invalid UTF-8 becomes U+FFFD. */
export function decodeBytes(bytes: Uint8Array, encoding: SupplierEncoding): string {
  if (encoding === "utf-8" || encoding === "utf-16le" || encoding === "utf-16be") return new TextDecoder(encoding).decode(bytes);
  return decodeSingleByte(bytes, encoding);
}

/* -------------------------------------------------------------------------- */
/*  Evidence                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The non-ASCII letters of the alphabets a supplier file may be written in, lower case. A decoded text whose letters
 * all belong to ONE of these alphabets is very probably decoded correctly; the same bytes read with the wrong code page
 * produce a mixture that fits no language (Czech read as windows-1252 gives ì è ø ù ï ò, which is no language at all).
 */
const ALPHABETS: readonly string[] = [
  // Latin script
  "áčďéěíňóřšťúůýž", // Czech
  "áäčďéíĺľňóôŕšťúýž", // Slovak
  "ąćęłńóśźż", // Polish
  "áéíóöőúüű", // Hungarian
  "ăâîșțşţ", // Romanian
  "čćđšž", // Croatian, Slovene, Bosnian
  "äöüß", // German
  "àâæçéèêëîïôœùûüÿ", // French
  "áéíñóúü", // Spanish
  "àáâãçéêíóôõúü", // Portuguese
  "àèéìíîòóùú", // Italian
  "áàäçéèêëíïóòöúü", // Dutch, Catalan
  "æøåéèóö", // Danish
  "æøåéèêóòôü", // Norwegian
  "åäöé", // Swedish
  "äöåšž", // Finnish
  "áðéíóúýþæö", // Icelandic
  "äöüõšž", // Estonian
  // Cyrillic script
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя", // Russian
  "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя", // Ukrainian
  "абвгдежзийклмнопрстуфхцчшщъьюя", // Bulgarian
  "абвгдђежзијклљмнњопрстћуфхцчџш", // Serbian
  "абвгдѓежзѕијклљмнњопрстќуфхцчџш", // Macedonian
  "абвгдеёжзійклмнопрстуўфхцчшыьэюя", // Belarusian
];
const ALPHABET_SETS: ReadonlyArray<ReadonlySet<string>> = ALPHABETS.map((letters) => new Set(letters));

/** Non-letters that turn up in real product text. Anything else outside ASCII is an "odd symbol" (¤ ¦ ¨ ¸ ˇ ˘ ...). */
const PLAUSIBLE_SYMBOLS = new Set(
  " ¡¢£¥§©«­®°±²³µ·»¼½¾¿×÷" +
    "–—‘’‚“”„•…‹›€№™",
);

const LETTER = /\p{L}/u;

/** What code page misreads of UTF-8 look like: the lead byte as a letter, then a continuation byte as punctuation. */
const CONTINUATION =
  "[\\u0080-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192\\u02c6\\u02dc\\u2013\\u2014\\u2018\\u2019\\u201a\\u201c\\u201d\\u201e\\u2020\\u2021\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122]";
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00c5\\u00d0\\u00d1\\u00e2]${CONTINUATION}`, "g");

/**
 * A Latin letter touching a Cyrillic one inside a word ("Sьпe"). Real Cyrillic text keeps a word in one script, so this
 * is what Latin text looks like when it is read as windows-1251, and the reason that reading can never win on letters alone.
 */
const MIXED_SCRIPT = /[A-Za-z][\u0400-\u04ff]|[\u0400-\u04ff][A-Za-z]/g;

/** How much of the text is looked at for mojibake patterns (the byte histogram covers the whole file). */
const PATTERN_SAMPLE_BYTES = 256 * 1024;

export function countMojibake(text: string): number {
  return (text.match(MOJIBAKE) ?? []).length;
}

interface CandidateScore {
  encoding: SingleByteEncoding;
  score: number;
  /** What the high bytes present in the file turn into. Equal signatures read identically. */
  signature: string;
}

/**
 * How plausible the text is that `encoding` produces for these bytes, from -∞ to 1:
 *   + the share of high bytes that become a letter of one single alphabet, or a symbol real text uses;
 *   - 8 x the share that become C1 control characters (an unassigned byte, or text saved by a program that uses
 *       ISO-8859 and never wrote a smart quote: windows code pages use 0x80-0x9F for punctuation);
 *   - 4 x the share that become odd symbols (¤ ¦ ¨ ¸ ˇ ...: real text hardly ever contains them);
 *   - 3 x the share of "text read with the wrong code page" patterns in the decoded sample: UTF-8 read as a code page
 *       ("Ã©"), and Latin letters glued to Cyrillic ones.
 */
function scoreCandidate(encoding: SingleByteEncoding, histogram: Uint32Array, sample: Uint8Array): CandidateScore {
  const table = SINGLE_BYTE_TABLES[encoding];
  const covered = new Array<number>(ALPHABET_SETS.length).fill(0);
  let total = 0;
  let controls = 0;
  let odd = 0;
  let symbols = 0;
  let signature = "";

  for (let byte = 0x80; byte < 0x100; byte++) {
    const count = histogram[byte];
    if (count === 0) continue;
    const char = table[byte - 0x80];
    const code = char.charCodeAt(0);
    total += count;
    signature += char;

    if (code >= 0x80 && code <= 0x9f) controls += count;
    else if (PLAUSIBLE_SYMBOLS.has(char)) symbols += count;
    else if (LETTER.test(char)) {
      const lower = char.toLowerCase();
      for (let i = 0; i < ALPHABET_SETS.length; i++) if (ALPHABET_SETS[i].has(lower)) covered[i] += count;
    } else odd += count;
  }
  if (total === 0) return { encoding, score: 0, signature };

  const coverage = (Math.max(...covered) + symbols) / total;
  const sampleHigh = sample.reduce((n, byte) => n + (byte >= 0x80 ? 1 : 0), 0);
  let wrongReading = 0;
  if (sampleHigh > 0) {
    const decoded = decodeSingleByte(sample, encoding);
    wrongReading = Math.min(1, (2 * (countMojibake(decoded) + (decoded.match(MIXED_SCRIPT) ?? []).length)) / sampleHigh);
  }
  return { encoding, score: coverage - 8 * (controls / total) - 4 * (odd / total) - 3 * wrongReading, signature };
}

/* -------------------------------------------------------------------------- */
/*  Detection                                                                  */
/* -------------------------------------------------------------------------- */

/** On a (near) tie the earlier one wins: the Windows code pages are what Excel writes. */
const PRIORITY: readonly SingleByteEncoding[] = SINGLE_BYTE_ENCODINGS;
const TIE = 0.01;
/** Another encoding within this much of the best one is reported as an alternative. */
const ALTERNATIVE_MARGIN = 0.15;
/** Fewer high bytes than this is too little evidence to be sure of anything. */
const MIN_EVIDENCE = 4;
/** A UTF-8 file with a few broken bytes is still UTF-8 if at least this share of its non-ASCII sequences are valid. */
const UTF8_VALID_SHARE = 0.8;

function result(partial: Partial<DecodedText> & Pick<DecodedText, "text" | "encoding" | "why">): DecodedText {
  return { auto: true, confidence: "certain", alternatives: [], invalidSequences: 0, mojibake: countMojibake(partial.text.slice(0, PATTERN_SAMPLE_BYTES)) >= 2, ...partial };
}

/** UTF-16 without a byte-order mark: ASCII text has a 0 byte in every second position. */
function sniffUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const length = Math.min(bytes.length, 4096) & ~1;
  if (length < 8) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < length; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  const pairs = length / 2;
  if (oddZeros >= pairs * 0.3 && evenZeros <= pairs * 0.02) return "utf-16le";
  if (evenZeros >= pairs * 0.3 && oddZeros <= pairs * 0.02) return "utf-16be";
  return null;
}

export function decodeAuto(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return result({ text: decodeBytes(bytes, "utf-8"), encoding: "utf-8", why: "it starts with a UTF-8 byte-order mark" });
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return result({ text: decodeBytes(bytes, "utf-16le"), encoding: "utf-16le", why: "it starts with a UTF-16 byte-order mark" });
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return result({ text: decodeBytes(bytes, "utf-16be"), encoding: "utf-16be", why: "it starts with a UTF-16 byte-order mark" });
  const wide = sniffUtf16(bytes);
  if (wide) return result({ text: decodeBytes(bytes, wide), encoding: wide, confidence: "likely", why: "every second byte is empty, which is how UTF-16 stores plain text" });

  const histogram = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) histogram[bytes[i]]++;
  let highBytes = 0;
  for (let byte = 0x80; byte < 0x100; byte++) highBytes += histogram[byte];
  if (highBytes === 0) return result({ text: decodeBytes(bytes, "utf-8"), encoding: "utf-8", why: "it is plain ASCII, which reads the same in every encoding" });

  try {
    return result({ text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", why: "it is valid UTF-8, which legacy text almost never is by chance" });
  } catch {
    /* not valid UTF-8: broken UTF-8, or a legacy file */
  }

  const lenient = new TextDecoder("utf-8").decode(bytes);
  let replaced = 0;
  let valid = 0;
  for (let i = 0; i < lenient.length; i++) {
    const code = lenient.charCodeAt(i);
    if (code === 0xfffd) replaced++;
    else if (code >= 0x80) valid++;
  }
  if (valid > 0 && valid / (valid + replaced) >= UTF8_VALID_SHARE) {
    return result({ text: lenient, encoding: "utf-8", confidence: "likely", why: "it is UTF-8 apart from a few broken bytes", invalidSequences: replaced });
  }

  const sample = bytes.subarray(0, PATTERN_SAMPLE_BYTES);
  const scored = PRIORITY.map((encoding) => scoreCandidate(encoding, histogram, sample)).sort((a, b) => (Math.abs(b.score - a.score) < TIE ? PRIORITY.indexOf(a.encoding) - PRIORITY.indexOf(b.encoding) : b.score - a.score));
  const best = scored[0];
  const alternatives = scored
    .slice(1)
    .filter((other) => other.signature !== best.signature && other.score >= best.score - ALTERNATIVE_MARGIN)
    .map((other) => other.encoding);

  const confidence: Confidence = highBytes < MIN_EVIDENCE || alternatives.length > 0 || best.score < 0.7 ? "uncertain" : "likely";
  return result({
    text: decodeBytes(bytes, best.encoding),
    encoding: best.encoding,
    confidence,
    why: highBytes < MIN_EVIDENCE ? "there are too few accented characters to be sure" : "its letters fit this encoding best",
    alternatives,
  });
}

/** Decodes with the encoding the user picked. */
export function decodeAs(bytes: Uint8Array, encoding: SupplierEncoding): DecodedText {
  const text = decodeBytes(bytes, encoding);
  let replaced = 0;
  if (encoding === "utf-8") for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) replaced++;
  return result({ text, encoding, auto: false, why: "you chose it", invalidSequences: replaced });
}

/** The one entry point: detect when `forced` is absent or "auto", otherwise use the chosen encoding. */
export function decodeText(bytes: Uint8Array, forced?: SupplierEncoding | "auto"): DecodedText {
  return forced && forced !== "auto" ? decodeAs(bytes, forced) : decodeAuto(bytes);
}
