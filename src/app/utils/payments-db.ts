// src/app/utils/payments-db.ts
//
// Payment bookkeeping in the payment_intents table (one row per checkout attempt), shared by the Stripe webhook,
// the unlock endpoints and recovery, so a payment is recorded and looked up the same way everywhere.
// Everything here is idempotent: Stripe retries webhooks and customers refresh pages.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_INTENTS_TABLE, TELEMETRY_TABLE, isUuid, logSupabaseError } from "./telemetry-db";

export type UnlockOutcome = "unlocked" | "not_found" | "error";

/** The columns of a payment_intents row that the unlock flow needs. */
export interface PurchaseRow {
  stripe_session_id: string;
  telemetry_id: string | null;
  /** Set by markSessionPaid once the payment is confirmed. Null while the checkout is unpaid. */
  paid_at: string | null;
  file_fingerprint: string | null;
  /** Set when the payment was refunded in full or disputed. A refunded purchase never unlocks anything. */
  refunded_at: string | null;
}

const PURCHASE_COLUMNS = "stripe_session_id, telemetry_id, paid_at, file_fingerprint, refunded_at";

/** Keeps usage_telemetry.is_unlocked (analytics, and the "already paid" check at checkout) in step with payments. */
export async function unlockJob(supabase: SupabaseClient, jobId: string): Promise<UnlockOutcome> {
  const { data, error } = await supabase
    .from(TELEMETRY_TABLE)
    .update({ is_unlocked: true })
    .eq("id", jobId)
    .select("id");
  if (error) {
    logSupabaseError("unlockJob update", error);
    return "error";
  }
  return data && data.length > 0 ? "unlocked" : "not_found";
}

/** Stripe object ids are short ASCII strings with a type prefix; anything else is not worth storing or querying with. */
function cleanStripeId(value: string | null | undefined, prefix: string): string | null {
  return typeof value === "string" && value.startsWith(prefix) && /^[A-Za-z0-9_]{8,255}$/.test(value) ? value : null;
}

function cleanEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Records a confirmed payment: stamps paid_at (and the receipt email, which is how /recover finds it later) on the
 * ledger row for the session. If the ledger has no such row (the checkout row failed to write), the paid session is
 * still recorded from Stripe's signed client_reference_id so a real payment is never lost.
 */
