// src/app/utils/entitlements.ts
//
// Remembers, on this device, which payments have been confirmed and which file each one is for. It stores the Stripe
// session id and the file fingerprint, never a token (tokens expire in minutes; a fresh one is requested on demand)
// and never any file content. Uploading the same file again later finds its payment here and unlocks.

import type { PurchaseGrant } from "../types/unlock";

const STORAGE_KEY = "csv-sanitizer:entitlements:v1";
const MAX_ENTITLEMENTS = 20;

export interface Entitlement {
  sessionId: string;
  fingerprint: string | null;
  paidAt: string;
}

function isEntitlement(value: unknown): value is Entitlement {
  const entry = value as Partial<Entitlement> | null;
  return !!entry && typeof entry.sessionId === "string" && (entry.fingerprint === null || typeof entry.fingerprint === "string") && typeof entry.paidAt === "string";
}

export function loadEntitlements(): Entitlement[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntitlement) : [];
  } catch {
    return [];
  }
}

/** Adds purchases, replacing any with the same session id, newest first. Silently does nothing if storage is blocked. */
export function rememberPurchases(purchases: Pick<PurchaseGrant, "sessionId" | "fingerprint" | "paidAt">[]): void {
  try {
    const incoming = purchases.map(({ sessionId, fingerprint, paidAt }) => ({ sessionId, fingerprint, paidAt }));
    const keep = loadEntitlements().filter((existing) => !incoming.some((entry) => entry.sessionId === existing.sessionId));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...incoming, ...keep].slice(0, MAX_ENTITLEMENTS)));
  } catch {
    /* storage unavailable (private mode or blocked): the payment is still recoverable through /recover */
  }
}

/** The payment made for exactly this file, if this device knows of one. Payments without a fingerprint never match. */
export function findEntitlementFor(fingerprint: string | null): Entitlement | null {
  if (!fingerprint) return null;
  return loadEntitlements().find((entry) => entry.fingerprint === fingerprint) ?? null;
}

/** Forgets a payment, for example after the server says it was refunded, so the file is not offered as unlocked again. */
export function forgetPurchase(sessionId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadEntitlements().filter((entry) => entry.sessionId !== sessionId)));
  } catch {
    /* storage unavailable: nothing to forget */
  }
}
