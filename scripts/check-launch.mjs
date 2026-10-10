// scripts/check-launch.mjs
//
// Lists what is still unfinished before the site goes live. Prints names only, never the values of secrets.
//   npm run check:launch
// Environment variables are read from the process and from .env.production.local, .env.local and .env (the files Next
// loads for a production build). On a host that injects variables at build time, run it there.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(name) {
  const file = join(root, name);
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local"), ...readEnvFile(".env.production.local"), ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
const problems = [];
const warnings = [];

// 1. Company details: every "[[...]]" left in src/site/company.ts.
const companySource = readFileSync(join(root, "src/site/company.ts"), "utf8");
const unfilled = [...companySource.matchAll(/^\s*([A-Za-z]+):\s*"(\[\[[^"]*\]\])"/gm)].map((match) => match[1]);
if (unfilled.length > 0) problems.push(`src/site/company.ts still has ${unfilled.length} placeholder(s): ${unfilled.join(", ")}`);

// 2. Environment.
const need = (name, why, check) => {
  const value = env[name];
  if (!value) return problems.push(`${name} is not set (${why})`);
  const reason = check?.(value);
  if (reason) problems.push(`${name} ${reason}`);
};

need("NEXT_PUBLIC_SITE_URL", "canonical URLs, sitemap, Stripe return URLs", (value) => {
  let url;
  try { url = new URL(value); } catch { return "is not a valid URL"; }
  if (!/^https?:$/.test(url.protocol)) return "must start with https://";
  if (url.pathname !== "/" || url.search || url.hash) return "must be an origin only (no path, query or fragment)";
  if (/localhost|127\.0\.0\.1/.test(url.hostname)) return "still points at localhost; use your public https address for production";
  if (url.protocol !== "https:") return "should be https:// in production";
});
need("NEXT_PUBLIC_SUPABASE_URL", "database");
need("SUPABASE_SERVICE_ROLE_KEY", "database");
need("STRIPE_SECRET_KEY", "payments", (value) => {
  if (/^(sk|rk)_test_/.test(value)) return "is a TEST key; production needs sk_live_/rk_live_";
  if (!/^(sk|rk)_live_/.test(value)) return "does not look like a Stripe secret or restricted key";
});
need("STRIPE_WEBHOOK_SECRET", "payment confirmation", (value) => (/^whsec_/.test(value) ? undefined : "should start with whsec_"));
need("UNLOCK_TOKEN_SECRET", "signs unlock tokens", (value) => (value.length < 32 ? "is shorter than 32 characters" : undefined));
need("TRIAL_HASH_SECRET", "hashes the email of the free first big file; never change it after launch", (value) => (value.length < 32 ? "is shorter than 32 characters" : undefined));
need("ADMIN_PASSWORD", "/admin page", (value) => (value.length < 12 ? "is shorter than 12 characters" : undefined));
if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) warnings.push("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set: rate limits are per server instance (fine for one server, weak on serverless hosting)");
if (env.ENABLE_STRIPE_TAX === "true") warnings.push("ENABLE_STRIPE_TAX=true: make sure Stripe Tax is set up in the live Stripe account (head office address and registrations)");
if (env.APP_URL && !env.NEXT_PUBLIC_SITE_URL) warnings.push("APP_URL is set but NEXT_PUBLIC_SITE_URL is not: rename it");

// 3. Things only a person can do.
const manual = [
  "Have a lawyer review /terms, /refunds and /privacy (statute references, Czech-language consumer information, ADR wording, durable-medium confirmation)",
  "Stripe Dashboard: live-mode webhook endpoint <site>/api/webhook with checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded and charge.dispute.created",
  "Supabase: apply supabase/migrations/*_init.sql, then `npm run db:check` must say the database matches",
  "Tax: leave ENABLE_STRIPE_TAX unset (no tax added) or set up Stripe Tax and set ENABLE_STRIPE_TAX=true before building",
  "`npm run e2e:stripe` in test mode (scripts/e2e-stripe.md)",
  "Make one real purchase and refund with a live card",
];

console.log("\nLaunch check\n");
if (problems.length === 0) console.log("  OK  nothing blocking found in company details or environment");
for (const problem of problems) console.log(`  TODO  ${problem}`);
for (const warning of warnings) console.log(`  NOTE  ${warning}`);
console.log("\nStill manual:");
for (const item of manual) console.log(`  [ ] ${item}`);
console.log("");
process.exit(problems.length > 0 ? 1 : 0);
