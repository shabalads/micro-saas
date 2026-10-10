// src/app/api/unlock/verify/route.ts

import { NextResponse } from "next/server";
import { getPurchase } from "../../../utils/payments-db";
import { clientKey, tooManyRequests, verifyLimiter } from "../../../utils/rate-limit";
import { getSupabaseAdmin } from "../../../utils/telemetry-db";
import { TRIAL_SESSION_PREFIX, getTrialById } from "../../../utils/trial-service";
import { verifyUnlockToken } from "../../../utils/unlock-token";

/**
 * The gate in front of the paid export module: the browser sends the token it was given, and the module is only
 * loaded if this says yes. It checks the signature and expiry, and that the payment is still recorded as paid and was not refunded.
 * Body: { token, fingerprint? }. 200 { valid: true, expiresAt } | 401 { valid: false } | 403 { valid: false, reason: "refunded" | "file" }.
 * `fingerprint` (the file about to be exported) is required for a free-trial token and must match the one inside it; a paid token
 * is checked exactly as before.
 */
export async function POST(request: Request) {
  const limit = await verifyLimiter.check(clientKey(request));
  if (!limit.allowed) return tooManyRequests(limit, { valid: false });

  const body: unknown = await request.json().catch(() => null);
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const token = payload.token;

  const claims = verifyUnlockToken(token);
  if (!claims) return NextResponse.json({ valid: false }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ valid: false }, { status: 503, headers: { "Cache-Control": "no-store" } });

  // A free first-file token. It is only good for the file it was issued for: the browser must say which file it is about to
  // export, and that must be the fingerprint inside the (signed) token.
  if (claims.sid.startsWith(TRIAL_SESSION_PREFIX)) {
    if (!claims.fp || payload.fingerprint !== claims.fp) {
      return NextResponse.json({ valid: false, reason: "file" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const { trial, failed: trialFailed } = await getTrialById(supabase, claims.sid.slice(TRIAL_SESSION_PREFIX.length));
    if (trialFailed) return NextResponse.json({ valid: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
    if (!trial || trial.file_fingerprint !== claims.fp) return NextResponse.json({ valid: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ valid: true, expiresAt: claims.exp }, { headers: { "Cache-Control": "no-store" } });
  }

  const { purchase, failed } = await getPurchase(supabase, claims.sid);
  if (failed) return NextResponse.json({ valid: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  if (!purchase?.paid_at) return NextResponse.json({ valid: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // A token outlives a refund by up to its lifetime, so the ledger is asked every time.
  if (purchase.refunded_at) return NextResponse.json({ valid: false, reason: "refunded" }, { status: 403, headers: { "Cache-Control": "no-store" } });

  return NextResponse.json({ valid: true, expiresAt: claims.exp }, { headers: { "Cache-Control": "no-store" } });
}
