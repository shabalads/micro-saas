import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../test/fake-supabase";

let fake = createFakeSupabase();
vi.mock("../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

import type { PaymentFacts } from "../../utils/stripe-reversals";
import { CLAIM_WAIT_MS } from "../../utils/stripe-events";
import { POST } from "./route";

const WEBHOOK_SECRET = "whsec_unit_test_secret";
const OURS = "ecommerce_data_sanitizer";
const JOB = "11111111-1111-4111-8111-111111111111";
const SESSION = "cs_test_unit0001";
const signer = new Stripe("sk_test_signer");

/** What "Stripe" answers when the webhook asks about a payment. The real client would go to the network, so it is replaced. */
const NOTHING_WRONG: PaymentFacts = { ours: true, jobId: JOB, reversal: null };
const paymentOnStripe = vi.fn<(paymentIntentId: string) => Promise<PaymentFacts>>();
vi.mock("../../utils/stripe-reversals", () => ({ readPaymentFacts: (_stripe: unknown, paymentIntentId: string) => paymentOnStripe(paymentIntentId) }));

let failPaymentUpdate = false;
function freshDatabase() {
  paymentOnStripe.mockReset();
  paymentOnStripe.mockResolvedValue(NOTHING_WRONG);
  failPaymentUpdate = false;
  fake = createFakeSupabase(
    {
      usage_telemetry: [{ id: JOB, is_unlocked: false }],
      payment_intents: [{ stripe_session_id: SESSION, telemetry_id: JOB, paid_at: null, email: null, file_fingerprint: "sha256:" + "a".repeat(64) }],
    },
    {
      unique: { stripe_events: ["event_id"], payment_intents: ["stripe_session_id"] },
      failOn: ({ table, op }) => (failPaymentUpdate && table === "payment_intents" && op === "update" ? { code: "XX000", message: "db hiccup", details: null, hint: null } : null),
    },
  );
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION, object: "checkout.session", payment_status: "paid", client_reference_id: JOB,
  metadata: { telemetry_id: JOB, project_source: OURS }, customer_details: { email: "Buyer@Example.com" }, ...overrides,
});
const eventJson = (type: string, object: Record<string, unknown>, id = "evt_1") =>
  JSON.stringify({ id, object: "event", api_version: "2026-09-30.endive", created: Math.floor(Date.now() / 1000), type, data: { object }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null } });

function deliver(payload: string, options: { secret?: string; header?: string | null } = {}) {
  const header = options.header === undefined ? signer.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? WEBHOOK_SECRET }) : options.header;
  return POST(new Request("http://localhost/api/webhook", { method: "POST", headers: header === null ? {} : { "stripe-signature": header }, body: payload }));
}
const tables = () => fake.tables;

