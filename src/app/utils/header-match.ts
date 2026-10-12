// src/app/utils/header-match.ts
//
// Matches a file's column headers to the columns this tool understands (the names are in header-aliases.ts).
// Three passes, each only for headers and columns still unclaimed by an earlier one:
//   1. exact:    the header is a known name. Case, accents and punctuation do not matter, and neither do a currency or a unit
//                in brackets ("Price (EUR)" is "Price").
//   2. contains: the known name is a whole part of a longer header ("Wholesale Price per Unit (USD)"), and covers more than half
//                of what the header says, so "Colour Code" is not a SKU column just because it has "code" in it.
//   3. similar:  the header is a misspelling of a known name ("Descripton"). Reported, so nobody wonders.
// Within a pass the longest (most specific) name wins, so "Wholesale Price (USD)" is the cost, not the price.

/** Lower case, accents and punctuation gone: "Qty. in Stock" and "qty-in-stock" are both "qtyinstock". */
export function compactKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9]/g, "");
}

/** The words of a header, in the same normal form. */
export function headerTokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

/** Words that say which currency or unit a column is in, not what it holds: dropped when matching. */
const NOISE = new Set([
  "usd", "eur", "czk", "gbp", "pln", "huf", "chf", "ron", "sek", "nok", "dkk", "rub", "aud", "cad", "kc", "zl",
  "kg", "g", "lb", "lbs", "oz", "mg", "cm", "mm", "m", "ml", "l",
  "vat", "dph", "tax", "incl", "excl",
  "per", "each", "unit", "units",
]);

export interface HeaderMatch {
  header: string;
  how: "exact" | "contains" | "similar";
  /** 0-1, for "similar" only. */
  similarity?: number;
}

interface Candidate<K extends string> {
  field: K;
  fieldOrder: number;
  header: number;
  alias: number;
  length: number;
  score: number;
}

/** 1 for equal, 0 for nothing in common: 1 - (edit distance / the longer length). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return 1 - previous[b.length] / longest;
}

const MIN_CONTAINS_LENGTH = 4;
const MIN_SIMILAR_LENGTH = 6;
const MIN_SIMILARITY = 0.85;
const MAX_WINDOW = 4;

/**
 * Which header holds which column. `order` is the order the columns claim their headers in the exact pass (and breaks ties).
 */
export function matchHeaders<K extends string>(headers: string[], aliases: Record<K, readonly string[]>, order: readonly K[]): Map<K, HeaderMatch> {
  const prepared = headers.map((header) => {
    const tokens = headerTokens(header);
    const core = tokens.filter((token) => !NOISE.has(token));
    return { header, compact: compactKey(header), core, coreCompact: core.join("") };
  });
  const names = order.map((field) => ({ field, entries: aliases[field].map((alias, index) => ({ index, compact: compactKey(alias) })).filter((entry) => entry.compact !== "") }));

  const result = new Map<K, HeaderMatch>();
  const claimed = new Set<number>();
  const claim = (field: K, header: number, how: HeaderMatch["how"], extra: Partial<HeaderMatch> = {}) => {
    result.set(field, { header: prepared[header].header, how, ...extra });
    claimed.add(header);
  };

  // 1. exact, column by column, so the earlier name in a list wins.
  for (const { field, entries } of names) {
    let bestAlias = Number.POSITIVE_INFINITY;
    let bestHeader = -1;
    for (let header = 0; header < prepared.length; header++) {
      if (claimed.has(header)) continue;
      const candidate = prepared[header];
      const hit = entries.find((entry) => candidate.compact === entry.compact || (candidate.coreCompact !== "" && candidate.coreCompact === entry.compact));
      if (hit !== undefined && hit.index < bestAlias) {
        bestAlias = hit.index;
        bestHeader = header;
      }
    }
    if (bestHeader !== -1) claim(field, bestHeader, "exact");
  }

  // 2. contains: the most specific name first, across all the columns still without a header.
  const contains: Array<Candidate<K>> = [];
  names.forEach(({ field, entries }, fieldOrder) => {
    if (result.has(field)) return;
    prepared.forEach((candidate, header) => {
      if (claimed.has(header) || candidate.core.length < 2) return;
      for (const entry of entries) {
        if (entry.compact.length < MIN_CONTAINS_LENGTH) continue;
        for (let size = 1; size <= Math.min(MAX_WINDOW, candidate.core.length - 1); size++) {
          if (size * 2 <= candidate.core.length) continue; // it must say more than half of the header
          for (let start = 0; start + size <= candidate.core.length; start++) {
            if (candidate.core.slice(start, start + size).join("") === entry.compact) {
              contains.push({ field, fieldOrder, header, alias: entry.index, length: entry.compact.length, score: 0 });
            }
          }
        }
      }
    });
  });
  contains.sort((a, b) => b.length - a.length || a.fieldOrder - b.fieldOrder || a.alias - b.alias || a.header - b.header);
  for (const candidate of contains) {
    if (result.has(candidate.field) || claimed.has(candidate.header)) continue;
    claim(candidate.field, candidate.header, "contains");
  }

  // 3. similar: a misspelling of a name, for the columns still without a header.
  const similar: Array<Candidate<K>> = [];
  names.forEach(({ field, entries }, fieldOrder) => {
    if (result.has(field)) return;
    prepared.forEach((candidate, header) => {
      if (claimed.has(header) || candidate.compact.length < MIN_SIMILAR_LENGTH) return;
      for (const entry of entries) {
        if (entry.compact.length < MIN_SIMILAR_LENGTH) continue;
        const score = similarity(candidate.compact, entry.compact);
        if (score >= MIN_SIMILARITY) similar.push({ field, fieldOrder, header, alias: entry.index, length: entry.compact.length, score });
      }
    });
  });
  similar.sort((a, b) => b.score - a.score || a.fieldOrder - b.fieldOrder || a.alias - b.alias || a.header - b.header);
  for (const candidate of similar) {
    if (result.has(candidate.field) || claimed.has(candidate.header)) continue;
    claim(candidate.field, candidate.header, "similar", { similarity: candidate.score });
  }
  return result;
}
