// src/app/utils/pricing.ts
//
// The price and how tax is treated, in one place so the checkout, the pricing section, the FAQ and the legal pages can
// never disagree. Safe for the browser and the server: no secrets here.

/** One-time price of the complete cleaned file, in US dollars. */
export const PRICE_USD = 9;

/**
 * Files with this many data rows or fewer are completely free: exactly this many is still free, one more is not. A larger
 * file gets a free before/after preview of its first rows and is unlocked by paying, or once per person by the free trial.
 * This is the ONE place the number is written: the paywall, the checkout and trial endpoints, every sentence on the site
 * (landing page, FAQ, terms, refund policy, guides, share images) and the tests all read it from here.
 */
export const FREE_ROW_LIMIT = 100;

/**
 * Whether tax is added on top of the price ("exclusive") or already inside it ("inclusive"). This is a pricing and
 * legal decision, not a technical one: with "exclusive" a customer in a taxed region pays more than $9. For consumers in
 * the EU, prices are normally shown including VAT, so "inclusive" is worth discussing with your accountant. Changing it
 * here updates Stripe Checkout and every sentence on the site. It only matters while Stripe Tax is on (see below).
 */
export const TAX_BEHAVIOR = "exclusive" as const;

export const PRICE_LABEL = `$${PRICE_USD}`;

/**
 * Whether Stripe Tax is switched on: ENABLE_STRIPE_TAX=true. OFF by default, and with it off checkout needs no tax setup
 * at all (the customer pays exactly the price). next.config.ts copies ENABLE_STRIPE_TAX into this build-time variable so
 * the checkout route (server) and the wording on the site (server and browser) always agree. That also means it is read
 * when the app is BUILT: change it, then rebuild or restart `next dev`.
 */
export function stripeTaxEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_STRIPE_TAX === "true";
}

/** The sentence that follows a price everywhere it is shown. */
export function taxNote(enabled: boolean = stripeTaxEnabled()): string {
  if (!enabled) return "with no tax added at checkout";
  return TAX_BEHAVIOR === "exclusive"
    ? "plus VAT or sales tax where it applies, calculated at checkout from your billing country"
    : "including VAT or sales tax where it applies, calculated at checkout from your billing country";
}
