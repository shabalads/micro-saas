// src/app/api/checkout/route.ts

import { NextResponse } from "next/server";
import { CHECKOUT_AMOUNT_CENTS, getAppOrigin, getStripe } from "../../utils/stripe-server";
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
 * Body: { telemetryId: string, rowCount: number } where telemetryId is the usage_telemetry row of the job.
 */
export async function POST(request: Request) {
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

  const origin = getAppOrigin(request);
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
            product_data: { name: "File Cleanup" },
          },
        },
      ],
      // Stripe signs these into the webhook event, so they can be trusted when it comes back.
      client_reference_id: jobId,
      metadata: { telemetry_id: jobId },
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
    .insert({ telemetry_id: jobId, stripe_session_id: session.id });
  if (ledgerError) {
    logSupabaseError("checkout payment_intents insert", ledgerError);
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    return fail("Something went wrong on our side. Please try again.", 500);
  }

  return NextResponse.json({ url: session.url, jobId });
}
