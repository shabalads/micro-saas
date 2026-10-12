import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../test/fake-supabase";
import { FREE_ROW_LIMIT } from "../../utils/pricing";

let fake = createFakeSupabase();
vi.mock("../../utils/telemetry-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/telemetry-db")>()),
  getSupabaseAdmin: () => fake.client,
}));

import { verifyUnlockToken } from "../../utils/unlock-token";
import { POST } from "./route";

const FP_A = "sha256:" + "a".repeat(64);
const FP_B = "sha256:" + "b".repeat(64);
const BROWSER_1 = "browser-id-aaaaaaaaaaaaaaaa";
const BROWSER_2 = "browser-id-bbbbbbbbbbbbbbbb";
const BROWSER_3 = "browser-id-cccccccccccccccc";
const BIG = FREE_ROW_LIMIT + 20;
let nextClient = 0;
const freshIp = () => `203.0.113.${++nextClient}`;

interface Options {
  ip?: string;
  cookie?: string;
}
const call = (body: Record<string, unknown>, { ip = freshIp(), cookie }: Options = {}) =>
  POST(
    new Request("http://localhost/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
const claim = (overrides: Record<string, unknown> = {}, options?: Options) =>
  call({ action: "claim", email: "jane@example.com", marketingOptIn: false, fingerprint: FP_A, rowCount: BIG, browserId: BROWSER_1, ...overrides }, options);
const renew = (overrides: Record<string, unknown> = {}, options?: Options) => call({ action: "renew", fingerprint: FP_A, browserId: BROWSER_1, ...overrides }, options);

describe("POST /api/trial", () => {
  beforeEach(() => {
    vi.stubEnv("TRIAL_HASH_SECRET", "h".repeat(40));
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "unit-test-unlock-secret-unit-test-unlock-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({}, { unique: { free_trials: ["email_hash", "browser_id"] }, autoId: ["free_trials"] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("the first big file is free, once", () => {
    it("gives a new person an unlock token for the file, bound to that file's fingerprint", async () => {
      const response = await claim();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ status: "granted", created: true, browserId: BROWSER_1 });
      expect(body.grant).toMatchObject({ kind: "trial", fingerprint: FP_A });
      expect(body.grant.sessionId).toMatch(/^trial_[0-9a-f-]{36}$|^trial_.+/);
      expect(body.grant.expiresAt).toBeGreaterThan(Date.now());

      const claims = verifyUnlockToken(body.grant.token);
      expect(claims).toMatchObject({ sid: body.grant.sessionId, fp: FP_A });
      expect(claims?.exp).toBe(body.grant.expiresAt);   // the same short-lived token the paid flow uses
    });

    it("rejects a second trial with the same email address", async () => {
      expect((await claim()).status).toBe(200);
      const second = await claim({ browserId: BROWSER_2, fingerprint: FP_B });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ status: "not_eligible", message: expect.stringMatching(/already been used/) });
      expect(fake.tables.free_trials).toHaveLength(1);
    });

    it.each([
      ["different capitals", "JANE@Example.COM"],
      ["a +tag", "jane+second@example.com"],
      ["spaces around it", "  jane@example.com "],
    ])("the same email with %s is still the same person", async (_label, email) => {
      await claim();
      expect((await claim({ email, browserId: BROWSER_2, fingerprint: FP_B })).status).toBe(409);
      expect(fake.tables.free_trials).toHaveLength(1);
    });

    it("rejects a second trial from the same browser, even with another email: by the id in localStorage", async () => {
      await claim();
      expect((await claim({ email: "john@example.com", fingerprint: FP_B })).status).toBe(409);
      expect(fake.tables.free_trials).toHaveLength(1);
    });

    it("...and by the cookie alone, when localStorage was cleared (a new browser id in the body)", async () => {
      const first = await claim();
      const cookie = first.headers.getSetCookie()[0].split(";")[0];
      const second = await claim({ email: "john@example.com", browserId: BROWSER_3, fingerprint: FP_B }, { cookie });
      expect(second.status).toBe(409);
      expect(fake.tables.free_trials).toHaveLength(1);
    });

    it("...and by localStorage alone, when the cookie was cleared (no cookie sent)", async () => {
      await claim();
      expect((await claim({ email: "john@example.com", fingerprint: FP_B }, { cookie: undefined })).status).toBe(409);
    });

    it("a different person in a different browser still gets their own free file", async () => {
      await claim();
      const other = await claim({ email: "john@example.com", browserId: BROWSER_2, fingerprint: FP_B });
      expect(other.status).toBe(200);
      expect(fake.tables.free_trials).toHaveLength(2);
    });

    it("asking again for the SAME file returns the same trial instead of using up a second one", async () => {
      const first = await (await claim()).json();
      const again = await claim();
      expect(again.status).toBe(200);
      const body = await again.json();
      expect(body).toMatchObject({ status: "granted", created: false });
      expect(body.grant.sessionId).toBe(first.grant.sessionId);
      expect(fake.tables.free_trials).toHaveLength(1);
    });

    it("explains clearly when not eligible and never reveals which of the two matched", async () => {
      await claim();
      for (const retry of [claim({ browserId: BROWSER_2, fingerprint: FP_B }), claim({ email: "john@example.com", fingerprint: FP_B })]) {
        const body = await (await retry).json();
        expect(body.message).toMatch(/one-time unlock/);
        expect(JSON.stringify(body)).not.toMatch(/email address and|browser id|hash/i);
      }
    });
  });

  describe("only for files that are not already free", () => {
    it("exactly FREE_ROW_LIMIT rows is free, so there is nothing to claim and nothing is recorded", async () => {
      const response = await claim({ rowCount: FREE_ROW_LIMIT });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ status: "not_needed" });
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });

    it("one row more is a big file and can be claimed", async () => {
      expect((await claim({ rowCount: FREE_ROW_LIMIT + 1 })).status).toBe(200);
    });

    it.each([undefined, null, "200", -5, Number.NaN])("a row count of %j is not accepted", async (rowCount) => {
      expect((await claim({ rowCount })).status).toBe(400);
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });
  });

  describe("bad input", () => {
    it.each([
      ["no email", { email: undefined }],
      ["not an email", { email: "nope" }],
      ["a bad fingerprint", { fingerprint: "../../etc/passwd" }],
      ["no fingerprint", { fingerprint: undefined }],
      ["a bad browser id", { browserId: "x" }],
      ["a browser id with markup", { browserId: "<script>alert(1)</script>" }],
    ])("%s is a 400 and records nothing", async (_label, overrides) => {
      expect((await claim(overrides)).status).toBe(400);
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });

    it("garbage JSON is a 400, not a crash", async () => {
      const response = await POST(new Request("http://localhost/api/trial", { method: "POST", headers: { "x-forwarded-for": freshIp() }, body: "{not json" }));
      expect(response.status).toBe(400);
    });
  });

  describe("what is stored: no email unless the person asked for updates", () => {
    it("stores a hash and a browser id, never the address", async () => {
      await claim({ email: "Jane.Doe@Example.com" });
      const row = fake.tables.free_trials[0];
      expect(row.email_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row).toMatchObject({ browser_id: BROWSER_1, file_fingerprint: FP_A });
      expect(JSON.stringify(row)).not.toMatch(/jane|example\.com|@/i);
      expect(row).not.toHaveProperty("marketing_email");
    });

    it.each([false, undefined, null, "true", 1, "on"])("an optional-updates value of %j does NOT subscribe anyone", async (marketingOptIn) => {
      await claim({ marketingOptIn });
      expect(fake.tables.free_trials[0]).not.toHaveProperty("marketing_email");
      expect(fake.tables.free_trials[0]).not.toHaveProperty("marketing_opt_in_at");
    });

    it("only an explicit true stores the address, with the time they agreed", async () => {
      await claim({ email: " Jane+news@Example.com ", marketingOptIn: true });
      expect(fake.tables.free_trials[0]).toMatchObject({ marketing_email: "jane+news@example.com", marketing_opt_in_at: expect.any(String) });
    });

    it("the free file itself never depends on the optional box", async () => {
      expect((await claim({ marketingOptIn: false })).status).toBe(200);
    });

    it("the hash depends on the secret: with another TRIAL_HASH_SECRET the same email hashes differently", async () => {
      await claim();
      const first = fake.tables.free_trials[0].email_hash;
      fake = createFakeSupabase({}, { unique: { free_trials: ["email_hash", "browser_id"] }, autoId: ["free_trials"] });
      vi.stubEnv("TRIAL_HASH_SECRET", "z".repeat(40));
      await claim();
      expect(fake.tables.free_trials[0].email_hash).not.toBe(first);
    });
  });

  describe("the browser cookie", () => {
    it("is set only when a trial exists, httpOnly, scoped to the whole site, and carries the browser id", async () => {
      const response = await claim();
      const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("csv_trial_browser="));
      expect(cookie).toBeDefined();
      expect(cookie).toContain(`csv_trial_browser=${BROWSER_1}`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=\d{7,}/);
    });

    it("is not set when the answer is no", async () => {
      await claim();
      const refused = await claim({ browserId: BROWSER_2, fingerprint: FP_B });
      expect(refused.headers.getSetCookie()).toEqual([]);
      const badInput = await claim({ email: "nope" });
      expect(badInput.headers.getSetCookie()).toEqual([]);
    });

    it("the browser's cookie wins: when localStorage and the cookie disagree, the recorded id is the cookie's", async () => {
      // the cookie already carries BROWSER_2 (for example from a previous trial for a file whose row was deleted)
      const response = await claim({ browserId: BROWSER_1 }, { cookie: `csv_trial_browser=${BROWSER_2}` });
      const body = await response.json();
      expect(body.browserId).toBe(BROWSER_2);
      expect(fake.tables.free_trials[0].browser_id).toBe(BROWSER_2);
    });
  });

  describe("renewing the token for a trial this browser already has", () => {
    it("gives a fresh token for the same file, without an email", async () => {
      const first = await (await claim()).json();
      const response = await renew();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: "granted", created: false });
      expect(body.grant.sessionId).toBe(first.grant.sessionId);
      expect(verifyUnlockToken(body.grant.token)).toMatchObject({ fp: FP_A });
    });

    it("works with only the cookie, or only localStorage's id", async () => {
      const first = await claim();
      const cookie = first.headers.getSetCookie()[0].split(";")[0];
      expect((await renew({ browserId: BROWSER_3 }, { cookie })).status).toBe(200);
      expect((await renew()).status).toBe(200);
    });

    it("is 404 for another browser, and for another file", async () => {
      await claim();
      expect((await renew({ browserId: BROWSER_2 })).status).toBe(404);
      expect((await renew({ fingerprint: FP_B })).status).toBe(404);
    });

    it("never creates a trial", async () => {
      await renew();
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });
  });

  describe("limits", () => {
    it("slows down repeated attempts from one network address", async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await claim({ email: "nope" }, { ip })).status);
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      const blocked = await claim({ email: "nope" }, { ip });
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    });

    it("lets one network address start only a handful of NEW trials a day (the email is not verified)", async () => {
      const ip = freshIp();
      for (let i = 1; i <= 5; i++) {
        const ok = await claim({ email: `person${i}@example.com`, browserId: `browser-id-person-${String(i).padStart(10, "0")}`, fingerprint: "sha256:" + String(i).repeat(64) }, { ip });
        expect(ok.status, `trial ${i}`).toBe(200);
      }
      const sixth = await claim({ email: "person6@example.com", browserId: "browser-id-person-0000000006", fingerprint: "sha256:" + "6".repeat(64) }, { ip });
      expect(sixth.status).toBe(429);
      expect(await sixth.json()).toMatchObject({ message: expect.stringMatching(/tomorrow/) });
      expect(fake.tables.free_trials).toHaveLength(5);
    });

    it("asking again for a trial you already have is not counted against that daily allowance", async () => {
      const ip = freshIp();
      for (let i = 1; i <= 5; i++) {
        await claim({ email: `person${i}@example.com`, browserId: `browser-id-person-${String(i).padStart(10, "0")}`, fingerprint: "sha256:" + String(i).repeat(64) }, { ip });
      }
      const again = await claim({ email: "person1@example.com", browserId: "browser-id-person-0000000001", fingerprint: "sha256:" + "1".repeat(64) }, { ip });
      expect(again.status).toBe(200);
    });
  });

  describe("when it cannot work, it says so and uses nothing up", () => {
    it("is 503 without TRIAL_HASH_SECRET", async () => {
      vi.stubEnv("TRIAL_HASH_SECRET", "");
      expect((await claim()).status).toBe(503);
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });

    it("is 503 without UNLOCK_TOKEN_SECRET, BEFORE recording a trial that could never be delivered", async () => {
      vi.stubEnv("UNLOCK_TOKEN_SECRET", "");
      expect((await claim()).status).toBe(503);
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });

    it("a database failure is a 500 and leaves no trial behind", async () => {
      fake = createFakeSupabase({}, { failOn: ({ op }) => (op === "insert" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
      expect((await claim()).status).toBe(500);
      expect(fake.tables.free_trials ?? []).toHaveLength(0);
    });
  });
});

describe("POST /api/trial in test mode (TRIAL_TEST_EMAILS)", () => {
  beforeEach(() => {
    vi.stubEnv("TRIAL_HASH_SECRET", "h".repeat(40));
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "unit-test-unlock-secret-unit-test-unlock-secret");
    vi.stubEnv("TRIAL_TEST_EMAILS", "jane@example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fake = createFakeSupabase({}, { unique: { free_trials: ["email_hash", "browser_id"] }, autoId: ["free_trials"] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("a listed address gets a free file again and again: the same file, another file, the same browser", async () => {
    const answers = [await claim(), await claim(), await claim({ fingerprint: FP_B }), await claim({ fingerprint: FP_B, browserId: BROWSER_2 })];
    expect(answers.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const bodies = await Promise.all(answers.map((response) => response.clone().json()));
    for (const body of bodies) expect(body).toMatchObject({ status: "granted", created: true });
    expect(new Set(bodies.map((body) => body.grant.sessionId)).size).toBe(4);
    expect(fake.tables.free_trials).toHaveLength(4);
  });

  it("each file's token is a real unlock token for THAT file, and an earlier one keeps working", async () => {
    const first = await (await claim({ fingerprint: FP_A })).json();
    const second = await (await claim({ fingerprint: FP_B })).json();
    expect(verifyUnlockToken(first.grant.token)).toMatchObject({ sid: first.grant.sessionId, fp: FP_A });
    expect(verifyUnlockToken(second.grant.token)).toMatchObject({ sid: second.grant.sessionId, fp: FP_B });
    expect(first.grant).toMatchObject({ kind: "trial", fingerprint: FP_A });
  });

  it("works whatever the address looks like: capitals, a +tag", async () => {
    expect((await claim({ email: "  Jane+shop@Example.com " })).status).toBe(200);
    expect((await claim({ email: "JANE@example.com", fingerprint: FP_B })).status).toBe(200);
  });

  it("is not stopped by a real free file already used with that address and browser (the case this exists for)", async () => {
    vi.stubEnv("TRIAL_TEST_EMAILS", "");
    expect((await claim()).status).toBe(200);
    expect((await claim({ fingerprint: FP_B })).status).toBe(409);   // the ordinary rule, as the person met it
    vi.stubEnv("TRIAL_TEST_EMAILS", "jane@example.com");
    expect((await claim({ fingerprint: FP_B })).status).toBe(200);
    expect(fake.tables.free_trials.filter((row) => !String(row.browser_id).startsWith("test-"))).toHaveLength(1);   // the real row is still there, untouched
  });

  it("sets a 'test-' browser id in the cookie and in the answer, so the browser can renew the file it was given", async () => {
    const response = await claim();
    const body = await response.json();
    expect(body.browserId).toMatch(/^test-/);
    const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("csv_trial_browser="));
    expect(cookie).toContain(`csv_trial_browser=${body.browserId}`);

    const renewed = await renew({ browserId: body.browserId });
    expect(renewed.status).toBe(200);
    expect((await renewed.json()).grant.sessionId).toBe(body.grant.sessionId);
  });

  it("never stores the product-updates address, even when its box is ticked", async () => {
    await claim({ marketingOptIn: true });
    expect(fake.tables.free_trials[0]).not.toHaveProperty("marketing_email");
  });

  it("does not exempt anyone else: another address is held to one free file, in the same browser", async () => {
    expect((await claim({ email: "other@example.com" })).status).toBe(200);
    expect((await claim({ email: "other@example.com", fingerprint: FP_B })).status).toBe(409);
    expect((await claim({ email: "third@example.com", fingerprint: FP_B })).status).toBe(409);
  });

  it("a file that is already free is still 'not needed', for a tester too", async () => {
    const response = await claim({ rowCount: FREE_ROW_LIMIT });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "not_needed" });
    expect(fake.tables.free_trials ?? []).toHaveLength(0);
  });

  it('"*" exempts every address (testing from your own computer with any email)', async () => {
    vi.stubEnv("TRIAL_TEST_EMAILS", "*");
    expect((await claim({ email: "anyone@example.com" })).status).toBe(200);
    expect((await claim({ email: "anyone@example.com", fingerprint: FP_B })).status).toBe(200);
    expect((await claim({ email: "someone-else@example.com", fingerprint: FP_B })).status).toBe(200);
  });

  it("is OFF in production, whatever is listed: one free file per person, as for everybody", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRIAL_TEST_EMAILS", "jane@example.com,*");
    expect((await claim()).status).toBe(200);
    const second = await claim({ fingerprint: FP_B });
    expect(second.status).toBe(409);
    expect((await second.json()).message).toMatch(/already been used/);
    expect(fake.tables.free_trials).toHaveLength(1);
    expect(String(fake.tables.free_trials[0].browser_id)).not.toMatch(/^test-/);
  });
});

