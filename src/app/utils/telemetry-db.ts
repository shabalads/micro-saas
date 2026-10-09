// src/app/utils/telemetry-db.ts
//
// Server-only data access for the usage_telemetry table. Nothing else in the app reads the Supabase
// secrets, and `server-only` makes the build fail if a client component ever imports this module.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TELEMETRY_TABLE = "usage_telemetry";
/** One row per checkout attempt: which job it was for and the Stripe Checkout Session id. */
export const PAYMENT_INTENTS_TABLE = "payment_intents";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Job ids are usage_telemetry.id (uuid). Anything else coming from the browser is not ours. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Keeps counts inside a Postgres int4 column. */
const MAX_COUNT = 2_000_000_000;

let client: SupabaseClient | null = null;
let warnedAboutMissingEnv = false;

/**
 * Service-role client, created once per server instance. It bypasses row level security, so it must
 * never be exposed to the browser. Returns null when the env vars are missing so callers can degrade
 * to a no-op instead of crashing the request.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    if (!warnedAboutMissingEnv) {
      warnedAboutMissingEnv = true;
      console.warn(
        "[telemetry] NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are not set; nothing will be saved.",
      );
    }
    return null;
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * TEMPORARY debugging aid: prints the raw Supabase/Postgres error (message, details, hint, code) in the
 * dev server terminal. supabase-js does not throw on database errors, it returns them in `{ error }`, so
 * this has to be called from the `if (error)` branches as well as from `catch` blocks. The raw error can
 * echo the failing row, including a lead's email, so remove this once the pipeline is verified.
 */
export function logSupabaseError(where: string, error: unknown): void {
  console.error("Supabase Error Context:", where, error);
}

/** Server actions are public endpoints, so numbers arrive untrusted. Returns null for anything that is not a sane count. */
export function toSafeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.trunc(value), MAX_COUNT);
}
