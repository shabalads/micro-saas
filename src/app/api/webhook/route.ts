// src/app/api/webhook/route.ts

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { type RefundReason, findPurchaseByPaymentIntent, markPaymentRefunded, markSessionPaid } from "../../utils/payments-db";
import { claimEventWaiting, completeEvent, releaseEvent } from "../../utils/stripe-events";
import { readPaymentFacts } from "../../utils/stripe-reversals";
import { PROJECT_SOURCE, getStripe } from "../../utils/stripe-server";
import { getSupabaseAdmin } from "../../utils/telemetry-db";

/** Money arrived. async_payment_succeeded covers payment methods that settle after checkout closes. */
const PAYMENT_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
/** Money went back: a refund of the whole charge, or a customer disputing it with their bank. Both take the purchase away. */
const REVERSAL_EVENTS = new Set(["charge.refunded", "charge.dispute.created"]);

function acknowledge(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, ...extra });
}

/** True only for objects that this app created: they carry metadata.project_source (see the checkout route). */
function isFromThisProject(event: Stripe.Event): boolean {
  const object = event.data.object as { metadata?: Record<string, string | null> | null } | null;
  return object?.metadata?.project_source === PROJECT_SOURCE;
}

/** A Stripe reference that is either an id or, when expanded, the object itself. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/**
 * Refunds and disputes. Unlike a checkout session, a refund names the payment (PaymentIntent), not the session, so the
 * purchase is found by the PaymentIntent id stored when it was paid. A charge carries the metadata of its PaymentIntent
 * (this app's project_source and job id); a dispute does not, so for a dispute that is not in the ledger yet, Stripe is asked
 * whose payment it is.
 *
 * These events are not ordered with the "paid" event: a disputed test card is disputed within seconds, and Stripe can deliver
 * the dispute first. A reversal of one of OUR payments that the ledger cannot find is therefore never acknowledged: it
 * answers 5xx and releases its claim, so the delivery is retried once the "paid" event has recorded the payment.
 */
