// src/app/actions/checkout.ts
"use server";

import type { VerifyCheckoutResult } from "../types/telemetry";
import { unlockJob } from "../utils/payments-db";
import { getStripe } from "../utils/stripe-server";
import {
  PAYMENT_INTENTS_TABLE,
  TELEMETRY_TABLE,
  getSupabaseAdmin,
  isUuid,
  logSupabaseError,
} from "../utils/telemetry-db";

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]{8,250}$/;
/** Recovery looks at a job's newest checkout attempts only; a handful is plenty and bounds the Stripe calls. */
const MAX_SESSIONS_PER_JOB = 3;

/**
 * Answers "has this job been paid for?". The browser's claims prove nothing by themselves, so a session only
 * counts when it is bound to the job, and that binding comes from our own database (the webhook already
 * unlocked it) or from Stripe's API (client_reference_id), never from what the page sends.
 *
 * - With a `sessionId` (the return page, straight after Stripe redirects back): checks that one session.
 * - With `null` (recovery on a later visit, when the customer closed the tab before the redirect and so
 *   never learned the session id): checks the sessions our payment_intents ledger holds for the job, and
 *   asks Stripe about them, so it works even when the webhook has not been configured or has not fired.
 */
export async function verifyCheckout(sessionId: string | null, jobId: string): Promise<VerifyCheckoutResult> {
  const sessionGiven = sessionId !== null;
  if (!isUuid(jobId) || (sessionGiven && (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)))) {
    return { status: "invalid" };
  }

  try {
    const supabase = getSupabaseAdmin();
    const stripe = getStripe();
    if (!supabase || !stripe) return { status: "error" };

    const [{ data: job, error: jobError }, { data: ledger, error: ledgerError }] = await Promise.all([
      supabase.from(TELEMETRY_TABLE).select("is_unlocked").eq("id", jobId).maybeSingle(),
      supabase
        .from(PAYMENT_INTENTS_TABLE)
        .select("stripe_session_id")
        .eq("telemetry_id", jobId)
        .order("clicked_at", { ascending: false })
        .limit(MAX_SESSIONS_PER_JOB),
    ]);
    if (jobError || ledgerError) {
      logSupabaseError("verifyCheckout lookup", jobError ?? ledgerError);
      return { status: "error" };
    }
    if (!job) return { status: "invalid" };
    const ledgerSessionIds = (ledger ?? []).map((row) => String(row.stripe_session_id));

    // 1. Fast path: the webhook already unlocked this job (and, for a given session, we created that session for it).
    if (job.is_unlocked && (!sessionGiven || ledgerSessionIds.includes(sessionId))) return { status: "paid" };

    // 2. The customer is often back before the webhook arrives (or there is no webhook yet), so ask Stripe.
    const candidates = sessionGiven ? [sessionId] : ledgerSessionIds;
    let stillPayable = false;
    for (const candidate of candidates) {
      let session;
      try {
        session = await stripe.checkout.sessions.retrieve(candidate);
      } catch (error) {
        if ((error as { code?: string }).code === "resource_missing") continue;
        console.error("[verifyCheckout] Stripe retrieve failed:", error instanceof Error ? error.message : error);
        return { status: "error" };
      }
      if (session.client_reference_id !== jobId) continue;
      if (session.payment_status === "paid") {
        const outcome = await unlockJob(supabase, jobId);
        if (outcome === "unlocked") return { status: "paid" };
        return { status: outcome === "not_found" ? "invalid" : "error" };
      }
      // Open, or complete but still awaiting a delayed payment method: it may yet be paid.
      if (session.status !== "expired") stillPayable = true;
    }
    return { status: stillPayable ? "pending" : "invalid" };
  } catch (error) {
    logSupabaseError("verifyCheckout catch", error);
    return { status: "error" };
  }
}
