// src/app/api/unlock/route.ts

import { NextResponse } from "next/server";
import type { UnlockResponse } from "../../types/unlock";
import { clientKey, tooManyRequests, unlockEmailLimiter, unlockLimiter } from "../../utils/rate-limit";
import { getStripe } from "../../utils/stripe-server";
import { getSupabaseAdmin } from "../../utils/telemetry-db";
import { grantsFor, lookupByEmail, lookupBySession } from "../../utils/unlock-service";
import { isUnlockConfigured } from "../../utils/unlock-token";

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]{8,250}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REFUNDED_MESSAGE = "This payment was refunded, so the file is no longer unlocked.";

function respond(body: UnlockResponse, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns proof of payment into a short-lived unlock token.
 * Body: { sessionId } (the Stripe Checkout Session id) or { email } (the address on the Stripe receipt).
 * 200 paid (with tokens) | 202 not paid yet | 403 refunded or disputed | 404 nothing found | 400 bad input | 5xx our side.
 */
export async function POST(request: Request) {
  const client = clientKey(request);
  const limit = await unlockLimiter.check(client);
  if (!limit.allowed) {
    return tooManyRequests(limit, { status: "error", message: "Too many attempts. Please wait a few minutes and try again." } satisfies UnlockResponse);
  }

  const body: unknown = await request.json().catch(() => null);
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (sessionId === "" && email === "") {
    return respond({ status: "invalid", message: "Send a sessionId or an email." }, 400);
  }
  if (sessionId !== "" && !SESSION_ID_RE.test(sessionId)) {
    return respond({ status: "invalid", message: "That doesn't look like a Stripe session id (it starts with cs_)." }, 400);
  }
  if (sessionId === "" && (email.length > 254 || !EMAIL_RE.test(email))) {
    return respond({ status: "invalid", message: "That doesn't look like an email address." }, 400);
  }

  // Looking payments up by email can be used to probe which addresses have paid, so it has its own, tighter budget.
  if (sessionId === "") {
    const emailLimit = await unlockEmailLimiter.check(client);
    if (!emailLimit.allowed) {
      return tooManyRequests(emailLimit, { status: "error", message: "Too many lookups. Please wait a few minutes and try again." } satisfies UnlockResponse);
    }
  }

  const supabase = getSupabaseAdmin();
  if (!supabase || !isUnlockConfigured()) {
    console.error("[unlock] not configured: Supabase env or UNLOCK_TOKEN_SECRET missing");
    return respond({ status: "error", message: "Unlocking isn't available right now. Please try again later." }, 503);
  }

  const lookup = sessionId !== "" ? await lookupBySession(supabase, getStripe(), sessionId) : await lookupByEmail(supabase, email);
  if (lookup.status === "pending") return respond({ status: "pending" }, 202);
  if (lookup.status === "not_found") return respond({ status: "not_found" }, 404);
  if (lookup.status === "refunded") return respond({ status: "refunded", message: REFUNDED_MESSAGE }, 403);
  if (lookup.status === "error") return respond({ status: "error", message: "We couldn't check that payment. Please try again." }, 500);

  const purchases = grantsFor(lookup.purchases);
  if (!purchases) return respond({ status: "error", message: "Unlocking isn't available right now. Please try again later." }, 503);
  return respond({ status: "paid", purchases }, 200);
}
