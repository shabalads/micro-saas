import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../test/fake-supabase";
import { STALE_CLAIM_MS, claimEvent, claimEventWaiting, completeEvent, releaseEvent } from "./stripe-events";

const EVENT = { id: "evt_1", type: "checkout.session.completed" };
const NOW = Date.parse("2026-10-09T12:00:00Z");
const fresh = () => createFakeSupabase({}, { unique: { stripe_events: ["event_id"] } });

describe("webhook event claims (idempotency)", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("lets the first delivery claim an event and records it as processing", async () => {
    const { client, tables } = fresh();
    expect(await claimEvent(client, EVENT, NOW)).toBe("claimed");
    expect(tables.stripe_events).toEqual([{ event_id: "evt_1", event_type: "checkout.session.completed", status: "processing" }]);
  });

  it("tells a second delivery that arrives while the first is still working to retry later", async () => {
    const { client } = fresh();
    await claimEvent(client, EVENT, NOW);
    expect(await claimEvent(client, EVENT, NOW + 1000)).toBe("in_progress");
  });

  it("recognises a finished event as a duplicate", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT, NOW);
    await completeEvent(client, "evt_1", NOW + 500);
    expect(tables.stripe_events[0]).toMatchObject({ status: "processed", processed_at: new Date(NOW + 500).toISOString() });
    expect(await claimEvent(client, EVENT, NOW + 60_000)).toBe("duplicate");
    expect(await claimEvent(client, EVENT, NOW + 10 * 60_000)).toBe("duplicate"); // however long afterwards
  });

  it("releases a failed claim so the retry can run, but never un-processes a finished event", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT, NOW);
    await releaseEvent(client, "evt_1");
    expect(tables.stripe_events).toEqual([]);
    expect(await claimEvent(client, EVENT, NOW + 1000)).toBe("claimed");

    await completeEvent(client, "evt_1");
    await releaseEvent(client, "evt_1");
    expect(tables.stripe_events).toHaveLength(1);
    expect(tables.stripe_events[0].status).toBe("processed");
  });

  it("takes over a claim abandoned by a crashed server, and exactly one racing taker wins", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT, NOW);
    tables.stripe_events[0].received_at = new Date(NOW).toISOString();

    const later = NOW + STALE_CLAIM_MS + 1000;
    expect(await claimEvent(client, EVENT, later)).toBe("claimed");
    expect(tables.stripe_events[0].received_at).toBe(new Date(later).toISOString());
    // the winner refreshed the claim, so a second taker finds it fresh again
    expect(await claimEvent(client, EVENT, later + 1000)).toBe("in_progress");
  });

  it("does not take over a claim that is merely slow", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT, NOW);
    tables.stripe_events[0].received_at = new Date(NOW).toISOString();
    expect(await claimEvent(client, EVENT, NOW + STALE_CLAIM_MS - 1000)).toBe("in_progress");
  });

  it("never takes over an event that was already processed, however old", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT, NOW);
    await completeEvent(client, "evt_1", NOW);
    tables.stripe_events[0].received_at = new Date(NOW - 99 * 86_400_000).toISOString();
    expect(await claimEvent(client, EVENT, NOW)).toBe("duplicate");
  });

  it("reports a database failure instead of guessing", async () => {
    const { client } = createFakeSupabase({}, { failOn: ({ op }) => (op === "insert" ? { code: "XX000", message: "db down", details: null, hint: null } : null) });
    expect(await claimEvent(client, EVENT, NOW)).toBe("error");
  });
});

describe("claimEventWaiting (a concurrent delivery waits for the holder instead of being turned away)", () => {
  const patient = { waitMs: 1000, pollMs: 10 };
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("claims a free event at once", async () => {
    const { client } = fresh();
    expect(await claimEventWaiting(client, EVENT, patient)).toBe("claimed");
  });

  it("becomes a duplicate when the holder finishes while it waits", async () => {
    const { client } = fresh();
    await claimEvent(client, EVENT);
    setTimeout(() => void completeEvent(client, "evt_1"), 60);
    const started = Date.now();
    expect(await claimEventWaiting(client, EVENT, patient)).toBe("duplicate");
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("claims the event itself when the holder fails and releases it", async () => {
    const { client, tables } = fresh();
    await claimEvent(client, EVENT);
    setTimeout(() => void releaseEvent(client, "evt_1"), 60);
    expect(await claimEventWaiting(client, EVENT, patient)).toBe("claimed");
    expect(tables.stripe_events).toEqual([expect.objectContaining({ event_id: "evt_1", status: "processing" })]);
  });

  it("gives up with in_progress when the holder is still busy after the wait, so the caller can answer 409", async () => {
    const { client } = fresh();
    await claimEvent(client, EVENT);
    const started = Date.now();
    expect(await claimEventWaiting(client, EVENT, { waitMs: 80, pollMs: 10 })).toBe("in_progress");
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("does not wait on a database failure", async () => {
    const { client } = createFakeSupabase({}, { failOn: ({ op }) => (op === "insert" ? { code: "XX000", message: "db down", details: null, hint: null } : null) });
    const started = Date.now();
    expect(await claimEventWaiting(client, EVENT, patient)).toBe("error");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
