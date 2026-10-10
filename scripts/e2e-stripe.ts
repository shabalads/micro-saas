// scripts/e2e-stripe.ts
//
// End to end, in Stripe TEST mode, against your REAL Supabase: create a Checkout Session through the app, pay it with a
// test card in a headless Chrome, wait for the webhook, check the payment landed in the database, unlock the file, then
// refund the payment and check the unlock is taken away again. Read scripts/e2e-stripe.md first.
//
//   npm run e2e:stripe -- --flow=trial                  # the free first big file: no Stripe, no Chrome (see below)
//
//   npm run e2e:stripe                                  # success card, webhook delivered by `stripe listen`
//   npm run e2e:stripe -- --webhook=poll                # no Stripe CLI: this script forwards the real events itself
//   npm run e2e:stripe -- --card=decline                # a declined card: nothing may be recorded as paid
//   npm run e2e:stripe -- --card=3ds                    # a card that asks for 3-D Secure
//   npm run e2e:stripe -- --card=dispute                # a card whose charge Stripe disputes right away (no refund permission needed)
//   npm run e2e:stripe -- --manual                      # you pay in your own browser instead of headless Chrome
//   npm run e2e:stripe -- --manual-refund               # you refund in the Dashboard while the script waits (key may not refund)
//   options: --app=http://localhost:3000  --keep (leave the rows behind)  --no-refund  --timeout=90  --opt-in (trial flow: also tick the product-updates box)
//
// The files used are always one row over the free limit (FREE_ROW_LIMIT in src/app/utils/pricing.ts, 100 today), because that is
// where the paid flow and the free first file begin. --flow=trial checks the boundary itself (exactly the limit is free: a trial is
// refused as unnecessary; one more row is a big file), the one-trial-per-email and per-browser rules, that the token only works
// for its own file, and that no email address is stored unless the optional box was ticked.
//
// Safety: it refuses any key that is not a TEST key. Everything it writes to the database carries a marker and is deleted
// again at the end (unless --keep), and a checkout it did not finish is expired. Test payments and refunds stay in your
// Stripe sandbox, which is what that is for. It never prints a key.
//
// Exit code: 0 everything passed | 1 something failed | 2 could not start | 3 passed but the refund step was skipped.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import Stripe from "stripe";
import { FREE_ROW_LIMIT } from "../src/app/utils/pricing.ts";
import { checkDatabase, formatReport } from "./check-db.ts";

/* -------------------------------------------------------------------------- */
/*  Options                                                                    */
/* -------------------------------------------------------------------------- */

try {
  process.loadEnvFile(".env.local");
} catch {
  /* variables may come from the shell */
}

function option(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const APP = (option("app") ?? process.env.E2E_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CARD = (option("card") ?? "success") as "success" | "decline" | "3ds" | "dispute";
const WEBHOOK_MODE = (option("webhook") ?? "cli") as "cli" | "poll";
const TIMEOUT_MS = Number(option("timeout") ?? 90) * 1000;
const MANUAL = flag("manual");
const KEEP = flag("keep");
const NO_REFUND = flag("no-refund");
const MANUAL_REFUND = flag("manual-refund");
const OPT_IN = flag("opt-in");
const FLOW = (option("flow") ?? "paid") as "paid" | "trial";
/** The smallest file that is not free: one row over the limit. */
const BIG_ROWS = FREE_ROW_LIMIT + 20;

const CARDS = {
  success: { number: "4242424242424242", label: "4242 4242 4242 4242 (succeeds)" },
  decline: { number: "4000000000009995", label: "4000 0000 0000 9995 (declined: insufficient funds)" },
  "3ds": { number: "4000002500003155", label: "4000 0025 0000 3155 (requires 3-D Secure)" },
  dispute: { number: "4000000000000259", label: "4000 0000 0000 0259 (succeeds, then is disputed by the cardholder)" },
} as const;

/* -------------------------------------------------------------------------- */
/*  Tiny test runner                                                           */
/* -------------------------------------------------------------------------- */

let failures = 0;
let skipped = 0;
const pad = (n: number) => String(n).padStart(2, "0");
let stepNumber = 0;

function say(line: string) {
  console.log(line);
}

/** Runs a step, prints ok/FAIL with the detail it returns, and stops the run on the first failure unless told otherwise. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  stepNumber++;
  const label = `[${pad(stepNumber)}] ${name}`;
  try {
    const result = await run();
    say(`ok    ${label}${typeof result === "string" && result ? `  (${result})` : ""}`);
    return result;
  } catch (error) {
    failures++;
    say(`FAIL  ${label}\n        ${error instanceof Error ? error.message : String(error)}`);
    throw new Stop();
  }
}

class Stop extends Error {}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(label: string, probe: () => Promise<T | null | undefined | false>, timeoutMs: number = TIMEOUT_MS, everyMs = 1500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}`);
    await sleep(everyMs);
  }
}

/* -------------------------------------------------------------------------- */
/*  Headless Chrome, driven over the DevTools protocol                         */
/* -------------------------------------------------------------------------- */

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      const full = join(dir, name);
      if (dir && existsSync(full)) return full;
    }
  }
  return null;
}

