import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../test/fake-supabase";
import { findPaidPurchasesByEmail, findPurchaseByPaymentIntent, markPaymentRefunded, markSessionPaid } from "./payments-db";

const JOB = "11111111-1111-4111-8111-111111111111";
const JOB_2 = "22222222-2222-4222-8222-222222222222";
const PI = "pi_test_unit0001";
const paid = (sessionId: string, extra: Record<string, unknown> = {}) => ({ stripe_session_id: sessionId, telemetry_id: JOB, paid_at: "2026-10-01T10:00:00.000Z", refunded_at: null, email: "buyer@example.com", ...extra });

function setup(purchases: Array<Record<string, unknown>>, jobs: Array<Record<string, unknown>> = [{ id: JOB, is_unlocked: true }]) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return createFakeSupabase({ usage_telemetry: jobs, payment_intents: purchases }, { unique: { payment_intents: ["stripe_session_id"] } });
}

describe("markSessionPaid keeps the PaymentIntent id", () => {
  it("stores it on the payment", async () => {
    const { client, tables } = setup([{ stripe_session_id: "cs_test_a", telemetry_id: JOB, paid_at: null }]);
    expect(await markSessionPaid(client, { sessionId: "cs_test_a", clientReferenceId: JOB, email: null, paymentIntentId: PI })).toBe("paid");
    expect(tables.payment_intents[0].stripe_payment_intent_id).toBe(PI);
  });

  it("fills it in on a replay without disturbing paid_at, and ignores values that are not PaymentIntent ids", async () => {
    const { client, tables } = setup([paid("cs_test_a")]);
    const before = tables.payment_intents[0].paid_at;
    await markSessionPaid(client, { sessionId: "cs_test_a", clientReferenceId: JOB, email: null, paymentIntentId: "not-an-id; drop table" });
    expect(tables.payment_intents[0].stripe_payment_intent_id ?? null).toBeNull();
    await markSessionPaid(client, { sessionId: "cs_test_a", clientReferenceId: JOB, email: null, paymentIntentId: PI });
    expect(tables.payment_intents[0]).toMatchObject({ stripe_payment_intent_id: PI, paid_at: before });
  });
});

describe("markPaymentRefunded", () => {
  it("stamps the purchase found by PaymentIntent id and unlocks nothing any more", async () => {
    const { client, tables } = setup([paid("cs_test_a", { stripe_payment_intent_id: PI })]);
    expect(await markPaymentRefunded(client, { paymentIntentId: PI, jobId: null, reason: "refund" })).toBe("refunded");
    expect(tables.payment_intents[0]).toMatchObject({ refunded_at: expect.any(String), refund_reason: "refund" });
    expect(tables.usage_telemetry[0].is_unlocked).toBe(false);
  });

  it("is idempotent: the second call reports 'already' and keeps the first timestamp and reason", async () => {
    const { client, tables } = setup([paid("cs_test_a", { stripe_payment_intent_id: PI })]);
    await markPaymentRefunded(client, { paymentIntentId: PI, jobId: null, reason: "refund" });
    const first = { ...tables.payment_intents[0] };
    expect(await markPaymentRefunded(client, { paymentIntentId: PI, jobId: null, reason: "dispute" })).toBe("already");
    expect(tables.payment_intents[0].refunded_at).toBe(first.refunded_at);
    expect(tables.payment_intents[0].refund_reason).toBe("refund");
  });

  it("only touches the refunded payment, not another customer's purchase of a different file", async () => {
    const { client, tables } = setup(
      [paid("cs_test_a", { stripe_payment_intent_id: PI }), paid("cs_test_b", { telemetry_id: JOB_2, stripe_payment_intent_id: "pi_test_unit0002" })],
      [{ id: JOB, is_unlocked: true }, { id: JOB_2, is_unlocked: true }],
    );
    await markPaymentRefunded(client, { paymentIntentId: PI, jobId: null, reason: "refund" });
    expect(tables.payment_intents[1].refunded_at ?? null).toBeNull();
    expect(tables.usage_telemetry.map((job) => job.is_unlocked)).toEqual([false, true]);
  });

  it("rejects ids that are not PaymentIntent ids instead of querying with them", async () => {
    const { client, tables } = setup([paid("cs_test_a", { stripe_payment_intent_id: PI })]);
    expect(await markPaymentRefunded(client, { paymentIntentId: "' or 1=1 --", jobId: null, reason: "refund" })).toBe("not_found");
    expect(tables.payment_intents[0].refunded_at ?? null).toBeNull();
  });

  it("falls back to the job id only when exactly one unrecorded paid purchase matches", async () => {
    const one = setup([paid("cs_test_a")]);
    expect(await markPaymentRefunded(one.client, { paymentIntentId: PI, jobId: JOB, reason: "refund" })).toBe("refunded");
    expect(one.tables.payment_intents[0]).toMatchObject({ stripe_payment_intent_id: PI, refunded_at: expect.any(String) });

    const two = setup([paid("cs_test_a"), paid("cs_test_b")]);
    expect(await markPaymentRefunded(two.client, { paymentIntentId: PI, jobId: JOB, reason: "refund" })).toBe("ambiguous");
    expect(two.tables.payment_intents.every((row) => row.refunded_at === null)).toBe(true);
  });

  it("asks for a retry when the job has only unpaid checkouts (the refund outran the payment event)", async () => {
    const { client } = setup([paid("cs_test_a", { paid_at: null })]);
    expect(await markPaymentRefunded(client, { paymentIntentId: PI, jobId: JOB, reason: "refund" })).toBe("not_recorded_yet");
  });

  it("reports a database error instead of pretending it worked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase({}, { failOn: ({ op }) => (op === "update" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
    expect(await markPaymentRefunded(client, { paymentIntentId: PI, jobId: JOB, reason: "refund" })).toBe("error");
  });

  it("finds a purchase by PaymentIntent id", async () => {
    const { client } = setup([paid("cs_test_a", { stripe_payment_intent_id: PI })]);
    expect((await findPurchaseByPaymentIntent(client, PI)).purchase?.stripe_session_id).toBe("cs_test_a");
    expect((await findPurchaseByPaymentIntent(client, "pi_test_nope0001")).purchase).toBeNull();
  });
});

describe("findPaidPurchasesByEmail", () => {
  it("skips refunded purchases and reports when that is all there is", async () => {
    const { client } = setup([paid("cs_test_a", { refunded_at: "2026-10-02T10:00:00.000Z" })]);
    expect(await findPaidPurchasesByEmail(client, "buyer@example.com")).toEqual({ purchases: [], onlyRefunded: true, failed: false });
    expect(await findPaidPurchasesByEmail(client, "nobody@example.com")).toEqual({ purchases: [], onlyRefunded: false, failed: false });
  });
});
