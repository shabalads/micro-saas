// src/app/types/unlock.ts

/** One paid purchase and a short-lived token proving it, as returned by POST /api/unlock. */
export interface PurchaseGrant {
  /** Signed, short-lived token. The full export only runs once the server has accepted one. */
  token: string;
  /** When the token stops working, in milliseconds since the epoch. */
  expiresAt: number;
  /** The paid Stripe Checkout Session. Keep it to be able to ask for a fresh token later. */
  sessionId: string;
  /** Last characters of the session id: safe to show a person as a reference. */
  sessionRef: string;
  /** The file this payment is for (see fingerprintRows). Null for payments made before fingerprints existed. */
  fingerprint: string | null;
  /** When it was paid (or, for a free trial, when the trial started). */
  paidAt: string;
  /** "trial" for the free first big file; absent for a paid purchase. Its sessionId starts with "trial_" instead of "cs_". */
  kind?: "trial";
}

export type UnlockResponse =
  | { status: "paid"; purchases: PurchaseGrant[] }
  /** The checkout exists but Stripe has not confirmed payment yet; try again shortly. */
  | { status: "pending" }
  | { status: "not_found" }
  /** The payment was refunded or disputed, so it no longer unlocks anything. */
  | { status: "refunded"; message: string }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

/** The answer of POST /api/trial. */
export type TrialResponse =
  | { status: "granted"; grant: PurchaseGrant; /** The browser id the server settled on: keep it in localStorage next to the cookie. */ browserId: string; /** False when this was an earlier trial for the same file being asked for again. */ created: boolean }
  /** This email or browser has had its free file. */
  | { status: "not_eligible"; message: string }
  /** The file is within the free limit, so there is nothing to unlock. */
  | { status: "not_needed"; message: string }
  /** Renew: this browser has no trial for that file. */
  | { status: "not_found" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };
