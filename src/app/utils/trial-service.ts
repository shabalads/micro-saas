// src/app/utils/trial-service.ts
//
// The free first big file: one free unlock of a file over the free row limit, per person. "Per person" is approximated by
// two things that are hard to change: the email address (compared as a keyed hash, never stored) and the browser (a random
// id kept in localStorage AND in an httpOnly cookie, so clearing only one of them does not make a new person). The email
// is not verified, so this is a deterrent against casual repeat use, not a guarantee: someone who changes email AND clears
// both stores AND changes network address can get another file. The per-network limits in rate-limit.ts cap how far that goes.
//
// Personal data kept here, and nothing else: email_hash (HMAC-SHA256 with TRIAL_HASH_SECRET: the email cannot be read back
// from it, and without the secret it cannot be guessed offline), browser_id (random, carries no personal data), the file
// fingerprint (a hash of the file's content), the time, and, only if the person ticked the separate box, their email for
// product updates with the time they agreed.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { logSupabaseError } from "./telemetry-db";

export const TRIALS_TABLE = "free_trials";
/** The unlock token's `sid` for a trial is this prefix plus the trial row's id, which is how the verify endpoint tells it from a Stripe session. */
export const TRIAL_SESSION_PREFIX = "trial_";
export const TRIAL_COOKIE = "csv_trial_browser";

const MIN_SECRET_LENGTH = 32;
const UNIQUE_VIOLATION = "23505";
/** A browser id is a random identifier the page generates itself. Anything else is not one. */
const BROWSER_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let warnedAboutSecret = false;

export function getTrialSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.TRIAL_HASH_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.error(`[trial] TRIAL_HASH_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters; the free first file is switched off.`);
  }
  return null;
}

export function isTrialConfigured(): boolean {
  return getTrialSecret() !== null;
}

export function isBrowserId(value: unknown): value is string {
  return typeof value === "string" && BROWSER_ID_RE.test(value);
}

/** Reads one cookie from the request's Cookie header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

/**
 * The email as a person, for "one trial per person": lower case, without a +tag (name+anything@ is the same mailbox almost
 * everywhere), and for Gmail without dots (a.b@gmail.com is ab@gmail.com). Returns null when it is not an email address.
 */
export function normalizeEmail(raw: unknown): { email: string; identity: string } | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (local.length > 64 || local === "" || domain === "") return null;
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (local === "") return null;
  return { email, identity: `${local}@${domain}` };
}

/** A keyed, one-way hash of the email identity. Stable (the same person always gets the same hash) but not reversible. */
export function hashEmailIdentity(identity: string, secret: string): string {
  return createHmac("sha256", secret).update(`free-trial-email:v1:${identity}`).digest("hex");
}

export interface TrialRow {
  id: string;
  email_hash: string;
  browser_id: string;
  file_fingerprint: string;
  created_at: string;
}
const TRIAL_COLUMNS = "id, email_hash, browser_id, file_fingerprint, created_at";

export type ClaimOutcome =
  /** The person gets (or already had, for this same file) a free unlock. `created` is false when it was an earlier trial asked for again. */
  | { status: "granted"; trial: TrialRow; created: boolean }
  /** This email or this browser has had its free file. */
  | { status: "not_eligible" }
  /** The network address has started too many trials today. */
  | { status: "throttled" }
  | { status: "error" };

async function findTrials(supabase: SupabaseClient, emailHash: string, browserIds: string[]): Promise<TrialRow[] | null> {
  const byEmail = await supabase.from(TRIALS_TABLE).select(TRIAL_COLUMNS).eq("email_hash", emailHash);
  if (byEmail.error) {
    logSupabaseError("findTrials by email", byEmail.error);
    return null;
  }
  const byBrowser = browserIds.length > 0 ? await supabase.from(TRIALS_TABLE).select(TRIAL_COLUMNS).in("browser_id", browserIds) : { data: [] as TrialRow[], error: null };
  if (byBrowser.error) {
    logSupabaseError("findTrials by browser", byBrowser.error);
    return null;
  }
  const rows = [...((byEmail.data ?? []) as TrialRow[]), ...((byBrowser.data ?? []) as TrialRow[])];
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index);
}

/** One trial that already belongs to this person and is for this very file: asking again for it is not a second trial. */
function sameTrial(rows: TrialRow[], fingerprint: string): TrialRow | null {
  const first = rows[0];
  return first && rows.every((row) => row.id === first.id) && first.file_fingerprint === fingerprint ? first : null;
}

/**
 * Gives the person their free file, unless this email or this browser has had one. `beforeCreate` is asked only when a NEW
 * trial would be recorded (the per-network daily cap), so asking again for the same file never uses it up.
 */
export async function claimTrial(
  supabase: SupabaseClient,
  input: { emailHash: string; browserIds: string[]; fingerprint: string; marketingEmail: string | null },
  beforeCreate: () => Promise<boolean> = async () => true,
): Promise<ClaimOutcome> {
  const existing = await findTrials(supabase, input.emailHash, input.browserIds);
  if (existing === null) return { status: "error" };
  if (existing.length > 0) {
    const again = sameTrial(existing, input.fingerprint);
    return again ? { status: "granted", trial: again, created: false } : { status: "not_eligible" };
  }

  if (!(await beforeCreate())) return { status: "throttled" };

  const { data, error } = await supabase
    .from(TRIALS_TABLE)
    .insert({
      email_hash: input.emailHash,
      browser_id: input.browserIds[0],
      file_fingerprint: input.fingerprint,
      ...(input.marketingEmail ? { marketing_email: input.marketingEmail, marketing_opt_in_at: new Date().toISOString() } : {}),
    })
    .select(TRIAL_COLUMNS)
    .single();
  if (!error && data) return { status: "granted", trial: data as TrialRow, created: true };

  if (error?.code === UNIQUE_VIOLATION) {
    // Two requests raced: whoever lost is judged against the winner's row, exactly as if it had come second.
    const rows = await findTrials(supabase, input.emailHash, input.browserIds);
    if (rows === null) return { status: "error" };
    const again = sameTrial(rows, input.fingerprint);
    return again ? { status: "granted", trial: again, created: false } : { status: "not_eligible" };
  }
  logSupabaseError("claimTrial insert", error);
  return { status: "error" };
}

/** A fresh token for a trial this browser already has, for this file. No email needed; the browser ids are the proof. */
export async function findTrialForBrowser(
  supabase: SupabaseClient,
  browserIds: string[],
  fingerprint: string,
): Promise<{ trial: TrialRow | null; failed: boolean }> {
  if (browserIds.length === 0) return { trial: null, failed: false };
  const { data, error } = await supabase.from(TRIALS_TABLE).select(TRIAL_COLUMNS).in("browser_id", browserIds).eq("file_fingerprint", fingerprint).limit(1);
  if (error) {
    logSupabaseError("findTrialForBrowser select", error);
    return { trial: null, failed: true };
  }
  return { trial: (data?.[0] as TrialRow | undefined) ?? null, failed: false };
}

export async function getTrialById(supabase: SupabaseClient, id: string): Promise<{ trial: TrialRow | null; failed: boolean }> {
  const { data, error } = await supabase.from(TRIALS_TABLE).select(TRIAL_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    logSupabaseError("getTrialById select", error);
    return { trial: null, failed: true };
  }
  return { trial: (data as TrialRow | null) ?? null, failed: false };
}
