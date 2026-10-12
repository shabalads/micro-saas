// src/app/utils/sanitizer.ts

import type {
  CleanedShopifyRow,
  PreviewPair,
  RawSupplierRow,
  SanitizeOptions,
  SanitizeReport,
  SanitizeWarning,
  SkuChange,
  TitleCasing,
  WarningKind,
} from "../types/csv";
import { compactKey } from "./header-match";
import { checkBarcode, cleanTags, currencyCode, currencyInPrice, parseStock, parseWeight, priceFromCost } from "./catalog-fields";
import { isPlaceholderValue } from "./placeholder-values";
import { mergeEquivalentSizes, possibleAbbreviations, unifyCase } from "./option-values";
import { spreadsheetRow } from "./row-numbers";
import { summaryLabel, summaryRowReason } from "./summary-rows";
import { TECH_MIXED, TECH_UPPER } from "./tech-terms";

/* -------------------------------------------------------------------------- */
/*  Low-level helpers                                                          */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00A0"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["hellip", "…"],
  ["bull", "•"],
  ["middot", "·"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
  ["deg", "°"],
  ["euro", "€"],
  ["pound", "£"],
  ["yen", "¥"],
  ["cent", "¢"],
  ["times", "×"],
  ["frac12", "½"],
]);

const ENTITY_RE = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi;

