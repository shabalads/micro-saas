// src/app/utils/paywall.ts
//
// The pricing rule and the file fingerprint, shared by the page, the paid export module and the tests.
// Safe for the browser and the server: no secrets here.

import type { RawSupplierRow } from "../types/csv";
import { FREE_ROW_LIMIT } from "./pricing";

/** Exactly FREE_ROW_LIMIT rows is still free; one more row is not. */
export function isFreeFile(totalRows: number): boolean {
  return totalRows <= FREE_ROW_LIMIT;
}

/** What fingerprintRows() returns ("sha256:<hex>" or "fnv:<hex>"). Anything else did not come from this app. */
const FINGERPRINT_RE = /^[a-z0-9]{3,8}:[0-9a-f]{16,128}$/;

export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

/** The only rows that are ever cleaned before payment. For a free file that is the whole file. */
export function previewRows<T>(rows: readonly T[]): T[] {
  return rows.length <= FREE_ROW_LIMIT ? [...rows] : rows.slice(0, FREE_ROW_LIMIT);
}

/** Two independent 32-bit FNV-1a hashes, for the rare browser context without crypto.subtle (plain http on a LAN IP). */
function fnvFingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + 0x9e), 0x01000193) >>> 0;
  }
  return `fnv:${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/**
 * Identifies a file by its parsed content, so a payment is tied to the file that was paid for. That is what lets a
 * customer recover on another device (upload the same file and it unlocks) without a payment being reusable for any
 * other file. Deterministic across devices, and it does not depend on the file's name, encoding or line endings.
 */
export async function fingerprintRows(rows: readonly RawSupplierRow[]): Promise<string> {
  const canonical = JSON.stringify(
    rows.map((row) => [row.id, row.title, row.description, row.images, row.price, row.sku, row.handle ?? ""]),
  );
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fnvFingerprint(canonical);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
