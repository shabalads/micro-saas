import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../../test/fake-supabase";

let fake = createFakeSupabase();
vi.mock("../../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

import { signUnlockToken } from "../../../utils/unlock-token";
import { POST } from "./route";

const JOB = "11111111-1111-4111-8111-111111111111";
const SESSION = "cs_test_unit0001";
let nextClient = 0;

const verify = (token: unknown) =>
  POST(new Request("http://localhost/api/unlock/verify", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++nextClient}` }, body: JSON.stringify({ token }) }));
const token = () => signUnlockToken({ sessionId: SESSION, jobId: JOB, fingerprint: null })!.token;

describe("POST /api/unlock/verify", () => {
  beforeEach(() => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "unit-test-unlock-secret-unit-test-unlock-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({ payment_intents: [{ stripe_session_id: SESSION, telemetry_id: JOB, paid_at: "2026-10-01T10:00:00.000Z", refunded_at: null }] });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("accepts a genuine token for a paid purchase", async () => {
    const response = await verify(token());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: true });
  });

  it("rejects the SAME genuine token the moment the purchase is refunded: 403 'refunded'", async () => {
    const issued = token();
    expect((await verify(issued)).status).toBe(200);

    fake.tables.payment_intents[0].refunded_at = "2026-10-02T10:00:00.000Z";
    const response = await verify(issued);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ valid: false, reason: "refunded" });
  });

  it("rejects a token whose purchase is not paid, a forged token, and garbage", async () => {
    fake.tables.payment_intents[0].paid_at = null;
    expect((await verify(token())).status).toBe(401);
    expect((await verify("not.a.token")).status).toBe(401);
    expect((await verify(null)).status).toBe(401);
  });
});

describe("POST /api/unlock/verify: free first-file tokens are bound to their file", () => {
  const TRIAL = "11111111-2222-4333-8444-555555555555";
  const FILE_A = "sha256:" + "a".repeat(64);
  const FILE_B = "sha256:" + "b".repeat(64);
  const trialToken = (fingerprint: string | null = FILE_A, id = TRIAL) => signUnlockToken({ sessionId: `trial_${id}`, jobId: null, fingerprint })!.token;
  const verifyFile = (token: unknown, fingerprint?: unknown) =>
    POST(new Request("http://localhost/api/unlock/verify", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.101.${++nextClient}` }, body: JSON.stringify({ token, fingerprint }) }));

  beforeEach(() => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "unit-test-unlock-secret-unit-test-unlock-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({
      payment_intents: [{ stripe_session_id: SESSION, telemetry_id: JOB, paid_at: "2026-10-01T10:00:00.000Z", refunded_at: null }],
      free_trials: [{ id: TRIAL, email_hash: "h", browser_id: "browser-id-aaaaaaaaaaaaaaaa", file_fingerprint: FILE_A, created_at: "2026-10-01T10:00:00.000Z" }],
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("accepts a trial token for the file it was issued for", async () => {
    const response = await verifyFile(trialToken(), FILE_A);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: true });
  });

  it("refuses the same token for any other file: 403 'file'", async () => {
    const response = await verifyFile(trialToken(), FILE_B);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ valid: false, reason: "file" });
  });

  it.each([undefined, null, "", 42])("refuses a trial token when the browser does not say which file it is exporting (%j)", async (fingerprint) => {
    expect((await verifyFile(trialToken(), fingerprint)).status).toBe(403);
  });

  it("refuses a trial token that carries no fingerprint at all", async () => {
    expect((await verifyFile(trialToken(null), FILE_A)).status).toBe(403);
  });

  it("refuses a token for a trial that no longer exists (for example deleted on request), or whose file differs from the record", async () => {
    expect((await verifyFile(trialToken(FILE_A, "99999999-2222-4333-8444-555555555555"), FILE_A)).status).toBe(401);
    fake.tables.free_trials[0].file_fingerprint = FILE_B;
    expect((await verifyFile(trialToken(), FILE_A)).status).toBe(401);
  });

  it("a trial token cannot be made up: without the server's secret the signature fails", async () => {
    const real = trialToken();
    const forged = `${Buffer.from(JSON.stringify({ v: 1, sid: `trial_${TRIAL}`, job: null, fp: FILE_B, iat: 0, exp: Date.now() + 600_000 })).toString("base64url")}.${real.split(".")[1]}`;
    expect((await verifyFile(forged, FILE_B)).status).toBe(401);
  });

  describe("the paid flow is unaffected", () => {
    it("a paid token still verifies with no fingerprint in the request (exactly as before)", async () => {
      expect((await verify(token())).status).toBe(200);
    });

    it("a paid token ignores the extra fingerprint field, even one for another file, and even with a free trial on record", async () => {
      expect((await verifyFile(token(), FILE_B)).status).toBe(200);
      expect((await verifyFile(token(), FILE_A)).status).toBe(200);
    });

    it("a refunded paid purchase is still refused, trial or not", async () => {
      fake.tables.payment_intents[0].refunded_at = "2026-10-02T10:00:00.000Z";
      expect((await verifyFile(token(), FILE_A)).status).toBe(403);
    });

    it("a trial row can not vouch for a Stripe session id, and a Stripe session never consults the trials table", async () => {
      fake.tables.free_trials.push({ id: SESSION, email_hash: "h2", browser_id: "browser-id-bbbbbbbbbbbbbbbb", file_fingerprint: FILE_A });
      fake.tables.payment_intents[0].paid_at = null;
      expect((await verifyFile(token(), FILE_A)).status).toBe(401);   // unpaid stays unpaid
    });
  });
});
