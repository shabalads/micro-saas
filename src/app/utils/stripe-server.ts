// src/app/utils/stripe-server.ts
//
// Server-only Stripe access. The client is created lazily because stripe-node throws at construction
// time when the key is missing, which would break `next build` on a machine without the env var.

import "server-only";
import Stripe from "stripe";

/** One-time price of a full file cleanup, in US cents. */
export const CHECKOUT_AMOUNT_CENTS = 900;

let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (client) return client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  client = new Stripe(secretKey);
  return client;
}

/**
 * Where Stripe sends the customer back to. Set APP_URL in production; locally it falls back to the
 * origin the request came in on, which is http://localhost:3000 during `next dev`.
 */
export function getAppOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  return (configured ? configured : new URL(request.url).origin).replace(/\/+$/, "");
}
