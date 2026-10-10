import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANY, findUnfilledPlaceholders, isPlaceholder } from "./company";
import { CONSENT_STATEMENT, WAIVER_SUMMARY, checkoutConsentMessage, checkoutSubmitMessage } from "./legal";
import { PRICE_LABEL, PRICE_USD, TAX_BEHAVIOR, stripeTaxEnabled, taxNote } from "../app/utils/pricing";
import { CHECKOUT_AMOUNT_CENTS, CHECKOUT_TAX_BEHAVIOR } from "../app/utils/stripe-server";

const ENV = { NEXT_PUBLIC_SITE_URL: "https://shop.example.test" };

describe("the withdrawal waiver wording (EU digital content)", () => {
  it("covers BOTH things the law requires: express request for immediate delivery, and acknowledgement of losing the right", () => {
    expect(CONSENT_STATEMENT).toMatch(/expressly ask/i);
    expect(CONSENT_STATEMENT).toMatch(/immediately/i);
    expect(CONSENT_STATEMENT).toMatch(/acknowledge/i);
    expect(CONSENT_STATEMENT).toMatch(/14-day right to withdraw/i);
    expect(CONSENT_STATEMENT).toMatch(/once it has been delivered/i);
  });

  it("the Stripe checkbox text includes that statement, links the legal pages from NEXT_PUBLIC_SITE_URL, and fits Stripe's limit", () => {
    const message = checkoutConsentMessage(ENV);
    expect(message).toContain(CONSENT_STATEMENT);
    expect(message).toContain("(https://shop.example.test/terms)");
    expect(message).toContain("(https://shop.example.test/refunds)");
    expect(message).toContain("(https://shop.example.test/privacy)");
    expect(message.length).toBeLessThanOrEqual(1200);
  });

  it("the summary shown before checkout says the same thing in plain words", () => {
    expect(WAIVER_SUMMARY).toMatch(/immediately/i);
    expect(WAIVER_SUMMARY).toMatch(/14-day right of withdrawal/i);
    expect(checkoutSubmitMessage(true).length).toBeLessThanOrEqual(1200);
  });
});

describe("price and tax stay consistent across the site and Stripe", () => {
  it("Stripe is charged exactly the advertised price", () => {
    expect(CHECKOUT_AMOUNT_CENTS).toBe(PRICE_USD * 100);
    expect(PRICE_LABEL).toBe(`$${PRICE_USD}`);
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("Stripe Tax is OFF unless ENABLE_STRIPE_TAX=true, and then the site stops talking about tax at checkout", () => {
    expect(stripeTaxEnabled()).toBe(false);
    expect(taxNote()).toBe("with no tax added at checkout");
    for (const value of ["", "false", "1", "TRUE", "yes"]) {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_STRIPE_TAX", value);
      expect(stripeTaxEnabled(), value).toBe(false);
    }
  });

  it("with Stripe Tax on, the tax wording on the site matches how Stripe is told to treat tax", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_STRIPE_TAX", "true");
    expect(stripeTaxEnabled()).toBe(true);
    expect(CHECKOUT_TAX_BEHAVIOR).toBe(TAX_BEHAVIOR);
    expect(taxNote()).toMatch(TAX_BEHAVIOR === "exclusive" ? /^plus /i : /^including /i);
    expect(taxNote()).toMatch(/billing country/i);
  });
});

describe("company details are placeholders until the owner fills them in", () => {
  it("recognises [[placeholders]] only", () => {
    expect(isPlaceholder("[[IČO]]")).toBe(true);
    expect(isPlaceholder("  [[x]]  ")).toBe(true);
    expect(isPlaceholder("Example s.r.o.")).toBe(false);
    expect(isPlaceholder("see [[this]] and more")).toBe(false);
  });

  it("lists every detail the owner still has to supply, and nothing that is a real value", () => {
    const unfilled = findUnfilledPlaceholders();
    for (const key of ["legalName", "companyId", "vatId", "street", "postalCode", "city", "register", "email", "hostingProvider", "databaseProvider", "effectiveDate", "telemetryRetention"]) {
      expect(unfilled, key).toContain(key);
    }
    for (const key of ["brandName", "country", "supportReplyTime", "goodwillDays", "dataProtectionAuthority", "adrBody"]) expect(unfilled, key).not.toContain(key);
  });

  it("reports nothing once everything is filled in", () => {
    const filled = Object.fromEntries(Object.entries(COMPANY).map(([key, value]) => [key, typeof value === "string" && isPlaceholder(value) ? "filled" : value]));
    expect(findUnfilledPlaceholders(filled)).toEqual([]);
  });

  it("names the real public bodies with real addresses", () => {
    expect(COMPANY.dataProtectionAuthority.website).toBe("https://uoou.gov.cz");
    expect(COMPANY.adrBody.website).toBe("https://www.coi.cz");
    expect(COMPANY.country).toBe("Czech Republic");
  });
});
