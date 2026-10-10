// src/site/company.ts
//
// *** EDIT THIS FILE BEFORE LAUNCH ***
// Everything the legal pages, the contact page and the footer say about who runs the site comes from here.
// Values that look like [[THIS]] are placeholders: they show up highlighted on the site until you replace them.
// Run `npm run check:launch` to list the ones that are still unfilled.
//
// The Czech details to enter come from your entry in the commercial register (obchodní rejstřík) and your tax
// registration. A sole trader (OSVČ) fills the same fields with their own name and details.

export const COMPANY = {
  /** The product name shown in the header, titles and legal text. Change it if you rename the product. */
  brandName: "Shopify CSV Sanitizer",

  // --- the operator (obchodní firma and registered details) ---
  legalName: "[[COMPANY LEGAL NAME, e.g. Example s.r.o.]]",
  companyId: "[[IČO: 8-digit company ID]]",
  vatId: "[[DIČ / VAT ID, e.g. CZ12345678 (or write: not a VAT payer)]]",
  street: "[[Street and number]]",
  postalCode: "[[Postal code]]",
  city: "[[City]]",
  country: "Czech Republic",
  /** How the company is entered in the commercial register, e.g. "Municipal Court in Prague, Section C, File 123456". */
  register: "[[Register entry, e.g. Municipal Court in Prague, Section C, File 123456]]",

  // --- contact ---
  /** Used for support, refunds and privacy requests. */
  email: "[[contact email, e.g. support@your-domain.com]]",
  phone: "",

  // --- where data lives (the privacy policy names them) ---
  hostingProvider: "[[hosting provider and region, e.g. Vercel (EU region)]]",
  databaseProvider: "[[database provider and region, e.g. Supabase, EU Central (Frankfurt)]]",

  // --- policy choices only you can make ---
  /** When the legal pages take effect, e.g. "1 November 2026". Shown at the top of each page. */
  effectiveDate: "[[effective date, e.g. 1 November 2026]]",
  /** How long anonymous usage statistics are kept. Delete older rows from usage_telemetry to match what you write here. */
  telemetryRetention: "[[retention period for usage statistics, e.g. 24 months]]",
  /** How soon you promise to answer a support request. */
  supportReplyTime: "2 working days",
  /**
   * The length of the money-back guarantee: "If the cleaned file doesn't work for you, full refund within N days, no questions
   * asked." Counted from delivery. It is a commercial promise on top of the law, written once here and used everywhere the
   * guarantee is mentioned (landing page, pricing, refund policy, FAQ, the pay button and the Stripe checkout page).
   */
  goodwillDays: 30,
  /**
   * How long the record of a free first file (hashed email, browser id, file fingerprint) is kept. Delete older rows from
   * free_trials to match what you write here (the README has the query). A person whose row is deleted can claim a free file again.
   */
  trialRetention: "24 months",

  // --- public bodies named in the legal pages (real details, not placeholders) ---
  dataProtectionAuthority: { name: "Úřad pro ochranu osobních údajů (Czech Office for Personal Data Protection)", website: "https://uoou.gov.cz" },
  adrBody: { name: "Česká obchodní inspekce (Czech Trade Inspection Authority)", website: "https://www.coi.cz" },
} as const;

export type Company = typeof COMPANY;

const PLACEHOLDER = /^\[\[.*\]\]$/;

/** True for a value that is still an unfilled [[placeholder]]. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

/** The company fields that still hold a placeholder. Empty once the file is filled in. */
export function findUnfilledPlaceholders(company: Record<string, unknown> = COMPANY): string[] {
  return Object.entries(company)
    .filter(([, value]) => typeof value === "string" && isPlaceholder(value))
    .map(([key]) => key);
}
