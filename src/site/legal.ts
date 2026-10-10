// src/site/legal.ts
//
// The wording of the 14-day withdrawal waiver for digital content. It appears in three places that must say the same
// thing: next to the unlock button, on the refund policy page, and in Stripe Checkout as the required checkbox (see
// the checkout route). Under EU consumer law (Directive 2011/83/EU, Article 16(m); in Czech law § 1837 písm. l) of the
// Civil Code) a consumer loses the right to withdraw from a digital download only if they gave PRIOR EXPRESS CONSENT to
// delivery during the withdrawal period AND acknowledged that they lose the right, and were told so before the contract
// was concluded. Both statements therefore have to be in the text the customer accepts.

import { stripeTaxEnabled } from "../app/utils/pricing";
import { COMPANY } from "./company";
import { absoluteUrl } from "./site-url";

/** Plain-language summary shown next to the unlock button, before the customer ever reaches Stripe. */
export const WAIVER_SUMMARY =
  "The complete file is a digital download delivered immediately after payment. By paying you expressly ask for it to be delivered right away and acknowledge that you then lose your 14-day right of withdrawal.";

/**
 * The money-back guarantee. It is a commercial promise on top of the law, separate from the statutory 14-day withdrawal
 * right that the checkbox below waives (that right ends when the file is delivered; this promise starts then). Its length
 * is COMPANY.goodwillDays, so the number is written once. Every place that mentions the guarantee uses these helpers.
 */
export function guaranteeLabel(): string {
  return `${COMPANY.goodwillDays}-day money-back guarantee`;
}

/** The promise itself, word for word. */
export function guaranteeSentence(): string {
  return `If the cleaned file doesn't work for you, full refund within ${COMPANY.goodwillDays} days, no questions asked.`;
}

/** The promise plus the clarification that it sits next to, not inside, the withdrawal waiver. Used right beside the pay button. */
export function guaranteeNearPayButton(): string {
  return `${guaranteeSentence()} This guarantee is separate from the legal right of withdrawal described above: it starts when the file is delivered and your other legal rights are not affected.`;
}

/** The consent and acknowledgement sentence. Identical on the refund page and in the Stripe Checkout checkbox. */
export const CONSENT_STATEMENT =
  "I expressly ask for the complete file to be delivered to me immediately after payment, and I acknowledge that once it has been delivered I lose my 14-day right to withdraw from this purchase.";

/**
 * The text of the required checkbox in Stripe Checkout. Markdown links are rendered by Stripe. Stripe allows 1,200
 * characters; a test keeps it well under that.
 */
export function checkoutConsentMessage(env?: Record<string, string | undefined>): string {
  const terms = absoluteUrl("/terms", env);
  const refunds = absoluteUrl("/refunds", env);
  const privacy = absoluteUrl("/privacy", env);
  return (
    `I agree to the [Terms of Service](${terms}), the [Refund Policy](${refunds}) and the [Privacy Policy](${privacy}). ` +
    CONSENT_STATEMENT
  );
}

/** Short note under the pay button in Stripe Checkout. The tax sentence is only true while Stripe Tax is switched on. */
export function checkoutSubmitMessage(taxEnabled: boolean = stripeTaxEnabled()): string {
  const delivery = "Your complete file is available to download right after payment.";
  const guarantee = `${guaranteeSentence()} (This is separate from the withdrawal right you waive in the box above.)`;
  return taxEnabled ? `${delivery} The total above includes the tax for your billing country. ${guarantee}` : `${delivery} ${guarantee}`;
}