describe("POST /api/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    freshDatabase();
  });

  describe("signature first", () => {
    it("rejects a missing signature header with 400", async () => {
      expect((await deliver(eventJson("checkout.session.completed", session()), { header: null })).status).toBe(400);
    });

    it("rejects a forged signature with 400 even for an event from ANOTHER project (it must not be waved through with a 200)", async () => {
      const other = eventJson("checkout.session.completed", session({ metadata: { project_source: "some_other_app" } }));
      expect((await deliver(other, { secret: "whsec_attacker" })).status).toBe(400);
    });

    it("rejects a body that was changed after signing", async () => {
      const payload = eventJson("checkout.session.completed", session({ payment_status: "unpaid" }));
      const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
      expect((await deliver(payload.replace('"unpaid"', '"paid"'), { header })).status).toBe(400);
      expect(tables().payment_intents[0].paid_at).toBeNull();
    });

    it("rejects a replay of an old signed event (timestamp outside tolerance)", async () => {
      const payload = eventJson("checkout.session.completed", session());
      const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
      expect((await deliver(payload, { header })).status).toBe(400);
    });

    it("answers 503 when the webhook is not configured", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
      expect((await deliver(eventJson("checkout.session.completed", session()))).status).toBe(503);
    });
  });

  describe("only this project's events", () => {
    it.each([
      ["another project's tag", { project_source: "some_other_app", telemetry_id: JOB }],
      ["no project tag at all", { telemetry_id: JOB }],
      ["no metadata", null],
      ["a lookalike tag", { project_source: "ecommerce_data_sanitizer_v2" }],
      ["a differently cased tag", { project_source: "Ecommerce_Data_Sanitizer" }],
    ])("acknowledges %s with 200 and touches nothing", async (_label, metadata) => {
      const response = await deliver(eventJson("checkout.session.completed", session({ metadata })));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ received: true, ignored: "other_project" });
      expect(tables().payment_intents[0].paid_at).toBeNull();
      expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
      expect(tables().stripe_events ?? []).toEqual([]);   // not even recorded as an event we handled
    });

    it("acknowledges unrelated event types from other projects too", async () => {
      const response = await deliver(eventJson("invoice.paid", { id: "in_1", object: "invoice", metadata: { project_source: "billing_app" } }));
      expect(response.status).toBe(200);
      expect(tables().stripe_events ?? []).toEqual([]);
    });
  });

  describe("handled events", () => {
    it("checkout.session.completed (paid) records the payment, the receipt email, and unlocks the job", async () => {
      expect((await deliver(eventJson("checkout.session.completed", session()))).status).toBe(200);
      expect(tables().payment_intents[0]).toMatchObject({ email: "buyer@example.com" });
      expect(typeof tables().payment_intents[0].paid_at).toBe("string");
      expect(tables().usage_telemetry[0].is_unlocked).toBe(true);
      expect(tables().stripe_events).toEqual([expect.objectContaining({ event_id: "evt_1", status: "processed" })]);
    });

    it("checkout.session.async_payment_succeeded records the payment too", async () => {
      expect((await deliver(eventJson("checkout.session.async_payment_succeeded", session(), "evt_async"))).status).toBe(200);
      expect(typeof tables().payment_intents[0].paid_at).toBe("string");
      expect(tables().stripe_events[0]).toMatchObject({ event_id: "evt_async", event_type: "checkout.session.async_payment_succeeded", status: "processed" });
    });

    it("a 'completed' event for a delayed payment that is not paid yet changes nothing, and the later async success does the work", async () => {
      const early = await deliver(eventJson("checkout.session.completed", session({ payment_status: "unpaid" }), "evt_early"));
      expect(await early.json()).toMatchObject({ ignored: "not_paid_yet" });
      expect(tables().payment_intents[0].paid_at).toBeNull();
      expect(tables().stripe_events ?? []).toEqual([]);

      await deliver(eventJson("checkout.session.async_payment_succeeded", session(), "evt_late"));
      expect(typeof tables().payment_intents[0].paid_at).toBe("string");
    });

    it("ignores event types we do not act on, even from this project", async () => {
      const response = await deliver(eventJson("checkout.session.expired", session({ payment_status: "unpaid" })));
      expect(await response.json()).toMatchObject({ ignored: "event_type" });
      expect(tables().payment_intents[0].paid_at).toBeNull();
    });
  });

  describe("idempotency", () => {
    it("processes a redelivered event only once", async () => {
      const payload = eventJson("checkout.session.completed", session());
      expect((await deliver(payload)).status).toBe(200);
      const paidAt = tables().payment_intents[0].paid_at;

      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = await deliver(payload);
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ duplicate: true });
      expect(tables().payment_intents[0].paid_at).toBe(paidAt);
      expect(tables().stripe_events).toHaveLength(1);
    });

    it("a failure releases the claim (5xx), so Stripe's retry runs the event again and succeeds", async () => {
      const payload = eventJson("checkout.session.completed", session());
      failPaymentUpdate = true;
      expect((await deliver(payload)).status).toBe(500);
      expect(tables().stripe_events ?? []).toEqual([]);
      expect(tables().payment_intents[0].paid_at).toBeNull();

      failPaymentUpdate = false;
      expect((await deliver(payload)).status).toBe(200);
      expect(typeof tables().payment_intents[0].paid_at).toBe("string");
      expect(tables().stripe_events[0].status).toBe("processed");
    });

    it("answers 409 (so Stripe retries) when another delivery of the same event is still processing it after a patient wait", async () => {
      vi.useFakeTimers();
      try {
        fake.tables.stripe_events = [{ event_id: "evt_1", event_type: "checkout.session.completed", status: "processing", received_at: new Date().toISOString() }];
        const pending = deliver(eventJson("checkout.session.completed", session()));
        await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS + 1000);
        expect((await pending).status).toBe(409);
        expect(tables().payment_intents[0].paid_at).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("takes over an event whose processor crashed long ago and finishes the job", async () => {
      fake.tables.stripe_events = [{ event_id: "evt_1", event_type: "checkout.session.completed", status: "processing", received_at: new Date(Date.now() - 3600_000).toISOString() }];
      expect((await deliver(eventJson("checkout.session.completed", session()))).status).toBe(200);
      expect(typeof tables().payment_intents[0].paid_at).toBe("string");
      expect(tables().stripe_events[0].status).toBe("processed");
    });

    it("answers 500 when the claim itself cannot be written", async () => {
      fake = createFakeSupabase({}, { failOn: ({ table }) => (table === "stripe_events" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
      expect((await deliver(eventJson("checkout.session.completed", session()))).status).toBe(500);
    });
  });
});

describe("POST /api/webhook: refunds and disputes", () => {
  const PI = "pi_test_unit0001";
  const charge = (overrides: Record<string, unknown> = {}) => ({
    id: "ch_test_unit0001", object: "charge", amount: 900, amount_refunded: 900, refunded: true, payment_intent: PI,
    metadata: { telemetry_id: JOB, project_source: OURS }, ...overrides,
  });
  const dispute = (overrides: Record<string, unknown> = {}) => ({
    id: "dp_test_unit0001", object: "dispute", charge: "ch_test_unit0001", payment_intent: PI, status: "needs_response", metadata: {}, ...overrides,
  });
  const pay = (id = "evt_paid") => deliver(eventJson("checkout.session.completed", session({ payment_intent: PI }), id));
  const row = () => tables().payment_intents[0];

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    freshDatabase();
  });

  it("a payment remembers its PaymentIntent id, which is how a later refund finds it", async () => {
    await pay();
    expect(row()).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: PI, email: "buyer@example.com" });
  });

  it("charge.refunded (full) marks the purchase refunded and makes the file purchasable again", async () => {
    await pay();
    expect(tables().usage_telemetry[0].is_unlocked).toBe(true);

    const response = await deliver(eventJson("charge.refunded", charge(), "evt_refund"));
    expect(response.status).toBe(200);
    expect(row()).toMatchObject({ refunded_at: expect.any(String), refund_reason: "refund" });
    expect(row().paid_at).toEqual(expect.any(String));
    expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
    expect(tables().stripe_events.find((entry) => entry.event_id === "evt_refund")).toMatchObject({ status: "processed" });
  });

  it("a PARTIAL refund (a few dollars back) does not take the unlock away", async () => {
    await pay();
    const response = await deliver(eventJson("charge.refunded", charge({ refunded: false, amount_refunded: 200 }), "evt_partial"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "partial_refund" });
    expect(row().refunded_at ?? null).toBeNull();
    expect(tables().usage_telemetry[0].is_unlocked).toBe(true);
  });

  it("charge.dispute.created also takes the purchase away, recognised through the ledger because a dispute carries no metadata", async () => {
    await pay();
    const response = await deliver(eventJson("charge.dispute.created", dispute(), "evt_dispute"));
    expect(response.status).toBe(200);
    expect(row()).toMatchObject({ refunded_at: expect.any(String), refund_reason: "dispute" });
    expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
  });

  it("a redelivered refund event is processed once; a second refund event for the same payment changes nothing", async () => {
    await pay();
    await deliver(eventJson("charge.refunded", charge(), "evt_refund"));
    const stamped = row().refunded_at;

    const again = await deliver(eventJson("charge.refunded", charge(), "evt_refund"));
    expect(await again.json()).toMatchObject({ duplicate: true });

    await deliver(eventJson("charge.dispute.created", dispute(), "evt_dispute_after_refund"));
    expect(row().refunded_at).toBe(stamped);
    expect(row().refund_reason).toBe("refund");
  });

  it("ignores another project's refund: an untagged charge whose payment is not in this ledger, with nothing written", async () => {
    await pay();
    for (const object of [
      charge({ payment_intent: "pi_other_project", metadata: { project_source: "some_other_app" } }),
      charge({ payment_intent: "pi_other_project", metadata: {} }),
      charge({ payment_intent: null, metadata: {} }),
    ]) {
      const response = await deliver(eventJson("charge.refunded", object, `evt_${Math.random().toString(36).slice(2)}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ignored: "other_project" });
    }
    // A dispute has no metadata, so Stripe is asked whose payment it is; it says another project's.
    paymentOnStripe.mockResolvedValue({ ours: false, jobId: null, reversal: null });
    expect((await deliver(eventJson("charge.dispute.created", dispute({ payment_intent: "pi_other_project" }), "evt_other_dispute"))).status).toBe(200);
    expect(row().refunded_at ?? null).toBeNull();
    expect(tables().stripe_events.map((entry) => entry.event_id)).toEqual(["evt_paid"]);
  });

  it("rejects a refund event with a forged signature", async () => {
    await pay();
    expect((await deliver(eventJson("charge.refunded", charge(), "evt_forged"), { secret: "whsec_attacker" })).status).toBe(400);
    expect(row().refunded_at ?? null).toBeNull();
  });

  it("a payment recorded before PaymentIntent ids were kept is still found through the job id on the charge", async () => {
    tables().payment_intents[0].paid_at = new Date().toISOString();
    const response = await deliver(eventJson("charge.refunded", charge(), "evt_legacy"));
    expect(response.status).toBe(200);
    expect(row()).toMatchObject({ refunded_at: expect.any(String), stripe_payment_intent_id: PI });
  });

  it("the job-id fallback never guesses: two unrecorded paid purchases for the job means nothing is touched", async () => {
    tables().payment_intents[0].paid_at = new Date().toISOString();
    tables().payment_intents.push({ stripe_session_id: "cs_test_unit0002", telemetry_id: JOB, paid_at: new Date().toISOString(), email: null });
    await deliver(eventJson("charge.refunded", charge(), "evt_ambiguous"));
    expect(tables().payment_intents.every((entry) => (entry.refunded_at ?? null) === null)).toBe(true);
  });

  it("a refund that outruns the 'paid' event answers 500 and releases the claim, so Stripe's retry succeeds once the payment is recorded", async () => {
    const refundEvent = eventJson("charge.refunded", charge(), "evt_early_refund");
    const early = await deliver(refundEvent);
    expect(early.status).toBe(500);
    expect(tables().stripe_events.find((entry) => entry.event_id === "evt_early_refund")).toBeUndefined();

    await pay();
    const retry = await deliver(refundEvent);
    expect(retry.status).toBe(200);
    expect(row().refunded_at).toEqual(expect.any(String));
  });

  it("a refund of OUR payment that the ledger has no row for yet answers 500 and releases the claim, so Stripe retries it", async () => {
    tables().payment_intents.length = 0;
    const response = await deliver(eventJson("charge.refunded", charge(), "evt_unknown_payment"));
    expect(response.status).toBe(500);
    expect(tables().stripe_events ?? []).toEqual([]);
  });

  it("a refund whose job has two unrecorded paid purchases is acknowledged and logged: waiting would never make it unambiguous", async () => {
    tables().payment_intents[0].paid_at = new Date().toISOString();
    tables().payment_intents.push({ stripe_session_id: "cs_test_unit0002", telemetry_id: JOB, paid_at: new Date().toISOString(), email: null });
    const response = await deliver(eventJson("charge.refunded", charge(), "evt_ambiguous_ack"));
    expect(response.status).toBe(200);
    expect(console.warn).toHaveBeenCalled();
    expect(tables().stripe_events.find((entry) => entry.event_id === "evt_ambiguous_ack")).toMatchObject({ status: "processed" });
  });

  it("keeps the file unlocked when another purchase of the same file still counts", async () => {
    await pay();
    tables().payment_intents.push({ stripe_session_id: "cs_test_unit0002", telemetry_id: JOB, paid_at: new Date().toISOString(), email: null, stripe_payment_intent_id: "pi_test_unit0002" });
    await deliver(eventJson("charge.refunded", charge(), "evt_refund_first"));
    expect(row().refunded_at).toEqual(expect.any(String));
    expect(tables().usage_telemetry[0].is_unlocked).toBe(true);
  });

  it("a database failure answers 500 and releases the claim, and the retry then works", async () => {
    await pay();
    const payload = eventJson("charge.refunded", charge(), "evt_db_down");
    failPaymentUpdate = true;
    expect((await deliver(payload)).status).toBe(500);
    expect(tables().stripe_events.find((entry) => entry.event_id === "evt_db_down")).toBeUndefined();
    failPaymentUpdate = false;
    expect((await deliver(payload)).status).toBe(200);
    expect(row().refunded_at).toEqual(expect.any(String));
  });

  describe("events that arrive out of order, or at the same moment", () => {
    const DISPUTED: PaymentFacts = { ours: true, jobId: JOB, reversal: "dispute" };
    const REFUNDED: PaymentFacts = { ours: true, jobId: JOB, reversal: "refund" };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    describe("dispute before completed", () => {
      it("answers 500 and releases the claim, because a dispute names no job and the payment is not in the ledger yet", async () => {
        const response = await deliver(eventJson("charge.dispute.created", dispute(), "evt_early_dispute"));
        expect(response.status).toBe(500);
        expect(tables().stripe_events ?? []).toEqual([]);
        expect(row().refunded_at ?? null).toBeNull();
        expect(paymentOnStripe).toHaveBeenCalledWith(PI);   // ownership came from Stripe: the dispute itself carries no metadata
      });

      it("answers 500 even when the ledger has no row for the job at all (the completed event will create it)", async () => {
        tables().payment_intents.length = 0;
        const response = await deliver(eventJson("charge.dispute.created", dispute(), "evt_early_dispute_empty"));
        expect(response.status).toBe(500);
        expect(tables().stripe_events ?? []).toEqual([]);
      });

      it("Stripe's retry of that dispute succeeds once the payment has been recorded", async () => {
        const disputeEvent = eventJson("charge.dispute.created", dispute(), "evt_early_dispute");
        expect((await deliver(disputeEvent)).status).toBe(500);

        await pay();   // completed: Stripe reports nothing yet at this instant
        expect(row().refunded_at ?? null).toBeNull();

        const retry = await deliver(disputeEvent);
        expect(retry.status).toBe(200);
        expect(row()).toMatchObject({ refunded_at: expect.any(String), refund_reason: "dispute" });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
        expect(tables().stripe_events.find((entry) => entry.event_id === "evt_early_dispute")).toMatchObject({ status: "processed" });
      });

      it("a dispute on a payment that is not ours is still acknowledged with 200 and nothing is recorded", async () => {
        paymentOnStripe.mockResolvedValue({ ours: false, jobId: null, reversal: null });
        const response = await deliver(eventJson("charge.dispute.created", dispute({ payment_intent: "pi_other_project" }), "evt_other_dispute"));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ignored: "other_project" });
        expect(tables().stripe_events ?? []).toEqual([]);
        expect(row().refunded_at ?? null).toBeNull();
      });

      it("answers 500 when Stripe cannot be asked whose payment it is, rather than guessing either way", async () => {
        paymentOnStripe.mockRejectedValue(new Error("stripe is down"));
        const response = await deliver(eventJson("charge.dispute.created", dispute(), "evt_dispute_stripe_down"));
        expect(response.status).toBe(500);
        expect(tables().stripe_events ?? []).toEqual([]);
      });
    });

    describe("refund before completed", () => {
      it("answers 500 and releases the claim when the ledger has no row for the payment", async () => {
        tables().payment_intents.length = 0;
        const response = await deliver(eventJson("charge.refunded", charge(), "evt_early_refund_empty"));
        expect(response.status).toBe(500);
        expect(tables().stripe_events ?? []).toEqual([]);
      });

      it("Stripe's retry succeeds once the payment has been recorded", async () => {
        const refundEvent = eventJson("charge.refunded", charge(), "evt_early_refund");
        expect((await deliver(refundEvent)).status).toBe(500);
        expect(tables().stripe_events ?? []).toEqual([]);

        await pay();
        expect((await deliver(refundEvent)).status).toBe(200);
        expect(row()).toMatchObject({ refunded_at: expect.any(String), refund_reason: "refund" });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
      });
    });

    describe("completed finds a refund or dispute that Stripe already has", () => {
      it("a dispute: refunded_at is set in the same delivery, and the file is never left unlocked", async () => {
        paymentOnStripe.mockResolvedValue(DISPUTED);
        const response = await pay();
        expect(response.status).toBe(200);
        expect(row()).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: PI, refunded_at: expect.any(String), refund_reason: "dispute" });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
        expect(tables().stripe_events.find((entry) => entry.event_id === "evt_paid")).toMatchObject({ status: "processed" });
        expect(paymentOnStripe).toHaveBeenCalledWith(PI);
      });

      it("a full refund: the same", async () => {
        paymentOnStripe.mockResolvedValue(REFUNDED);
        expect((await pay()).status).toBe(200);
        expect(row()).toMatchObject({ paid_at: expect.any(String), refunded_at: expect.any(String), refund_reason: "refund" });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
      });

      it("a payment with nothing wrong on Stripe stays paid and unlocked", async () => {
        expect((await pay()).status).toBe(200);
        expect(row().refunded_at ?? null).toBeNull();
        expect(tables().usage_telemetry[0].is_unlocked).toBe(true);
      });

      it("the dispute event that follows changes nothing", async () => {
        paymentOnStripe.mockResolvedValue(DISPUTED);
        await pay();
        const stamped = row().refunded_at;
        const response = await deliver(eventJson("charge.dispute.created", dispute(), "evt_dispute_after"));
        expect(response.status).toBe(200);
        expect(row().refunded_at).toBe(stamped);
        expect(row().refund_reason).toBe("dispute");
      });

      it("when Stripe cannot be asked, the payment is still recorded but the event answers 500 and is released, so the check runs again on retry", async () => {
        paymentOnStripe.mockRejectedValueOnce(new Error("stripe is down"));
        const payload = eventJson("checkout.session.completed", session({ payment_intent: PI }), "evt_check_down");
        expect((await deliver(payload)).status).toBe(500);
        expect(row().paid_at).toEqual(expect.any(String));   // the customer who paid is not locked out meanwhile
        expect(tables().stripe_events.find((entry) => entry.event_id === "evt_check_down")).toBeUndefined();

        paymentOnStripe.mockResolvedValue(DISPUTED);
        expect((await deliver(payload)).status).toBe(200);
        expect(row()).toMatchObject({ refunded_at: expect.any(String), refund_reason: "dispute" });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(false);
      });
    });

    describe("completed arriving twice at once", () => {
      /** Holds the first delivery inside its Stripe check, so the second one provably arrives while the claim is held. */
      function holdFirstDelivery() {
        let open!: () => void;
        const gate = new Promise<void>((resolve) => { open = resolve; });
        return { open, gate };
      }

      it("one delivery processes it; the other waits for it and then acknowledges a duplicate instead of answering 409", async () => {
        const { open, gate } = holdFirstDelivery();
        paymentOnStripe.mockImplementationOnce(async () => { await gate; return NOTHING_WRONG; });
        const payload = eventJson("checkout.session.completed", session({ payment_intent: PI }), "evt_twice");

        const first = deliver(payload);
        const second = deliver(payload);
        await sleep(80);
        expect(tables().stripe_events).toEqual([expect.objectContaining({ event_id: "evt_twice", status: "processing" })]);   // the first still holds it
        open();

        const [a, b] = await Promise.all([first, second]);
        expect([a.status, b.status]).toEqual([200, 200]);
        const bodies = [await a.json(), await b.json()];
        expect(bodies.filter((body) => body.duplicate === true)).toHaveLength(1);
        expect(row()).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: PI });
        expect(tables().stripe_events).toEqual([expect.objectContaining({ event_id: "evt_twice", status: "processed" })]);
        expect(paymentOnStripe).toHaveBeenCalledTimes(1);   // processed once
      });

      it("if the delivery holding the claim fails, the waiting one takes the event over and processes it: nothing is lost", async () => {
        const { open, gate } = holdFirstDelivery();
        paymentOnStripe.mockImplementationOnce(async () => { await gate; throw new Error("stripe is down"); });
        const payload = eventJson("checkout.session.completed", session({ payment_intent: PI }), "evt_twice_failing");

        const first = deliver(payload);
        const second = deliver(payload);
        await sleep(80);
        open();

        const [a, b] = await Promise.all([first, second]);
        expect(a.status).toBe(500);
        expect(b.status).toBe(200);
        expect(await b.json()).not.toHaveProperty("duplicate");   // it did the work itself
        expect(row()).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: PI });
        expect(tables().usage_telemetry[0].is_unlocked).toBe(true);
        expect(tables().stripe_events).toEqual([expect.objectContaining({ event_id: "evt_twice_failing", status: "processed" })]);
      });

      it("three at once (three `stripe listen` processes forward every event three times): all acknowledged, processed once", async () => {
        const { open, gate } = holdFirstDelivery();
        paymentOnStripe.mockImplementationOnce(async () => { await gate; return NOTHING_WRONG; });
        const payload = eventJson("checkout.session.completed", session({ payment_intent: PI }), "evt_thrice");

        const all = [deliver(payload), deliver(payload), deliver(payload)];
        await sleep(80);
        open();

        expect((await Promise.all(all)).map((response) => response.status)).toEqual([200, 200, 200]);
        expect(tables().stripe_events).toHaveLength(1);
        expect(paymentOnStripe).toHaveBeenCalledTimes(1);
      });

      it("completed and async_payment_succeeded for the same session at once record the payment once", async () => {
        const responses = await Promise.all([
          deliver(eventJson("checkout.session.completed", session({ payment_intent: PI }), "evt_completed_a")),
          deliver(eventJson("checkout.session.async_payment_succeeded", session({ payment_intent: PI }), "evt_async_a")),
        ]);
        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect(tables().payment_intents).toHaveLength(1);
        expect(row()).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: PI });
      });
    });
  });
});
