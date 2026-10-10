import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../test/fake-supabase";

const store = vi.hoisted(() => ({ cookies: {} as Record<string, string>, ip: "10.0.0.1", revalidated: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (store.cookies[name] ? { name, value: store.cookies[name] } : undefined), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers({ "x-forwarded-for": store.ip }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { store.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let fake = createFakeSupabase();
vi.mock("../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

const createRefund = vi.fn();
vi.mock("../utils/stripe-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/stripe-server")>()),
  getStripe: () => ({ refunds: { create: createRefund } }),
}));

import { ADMIN_COOKIE, createSessionValue } from "../utils/admin-auth";
import { refundPurchaseAction } from "./actions";

const SESSION = "cs_test_unitrefund0001";
const PI = "pi_test_unitrefund0001";
const IDLE = { status: "idle" as const, message: null };
const form = (sessionId: unknown) => {
  const data = new FormData();
  if (sessionId !== undefined) data.set("sessionId", String(sessionId));
  return data;
};
const refund = (...args: [sessionId?: unknown]) => refundPurchaseAction(IDLE, form(args.length > 0 ? args[0] : SESSION));
const purchase = () => fake.tables.payment_intents[0];

describe("refundPurchaseAction (the Refund button in /admin)", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.spyOn(console, "error").mockImplementation(() => {});
    createRefund.mockReset();
    createRefund.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
    store.revalidated.length = 0;
    store.ip = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    store.cookies = { [ADMIN_COOKIE]: createSessionValue()! };
    fake = createFakeSupabase({
      payment_intents: [{ stripe_session_id: SESSION, telemetry_id: "j1", paid_at: "2026-10-01T10:00:00.000Z", refunded_at: null, refund_requested_at: null, stripe_payment_intent_id: PI, email: "buyer@example.com" }],
    });
  });

  describe("only a signed-in admin can move money", () => {
    it.each([
      ["no session cookie", () => { store.cookies = {}; }],
      ["a forged cookie", () => { store.cookies = { [ADMIN_COOKIE]: "9999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }; }],
      ["an expired cookie", () => { store.cookies = { [ADMIN_COOKIE]: createSessionValue(Date.now() - 9 * 3600 * 1000)! }; }],
    ])("%s: refused, Stripe is never asked, nothing is recorded", async (_label, setup) => {
      setup();
      const result = await refund();
      expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/session has ended/) });
      expect(createRefund).not.toHaveBeenCalled();
      expect(purchase().refund_requested_at).toBeNull();
    });

    it("an unconfigured admin area refuses too", async () => {
      vi.stubEnv("ADMIN_PASSWORD", "");
      expect((await refund()).status).toBe("error");
      expect(createRefund).not.toHaveBeenCalled();
    });
  });

  describe("a paid purchase is refunded in full through Stripe, and the webhook does the rest", () => {
    it("asks Stripe for a refund of the payment, with a key that makes repeats harmless", async () => {
      const result = await refund();
      expect(result.status).toBe("requested");
      expect(createRefund).toHaveBeenCalledTimes(1);
      expect(createRefund).toHaveBeenCalledWith(
        { payment_intent: PI, reason: "requested_by_customer", metadata: { source: "admin_refund", session_id: SESSION } },
        { idempotencyKey: `admin-refund-${SESSION}` },
      );
      expect(createRefund.mock.calls[0][0]).not.toHaveProperty("amount");   // a full refund, never partial
    });

    it("records only that a refund was REQUESTED: refunded_at stays empty until the charge.refunded webhook arrives", async () => {
      await refund();
      expect(purchase().refund_requested_at).toEqual(expect.any(String));
      expect(purchase().refunded_at).toBeNull();
      expect(purchase()).not.toHaveProperty("refund_reason", "refund");
    });

    it("tells the page to refresh and says the status follows from Stripe's webhook", async () => {
      const result = await refund();
      expect(store.revalidated).toEqual(["/admin"]);
      expect(result.message).toMatch(/charge\.refunded webhook/);
    });

    it("pressing it twice sends the same idempotency key, so Stripe makes one refund", async () => {
      await refund();
      await refund();
      expect(createRefund.mock.calls.map((call) => call[1])).toEqual([{ idempotencyKey: `admin-refund-${SESSION}` }, { idempotencyKey: `admin-refund-${SESSION}` }]);
    });
  });

  describe("it refuses what must not be refunded", () => {
    it.each([undefined, "", "not-a-session", "cs_test_", "cs_live_x", "pi_test_unitrefund0001", "cs_test_unitrefund0001; drop table payment_intents", 42])("a session id of %j", async (sessionId) => {
      expect((await refund(sessionId)).status).toBe("error");
      expect(createRefund).not.toHaveBeenCalled();
    });

    it("a purchase that does not exist", async () => {
      expect(await refund("cs_test_doesnotexist1")).toMatchObject({ status: "error", message: "No such purchase." });
      expect(createRefund).not.toHaveBeenCalled();
    });

    it("a checkout that was never paid", async () => {
      purchase().paid_at = null;
      expect(await refund()).toMatchObject({ status: "error", message: expect.stringMatching(/never paid/) });
      expect(createRefund).not.toHaveBeenCalled();
    });

    it("a purchase that is already refunded", async () => {
      purchase().refunded_at = "2026-10-02T10:00:00.000Z";
      expect(await refund()).toMatchObject({ status: "error", message: expect.stringMatching(/already refunded/) });
      expect(createRefund).not.toHaveBeenCalled();
    });

    it("a purchase with no Stripe payment on record (made before payment ids were kept): points to the Dashboard", async () => {
      purchase().stripe_payment_intent_id = null;
      expect(await refund()).toMatchObject({ status: "error", message: expect.stringMatching(/Stripe Dashboard/) });
      expect(createRefund).not.toHaveBeenCalled();
    });
  });

  describe("when Stripe says no", () => {
    it("a key without refund permission: says exactly which permission to grant, and records nothing", async () => {
      createRefund.mockRejectedValue(Object.assign(new Error("Permission denied"), { type: "StripePermissionError", code: "more_permissions_required" }));
      const result = await refund();
      expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/Charges and Refunds: Write/) });
      expect(purchase().refund_requested_at).toBeNull();
      expect(store.revalidated).toEqual([]);
    });

    it("a payment Stripe already refunded: waits for the webhook instead of failing", async () => {
      createRefund.mockRejectedValue(Object.assign(new Error("Charge ch_x has already been refunded."), { code: "charge_already_refunded" }));
      const result = await refund();
      expect(result).toMatchObject({ status: "requested", message: expect.stringMatching(/already refunded/) });
      expect(purchase().refund_requested_at).toEqual(expect.any(String));
    });

    it("any other refusal is shown and nothing is recorded", async () => {
      createRefund.mockRejectedValue(new Error("The charge is too old to be refunded."));
      expect(await refund()).toMatchObject({ status: "error", message: expect.stringMatching(/too old/) });
      expect(purchase().refund_requested_at).toBeNull();
    });
  });

  it("slows down a flood of refunds from one session", async () => {
    let last = await refund();
    for (let i = 0; i < 20; i++) last = await refund();
    expect(last).toMatchObject({ status: "error", message: expect.stringMatching(/Too many refunds/) });
    expect(createRefund.mock.calls.length).toBeLessThanOrEqual(20);
  });
});
