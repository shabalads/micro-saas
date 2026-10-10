import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { readPaymentFacts } from "./stripe-reversals";

const PI = "pi_test_unit0001";
const JOB = "11111111-1111-4111-8111-111111111111";

/** Just enough of the Stripe client for one call; the real one would go to the network. */
function stripeAnswering(intent: Record<string, unknown> | Error) {
  const retrieve = vi.fn(async () => {
    if (intent instanceof Error) throw intent;
    return intent;
  });
  return { stripe: { paymentIntents: { retrieve } } as unknown as Stripe, retrieve };
}
const intent = (charge: Record<string, unknown> | string | null, metadata: Record<string, string> = { project_source: "ecommerce_data_sanitizer", telemetry_id: JOB }) => ({
  id: PI, metadata, latest_charge: charge,
});

describe("readPaymentFacts", () => {
  it("asks Stripe for the PaymentIntent with its latest charge expanded", async () => {
    const { stripe, retrieve } = stripeAnswering(intent({ refunded: false, disputed: false }));
    await readPaymentFacts(stripe, PI);
    expect(retrieve).toHaveBeenCalledWith(PI, { expand: ["latest_charge"] });
  });

  it("reports an untouched payment as ours, with its job, and not reversed", async () => {
    const { stripe } = stripeAnswering(intent({ refunded: false, disputed: false }));
    expect(await readPaymentFacts(stripe, PI)).toEqual({ ours: true, jobId: JOB, reversal: null });
  });

  it("reports a disputed charge as a dispute", async () => {
    const { stripe } = stripeAnswering(intent({ refunded: false, disputed: true }));
    expect((await readPaymentFacts(stripe, PI)).reversal).toBe("dispute");
  });

  it("reports a fully refunded charge as a refund", async () => {
    const { stripe } = stripeAnswering(intent({ refunded: true, disputed: false }));
    expect((await readPaymentFacts(stripe, PI)).reversal).toBe("refund");
  });

  it("calls a charge that is both refunded and disputed a dispute", async () => {
    const { stripe } = stripeAnswering(intent({ refunded: true, disputed: true }));
    expect((await readPaymentFacts(stripe, PI)).reversal).toBe("dispute");
  });

  it("does not count a payment with no charge yet (or a charge that was not expanded) as reversed", async () => {
    expect((await readPaymentFacts(stripeAnswering(intent(null)).stripe, PI)).reversal).toBeNull();
    expect((await readPaymentFacts(stripeAnswering(intent("ch_test_unit0001")).stripe, PI)).reversal).toBeNull();
  });

  it("recognises another project's payment, and a payment with no tag at all, as not ours", async () => {
    expect((await readPaymentFacts(stripeAnswering(intent({}, { project_source: "some_other_app" })).stripe, PI)).ours).toBe(false);
    expect(await readPaymentFacts(stripeAnswering(intent({}, {})).stripe, PI)).toMatchObject({ ours: false, jobId: null });
  });

  it("lets a Stripe error through, so 'could not ask' is never mistaken for 'nothing happened'", async () => {
    const { stripe } = stripeAnswering(new Error("permission denied"));
    await expect(readPaymentFacts(stripe, PI)).rejects.toThrow("permission denied");
  });
});
