"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminConfigured, createSessionValue, passwordMatches, verifySessionValue } from "../utils/admin-auth";
import { PAYMENT_INTENTS_TABLE, getSupabaseAdmin, logSupabaseError } from "../utils/telemetry-db";
import { adminLoginLimiter, adminRefundLimiter, clientKey } from "../utils/rate-limit";
import { getStripe } from "../utils/stripe-server";

export interface LoginState {
  error: string | null;
}

/** Signs the operator in. Throttled per client address; a wrong password and a locked-out client look the same in the log. */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!adminConfigured()) return { error: "The admin area is not configured." };

  const limit = await adminLoginLimiter.check(clientKey(new Request("http://localhost/admin", { headers: await headers() })));
  if (!limit.allowed) return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).` };

  const password = formData.get("password");
  if (typeof password !== "string" || !passwordMatches(password)) return { error: "Wrong password." };

  const value = createSessionValue();
  if (!value) return { error: "The admin area is not configured." };
  (await cookies()).set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin");
}

/* -------------------------------------------------------------------------- */
/*  Refund                                                                     */
/* -------------------------------------------------------------------------- */

export interface RefundState {
  status: "idle" | "requested" | "error";
  message: string | null;
}

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]{8,250}$/;

/**
 * Refunds one paid purchase in full, through the Stripe refunds API. It deliberately does NOT mark the purchase refunded:
 * that is the job of the charge.refunded webhook (the same path a refund made in the Stripe Dashboard takes), so there is
 * one place that revokes access and the admin page shows what Stripe has actually confirmed. All this records is
 * refund_requested_at, which the page shows as "refund requested, waiting for Stripe" until the webhook arrives.
 *
 * Server actions are public endpoints: the admin session is checked here, not trusted from the page that rendered the button.
 */
export async function refundPurchaseAction(_previous: RefundState, formData: FormData): Promise<RefundState> {
  const fail = (message: string): RefundState => ({ status: "error", message });

  if (!adminConfigured() || !verifySessionValue((await cookies()).get(ADMIN_COOKIE)?.value)) {
    return fail("Your admin session has ended. Sign in again.");
  }
  const limit = await adminRefundLimiter.check(clientKey(new Request("http://localhost/admin", { headers: await headers() })));
  if (!limit.allowed) return fail(`Too many refunds in a short time. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`);

  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return fail("That is not a Stripe session id.");

  const supabase = getSupabaseAdmin();
  const stripe = getStripe();
  if (!supabase || !stripe) return fail("Stripe or the database is not configured.");

  const { data: purchase, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select("stripe_session_id, paid_at, refunded_at, refund_requested_at, stripe_payment_intent_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (error) {
    logSupabaseError("admin refund lookup", error);
    return fail("Could not look that purchase up. Try again.");
  }
  if (!purchase) return fail("No such purchase.");
  if (!purchase.paid_at) return fail("That checkout was never paid, so there is nothing to refund.");
  if (purchase.refunded_at) return fail("That purchase is already refunded.");
  if (typeof purchase.stripe_payment_intent_id !== "string" || purchase.stripe_payment_intent_id === "") {
    return fail("This purchase has no Stripe payment on record (it predates refunds), so refund it in the Stripe Dashboard.");
  }

  let alreadyRefundedAtStripe = false;
  try {
    await stripe.refunds.create(
      { payment_intent: purchase.stripe_payment_intent_id, reason: "requested_by_customer", metadata: { source: "admin_refund", session_id: sessionId } },
      // One refund per purchase however many times the button is pressed or the request is retried.
      { idempotencyKey: `admin-refund-${sessionId}` },
    );
  } catch (refundError) {
    const code = (refundError as { code?: string }).code;
    const type = (refundError as { type?: string }).type;
    if (code === "charge_already_refunded") {
      alreadyRefundedAtStripe = true;
    } else if (type === "StripePermissionError" || code === "more_permissions_required") {
      return fail("The Stripe key this app runs with is not allowed to create refunds. Give the restricted key \"Charges and Refunds: Write\" (Dashboard > Developers > API keys) and try again, or refund in the Stripe Dashboard.");
    } else {
      console.error("[admin] Stripe refund failed:", refundError instanceof Error ? refundError.message : refundError);
      return fail(`Stripe did not accept the refund: ${refundError instanceof Error ? refundError.message : "unknown error"}`);
    }
  }

  const { error: stampError } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .update({ refund_requested_at: new Date().toISOString() })
    .eq("stripe_session_id", sessionId)
    .is("refunded_at", null);
  if (stampError) logSupabaseError("admin refund stamp", stampError); // the refund itself went through; only the "requested" marker is missing

  revalidatePath("/admin");
  return {
    status: "requested",
    message: alreadyRefundedAtStripe
      ? "Stripe says this payment is already refunded. The status changes to refunded when Stripe's webhook arrives."
      : "Refund sent to Stripe. The status changes to refunded when Stripe's charge.refunded webhook arrives (usually within seconds).",
  };
}
