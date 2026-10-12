// src/app/utils/option-values.ts
//
// Variant option values (Size, Colour ...) arrive spelled many ways. These helpers make them consistent without guessing:
//  - one spelling per value in a column (case);
//  - the same size written two ways (S and Small) becomes one spelling for the whole file, the one used most (a tie: the short form);
//  - a value that looks like an abbreviation of another one in the same product (blk and Black) is only POINTED OUT.

import { compactKey } from "./header-match";

/** Sizes that mean the same thing, by their compact spelling (no spaces, hyphens or case). The FIRST of each is the short form. */
const SIZE_CLASSES: readonly (readonly string[])[] = [
  ["xxs", "2xs", "xxsmall", "2xsmall", "extraextrasmall"],
  ["xs", "xsmall", "extrasmall"],
  ["s", "small"], // not "sm": that is how "S/M" (small-medium, a size of its own) reads once the slash is gone
  ["m", "medium", "med", "md"],
  ["l", "large", "lg"],
  ["xl", "xlarge", "extralarge", "xlg"],
  ["xxl", "2xl", "xxlarge", "2xlarge", "extraextralarge", "xxlg"],
  ["xxxl", "3xl", "xxxlarge", "3xlarge"],
  ["os", "osfa", "onesize", "onesizefitsall", "onesizefitsmost"],
];

const SIZE_CLASS_OF: ReadonlyMap<string, number> = new Map(SIZE_CLASSES.flatMap((names, index) => names.map((name) => [name, index] as const)));

/** Which size a value is (0-based index of its class), or null when it is not one of the known sizes. */
export function sizeClassOf(value: string): number | null {
  return SIZE_CLASS_OF.get(compactKey(value)) ?? null;
}

/**
 * One spelling per value: the values that differ only in case ("Heather grey", "Heather Grey") become the spelling that is
 * most frequent in the column (the first one seen wins a tie). Keeps the order and the length of the list.
 */
export function unifyCase(values: readonly string[]): string[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const value of values) {
    if (value === "") continue;
    const key = value.toLowerCase();
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    spellings.set(key, counts);
  }
  const chosen = new Map<string, string>();
  for (const [key, counts] of spellings) {
    let best = "";
    let bestCount = 0;
    for (const [spelling, count] of counts) {
      if (count > bestCount) {
        best = spelling;
        bestCount = count;
      }
    }
    chosen.set(key, best);
  }
  return values.map((value) => (value === "" ? value : (chosen.get(value.toLowerCase()) ?? value)));
}

export interface ValueChange {
  /** Position in the list that was given. */
  index: number;
  from: string;
  to: string;
}

/** True for the short form of a size: S, M, L, XL, XXL, XS, OS ... (the first name of its class), in any case. */
export function isShortSize(value: string): boolean {
  const size = sizeClassOf(value);
  return size !== null && SIZE_CLASSES[size][0] === compactKey(value);
}

/**
 * Sizes that are the same size written two ways (S and Small, XL and X-Large, XXL and 2XL, OS and One Size) become ONE spelling
 * among the values given. The caller gives the values of a whole file (one option, such as "Size", in all its products), so
 * every product says the same: the spelling most often used wins, a tie goes to the short form (S, M, L, XL, OS), and after
 * that to the one seen first. A size that is written only one way is never touched.
 */
export function mergeEquivalentSizes(values: readonly string[]): { values: string[]; changes: ValueChange[] } {
  const byClass = new Map<number, Array<{ index: number; value: string }>>();
  values.forEach((value, index) => {
    const size = sizeClassOf(value);
    if (size !== null) byClass.set(size, [...(byClass.get(size) ?? []), { index, value }]);
  });

  const merged = [...values];
  const changes: ValueChange[] = [];
  for (const members of byClass.values()) {
    const counts = new Map<string, number>();
    for (const { value } of members) counts.set(value, (counts.get(value) ?? 0) + 1);
    if (counts.size < 2) continue;
    let winner = members[0].value;
    for (const [value, count] of counts) {
      const best = counts.get(winner) ?? 0;
      if (count > best || (count === best && isShortSize(value) && !isShortSize(winner))) winner = value;
    }
    for (const { index, value } of members) {
      if (value === winner) continue;
      merged[index] = winner;
      changes.push({ index, from: value, to: winner });
    }
  }
  changes.sort((a, b) => a.index - b.index);
  return { values: merged, changes };
}

const isAbbreviationOf = (short: string, long: string): boolean => {
  if (short.length < 2 || short.length > 4 || long.length < Math.max(3, short.length + 1)) return false;
  if (!/^\p{L}+$/u.test(short) || !/^\p{L}+$/u.test(long)) return false;
  const a = short.toLowerCase();
  const b = long.toLowerCase();
  if (a === b || a[0] !== b[0]) return false;
  let at = 0;
  for (const ch of b) if (at < a.length && ch === a[at]) at++;
  return at === a.length;
};

/**
 * Values that look like an abbreviation of another value of the same product ("Blk" and "Black", "Nv" and "Navy"). Only pointed
 * out: whether they ARE the same colour is for the person to say. Sizes are left out (they are merged above).
 */
export function possibleAbbreviations(values: readonly string[]): Array<{ short: string; long: string }> {
  const distinct = [...new Set(values.filter((value) => value !== ""))];
  const found: Array<{ short: string; long: string }> = [];
  for (const short of distinct) {
    if (sizeClassOf(short) !== null) continue;
    const long = distinct.find((other) => other !== short && sizeClassOf(other) === null && isAbbreviationOf(short, other));
    if (long !== undefined) found.push({ short, long });
  }
  return found;
}
