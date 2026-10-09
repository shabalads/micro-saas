// src/app/api/webhook/route.ts

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { findJobIdForSession, unlockJob } from "../../utils/payments-db";
import { getStripe } from "../../utils/stripe-server";
import { getSupabaseAdmin, isUuid } from "../../utils/telemetry-db";

/**
 * Receives Stripe webhooks. A 2xx tells Stripe the event was handled; a 5xx makes Stripe retry it,
 * which is what we want for transient database failures.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabase = getSupabaseAdmin();
  if (!stripe || !webhookSecret || !supabase) {
    console.error("[webhook] not configured: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET or Supabase env missing");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });

  // The signature covers the exact bytes Stripe sent, so read the raw text, never a parsed body.
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("[webhook] signature verification failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // async_payment_succeeded covers payment methods that settle after the checkout page closes.
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object;
  // "completed" also fires for delayed payment methods that have not been paid yet.
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });

  // Match the session id in the payment_intents ledger; the id Stripe echoes back from checkout creation
  // is the fallback if that ledger lookup finds nothing.
  const { jobId: ledgerJobId, failed } = await findJobIdForSession(supabase, session.id);
  if (failed) return NextResponse.json({ error: "Database error." }, { status: 500 });
  const jobId = ledgerJobId ?? (isUuid(session.client_reference_id) ? session.client_reference_id : null);
  if (!jobId) {
    console.warn("[webhook] paid session is not linked to any job:", session.id);
    return NextResponse.json({ received: true });
  }

  const outcome = await unlockJob(supabase, jobId);
  if (outcome === "error") return NextResponse.json({ error: "Database error." }, { status: 500 });
  if (outcome === "not_found") console.warn("[webhook] paid session points at a missing job:", session.id, jobId);
  return NextResponse.json({ received: true });
}
