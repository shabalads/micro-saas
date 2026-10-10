// src/app/utils/unlock-token.ts
//
// Short-lived HMAC tokens that prove "this payment is real". The server mints one only after it has seen the
// payment in payment_intents (or confirmed it with Stripe), and the browser must present it before the paid
// export module is loaded. Tokens are signed with UNLOCK_TOKEN_SECRET, so the browser cannot make its own.

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a token works. Long enough to finish an export, short enough that a leaked one is worthless. */
export const UNLOCK_TOKEN_TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const TOKEN_VERSION = 1;

export interface UnlockClaims {
  v: number;
  /** The paid Stripe Checkout Session id. */
  sid: string;
  /** The usage_telemetry job the session was created for (null when unknown). */
  job: string | null;
  /** Fingerprint of the file that was paid for (null for payments that predate fingerprints). */
  fp: string | null;
  /** Issued at / expires at, in milliseconds since the epoch. */
  iat: number;
  exp: number;
}

let warnedAboutSecret = false;

function getSecret(): string | null {
  const secret = process.env.UNLOCK_TOKEN_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.error(`[unlock] UNLOCK_TOKEN_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters; unlock tokens are disabled.`);
  }
  return null;
}

/** True when tokens can be signed and checked (the secret is configured). */
export function isUnlockConfigured(): boolean {
  return getSecret() !== null;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** Returns a token, or null when UNLOCK_TOKEN_SECRET is not configured. */
export function signUnlockToken(
  grant: { sessionId: string; jobId: string | null; fingerprint: string | null },
  now: number = Date.now(),
): { token: string; expiresAt: number } | null {
  const secret = getSecret();
  if (!secret) return null;
  const claims: UnlockClaims = {
    v: TOKEN_VERSION,
    sid: grant.sessionId,
    job: grant.jobId,
    fp: grant.fingerprint,
    iat: now,
    exp: now + UNLOCK_TOKEN_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: claims.exp };
}

/** Returns the claims of a genuine, unexpired token, and null for anything else. */
export function verifyUnlockToken(token: unknown, now: number = Date.now()): UnlockClaims | null {
  const secret = getSecret();
  if (!secret || typeof token !== "string" || token.length > 2048) return null;

  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<UnlockClaims>;
    if (claims.v !== TOKEN_VERSION || typeof claims.sid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp <= now) return null;
    return {
      v: claims.v,
      sid: claims.sid,
      job: typeof claims.job === "string" ? claims.job : null,
      fp: typeof claims.fp === "string" ? claims.fp : null,
      iat: typeof claims.iat === "number" ? claims.iat : 0,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}
