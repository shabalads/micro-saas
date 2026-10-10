// src/app/api/health/route.ts

import { NextResponse, connection } from "next/server";
import { TELEMETRY_TABLE, getSupabaseAdmin, logSupabaseError } from "../../utils/telemetry-db";
import { isTrialConfigured } from "../../utils/trial-service";
import { isUnlockConfigured } from "../../utils/unlock-token";

type CheckResult = "ok" | "fail";

const DATABASE_TIMEOUT_MS = 3000;
/** Uptime monitors poll often; reuse a recent database result instead of querying on every ping. */
const DATABASE_CACHE_MS = 10_000;
let databaseCache: { at: number; result: CheckResult } | null = null;

async function checkDatabase(): Promise<CheckResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return "fail";
  if (databaseCache && Date.now() - databaseCache.at < DATABASE_CACHE_MS) return databaseCache.result;

  let result: CheckResult = "fail";
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("database check timed out")), DATABASE_TIMEOUT_MS));
    const { error } = await Promise.race([supabase.from(TELEMETRY_TABLE).select("id").limit(1), timeout]);
    if (error) logSupabaseError("health database check", error);
    else result = "ok";
  } catch (error) {
    logSupabaseError("health database check", error);
  }
  databaseCache = { at: Date.now(), result };
  return result;
}

const configured = (...values: Array<string | undefined | boolean>): CheckResult => (values.every(Boolean) ? "ok" : "fail");

/**
 * Liveness and readiness for load balancers and uptime monitors: 200 when the app is configured and can reach its
 * database, 503 otherwise. It reports only which component is failing, never values, key modes or error text, since
 * the endpoint is public; the details go to the server log.
 */
export async function GET() {
  // Always evaluate per request. Without this the handler could be prerendered at build time and report a stale "ok".
  await connection();

  const checks = {
    database: await checkDatabase(),
    stripe: configured(process.env.STRIPE_SECRET_KEY),
    webhook: configured(process.env.STRIPE_WEBHOOK_SECRET),
    unlock: configured(isUnlockConfigured()),
    trial: configured(isTrialConfigured()),
  };
  const healthy = Object.values(checks).every((result) => result === "ok");

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