/** Decodes named and numeric HTML entities (two passes catch `&amp;nbsp;` style double encoding). */
export function decodeEntities(input: string): string {
  let current = input;
  for (let pass = 0; pass < 2 && current.indexOf("&") !== -1; pass++) {
    const next = current.replace(ENTITY_RE, (match: string, body: string) => {
      if (body.charAt(0) === "#") {
        const isHex = body.charAt(1).toLowerCase() === "x";
        const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        const isValid =
          Number.isFinite(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff);
        return isValid ? String.fromCodePoint(code) : match;
      }
      const named = NAMED_ENTITIES.get(body.toLowerCase());
      return named !== undefined ? named : match;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Escapes text so it can be embedded safely inside generated HTML. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Removes control characters and zero-width characters, turns every kind of
 * whitespace (tabs, line breaks, non-breaking spaces ...) into a single plain
 * space, collapses runs of spaces and trims both ends.
 */
export function cleanWhitespace(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Suppliers love filling empty cells with "N/A", "null", "-", "popis není k dispozici" ... treat those as empty (the list is in placeholder-values.ts). */
function emptyIfPlaceholder(value: string): string {
  return isPlaceholderValue(value) ? "" : value;
}

function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlphanumeric(ch: string): boolean {
  return isLetter(ch) || isDigit(ch);
}

/* -------------------------------------------------------------------------- */
/*  1. Text normalization (titles)                                             */
/* -------------------------------------------------------------------------- */

const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
  "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with",
]);

/** Acronyms that must stay upper case in a professional title. */
const KEEP_UPPER = new Set([
  "led", "usb", "usa", "uk", "eu", "hd", "uhd", "tv", "pc", "dvd", "cd", "uv",
  "lcd", "gps", "spf", "pvc", "abs", "rgb", "hdmi", "ssd", "hdd", "ram", "rom",
  "cpu", "gpu", "nfc", "diy", "ok", "uhf", "vhf", "pu", "pp", "pe", "eva",
  "rfid", "sim", "lte", "gsm", "tpu", "ac", "dc", "wlan", "ip",
]);

/** Brand and product spellings that do not follow plain Title Case. */
const MIXED_CASE = new Map<string, string>([
  ["iphone", "iPhone"],
  ["ipad", "iPad"],
  ["ipod", "iPod"],
  ["imac", "iMac"],
  ["macbook", "MacBook"],
  ["airpods", "AirPods"],
  ["ios", "iOS"],
  ["wifi", "Wi-Fi"],
  ["playstation", "PlayStation"],
  ["youtube", "YouTube"],
  ["ebay", "eBay"],
  ["bluetooth", "Bluetooth"],
  ["android", "Android"],
]);

// Technical terms (see tech-terms.ts) join the tables above, so Title Case and sentence case both keep GaN, ANC, OLED, PoE ...
for (const word of TECH_UPPER) KEEP_UPPER.add(word);
for (const [word, spelling] of TECH_MIXED) MIXED_CASE.set(word, spelling);

const UNIT_FORMAT = new Map<string, string>([
  ["ml", "ml"], ["cl", "cl"], ["l", "L"], ["g", "g"], ["kg", "kg"], ["mg", "mg"],
  ["cm", "cm"], ["mm", "mm"], ["m", "m"], ["km", "km"], ["dl", "dl"], ["oz", "oz"], ["lb", "lb"], ["lbs", "lbs"],
  ["in", "in"], ["pcs", "pcs"], ["pc", "pc"], ["pk", "pk"], ["gb", "GB"], ["tb", "TB"],
  ["mb", "MB"], ["kb", "KB"], ["w", "W"], ["kw", "kW"], ["v", "V"], ["hz", "Hz"],
  ["khz", "kHz"], ["mhz", "MHz"], ["ghz", "GHz"], ["mah", "mAh"],
]);

const SIZE_RE = /^\d{0,2}x{1,3}[sl]$/i; // XS, XL, XXL, 2XL, 3XL ...
const ORDINAL_RE = /^\d+(st|nd|rd|th)$/i;
const INITIALISM_RE = /^([a-z]\.)+[a-z]$/i; // U.S.A
const MEASURE_RE = /^(\d+(?:[.,]\d+)?)([a-z]+)$/i; // 500ml, 2kg
const DIMENSION_RE = /^(\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)+)([a-z]*)$/i; // 10x20cm

function formatMeasurement(core: string): string | null {
  const dimension = DIMENSION_RE.exec(core);
  if (dimension) {
    const unit = dimension[2].toLowerCase();
    if (unit === "") return dimension[1].toLowerCase();
    const formattedUnit = UNIT_FORMAT.get(unit);
    return formattedUnit !== undefined ? dimension[1].toLowerCase() + formattedUnit : null;
  }
  const measure = MEASURE_RE.exec(core);
  if (measure) {
    const formattedUnit = UNIT_FORMAT.get(measure[2].toLowerCase());
    if (formattedUnit !== undefined) return measure[1] + formattedUnit;
  }
  return null;
}

function capitalizeWord(core: string): string {
  const lower = core.toLowerCase();
  const head = lower.charAt(0).toUpperCase();
  // O'Brien, O'Neill
  if (/^o['’]./i.test(core) && core.length > 2) {
    return head + lower.charAt(1) + lower.charAt(2).toUpperCase() + lower.slice(3);
  }
  return head + lower.slice(1);
}

function splitAffixes(segment: string): [string, string, string] {
  let start = 0;
  let end = segment.length;
  while (start < end && !isAlphanumeric(segment.charAt(start))) start++;
  while (end > start && !isAlphanumeric(segment.charAt(end - 1))) end--;
  return [segment.slice(0, start), segment.slice(start, end), segment.slice(end)];
}

function formatSegment(segment: string, allowSmallWord: boolean): string {
  const [prefix, core, suffix] = splitAffixes(segment);
  if (core === "") return segment;

  let hasLetter = false;
  let hasDigit = false;
  for (let i = 0; i < core.length; i++) {
    const ch = core.charAt(i);
    if (isLetter(ch)) hasLetter = true;
    else if (isDigit(ch)) hasDigit = true;
  }
  if (!hasLetter) return segment;

  const lower = core.toLowerCase();
  const mixed = MIXED_CASE.get(lower);
  if (mixed !== undefined) return prefix + mixed + suffix;

  if (KEEP_UPPER.has(lower) || SIZE_RE.test(core) || INITIALISM_RE.test(core)) {
    return prefix + core.toUpperCase() + suffix;
  }

  const measurement = formatMeasurement(core);
  if (measurement !== null) return prefix + measurement + suffix;

  if (ORDINAL_RE.test(core)) return prefix + lower + suffix;

  // Model codes such as "RTX3080", "A4", "3D", "4K" keep their letters upper case.
  if (hasDigit) return prefix + core.toUpperCase() + suffix;

  if (allowSmallWord && SMALL_WORDS.has(lower)) return prefix + lower + suffix;

  return prefix + capitalizeWord(core) + suffix;
}

function formatToken(token: string, isEdgeWord: boolean): string {
  const parts = token.split(/([-/–—])/);
  const isSingleSegment = parts.length === 1;
  return parts
    .map((part, index) =>
      index % 2 === 1 ? part : formatSegment(part, isSingleSegment && !isEdgeWord),
    )
    .join("");
}

/** True when the text is shouting (no lower case letters) or whispering (no upper case letters). */
function needsRecase(text: string): boolean {
  let upper = 0;
  let lower = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!isLetter(ch)) continue;
    if (ch === ch.toUpperCase()) upper++;
    else lower++;
  }
  return upper + lower > 0 && (upper === 0 || lower === 0);
}

/* ---- company forms: "s.r.o.", "sp. z o.o.", "GmbH" are written one way, whatever the rest of the name looks like ---- */

/**
 * Legal forms of companies in the spelling that is conventional for each: lower case where that is the convention
 * (s.r.o., a.s., sp. z o.o., e.K.), capitals where it is not (GmbH, S.A., B.V., LLC, Ltd). Title Case and sentence case
 * both write them like this and never capitalize the words inside them ("sp. z o.o." keeps its "z"). Matched without
 * regard to the case they arrive in, as whole words, so "as" in a title is not "a.s.". Add a form here to teach it.
 */
const LEGAL_FORMS: readonly string[] = [
  // several words, matched as a whole so the connectors inside stay as they are
  "sp. z o.o.", "sp. z o. o.", "spol. s r.o.", "spol. s r. o.", "s. r. o.", "a. s.", "sp. k.", "sp. j.", "GmbH & Co. KG",
  // one word
  "s.r.o.", "a.s.", "k.s.", "v.o.s.", "S.A.", "S.r.l.", "S.p.A.", "S.L.", "N.V.", "B.V.", "e.K.", "e.V.",
  "GmbH", "AG", "Ltd", "Ltd.", "LLC", "Inc", "Inc.", "PLC",
];

const LEGAL_BY_KEY: ReadonlyMap<string, string> = new Map(LEGAL_FORMS.map((form) => [form.toLowerCase(), form]));
const MAX_LEGAL_WORDS = Math.max(...LEGAL_FORMS.map((form) => form.split(" ").length));

/**
 * If the words from `start` on are a company form, the form's words as they are conventionally written (with any bracket
 * or comma around it kept) and how many source words it covers.
 */
function legalFormAt(tokens: string[], start: number): { words: string[]; used: number } | null {
  for (let length = Math.min(MAX_LEGAL_WORDS, tokens.length - start); length >= 1; length--) {
    const joined = tokens.slice(start, start + length).join(" ");
    const parts = /^([("'“‘[]*)(.*?)([,;:)"'”’\]]*)$/.exec(joined);
    if (!parts) continue;
    const form = LEGAL_BY_KEY.get(parts[2].toLowerCase());
    if (form === undefined) continue;
    const words = form.split(" ");
    words[0] = parts[1] + words[0];
    words[words.length - 1] += parts[3];
    return { words, used: length };
  }
  return null;
}

/** Converts text to professional Title Case (small words stay lower case, acronyms, units and company forms are preserved). */
export function toTitleCase(text: string): string {
  const tokens = text.split(" ");
  const lastIndex = tokens.length - 1;
  const words: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    const legal = legalFormAt(tokens, index);
    if (legal) {
      words.push(...legal.words);
      index += legal.used;
    } else {
      words.push(formatToken(tokens[index], index === 0 || index === lastIndex));
      index++;
    }
  }
  return words.join(" ");
}

/* ---- sentence case: "Profesionální pěnová matrace XL" ---- */

const hasUpper = (text: string): boolean => /\p{Lu}/u.test(text);
const hasLower = (text: string): boolean => /\p{Ll}/u.test(text);
/** "iPhone", "DomoPlus", "2.4GHz", "O'Brien": capitals inside the word that are not simply a capitalized "Word". */
const isMixedCaseWord = (core: string): boolean => hasUpper(core) && hasLower(core) && !/^\p{Lu}\p{Ll}+$/u.test(core);

/** One piece of a word (between hyphens). `lowered` says that it was an ordinary word and got lower case, so it may need its capital back. */
function sentencePart(part: string, shouting: boolean): { text: string; lowered: boolean } {
  const [prefix, core, suffix] = splitAffixes(part);
  const kept = { text: part, lowered: false };
  if (core === "") return kept;

  let letters = 0;
  let hasDigit = false;
  for (const ch of core) {
    if (isLetter(ch)) letters++;
    else if (isDigit(ch)) hasDigit = true;
  }
  if (letters === 0) return kept; // numbers and symbols
  if (isMixedCaseWord(core)) return kept; // typed with its own capitals: iPhone, DomoPlus, 2.4GHz

  const lower = core.toLowerCase();
  const brand = MIXED_CASE.get(lower);
  if (brand !== undefined) return { text: prefix + brand + suffix, lowered: false };
  if (letters === 1 && !hasDigit) return kept; // a size (M), a designator (the C of USB-C), a preposition (Czech "s"): not ours to guess
  if (KEEP_UPPER.has(lower) || SIZE_RE.test(core) || INITIALISM_RE.test(core)) return { text: prefix + core.toUpperCase() + suffix, lowered: false };
  const measurement = formatMeasurement(core);
  if (measurement !== null) return { text: prefix + measurement + suffix, lowered: false };
  if (ORDINAL_RE.test(core)) return { text: prefix + lower + suffix, lowered: false };
  if (hasDigit) return { text: prefix + core.toUpperCase() + suffix, lowered: false }; // model codes: A4, RTX3080, 3D
  // Capitals typed among lower case words are an acronym (NASA, HD); in a title that is all capitals nobody can tell, and the lists above decide.
  if (!shouting && core.length >= 2 && core === core.toUpperCase()) return kept;
  return { text: prefix + lower + suffix, lowered: true };
}

/**
 * Lower case everything except the first letter, acronyms, tokens with digits (750ml, USB-C, 2.4GHz), company forms and
 * words that were already mixed-case. "PROFESIONÁLNÍ PĚNOVÁ MATRACE XL" becomes "Profesionální pěnová matrace XL".
 */
export function toSentenceCaseTitle(text: string): string {
  const shouting = hasUpper(text) && !hasLower(text);
  const tokens = text.split(" ");
  const words: string[] = [];
  let first = true; // the first word that is not a company form gets the capital
  for (let index = 0; index < tokens.length; ) {
    const legal = legalFormAt(tokens, index);
    if (legal) {
      words.push(...legal.words);
      index += legal.used;
      continue;
    }
    const pieces = tokens[index].split(/([-/–—])/);
    const results = pieces.map((piece, position) => (position % 2 === 1 ? { text: piece, lowered: false } : sentencePart(piece, shouting)));
    // "T-Shirt" or "Wi-Fi" are one spelling, not two words: a known brand spelling for the whole token wins.
    const whole = MIXED_CASE.get(tokens[index].toLowerCase().replace(/[-–—]/g, ""));
    let token = whole !== undefined && pieces.length > 1 ? whole : results.map((result) => result.text).join("");
    if (first && results[0].lowered) token = token.charAt(0).toUpperCase() + token.slice(1);
    if (/[\p{L}\p{N}]/u.test(token)) first = false; // a title that starts with a number has nothing to capitalize
    words.push(token);
    index++;
  }
  return words.join(" ");
}

/**
 * A brand written the way the vendor column writes it ("ProGlow™", "AeroVent"), for the start of an ALL CAPS title. Only a
 * vendor with some lower case letters has a spelling to go by: "TECH-IMPORT" says nothing about how the brand is written.
 */
export function brandSpelling(vendor: string | undefined): string {
  const brand = cleanWhitespace(decodeEntities(vendor ?? ""));
  return brand !== "" && hasLower(brand) ? brand : "";
}

/** `cased` with its first words replaced by `brand`, when the title STARTS with that brand (in any case). */
function withBrand(text: string, cased: string, brand: string): string {
  const brandWords = brand.split(" ");
  const words = text.split(" ");
  if (words.length < brandWords.length || !brandWords.every((word, index) => words[index].toLowerCase() === word.toLowerCase())) return cased;
  return [...brandWords, ...cased.split(" ").slice(brandWords.length)].join(" ");
}

/**
 * Full title pipeline: strips markup and entities, removes rogue whitespace and applies the casing.
 *  - "title" (default): ALL CAPS and all lower case titles become Title Case; well-formed mixed-case titles
 *    ("Blue T-Shirt", "iPhone Case") are left alone.
 *  - "sentence": every title is put in sentence case (see toSentenceCaseTitle).
 *  - "keep": the case is as supplied.
 * `brand` (see brandSpelling): when an ALL CAPS title starts with the brand, the brand keeps its own spelling:
 * "PROGLOW™ 20000MAH POWER BANK" with the vendor "ProGlow™" is "ProGlow™ 20000mAh Power Bank", not "Proglow™ ...".
 */
export function normalizeTitle(input: string, casing: TitleCasing = "title", brand = ""): string {
  const withoutTags = input.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  const text = cleanWhitespace(decodeEntities(withoutTags));
  if (text === "" || casing === "keep") return text;
  const shouting = hasUpper(text) && !hasLower(text);
  const cased = casing === "sentence" ? toSentenceCaseTitle(text) : needsRecase(text) ? toTitleCase(text) : text;
  return brand !== "" && shouting ? withBrand(text, cased, brand) : cased;
}

/** The first `count` different titles of a file, as supplied (cleaned of markup) and as they come out, to show what a casing does. */
export function sampleTitleCasing(rawRows: RawSupplierRow[], casing: TitleCasing, count = 3): Array<{ before: string; after: string }> {
  const samples: Array<{ before: string; after: string }> = [];
  const seen = new Set<string>();
  for (const raw of rawRows) {
    const before = normalizeTitle(raw.title, "keep");
    if (before === "" || seen.has(before)) continue;
    seen.add(before);
    samples.push({ before, after: normalizeTitle(raw.title, casing) });
    if (samples.length === count) break;
  }
  return samples;
}

/* -------------------------------------------------------------------------- */
/*  2. HTML stripping (descriptions)                                           */
/* -------------------------------------------------------------------------- */

const PARAGRAPH_BREAK = "\uE000";
const LINE_BREAK = "\uE001";
const LIST_ITEM = "\uE002";

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "blockquote", "pre", "center", "address", "figure", "figcaption", "table",
  "thead", "tbody", "tfoot", "tr", "caption", "ul", "ol", "dl", "dt", "dd",
  "hr", "form", "fieldset",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CELL_TAGS = new Set(["td", "th"]);
const BULLET_RE = /^[•·▪‣◦*–-]\s+/;

/** Turns one tag into a structural marker; every attribute (style, class, face ...) is discarded. */
function tagToMarker(isClosing: boolean, name: string): string {
  if (name === "br") return LINE_BREAK;
  if (name === "li") return isClosing ? PARAGRAPH_BREAK : PARAGRAPH_BREAK + LIST_ITEM;
  if (name === "b" || name === "strong") return isClosing ? "</strong>" : "<strong>";
  if (name === "i" || name === "em") return isClosing ? "</em>" : "<em>";
  if (HEADING_TAGS.has(name)) {
    return isClosing ? "</strong>" + PARAGRAPH_BREAK : PARAGRAPH_BREAK + "<strong>";
  }
  if (BLOCK_TAGS.has(name)) return PARAGRAPH_BREAK;
  if (CELL_TAGS.has(name)) return " ";
  // font, span, a, u, img, o:p ... : drop the tag, keep the text inside it.
  return "";
}

/** Tracks whether the next word begins a sentence while a shouting description is re-cased across tags. */
interface SentenceState {
  atStart: boolean;
}

/** True for text that is (almost) entirely upper case: ALL CAPS body copy that should read like a sentence. */
function isShoutingText(text: string): boolean {
  let upper = 0;
  let lower = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!isLetter(ch)) continue;
    if (ch === ch.toUpperCase()) upper++;
    else lower++;
  }
  const letters = upper + lower;
  return letters >= 6 && upper / letters >= 0.85;
}

/** Lower-cases one hyphen/slash-free piece of a word, keeping acronyms, units, sizes and model codes intact. */
function recaseSegment(segment: string): string {
  const lower = segment.toLowerCase();
  const mixed = MIXED_CASE.get(lower);
  if (mixed !== undefined) return mixed;
  if (KEEP_UPPER.has(lower) || SIZE_RE.test(segment) || INITIALISM_RE.test(segment)) return segment.toUpperCase();
  if (ORDINAL_RE.test(segment)) return lower;
  const measurement = formatMeasurement(segment);
  if (measurement !== null) return measurement;
  // Model codes such as "RTX3080" or "30H" stay upper case.
  if (/\d/.test(segment) && /[a-z]/i.test(segment)) return segment.toUpperCase();
  return lower;
}

/**
 * Sentence case for shouting text: everything is lower-cased except acronyms and units, and the first
 * word of each sentence (and of each line) is capitalized. "SOFT USB-C CABLE. WASHABLE 750ML." becomes
 * "Soft USB-C cable. Washable 750ml."
 */
function toSentenceCase(text: string, state: SentenceState): string {
  return text.replace(/(\n+)|(\S+)/g, (match: string, newlines: string | undefined, word: string | undefined) => {
    if (newlines !== undefined) {
      state.atStart = true;
      return match;
    }
    const [prefix, core, suffix] = splitAffixes(word as string);
    if (core === "") return match;

    const parts = core.split(/([-/\u2013\u2014])/);
    let recased = parts
      .map((part, index) => {
        if (index % 2 === 1) return part;
        // A lone letter beside a hyphen or slash is a designator ("USB-C", "Type-C", "T-shirt"), not a word.
        if (parts.length > 1 && /^[A-Z]$/.test(part)) return part;
        return recaseSegment(part);
      })
      .join("");
    if (state.atStart) recased = recased.charAt(0).toUpperCase() + recased.slice(1);
    state.atStart = /[.!?]["')\]]*$/.test(suffix);
    return prefix + recased + suffix;
  });
}

function textToMarkedText(text: string, hasMarkup: boolean, sentenceCase: SentenceState | null = null): string {
  const decodedText = decodeEntities(text).replace(/\u00A0/g, " ");
  const decoded = sentenceCase ? toSentenceCase(decodedText, sentenceCase) : decodedText;
  let normalized: string;
  if (hasMarkup) {
    // In HTML, source line breaks are plain whitespace.
    normalized = decoded.replace(/\s+/g, " ");
  } else {
    // Plain text: blank lines separate paragraphs, single line breaks are kept.
    normalized = decoded
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{2,}/g, PARAGRAPH_BREAK)
      .replace(/\n/g, LINE_BREAK);
  }
  return escapeHtml(normalized);
}

/** Makes sure <strong>/<em> are balanced inside one block and drops empty ones. */
function finalizeInline(html: string): string {
  const stack: string[] = [];
  const tagRe = /<(\/?)(strong|em)>/g;
  let result = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    result += html.slice(last, match.index);
    last = tagRe.lastIndex;
    const tag = match[2];
    if (match[1] === "") {
      stack.push(tag);
      result += `<${tag}>`;
    } else if (stack.includes(tag)) {
      while (stack.length > 0) {
        const open = stack.pop() as string;
        result += `</${open}>`;
        if (open === tag) break;
      }
    }
    // A closing tag without an opener is dropped.
  }
  result += html.slice(last);
  while (stack.length > 0) result += `</${stack.pop()}>`;

  let previous: string;
  do {
    previous = result;
    result = result.replace(/<(strong|em)>\s*<\/\1>/g, "");
  } while (result !== previous);

  return result.replace(/\s{2,}/g, " ").trim();
}

