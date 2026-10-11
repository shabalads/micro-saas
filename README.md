# Shopify CSV Sanitizer

Upload a messy supplier CSV and get a clean Shopify product import: ALL CAPS titles fixed, legacy HTML stripped, handles generated, clumped image cells split, prices normalized.

Everything is cleaned **in the browser**; your file is never uploaded. Files with **100 rows or fewer are free** (exactly 100 is free). Larger files get a free before/after preview of their first 100 rows; the complete file is **free once per person** (your first big file) and otherwise costs a one-time **$9** through Stripe Checkout, with a **30-day money-back guarantee**. The limit lives in one constant, `FREE_ROW_LIMIT` in `src/app/utils/pricing.ts`, and the guarantee length in `COMPANY.goodwillDays` in `src/site/company.ts`; every page, test and share image reads them from there.

Built with Next.js 16 (App Router), Supabase and Stripe.

Around the tool there is a public site: landing page (`/`), legal pages (`/privacy`, `/terms`, `/refunds`, `/contact`), 18 static guides for specific Shopify import errors (`/fix/<slug>`, each with the tool embedded), `sitemap.xml`, `robots.txt`, OpenGraph images, and a password-protected `/admin` page. See "Before you publish".

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill it in (see "Environment variables")
npm run dev                     # http://localhost:3000
```

The app starts without any keys: cleaning and the free tier work. Checkout, unlocking and telemetry need Supabase and Stripe (below).

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit and route tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run db:check` (Node 22.18+) | Checks the REAL Supabase project against what the code uses: every table and column, and row level security (`-- --probe-constraints` also proves the unique keys). Rerun any time |
| `npm run e2e:stripe` | End-to-end payment test in Stripe **test mode** against your real Supabase: pays with a test card in headless Chrome, waits for the webhook, unlocks, refunds. See [scripts/e2e-stripe.md](scripts/e2e-stripe.md) |
| `npm run check:launch` | Lists what is still unfinished before going live: `[[placeholders]]` in `src/site/company.ts` and missing environment variables |
| `npm run check:navbar` | Browser check of the smart sticky header in headless Chrome (needs the app running; `-- --app=URL`, `-- --screenshots=DIR`): sticky, hides on scroll down, returns on a small scroll up, stays while focused, hovered or with the mobile menu open, reduced motion, anchors clear of it |

## Environment variables

Put these in `.env.local` for development; set them in your host's environment settings for production. `.env.local` is git-ignored. `.env.example` is the committed template.

