// src/app/utils/stripe-events.ts
//
// Idempotent webhook processing. Stripe delivers events at least once, and retries any that did not get a 2xx, so the
// same event can arrive twice (or at the same moment on two servers). Each event id is claimed in Supabase before it is
// processed; a second delivery finds the claim and does nothing.
//
// A claim has two states. "processing" means someone is working on it (or crashed halfway); "processed" means done.
// If processing fails, the claim is released so Stripe's retry can run it again. If a server dies mid-way and leaves a
// "processing" claim behind, it counts as abandoned after STALE_CLAIM_MS and the next delivery takes it over, so a
// crash can delay a payment by minutes but never lose it.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "./telemetry-db";

export const STRIPE_EVENTS_TABLE = "stripe_events";
/** How long a "processing" claim is trusted before it is considered abandoned by a crashed server. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

/** Postgres "unique_violation": the event id is already in the table. */
const UNIQUE_VIOLATION = "23505";

export type ClaimResult =
  /** This delivery owns the event: process it, then call completeEvent (or releaseEvent if it failed). */
  | "claimed"
  /** Already processed: acknowledge with 2xx and do nothing. */
  | "duplicate"
  /** Another delivery is processing it right now: answer non-2xx so Stripe retries later. */
  | "in_progress"
  | "error";

export async function claimEvent(
  supabase: SupabaseClient,
  event: { id: string; type: string },
  now: number = Date.now(),
): Promise<ClaimResult> {
  const { error } = await supabase
    .from(STRIPE_EVENTS_TABLE)
    .insert({ event_id: event.id, event_type: event.type, status: "processing" });
  if (!error) return "claimed";
  if (error.code !== UNIQUE_VIOLATION) {
    logSupabaseError("claimEvent insert", error);
    return "error";
  }

  // Already known. First try to take over an abandoned claim. This is one atomic UPDATE whose WHERE clause only matches
  // a stale "processing" row, and it refreshes received_at, so of two racing takeovers exactly one can win.
  const { data: taken, error: takeError } = await supabase
    .from(STRIPE_EVENTS_TABLE)
    .update({ received_at: new Date(now).toISOString() })
    .eq("event_id", event.id)
    .eq("status", "processing")
    .lt("received_at", new Date(now - STALE_CLAIM_MS).toISOString())
    .select("event_id");
  if (takeError) {
    logSupabaseError("claimEvent takeover", takeError);
    return "error";
  }
  if (taken && taken.length > 0) return "claimed";

  const { data: existing, error: readError } = await supabase
    .from(STRIPE_EVENTS_TABLE)
    .select("status")
    .eq("event_id", event.id)
    .maybeSingle();
  if (readError) {
    logSupabaseError("claimEvent read", readError);
    return "error";
  }
  // No row means it was released between the insert and now: let Stripe's retry claim it cleanly.
  return existing?.status === "processed" ? "duplicate" : "in_progress";
}

/** How long a delivery waits for a concurrent delivery of the same event to finish before it gives up and answers 409. */
export const CLAIM_WAIT_MS = 8000;
const CLAIM_POLL_MS = 200;

/**
 * claimEvent, but a delivery that finds the event "in_progress" waits for the holder instead of failing at once. The same
 * event can reach the app several times in the same instant (one `stripe listen` per terminal that is open, or Stripe's own
 * retry racing a slow first attempt), and the Stripe CLI never retries a non-2xx answer, so a 409 there is simply lost.
 * Waiting settles it in this request: if the holder finishes, this delivery is a "duplicate"; if the holder fails and
 * releases the claim, this delivery claims the event and does the work itself. Only a holder still busy after waitMs is
 * answered with "in_progress" (409), which real Stripe retries later.
 */
export async function claimEventWaiting(
  supabase: SupabaseClient,
  event: { id: string; type: string },
  { waitMs = CLAIM_WAIT_MS, pollMs = CLAIM_POLL_MS }: { waitMs?: number; pollMs?: number } = {},
): Promise<ClaimResult> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const result = await claimEvent(supabase, event);
    if (result !== "in_progress" || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Marks the event processed. Failing to record it is not fatal: the work is done, and redoing it is harmless. */
export async function completeEvent(supabase: SupabaseClient, eventId: string, now: number = Date.now()): Promise<void> {
  const { error } = await supabase
    .from(STRIPE_EVENTS_TABLE)
    .update({ status: "processed", processed_at: new Date(now).toISOString() })
    .eq("event_id", eventId);
  if (error) logSupabaseError("completeEvent update", error);
}

/** Gives a claim back after a failure so Stripe's retry can process the event. Never touches a processed event. */
export async function releaseEvent(supabase: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await supabase
    .from(STRIPE_EVENTS_TABLE)
    .delete()
    .eq("event_id", eventId)
    .eq("status", "processing");
  if (error) logSupabaseError("releaseEvent delete", error);
}