function hasVisibleText(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").trim() !== "";
}

/**
 * Converts a messy supplier description into clean semantic HTML.
 *
 * Kept:    paragraphs (<p>), lists (<ul><li>), <strong>, <em>, <br> inside a paragraph.
 * Removed: <font>, <div>, <span>, tables, inline styles, classes, scripts, comments,
 *          Word/Excel junk (<o:p>, conditional comments), empty paragraphs.
 * Text is entity-decoded and re-escaped, so the result is always safe to embed.
 */
export function cleanDescription(input: string): string {
  // The private-use markers below are internal; make sure the input cannot contain them.
  let html = emptyIfPlaceholder(input).replace(/[\uE000-\uE002]/g, "");
  if (html.trim() === "") return "";

  // Some exports ship the markup entity-escaped ("&lt;p&gt;...").
  if (!/<[a-z!/]/i.test(html) && /&lt;\/?[a-z]/i.test(html)) {
    html = html.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  }

  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[[^\]]*\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(
      /<(script|style|head|title|noscript|iframe|object|embed|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    );

  const hasMarkup = /<\/?[a-z][\w:-]*/i.test(html);
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

  // ALL CAPS body copy gets sentence case, so the cleaned description does not shout like the original.
  const sentenceCase: SentenceState | null = isShoutingText(decodeEntities(html.replace(/<[^>]*>/g, " ")))
    ? { atStart: true }
    : null;

  let marked = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    marked += textToMarkedText(html.slice(last, match.index), hasMarkup, sentenceCase);
    const marker = tagToMarker(match[1] === "/", match[2].toLowerCase());
    // A paragraph, list item or line break starts a new sentence; inline tags such as <b> do not.
    if (sentenceCase && /[\uE000-\uE002]/.test(marker)) sentenceCase.atStart = true;
    marked += marker;
    last = tagRe.lastIndex;
  }
  marked += textToMarkedText(html.slice(last), hasMarkup, sentenceCase);

  // "<br><br>" is how legacy editors write a paragraph break.
  marked = marked.replace(new RegExp(`(?:${LINE_BREAK}\\s*){2,}`, "g"), PARAGRAPH_BREAK);

  const parts: string[] = [];
  let listItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    parts.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      const body = finalizeInline(paragraphLines.join("<br>"));
      if (hasVisibleText(body)) {
        flushList();
        parts.push(`<p>${body}</p>`);
      }
      paragraphLines = [];
    }
  };
  const pushItem = (text: string) => {
    const body = finalizeInline(text);
    if (hasVisibleText(body)) listItems.push(body);
  };

  for (const block of marked.split(PARAGRAPH_BREAK)) {
    const trimmedBlock = block.trim();
    const isItemBlock = trimmedBlock.startsWith(LIST_ITEM);
    let itemStarted = false;

    for (const rawLine of trimmedBlock.split(LINE_BREAK)) {
      const line = rawLine.replace(LIST_ITEM, "").replace(/\s+/g, " ").trim();
      if (line === "") continue;
      const bullet = BULLET_RE.exec(line);

      if (isItemBlock) {
        flushParagraph();
        if (!itemStarted) {
          pushItem(bullet ? line.slice(bullet[0].length) : line);
          itemStarted = true;
        } else if (listItems.length > 0) {
          listItems[listItems.length - 1] += " " + line;
        }
      } else if (bullet) {
        flushParagraph();
        pushItem(line.slice(bullet[0].length));
      } else {
        paragraphLines.push(line);
      }
    }
    flushParagraph();
  }
  flushList();

  return parts.join("");
}

/* -------------------------------------------------------------------------- */
/*  3. Handle generation                                                       */
/* -------------------------------------------------------------------------- */

const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, "ss"],
  [/ø/g, "o"],
  [/ł/g, "l"],
  [/đ/g, "d"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ð/g, "d"],
  [/þ/g, "th"],
];

/**
 * URL-safe, lowercase handle: "BLUE T-SHIRT 123" becomes "blue-t-shirt-123".
 * Accents are transliterated ("Čokoláda" becomes "cokolada"), "&" becomes "and".
 * Returns an empty string when nothing URL-safe can be derived.
 */
export function generateHandle(source: string): string {
  let text = decodeEntities(source).toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255)
    .replace(/-+$/, "");
}

