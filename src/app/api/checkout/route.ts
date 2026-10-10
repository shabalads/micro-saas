// src/app/api/checkout/route.ts

import { NextResponse } from "next/server";
import { checkoutConsentMessage, checkoutSubmitMessage } from "../../../site/legal";
import { isFingerprint } from "../../utils/paywall";
import { stripeTaxEnabled } from "../../utils/pricing";
import { checkoutLimiter, clientKey, tooManyRequests } from "../../utils/rate-limit";
import {
  CHECKOUT_AMOUNT_CENTS,
  CHECKOUT_TAX_BEHAVIOR,
  CHECKOUT_TAX_CODE,
  PROJECT_SOURCE,
  getAppOrigin,
  getStripe,
} from "../../utils/stripe-server";
import {
  PAYMENT_INTENTS_TABLE,
  TELEMETRY_TABLE,
  getSupabaseAdmin,
  isUuid,
  logSupabaseError,
  toSafeCount,
} from "../../utils/telemetry-db";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Creates a Stripe Checkout Session for a flat $9.00 "File Cleanup" and returns its URL.
 * Body: { telemetryId: string, rowCount: number, fingerprint?: string } where telemetryId is the usage_telemetry row of
 * the job and fingerprint identifies the file being paid for (so the payment can be recovered on another device).
 */
export async function POST(request: Request) {
  const limit = await checkoutLimiter.check(clientKey(request));
  if (!limit.allowed) {
    return tooManyRequests(limit, { error: "Too many checkout attempts. Please wait a few minutes and try again." });
  }

  const body: unknown = await request.json().catch(() => null);
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  if (!stripe || !supabase) {
    console.error(
      `[checkout] not configured: ${[!stripe && "STRIPE_SECRET_KEY", !supabase && "Supabase env"].filter(Boolean).join(", ")} missing`,
    );
    return fail("Checkout isn't available yet. Please try again later.", 503);
  }

  // Resolve the job. Reuse the client's telemetry row; if there is none (the telemetry call failed or was
  // still in flight) create one, so a paying customer is never blocked by an analytics hiccup.
  let jobId: string | null = null;
  if (isUuid(payload.telemetryId)) {
    const { data, error } = await supabase
      .from(TELEMETRY_TABLE)
      .select("id, is_unlocked")
      .eq("id", payload.telemetryId)
      .maybeSingle();
    if (error) {
      logSupabaseError("checkout job lookup", error);
      return fail("Something went wrong on our side. Please try again.", 500);
    }
    if (data?.is_unlocked) return fail("This file is already unlocked, so there is nothing to pay for.", 409);
    jobId = data ? payload.telemetryId : null;
  }
  if (!jobId) {
    const { data, error } = await supabase
      .from(TELEMETRY_TABLE)
      .insert({
        file_name_anonymized: "checkout",
        total_rows: toSafeCount(payload.rowCount) ?? 0,
        processing_time_ms: 0,
      })
      .select("id")
      .single();
    if (error || !data) {
      logSupabaseError("checkout job create", error);
      return fail("Something went wrong on our side. Please try again.", 500);
    }
    jobId = String(data.id);
  }

  const fingerprint = isFingerprint(payload.fingerprint) ? payload.fingerprint : null;

  const origin = getAppOrigin(request);
  // Stripe Tax is opt-in (ENABLE_STRIPE_TAX=true). With it off nothing below needs any tax setup in the Stripe account.
  const taxOn = stripeTaxEnabled();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: CHECKOUT_AMOUNT_CENTS,
            // Whether the $9 includes tax or tax is added on top. Only meaningful (and only sent) with Stripe Tax on.
            ...(taxOn ? { tax_behavior: CHECKOUT_TAX_BEHAVIOR } : {}),
            product_data: { name: "File Cleanup", ...(taxOn ? { tax_code: CHECKOUT_TAX_CODE } : {}) },
          },
        },
      ],
      // Stripe Tax works out the tax for the buyer's location, and lets business customers enter a tax ID. Both need the
      // billing address, which Checkout asks for (country included) either way, for the receipt.
      ...(taxOn ? { automatic_tax: { enabled: true }, tax_id_collection: { enabled: true } } : {}),
      billing_address_collection: "required",
      // The EU withdrawal waiver for digital content (Directive 2011/83/EU, Art. 16(m)). The customer must tick this
      // box, whose text carries both the express request for immediate delivery and the acknowledgement that the
      // 14-day right of withdrawal is lost once the file is delivered. Stripe keeps the acceptance on the session
      // (session.consent.terms_of_service), which is the record that consent was given. Because the box has its own
      // text (custom_text below), Stripe does not need a Terms of service URL in the Dashboard for it.
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: { message: checkoutConsentMessage() },
        submit: { message: checkoutSubmitMessage(taxOn) },
      },
      // Stripe signs these into the webhook event, so they can be trusted when it comes back. project_source is what
      // lets the webhook tell this app's events from other projects' on a shared Stripe account.
      client_reference_id: jobId,
      metadata: { telemetry_id: jobId, project_source: PROJECT_SOURCE },
      // Carried onto the payment itself (and from there onto its charge), so refund and dispute events are recognised as ours.
      payment_intent_data: { metadata: { telemetry_id: jobId, project_source: PROJECT_SOURCE } },
      // {CHECKOUT_SESSION_ID} is a literal placeholder that Stripe fills in, so it must not be encoded.
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&job_id=${jobId}`,
      cancel_url: `${origin}/?checkout=canceled&job_id=${jobId}`,
    });
  } catch (error) {
    console.error("[checkout] Stripe session create failed:", error instanceof Error ? error.message : error);
    return fail("We couldn't start checkout. Please try again.", 502);
  }
  if (!session.url) {
    console.error("[checkout] Stripe returned a session without a url:", session.id);
    return fail("We couldn't start checkout. Please try again.", 502);
  }

  // Ledger first, URL second: if we cannot record the attempt, do not send anyone off to pay.
  const { error: ledgerError } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .insert({ telemetry_id: jobId, stripe_session_id: session.id, file_fingerprint: fingerprint });
  if (ledgerError) {
    logSupabaseError("checkout payment_intents insert", ledgerError);
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    return fail("Something went wrong on our side. Please try again.", 500);
  }

  return NextResponse.json({ url: session.url, jobId, sessionId: session.id });
}
