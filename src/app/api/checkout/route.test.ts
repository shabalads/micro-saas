import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../test/fake-supabase";
import { CONSENT_STATEMENT, checkoutSubmitMessage } from "../../../site/legal";

let sessionCounter = 0;
/** Like Stripe, every call returns a new session id (the ledger has a unique constraint on it). */
const createSession = vi.fn(async (params: Record<string, unknown>) => {
  void params; // typed so tests can read createSession.mock.calls[n][0]
  const id = `cs_test_unit${String(++sessionCounter).padStart(4, "0")}`;
  return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
});
const expireSession = vi.fn(async () => ({}));
vi.mock("../../utils/stripe-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/stripe-server")>()),
  getStripe: () => ({ checkout: { sessions: { create: createSession, expire: expireSession } } }),
}));

let fake = createFakeSupabase();
vi.mock("../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

import { POST } from "./route";

const JOB = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "sha256:" + "ab".repeat(32);
let nextClient = 0;
/** Every test gets its own client address, so one test's requests never count against another's rate limit. */
const call = (body: unknown, ip = `198.51.100.${++nextClient}`) =>
  POST(new Request("http://localhost:3000/api/checkout", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));

describe("POST /api/checkout", () => {
  beforeEach(() => {
    createSession.mockClear();
    expireSession.mockClear();
    sessionCounter = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({ usage_telemetry: [{ id: JOB, is_unlocked: false }] }, { unique: { payment_intents: ["stripe_session_id"] } });
  });

  describe("the Checkout Session it creates", () => {
    it("requires a billing address and tags everything with this project", async () => {
      const response = await call({ telemetryId: JOB, rowCount: 120, fingerprint: FINGERPRINT });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ url: "https://checkout.stripe.com/c/pay/cs_test_unit0001", jobId: JOB, sessionId: "cs_test_unit0001" });

      const params = createSession.mock.calls[0][0];
      expect(params).toMatchObject({
        mode: "payment",
        billing_address_collection: "required",
        client_reference_id: JOB,
        metadata: { telemetry_id: JOB, project_source: "ecommerce_data_sanitizer" },
        payment_intent_data: { metadata: { telemetry_id: JOB, project_source: "ecommerce_data_sanitizer" } },
      });
    });

    it("is exactly one $9.00 USD 'File Cleanup' and needs NO tax setup by default (Stripe Tax is off)", async () => {
      await call({ telemetryId: JOB, rowCount: 120 });
      const params = createSession.mock.calls[0][0];
      expect(params.line_items).toEqual([{ quantity: 1, price_data: { currency: "usd", unit_amount: 900, product_data: { name: "File Cleanup" } } }]);
      expect(params).not.toHaveProperty("automatic_tax");
      expect(params).not.toHaveProperty("tax_id_collection");
    });

    describe("with ENABLE_STRIPE_TAX=true", () => {
      beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_ENABLE_STRIPE_TAX", "true"); });
      afterEach(() => { vi.unstubAllEnvs(); });

      it("collects tax automatically, lets businesses enter a tax ID, and says which tax code and behavior apply", async () => {
        await call({ telemetryId: JOB, rowCount: 120 });
        const params = createSession.mock.calls[0][0];
        expect(params).toMatchObject({ automatic_tax: { enabled: true }, tax_id_collection: { enabled: true }, billing_address_collection: "required" });
        expect(params.line_items).toEqual([
          { quantity: 1, price_data: { currency: "usd", unit_amount: 900, tax_behavior: "exclusive", product_data: { name: "File Cleanup", tax_code: "txcd_10000000" } } },
        ]);
      });

      it("tells the customer the total includes tax, because it does", async () => {
        await call({ telemetryId: JOB, rowCount: 120 });
        const params = createSession.mock.calls[0][0] as { custom_text?: { submit?: { message: string } } };
        expect(params.custom_text?.submit?.message).toBe(checkoutSubmitMessage(true));
        expect(checkoutSubmitMessage(true)).toMatch(/includes the tax/);
      });
    });

    it("does not claim tax is included when Stripe Tax is off", () => {
      expect(checkoutSubmitMessage(false)).not.toMatch(/tax/i);
    });

    it("keeps Stripe's literal {CHECKOUT_SESSION_ID} placeholder and comes back to this app on success and cancel", async () => {
      await call({ telemetryId: JOB, rowCount: 120 });
      const params = createSession.mock.calls[0][0];
      expect(params.success_url).toBe(`http://localhost:3000/?session_id={CHECKOUT_SESSION_ID}&job_id=${JOB}`);
      expect(params.cancel_url).toBe(`http://localhost:3000/?checkout=canceled&job_id=${JOB}`);
    });

    it("records the attempt in payment_intents (with the file fingerprint) before handing out the URL", async () => {
      await call({ telemetryId: JOB, rowCount: 120, fingerprint: FINGERPRINT });
      expect(fake.tables.payment_intents).toEqual([{ telemetry_id: JOB, stripe_session_id: "cs_test_unit0001", file_fingerprint: FINGERPRINT }]);
    });

    it("refuses a job that is already paid for, without calling Stripe", async () => {
      fake.tables.usage_telemetry[0].is_unlocked = true;
      expect((await call({ telemetryId: JOB, rowCount: 120 })).status).toBe(409);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("expires the Stripe session and sends nobody to pay if the ledger row cannot be written", async () => {
      fake = createFakeSupabase({ usage_telemetry: [{ id: JOB, is_unlocked: false }] }, { failOn: ({ table, op }) => (table === "payment_intents" && op === "insert" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
      const response = await call({ telemetryId: JOB, rowCount: 120 });
      expect(response.status).toBe(500);
      expect((await response.json()).url).toBeUndefined();
      expect(expireSession).toHaveBeenCalledWith("cs_test_unit0001");
    });
  });

  describe("rate limiting", () => {
    it("allows 10 checkouts per client in the window, then answers 429 with Retry-After, without touching Stripe", async () => {
      const ip = "203.0.113.50";
      for (let i = 0; i < 10; i++) expect((await call({ rowCount: 60 }, ip)).status).toBe(200);
      expect(createSession).toHaveBeenCalledTimes(10);

      const blocked = await call({ rowCount: 60 }, ip);
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect((await blocked.json()).error).toMatch(/too many/i);
      expect(createSession).toHaveBeenCalledTimes(10);
    });

    it("counts clients separately: one noisy client does not block another", async () => {
      for (let i = 0; i < 11; i++) await call({ rowCount: 60 }, "203.0.113.60");
      expect((await call({ rowCount: 60 }, "203.0.113.61")).status).toBe(200);
    });

    it("cannot be dodged by forging the first x-forwarded-for entry", async () => {
      for (let i = 0; i < 10; i++) await call({ rowCount: 60 }, `1.2.3.${i}, 203.0.113.70`);
      expect((await call({ rowCount: 60 }, "9.9.9.9, 203.0.113.70")).status).toBe(429);
    });
  });
});

describe("POST /api/checkout: withdrawal waiver and site URL", () => {
  beforeEach(() => {
    createSession.mockClear();
    sessionCounter = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({ usage_telemetry: [{ id: JOB, is_unlocked: false }] }, { unique: { payment_intents: ["stripe_session_id"] } });
  });

  it("makes the customer tick the waiver box, with the consent wording and links to the legal pages", async () => {
    await call({ telemetryId: JOB, rowCount: 120 });
    const params = createSession.mock.calls[0][0] as { consent_collection?: unknown; custom_text?: { terms_of_service_acceptance?: { message: string }; submit?: { message: string } } };
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });

    const message = params.custom_text?.terms_of_service_acceptance?.message ?? "";
    expect(message).toContain(CONSENT_STATEMENT);
    expect(message).toMatch(/\]\(https?:\/\/[^)]+\/terms\)/);
    expect(message).toMatch(/\]\(https?:\/\/[^)]+\/refunds\)/);
    expect(message).toMatch(/\]\(https?:\/\/[^)]+\/privacy\)/);
    expect(message.length).toBeLessThanOrEqual(1200);   // Stripe's limit for this field
    expect(params.custom_text?.submit?.message).toBe(checkoutSubmitMessage(false));
  });

  it("sends customers back to NEXT_PUBLIC_SITE_URL (no trailing slash), and links the waiver pages there too", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shop.example.test/");
    try {
      await call({ telemetryId: JOB, rowCount: 120 });
      const params = createSession.mock.calls[0][0] as { success_url: string; cancel_url: string; custom_text: { terms_of_service_acceptance: { message: string } } };
      expect(params.success_url).toBe(`https://shop.example.test/?session_id={CHECKOUT_SESSION_ID}&job_id=${JOB}`);
      expect(params.cancel_url).toBe(`https://shop.example.test/?checkout=canceled&job_id=${JOB}`);
      expect(params.custom_text.terms_of_service_acceptance.message).toContain("(https://shop.example.test/terms)");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still honours the older APP_URL name when NEXT_PUBLIC_SITE_URL is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("APP_URL", "https://legacy.example.test");
    try {
      await call({ telemetryId: JOB, rowCount: 120 });
      expect(createSession.mock.calls[0][0].success_url).toMatch(/^https:\/\/legacy\.example\.test\/\?session_id=/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("POST /api/checkout: the free first file does not touch the paid flow", () => {
  beforeEach(() => {
    createSession.mockClear();
    sessionCounter = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("someone who already used their free first file can still buy this one, with the same session as anyone else", async () => {
    fake = createFakeSupabase(
      {
        usage_telemetry: [{ id: JOB, is_unlocked: false }],
        free_trials: [{ id: "t1", email_hash: "h", browser_id: "browser-id-aaaaaaaaaaaaaaaa", file_fingerprint: FINGERPRINT }],
      },
      { unique: { payment_intents: ["stripe_session_id"] } },
    );
    const response = await call({ telemetryId: JOB, rowCount: 150, fingerprint: FINGERPRINT });
    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0][0]).toMatchObject({ mode: "payment", client_reference_id: JOB, metadata: { telemetry_id: JOB, project_source: "ecommerce_data_sanitizer" } });
    expect(fake.tables.payment_intents).toHaveLength(1);
    expect(fake.tables.free_trials).toHaveLength(1);   // untouched
  });

  it("works with no free_trials table in play at all (the checkout never reads it)", async () => {
    fake = createFakeSupabase({ usage_telemetry: [{ id: JOB, is_unlocked: false }] }, { unique: { payment_intents: ["stripe_session_id"] } });
    expect((await call({ telemetryId: JOB, rowCount: 150 })).status).toBe(200);
  });
});