/** Shopify merges rows that share a handle into one product, so every product needs a unique one. */
function reserveUniqueHandle(base: string, used: Map<string, number>): string {
  if (!used.has(base)) {
    used.set(base, 1);
    return base;
  }
  let counter = (used.get(base) as number) + 1;
  let candidate = `${base}-${counter}`;
  while (used.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}`;
  }
  used.set(base, counter);
  used.set(candidate, 1);
  return candidate;
}

/* -------------------------------------------------------------------------- */
/*  4. Image handling & splitting                                              */
/* -------------------------------------------------------------------------- */

// Splits on pipes, semicolons, line breaks, and on commas/spaces that are followed by
// another URL (so a comma *inside* a URL survives).
const IMAGE_SPLIT_RE =
  /\s*[|;\r\n]+\s*|\s*,\s*(?=(?:https?:)?\/\/|www\.)|\s+(?=(?:https?:)?\/\/|www\.)/i;

function normalizeImageUrl(candidate: string): string | null {
  let url = candidate.replace(/^[\s"'<[(]+|[\s"'>\])]+$/g, "");
  if (url === "") return null;
  if (url.startsWith("//")) url = "https:" + url;
  else if (/^www\./i.test(url)) url = "https://" + url;
  url = url.replace(/\s/g, "%20");
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    const isWebProtocol = parsed.protocol === "http:" || parsed.protocol === "https:";
    return isWebProtocol && parsed.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/**
 * Splits a clumped image cell ("a.jpg|b.jpg, c.jpg") into individual, valid,
 * de-duplicated absolute URLs. Relative file names cannot be fetched by Shopify
 * and are reported as dropped.
 */
export function splitImageUrls(input: string): { urls: string[]; dropped: number } {
  const { urls, dropped } = splitImageCell(input);
  return { urls, dropped };
}

/** splitImageUrls, plus what it left out: the pieces that are not http(s) links, and the URLs repeated inside the cell. */
export function splitImageCell(input: string): { urls: string[]; dropped: number; rejected: string[]; duplicates: number } {
  const source = emptyIfPlaceholder(decodeEntities(input)).trim();
  if (source === "") return { urls: [], dropped: 0, rejected: [], duplicates: 0 };

  const seen = new Set<string>();
  const urls: string[] = [];
  const rejected: string[] = [];
  let duplicates = 0;

  for (const piece of source.split(IMAGE_SPLIT_RE)) {
    if (piece.trim() === "") continue;
    const url = normalizeImageUrl(piece);
    if (url === null) {
      rejected.push(piece.trim());
    } else if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    } else {
      duplicates++;
    }
  }
  return { urls, dropped: rejected.length, rejected, duplicates };
}

/* -------------------------------------------------------------------------- */
/*  5. Price & SKU                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes any human price format to Shopify's plain decimal string:
 * "$1,299.00" / "1.299,00 EUR" / "12,5" / "USD 19.9" become "1299.00" / "1299.00" / "12.50" / "19.90".
 * Returns an empty string for missing, negative or unparsable prices.
 */
export function normalizePrice(input: string): string {
  const source = emptyIfPlaceholder(decodeEntities(input)).trim();
  if (source === "" || /^[^\d]*-\s*\d/.test(source)) return "";

  const numeric = /\d[\d.,'\u00A0\u202F ]*/.exec(source);
  if (!numeric) return "";
  const token = numeric[0].replace(/['\u00A0\u202F ]/g, "").replace(/[.,]+$/, "");
  if (token === "") return "";

  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let decimalIndex = -1;

  if (lastDot !== -1 && lastComma !== -1) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? "," : ".";
    const index = Math.max(lastComma, lastDot);
    const occurrences = token.split(separator).length - 1;
    const digitsAfter = token.length - index - 1;
    const integerPart = token.slice(0, index);
    // "1.299" / "1,299" with exactly three trailing digits is a thousands separator,
    // anything else with a single separator is a decimal point.
    const looksLikeThousands =
      digitsAfter === 3 && integerPart !== "0" && integerPart.length <= 3;
    if (occurrences === 1 && !looksLikeThousands) decimalIndex = index;
  }

  const integerDigits = (decimalIndex === -1 ? token : token.slice(0, decimalIndex)).replace(/[.,]/g, "");
  const fractionDigits = decimalIndex === -1 ? "" : token.slice(decimalIndex + 1).replace(/[.,]/g, "");
  const value = Number(`${integerDigits || "0"}.${fractionDigits || "0"}`);
  if (!Number.isFinite(value)) return "";

  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function normalizeSku(input: string): string {
  return cleanWhitespace(emptyIfPlaceholder(decodeEntities(input)));
}

/* -------------------------------------------------------------------------- */
/*  6. Full dataset pipeline                                                   */
/* -------------------------------------------------------------------------- */

/** How many row numbers a warning lists. The count next to them is always the full count. */
export const MAX_WARNING_ROWS = 10;

function emptyShopifyRow(handle: string): CleanedShopifyRow {
  return {
    Handle: handle,
    Title: "",
    Body_HTML: "",
    Image_Src: "",
    Variant_Price: "",
    Variant_SKU: "",
    Option1_Name: "",
    Option1_Value: "",
    Option2_Name: "",
    Option2_Value: "",
    Option3_Name: "",
    Option3_Value: "",
    Vendor: "",
    Type: "",
    Tags: "",
    Status: "",
    Variant_Grams: "",
    Variant_Inventory_Tracker: "",
    Variant_Inventory_Qty: "",
    Variant_Barcode: "",
    Cost_Per_Item: "",
    Image_Position: "",
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);
const quoted = (text: string, max = 40): string => `"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;

/* -------------------------------------------------------------------------- */
/*  Variant options (Option1/2/3 Name and Value)                               */
/* -------------------------------------------------------------------------- */

const OPTION_SLOTS = 3;
const MAX_OPTION_LENGTH = 255;

/** "NAVY BLUE" / "navy blue" become "Navy Blue", "XL" and "42" stay; placeholders such as "N/A" become empty. */
export function cleanOptionValue(input: string): string {
  return normalizeTitle(emptyIfPlaceholder(decodeEntities(input))).slice(0, MAX_OPTION_LENGTH);
}

/** The name of an option ("size" becomes "Size"). */
export function cleanOptionName(input: string): string {
  return normalizeTitle(emptyIfPlaceholder(decodeEntities(input))).slice(0, MAX_OPTION_LENGTH);
}

type OptionTriple = [string, string, string];

/** Cleaned option values of a row, in column order. Slots the file does not have are empty. */
function optionValuesOf(raw: RawSupplierRow): OptionTriple {
  const values: OptionTriple = ["", "", ""];
  raw.options?.slice(0, OPTION_SLOTS).forEach((option, slot) => {
    values[slot] = cleanOptionValue(option.value);
  });
  return values;
}

/** Vendor and type: tidied like a title (cased as the casing says; the default fixes ALL CAPS and all lower case), markup and placeholders gone. */
function cleanLabel(input: string | undefined, casing: TitleCasing = "title"): string {
  return input === undefined ? "" : normalizeTitle(emptyIfPlaceholder(decodeEntities(input)), casing);
}

/* -------------------------------------------------------------------------- */
/*  Which rows are one product                                                 */
/* -------------------------------------------------------------------------- */

/** A supplier row with the things that decide where it belongs worked out once. */
interface PreparedRow {
  /** 0-based position in the file. */
  index: number;
  /** Row number as the spreadsheet shows it: the header is row 1, the first product row is row 2, blank rows counted. */
  number: number;
  raw: RawSupplierRow;
  /** The title as it will be written (cased by the person's choice). */
  title: string;
  /** The title in the default casing: what handles come from, so a handle never changes with the casing choice. */
  baseTitle: string;
  /** What titles are compared by: the default casing in lower case, so the casing choice never changes which rows belong together. */
  titleKey: string;
  suppliedHandle: string;
  /** Cleaned option values for all three slots. Which slots are used is decided after a first look at the file. */
  options: OptionTriple;
  /** The SKU as cleaned from the file. */
  sku: string;
  /** What ties rows to one product, lower case, or "" when the file offers nothing of the kind (see skuIsProductCode). */
  code: string;
  /** The same code as the file wrote it, for messages. */
  codeText: string;
}

interface Variant {
  row: PreparedRow;
  /** Option values of the slots in use (the others are empty). */
  values: OptionTriple;
}

interface Product {
  suppliedHandle: string;
  title: string;
  baseTitle: string;
  titleKey: string;
  code: string;
  hasOptions: boolean;
  variants: Variant[];
  handle: string;
  /**
   * The product's first row has the same code as the different product right before it, so that code was copied down and
   * says nothing about which product the row belongs to. The product's real code is the next row's.
   */
  codeUnreliable: boolean;
  /** The product whose code was copied, for the message. */
  copiedFrom: Product | null;
  /** The option combinations the product has so far (lower case), so a row that adds a new one can be told from one that repeats. */
  combinations: Set<string>;
}

function prepareRows(rawRows: RawSupplierRow[], casing: TitleCasing): PreparedRow[] {
  return rawRows.map((raw, index) => {
    const brand = brandSpelling(raw.vendor);
    const baseTitle = normalizeTitle(raw.title, "title", brand);
    return {
      index,
      number: raw.sourceRow ?? spreadsheetRow(index),
      raw,
      title: casing === "title" ? baseTitle : normalizeTitle(raw.title, casing, brand),
      baseTitle,
      titleKey: baseTitle.toLowerCase(),
      suppliedHandle: raw.handle ? generateHandle(raw.handle) : "",
      options: optionValuesOf(raw),
      sku: normalizeSku(raw.sku),
      code: "",
      codeText: "",
    };
  });
}

/** What ties the rows of a product together: a product-code column if the file has one, else a SKU the variants share. */
function assignCodes(rows: PreparedRow[], rawRows: RawSupplierRow[]): void {
  if (rawRows.some((raw) => raw.productCode !== undefined)) {
    for (const row of rows) {
      row.codeText = cleanWhitespace(emptyIfPlaceholder(decodeEntities(row.raw.productCode ?? "")));
      row.code = row.codeText.toLowerCase();
    }
  } else if (skuIsProductCode(rows)) {
    for (const row of rows) {
      row.codeText = row.sku;
      row.code = row.sku.toLowerCase();
    }
  }
}

/** A row that is not a product: a summary line, or the same as an earlier row. */
interface DroppedRow {
  row: PreparedRow;
  reason: "summary" | "duplicate";
  detail: string;
}

/** Every cell of a row as a trimmed string, so two rows with the same cells have the same signature. */
function exactSignature(raw: RawSupplierRow): string {
  const cells = Object.entries(raw)
    .filter(([key, value]) => key !== "options" && key !== "sourceRow" && key !== "firstCell" && value !== undefined)
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .sort();
  const options = (raw.options ?? []).map((option) => `${option.name.trim()}=${option.value.trim()}`);
  return JSON.stringify([cells, options]);
}

/**
 * Leaves out what is not a product: summary lines ("TOTAL,,12345.67"), always; and, when asked, any row whose every cell
 * equals that of an earlier row (the first one stays).
 */
function dropRows(rows: PreparedRow[], removeDuplicates: boolean): { active: PreparedRow[]; dropped: DroppedRow[] } {
  const active: PreparedRow[] = [];
  const dropped: DroppedRow[] = [];
  const seen = new Map<string, PreparedRow>();
  for (const row of rows) {
    const summary = summaryRowReason(row.raw);
    if (summary !== null) {
      dropped.push({ row, reason: "summary", detail: summary === "label" ? quoted(summaryLabel(row.raw)) : "only numbers, no product" });
      continue;
    }
    if (removeDuplicates) {
      const signature = exactSignature(row.raw);
      const earlier = seen.get(signature);
      if (earlier !== undefined) {
        dropped.push({ row, reason: "duplicate", detail: `same as row ${earlier.number}` });
        continue;
      }
      seen.set(signature, row);
    }
    active.push(row);
  }
  return { active, dropped };
}

/**
 * Many supplier files have no separate product code: the "SKU" column holds one code per PRODUCT, repeated on every one of
 * its variant rows. That is recognised when neighbouring rows with the same title mostly share the SKU. A file whose SKUs
 * are different on every variant (SKU-RED-S, SKU-RED-M) is not read that way, or every variant would become a product.
 */
function skuIsProductCode(rows: PreparedRow[]): boolean {
  let shared = 0;
  let different = 0;
  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1];
    const row = rows[i];
    if (row.titleKey === "" || before.titleKey !== row.titleKey || before.sku === "" || row.sku === "") continue;
    if (before.sku.toLowerCase() === row.sku.toLowerCase()) shared++;
    else different++;
  }
  return shared > 0 && shared >= different;
}

const titlesAgree = (product: Product, row: PreparedRow): boolean => row.titleKey === "" || product.titleKey === "" || row.titleKey === product.titleKey;

const combinationOf = (values: OptionTriple): string => values.join("\u0001").toLowerCase();

/**
 * Does this row continue the product the previous rows form? Only the product directly before it is considered, so rows
 * that are not next to each other can never be merged: the same title further down is a different product.
 *  - a handle in the file names the product: the same handle and no contradicting title;
 *  - otherwise the product code (when the file has one): the same code and no contradicting title. When the product's
 *    own code is unreliable (copied from the product before it), the same title with an option combination the product
 *    does not have yet is enough: two rows with the same options are two products, not one product twice;
 *  - otherwise (no handle, no code): the same title next to each other, and only when the variants differ by an option.
 */
function continuesProduct(product: Product, row: PreparedRow, values: OptionTriple, rowHasOptions: boolean): boolean {
  if (row.suppliedHandle !== "") return row.suppliedHandle === product.suppliedHandle && titlesAgree(product, row);
  if (!titlesAgree(product, row)) return false;
  if (product.code !== "" && row.code !== "") {
    if (product.code === row.code) return true;
    return product.codeUnreliable && product.titleKey !== "" && row.titleKey !== "" && rowHasOptions && !product.combinations.has(combinationOf(values));
  }
  return product.titleKey !== "" && row.titleKey !== "" && (rowHasOptions || product.hasOptions);
}

/** slots === null looks at every option column, to find out which of them are really options. */
function groupProducts(rows: PreparedRow[], slots: boolean[] | null): Product[] {
  const products: Product[] = [];
  let current: Product | undefined;
  for (const row of rows) {
    const values = row.options.map((value, slot) => (slots === null || slots[slot] ? value : "")) as OptionTriple;
    const rowHasOptions = values.some((value) => value !== "");
    if (current !== undefined && continuesProduct(current, row, values, rowHasOptions)) {
      current.variants.push({ row, values });
      current.combinations.add(combinationOf(values));
      current.hasOptions = current.hasOptions || rowHasOptions;
      if (current.titleKey === "" && row.titleKey !== "") {
        current.title = row.title;
        current.baseTitle = row.baseTitle;
        current.titleKey = row.titleKey;
      }
      if (current.code === "") current.code = row.code;
      else if (current.codeUnreliable && row.code !== "") {
        // The row below a copied code brings the product's real one.
        current.code = row.code;
        current.codeUnreliable = false;
      }
    } else {
      // The same code as the different product right before it is a code that was copied down: it cannot be trusted to group by.
      const copied = current !== undefined && row.suppliedHandle === "" && row.code !== "" && row.code === current.code;
      current = {
        suppliedHandle: row.suppliedHandle,
        title: row.title,
        baseTitle: row.baseTitle,
        titleKey: row.titleKey,
        code: row.code,
        hasOptions: rowHasOptions,
        variants: [{ row, values }],
        handle: "",
        codeUnreliable: copied,
        copiedFrom: copied ? (current ?? null) : null,
        combinations: new Set([combinationOf(values)]),
      };
      products.push(current);
    }
  }
  return joinApartVariants(products);
}

