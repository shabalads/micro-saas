import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../test/fake-supabase";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},   // only meaningful inside a real Next request
}));

let fake = createFakeSupabase({ usage_telemetry: [{ id: "x" }] });
let queries = 0;
vi.mock("../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => {
    const real = fake.client;
    return { from: (table: string) => { queries++; return real.from(table); } };
  },
}));

const SECRET_VALUES = ["sk_test_secret_value_123", "whsec_secret_value_456", "u".repeat(40), "service-role-secret-789", "t".repeat(40)];

async function healthResponse() {
  vi.resetModules();                       // each test starts without the cached database result
  const { GET } = await import("./route");
  return GET();
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SECRET_VALUES[3]);
    vi.stubEnv("STRIPE_SECRET_KEY", SECRET_VALUES[0]);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET_VALUES[1]);
    vi.stubEnv("UNLOCK_TOKEN_SECRET", SECRET_VALUES[2]);
    vi.stubEnv("TRIAL_HASH_SECRET", "t".repeat(40));
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({ usage_telemetry: [{ id: "x" }] });
    queries = 0;
  });

  it("is 200 and 'ok' when configured and the database answers", async () => {
    const response = await healthResponse();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", checks: { database: "ok", stripe: "ok", webhook: "ok", unlock: "ok", trial: "ok" } });
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is 503 'degraded' and names the failing component when the database errors", async () => {
    fake = createFakeSupabase({}, { failOn: () => ({ code: "XX000", message: "password authentication failed for user postgres", details: null, hint: null }) });
    const response = await healthResponse();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ status: "degraded", checks: { database: "fail", stripe: "ok" } });
    expect(JSON.stringify(body)).not.toMatch(/password|postgres/);   // no error text on a public endpoint
  });

  it.each([
    ["STRIPE_SECRET_KEY", "stripe"],
    ["STRIPE_WEBHOOK_SECRET", "webhook"],
    ["UNLOCK_TOKEN_SECRET", "unlock"],
    ["TRIAL_HASH_SECRET", "trial"],
  ])("is 503 when %s is missing, flagging only %s", async (variable, check) => {
    vi.stubEnv(variable, "");
    const response = await healthResponse();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks[check]).toBe("fail");
    expect(Object.values(body.checks).filter((value) => value === "fail")).toHaveLength(1);
  });

  it("treats a too-short trial hash secret as not configured (the free first file stays off rather than hash with a weak key)", async () => {
    vi.stubEnv("TRIAL_HASH_SECRET", "short");
    expect((await (await healthResponse()).json()).checks.trial).toBe("fail");
  });

  it("treats a too-short unlock secret as not configured", async () => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "short");
    expect((await (await healthResponse()).json()).checks.unlock).toBe("fail");
  });

  it("never echoes secrets, key modes or env values", async () => {
    const text = JSON.stringify(await (await healthResponse()).json());
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/sk_|rk_|whsec_|test|live/i);
  });

  it("does not query the database on every ping (short cache), and does re-check after it expires", async () => {
    vi.resetModules();
    const { GET } = await import("./route");
    await GET(); await GET(); await GET();
    expect(queries).toBe(1);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 11_000);
      await GET();
      expect(queries).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