export async function markSessionPaid(
  supabase: SupabaseClient,
  input: { sessionId: string; clientReferenceId: string | null; email: string | null; paymentIntentId?: string | null },
): Promise<"paid" | "not_found" | "error"> {
  const paidAt = new Date().toISOString();
  const email = cleanEmail(input.email);
  // Remembered so a later refund or dispute (which names the payment, not the checkout session) finds this purchase.
  const paymentIntent = cleanStripeId(input.paymentIntentId, "pi_");

  const { data: updated, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .update({ paid_at: paidAt, ...(email ? { email } : {}), ...(paymentIntent ? { stripe_payment_intent_id: paymentIntent } : {}) })
    .eq("stripe_session_id", input.sessionId)
    .is("paid_at", null)
    .select("telemetry_id");
  if (error) {
    logSupabaseError("markSessionPaid update", error);
    return "error";
  }

  let jobId: string | null = typeof updated?.[0]?.telemetry_id === "string" ? updated[0].telemetry_id : null;
  if (!updated || updated.length === 0) {
    // Either a replayed event (already paid, nothing to do) or a session that was never in the ledger.
    const { purchase, failed } = await getPurchase(supabase, input.sessionId);
    if (failed) return "error";
    if (purchase) {
      jobId = purchase.telemetry_id;
      // A replay, or a payment recorded before payment intent ids were kept: fill the id in without touching anything else.
      if (paymentIntent) {
        await supabase.from(PAYMENT_INTENTS_TABLE).update({ stripe_payment_intent_id: paymentIntent }).eq("stripe_session_id", input.sessionId).is("stripe_payment_intent_id", null);
      }
    } else if (isUuid(input.clientReferenceId)) {
      const { error: insertError } = await supabase.from(PAYMENT_INTENTS_TABLE).insert({
        stripe_session_id: input.sessionId,
        telemetry_id: input.clientReferenceId,
        paid_at: paidAt,
        ...(email ? { email } : {}),
        ...(paymentIntent ? { stripe_payment_intent_id: paymentIntent } : {}),
      });
      if (insertError) {
        logSupabaseError("markSessionPaid insert", insertError);
        return "error";
      }
      jobId = input.clientReferenceId;
    } else {
      return "not_found";
    }
  }

  if (jobId) await unlockJob(supabase, jobId);
  return "paid";
}

export async function getPurchase(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ purchase: PurchaseRow | null; failed: boolean }> {
  const { data, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select(PURCHASE_COLUMNS)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (error) {
    logSupabaseError("getPurchase select", error);
    return { purchase: null, failed: true };
  }
  return { purchase: (data as PurchaseRow | null) ?? null, failed: false };
}

/** The newest paid checkout for a job. A customer who clicked Unlock twice may have paid on either session. */
export async function findPaidPurchaseForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ purchase: PurchaseRow | null; failed: boolean }> {
  const { data, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select(PURCHASE_COLUMNS)
    .eq("telemetry_id", jobId)
    .not("paid_at", "is", null)
    .is("refunded_at", null)
    .order("paid_at", { ascending: false })
    .limit(1);
  if (error) {
    logSupabaseError("findPaidPurchaseForJob select", error);
    return { purchase: null, failed: true };
  }
  return { purchase: (data?.[0] as PurchaseRow | undefined) ?? null, failed: false };
}

/**
 * Paid purchases whose Stripe receipt went to this email, newest first. The email is matched exactly (stored lower case).
 * Refunded purchases are left out of `purchases`; `onlyRefunded` says there were some but none that still count, so the
 * customer can be told what happened instead of "not found".
 */
export async function findPaidPurchasesByEmail(
  supabase: SupabaseClient,
  email: string,
  limit = 3,
): Promise<{ purchases: PurchaseRow[]; onlyRefunded: boolean; failed: boolean }> {
  const { data, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select(PURCHASE_COLUMNS)
    .eq("email", email)
    .not("paid_at", "is", null)
    .is("refunded_at", null)
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) {
    logSupabaseError("findPaidPurchasesByEmail select", error);
    return { purchases: [], onlyRefunded: false, failed: true };
  }
  const purchases = (data as PurchaseRow[] | null) ?? [];
  if (purchases.length > 0) return { purchases, onlyRefunded: false, failed: false };

  const refunded = await supabase.from(PAYMENT_INTENTS_TABLE).select("stripe_session_id").eq("email", email).not("refunded_at", "is", null).limit(1);
  if (refunded.error) {
    logSupabaseError("findPaidPurchasesByEmail refunded check", refunded.error);
    return { purchases: [], onlyRefunded: false, failed: true };
  }
  return { purchases: [], onlyRefunded: (refunded.data?.length ?? 0) > 0, failed: false };
}

/* -------------------------------------------------------------------------- */
/*  Refunds and disputes                                                       */
/* -------------------------------------------------------------------------- */

export type RefundReason = "refund" | "dispute";

export type RefundOutcome =
  /** The purchase was marked refunded just now. */
  | "refunded"
  /** It was already marked (a replayed or duplicate event). */
  | "already"
  /**
   * Nothing in the ledger relates to this payment (yet). For a payment that is this app's, that means its "paid" event has
   * not been processed: retry later.
   */
  | "not_found"
  /** The job has a checkout row but its payment is not recorded yet (the "paid" event has not been processed): retry later. */
  | "not_recorded_yet"
  /** Several paid purchases of the job could be the one: nothing is touched, and waiting would not make it clearer. */
  | "ambiguous"
  | "error";

/** The purchase recorded for a Stripe PaymentIntent, if this app made it. */
export async function findPurchaseByPaymentIntent(
  supabase: SupabaseClient,
  paymentIntentId: string,
): Promise<{ purchase: PurchaseRow | null; failed: boolean }> {
  const id = cleanStripeId(paymentIntentId, "pi_");
  if (!id) return { purchase: null, failed: false };
  const { data, error } = await supabase.from(PAYMENT_INTENTS_TABLE).select(PURCHASE_COLUMNS).eq("stripe_payment_intent_id", id).limit(1);
  if (error) {
    logSupabaseError("findPurchaseByPaymentIntent select", error);
    return { purchase: null, failed: true };
  }
  return { purchase: (data?.[0] as PurchaseRow | undefined) ?? null, failed: false };
}

/**
 * usage_telemetry.is_unlocked says "already paid" (checkout refuses to charge twice for it). After a refund the file is
 * for sale again, unless the job has another purchase that still counts.
 */
async function relockJobIfUnpaid(supabase: SupabaseClient, jobId: string | null): Promise<void> {
  if (!jobId) return;
  const { purchase, failed } = await findPaidPurchaseForJob(supabase, jobId);
  if (failed || purchase) return;
  const { error } = await supabase.from(TELEMETRY_TABLE).update({ is_unlocked: false }).eq("id", jobId);
  if (error) logSupabaseError("relockJobIfUnpaid update", error);
}

/**
 * Takes a purchase away after a full refund or a dispute: stamps refunded_at (so /api/unlock and /api/unlock/verify
 * reject it from now on) and makes the file purchasable again. Idempotent. The payment is found by its PaymentIntent id;
 * if that was never stored (a payment recorded before this column existed) the job id Stripe carries on the charge is
 * the fallback, but only when it points at exactly one paid purchase, so a refund can never take away the wrong one.
 */
export async function markPaymentRefunded(
  supabase: SupabaseClient,
  input: { paymentIntentId: string | null; jobId: string | null; reason: RefundReason },
): Promise<RefundOutcome> {
  const refundedAt = new Date().toISOString();
  const paymentIntent = cleanStripeId(input.paymentIntentId, "pi_");
  const jobId = isUuid(input.jobId) ? input.jobId : null;
  const stamp = { refunded_at: refundedAt, refund_reason: input.reason };

  if (paymentIntent) {
    const { data, error } = await supabase
      .from(PAYMENT_INTENTS_TABLE)
      .update(stamp)
      .eq("stripe_payment_intent_id", paymentIntent)
      .is("refunded_at", null)
      .select("telemetry_id");
    if (error) {
      logSupabaseError("markPaymentRefunded update", error);
      return "error";
    }
    if (data && data.length > 0) {
      await relockJobIfUnpaid(supabase, typeof data[0].telemetry_id === "string" ? data[0].telemetry_id : null);
      return "refunded";
    }
    const known = await findPurchaseByPaymentIntent(supabase, paymentIntent);
    if (known.failed) return "error";
    if (known.purchase) return "already";
  }

  if (!jobId) return "not_found";
  const { data: rows, error: jobError } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select("stripe_session_id, paid_at, refunded_at, stripe_payment_intent_id")
    .eq("telemetry_id", jobId);
  if (jobError) {
    logSupabaseError("markPaymentRefunded job lookup", jobError);
    return "error";
  }
  const sessions = (rows ?? []) as Array<{ stripe_session_id: string; paid_at: string | null; refunded_at: string | null; stripe_payment_intent_id: string | null }>;
  if (sessions.length === 0) return "not_found";

  // A payment without a stored PaymentIntent id: only act when it is unambiguous.
  const candidates = sessions.filter((row) => row.paid_at && !row.refunded_at && !row.stripe_payment_intent_id);
  if (candidates.length === 1) {
    const { error } = await supabase
      .from(PAYMENT_INTENTS_TABLE)
      .update({ ...stamp, ...(paymentIntent ? { stripe_payment_intent_id: paymentIntent } : {}) })
      .eq("stripe_session_id", candidates[0].stripe_session_id)
      .is("refunded_at", null);
    if (error) {
      logSupabaseError("markPaymentRefunded fallback update", error);
      return "error";
    }
    await relockJobIfUnpaid(supabase, jobId);
    return "refunded";
  }
  if (candidates.length > 1) return "ambiguous";
  if (candidates.length === 0 && sessions.some((row) => row.refunded_at)) return "already";
  // Checkout rows exist but none is recorded as paid yet: the refund event outran the "paid" event. Let Stripe retry.
  if (sessions.every((row) => !row.paid_at)) return "not_recorded_yet";
  return "not_found";
}
