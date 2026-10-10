// src/app/utils/stripe-server.ts
//
// Server-only Stripe access. The client is created lazily because stripe-node throws at construction
// time when the key is missing, which would break `next build` on a machine without the env var.

import "server-only";
import Stripe from "stripe";
import { PRICE_USD, TAX_BEHAVIOR } from "./pricing";

/** One-time price of a full file cleanup, in US cents. */
export const CHECKOUT_AMOUNT_CENTS = PRICE_USD * 100;

/**
 * Stamped on every Checkout Session and PaymentIntent this app creates (metadata.project_source). A Stripe account
 * is often shared by several projects, and every project's webhook endpoint receives every event, so the webhook
 * only processes events that carry this value and acknowledges the rest untouched.
 */
export const PROJECT_SOURCE = "ecommerce_data_sanitizer";

/**
 * Only sent while Stripe Tax is on (ENABLE_STRIPE_TAX=true). "General - Electronically Supplied Services": a digital service delivered over the internet. Automatic tax needs a
 * product tax code, and without one Stripe falls back to the account default, which is usually "tangible goods".
 */
export const CHECKOUT_TAX_CODE = "txcd_10000000";

/** Whether tax is added on top of the price or included in it. Defined in ./pricing so the whole site stays consistent. */
export const CHECKOUT_TAX_BEHAVIOR = TAX_BEHAVIOR;

export type StripeKeyMode = "test" | "live" | "unknown";

/** Which Stripe environment a secret or restricted key belongs to, judged by its prefix. */
export function stripeKeyMode(key: string | undefined): StripeKeyMode {
  if (!key) return "unknown";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

/** Says out loud when the key does not match the environment: live charges from a laptop, or test keys in production. */
function warnOnKeyModeMismatch(mode: StripeKeyMode): void {
  const production = process.env.NODE_ENV === "production";
  if (mode === "live" && !production) {
    console.warn("[stripe] A LIVE Stripe key is in use outside production: checkouts here create real charges.");
  } else if (mode === "test" && production) {
    console.warn("[stripe] A TEST Stripe key is in use in production: no real payments will be taken.");
  } else if (mode === "unknown") {
    console.warn("[stripe] STRIPE_SECRET_KEY does not look like a Stripe secret or restricted key (expected sk_/rk_ test or live).");
  }
}

let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (client) return client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  warnOnKeyModeMismatch(stripeKeyMode(secretKey));
  client = new Stripe(secretKey);
  return client;
}

/**
 * Where Stripe sends the customer back to: NEXT_PUBLIC_SITE_URL (APP_URL is still honoured as an older name). Without
 * either, the request's own origin is used, which is right for local development (http://localhost:3000 under `next dev`).
 */
export function getAppOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  return (configured ? configured : new URL(request.url).origin).replace(/\/+$/, "");
}
