// src/app/utils/sanitizer.ts

import type {
  CleanedShopifyRow,
  PreviewPair,
  RawSupplierRow,
  SanitizeReport,
} from "../types/csv";

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

const PLACEHOLDER_RE = /^(n\/a|na|n\.a\.|null|nil|none|undefined|tbd|tba|-+|\.+|_+|#n\/a|#null!?)$/i;

/** Suppliers love filling empty cells with "N/A", "null", "-" ... treat those as empty. */
function emptyIfPlaceholder(value: string): string {
  return PLACEHOLDER_RE.test(value.trim()) ? "" : value;
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

/** Converts text to professional Title Case (small words stay lower case, acronyms and units are preserved). */
export function toTitleCase(text: string): string {
  const tokens = text.split(" ");
  const lastIndex = tokens.length - 1;
  return tokens
    .map((token, index) => formatToken(token, index === 0 || index === lastIndex))
    .join(" ");
}

/**
 * Full title pipeline: strips markup and entities, removes rogue whitespace
 * and fixes ALL CAPS / all lower case titles. Already well-formed mixed-case
 * titles ("Blue T-Shirt", "iPhone Case") are left alone.
 */
export function normalizeTitle(input: string): string {
  const withoutTags = input.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  const text = cleanWhitespace(decodeEntities(withoutTags));
  if (text === "") return "";
  return needsRecase(text) ? toTitleCase(text) : text;
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
  const source = emptyIfPlaceholder(decodeEntities(input)).trim();
  if (source === "") return { urls: [], dropped: 0 };

  const seen = new Set<string>();
  const urls: string[] = [];
  let dropped = 0;

  for (const piece of source.split(IMAGE_SPLIT_RE)) {
    if (piece.trim() === "") continue;
    const url = normalizeImageUrl(piece);
    if (url === null) {
      dropped++;
    } else if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return { urls, dropped };
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

const FALLBACK_TITLE = "Untitled Product";

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
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/* -------------------------------------------------------------------------- */
/*  Variant options (Option1/2/3 Name and Value)                               */
/* -------------------------------------------------------------------------- */

const OPTION_SLOTS = 3;
const MAX_OPTION_LENGTH = 255;
const EXAMPLES = 2;

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

/**
 * Which option slots end up in the output. A column from Option1 Value style headers is used as soon as any row has a
 * value. A plain attribute column ("Size", "Style") is used only if it tells variants of one product apart, i.e. some
 * product has rows with different values in it: otherwise it is a description of the product, not a variant option.
 */
function chooseOptionSlots(rawRows: RawSupplierRow[]): boolean[] {
  const inUse = [false, false, false];
  const derived = [false, false, false];
  const groups = new Map<string, Array<Set<string>>>();

  for (const raw of rawRows) {
    if (!raw.options) continue;
    const values = optionValuesOf(raw);
    const handle = raw.handle ? generateHandle(raw.handle) : "";
    const title = normalizeTitle(raw.title).toLowerCase();
    const key = handle ? `h:${handle}` : title ? `t:${title}` : "";
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      if (!raw.options[slot]) continue;
      derived[slot] = raw.options[slot].derived;
      if (values[slot] === "") continue;
      if (!raw.options[slot].derived) inUse[slot] = true;
      if (key === "") continue;
      const sets = groups.get(key) ?? [new Set<string>(), new Set<string>(), new Set<string>()];
      sets[slot].add(values[slot].toLowerCase());
      groups.set(key, sets);
    }
  }
  for (const sets of groups.values()) {
    for (let slot = 0; slot < OPTION_SLOTS; slot++) if (derived[slot] && sets[slot].size >= 2) inUse[slot] = true;
  }
  return inUse;
}

/** One product's first row, which the later rows of the same product attach to. */
interface ProductHead {
  handle: string;
  title: string;
  /** Source row number (1-based) of each row of the product, and its option values, for the checks at the end. */
  rows: Array<{ number: number; values: OptionTriple }>;
  names: OptionTriple;
  /** What the product is grouped by, for the message about rows that are not together. */
  groupedBy: "handle" | "title";
  lastSourceIndex: number;
  /** Where the product's first row sits in the output, so its option names can be completed once all variants are known. */
  outputIndex: number;
}

export interface SanitizeResult {
  rows: CleanedShopifyRow[];
  report: SanitizeReport;
  /** rowStarts[i] is where source row i begins in `rows`; it ends where source row i + 1 begins. */
  rowStarts: number[];
}

/**
 * Cleans every supplier row and flattens the result into Shopify import rows.
 *
 * - A product with N images becomes N rows: the first carries the product data, the others only `Handle` + `Image_Src`.
 * - Multi-row variants: when the supplier file repeats a handle (the usual Shopify layout, one row per variant), the
 *   later rows are variants of the first row's product. They keep that handle (never "-2"), carry no Title or
 *   Body of their own, and keep their own price, SKU, option values and images. A repeated handle with a *different*
 *   title is a different product that happens to collide, so it still gets a unique handle. Without a handle column,
 *   rows with the same title and option values are variants of one product too.
 * - Options: Option1/2/3 Name and Value. The names are product-level, so they appear only on a product's first row;
 *   every variant row has its own values.
 */
export function sanitizeDataset(rawRows: RawSupplierRow[]): SanitizeResult {
  const startedAt = now();
  const usedHandles = new Map<string, number>();
  const productHeads = new Map<string, ProductHead>();
  const rows: CleanedShopifyRow[] = [];
  const rowStarts: number[] = [];
  const slots = chooseOptionSlots(rawRows);
  let nameConflicts = 0;
  let nameConflictExample = "";
  let apart = 0;
  let apartExample = 0;
  let apartBy: "handle" | "title" = "handle";

  const report: SanitizeReport = {
    sourceRows: rawRows.length,
    productCount: 0,
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
    optionRows: 0,
    notices: [],
    processingMs: 0,
  };

  rawRows.forEach((raw, index) => {
    rowStarts.push(rows.length);

    const suppliedHandle = raw.handle ? generateHandle(raw.handle) : "";
    const cleanedTitle = normalizeTitle(raw.title);
    const values = optionValuesOf(raw).map((value, slot) => (slots[slot] ? value : "")) as OptionTriple;
    const hasOptions = values.some((value) => value !== "");
    if (hasOptions) report.optionRows++;

    // What ties rows to one product: a supplied handle, or (without one) the same title on rows that carry option values.
    const groupKey = suppliedHandle ? `h:${suppliedHandle}` : hasOptions && cleanedTitle !== "" ? `t:${cleanedTitle.toLowerCase()}` : "";
    const head = groupKey ? productHeads.get(groupKey) : undefined;
    const isVariant = head !== undefined && (suppliedHandle === "" || cleanedTitle === "" || cleanedTitle === head.title);

    const title = isVariant ? "" : cleanedTitle || FALLBACK_TITLE;
    if (!isVariant && title !== raw.title) report.titlesFixed++;

    const body = isVariant ? "" : cleanDescription(raw.description);
    if (!isVariant && raw.description.trim() !== "" && body !== raw.description) report.descriptionsCleaned++;

    const price = normalizePrice(raw.price);
    if (raw.price.trim() !== "" && price !== raw.price) report.pricesNormalized++;

    const sku = normalizeSku(raw.sku);
    const { urls, dropped } = splitImageUrls(raw.images);
    report.invalidImagesDropped += dropped;
    if (urls.length > 1) {
      report.imageCellsSplit++;
      report.extraImageRows += urls.length - 1;
    }

    let handle: string;
    let names: OptionTriple = ["", "", ""];
    if (head !== undefined && isVariant) {
      handle = head.handle;
      report.variantRows++;
      head.rows.push({ number: index + 1, values });
      if (head.lastSourceIndex !== index - 1) {
        apart++;
        apartBy = head.groupedBy;
        if (apartExample === 0) apartExample = index + 1;
      }
      head.lastSourceIndex = index;
      // The first row names the options. A later row that calls one something else is outvoted.
      for (let slot = 0; slot < OPTION_SLOTS; slot++) {
        const theirs = slots[slot] && raw.options?.[slot] ? cleanOptionName(raw.options[slot].name) : "";
        if (theirs !== "" && head.names[slot] !== "" && theirs.toLowerCase() !== head.names[slot].toLowerCase() && values[slot] !== "") {
          nameConflicts++;
          if (nameConflictExample === "") nameConflictExample = `"${theirs}" in row ${index + 1}, "${head.names[slot]}" in the product's first row`;
        }
      }
    } else {
      const baseHandle =
        suppliedHandle ||
        generateHandle(title === FALLBACK_TITLE ? "" : title) ||
        generateHandle(sku) ||
        generateHandle(raw.id) ||
        `product-${index + 1}`;
      if (suppliedHandle === "") report.handlesGenerated++;

      handle = reserveUniqueHandle(baseHandle, usedHandles);
      if (handle !== baseHandle) report.duplicateHandlesResolved++;

      const firstNames: OptionTriple = ["", "", ""];
      for (let slot = 0; slot < OPTION_SLOTS; slot++) {
        if (slots[slot] && raw.options?.[slot]) firstNames[slot] = cleanOptionName(raw.options[slot].name);
      }
      names = firstNames;
      if (groupKey !== "" && !productHeads.has(groupKey)) {
        productHeads.set(groupKey, {
          handle,
          title,
          rows: [{ number: index + 1, values }],
          names: firstNames,
          groupedBy: suppliedHandle ? "handle" : "title",
          lastSourceIndex: index,
          outputIndex: rows.length,
        });
      }
    }

    const row = emptyShopifyRow(handle);
    row.Title = title;
    row.Body_HTML = body;
    row.Image_Src = urls.length > 0 ? urls[0] : "";
    row.Variant_Price = price;
    row.Variant_SKU = sku;
    row.Option1_Value = values[0];
    row.Option2_Value = values[1];
    row.Option3_Value = values[2];
    // Names are product-level: first row only, and only for options this row (or product) actually has a value for.
    if (!isVariant) {
      row.Option1_Name = values[0] !== "" ? names[0] : "";
      row.Option2_Name = values[1] !== "" ? names[1] : "";
      row.Option3_Name = values[2] !== "" ? names[2] : "";
    }
    rows.push(row);

    for (let i = 1; i < urls.length; i++) {
      const imageRow = emptyShopifyRow(handle);
      imageRow.Image_Src = urls[i];
      rows.push(imageRow);
    }
  });

  // A product's first row names the options even when that row's own value is empty, so the variants below it are not left
  // with values for an option that has no name (the empty value itself is reported in the notices).
  for (const head of productHeads.values()) {
    for (let slot = 0; slot < OPTION_SLOTS; slot++) {
      const key = `Option${slot + 1}_Name` as "Option1_Name" | "Option2_Name" | "Option3_Name";
      if (slots[slot] && rows[head.outputIndex][key] === "" && head.rows.some((entry) => entry.values[slot] !== "")) {
        rows[head.outputIndex][key] = head.names[slot] || `Option ${slot + 1}`;
      }
    }
  }

  report.notices = variantNotices([...productHeads.values()], slots, { apart, apartExample, apartBy, nameConflicts, nameConflictExample });
  report.productCount = rawRows.length - report.variantRows;
  report.outputRowCount = rows.length;
  report.processingMs = Math.max(1, Math.round(now() - startedAt));
  return { rows, report, rowStarts };
}

/**
 * The problems with variants that this tool cannot fix by itself, said so the user can. Shopify rejects duplicate option
 * combinations and variants without a value, and expects a product's rows together.
 */
function variantNotices(
  heads: ProductHead[],
  slots: boolean[],
  extra: { apart: number; apartExample: number; apartBy: "handle" | "title"; nameConflicts: number; nameConflictExample: string },
): string[] {
  const notices: string[] = [];
  let duplicates = 0;
  const duplicateExamples: string[] = [];
  const missing = [0, 0, 0];
  const missingExamples: number[] = [0, 0, 0];

  for (const head of heads) {
    if (head.rows.length < 2) continue;
    const seen = new Map<string, number>();
    for (const { number, values } of head.rows) {
      const combination = values.filter((_, slot) => slots[slot]).join(" / ");
      if (combination.replace(/ \/ /g, "") !== "") {
        const key = combination.toLowerCase();
        if (seen.has(key)) {
          duplicates++;
          if (duplicateExamples.length < EXAMPLES) duplicateExamples.push(`row ${number} repeats row ${seen.get(key)}: ${combination}`);
        } else seen.set(key, number);
      }
      for (let slot = 0; slot < OPTION_SLOTS; slot++) {
        const siblingsHaveValue = head.rows.some((other) => other.values[slot] !== "");
        if (slots[slot] && values[slot] === "" && siblingsHaveValue) {
          missing[slot]++;
          if (missingExamples[slot] === 0) missingExamples[slot] = number;
        }
      }
    }
  }

  if (duplicates > 0) {
    notices.push(
      `${duplicates.toLocaleString()} variant${duplicates === 1 ? " repeats" : "s repeat"} the option values of another variant of the same product (${duplicateExamples.join("; ")}). Shopify refuses that ("Option values are not unique"), so give each variant its own values.`,
    );
  }
  for (let slot = 0; slot < OPTION_SLOTS; slot++) {
    if (missing[slot] > 0) {
      const name = heads.find((head) => head.names[slot] !== "")?.names[slot] || `Option ${slot + 1}`;
      notices.push(
        `${missing[slot].toLocaleString()} variant row${missing[slot] === 1 ? " has" : "s have"} no value for "${name}" although other variants of the same product do (for example row ${missingExamples[slot]}). Shopify needs a value on every variant.`,
      );
    }
  }
  if (extra.apart > 0) {
    notices.push(
      `${extra.apart.toLocaleString()} variant row${extra.apart === 1 ? " is" : "s are"} not next to the rest of ${extra.apart === 1 ? "its" : "their"} product (for example row ${extra.apartExample}). Shopify expects a product's rows together, so sort the file by ${extra.apartBy} first.`,
    );
  }
  if (extra.nameConflicts > 0) {
    notices.push(
      `${extra.nameConflicts.toLocaleString()} variant row${extra.nameConflicts === 1 ? " names" : "s name"} an option differently from its product's first row (${extra.nameConflictExample}). Shopify takes the names from the first row, so that is what was written.`,
    );
  }
  return notices;
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
 * Pairs the first `limit` supplier rows with their cleaned product row and the image-only rows that follow it,
 * for the before/after preview. `rowStarts` comes from sanitizeDataset, so this stays exact with variant rows.
 */
export function buildPreviewPairs(
  rawData: RawSupplierRow[],
  cleanedData: CleanedShopifyRow[],
  rowStarts: number[],
  limit = 5,
): PreviewPair[] {
  const count = Math.min(limit, rowStarts.length, rawData.length);
  const pairs: PreviewPair[] = [];
  for (let i = 0; i < count; i++) {
    const start = rowStarts[i];
    const end = i + 1 < rowStarts.length ? rowStarts[i + 1] : cleanedData.length;
    const primary = cleanedData[start];
    pairs.push({
      raw: rawData[i],
      primary,
      extraImageRows: cleanedData.slice(start + 1, end),
      isVariantRow: primary.Title === "",
    });
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/*  7. Shopify CSV columns                                                     */
/* -------------------------------------------------------------------------- */

/** Column titles exactly as the Shopify product importer expects them. */
export const SHOPIFY_COLUMNS: ReadonlyArray<{ key: keyof CleanedShopifyRow; header: string }> = [
  { key: "Handle", header: "Handle" },
  { key: "Title", header: "Title" },
  { key: "Body_HTML", header: "Body (HTML)" },
  { key: "Image_Src", header: "Image Src" },
  { key: "Variant_Price", header: "Variant Price" },
  { key: "Variant_SKU", header: "Variant SKU" },
];

/** The option columns, written only for the options a file actually has (a file without variants gets none). */
export const SHOPIFY_OPTION_COLUMNS: ReadonlyArray<ReadonlyArray<{ key: keyof CleanedShopifyRow; header: string }>> = [
  [{ key: "Option1_Name", header: "Option1 Name" }, { key: "Option1_Value", header: "Option1 Value" }],
  [{ key: "Option2_Name", header: "Option2 Name" }, { key: "Option2_Value", header: "Option2 Value" }],
  [{ key: "Option3_Name", header: "Option3 Name" }, { key: "Option3_Value", header: "Option3 Value" }],
];

/** The columns to write for these rows: the base columns, plus Option1..3 Name and Value for each option in use. */
export function shopifyColumnsFor(rows: CleanedShopifyRow[]): Array<{ key: keyof CleanedShopifyRow; header: string }> {
  const columns = [...SHOPIFY_COLUMNS];
  SHOPIFY_OPTION_COLUMNS.forEach((pair, slot) => {
    const used = rows.some((row) => row[`Option${slot + 1}_Value` as keyof CleanedShopifyRow] !== "" || row[`Option${slot + 1}_Name` as keyof CleanedShopifyRow] !== "");
    if (used) columns.push(...pair);
  });
  return columns;
}