/**
 * A product's variants are not always together: other rows can sit between them. Rows that belong to an earlier product are moved
 * up to it (it keeps its first position in the file):
 *  - same product code AND same title (the file groups by code): a combination the product already has is reported as a duplicate
 *    variant like any other. Rows with the same code but another title are another product;
 *  - a row with a handle and NO title (the variant-row style of a Shopify file) whose handle an earlier product has: a title that
 *    is missing contradicts nothing, and the alternative is a product with no title. Rows WITH a title stay separate products.
 * (A code copied from the product above cannot make two DIFFERENT titles one product, but two rows that agree on code AND title do agree.)
 */
function joinApartVariants(products: Product[]): Product[] {
  const homes = new Map<string, Product>();
  const kept: Product[] = [];
  for (const product of products) {
    const byCode = product.suppliedHandle === "" && product.code !== "" && product.titleKey !== "" ? `code\u0000${product.code}\u0000${product.titleKey}` : "";
    const byHandle = product.suppliedHandle !== "" && product.titleKey === "" ? `handle\u0000${product.suppliedHandle}` : "";
    const key = byCode || byHandle;
    const home = key === "" ? undefined : homes.get(key);
    if (home !== undefined) {
      home.variants.push(...product.variants);
      for (const combination of product.combinations) home.combinations.add(combination);
      home.hasOptions = home.hasOptions || product.hasOptions;
      continue;
    }
    kept.push(product);
    // The product that owns a handle or a code-and-title is the first one that has it, and only a product WITH a title can own a handle.
    if (byCode !== "") homes.set(byCode, product);
    if (product.suppliedHandle !== "" && product.titleKey !== "") homes.set(`handle\u0000${product.suppliedHandle}`, product);
  }
  return kept;
}

/**
 * Which option slots end up in the output. A column from Option1 Value style headers is used as soon as any row has a
 * value. A plain attribute column ("Size", "Style") is used only if it tells variants of one product apart, i.e. some
 * product has rows with different values in it: otherwise it is a description of the product, not a variant option.
 */
function chooseOptionSlots(rows: PreparedRow[], products: Product[]): boolean[] {
  const inUse = [false, false, false];
  const derived = [false, false, false];
  for (const row of rows) {
    row.raw.options?.slice(0, OPTION_SLOTS).forEach((option, slot) => {
      derived[slot] = option.derived;
      if (!option.derived && row.options[slot] !== "") inUse[slot] = true;
    });
  }
  for (const product of products) {
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      if (!derived[slot] || inUse[slot]) continue;
      const distinct = new Set(product.variants.map((variant) => variant.row.options[slot].toLowerCase()).filter((value) => value !== ""));
      if (distinct.size >= 2) inUse[slot] = true;
    }
  }
  return inUse;
}

/** The rows, the ones left out, the option slots in use and the products, in the one place that works them out. */
function structureOf(
  rawRows: RawSupplierRow[],
  casing: TitleCasing = "title",
  removeDuplicates = true,
): { prepared: PreparedRow[]; active: PreparedRow[]; dropped: DroppedRow[]; slots: boolean[]; products: Product[] } {
  const prepared = prepareRows(rawRows, casing);
  const { active, dropped } = dropRows(prepared, removeDuplicates);
  assignCodes(active, rawRows);
  const slots = chooseOptionSlots(active, groupProducts(active, null));
  return { prepared, active, dropped, slots, products: groupProducts(active, slots) };
}

/* -------------------------------------------------------------------------- */
/*  SKUs                                                                       */
/* -------------------------------------------------------------------------- */

/** True when some product has several variants that all share one SKU: then the person almost certainly wants them told apart. */
function variantsShareOneSku(products: Product[]): boolean {
  return products.some((product) => {
    if (product.variants.length < 2) return false;
    const first = product.variants[0].row.sku.toLowerCase();
    return first !== "" && product.variants.every((variant) => variant.row.sku.toLowerCase() === first);
  });
}

/**
 * Whether "Make SKUs unique per variant" should start switched on for this file: when the variants of a product all share
 * one SKU (SKU-1001 on every size and colour). Looks only at how the rows group, never at the cleaned output.
 */
export function suggestUniqueSkus(rawRows: RawSupplierRow[]): boolean {
  return variantsShareOneSku(structureOf(rawRows).products);
}

/** The options a file starts with: SKUs made unique when its variants share one, products as drafts, titles in Title Case. */
export function defaultSanitizeOptions(rawRows: RawSupplierRow[]): SanitizeOptions {
  return { uniqueSkus: suggestUniqueSkus(rawRows), ...FIXED_DEFAULTS };
}

const CASINGS: readonly TitleCasing[] = ["title", "sentence", "keep"];

/** The options that do not depend on the file. */
const FIXED_DEFAULTS = { status: "draft", casing: "title", removeDuplicates: true, noRetailPrice: "empty", markupPercent: 100 } as const;
const MAX_MARKUP_PERCENT = 10_000;

/**
 * `defaults` with whatever of `saved` is valid laid over it. A file parked before the tool had an option (or by a build
 * that did not know it) comes back with that option missing: it gets the default instead of breaking.
 */
export function mergeSanitizeOptions(defaults: SanitizeOptions, saved?: Partial<SanitizeOptions> | null): SanitizeOptions {
  return {
    uniqueSkus: typeof saved?.uniqueSkus === "boolean" ? saved.uniqueSkus : defaults.uniqueSkus,
    status: saved?.status === "active" || saved?.status === "draft" ? saved.status : defaults.status,
    casing: saved?.casing !== undefined && CASINGS.includes(saved.casing) ? saved.casing : defaults.casing,
    removeDuplicates: typeof saved?.removeDuplicates === "boolean" ? saved.removeDuplicates : defaults.removeDuplicates,
    noRetailPrice: saved?.noRetailPrice === "markup" || saved?.noRetailPrice === "empty" ? saved.noRetailPrice : defaults.noRetailPrice,
    markupPercent:
      typeof saved?.markupPercent === "number" && Number.isFinite(saved.markupPercent) && saved.markupPercent >= 0
        ? Math.min(saved.markupPercent, MAX_MARKUP_PERCENT)
        : defaults.markupPercent,
  };
}

/** "Černá" -> "CERNA", "Navy Blue" -> "NAVY-BLUE": what is appended to a SKU to tell a variant from its siblings. */
function skuSuffix(values: OptionTriple, slots: boolean[]): string {
  return values
    .filter((_, slot) => slots[slot])
    .map((value) => generateHandle(value).toUpperCase())
    .filter((part) => part !== "")
    .join("-");
}

/**
 * The SKU to write for every source row. Unchanged unless uniqueSkus is on: then the variants of a product that share a
 * SKU each get their option values appended, and any SKU that is still used twice anywhere in the file gets -2, -3 ...
 */