async function handleReversal(supabase: SupabaseClient, stripe: Stripe, event: Stripe.Event) {
  let paymentIntentId: string | null;
  let jobId: string | null = null;
  let tagged = false;
  let reason: RefundReason;

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    // charge.refunded also fires for partial refunds (a goodwill $2 back). Only a full refund takes the unlock away.
    if (!charge.refunded) return acknowledge({ ignored: "partial_refund" });
    paymentIntentId = idOf(charge.payment_intent);
    jobId = charge.metadata?.telemetry_id ?? null;
    tagged = charge.metadata?.project_source === PROJECT_SOURCE;
    reason = "refund";
  } else {
    const dispute = event.data.object as Stripe.Dispute;
    paymentIntentId = idOf(dispute.payment_intent);
    reason = "dispute";
  }

  if (!tagged) {
    const known = paymentIntentId ? await findPurchaseByPaymentIntent(supabase, paymentIntentId) : { purchase: null, failed: false };
    if (known.failed) return NextResponse.json({ error: "Database error." }, { status: 500 });
    if (!known.purchase && event.type === "charge.dispute.created" && paymentIntentId) {
      // Not in the ledger, and a dispute has no metadata to say whose it is: read the payment itself. Another project's
      // dispute is acknowledged (not retried for days); one of ours that is not recorded yet falls through to be retried.
      try {
        const facts = await readPaymentFacts(stripe, paymentIntentId);
        tagged = facts.ours;
        jobId = facts.jobId;
      } catch (error) {
        console.error(`[webhook] ${event.type} ${event.id}: could not read payment ${paymentIntentId} from Stripe:`, error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Could not check the payment with Stripe." }, { status: 500 });
      }
    }
    if (!known.purchase && !tagged) {
      console.info(`[webhook] ignored ${event.type} ${event.id}: not from this project`);
      return acknowledge({ ignored: "other_project" });
    }
  }

  const claim = await claimEventWaiting(supabase, event);
  if (claim === "duplicate") return acknowledge({ duplicate: true });
  if (claim === "in_progress") return NextResponse.json({ error: "Event is being processed." }, { status: 409 });
  if (claim === "error") return NextResponse.json({ error: "Database error." }, { status: 500 });

  try {
    const outcome = await markPaymentRefunded(supabase, { paymentIntentId, jobId, reason });
    if (outcome === "error" || outcome === "not_recorded_yet" || outcome === "not_found") {
      // Release the claim so Stripe's retry runs it again (for the last two, once the "paid" event has been processed).
      await releaseEvent(supabase, event.id);
      if (outcome !== "error") console.info(`[webhook] ${event.type} ${event.id}: payment ${paymentIntentId ?? "(none)"} is not recorded yet, will be retried`);
      return NextResponse.json({ error: outcome === "error" ? "Database error." : "Payment is not recorded yet." }, { status: 500 });
    }
    if (outcome === "ambiguous") console.warn(`[webhook] ${event.type} ${event.id}: several purchases could be payment ${paymentIntentId ?? "(none)"}; nothing was changed`);
  } catch (error) {
    console.error("[webhook] processing failed:", error instanceof Error ? error.message : error);
    await releaseEvent(supabase, event.id);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  await completeEvent(supabase, event.id);
  return acknowledge();
}

/**
 * Receives Stripe webhooks, in this order:
 *  1. verify the signature (nothing in an unsigned body is trusted, not even which project it is for);
 *  2. ignore, with a 200, anything that is not this project's: other projects on the same Stripe account get their
 *     events delivered here too, and a non-2xx would make Stripe retry them for days;
 *  3. ignore event types we do not act on, and sessions that are not paid yet;
 *  4. claim the event id in Supabase, so a redelivery never processes it twice (a concurrent delivery waits for the
 *     holder; only one still busy after a few seconds is answered 409);
 *  5. record the payment, then check with Stripe whether it was already refunded or disputed and take it away if so (or,
 *     for a full refund or a dispute event, take it away), then mark the event processed.
 * A 2xx tells Stripe the event is dealt with; a 5xx (or 409 while another delivery holds it) makes Stripe retry. A refund
 * or dispute of one of our payments that is not in the ledger yet is a 5xx too, because the "paid" event may simply not
 * have been processed yet.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabase = getSupabaseAdmin();
  if (!stripe || !webhookSecret || !supabase) {
    console.error("[webhook] not configured: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET or Supabase env missing");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  // 1. Signature, over the exact bytes Stripe sent (so read the raw text, never a parsed body).
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("[webhook] signature verification failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // 2. Only this project's events. (Refunds and disputes carry no session, so they establish ownership themselves.)
  if (REVERSAL_EVENTS.has(event.type)) return handleReversal(supabase, stripe, event);
  if (!isFromThisProject(event)) {
    console.info(`[webhook] ignored ${event.type} ${event.id}: not from this project`);
    return acknowledge({ ignored: "other_project" });
  }

  // 3. Only the events that matter, and only once the money has actually arrived.
  if (!PAYMENT_EVENTS.has(event.type)) return acknowledge({ ignored: "event_type" });
  const session = event.data.object as Stripe.Checkout.Session;
  // "completed" also fires for delayed payment methods that have not been paid yet; async_payment_succeeded follows.
  if (session.payment_status !== "paid") return acknowledge({ ignored: "not_paid_yet" });

  // 4. Idempotency. A concurrent delivery of the same event is waited for, not turned away (see claimEventWaiting).
  const claim = await claimEventWaiting(supabase, event);
  if (claim === "duplicate") return acknowledge({ duplicate: true });
  if (claim === "in_progress") return NextResponse.json({ error: "Event is being processed." }, { status: 409 });
  if (claim === "error") return NextResponse.json({ error: "Database error." }, { status: 500 });

  // 5. Process. Release the claim on failure so that Stripe's retry gets to run it again.
  try {
    const paymentIntentId = idOf(session.payment_intent);
    const outcome = await markSessionPaid(supabase, {
      sessionId: session.id,
      clientReferenceId: session.client_reference_id,
      email: session.customer_details?.email ?? session.customer_email ?? null,
      paymentIntentId,
    });
    if (outcome === "error") {
      await releaseEvent(supabase, event.id);
      return NextResponse.json({ error: "Database error." }, { status: 500 });
    }
    if (outcome === "not_found") console.warn("[webhook] paid session is not linked to any job:", session.id);

    // The refund or dispute may have happened before this event was processed (a disputed test card is disputed within
    // seconds), and their own events cannot be relied on to come after this one. So ask Stripe what the payment looks like
    // now and take the purchase away at once if it was already reversed. This runs AFTER the payment is recorded: from this
    // point a refund or dispute event finds the purchase by its PaymentIntent id, and one that came earlier (and was told to
    // retry) is already visible to this check, so no reversal can slip between the two. A failed check releases the claim
    // and answers 5xx so it is run again; the payment itself stays recorded, so the customer who paid is not locked out.
    if (outcome === "paid" && paymentIntentId) {
      const facts = await readPaymentFacts(stripe, paymentIntentId);
      if (facts.reversal) {
        const reversed = await markPaymentRefunded(supabase, { paymentIntentId, jobId: facts.jobId ?? session.client_reference_id, reason: facts.reversal });
        if (reversed === "error") {
          await releaseEvent(supabase, event.id);
          return NextResponse.json({ error: "Database error." }, { status: 500 });
        }
        console.info(`[webhook] ${event.type} ${event.id}: payment ${paymentIntentId} was already ${facts.reversal === "dispute" ? "disputed" : "refunded"} on Stripe, so it was recorded as ${facts.reversal}`);
      }
    }
  } catch (error) {
    console.error("[webhook] processing failed:", error instanceof Error ? error.message : error);
    await releaseEvent(supabase, event.id);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  await completeEvent(supabase, event.id);
  return acknowledge();
}
