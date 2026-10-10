// src/app/utils/unlock-service.ts
//
// "Has this been paid for?" for the unlock endpoints. The browser's claims prove nothing by themselves: a session
// counts only when our own database says it is paid, or when Stripe's API says so for a session that is bound to the
// job we created it for (client_reference_id), never because of what a URL or a request body says.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { PurchaseGrant } from "../types/unlock";
import {
  type PurchaseRow,
  findPaidPurchaseForJob,
  findPaidPurchasesByEmail,
  getPurchase,
  markSessionPaid,
} from "./payments-db";
import { signUnlockToken } from "./unlock-token";

export type UnlockLookup =
  | { status: "paid"; purchases: PurchaseRow[] }
  | { status: "pending" }
  | { status: "not_found" }
  /** The payment was refunded in full or disputed, and nothing else paid for this file still counts. */
  | { status: "refunded" }
  | { status: "error" };

/** The customer is usually back before the webhook, or there may be no webhook yet, so Stripe is asked directly. */
export async function lookupBySession(
  supabase: SupabaseClient,
  stripe: Stripe | null,
  sessionId: string,
): Promise<UnlockLookup> {
  const { purchase, failed } = await getPurchase(supabase, sessionId);
  if (failed) return { status: "error" };
  if (!purchase) return { status: "not_found" }; // we never created this session
  if (purchase.refunded_at) {
    // A refunded payment unlocks nothing, unless the same file was also paid for on another session that still counts.
    const other = purchase.telemetry_id ? await findPaidPurchaseForJob(supabase, purchase.telemetry_id) : { purchase: null, failed: false };
    if (other.failed) return { status: "error" };
    return other.purchase ? { status: "paid", purchases: [other.purchase] } : { status: "refunded" };
  }
  if (purchase.paid_at) return { status: "paid", purchases: [purchase] };

  // They may have paid on another session for the same job (clicked Unlock twice).
  if (purchase.telemetry_id) {
    const other = await findPaidPurchaseForJob(supabase, purchase.telemetry_id);
    if (other.failed) return { status: "error" };
    if (other.purchase) return { status: "paid", purchases: [other.purchase] };
  }

  if (!stripe) return { status: "error" };
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if ((error as { code?: string }).code === "resource_missing") return { status: "not_found" };
    console.error("[unlock] Stripe retrieve failed:", error instanceof Error ? error.message : error);
    return { status: "error" };
  }
  if (session.client_reference_id !== purchase.telemetry_id) return { status: "not_found" };
  if (session.status === "expired") return { status: "not_found" };
  if (session.payment_status !== "paid") return { status: "pending" };

  const marked = await markSessionPaid(supabase, {
    sessionId,
    clientReferenceId: session.client_reference_id,
    email: session.customer_details?.email ?? session.customer_email ?? null,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
  });
  if (marked !== "paid") return { status: marked === "not_found" ? "not_found" : "error" };

  const refreshed = await getPurchase(supabase, sessionId);
  if (refreshed.failed || !refreshed.purchase) return { status: "error" };
  return { status: "paid", purchases: [refreshed.purchase] };
}

/** /recover with the email from a Stripe receipt. The email is stored lower case when the payment is recorded. */
export async function lookupByEmail(supabase: SupabaseClient, email: string): Promise<UnlockLookup> {
  const { purchases, onlyRefunded, failed } = await findPaidPurchasesByEmail(supabase, email);
  if (failed) return { status: "error" };
  if (purchases.length > 0) return { status: "paid", purchases };
  return { status: onlyRefunded ? "refunded" : "not_found" };
}

/** Signs a token for each paid purchase. Returns null when UNLOCK_TOKEN_SECRET is not configured. */
export function grantsFor(purchases: PurchaseRow[]): PurchaseGrant[] | null {
  const grants: PurchaseGrant[] = [];
  for (const purchase of purchases) {
    const signed = signUnlockToken({
      sessionId: purchase.stripe_session_id,
      jobId: purchase.telemetry_id,
      fingerprint: purchase.file_fingerprint,
    });
    if (!signed) return null;
    grants.push({
      token: signed.token,
      expiresAt: signed.expiresAt,
      sessionId: purchase.stripe_session_id,
      sessionRef: purchase.stripe_session_id.slice(-8),
      fingerprint: purchase.file_fingerprint,
      paidAt: purchase.paid_at ?? "",
    });
  }
  return grants;
}

