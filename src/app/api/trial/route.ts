// src/app/api/trial/route.ts
//
// The free first big file. A person who has not used it yet gets one free unlock of a file over the free row limit, as
// the same short-lived HMAC unlock token the paid flow uses, bound to that file's fingerprint. The full-file module still
// loads only after /api/unlock/verify has accepted the token.
//
// POST { action: "claim", email, marketingOptIn?, fingerprint, rowCount, browserId }  -> the free file, once per email and per browser
// POST { action: "renew", fingerprint, browserId }                                   -> a fresh token for a trial this browser already has
// 200 granted | 400 bad input or the file is already free | 404 (renew) no such trial | 409 not eligible
// 429 slow down / too many today | 503 not available (TRIAL_HASH_SECRET or UNLOCK_TOKEN_SECRET missing)

import { NextResponse } from "next/server";
import type { PurchaseGrant, TrialResponse } from "../../types/unlock";
import { isFingerprint } from "../../utils/paywall";
import { FREE_ROW_LIMIT } from "../../utils/pricing";
import { clientKey, tooManyRequests, trialGrantLimiter, trialLimiter } from "../../utils/rate-limit";
import { getSupabaseAdmin, toSafeCount } from "../../utils/telemetry-db";
import {
  TRIAL_COOKIE,
  TRIAL_SESSION_PREFIX,
  type TrialRow,
  claimTrial,
  findTrialForBrowser,
  getTrialSecret,
  grantTestTrial,
  hashEmailIdentity,
  isBrowserId,
  isTrialTester,
  normalizeEmail,
  readCookie,
} from "../../utils/trial-service";
import { isUnlockConfigured, signUnlockToken } from "../../utils/unlock-token";

const NO_STORE = { "Cache-Control": "no-store" };
/** Two years: the cookie only has to outlive the trial for the "one per browser" rule to mean anything. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 730;

const NOT_ELIGIBLE_MESSAGE =
  "The free first big file has already been used with this email address or in this browser, so this file needs the one-time unlock.";

function respond(body: TrialResponse, status: number, extra?: (response: NextResponse) => void) {
  const response = NextResponse.json(body, { status, headers: NO_STORE });
  extra?.(response);
  return response;
}

function grantFor(trial: TrialRow, fingerprint: string): PurchaseGrant | null {
  const sessionId = `${TRIAL_SESSION_PREFIX}${trial.id}`;
  const signed = signUnlockToken({ sessionId, jobId: null, fingerprint });
  if (!signed) return null;
  return { token: signed.token, expiresAt: signed.expiresAt, sessionId, sessionRef: trial.id.slice(-8), fingerprint, paidAt: trial.created_at, kind: "trial" };
}

export async function POST(request: Request) {
  const client = clientKey(request);
  const limit = await trialLimiter.check(client);
  if (!limit.allowed) {
    return tooManyRequests(limit, { status: "error", message: "Too many attempts. Please wait a few minutes and try again." } satisfies TrialResponse);
  }

  const body: unknown = await request.json().catch(() => null);
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const action = payload.action === "renew" ? "renew" : "claim";

  if (!isFingerprint(payload.fingerprint)) return respond({ status: "invalid", message: "That file could not be identified. Please load it again." }, 400);
  const fingerprint = payload.fingerprint;
  if (!isBrowserId(payload.browserId)) return respond({ status: "invalid", message: "Your browser could not be identified. Please reload the page and try again." }, 400);

  // The browser is identified by BOTH its cookie and the id in its localStorage, so clearing just one of them is no new person.
  const cookieId = readCookie(request, TRIAL_COOKIE);
  const browserIds = [...new Set([isBrowserId(cookieId) ? cookieId : null, payload.browserId].filter((id): id is string => id !== null))];

  const supabase = getSupabaseAdmin();
  const secret = getTrialSecret();
  // UNLOCK_TOKEN_SECRET is checked up front: a trial must never be recorded (and so used up) when no token can be issued for it.
  if (!supabase || !secret || !isUnlockConfigured()) {
    console.error("[trial] not configured: Supabase env, TRIAL_HASH_SECRET or UNLOCK_TOKEN_SECRET missing");
    return respond({ status: "error", message: "The free first file isn't available right now. You can still unlock this file with the one-time payment." }, 503);
  }

  if (action === "renew") {
    const { trial, failed } = await findTrialForBrowser(supabase, browserIds, fingerprint);
    if (failed) return respond({ status: "error", message: "We couldn't check that right now. Please try again." }, 500);
    if (!trial) return respond({ status: "not_found" }, 404);
    const grant = grantFor(trial, fingerprint);
    if (!grant) return respond({ status: "error", message: "Unlocking isn't available right now. Please try again later." }, 503);
    return respond({ status: "granted", grant, browserId: trial.browser_id, created: false }, 200);
  }

  const person = normalizeEmail(payload.email);
  if (!person) return respond({ status: "invalid", message: "That doesn't look like an email address." }, 400);

  const rowCount = toSafeCount(payload.rowCount);
  if (rowCount === null || rowCount <= FREE_ROW_LIMIT) {
    return respond({ status: "not_needed", message: `Files with ${FREE_ROW_LIMIT} rows or fewer are already free: just download it.` }, 400);
  }

  // Only an explicit true counts; a missing or truthy-looking value never subscribes anyone.
  const marketingEmail = payload.marketingOptIn === true ? person.email : null;

  // Test mode (development only, see isTrialTester): a free file every time, earlier trials ignored, no marketing address kept.
  const tester = isTrialTester(person.identity);
  if (tester) console.warn("[trial] test mode: earlier free files are not checked for this address (TRIAL_TEST_EMAILS)");
  const outcome = tester
    ? await grantTestTrial(supabase, { identity: person.identity, secret, fingerprint })
    : await claimTrial(
        supabase,
        { emailHash: hashEmailIdentity(person.identity, secret), browserIds, fingerprint, marketingEmail },
        async () => (await trialGrantLimiter.check(client)).allowed,
      );

  if (outcome.status === "error") return respond({ status: "error", message: "We couldn't check that right now. Please try again." }, 500);
  if (outcome.status === "not_eligible") return respond({ status: "not_eligible", message: NOT_ELIGIBLE_MESSAGE }, 409);
  if (outcome.status === "throttled") {
    return respond({ status: "error", message: "Too many free files have been claimed from this network today. Please try again tomorrow, or unlock this file with the one-time payment." }, 429);
  }

  const grant = grantFor(outcome.trial, fingerprint);
  if (!grant) return respond({ status: "error", message: "Unlocking isn't available right now. Please try again later." }, 503);
  return respond({ status: "granted", grant, browserId: outcome.trial.browser_id, created: outcome.created }, 200, (response) => {
    // Set only now that a trial exists: nothing is stored in the browser for someone who just looked.
    response.cookies.set({
      name: TRIAL_COOKIE,
      value: outcome.trial.browser_id,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  });
}
