// src/app/utils/admin-auth.ts
//
// Password protection for /admin. The password is ADMIN_PASSWORD. A correct password earns a signed session cookie whose
// signature key is the password itself, so changing the password signs everyone out. Nothing is stored server-side.

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "admin_session";
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
/** A short password on a public URL is not protection; below this the admin area stays switched off. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

type Env = Record<string, string | undefined>;

const getPassword = (env: Env): string | null => {
  const password = env.ADMIN_PASSWORD;
  return password && password.length >= MIN_ADMIN_PASSWORD_LENGTH ? password : null;
};

export function adminConfigured(env: Env = process.env): boolean {
  return getPassword(env) !== null;
}

/** Constant-time comparison. Hashing first makes both sides the same length, so the length is not leaked either. */
export function passwordMatches(input: string, env: Env = process.env): boolean {
  const password = getPassword(env);
  if (password === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input), digest(password));
}

const sign = (expires: number, password: string) => createHmac("sha256", password).update(`admin-session:${expires}`).digest("base64url");

/** The cookie value for a fresh session, or null when the admin area is not configured. */
export function createSessionValue(now: number = Date.now(), env: Env = process.env): string | null {
  const password = getPassword(env);
  if (password === null) return null;
  const expires = now + ADMIN_SESSION_MS;
  return `${expires}.${sign(expires, password)}`;
}

export function verifySessionValue(value: string | undefined, now: number = Date.now(), env: Env = process.env): boolean {
  const password = getPassword(env);
  if (password === null || !value) return false;
  const [expiresText, signature, ...rest] = value.split(".");
  const expires = Number(expiresText);
  if (!signature || rest.length > 0 || !Number.isInteger(expires) || expires <= now) return false;
  const expected = Buffer.from(sign(expires, password));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