| Variable | Required | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. `SUPABASE_URL` also works and takes priority. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side database access. **Secret.** It bypasses row level security, so it must never reach the browser: do not prefix it with `NEXT_PUBLIC_`. |
| `STRIPE_SECRET_KEY` | yes | Creates Checkout Sessions and confirms payments. **Secret.** A secret key (`sk_…`) or a restricted key (`rk_…`), see below. |
| `STRIPE_WEBHOOK_SECRET` | yes | Verifies that webhook requests really come from Stripe (`whsec_…`). **Secret.** |
| `TRIAL_HASH_SECRET` | yes (for the free first big file) | The key that makes the stored email hash one-way: `HMAC-SHA256(key, email)`. **Secret**, 32+ random characters (`openssl rand -base64 48`). **Do not change it after launch**: every stored hash would stop matching and people who already had their free file could claim another. Without it the free first file is switched off (the button answers "not available" and `/api/health` reports `trial: fail`). |
| `UNLOCK_TOKEN_SECRET` | yes | Signs the short-lived tokens that unlock a paid export. **Secret**, 32+ random characters: `openssl rand -base64 48`. Rotating it invalidates all outstanding tokens (customers just get a fresh one). |
| `NEXT_PUBLIC_SITE_URL` | yes (build) | The public origin of the site, e.g. `https://yourshop.com`: scheme and host only, no path, no trailing slash. Used for canonical URLs, `sitemap.xml`, `robots.txt`, OpenGraph tags, structured data, Stripe's success/cancel URLs and the links in the checkout consent text. **Inlined at build time**: rebuild after changing it. A production build fails if it is missing or invalid; in development it defaults to `http://localhost:3000`. |
| `ADMIN_PASSWORD` | for `/admin` | Password for the admin page, 12+ characters. Without it `/admin` shows "not configured" and nothing else. |
| `ENABLE_STRIPE_TAX` | no (default **off**) | `true` turns on Stripe Tax at checkout (`automatic_tax` and tax ID collection) and makes the site say tax is calculated at checkout. Off, checkout needs **no tax setup** in Stripe and no tax is added. Read at **build** time (and when `npm run dev` starts), so rebuild after changing it. See "Stripe Tax". |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | no | With **both** set, rate limits are shared by every server instance (Upstash Redis). Without them they are counted in each server's memory and production logs a warning. See "Rate limiting". |
| `STRIPE_E2E_SECRET_KEY`, `E2E_APP_URL` | only for `npm run e2e:stripe` | A **test** key that may create refunds (if the app's restricted key may not), and the address of the app under test (default `http://localhost:3000`). |
| `APP_URL` | no | Older name for `NEXT_PUBLIC_SITE_URL`; still honoured for Stripe's return URLs when `NEXT_PUBLIC_SITE_URL` is not set. |
| `TRUSTED_PROXY_HOPS` | optional | How many of *your own* proxies sit in front of the app (default `1`). Used to find the real client address for rate limiting, see "Rate limiting". |

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` may exist in your setup but this app does not read them: all database and Stripe access is server-side.

### Stripe: test keys vs live keys

Stripe keeps **test mode** (the sandbox) and **live mode** completely separate: separate keys, separate data, separate webhook endpoints. Use test mode for everything except production.

| | Test mode (development, staging) | Live mode (production) |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…` | `sk_live_…` or `rk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_…` printed by `stripe listen` (local), or from a **test-mode** webhook endpoint | The `whsec_…` of a **live-mode** webhook endpoint |
| Payments | Card `4242 4242 4242 4242`, any future expiry, any CVC. No money moves. | Real cards, real money |
| Where to find them | Dashboard with the *Test mode* toggle **on** → Developers → API keys | Dashboard with test mode **off** |

Rules that prevent the usual mistakes:

- **Never mix modes.** A live secret key with a test webhook secret (or the reverse) means payments succeed but are never recorded. The app logs a warning when a live key runs outside `NODE_ENV=production`, or a test key runs in production.
- **Every webhook endpoint has its own secret.** The secret from `stripe listen` is not the secret of your dashboard endpoint, and the test-mode endpoint's secret is not the live one's. Copy the one for the endpoint that is actually delivering events.
- **Restricted keys** (recommended for production): the app calls Checkout Sessions (create, retrieve, expire) and, only for the **Refund** button in `/admin`, Refunds (create). Grant *Checkout Sessions: write* and, if you use that button, *Charges and Refunds: write*, and nothing else. Verify a restricted key with a test-mode purchase before relying on it, especially with Stripe Tax on.
- Keep live keys out of chat, tickets and screenshots. If one leaks, roll it in the dashboard (Developers → API keys) and update the environment.

### Stripe setup

1. **Webhook endpoint.** Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `$NEXT_PUBLIC_SITE_URL/api/webhook` (your site address followed by `/api/webhook`)
   - Events (all four):
     - **`checkout.session.completed`** and **`checkout.session.async_payment_succeeded`**: the payment arrived (the second covers payment methods that settle after the checkout page closes);
     - **`charge.refunded`**: a payment was refunded in full, which takes the unlock away (a partial refund changes nothing);
     - **`charge.dispute.created`**: the cardholder disputed the payment, which also takes the unlock away.
     Other events are acknowledged and ignored.
   - Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
2. **Shared Stripe account?** Every endpoint on an account receives every event. The app tags what it creates with `metadata.project_source = "ecommerce_data_sanitizer"` (on the session and on the payment, which its charge inherits) and returns 200 without processing any event that is not its own, so other projects' events are harmless. A dispute carries no metadata, so for one whose payment is not in the ledger yet the webhook reads the payment from Stripe (the key needs only the PaymentIntents permission) and checks the tag there. Sessions created before this tag existed are not processed by the webhook; the unlock endpoint still confirms them directly with Stripe.
3. **The withdrawal-waiver checkbox.** Checkout asks the customer to tick a required box (terms, and the 14-day withdrawal waiver for digital content). Its text is supplied by the app, so Stripe needs no Terms of service URL in the Dashboard for it. Setting your Terms and Privacy URLs there (Settings → Public details) is still good for receipts.
4. **Local development and testing.** Follow [scripts/e2e-stripe.md](scripts/e2e-stripe.md): installing the Stripe CLI, `stripe login`, `stripe listen --forward-to localhost:3000/api/webhook`, where to put the printed `whsec_…`, the test cards, refunds from the CLI or Dashboard, and the automated test. Restart `npm run dev` after changing `.env.local`. The webhook is optional for the happy path locally (the return page also confirms payment directly with Stripe), but refunds and disputes only reach the app through it.

### Stripe Tax (optional, off by default)

With `ENABLE_STRIPE_TAX` unset (or anything but `true`), checkout sends no tax settings at all: the customer pays exactly $9 and the site says "no tax added at checkout". Nothing has to be set up in Stripe.

To charge VAT or sales tax: set up Stripe Tax first (Dashboard → Tax → head office address and the registrations where you must collect), then set `ENABLE_STRIPE_TAX=true` and rebuild. Checkout then uses `automatic_tax`, `tax_id_collection` (businesses can enter a VAT ID), the tax code `txcd_10000000` ("General - Electronically Supplied Services") and the behaviour in `src/app/utils/pricing.ts` (`exclusive`: tax is added on top; `inclusive`: it is inside the $9, the usual choice for EU consumers). If you switch it on without setting Stripe Tax up, Stripe refuses to start checkout and the app's log says why. The flag is compiled into both the server and the browser code so the checkout and the wording on the site can never disagree: set it in the same place for the build and for the running app.

## Database (Supabase)

Everything the code needs is in **one idempotent file**: [supabase/migrations/20261009180000_init.sql](supabase/migrations/20261009180000_init.sql). It creates `usage_telemetry`, `payment_intents` (including `stripe_payment_intent_id`, `refunded_at`, `refund_reason`) and `stripe_events`, adds any column an older install lacks, creates the unique keys, and switches row level security on with no policies (only the server's service-role key can touch the tables). It is safe to run on an empty project and again on an existing one.

Apply it **once**:

- Supabase Dashboard → **SQL Editor** → **New query** → paste the file → **Run**, or
- `npx supabase link --project-ref <your-project-ref>` then `npx supabase db push`.

Then check it, and rerun the check whenever you like:

```bash
npm run db:check                          # tables, columns, row level security
npm run db:check -- --probe-constraints   # also proves the unique keys (inserts and deletes two throw-away rows)
```

`free_trials` holds the free-first-file records (see "How payment and unlocking work", step 6). To keep to the retention in the privacy policy, delete old rows on that schedule (deleting a row gives that person a new free file):

```sql
delete from free_trials where created_at < now() - interval '24 months';   -- match COMPANY.trialRetention
update free_trials set marketing_email = null, marketing_opt_in_at = null where marketing_email = 'someone@who-withdrew.com';
```

The expected schema lives in `src/app/utils/db-schema.ts`; a test fails if the migration stops covering it. When you add a column to the code, add it there and in a new migration file.

`stripe_events` rows older than ~30 days can be deleted; Stripe stops retrying an event after three days.

## How payment and unlocking work

1. The browser cleans the first 100 rows (`FREE_ROW_LIMIT`) for the free preview. A file of 100 rows or fewer is completely free; nothing beyond the preview of a bigger file is cleaned before payment or the free first file.
2. **Unlock** → `POST /api/checkout` creates a Stripe Checkout Session (billing address and the waiver checkbox; tax only with `ENABLE_STRIPE_TAX`) and records it in `payment_intents`. The upload is parked in the browser's IndexedDB while the customer is away.
3. Stripe calls `POST /api/webhook`: the signature is verified first, then the event must be this project's, then the event id is claimed in `stripe_events` so a redelivery is a no-op, and finally `payment_intents.paid_at` is stamped (with the receipt email and the PaymentIntent id).
4. `POST /api/unlock` turns the paid session into a 10-minute signed token. The browser must pass it to `POST /api/unlock/verify` before the paid export module is even downloaded.
5. Lost the download? The app recovers a parked file automatically on the next visit, and `/recover` finds a payment by receipt email or session id on any device. A payment covers the one file it was made for.
6. **Your first big file is free.** Next to the paid button, "Get your first big file free" asks for an email address (and, separately, an unticked optional box for product updates) and calls `POST /api/trial`, which gives one free unlock per person:
   - **One per email and one per browser.** The email is normalised (lower case, no `+tag`, no dots for Gmail) and stored only as an HMAC hash keyed by `TRIAL_HASH_SECRET`; the browser is a random id kept in localStorage **and** in an httpOnly cookie (`csv_trial_browser`, set only when a trial is granted), and either one matching is enough to refuse. Both are unique indexes in `free_trials`, so two simultaneous requests cannot both win.
   - **The same token as the paid flow**, signed with `UNLOCK_TOKEN_SECRET` and valid for 10 minutes, but its `sid` is `trial_<id>` and it is bound to the file's fingerprint: `POST /api/unlock/verify` checks it against the `free_trials` row and refuses it for any other file. The complete-file module still only loads after the server accepted the token.
   - **Asking again for the same file** (same email or browser, same fingerprint) returns the same trial, so a lost download can be repeated; a different file is refused with a clear message and the paid button stays.
   - **Limits:** 10 attempts per 10 minutes and 5 *new* trials per day per network address, because the email is **not verified** (there is no confirmation link). This is a deterrent for casual repeat use, not proof of identity: someone who changes email, clears both browser stores and changes network address can get another file.
   - **Data kept:** the hash, the browser id, the file fingerprint, the time; the email itself only if the optional updates box was ticked (with the time). Sending product updates is up to you (no mailing is built in): export `marketing_email` from `free_trials`, send through your own tool with an unsubscribe link, and clear `marketing_email`/`marketing_opt_in_at` when someone withdraws. Retention is `COMPANY.trialRetention` (default 24 months), see "Database".
7. **Refunds and disputes.** `charge.refunded` (full refunds only) and `charge.dispute.created` stamp `refunded_at` (and `refund_reason` = `refund` or `dispute`) on the purchase, found by its PaymentIntent id. From then on `/api/unlock` answers `403 refunded`, `/api/unlock/verify` rejects even a token that was issued before the refund, `/recover` says the payment was refunded, and the file is purchasable again. The same event delivered twice, or a refund followed by a dispute, changes nothing the second time. Events do not arrive in a fixed order (a disputed test card is disputed in the same second it is paid), so: a refund or dispute of one of our payments that the ledger has no row for yet answers 500 and releases its claim, so Stripe retries it later; and when the payment event is processed, the webhook asks Stripe whether that payment was already refunded in full or disputed and, if so, marks it refunded in the same delivery. The same event arriving twice at once (for example from two `stripe listen` processes) is not turned away: the second delivery waits a few seconds for the first, then acknowledges it, or does the work itself if the first failed. Only an event still being processed after that wait is answered 409.

The paywall is enforced by the app's structure, not by DRM: cleaning runs in the visitor's browser, so a determined developer can run the cleaner on their own. Hard enforcement would mean doing the work on the server.

## Operations

### Health check

`GET /api/health` returns `200 {"status":"ok"}` when the app is configured and can reach the database, and `503 {"status":"degraded"}` otherwise. It lists which component failed (`database`, `stripe`, `webhook`, `unlock`) as `"ok"`/`"fail"` and nothing else: no values, key modes or error text, because the endpoint is public. Details go to the server log. Point your uptime monitor or load balancer at it.

### Rate limiting

Per client address, sliding window of 10 minutes:

| Endpoint | Limit |
| --- | --- |
| `POST /api/checkout` | 10 |
| `POST /api/unlock` | 30 (email lookups: 8) |
| `POST /api/unlock/verify` | 60 |
| `POST /api/trial` | 10 attempts, and 5 new free trials per day (24 hours) |
| admin sign-in | 5 |
| admin refund | 20 |

Over the limit the API answers `429` with a `Retry-After` header.

- **Shared counters with Upstash.** Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (a free database at [console.upstash.com](https://console.upstash.com): copy the *REST* URL and token) and the limits above are counted in Redis, so they are exact however many server instances run. If Upstash is configured but unreachable, requests fall back to in-memory counters instead of failing, and the log says so once a minute.
- **Without Upstash** the counters live in each server's memory. On a single Node server the limit is exact; on serverless platforms each instance counts on its own, so it is only a brake on abuse. In production the app logs a warning once: `[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set ...`.
- **Proxy headers.** The client address comes from the end of `x-forwarded-for` (the entry your own proxy added), falling back to `x-real-ip`. Run behind a proxy or platform that sets them (Vercel, Cloudflare, nginx, a load balancer) and set `TRUSTED_PROXY_HOPS` if more than one of your proxies is in front. With no proxy headers (plain local development) all callers share one bucket.

### How files are read

- **Encoding.** A byte-order mark decides; otherwise valid UTF-8 is UTF-8 (a few broken bytes still count as UTF-8 and are reported). A legacy file is read as whichever of Windows-1252, 1250, 1251, ISO-8859-2 or ISO-8859-15 makes the most sense of its letters: the candidates are scored by how many of the accented letters belong to one real alphabet, penalising control characters, odd symbols and "text read with the wrong code page" patterns (`Ã©`, Latin letters glued to Cyrillic). The detected encoding is shown above the preview with a menu to pick another one, which re-reads the same file. Single-byte code pages are decoded with tables in `src/app/utils/single-byte-tables.ts`, because the runtime's `TextDecoder` disagrees about `windows-1252`. A short file with few accented letters can be ambiguous: the app says it was a guess and which others would also fit.
- **Variants.** Option columns (`Option1 Name`/`Option1 Value`, WooCommerce `Attribute 1 name`/`value(s)`, or plain `Size`/`Color`/`Material`... columns, at most three) become Shopify's `Option1..3 Name`/`Value`: one handle per product, the product-level fields (Title, Body, option names) only on its first row, a value on every variant row. A plain `Size` or `Style` column is only used if it really tells the variants of a product apart. Duplicate combinations and variants missing a value are reported, because the tool cannot know which variant you want to keep.
- **Which rows are one product.** Only rows that sit directly next to each other ever form a product, and never a row that is further down the file: a handle column (same handle, no contradicting title) decides if there is one; otherwise a product-code column (`Product code`, `Kod produktu`, `Parent SKU`, `Group ID`), or a `SKU` column whose value the variants of a product share; otherwise the same title next to each other, when the variants differ by an option value. The same title or handle again, under another product code or further down, is a separate product with its own handle (`-2`, `-3`) and a warning, never merged into the earlier one. One exception: a code identical to the code of the *different* product right before it was copied down and is not trusted for grouping, so the same title right below it with other option values is one product (a `SKU copied from previous product` warning lists those rows); two rows with the same options, or a row that is not directly below, still stay separate products.
- **Catalog data is kept.** `Vendor` (trimmed, spaces collapsed, cased like titles), `Type` (from the category), `Tags`, `Variant Inventory Qty` (from stock: whole numbers, `0` included; `Variant Inventory Tracker` is `shopify` when there is a quantity), `Variant Barcode` (from EAN: 8, 12, 13 or 14 digits), `Variant Grams` (from a weight, with its unit), `Image Position` (1, 2, 3 per product; an image repeated within a product is written once) and `Status` (`draft` unless "Import as active" is ticked). Product-level fields are on a product's first row only. Currency is not exported. A column is written only when the file has data for it. Header names are recognised in English, Czech, Slovak, Polish, German, French and Spanish.
- **Title casing.** An export option ("Title casing", with three example titles from the file under it) applies to titles and vendors: *Title Case* (the default: ALL CAPS and all-lowercase become Title Case, mixed case is left alone), *Sentence case* (only the first letter, acronyms, tokens with digits such as `750ml` or `USB-C`, and words that were already mixed-case such as `iPhone` keep their capitals) or *Keep as supplied*. Company forms are always written the conventional way and never capitalized: `s.r.o.`, `a.s.`, `sp. z o.o.`, `e.K.` stay lower case, `GmbH`, `S.A.`, `B.V.`, `LLC`, `Ltd`, `Inc` keep their capitals (the list is `LEGAL_FORMS` in `src/app/utils/sanitizer.ts`). The choice never changes a handle or which rows form a product, and it survives the Stripe round trip with the other options.
- **SKUs.** "Make SKUs unique per variant" (on to start with when the variants of a product share one SKU) appends the variant's ASCII-slugged option values (`SKU-1001` becomes `SKU-1001-S-CERNA`); a SKU still used twice anywhere gets `-2`, `-3`. The changed rows are listed.
- **Warnings.** A panel (also in the free preview, where it says it covers only the preview rows) lists each kind of problem with its count and the first 10 row numbers: split products, SKUs copied from the previous product, duplicate variants, variants missing an option value, duplicate SKUs within and across products, SKUs made unique, invalid EANs (not 8, 12, 13 or 14 digits), EANs whose last digit is not the GS1 check digit (written as supplied, with the digit it should be), stock that is blank or not a number (`skladem`), unreadable weights, placeholder descriptions (the multilingual list is in `src/app/utils/placeholder-values.ts`), mixed currencies, a currency symbol in a price, and image links that are not http(s). After a download the panel shows the whole file's warnings. `test-data/messy-150-en.csv` and `messy-150.csv` (the same 150 supplier rows with English and Czech headers) are the regression files for all of it: `src/app/utils/messy-150.test.ts`.

## Production checklist

- [ ] The migration has been applied and `npm run db:check` ends with "The database matches what the code expects"
- [ ] `STRIPE_SECRET_KEY` is a **live** key (`sk_live_`/`rk_live_`) and `STRIPE_WEBHOOK_SECRET` is from the **live-mode** endpoint
- [ ] Live webhook endpoint points at `$NEXT_PUBLIC_SITE_URL/api/webhook` with the four events listed in "Stripe setup"
- [ ] Tax decided: either `ENABLE_STRIPE_TAX` is unset (no tax is added), or Stripe Tax is set up (head office address, registrations), `ENABLE_STRIPE_TAX=true` is set for the build, and a test purchase shows tax on the Checkout page
- [ ] `NEXT_PUBLIC_SITE_URL` is the public https origin (set before `npm run build`); `UNLOCK_TOKEN_SECRET` is a fresh random value, not the development one
- [ ] `ADMIN_PASSWORD` is set to a long unique value; `TRIAL_HASH_SECRET` is a random 32+ character value that you will never change
- [ ] `npm run check:launch` reports nothing left to do (company details filled in, legal pages reviewed by a lawyer)
- [ ] `TRUSTED_PROXY_HOPS` matches your proxy setup, and (on serverless hosting) the two Upstash variables are set
- [ ] `GET /api/health` returns 200 from outside, and your monitor watches it
- [ ] `npm run e2e:stripe` passes in test mode (see scripts/e2e-stripe.md), then one real purchase and refund with a live card

## Before you publish

1. **Company details.** Open `src/site/company.ts` and replace every `[[...]]` placeholder (legal name, IČO, DIČ, address, commercial register entry, contact email, hosting and database providers, effective date, telemetry retention). Until then the legal pages show a "Not ready to publish" notice and the placeholders are highlighted. `npm run check:launch` lists what is left.
2. **Have the legal pages reviewed** by a Czech/EU consumer-law lawyer. They are a careful draft that matches what the code does, not legal advice. In particular: the statute references, the consumer information in Czech (Czech consumers are entitled to it in Czech), the ADR (ČOI) wording, and whether the confirmation of the contract on a durable medium (Stripe's receipt email) is enough.
3. **Tax.** Decide with your accountant whether to collect VAT/sales tax through Stripe Tax (`ENABLE_STRIPE_TAX`, off by default) and, if so, whether the $9 is shown net of tax (`"exclusive"`) or gross (`"inclusive"`, the usual choice for EU consumers): `src/app/utils/pricing.ts`.
4. **Guides.** The 18 guides live in `src/site/import-errors.ts`; each has a "last reviewed" date. Shopify changes its import rules, so re-check them against Shopify's documentation from time to time.
5. **Admin.** `/admin` (set `ADMIN_PASSWORD`) shows upload, free-first-file and payment counts: numbers only, e-mail addresses masked, never file contents. It is excluded from `robots.txt` and marked `noindex`. Each paid purchase has a **Refund** button: the first click only asks "are you sure?", the second sends a full refund to Stripe's refunds API (idempotent: pressing it twice makes one refund). The purchase turns to "refunded" only when Stripe's `charge.refunded` webhook arrives, the same path as a refund made in the Stripe Dashboard, so it needs `stripe listen` locally; until then the row says "refund requested" and the page refreshes itself. The key needs the *Charges and Refunds: write* permission (the page tells you if it does not have it).
6. **The free first file and the guarantee.** The guarantee's length is `COMPANY.goodwillDays`, the retention of free-file records is `COMPANY.trialRetention`; both are in `src/site/company.ts` and are written into the privacy policy and refund policy. Decide whether you can honour "full refund, no questions asked" for 30 days, and set `TRIAL_HASH_SECRET` before launch.

## Tests

```bash
npm test         # parser, encodings, variants, sanitizer, tokens, paywall, recovery, webhook (incl. refunds and disputes), checkout, unlock, rate limits (memory and Upstash), health, admin, migration vs. schema, sitemap, page rendering, guide data
npm run build    # type-checks and builds
```