interface CdpMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
  params?: Record<string, unknown>;
}

class Browser {
  private process: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private profile = "";

  async open(executable: string): Promise<void> {
    this.profile = mkdtempSync(join(tmpdir(), "e2e-stripe-chrome-"));
    const port = 9400 + Math.floor(Math.random() * 500);
    this.process = spawn(
      executable,
      [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${this.profile}`, "--no-first-run", "--disable-gpu", "--disable-background-networking", "--window-size=1280,1600", "--lang=en-US", "--accept-lang=en-US", "about:blank"],
      { stdio: "ignore" },
    );
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
        target = list.find((entry) => entry.type === "page");
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error("Chrome did not start");
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.socket!.onopen = () => resolve();
      this.socket!.onerror = () => reject(new Error("could not connect to Chrome"));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve((message.result ?? {}) as Record<string, unknown>);
      }
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Network.setExtraHTTPHeaders", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    await this.send("Emulation.setLocaleOverride", { locale: "en-US" }).catch(() => {});
    // After paying, Stripe sends the browser back to the app, whose page would ask the server to confirm the payment
    // itself. That would make paid_at appear without the webhook ever running, which is the thing under test.
    await this.send("Network.setBlockedURLs", { urls: [`${APP}/api/*`] });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Evaluates JavaScript in the page and returns its (JSON) value. */
  async eval<T>(expression: string, sessionId?: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)) as {
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
  }

  /** Focuses the field and types into it the way a person would, so the page's own handlers see every change. */
  async type(selector: string, text: string): Promise<void> {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no field ' + ${JSON.stringify(selector)}); el.focus(); if (el.select) el.select(); return true; })()`);
    await this.send("Input.insertText", { text });
  }

  /** Saves a screenshot, for the failure message of a step that waits on the page. */
  async screenshot(file: string): Promise<string> {
    const { data } = (await this.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  async close(): Promise<void> {
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.process?.kill();
    await sleep(300);
    if (this.profile) rmSync(this.profile, { recursive: true, force: true });
  }
}

/** Fills in and submits Stripe's hosted Checkout page. Selectors are the stable element ids Stripe uses on that page. */
async function payInBrowser(browser: Browser, url: string, card: string, email: string): Promise<{ outcome: "redirected" | "declined" | "challenge"; detail: string }> {
  await browser.goto(url);
  await waitUntil("the Stripe Checkout form", () => browser.eval<boolean>(`!!document.querySelector('#cardNumber')`).catch(() => false), 40_000, 500);
  await sleep(1500); // the page finishes laying out (and loads Link) after the fields appear

  await browser.type("#email", email);
  await browser.type("#cardNumber", card);
  await browser.type("#cardExpiry", "1234");
  await browser.type("#cardCvc", "123");
  await browser.type("#billingName", "E2E Tester");
  // A country every field below makes sense for, set the way React expects (the page ignores a bare .value assignment).
  await browser.eval(`(() => {
    const select = document.querySelector('#billingCountry');
    if (select) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'CZ');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await sleep(700);
  if (await browser.eval<boolean>(`!!document.querySelector('#billingAddressLine1')`)) await browser.type("#billingAddressLine1", "Testovaci 1");
  if (await browser.eval<boolean>(`!!document.querySelector('#billingPostalCode')`)) await browser.type("#billingPostalCode", "11000");
  if (await browser.eval<boolean>(`!!document.querySelector('#billingLocality')`)) await browser.type("#billingLocality", "Praha");

  // The required waiver checkbox must be ticked; "save my info with Link" must not be (it would ask for a phone number).
  const consent = await browser.eval<string>(`(() => {
    const box = document.querySelector('#termsOfServiceConsentCheckbox');
    if (!box) return 'none';
    if (!box.checked) box.click();
    return box.checked ? 'ticked' : 'not-ticked';
  })()`);
  await browser.eval(`(() => { const box = document.querySelector('#enableStripePass'); if (box && box.checked) box.click(); return true; })()`);
  if (consent === 'not-ticked') throw new Error("the waiver checkbox could not be ticked");
  say(`        waiver checkbox on the payment page: ${consent === "none" ? "NOT PRESENT" : "present and ticked"}`);

  await sleep(500);
  const clicked = await browser.eval<boolean>(`(() => {
    const button = document.querySelector('button.SubmitButton, button[type=submit], [data-testid=hosted-payment-submit-button]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("could not find the pay button");
  const submittedAt = Date.now();

  // What happens next: Stripe sends the browser back to the app (paid), shows an error (declined), or opens 3-D Secure.
  const outcome = await waitUntil<{ outcome: "redirected" | "declined" | "challenge"; detail: string }>(
    "the result of the payment",
    async () => {
      const state = await browser.eval<{ href: string; error: string; challenge: boolean }>(`({
        href: location.href,
        error: [...document.querySelectorAll('[role="alert"], .FieldError, .ErrorText, [class*="Error"]')].map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 300),
        challenge: !!document.querySelector('iframe[name*="challenge"], iframe[src*="3d_secure"], iframe[src*="hooks.stripe.com"]')
      })`).catch(() => null);
      if (process.env.E2E_DEBUG) {
        say(`        [debug] ${state ? `${state.href.slice(0, 90)} error="${state.error.slice(0, 80)}" challenge=${state.challenge}` : "no state"}`);
        const { targetInfos } = (await browser.send("Target.getTargets")) as { targetInfos: Array<{ type: string; url: string }> };
        say(`        [debug] targets: ${targetInfos.map((info) => `${info.type}:${info.url.slice(0, 70)}`).join("  ")}`);
      }
      if (!state) return null;
      if (!state.href.includes("checkout.stripe.com") && state.href.startsWith(APP)) return { outcome: "redirected" as const, detail: state.href.split("?")[0] };
      // Stripe shows the page in the browser's language, so any error text still on the checkout page means the card was refused.
      if (state.error && state.href.includes("checkout.stripe.com") && Date.now() - submittedAt > 4000) return { outcome: "declined" as const, detail: state.error };
      // The 3-D Secure page is an iframe of another origin, so the page's own DOM cannot see inside it: ask DevTools for it.
      const { targetInfos } = (await browser.send("Target.getTargets")) as { targetInfos: Array<{ url: string }> };
      if (state.challenge || targetInfos.some((info) => /three-ds-2-challenge|3d_secure/.test(info.url))) return { outcome: "challenge" as const, detail: "3-D Secure challenge" };
      return null;
    },
    60_000,
    700,
  ).catch(async (error: Error) => {
    const page = await browser.eval<string>(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500)`).catch(() => "");
    const picture = await browser.screenshot(join(tmpdir(), `e2e-stripe-failure-${Date.now()}.png`)).catch(() => "");
    throw new Error(`${error.message}. The page said: "${page}"${picture ? `\n        Screenshot: ${picture}` : ""}`);
  });
  return outcome;
}

/** 3-D Secure test page: it lives in a nested iframe of another origin, so attach to it as its own DevTools target. */
async function completeThreeDSecure(browser: Browser): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const { targetInfos } = (await browser.send("Target.getTargets")) as { targetInfos: Array<{ targetId: string; url: string; type: string }> };
    for (const target of targetInfos.filter((info) => info.type === "iframe" || info.type === "page")) {
      if (!/3d_secure|three_d_secure/.test(target.url)) continue;
      const { sessionId } = (await browser.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })) as { sessionId: string };
      await browser.send("Runtime.enable", {}, sessionId).catch(() => {});
      const clicked = await browser
        .eval<boolean>(`(() => { const b = [...document.querySelectorAll('button, a, [role=button], input[type=submit]')].find(b => /complete/i.test(b.textContent || b.value || '')); if (!b) return false; b.click(); return true; })()`, sessionId)
        .catch(() => false);
      if (clicked) return;
    }
    await sleep(800);
  }
  throw new Error("the 3-D Secure test page never offered a 'Complete' button; complete it by hand with --manual");
}

/* -------------------------------------------------------------------------- */
/*  The run                                                                    */
/* -------------------------------------------------------------------------- */

interface PaymentRow {
  stripe_session_id: string;
  telemetry_id: string | null;
  paid_at: string | null;
  email: string | null;
  stripe_payment_intent_id: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
}
const PAYMENT_COLUMNS = "stripe_session_id, telemetry_id, paid_at, email, stripe_payment_intent_id, refunded_at, refund_reason";

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientAddress, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}
/** Each run counts as its own client for the app's rate limits. */
const clientAddress = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function main(): Promise<number> {
  const secretKey = process.env.STRIPE_E2E_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!/^(sk|rk)_test_/.test(secretKey)) {
    console.error("REFUSING TO RUN: the Stripe key is not a TEST key (sk_test_… / rk_test_…). This script moves money in whatever mode the key is in.");
    return 2;
  }
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (in .env.local).");
    return 2;
  }
  if (!["paid", "trial"].includes(FLOW) || !["success", "decline", "3ds", "dispute"].includes(CARD) || !["cli", "poll"].includes(WEBHOOK_MODE)) {
    console.error("Usage: --flow=paid|trial  --card=success|decline|3ds|dispute  --webhook=cli|poll");
    return 2;
  }
  if (WEBHOOK_MODE === "poll" && !webhookSecret) {
    console.error("--webhook=poll signs the events it forwards with STRIPE_WEBHOOK_SECRET, so set it (the same value the app uses).");
    return 2;
  }

  const stripe = new Stripe(secretKey, { maxNetworkRetries: 1 });
  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const chrome = MANUAL || FLOW === "trial" ? null : findChrome();
  if (!MANUAL && FLOW === "paid" && !chrome) {
    console.error("Chrome was not found. Install Google Chrome, or set CHROME_PATH, or pay by hand with --manual.");
    return 2;
  }

  say(
    FLOW === "trial"
      ? `App: ${APP}   Supabase: ${new URL(url).host}   Flow: the free first big file (free limit ${FREE_ROW_LIMIT} rows)\n`
      : `App: ${APP}   Supabase: ${new URL(url).host}   Card: ${CARDS[CARD].label}   Webhook: ${WEBHOOK_MODE === "cli" ? "stripe listen (CLI)" : "forwarded by this script"}   Big file: ${BIG_ROWS} rows (free limit ${FREE_ROW_LIMIT})\n`,
  );

  const startedAt = Math.floor(Date.now() / 1000) - 5;
  const marker = `e2e-stripe-${randomBytes(4).toString("hex")}`;
  const jobId = randomUUID();
  const fingerprint = `sha256:${randomBytes(32).toString("hex")}`;
  const email = `e2e+${randomBytes(3).toString("hex")}@example.com`;
  const browser = new Browser();
  const eventIds = new Set<string>();
  /** Files whose free_trials rows this run created (the trial flow), deleted again at the end. */
  const trialFingerprints: string[] = [];
  let sessionId = "";
  let paymentIntentId = "";
  let sessionDone = false;
  const counts = { before: {} as Record<string, number>, after: {} as Record<string, number> };
  const countRows = async (into: Record<string, number>) => {
    for (const table of ["usage_telemetry", "payment_intents", "stripe_events", "free_trials"]) {
      const { count } = await db.from(table).select("*", { count: "exact", head: true });
      into[table] = count ?? -1;
    }
  };

  const payment = async (): Promise<PaymentRow | null> => {
    const { data } = await db.from("payment_intents").select(PAYMENT_COLUMNS).eq("stripe_session_id", sessionId).maybeSingle();
    return (data as PaymentRow | null) ?? null;
  };

  /** --webhook=poll: pass on the real events Stripe recorded for this payment, signed with the app's own webhook secret. */
  const forward = async (types: string[], matches: (object: Record<string, unknown>) => boolean): Promise<number> => {
    const list = await stripe.events.list({ types, created: { gte: startedAt }, limit: 100 });
    let sent = 0;
    for (const event of [...list.data].reverse()) {
      eventIds.add(event.id);
      if (!matches(event.data.object as unknown as Record<string, unknown>) || forwarded.has(event.id)) continue;
      const payload = JSON.stringify(event);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret as string });
      const response = await fetch(`${APP}/api/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
      if (!response.ok) throw new Error(`the app answered ${response.status} to the forwarded ${event.type} event: ${await response.text()}`);
      forwarded.add(event.id);
      sent++;
    }
    return sent;
  };
  const forwarded = new Set<string>();

  try {
    await countRows(counts.before);

    await step("the app is up and healthy", async () => {
      const response = await fetch(`${APP}/api/health`).catch(() => null);
      expect(response, `nothing answers at ${APP}. Start the app (npm run dev) or pass --app=<url>.`);
      const body = (await response.json().catch(() => ({}))) as { status?: string; checks?: Record<string, string> };
      expect(response.status === 200, `GET /api/health answered ${response.status} ${JSON.stringify(body.checks ?? {})}. Fix whatever is "fail" there first (webhook = STRIPE_WEBHOOK_SECRET, database = the migration, unlock = UNLOCK_TOKEN_SECRET).`);
      return JSON.stringify(body.checks);
    });

    await step("the database has every table and column the code uses", async () => {
      const report = await checkDatabase({ url, serviceKey });
      expect(report.ok, `the database does not match the code. Apply supabase/migrations/*_init.sql and rerun.\n${formatReport(report)}`);
      return "run `npm run db:check` for the full list";
    });

    if (FLOW === "trial") {
      await runTrialFlow();
      return await finish(failures === 0 ? 0 : 1);
    }

    await step("a throw-away file (job) exists in usage_telemetry", async () => {
      const { error } = await db.from("usage_telemetry").insert({ id: jobId, file_name_anonymized: `${marker}.csv`, total_rows: BIG_ROWS, processing_time_ms: 1 });
      expect(!error, `could not insert: ${error?.message}`);
      return marker;
    });

    await step("POST /api/checkout creates a Checkout Session and records it", async () => {
      const response = await postJson("/api/checkout", { telemetryId: jobId, rowCount: BIG_ROWS, fingerprint });
      expect(response.status === 200, `answered ${response.status}: ${JSON.stringify(response.body)}`);
      sessionId = String(response.body.sessionId);
      expect(/^cs_test_/.test(sessionId), `session id ${sessionId} is not a test-mode session`);
      const row = await payment();
      expect(row && row.paid_at === null, "no unpaid payment_intents row for the session");
      checkoutUrl = String(response.body.url);
      return sessionId;
    });

    await step("the session is configured as intended (project tag, price, billing address, waiver checkbox)", async () => {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      expect(session.metadata?.project_source === "ecommerce_data_sanitizer", "metadata.project_source is missing");
      expect(session.client_reference_id === jobId, "client_reference_id is not the job id");
      expect(session.amount_total === 900 && session.currency === "usd", `amount ${session.amount_total} ${session.currency}`);
      const waiver = session.consent_collection?.terms_of_service === "required";
      return `waiver checkbox ${waiver ? "required" : "NOT required"}; automatic tax ${session.automatic_tax?.enabled ? "on" : "off"}`;
    });

    if (CARD === "decline") {
      await step("a declined card is refused and nothing is recorded as paid", async () => {
        if (MANUAL) {
          say(`        Open ${checkoutUrl}\n        and pay with ${CARDS.decline.label}. Waiting up to ${TIMEOUT_MS / 1000}s to confirm it was not recorded as paid...`);
          await sleep(Math.min(TIMEOUT_MS, 60_000));
        } else {
          await browser.open(chrome as string);
          const result = await payInBrowser(browser, checkoutUrl, CARDS.decline.number, email);
          expect(result.outcome === "declined", `expected a decline but the payment ended as ${result.outcome}: ${result.detail}`);
          say(`        Stripe showed: ${result.detail}`);
        }
        const row = await payment();
        expect(row && row.paid_at === null, "the declined payment was recorded as PAID");
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        expect(session.payment_status !== "paid", "Stripe says the declined session is paid");
        const unlock = await postJson("/api/unlock", { sessionId });
        expect(unlock.status === 202, `/api/unlock should say 'not paid yet' (202) but answered ${unlock.status}`);
        return "paid_at stays null; /api/unlock answers 202";
      });

      await step("an abandoned checkout can be expired, and then it unlocks nothing", async () => {
        await stripe.checkout.sessions.expire(sessionId);
        sessionDone = true;
        const unlock = await postJson("/api/unlock", { sessionId });
        expect(unlock.status === 404, `/api/unlock should answer 404 for an expired session but answered ${unlock.status}`);
        return "expired";
      });
      return await finish(failures === 0 ? 0 : 1);
    }

    await step(`pay with the ${CARD === "3ds" ? "3-D Secure" : CARD === "dispute" ? "disputed-payment" : "success"} test card${MANUAL ? " (by hand)" : " in headless Chrome"}`, async () => {
      if (MANUAL) {
        say(`\n        Open this URL in a browser and pay with ${CARDS[CARD].label}, expiry any future date, CVC 123:\n        ${checkoutUrl}\n`);
        await waitUntil("the payment (Stripe session complete)", async () => (await stripe.checkout.sessions.retrieve(sessionId)).payment_status === "paid", TIMEOUT_MS * 3, 3000);
        return "paid by hand";
      }
      await browser.open(chrome as string);
      let result = await payInBrowser(browser, checkoutUrl, CARDS[CARD].number, email);
      if (result.outcome === "challenge") {
        await completeThreeDSecure(browser);
        result = await waitUntil("the redirect after 3-D Secure", async () => {
          const href = await browser.eval<string>("location.href").catch(() => "");
          return !href.includes("stripe.com") && href.startsWith(APP) ? { outcome: "redirected" as const, detail: href.split("?")[0] } : null;
        }, 60_000, 700);
      }
      expect(result.outcome === "redirected", `the payment did not complete: ${result.outcome} ${result.detail}`);
      return `back at ${result.detail}`;
    });
    sessionDone = true;
    await browser.close();

    await step(WEBHOOK_MODE === "poll" ? "forward Stripe's checkout.session.completed event to the app" : "wait for Stripe's webhook to reach the app (stripe listen)", async () => {
      const row = await waitUntil(
        "payment_intents.paid_at",
        async () => {
          if (WEBHOOK_MODE === "poll") await forward(["checkout.session.completed", "checkout.session.async_payment_succeeded"], (object) => object.id === sessionId);
          const current = await payment();
          return current?.paid_at ? current : null;
        },
      ).catch((error: Error) => {
        throw new Error(
          `${error.message}.${WEBHOOK_MODE === "cli" ? "\n        Is `stripe listen --forward-to localhost:3000/api/webhook` running, and is the whsec_ it printed the STRIPE_WEBHOOK_SECRET the APP was started with (restart the app after changing .env.local)? Look for [webhook] lines in the app's terminal." : ""}`,
        );
      });
      expect(row.email === email.toLowerCase(), `receipt email was recorded as ${row.email}`);
      expect(/^pi_/.test(row.stripe_payment_intent_id ?? ""), "stripe_payment_intent_id was not stored (refunds could not find this payment)");
      paymentIntentId = row.stripe_payment_intent_id as string;
      return `paid_at set, ${row.email}, ${paymentIntentId}`;
    });

    // A disputed test card is disputed within the same second as the payment, so the dispute may already have been applied
    // by the time the payment was recorded (the webhook asks Stripe, and handles either order). Only the end state is fixed.
    await step(CARD === "dispute" ? "the payment event is recorded as processed (idempotency)" : "the job is flagged unlocked and the event is recorded as processed (idempotency)", async () => {
      if (CARD !== "dispute") {
        const { data: job } = await db.from("usage_telemetry").select("is_unlocked").eq("id", jobId).single();
        expect(job?.is_unlocked === true, "usage_telemetry.is_unlocked is not true");
      }
      const { data: events } = await db.from("stripe_events").select("event_id, status").eq("status", "processed").gte("received_at", new Date(startedAt * 1000).toISOString());
      expect((events?.length ?? 0) >= 1, "no processed row in stripe_events");
      return `${events?.length} processed event row(s) since the start`;
    });

    let token = "";
    await step(CARD === "dispute" ? "/api/unlock hands out a token, or refuses it because the dispute was already applied" : "/api/unlock hands out a token, and /api/unlock/verify accepts it", async () => {
      const unlock = await postJson("/api/unlock", { sessionId });
      if (CARD === "dispute" && unlock.status === 403 && unlock.body.status === "refunded") return "403 refunded: the dispute was applied together with the payment, so no token was ever issued";
      expect(unlock.status === 200 && unlock.body.status === "paid", `/api/unlock answered ${unlock.status} ${JSON.stringify(unlock.body)}`);
      token = String((unlock.body.purchases as Array<{ token: string }>)[0].token);
      const verify = await postJson("/api/unlock/verify", { token });
      expect(verify.status === 200 && verify.body.valid === true, `/api/unlock/verify answered ${verify.status} ${JSON.stringify(verify.body)}`);
      return "token accepted";
    });

    if (CARD === "dispute") {
      await step(WEBHOOK_MODE === "poll" ? "forward Stripe's charge.dispute.created event to the app" : "the dispute is applied to the purchase (by the charge.dispute.created webhook, or by the payment webhook when the dispute came first)", async () => {
        const row = await waitUntil("payment_intents.refunded_at (dispute)", async () => {
          if (WEBHOOK_MODE === "poll") await forward(["charge.dispute.created"], (object) => object.payment_intent === paymentIntentId);
          const current = await payment();
          return current?.refunded_at ? current : null;
        }, TIMEOUT_MS * 2);
        expect(row.refund_reason === "dispute", `refund_reason is ${row.refund_reason}`);
        const { data: job } = await db.from("usage_telemetry").select("is_unlocked").eq("id", jobId).single();
        expect(job?.is_unlocked === false, "usage_telemetry.is_unlocked is still true after the dispute");
        // Which events the webhook finished: the dispute event itself may have been told to retry (the payment was not recorded
        // yet) and never retried by `stripe listen`, in which case the payment event applied the dispute after asking Stripe.
        const { data: events } = await db.from("stripe_events").select("event_type").eq("status", "processed").gte("received_at", new Date(startedAt * 1000).toISOString());
        const processed = [...new Set((events ?? []).map((event) => String(event.event_type)))].sort().join(", ");
        return `refunded_at set, reason 'dispute' (events processed: ${processed || "none"})`;
      });

      await step(token ? "a disputed payment unlocks nothing: /api/unlock says 403, and the old token is refused" : "a disputed payment unlocks nothing: /api/unlock says 403", async () => {
        const unlock = await postJson("/api/unlock", { sessionId });
        expect(unlock.status === 403 && unlock.body.status === "refunded", `/api/unlock answered ${unlock.status} ${JSON.stringify(unlock.body)}`);
        if (!token) return "403 (no token was ever issued)";
        const verify = await postJson("/api/unlock/verify", { token });
        expect(verify.status === 403 && verify.body.reason === "refunded", `/api/unlock/verify answered ${verify.status} ${JSON.stringify(verify.body)}`);
        return "403, 403";
      });
    } else if (NO_REFUND) {
      skipped++;
      say("skip  refund steps (--no-refund)");
    } else {
      let refunded = false;
      if (MANUAL_REFUND) {
        await step("refund the payment by hand in the Stripe Dashboard (test mode)", async () => {
          say(`\n        Dashboard (Test mode) > Payments > the $9.00 payment from ${email} > Refund > Full refund.\n        Waiting up to ${Math.round((TIMEOUT_MS * 3) / 1000)}s...\n`);
          await waitUntil("the refund in Stripe", async () => {
            const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
            return (intent.latest_charge as Stripe.Charge | null)?.refunded === true;
          }, TIMEOUT_MS * 3, 3000);
          refunded = true;
          return "refunded in Stripe";
        });
      } else {
        await step("refund the payment through the Stripe API", async () => {
          try {
            const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, metadata: { e2e: marker } });
            refunded = true;
            return `${refund.id} ${refund.status}`;
          } catch (error) {
            if ((error as { code?: string }).code === "more_permissions_required" || (error as { type?: string }).type === "StripePermissionError") {
              skipped++;
              say("        This key cannot create refunds. Any of these fixes it:");
              say("          - give the restricted key 'Charges and Refunds: Write' (Dashboard > Developers > API keys > edit the key; test mode),");
              say("          - set STRIPE_E2E_SECRET_KEY=sk_test_... for this script only,");
              say("          - or rerun with --manual-refund and refund the payment by hand while the script waits.");
              return "SKIPPED: the key may not create refunds";
            }
            throw error;
          }
        });
      }

      if (refunded) {
        await step(WEBHOOK_MODE === "poll" ? "forward Stripe's charge.refunded event to the app" : "wait for the charge.refunded webhook", async () => {
          const row = await waitUntil("payment_intents.refunded_at", async () => {
            if (WEBHOOK_MODE === "poll") await forward(["charge.refunded"], (object) => object.payment_intent === paymentIntentId);
            const current = await payment();
            return current?.refunded_at ? current : null;
          });
          expect(row.refund_reason === "refund", `refund_reason is ${row.refund_reason}`);
          const { data: job } = await db.from("usage_telemetry").select("is_unlocked").eq("id", jobId).single();
          expect(job?.is_unlocked === false, "usage_telemetry.is_unlocked is still true after the refund");
          return "refunded_at set, file purchasable again";
        });

        await step("a refunded payment unlocks nothing: /api/unlock says 403 refunded, and the old token is refused", async () => {
          const unlock = await postJson("/api/unlock", { sessionId });
          expect(unlock.status === 403 && unlock.body.status === "refunded", `/api/unlock answered ${unlock.status} ${JSON.stringify(unlock.body)}`);
          const verify = await postJson("/api/unlock/verify", { token });
          expect(verify.status === 403 && verify.body.reason === "refunded", `/api/unlock/verify answered ${verify.status} ${JSON.stringify(verify.body)}`);
          const byEmail = await postJson("/api/unlock", { email });
          expect(byEmail.status === 403, `/api/unlock by email answered ${byEmail.status}`);
          return "403, 403, 403";
        });
      }
    }
    return await finish(failures === 0 ? (skipped > 0 && !NO_REFUND ? 3 : 0) : 1);
  } catch (error) {
    if (!(error instanceof Stop)) {
      failures++;
      say(`FAIL  ${error instanceof Error ? error.stack : String(error)}`);
    }
    return await finish(1);
  }

  /** The free first big file, end to end over HTTP (no Stripe involved). */
  async function runTrialFlow(): Promise<void> {
    const fileA = `sha256:${randomBytes(32).toString("hex")}`;
    const fileB = `sha256:${randomBytes(32).toString("hex")}`;
    trialFingerprints.push(fileA, fileB);
    const person = `e2e+${randomBytes(3).toString("hex")}@example.com`;
    const browser1 = randomBytes(18).toString("base64url");
    const browser2 = randomBytes(18).toString("base64url");
    const browser3 = randomBytes(18).toString("base64url");
    const claimBody = (overrides: Record<string, unknown> = {}) => ({ action: "claim", email: person, marketingOptIn: OPT_IN, fingerprint: fileA, rowCount: BIG_ROWS, browserId: browser1, ...overrides });
    const trialRows = async () => ((await db.from("free_trials").select("*").in("file_fingerprint", [fileA, fileB])).data ?? []) as Array<Record<string, unknown>>;
    let cookie = "";
    let token = "";
    let trialId = "";

    await step(`exactly ${FREE_ROW_LIMIT} rows is free: nothing to claim, and nothing recorded`, async () => {
      const response = await postJson("/api/trial", claimBody({ rowCount: FREE_ROW_LIMIT }));
      expect(response.status === 400 && response.body.status === "not_needed", `answered ${response.status} ${JSON.stringify(response.body)} (the limit the app uses may differ from ${FREE_ROW_LIMIT}; is the app running current code?)`);
      expect((await trialRows()).length === 0, "a trial was recorded for a file that is already free");
      return `400 not_needed at ${FREE_ROW_LIMIT} rows`;
    });

    await step(`${FREE_ROW_LIMIT + 1} rows is a big file: the first one is free, as a token bound to the file`, async () => {
      const response = await fetch(`${APP}/api/trial`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": clientAddress }, body: JSON.stringify(claimBody({ rowCount: FREE_ROW_LIMIT + 1 })) });
      const body = (await response.json()) as { status?: string; grant?: { token: string; sessionId: string; fingerprint: string; kind?: string }; created?: boolean };
      expect(response.status === 200 && body.status === "granted" && body.grant, `answered ${response.status} ${JSON.stringify(body)}`);
      expect(body.grant.sessionId.startsWith("trial_") && body.grant.kind === "trial" && body.grant.fingerprint === fileA, `unexpected grant ${JSON.stringify({ ...body.grant, token: "…" })}`);
      token = body.grant.token;
      trialId = body.grant.sessionId.slice("trial_".length);
      const setCookie = response.headers.getSetCookie().find((entry) => entry.startsWith("csv_trial_browser="));
      expect(setCookie && /HttpOnly/i.test(setCookie), `the browser cookie was not set as httpOnly: ${setCookie}`);
      cookie = (setCookie as string).split(";")[0];
      return `trial ${trialId.slice(-8)}, httpOnly cookie set`;
    });

    await step(OPT_IN ? "the database holds a hash, the browser id, the fingerprint, and the email ONLY because the box was ticked" : "the database holds a hash, the browser id and the fingerprint, and NO email address", async () => {
      const rows = await trialRows();
      expect(rows.length === 1, `expected one free_trials row for this file, found ${rows.length}`);
      const row = rows[0];
      expect(/^[0-9a-f]{64}$/.test(String(row.email_hash)), `email_hash is not a 64-character hash: ${row.email_hash}`);
      expect(row.browser_id === browser1 && row.file_fingerprint === fileA, "browser id or fingerprint not stored as sent");
      if (OPT_IN) {
        expect(row.marketing_email === person.toLowerCase() && row.marketing_opt_in_at, "the optional box was ticked but the address and time were not recorded");
        return "opt-in recorded with its time";
      }
      expect(!JSON.stringify(row).includes(person.split("@")[0]) && !JSON.stringify(row).includes("@"), "an email address (or part of it) is stored in the row");
      expect(row.marketing_email == null && row.marketing_opt_in_at == null, "marketing fields are filled although the box was not ticked");
      return "no address stored";
    });

    await step("the token unlocks ITS file only: /api/unlock/verify accepts file A, refuses file B and a request that names no file", async () => {
      const ok = await postJson("/api/unlock/verify", { token, fingerprint: fileA });
      expect(ok.status === 200 && ok.body.valid === true, `file A answered ${ok.status} ${JSON.stringify(ok.body)}`);
      const other = await postJson("/api/unlock/verify", { token, fingerprint: fileB });
      expect(other.status === 403 && other.body.reason === "file", `file B answered ${other.status} ${JSON.stringify(other.body)}`);
      const none = await postJson("/api/unlock/verify", { token });
      expect(none.status === 403, `no file named answered ${none.status}`);
      return "200, 403, 403";
    });

    await step("a second trial is refused: same email in another browser, and the same browser with another email, by cookie and by stored id", async () => {
      const sameEmail = await postJson("/api/trial", claimBody({ browserId: browser2, fingerprint: fileB }));
      expect(sameEmail.status === 409 && sameEmail.body.status === "not_eligible", `same email answered ${sameEmail.status} ${JSON.stringify(sameEmail.body)}`);
      const plusTag = await postJson("/api/trial", claimBody({ email: person.replace("@", "+again@"), browserId: browser2, fingerprint: fileB }));
      expect(plusTag.status === 409, `the same email with a +tag answered ${plusTag.status}`);
      const byCookie = await postJson("/api/trial", claimBody({ email: `e2e+other${randomBytes(2).toString("hex")}@example.com`, browserId: browser3, fingerprint: fileB }), { cookie });
      expect(byCookie.status === 409, `same cookie, another email and another stored id answered ${byCookie.status}`);
      const byStoredId = await postJson("/api/trial", claimBody({ email: `e2e+third${randomBytes(2).toString("hex")}@example.com`, fingerprint: fileB }));
      expect(byStoredId.status === 409, `same stored id with no cookie, another email, answered ${byStoredId.status}`);
      expect((await trialRows()).length === 1, "a refused trial was recorded anyway");
      return "409, 409, 409, 409";
    });

    await step("asking again for the same file gives the same trial back; this browser can renew its token, another cannot", async () => {
      const again = await postJson("/api/trial", claimBody());
      expect(again.status === 200 && again.body.created === false, `asking again answered ${again.status} ${JSON.stringify(again.body).slice(0, 120)}`);
      const renewed = await postJson("/api/trial", { action: "renew", fingerprint: fileA, browserId: browser3 }, { cookie });
      expect(renewed.status === 200, `renew with the cookie answered ${renewed.status}`);
      const stranger = await postJson("/api/trial", { action: "renew", fingerprint: fileA, browserId: browser2 });
      expect(stranger.status === 404, `renew from another browser answered ${stranger.status}`);
      expect((await trialRows()).length === 1 && trialId !== "", "a second row appeared");
      return "same trial, renew 200, stranger 404";
    });
  }

  /** Cleans up what this run created, then reports. Always runs. */
  async function finish(code: number): Promise<number> {
    say("");
    await browser.close().catch(() => {});
    try {
      if (sessionId && !sessionDone) {
        await stripe.checkout.sessions.expire(sessionId).then(() => say("cleanup: expired the unfinished checkout session"), () => {});
      }
      if (KEEP) {
        say(`cleanup: skipped (--keep). Rows are marked ${marker}; job ${jobId}.`);
      } else {
        // Events of this payment that the webhook recorded (so a rerun does not look like a duplicate delivery).
        if (sessionId) {
          const list = await stripe.events.list({ created: { gte: startedAt }, limit: 100 }).catch(() => null);
          for (const event of list?.data ?? []) {
            const object = event.data.object as unknown as Record<string, unknown>;
            if (object.id === sessionId || (paymentIntentId && (object.payment_intent === paymentIntentId || object.id === paymentIntentId))) eventIds.add(event.id);
          }
        }
        if (eventIds.size > 0) await db.from("stripe_events").delete().in("event_id", [...eventIds]);
        if (trialFingerprints.length > 0) await db.from("free_trials").delete().in("file_fingerprint", trialFingerprints);
        await db.from("payment_intents").delete().eq("telemetry_id", jobId);
        await db.from("usage_telemetry").delete().eq("id", jobId);
        await countRows(counts.after);
        const same = Object.keys(counts.before).every((table) => counts.before[table] === counts.after[table]);
        say(`cleanup: deleted this run's rows (the payment, the job, and any of its ${eventIds.size} Stripe event(s) the webhook had recorded). Row counts before/after: ${same ? "identical" : `DIFFERENT ${JSON.stringify(counts.before)} -> ${JSON.stringify(counts.after)} (other traffic, or events this script could not identify)`}`);
      }
    } catch (error) {
      say(`cleanup problem: ${error instanceof Error ? error.message : error}`);
    }
    say(failures === 0 ? (code === 3 ? "\nPASSED, but the refund steps were skipped (see above)." : "\nALL STEPS PASSED") : `\n${failures} STEP(S) FAILED`);
    return code;
  }
}

let checkoutUrl = "";

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("e2e-stripe crashed:", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