function resolveSkus(products: Product[], slots: boolean[], uniqueSkus: boolean, rowCount: number): { skus: string[]; changes: SkuChange[] } {
  const skus: string[] = new Array(rowCount).fill("");
  for (const product of products) for (const { row } of product.variants) skus[row.index] = row.sku;
  if (!uniqueSkus) return { skus, changes: [] };

  for (const product of products) {
    const byKey = new Map<string, Variant[]>();
    for (const variant of product.variants) {
      if (variant.row.sku === "") continue;
      const key = variant.row.sku.toLowerCase();
      byKey.set(key, [...(byKey.get(key) ?? []), variant]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      for (const variant of group) {
        const suffix = skuSuffix(variant.values, slots);
        if (suffix !== "") skus[variant.row.index] = `${variant.row.sku}-${suffix}`;
      }
    }
  }

  const used = new Set<string>();
  for (const product of products) {
    for (const { row } of product.variants) {
      const sku = skus[row.index];
      if (sku === "") continue;
      let candidate = sku;
      for (let counter = 2; used.has(candidate.toLowerCase()); counter++) candidate = `${sku}-${counter}`;
      used.add(candidate.toLowerCase());
      skus[row.index] = candidate;
    }
  }

  const changes: SkuChange[] = [];
  for (const product of products) {
    for (const { row } of product.variants) if (skus[row.index] !== row.sku) changes.push({ row: row.number, from: row.sku, to: skus[row.index] });
  }
  changes.sort((a, b) => a.row - b.row);
  return { skus, changes };
}

/* -------------------------------------------------------------------------- */
/*  Collecting what is worth telling the person                                */
/* -------------------------------------------------------------------------- */

/**
 * Per kind of problem: how many rows, which (the first MAX_WARNING_ROWS, by row number: rows are not always found in the order
 * of the file, because variants that were apart are written with their product) and one line about each of those.
 */
class Findings {
  private readonly groups = new Map<WarningKind, Array<{ row: number; detail: string }>>();

  add(kind: WarningKind, row: number, detail = ""): void {
    const entries = this.groups.get(kind) ?? [];
    entries.push({ row, detail });
    this.groups.set(kind, entries);
  }

  get(kind: WarningKind): { count: number; rows: number[]; details: string[] } | undefined {
    const entries = this.groups.get(kind);
    if (!entries) return undefined;
    const listed = [...entries].sort((a, b) => a.row - b.row).slice(0, MAX_WARNING_ROWS);
    return { count: entries.length, rows: listed.map((entry) => entry.row), details: listed.map((entry) => entry.detail) };
  }
}

export interface SanitizeResult {
  rows: CleanedShopifyRow[];
  report: SanitizeReport;
  /**
   * rowStarts[i] is where source row i begins in `rows` (its rows run up to the next start), or -1 when the row is not in the
   * output: a summary line, an exact duplicate, a row with no title. Rows of one product are written together, so the starts are not
   * always in the order of the file.
   */
  rowStarts: number[];
}

/**
 * Cleans every supplier row and flattens the result into Shopify import rows.
 *
 * Rows that are not products are left out, and said so: summary lines ("TOTAL,,12345.67"), rows that repeat an earlier row in
 * every cell (unless "Remove exact duplicates" is off), and rows with no title that belong to no product.
 *
 * Products. Rows are grouped by what the file offers:
 *  - a handle column: the same handle in a row of the same product;
 *  - a product-code column (or a SKU column that variants share, see skuIsProductCode): the same code with the same title, even
 *    when other rows sit between them (the product keeps its first position);
 *  - neither: the same title next to each other, when the variants differ by an option value.
 * The same title under another product code, or again further down without a combination of its own, is a separate product with
 * its own handle (the second gets -2, the third -3) and a warning.
 *
 * Output. A product with N images becomes N rows: the first carries the product data, the others only Handle, Image Src and
 * Image Position. Vendor, Type, Tags, Status and the option names are product-level, so they are on the first row only; each
 * variant row has its own option values, price, cost, SKU, barcode, weight and stock. Images are written once per product and
 * numbered 1, 2, 3 in the order they appear.
 *
 * Nothing the file says is dropped without being counted: every row that lost something (a stock like "In stock", an invalid
 * EAN, a link that is not http(s), a placeholder description, a price like "TBC") is listed in report.warnings.
 */
export function sanitizeDataset(rawRows: RawSupplierRow[], requested: Partial<SanitizeOptions> = {}): SanitizeResult {
  const startedAt = now();
  const early = mergeSanitizeOptions({ uniqueSkus: false, ...FIXED_DEFAULTS }, requested);
  const structure = structureOf(rawRows, early.casing, early.removeDuplicates);
  const { active, dropped, slots } = structure;
  const findings = new Findings();

  /* ---- rows that are not products ---- */
  for (const { row, reason, detail } of dropped) findings.add(reason === "summary" ? "summary_rows" : "duplicate_row", row.number, detail);

  // A product without any title cannot be imported (Shopify needs one) and is not given a made-up one: it is left out, and said so.
  const products = structure.products.filter((product) => {
    if (product.titleKey !== "") return true;
    for (const { row } of product.variants) findings.add("untitled_row", row.number, row.sku !== "" ? `SKU ${row.sku}` : row.codeText !== "" ? `code ${row.codeText}` : "no title and no code");
    return false;
  });
  const untitledRows = structure.products.reduce((sum, product) => sum + (product.titleKey === "" ? product.variants.length : 0), 0);
  const options = mergeSanitizeOptions({ uniqueSkus: variantsShareOneSku(products), ...FIXED_DEFAULTS }, requested);

  const report: SanitizeReport = {
    sourceRows: rawRows.length,
    productCount: products.length,
    variantRows: 0,
    outputRowCount: 0,
    titlesFixed: 0,
    descriptionsCleaned: 0,
    handlesGenerated: 0,
    duplicateHandlesResolved: 0,
    pricesNormalized: 0,
    imageCellsSplit: 0,
    extraImageRows: 0,
    invalidImagesDropped: 0,
    duplicateImagesRemoved: 0,
    rowsDropped: dropped.length + untitledRows,
    optionRows: 0,
    warnings: [],
    skuChanges: [],
    options,
    processingMs: 0,
  };

  /* ---- option values: one spelling per value in a column, and the same size written two ways made one spelling for the FILE ---- */
  for (let slot = 0; slot < OPTION_SLOTS; slot++) {
    if (!slots[slot]) continue;
    const variants = products.flatMap((product) => product.variants);
    const unified = unifyCase(variants.map((variant) => variant.values[slot]));
    variants.forEach((variant, index) => {
      variant.values[slot] = unified[index];
    });
  }
  // One canonical spelling per size, chosen over the whole file and not per product, so one shop does not get "Small" in one
  // product and "S" in another. Values are compared only within an option of the same NAME ("Size" in every product that has
  // one), because the same word means something else elsewhere: "Medium" in a "Roast" option is not a size.
  const sameName = new Map<string, Array<{ variant: Variant; slot: number }>>();
  for (const product of products) {
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      if (!slots[slot]) continue;
      const name = cleanOptionName(product.variants[0].row.raw.options?.[slot]?.name ?? "");
      const key = compactKey(name) || `option ${slot + 1}`;
      sameName.set(key, [...(sameName.get(key) ?? []), ...product.variants.map((variant) => ({ variant, slot }))]);
    }
  }
  for (const members of sameName.values()) {
    const merged = mergeEquivalentSizes(members.map(({ variant, slot }) => variant.values[slot]));
    for (const change of merged.changes) {
      const { variant, slot } = members[change.index];
      variant.values[slot] = change.to;
      findings.add("option_values_merged", variant.row.number, `${change.from} -> ${change.to}`);
    }
  }
  for (const product of products) {
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      if (!slots[slot]) continue;
      // Abbreviations are only pointed out: whether "Blk" is "Black" is for the person to say.
      for (const { short, long } of possibleAbbreviations(product.variants.map((variant) => variant.values[slot]))) {
        for (const variant of product.variants) {
          if (variant.values[slot] === short) findings.add("possible_duplicate_values", variant.row.number, `"${short}" may be "${long}" (same product)`);
        }
      }
    }
  }

  /* ---- handles: one per product, the same title again gets -2, -3 ---- */
  const usedHandles = new Map<string, number>();
  const firstProductWithTitle = new Map<string, Product>();
  const firstProductWithHandle = new Map<string, Product>();
  for (const product of products) {
    const first = product.variants[0].row;
    // From the title in the default casing, so that a handle (a URL) never changes because the person chose another casing.
    const baseHandle = product.suppliedHandle || generateHandle(product.baseTitle) || generateHandle(first.sku) || generateHandle(first.raw.id) || `product-${first.number}`;
    if (product.suppliedHandle === "") report.handlesGenerated++;
    product.handle = reserveUniqueHandle(baseHandle, usedHandles);
    if (product.handle !== baseHandle) report.duplicateHandlesResolved++;

    // The same title (or, for a file with a handle column, the same handle) again, anywhere but together with its product: a
    // separate product, said out loud, never a silent merge into the earlier one.
    const sameTitle = product.titleKey === "" ? undefined : firstProductWithTitle.get(product.titleKey);
    const sameHandle = product.suppliedHandle === "" ? undefined : firstProductWithHandle.get(product.suppliedHandle);
    if (sameTitle !== undefined) {
      findings.add("split_product", first.number, `${quoted(product.title)} again (first in row ${sameTitle.variants[0].row.number}) is now ${product.handle}`);
    } else if (sameHandle !== undefined) {
      findings.add("split_product", first.number, `handle ${quoted(product.suppliedHandle)} again (first in row ${sameHandle.variants[0].row.number}) is now ${product.handle}`);
    }
    if (product.titleKey !== "" && sameTitle === undefined) firstProductWithTitle.set(product.titleKey, product);
    if (product.suppliedHandle !== "" && sameHandle === undefined) firstProductWithHandle.set(product.suppliedHandle, product);

    // Variants that were not next to their product in the file (other rows sat between them, even ones that were then left out
    // as duplicates): they are written with it.
    // The product's own rows run from its first row to the first break; everything after the break was somewhere else.
    let together = true;
    product.variants.forEach((variant, position) => {
      if (position > 0 && variant.row.index !== product.variants[position - 1].row.index + 1) together = false;
      if (!together) findings.add("variants_apart", variant.row.number, `joins ${quoted(product.title)} (row ${first.number}), which keeps its first position`);
    });
  }

  /* ---- codes that were copied down from the product before ---- */
  for (const product of products) {
    if (product.copiedFrom === null) continue;
    const first = product.variants[0].row;
    const above = product.copiedFrom;
    const outcome = product.variants.length > 1 ? `grouped with the ${(product.variants.length - 1).toLocaleString()} ${plural(product.variants.length - 1, "row", "rows")} below it` : "kept as its own product";
    findings.add("sku_copied", first.number, `${first.codeText} is also the code of ${quoted(above.title)} above (row ${above.variants[0].row.number}); ${outcome}`);
  }

  /* ---- SKUs ---- */
  const skuSeenIn = new Map<string, { product: Product; row: number }>();
  for (const product of products) {
    const inProduct = new Map<string, number>();
    for (const { row } of product.variants) {
      if (row.sku === "") continue;
      const key = row.sku.toLowerCase();
      const earlierInProduct = inProduct.get(key);
      if (earlierInProduct !== undefined) findings.add("duplicate_sku_in_product", row.number, `${row.sku} (also in row ${earlierInProduct})`);
      else inProduct.set(key, row.number);

      const elsewhere = skuSeenIn.get(key);
      if (elsewhere === undefined) skuSeenIn.set(key, { product, row: row.number });
      else if (elsewhere.product !== product) findings.add("duplicate_sku_across_products", row.number, `${row.sku} (first used in row ${elsewhere.row})`);
    }
  }
  const { skus, changes } = resolveSkus(products, slots, options.uniqueSkus, rawRows.length);
  report.skuChanges = changes;
  for (const change of changes) findings.add("sku_changed", change.row, `${change.from} -> ${change.to}`);

  /* ---- currency (not written to the file, but a file must not mix them) ---- */
  // A row's currency comes from the Currency column and from a symbol in its price (or its cost). When they disagree the row names both.
  const currenciesOfRow = new Map<number, string[]>();
  const currencyCounts = new Map<string, number>();
  for (const row of active) {
    const symbolInPrice = currencyInPrice(row.raw.price);
    const symbolInCost = currencyInPrice(row.raw.cost ?? "");
    if (symbolInPrice !== "" || symbolInCost !== "") findings.add("currency_symbol_in_price", row.number, symbolInPrice !== "" ? row.raw.price.trim() : (row.raw.cost ?? "").trim());
    const inColumn = row.raw.currency === undefined ? "" : currencyCode(row.raw.currency);
    const named = [...new Set([inColumn, symbolInPrice, symbolInCost].filter((code) => code !== ""))];
    currenciesOfRow.set(row.index, named);
    for (const code of named) currencyCounts.set(code, (currencyCounts.get(code) ?? 0) + 1);
  }
  if (currencyCounts.size > 1) {
    const dominant = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    for (const row of active) {
      const others = (currenciesOfRow.get(row.index) ?? []).filter((code) => code !== dominant);
      if (others.length > 0) findings.add("mixed_currencies", row.number, `${others.join(", ")} (most rows are ${dominant})`);
    }
  }

  /* ---- placeholder descriptions ---- */
  for (const row of active) {
    if (row.raw.description.trim() !== "" && isPlaceholderValue(row.raw.description)) {
      findings.add("placeholder_description", row.number, quoted(cleanWhitespace(decodeEntities(row.raw.description.replace(/<[^>]*>/g, " ")))));
    }
  }

  /* ---- write the rows ---- */
  const rows: CleanedShopifyRow[] = [];
  const rowStarts: number[] = new Array(rawRows.length).fill(-1);
  // Only a file that has prices at all can be said to lack them for some rows (a file without a price column gets the column warning).
  const fileHasPrices = active.some((row) => row.raw.price.trim() !== "" || (row.raw.cost ?? "").trim() !== "");

  for (const product of products) {
    const handle = product.handle;
    const first = product.variants[0].row;
    const title = product.title;
    if (title !== first.raw.title) report.titlesFixed++;
    report.variantRows += product.variants.length - 1;

    // Product-level fields come from the first row that has them, so a placeholder on the first variant does not hide a real value on the next.
    let body = "";
    let bodySource = first;
    for (const { row } of product.variants) {
      const cleaned = cleanDescription(row.raw.description);
      if (cleaned !== "") {
        body = cleaned;
        bodySource = row;
        break;
      }
    }
    if (bodySource.raw.description.trim() !== "" && body !== bodySource.raw.description) report.descriptionsCleaned++;
    const vendor = product.variants.map(({ row }) => cleanLabel(row.raw.vendor, options.casing)).find((value) => value !== "") ?? "";
    const type = product.variants.map(({ row }) => cleanLabel(row.raw.category)).find((value) => value !== "") ?? "";
    const tags = cleanTags(product.variants.map(({ row }) => row.raw.tags ?? "").join(","));

    // Option names belong to the product: the first row names them, and a later row that calls one something else is outvoted.
    const names: OptionTriple = ["", "", ""];
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      if (slots[slot] && first.raw.options?.[slot]) names[slot] = cleanOptionName(first.raw.options[slot].name);
    }
    const namedSlots = [0, 1, 2].map((slot) => slots[slot] && product.variants.some((variant) => variant.values[slot] !== ""));

    const seenImages = new Set<string>();
    let position = 0;
    const combinations = new Map<string, number>();

    product.variants.forEach((variant, variantIndex) => {
      const { row: source, values } = variant;
      const raw = source.raw;
      rowStarts[source.index] = rows.length;

      const out = emptyShopifyRow(handle);
      if (variantIndex === 0) {
        out.Title = title;
        out.Body_HTML = body;
        out.Vendor = vendor;
        out.Type = type;
        out.Tags = tags;
        out.Status = options.status;
        out.Option1_Name = namedSlots[0] ? names[0] || "Option 1" : "";
        out.Option2_Name = namedSlots[1] ? names[1] || "Option 2" : "";
        out.Option3_Name = namedSlots[2] ? names[2] || "Option 3" : "";
      }
      out.Option1_Value = values[0];
      out.Option2_Value = values[1];
      out.Option3_Value = values[2];
      if (values.some((value) => value !== "")) report.optionRows++;

      // Prices. Variant Price is the RETAIL price only; the wholesale price goes to Cost per item. A variant without a retail
      // price (blank, TBC, POA ...) stays without one, unless the person asked for a price worked out from the wholesale price.
      const retail = normalizePrice(raw.price);
      if (raw.price.trim() !== "" && retail !== raw.price) report.pricesNormalized++;
      const cost = raw.cost !== undefined ? normalizePrice(raw.cost) : "";
      let price = retail;
      if (price === "" && options.noRetailPrice === "markup" && cost !== "") {
        price = priceFromCost(cost, options.markupPercent);
        if (price !== "") findings.add("price_from_cost", source.number, `${cost} + ${options.markupPercent}% = ${price}`);
      }
      out.Variant_Price = price;
      out.Cost_Per_Item = cost;
      if (price === "" && fileHasPrices) findings.add("missing_price", source.number, `${raw.price.trim() === "" ? "(blank)" : quoted(raw.price.trim())}${cost !== "" ? `, wholesale ${cost}` : ""}`);
      out.Variant_SKU = skus[source.index];

      if (raw.stock !== undefined) {
        const stock = parseStock(raw.stock);
        if (stock.quantity !== null) {
          out.Variant_Inventory_Qty = String(stock.quantity);
          out.Variant_Inventory_Tracker = "shopify";
          if (stock.approximate) findings.add("approximate_stock", source.number, `${quoted(cleanWhitespace(raw.stock))} written as ${stock.quantity} (at least)`);
        } else {
          findings.add("non_numeric_stock", source.number, stock.problem === "blank" ? "(blank)" : quoted(cleanWhitespace(raw.stock)));
        }
      }
      if (raw.barcode !== undefined) {
        const barcode = checkBarcode(raw.barcode);
        if (barcode.status === "valid") {
          out.Variant_Barcode = barcode.barcode;
          // Written as supplied (the length is right and it may well be the real code), but a wrong last digit is usually a typo.
          if (barcode.expectedCheckDigit !== null) findings.add("ean_check_digit", source.number, `${barcode.barcode} (the last digit should be ${barcode.expectedCheckDigit})`);
        } else if (barcode.status === "invalid") findings.add("invalid_ean", source.number, quoted(barcode.shown));
      }
      if (raw.weight !== undefined) {
        const weight = parseWeight(raw.weight, raw.weightUnit ?? "");
        if (weight.grams !== null) out.Variant_Grams = String(weight.grams);
        if (weight.invalid) findings.add("invalid_weight", source.number, quoted(cleanWhitespace(raw.weight)));
        else if (weight.assumedGrams && weight.grams !== null) findings.add("weight_unit_assumed", source.number, `${cleanWhitespace(raw.weight)} read as ${weight.grams} g`);
      }

      // Images: written once per product, numbered in order. The first goes on this variant's row, the rest on image-only rows.
      const cell = splitImageCell(raw.images);
      report.invalidImagesDropped += cell.dropped;
      report.duplicateImagesRemoved += cell.duplicates;
      if (cell.rejected.length > 0) findings.add("invalid_image_url", source.number, quoted(cell.rejected[0], 60));
      if (cell.urls.length > 1) report.imageCellsSplit++;
      const fresh = cell.urls.filter((url) => !seenImages.has(url));
      report.duplicateImagesRemoved += cell.urls.length - fresh.length;
      for (const url of fresh) seenImages.add(url);
      if (fresh.length > 0) {
        out.Image_Src = fresh[0];
        out.Image_Position = String(++position);
      }
      rows.push(out);
      for (let i = 1; i < fresh.length; i++) {
        const imageRow = emptyShopifyRow(handle);
        imageRow.Image_Src = fresh[i];
        imageRow.Image_Position = String(++position);
        rows.push(imageRow);
        report.extraImageRows++;
      }

      // What Shopify rejects and this tool cannot decide for the person.
      if (product.variants.length > 1) {
        const combination = values.filter((_, slot) => slots[slot]).join(" / ");
        const key = combination.toLowerCase();
        const earlier = combinations.get(key);
        if (earlier === undefined) combinations.set(key, source.number);
        else findings.add("duplicate_variant", source.number, `repeats row ${earlier}: ${combination === "" ? "(no option values)" : combination}`);

        const missing: string[] = [];
        for (let slot = 0; slot < OPTION_SLOTS; slot++) {
          if (slots[slot] && values[slot] === "" && namedSlots[slot]) missing.push(`"${names[slot] || `Option ${slot + 1}`}"`);
        }
        if (missing.length > 0) findings.add("missing_option_value", source.number, `no value for ${missing.join(", ")}`);

        if (variantIndex > 0) {
          for (let slot = 0; slot < OPTION_SLOTS; slot++) {
            const theirs = slots[slot] && raw.options?.[slot] ? cleanOptionName(raw.options[slot].name) : "";
            if (theirs !== "" && names[slot] !== "" && theirs.toLowerCase() !== names[slot].toLowerCase() && values[slot] !== "") {
              findings.add("option_name_conflict", source.number, `"${theirs}" here, "${names[slot]}" in row ${first.number}`);
            }
          }
        }
      }
    });
  }

  report.warnings = buildWarnings(findings, options, [...new Set(currencyCounts.keys())].sort());
  report.outputRowCount = rows.length;
  report.processingMs = Math.max(1, Math.round(now() - startedAt));
  return { rows, report, rowStarts };
}

