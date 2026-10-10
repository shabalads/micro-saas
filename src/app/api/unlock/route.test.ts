import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../test/fake-supabase";

let fake = createFakeSupabase();
vi.mock("../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

const retrieve = vi.fn();
vi.mock("../../utils/stripe-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/stripe-server")>()),
  getStripe: () => ({ checkout: { sessions: { retrieve } } }),
}));

import { POST } from "./route";

const JOB = "11111111-1111-4111-8111-111111111111";
const S1 = "cs_test_unit0001";
const S2 = "cs_test_unit0002";
const PAID = "2026-10-01T10:00:00.000Z";
const REFUNDED = "2026-10-02T10:00:00.000Z";
let nextClient = 0;

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/unlock", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++nextClient}` }, body: JSON.stringify(body) }));

function database(purchases: Array<Record<string, unknown>>) {
  fake = createFakeSupabase(
    { usage_telemetry: [{ id: JOB, is_unlocked: true }], payment_intents: purchases },
    { unique: { payment_intents: ["stripe_session_id"] } },
  );
}
const purchase = (sessionId: string, extra: Record<string, unknown> = {}) => ({ stripe_session_id: sessionId, telemetry_id: JOB, file_fingerprint: "sha256:" + "a".repeat(64), email: "buyer@example.com", paid_at: PAID, refunded_at: null, ...extra });

describe("POST /api/unlock", () => {
  beforeEach(() => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "unit-test-unlock-secret-unit-test-unlock-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    retrieve.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe("by Stripe session id", () => {
    it("a paid purchase gets a token bound to the session and the file", async () => {
      database([purchase(S1)]);
      const response = await call({ sessionId: S1 });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("paid");
      expect(body.purchases).toHaveLength(1);
      expect(body.purchases[0]).toMatchObject({ sessionId: S1, fingerprint: "sha256:" + "a".repeat(64) });
      expect(typeof body.purchases[0].token).toBe("string");
    });

    it("a REFUNDED purchase gets no token: 403 'refunded'", async () => {
      database([purchase(S1, { refunded_at: REFUNDED, refund_reason: "refund" })]);
      const response = await call({ sessionId: S1 });
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toMatchObject({ status: "refunded" });
      expect(JSON.stringify(body)).not.toMatch(/token/);
    });

    it("a DISPUTED purchase is treated the same way", async () => {
      database([purchase(S1, { refunded_at: REFUNDED, refund_reason: "dispute" })]);
      expect((await call({ sessionId: S1 })).status).toBe(403);
    });

    it("a refunded purchase still unlocks through another purchase of the same file that was NOT refunded", async () => {
      database([purchase(S1, { refunded_at: REFUNDED }), purchase(S2, { paid_at: "2026-10-03T10:00:00.000Z" })]);
      const body = await (await call({ sessionId: S1 })).json();
      expect(body.status).toBe("paid");
      expect(body.purchases.map((grant: { sessionId: string }) => grant.sessionId)).toEqual([S2]);
    });

    it("does not ask Stripe about a refunded session (the ledger already answers)", async () => {
      database([purchase(S1, { refunded_at: REFUNDED })]);
      await call({ sessionId: S1 });
      expect(retrieve).not.toHaveBeenCalled();
    });

    it("an unpaid checkout that Stripe says is paid gets recorded, with its PaymentIntent id, and then unlocks", async () => {
      database([purchase(S1, { paid_at: null })]);
      fake.tables.usage_telemetry[0].is_unlocked = false;
      retrieve.mockResolvedValue({ id: S1, client_reference_id: JOB, status: "complete", payment_status: "paid", payment_intent: "pi_test_unit0001", customer_details: { email: "Buyer@Example.com" } });
      const response = await call({ sessionId: S1 });
      expect(response.status).toBe(200);
      expect(fake.tables.payment_intents[0]).toMatchObject({ paid_at: expect.any(String), stripe_payment_intent_id: "pi_test_unit0001" });
    });

    it("an unpaid checkout is 'pending' (202), and an unknown session is 404", async () => {
      database([purchase(S1, { paid_at: null })]);
      retrieve.mockResolvedValue({ id: S1, client_reference_id: JOB, status: "open", payment_status: "unpaid" });
      expect((await call({ sessionId: S1 })).status).toBe(202);
      expect((await call({ sessionId: "cs_test_neverheardof" })).status).toBe(404);
    });
  });

  describe("by receipt email (the Recover page)", () => {
    it("lists purchases that still count and leaves refunded ones out", async () => {
      database([purchase(S1, { paid_at: "2026-10-05T10:00:00.000Z", refunded_at: REFUNDED }), purchase(S2, { paid_at: "2026-10-01T10:00:00.000Z" })]);
      const body = await (await call({ email: "Buyer@Example.com" })).json();
      expect(body.status).toBe("paid");
      expect(body.purchases.map((grant: { sessionId: string }) => grant.sessionId)).toEqual([S2]);
    });

    it("says 'refunded' (403), not 'not found', when the only purchases for that email were refunded", async () => {
      database([purchase(S1, { refunded_at: REFUNDED })]);
      const response = await call({ email: "buyer@example.com" });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ status: "refunded" });
    });

    it("an email with no purchase is 404", async () => {
      database([purchase(S1)]);
      expect((await call({ email: "someone-else@example.com" })).status).toBe(404);
    });
  });
});
