# Testing the payment flow end to end (Stripe test mode)

Everything here uses Stripe's **test mode**: no real card, no real money. The app talks to your **real Supabase**.

There are two ways to test: by hand in your browser (steps 1 to 6), or automatically with `npm run e2e:stripe` (step 7).
Do the one-time setup (steps 0 to 3) first either way. The two scripts (`db:check`, `e2e:stripe`) are TypeScript run directly by Node, which needs **Node 22.18 or newer** (`node -v`).

## 0. Once: the database

The code needs the tables and columns in `supabase/migrations/*_init.sql`. Apply it once (it is safe to run again):

- **Easiest:** Supabase Dashboard → **SQL Editor** → **New query** → paste the whole file → **Run**.
- **Or with the CLI:** `npx supabase login`, then `npx supabase link --project-ref <your-project-ref>`, then `npx supabase db push`.

Then check it:

```bash
npm run db:check
```

It must end with `The database matches what the code expects.` (Add `-- --probe-constraints` to also prove the unique keys that
make webhook redelivery and double checkouts safe: it inserts and deletes two throw-away rows.)

## 1. Install the Stripe CLI

Check: `stripe --version`. If it is not found:

| System | Command |
| --- | --- |
| **macOS (Homebrew)** | `brew install stripe/stripe-cli/stripe` |
| Windows (Scoop) | `scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git` then `scoop install stripe` |
| Linux | download the `.tar.gz` for your CPU from <https://github.com/stripe/stripe-cli/releases/latest>, unpack it and put `stripe` on your PATH (Debian/Ubuntu: Stripe's apt repository, see <https://docs.stripe.com/stripe-cli>) |

## 2. Log in

```bash
stripe login
```

It prints a pairing code and opens your browser; confirm there. (This is the one step that needs you at the Stripe Dashboard.)

## 3. Forward webhooks to the app

In a **second terminal** (leave it running):

```bash
stripe listen --forward-to localhost:3000/api/webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded,charge.dispute.created
```

It prints a line like `Ready! You are using Stripe API Version [...]. Your webhook signing secret is whsec_abc123...`.

1. Copy that `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET=whsec_...` (replace the old line, remove any `#` in front).
2. **Restart `npm run dev`.** Environment variables are read when the server starts.
3. Check: `curl localhost:3000/api/health` must say `"status":"ok"` with `"webhook":"ok"`.

The secret is **different every time you set up `stripe listen` on a new machine**, and different from the secret of an endpoint
you create in the Dashboard. If payments succeed but the database never says `paid_at`, this is almost always the reason.

## 4. Pay by hand

1. Open <http://localhost:3000>, upload a CSV with **more than 100 rows** (the free limit, `FREE_ROW_LIMIT` in `src/app/utils/pricing.ts`; exactly 100 is still free), click **Unlock Complete File ($9)**. The page also offers **Get your first big file free**: that one needs no card, so test it separately (see "The free first big file" below) and use a different file for the payment, because the free file is once per person.
   (No file at hand? `node -e "let s='title,price\n';for(let i=1;i<=130;i++)s+='PRODUCT '+i+',\$'+i+'.50\n';require('fs').writeFileSync('big.csv',s)"`)
2. On Stripe's page, tick the box with the withdrawal waiver, and pay with one of these (any future expiry, any CVC, any postal code):