/* -------------------------------------------------------------------------- */
/*  Warnings: the sentences                                                    */
/* -------------------------------------------------------------------------- */

interface WarningText {
  severity: SanitizeWarning["severity"];
  title: string;
  message: (count: number, options: SanitizeOptions, currencies: string[]) => string;
  resolution?: (options: SanitizeOptions) => string | undefined;
}

const UNIQUE_SKU_HINT = ' Switch on "Make SKUs unique per variant" to tell them apart.';

/** In the order the panel lists them: the problems that break an import first, the notes about what was fixed last. */
const WARNING_ORDER: ReadonlyArray<readonly [WarningKind, WarningText]> = [
  ["summary_rows", {
    severity: "warning",
    title: "Summary rows removed",
    message: (n) => `${n.toLocaleString()} summary ${plural(n, "row", "rows")} removed. A line such as TOTAL, SUBTOTAL or COUNT, or a line with only numbers, is not a product, so ${plural(n, "it was", "they were")} left out.`,
  }],
  ["untitled_row", {
    severity: "warning",
    title: "Rows without a title",
    message: (n) => `${n.toLocaleString()} ${plural(n, "row has", "rows have")} no title and could not be attached to any product, so ${plural(n, "it was", "they were")} left out. Shopify needs a title for every product, and none is made up.`,
  }],
  ["duplicate_row", {
    severity: "warning",
    title: "Exact duplicate rows removed",
    message: (n) => `${n.toLocaleString()} exact duplicate ${plural(n, "row", "rows")} removed: every cell is the same as in an earlier row, which was kept. Switch off "Remove exact duplicates" to keep them.`,
  }],
  ["split_product", {
    severity: "warning",
    title: "Same title, separate products",
    message: (n) => `${n.toLocaleString()} ${plural(n, "product has", "products have")} the same title (or handle) as an earlier product, under another product code or not next to it. Each was kept as its own product with its own handle: the second gets -2, the third -3. If they are really variants of one product, put them next to each other and give them the same product code.`,
  }],
  ["variants_apart", {
    severity: "warning",
    title: "Variants were not next to their product",
    message: (n) => `${n.toLocaleString()} ${plural(n, "variant was", "variants were")} not next to ${plural(n, "its", "their")} product: other rows sat in between. Same product code and same title, so ${plural(n, "it was", "they were")} grouped with the product, which keeps its first position.`,
  }],
  ["sku_copied", {
    severity: "warning",
    title: "SKU copied from previous product",
    message: (n) => `${n.toLocaleString()} ${plural(n, "product starts", "products start")} with the same SKU as the different product right before ${plural(n, "it", "them")}. A copied code cannot say which product a row belongs to, so the title and the option values decided: rows right below with the same title and other option values were grouped with it, and its SKU stays unique when "Make SKUs unique per variant" is on.`,
  }],
  ["duplicate_variant", {
    severity: "warning",
    title: "Duplicate variants",
    message: (n) => `${n.toLocaleString()} ${plural(n, "variant repeats", "variants repeat")} the option values of another variant of the same product. Shopify refuses that ("Option values are not unique"), so give each variant its own values.`,
  }],
  ["missing_option_value", {
    severity: "warning",
    title: "Variants missing an option value",
    message: (n) => `${n.toLocaleString()} variant ${plural(n, "row has", "rows have")} no value for an option that other variants of the same product have. Shopify needs a value on every variant.`,
  }],
  ["option_name_conflict", {
    severity: "warning",
    title: "Option named differently",
    message: (n) => `${n.toLocaleString()} variant ${plural(n, "row names", "rows name")} an option differently from the product's first row. Shopify takes the names from the first row, so that is what was written.`,
  }],
  ["option_values_merged", {
    severity: "info",
    title: "Option values merged",
    message: (n) => `${n.toLocaleString()} option ${plural(n, "value was", "values were")} the same size written two ways (for example S and Small) and ${plural(n, "was", "were")} changed to the spelling the whole file uses most, so every product says the same.`,
  }],
  ["possible_duplicate_values", {
    severity: "info",
    title: "Possible duplicates",
    message: (n) => `${n.toLocaleString()} option ${plural(n, "value looks", "values look")} like an abbreviation of another value of the same product (for example "Blk" and "Black"). Nothing was changed: check whether they are the same.`,
  }],
  ["duplicate_sku_in_product", {
    severity: "warning",
    title: "Duplicate SKUs within a product",
    message: (n, options) => `${n.toLocaleString()} ${plural(n, "variant uses", "variants use")} the same SKU as another variant of the same product.${options.uniqueSkus ? "" : UNIQUE_SKU_HINT}`,
    resolution: (options) => (options.uniqueSkus ? "Made unique by adding each variant's option values (the changed SKUs are listed below)." : undefined),
  }],
  ["duplicate_sku_across_products", {
    severity: "warning",
    title: "Duplicate SKUs across products",
    message: (n, options) => `${n.toLocaleString()} ${plural(n, "variant uses", "variants use")} a SKU that already belongs to a different product.${options.uniqueSkus ? "" : UNIQUE_SKU_HINT}`,
    resolution: (options) => (options.uniqueSkus ? "Made unique (the changed SKUs are listed below)." : undefined),
  }],
  ["sku_changed", {
    severity: "info",
    title: "SKUs made unique",
    message: (n) => `${n.toLocaleString()} ${plural(n, "SKU was", "SKUs were")} changed so that every variant has its own.`,
  }],
  ["missing_price", {
    severity: "warning",
    title: "Variants without a price",
    message: (n, options) => `${n.toLocaleString()} ${plural(n, "variant has", "variants have")} no retail price (blank, TBC, POA ...), so Variant Price is empty for ${plural(n, "it", "them")}.${options.noRetailPrice === "markup" ? " No wholesale price to work one out from, either." : ' Set the price in Shopify, or choose "use wholesale x markup" in the export options.'}`,
  }],
  ["price_from_cost", {
    severity: "info",
    title: "Prices worked out from wholesale",
    message: (n, options) => `${n.toLocaleString()} ${plural(n, "price was", "prices were")} worked out as the wholesale price plus ${options.markupPercent}% because the retail price was missing.`,
  }],
  ["invalid_ean", {
    severity: "warning",
    title: "Invalid EAN",
    message: (n) => `${n.toLocaleString()} ${plural(n, "barcode is", "barcodes are")} not 8, 12, 13 or 14 digits, so Variant Barcode was left empty for ${plural(n, "it", "them")}.`,
  }],
  ["ean_check_digit", {
    severity: "warning",
    title: "EAN check digit does not match",
    message: (n) => `${n.toLocaleString()} ${plural(n, "barcode has", "barcodes have")} the right length but a last digit that does not match the others (the GS1 check digit), so ${plural(n, "it may contain", "they may contain")} a typo. ${plural(n, "It was", "They were")} written as supplied: check ${plural(n, "it", "them")} against the product.`,
  }],
  ["approximate_stock", {
    severity: "warning",
    title: "Approximate stock",
    message: (n) => `${n.toLocaleString()} ${plural(n, "quantity was", "quantities were")} given as "more than ..." (for example ">100") and ${plural(n, "was", "were")} written as that number. The real stock is at least that, and may be higher.`,
  }],
  ["non_numeric_stock", {
    severity: "warning",
    title: "Stock without a number",
    message: (n) => `${n.toLocaleString()} ${plural(n, "variant has", "variants have")} a stock that is blank or not a whole number (for example "In stock" or "skladem"), so Variant Inventory Qty was left empty for ${plural(n, "it", "them")}.`,
  }],
  ["invalid_weight", {
    severity: "warning",
    title: "Unreadable weight",
    message: (n) => `${n.toLocaleString()} ${plural(n, "weight", "weights")} could not be read as a number with an optional unit, so Variant Grams was left empty for ${plural(n, "it", "them")}.`,
  }],
  ["weight_unit_assumed", {
    severity: "info",
    title: "Weight without a unit",
    message: (n) => `${n.toLocaleString()} ${plural(n, "weight has", "weights have")} no unit, and neither has the column header, so grams were assumed.`,
  }],
  ["placeholder_description", {
    severity: "warning",
    title: "Placeholder descriptions",
    message: (n) => `${n.toLocaleString()} ${plural(n, "row has", "rows have")} a description that only says there is none (for example "popis není k dispozici" or "N/A").`,
    resolution: () => "Treated as empty, so no placeholder text reaches the shop.",
  }],
  ["mixed_currencies", {
    severity: "warning",
    title: "Mixed currencies",
    message: (n, _options, currencies) => `This file mixes currencies (${currencies.join(", ")}). Shopify prices have no currency, so every price is read in your store's currency: check the ${n.toLocaleString()} ${plural(n, "row", "rows")} listed.`,
  }],
  ["currency_symbol_in_price", {
    severity: "info",
    title: "Currency symbol in the price",
    message: (n) => `${n.toLocaleString()} ${plural(n, "price includes", "prices include")} a currency symbol or code (for example "Kč 999,99").`,
    resolution: () => "Removed: prices are written as plain numbers in your store's currency.",
  }],
  ["invalid_image_url", {
    severity: "warning",
    title: "Image links that are not http(s)",
    message: (n) => `${n.toLocaleString()} ${plural(n, "row has", "rows have")} an image link that is not a web (http or https) address, so it was left out. Shopify can only fetch images from the web.`,
  }],
];

