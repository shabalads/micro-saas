// src/app/utils/stripe-reversals.ts
//
// What Stripe itself says about a payment. The webhook hears about refunds and disputes as separate events that can arrive
// before, after or at the same moment as the "paid" event, so it cannot trust event order. Asking Stripe directly settles
// what the payment looks like right now, whatever order the events came in.

import "server-only";
import type Stripe from "stripe";
import type { RefundReason } from "./payments-db";
import { PROJECT_SOURCE } from "./stripe-server";

export interface PaymentFacts {
  /** The PaymentIntent carries this app's metadata.project_source tag. A dispute event has no metadata of its own, so this is how its owner is told. */
  ours: boolean;
  /** The job id this app stamped on the PaymentIntent (telemetry_id), if any. */
  jobId: string | null;
  /** Set when the payment has already been refunded in full or disputed. A dispute wins when both are true. */
  reversal: RefundReason | null;
}

/**
 * One PaymentIntent read, with its latest charge expanded (the charge carries the refunded and disputed flags). It needs
 * only the PaymentIntents permission of a restricted key: listing refunds or disputes would need more. Throws on any
 * Stripe error, because "could not ask" must never be mistaken for "nothing happened".
 */
export async function readPaymentFacts(stripe: Stripe, paymentIntentId: string): Promise<PaymentFacts> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const telemetryId = intent.metadata?.telemetry_id;
  return {
    ours: intent.metadata?.project_source === PROJECT_SOURCE,
    jobId: typeof telemetryId === "string" && telemetryId !== "" ? telemetryId : null,
    // refunded is true only for a full refund, matching the webhook: a partial refund does not take the unlock away.
    reversal: charge?.disputed ? "dispute" : charge?.refunded ? "refund" : null,
  };
}
