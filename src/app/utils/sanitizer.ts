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
]);

const UNIT_FORMAT = new Map<string, string>([
  ["ml", "ml"], ["cl", "cl"], ["l", "L"], ["g", "g"], ["kg", "kg"], ["mg", "mg"],
  ["cm", "cm"], ["mm", "mm"], ["m", "m"], ["oz", "oz"], ["lb", "lb"], ["lbs", "lbs"],
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

function textToMarkedText(text: string, hasMarkup: boolean): string {
  const decoded = decodeEntities(text).replace(/\u00A0/g, " ");
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

  let marked = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    marked += textToMarkedText(html.slice(last, match.index), hasMarkup);
    marked += tagToMarker(match[1] === "/", match[2].toLowerCase());
    last = tagRe.lastIndex;
  }
  marked += textToMarkedText(html.slice(last), hasMarkup);

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
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Cleans every supplier row and flattens the result into Shopify import rows.
 * A product with N images becomes N rows: the first carries the product data,
 * the others carry only `Handle` + `Image_Src`.
 */
export function sanitizeDataset(rawRows: RawSupplierRow[]): {
  rows: CleanedShopifyRow[];
  report: SanitizeReport;
} {
  const startedAt = now();
  const usedHandles = new Map<string, number>();
  const rows: CleanedShopifyRow[] = [];

  const report: SanitizeReport = {
    productCount: rawRows.length,
    outputRowCount: 0,
    titlesFixed: 0,
    descriptionsCleaned: 0,
    handlesGenerated: 0,
    duplicateHandlesResolved: 0,
    pricesNormalized: 0,
    imageCellsSplit: 0,
    extraImageRows: 0,
    invalidImagesDropped: 0,
    processingMs: 0,
  };

  rawRows.forEach((raw, index) => {
    const title = normalizeTitle(raw.title) || FALLBACK_TITLE;
    if (title !== raw.title) report.titlesFixed++;

    const body = cleanDescription(raw.description);
    if (raw.description.trim() !== "" && body !== raw.description) report.descriptionsCleaned++;

    const price = normalizePrice(raw.price);
    if (raw.price.trim() !== "" && price !== raw.price) report.pricesNormalized++;

    const sku = normalizeSku(raw.sku);
    const { urls, dropped } = splitImageUrls(raw.images);
    report.invalidImagesDropped += dropped;
    if (urls.length > 1) {
      report.imageCellsSplit++;
      report.extraImageRows += urls.length - 1;
    }

    const suppliedHandle = raw.handle ? generateHandle(raw.handle) : "";
    const baseHandle =
      suppliedHandle ||
      generateHandle(title === FALLBACK_TITLE ? "" : title) ||
      generateHandle(sku) ||
      generateHandle(raw.id) ||
      `product-${index + 1}`;
    if (suppliedHandle === "") report.handlesGenerated++;

    const handle = reserveUniqueHandle(baseHandle, usedHandles);
    if (handle !== baseHandle) report.duplicateHandlesResolved++;

    rows.push({
      Handle: handle,
      Title: title,
      Body_HTML: body,
      Image_Src: urls.length > 0 ? urls[0] : "",
      Variant_Price: price,
      Variant_SKU: sku,
    });

    for (let i = 1; i < urls.length; i++) {
      const imageRow = emptyShopifyRow(handle);
      imageRow.Image_Src = urls[i];
      rows.push(imageRow);
    }
  });

  report.outputRowCount = rows.length;
  report.processingMs = Math.max(1, Math.round(now() - startedAt));
  return { rows, report };
}

/**
 * Pairs the first `limit` supplier rows with their cleaned product row and the
 * image-only rows that follow it, for the before/after preview.
 */
export function buildPreviewPairs(
  rawData: RawSupplierRow[],
  cleanedData: CleanedShopifyRow[],
  limit = 5,
): PreviewPair[] {
  const pairs: PreviewPair[] = [];
  let cursor = 0;

  for (let i = 0; i < rawData.length && pairs.length < limit && cursor < cleanedData.length; i++) {
    const primary = cleanedData[cursor];
    let end = cursor + 1;
    while (
      end < cleanedData.length &&
      cleanedData[end].Handle === primary.Handle &&
      cleanedData[end].Title === ""
    ) {
      end++;
    }
    pairs.push({ raw: rawData[i], primary, extraImageRows: cleanedData.slice(cursor + 1, end) });
    cursor = end;
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/*  7. Shopify CSV export                                                      */
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

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes cleaned rows to RFC 4180 CSV (CRLF line endings, quoted when needed). */
export function toShopifyCsv(rows: CleanedShopifyRow[]): string {
  const lines: string[] = new Array(rows.length + 1);
  lines[0] = SHOPIFY_COLUMNS.map((column) => escapeCsvField(column.header)).join(",");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines[i + 1] = SHOPIFY_COLUMNS.map((column) => escapeCsvField(row[column.key])).join(",");
  }
  return lines.join("\r\n") + "\r\n";
}

/** "supplier-feed.csv" becomes "supplier-feed-shopify-clean.csv". */
export function buildOutputFileName(originalName: string | null): string {
  const base = (originalName ?? "products").replace(/\.[^.]+$/, "").trim();
  const safe = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "products"}-shopify-clean.csv`;
}