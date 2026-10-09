// src/app/utils/payments-db.ts
//
// Database steps shared by the Stripe webhook and the return-page verification, so both unlock a file
// the same way. Everything here is idempotent: Stripe retries webhooks and users refresh pages.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_INTENTS_TABLE, TELEMETRY_TABLE, logSupabaseError } from "./telemetry-db";

export type UnlockOutcome = "unlocked" | "not_found" | "error";

/** Sets usage_telemetry.is_unlocked = true for a paid job. */
export async function unlockJob(supabase: SupabaseClient, jobId: string): Promise<UnlockOutcome> {
  const { data, error } = await supabase
    .from(TELEMETRY_TABLE)
    .update({ is_unlocked: true })
    .eq("id", jobId)
    .select("id");
  if (error) {
    logSupabaseError("unlockJob update", error);
    return "error";
  }
  return data && data.length > 0 ? "unlocked" : "not_found";
}

/** Looks up which job a Checkout Session was created for, using the payment_intents ledger. */
export async function findJobIdForSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ jobId: string | null; failed: boolean }> {
  const { data, error } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select("telemetry_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (error) {
    logSupabaseError("findJobIdForSession select", error);
    return { jobId: null, failed: true };
  }
  return { jobId: typeof data?.telemetry_id === "string" ? data.telemetry_id : null, failed: false };
}