| Card number | What happens |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 9995` | Declined (insufficient funds). Nothing is recorded as paid |
| `4000 0025 0000 3155` | Asks for 3-D Secure: click **Complete** on the test page that appears |
| `4000 0000 0000 0259` | Succeeds, then Stripe opens a **dispute** in the same second, often before the payment webhook is processed (tests the dispute webhook and event ordering) |

3. After a successful payment you are sent back to the app and the complete file downloads. In the `stripe listen` terminal you
   see `checkout.session.completed` answered `200`; in the `npm run dev` terminal there is no error.
4. In Supabase (Table Editor → `payment_intents`) the row has `paid_at`, `email` and `stripe_payment_intent_id` filled in.

### The free first big file, by hand

Needs `TRIAL_HASH_SECRET` in `.env.local` (and a restart). Load a file over 100 rows, click **Get your first big file free**, enter an email and press **Unlock this file free**: the complete file downloads with no card. Check in Supabase (`free_trials`): one row with a 64-character `email_hash`, your `browser_id` and the `file_fingerprint`, and **no email address** (unless you ticked the optional box, which is unticked by default). Try a second big file in the same browser: it is refused with a message, and the paid button still works.

To try it again as a "new person", delete your row from `free_trials` **and** clear the site's cookies and localStorage (the browser id lives in both); otherwise the email, the cookie or the stored id still recognises you. `npm run e2e:stripe -- --flow=trial` automates all of this and cleans up after itself.

## 5. Refund

Find the payment's id (`pi_...`): Dashboard (Test mode) → **Payments**, or

```bash
stripe payment_intents list --limit 3
```

then either

- **CLI:** `stripe refunds create --payment-intent=pi_...`
- **Dashboard (Test mode):** Payments → the payment → **Refund** → full refund.

What must happen (a few seconds later, `stripe listen` shows `charge.refunded` answered `200`):

- `payment_intents.refunded_at` is set and `refund_reason` is `refund`;
- `usage_telemetry.is_unlocked` goes back to `false` (the file can be bought again);
- the **Recover** page for that email says the payment was refunded, uploading the same file asks for payment again, and an
  old download token is refused by `/api/unlock/verify` (403).

A **partial** refund (say $2 of the $9) deliberately changes nothing: only a full refund or a dispute takes the unlock away.

> `stripe trigger charge.refunded` does **not** test this app: it creates its own fixture payment, which has no link to your
> database, so the webhook correctly ignores it ("not from this project"). Refund a payment you made through the app.

## 6. The admin Refund button

The same refund, from <http://localhost:3000/admin> (sign in with `ADMIN_PASSWORD`): each paid purchase has a **Refund** button. The first click only asks "are you sure?"; **Yes, refund** sends one full refund to Stripe. The row then says *refund requested* and turns to *refunded* by itself when Stripe's `charge.refunded` webhook arrives (so `stripe listen` must be running; the page refreshes every few seconds for a minute). It needs the *Charges and Refunds: Write* permission on the key the app uses, and tells you so if it is missing.

## 7. Where to look when it does not work

| Symptom | Likely cause |
| --- | --- |
| `curl localhost:3000/api/health` says `degraded` | `database: fail` = migration not applied (`npm run db:check`); `webhook: fail` = `STRIPE_WEBHOOK_SECRET` missing; `unlock: fail` = `UNLOCK_TOKEN_SECRET` missing |
| `stripe listen` shows `409` for some events | The same event reached the app more than once at the same time. Most often more than one `stripe listen` is running (`pgrep -fl "stripe listen"`); each one forwards every event. The app waits for the first delivery and acknowledges the others, so a 409 now means one stayed busy for 8 seconds. Keep one `stripe listen` |
| `stripe listen` shows `400` for every event | The `whsec_` in `.env.local` is not the one `stripe listen` printed, or the app was not restarted after changing it |
| `stripe listen` shows nothing at all | It is not running, or the payment was made in live mode / another Stripe account than the one you logged in to |
| `200` but `paid_at` stays empty | Look at the app's terminal for `[webhook]` lines. `ignored ... not from this project` means the session was not created by this app |
| Checkout button says "We couldn't start checkout" | The app's terminal shows Stripe's reason (`[checkout] Stripe session create failed:`). With `ENABLE_STRIPE_TAX=true` and no Stripe Tax setup, that is the reason: remove the flag |
| A refund does not change anything | The event was a partial refund, or the payment was made before `stripe_payment_intent_id` existed (the app then falls back to the job id on the charge, and only when exactly one payment matches) |

## 8. Automatic: `npm run e2e:stripe`

The script does steps 4 and 5 for you, in headless Chrome, and checks the database after each one:

1. the app is healthy and the database matches the code (`db:check`);
2. creates a throw-away job in `usage_telemetry`, then `POST /api/checkout` creates the Checkout Session, and the session is
   retrieved from Stripe to check it (project tag, `$9.00`, the waiver checkbox is required);
3. fills in Stripe's hosted page with the test card, ticks the waiver, pays (including the 3-D Secure page for `--card=3ds`);
4. waits for the **webhook** and asserts `paid_at`, the receipt email and `stripe_payment_intent_id` are in Supabase, the job is
   unlocked, and the event is recorded as processed;
5. `/api/unlock` hands out a token and `/api/unlock/verify` accepts it;
6. **refunds** the payment through the Stripe API, waits for the webhook, and asserts `refunded_at` is set, the file is
   purchasable again, `/api/unlock` answers `403 refunded`, and the old token is refused;
7. deletes every row it created (checks the table row counts are unchanged) and expires a checkout it did not finish.

```bash
npm run dev                                   # terminal 1
stripe listen --forward-to localhost:3000/api/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded,charge.dispute.created   # terminal 2 (step 3)
npm run e2e:stripe                            # terminal 3
```

| Option | Meaning |
| --- | --- |
| `--flow=paid` (default) / `trial` | `trial` tests the **free first big file** (no Stripe, no Chrome, no card): exactly 100 rows is free (a trial is refused as unnecessary), 101 rows gets a token bound to its file; the database holds a hash, a browser id and a fingerprint and no email (unless `--opt-in`); a second trial is refused for the same email (even with a `+tag` or other capitals), for the same browser by cookie and by stored id; asking again for the same file renews it; the token is refused for any other file |
| `--opt-in` | With `--flow=trial`: also tick the optional product-updates box and check the address is stored only then |
| `--card=success` (default) / `decline` / `3ds` / `dispute` | Which test card. `decline` checks nothing is recorded as paid; `dispute` checks the dispute webhook (no refund permission needed) |
| `--webhook=cli` (default) | Wait for `stripe listen` to deliver the webhook |
| `--webhook=poll` | No Stripe CLI: the script fetches the real events from Stripe and posts them to the app, signed with `STRIPE_WEBHOOK_SECRET` (the app must use the same value). It proves your handler, not Stripe's own signing |
| `--manual` | Do not use Chrome: the script prints the checkout URL and you pay in your own browser |
| `--manual-refund` | You refund in the Dashboard while the script waits (for a key that may not create refunds) |
| `--no-refund` | Skip the refund steps |
| `--app=URL` | The running app (default `http://localhost:3000`, or `E2E_APP_URL`) |
| `--keep` | Leave the rows it created (they carry an `e2e-stripe-…` marker) |
| `--timeout=90` | Seconds to wait for each webhook |

**Refund permission.** The restricted key the app runs with only needs *Checkout Sessions* (it never creates refunds), so the
refund step may say `This key cannot create refunds`. Fix it for the script only: Dashboard (Test mode) → Developers → API keys →
edit the restricted key → *Charges and Refunds: Write*; or put an `sk_test_...` key in `STRIPE_E2E_SECRET_KEY` in `.env.local`;
or use `--manual-refund`.

**Safety.** It refuses to start unless the Stripe key is a test key (`sk_test_`/`rk_test_`). It never prints a key. Test payments and
refunds stay in your Stripe sandbox (that is what it is for); in Supabase it deletes only the rows it created.

**Exit code:** `0` everything passed · `1` a step failed · `2` it could not start (not a test key, no Chrome, missing env) ·
`3` everything passed but the refund steps were skipped.

Chrome is found automatically on macOS, Windows and Linux; otherwise set `CHROME_PATH`.