function buildWarnings(findings: Findings, options: SanitizeOptions, currencies: string[]): SanitizeWarning[] {
  const warnings: SanitizeWarning[] = [];
  for (const [kind, text] of WARNING_ORDER) {
    const group = findings.get(kind);
    if (!group) continue;
    const resolution = text.resolution?.(options);
    warnings.push({
      kind,
      severity: text.severity,
      title: text.title,
      message: text.message(group.count, options, currencies),
      count: group.count,
      rows: group.rows,
      ...(resolution ? { resolution } : {}),
      ...(group.details.some((detail) => detail !== "") ? { details: group.details } : {}),
    });
  }
  return warnings;
}

/** Individual fixes the cleaner applied (titles, descriptions, handles, image cells, prices). This is what telemetry records. */
export function countFixes(report: SanitizeReport): number {
  return (
    report.titlesFixed +
    report.descriptionsCleaned +
    report.handlesGenerated +
    report.imageCellsSplit +
    report.pricesNormalized
  );
}

/**
 * Pairs the first `limit` supplier rows that made it into the file with their cleaned row and the image-only rows that follow
 * it, for the before/after preview. `rowStarts` comes from sanitizeDataset: a row that is not in the output (-1) is skipped, and
 * a row's own rows run to the next start, wherever that is, because rows of one product are written together.
 */
export function buildPreviewPairs(
  rawData: RawSupplierRow[],
  cleanedData: CleanedShopifyRow[],
  rowStarts: number[],
  limit = 5,
): PreviewPair[] {
  const starts = [...new Set(rowStarts.filter((start) => start >= 0))].sort((a, b) => a - b);
  const pairs: PreviewPair[] = [];
  for (let i = 0; i < Math.min(rowStarts.length, rawData.length) && pairs.length < limit; i++) {
    const start = rowStarts[i];
    if (start < 0) continue;
    const next = starts.find((candidate) => candidate > start);
    const primary = cleanedData[start];
    pairs.push({
      raw: rawData[i],
      primary,
      extraImageRows: cleanedData.slice(start + 1, next ?? cleanedData.length),
      isVariantRow: primary.Title === "",
    });
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/*  7. Shopify CSV columns                                                     */
/* -------------------------------------------------------------------------- */

/** The six columns every file has, exactly as the Shopify product importer expects them. */
export const SHOPIFY_COLUMNS: ReadonlyArray<{ key: keyof CleanedShopifyRow; header: string }> = [
  { key: "Handle", header: "Handle" },
  { key: "Title", header: "Title" },
  { key: "Body_HTML", header: "Body (HTML)" },
  { key: "Image_Src", header: "Image Src" },
  { key: "Variant_Price", header: "Variant Price" },
  { key: "Variant_SKU", header: "Variant SKU" },
];

type Column = { key: keyof CleanedShopifyRow; header: string };

/** The option columns, written only for the options a file actually has (a file without variants gets none). */
export const SHOPIFY_OPTION_COLUMNS: ReadonlyArray<ReadonlyArray<Column>> = [
  [{ key: "Option1_Name", header: "Option1 Name" }, { key: "Option1_Value", header: "Option1 Value" }],
  [{ key: "Option2_Name", header: "Option2 Name" }, { key: "Option2_Value", header: "Option2 Value" }],
  [{ key: "Option3_Name", header: "Option3 Name" }, { key: "Option3_Value", header: "Option3 Value" }],
];

/** Written only when the file gave something for them, in the order the importer's own template lists them. */
const CATALOG_COLUMNS_BEFORE_IMAGES: ReadonlyArray<Column> = [
  { key: "Vendor", header: "Vendor" },
  { key: "Type", header: "Type" },
  { key: "Tags", header: "Tags" },
];
const CATALOG_COLUMNS_AFTER_OPTIONS: ReadonlyArray<Column> = [
  { key: "Variant_Barcode", header: "Variant Barcode" },
  { key: "Variant_Grams", header: "Variant Grams" },
  { key: "Variant_Inventory_Tracker", header: "Variant Inventory Tracker" },
  { key: "Variant_Inventory_Qty", header: "Variant Inventory Qty" },
  { key: "Cost_Per_Item", header: "Cost per item" },
];

/** The header of any column this tool can write, for the screens that name a field ("Variant Barcode"). */
export function shopifyHeaderOf(key: keyof CleanedShopifyRow): string {
  const all: Column[] = [
    ...SHOPIFY_COLUMNS,
    ...SHOPIFY_OPTION_COLUMNS.flat(),
    ...CATALOG_COLUMNS_BEFORE_IMAGES,
    ...CATALOG_COLUMNS_AFTER_OPTIONS,
    { key: "Image_Position", header: "Image Position" },
    { key: "Status", header: "Status" },
  ];
  return all.find((column) => column.key === key)?.header ?? key;
}

/**
 * The columns to write for these rows: the six every file has; Vendor, Type, Tags, Image Position, Variant Barcode, Variant
 * Grams and the inventory pair when some row has a value for them; Option1..3 Name and Value for each option in use; and
 * Status, which every file gets.
 */
export function shopifyColumnsFor(rows: CleanedShopifyRow[]): Column[] {
  const has = (key: keyof CleanedShopifyRow): boolean => rows.some((row) => row[key] !== "");
  const columns: Column[] = [SHOPIFY_COLUMNS[0], SHOPIFY_COLUMNS[1], SHOPIFY_COLUMNS[2]];
  columns.push(...CATALOG_COLUMNS_BEFORE_IMAGES.filter((column) => has(column.key)));
  columns.push(SHOPIFY_COLUMNS[3]);
  if (has("Image_Position")) columns.push({ key: "Image_Position", header: "Image Position" });
  columns.push(SHOPIFY_COLUMNS[4], SHOPIFY_COLUMNS[5]);
  SHOPIFY_OPTION_COLUMNS.forEach((pair) => {
    if (pair.some((column) => has(column.key))) columns.push(...pair);
  });
  columns.push(...CATALOG_COLUMNS_AFTER_OPTIONS.filter((column) => has(column.key)));
  columns.push({ key: "Status", header: "Status" });
  return columns;
}
