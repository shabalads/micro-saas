import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../test/fake-supabase";
import { TEST_BROWSER_PREFIX, claimTrial, findTrialForBrowser, getTrialSecret, grantTestTrial, hashEmailIdentity, isBrowserId, isTrialTester, normalizeEmail, readCookie } from "./trial-service";

const SECRET = "s".repeat(40);
const FP_A = "sha256:" + "a".repeat(64);
const FP_B = "sha256:" + "b".repeat(64);
const BROWSER_1 = "browser-id-aaaaaaaaaaaaaaaa";
const BROWSER_2 = "browser-id-bbbbbbbbbbbbbbbb";

describe("normalizeEmail: who counts as the same person", () => {
  it.each([
    ["Jane.Doe@Example.com", "jane.doe@example.com"],
    ["  jane.doe@example.com  ", "jane.doe@example.com"],
    ["jane.doe+shop@example.com", "jane.doe@example.com"],
    ["jane.doe+a+b@example.com", "jane.doe@example.com"],
    ["j.a.n.e@gmail.com", "jane@gmail.com"],
    ["Jane+x@Gmail.com", "jane@gmail.com"],
    ["jane@googlemail.com", "jane@gmail.com"],
  ])("%s is the person %s", (input, identity) => {
    expect(normalizeEmail(input)?.identity).toBe(identity);
  });

  it("only Gmail ignores dots: elsewhere a.b and ab are different mailboxes", () => {
    expect(normalizeEmail("a.b@example.com")?.identity).toBe("a.b@example.com");
  });

  it("keeps the address as typed (lower case, trimmed) for the optional product-updates list", () => {
    expect(normalizeEmail("  Jane.Doe+news@Example.com ")?.email).toBe("jane.doe+news@example.com");
  });

  it.each([null, undefined, 5, "", "plain", "a@b", "@example.com", "a b@example.com", "+tag@example.com", `${"x".repeat(250)}@example.com`, `${"x".repeat(65)}@example.com`])("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe("hashEmailIdentity: a keyed one-way hash", () => {
  it("is stable for one secret, different for another, and not a plain hash anyone could compute", () => {
    const hash = hashEmailIdentity("jane@example.com", SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmailIdentity("jane@example.com", SECRET)).toBe(hash);
    expect(hashEmailIdentity("jane@example.com", "t".repeat(40))).not.toBe(hash);
    expect(hashEmailIdentity("john@example.com", SECRET)).not.toBe(hash);
    expect(hash).not.toBe(createHash("sha256").update("jane@example.com").digest("hex"));
    expect(hash).not.toContain("jane");
  });
});

describe("secrets, ids and cookies", () => {
  it("TRIAL_HASH_SECRET must be at least 32 characters", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getTrialSecret({ TRIAL_HASH_SECRET: SECRET })).toBe(SECRET);
    expect(getTrialSecret({ TRIAL_HASH_SECRET: "short" })).toBeNull();
    expect(getTrialSecret({})).toBeNull();
  });

  it("a browser id is a random-looking token, nothing that could carry other content", () => {
    expect(isBrowserId(BROWSER_1)).toBe(true);
    for (const bad of [null, "", "short", "has space in it 1234567", "x".repeat(65), "semi;colon;1234567890", "<script>alert(1)</script>"]) expect(isBrowserId(bad), String(bad)).toBe(false);
  });

  it("reads one cookie out of a Cookie header", () => {
    const request = new Request("http://x", { headers: { cookie: `a=1; csv_trial_browser=${BROWSER_1}; b=2` } });
    expect(readCookie(request, "csv_trial_browser")).toBe(BROWSER_1);
    expect(readCookie(request, "missing")).toBeNull();
    expect(readCookie(new Request("http://x"), "a")).toBeNull();
  });
});

describe("claimTrial", () => {
  const input = (overrides: Partial<Parameters<typeof claimTrial>[1]> = {}) => ({ emailHash: "hash-jane", browserIds: [BROWSER_1], fingerprint: FP_A, marketingEmail: null, ...overrides });
  const database = () => createFakeSupabase({}, { unique: { free_trials: ["email_hash", "browser_id"] }, autoId: ["free_trials"] });

  it("records a new trial", async () => {
    const { client, tables } = database();
    const outcome = await claimTrial(client, input());
    expect(outcome).toMatchObject({ status: "granted", created: true });
    expect(tables.free_trials).toHaveLength(1);
    expect(tables.free_trials[0]).toMatchObject({ email_hash: "hash-jane", browser_id: BROWSER_1, file_fingerprint: FP_A });
  });

  it("one trial per email, however the browser changes", async () => {
    const { client, tables } = database();
    await claimTrial(client, input());
    expect(await claimTrial(client, input({ browserIds: [BROWSER_2], fingerprint: FP_B }))).toEqual({ status: "not_eligible" });
    expect(tables.free_trials).toHaveLength(1);
  });

  it("one trial per browser, however the email changes", async () => {
    const { client, tables } = database();
    await claimTrial(client, input());
    expect(await claimTrial(client, input({ emailHash: "hash-john", fingerprint: FP_B }))).toEqual({ status: "not_eligible" });
    expect(tables.free_trials).toHaveLength(1);
  });

  it("any of the browser's ids is enough to be recognised (cookie id or localStorage id)", async () => {
    const { client } = database();
    await claimTrial(client, input({ browserIds: [BROWSER_1] }));
    expect((await claimTrial(client, input({ emailHash: "hash-other", browserIds: [BROWSER_2, BROWSER_1], fingerprint: FP_B }))).status).toBe("not_eligible");
  });

  it("asking again for the SAME file is not a second trial: it returns the same one and does not use the network's daily allowance", async () => {
    const { client, tables } = database();
    const first = await claimTrial(client, input());
    const gate = vi.fn(async () => true);
    const again = await claimTrial(client, input(), gate);
    expect(again).toMatchObject({ status: "granted", created: false });
    expect((again as { trial: { id: string } }).trial.id).toBe((first as { trial: { id: string } }).trial.id);
    expect(gate).not.toHaveBeenCalled();
    expect(tables.free_trials).toHaveLength(1);
  });

  it("asks the per-network gate only when a NEW trial would be recorded, and records nothing if it says no", async () => {
    const { client, tables } = database();
    const gate = vi.fn(async () => false);
    expect(await claimTrial(client, input(), gate)).toEqual({ status: "throttled" });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(tables.free_trials ?? []).toHaveLength(0);
  });

  it("two requests racing for one email: exactly one wins, the other is judged against the winner", async () => {
    const { client, tables } = database();
    const [a, b] = await Promise.all([
      claimTrial(client, input({ browserIds: [BROWSER_1] })),
      claimTrial(client, input({ browserIds: [BROWSER_2], fingerprint: FP_B })),
    ]);
    expect([a.status, b.status].sort()).toEqual(["granted", "not_eligible"]);
    expect(tables.free_trials).toHaveLength(1);
  });

  it("stores the email itself only when the optional box was ticked, with when they agreed", async () => {
    const without = database();
    await claimTrial(without.client, input());
    expect(without.tables.free_trials[0]).not.toHaveProperty("marketing_email");
    expect(JSON.stringify(without.tables.free_trials)).not.toMatch(/@/);

    const withUpdates = database();
    await claimTrial(withUpdates.client, input({ marketingEmail: "jane@example.com" }));
    expect(withUpdates.tables.free_trials[0]).toMatchObject({ marketing_email: "jane@example.com", marketing_opt_in_at: expect.any(String) });
  });

  it("a database failure is an error, not a free file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase({}, { failOn: ({ op }) => (op === "insert" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
    expect(await claimTrial(client, input())).toEqual({ status: "error" });
    const broken = createFakeSupabase({}, { failOn: ({ op }) => (op === "select" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
    expect(await claimTrial(broken.client, input())).toEqual({ status: "error" });
  });
});

describe("findTrialForBrowser", () => {
  it("finds this browser's trial for this file, and nothing for another file or another browser", async () => {
    const { client } = createFakeSupabase({ free_trials: [{ id: "t1", email_hash: "h", browser_id: BROWSER_1, file_fingerprint: FP_A, created_at: "2026-10-01T00:00:00Z" }] });
    expect((await findTrialForBrowser(client, [BROWSER_1], FP_A)).trial?.id).toBe("t1");
    expect((await findTrialForBrowser(client, [BROWSER_1], FP_B)).trial).toBeNull();
    expect((await findTrialForBrowser(client, [BROWSER_2], FP_A)).trial).toBeNull();
    expect((await findTrialForBrowser(client, [], FP_A)).trial).toBeNull();
  });
});

describe("test mode (TRIAL_TEST_EMAILS): who is exempt from the one-free-file rule", () => {
  const dev = (list: string | undefined) => ({ TRIAL_TEST_EMAILS: list, NODE_ENV: "development" });

  it("is off unless the setting names someone", () => {
    for (const list of [undefined, "", "   ", ",,"]) expect(isTrialTester("jane@example.com", dev(list)), String(list)).toBe(false);
  });

  it("matches the listed person however the address is typed (case, +tag, spaces), and nobody else", () => {
    const env = dev("pojsl.jirka@email.cz");
    expect(isTrialTester(normalizeEmail("pojsl.jirka@email.cz")!.identity, env)).toBe(true);
    expect(isTrialTester(normalizeEmail("  Pojsl.Jirka+shop@Email.cz ")!.identity, env)).toBe(true);
    expect(isTrialTester(normalizeEmail("someone.else@email.cz")!.identity, env)).toBe(false);
    expect(isTrialTester(normalizeEmail("pojsl.jirka@other.cz")!.identity, env)).toBe(false);
  });

  it("takes a list, and a listed entry may itself carry capitals or a +tag", () => {
    const env = dev(" a@example.com , B+test@Example.com ");
    expect(isTrialTester("a@example.com", env)).toBe(true);
    expect(isTrialTester("b@example.com", env)).toBe(true);
    expect(isTrialTester("c@example.com", env)).toBe(false);
  });

  it('"*" means anyone (for testing from your own computer with any address)', () => {
    expect(isTrialTester("whoever@example.com", dev("*"))).toBe(true);
  });

  it("is IGNORED in production: an email is not verified, so a listed address must not unlock unlimited free files on the live site", () => {
    const env = { TRIAL_TEST_EMAILS: "jane@example.com,*", NODE_ENV: "production" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isTrialTester("jane@example.com", env)).toBe(false);
    expect(isTrialTester("anyone@example.com", env)).toBe(false);
  });

  it("says once, in production, that the setting is being ignored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const fresh = await import("./trial-service");
    const env = { TRIAL_TEST_EMAILS: "jane@example.com", NODE_ENV: "production" };
    fresh.isTrialTester("jane@example.com", env);
    fresh.isTrialTester("jane@example.com", env);
    expect(error.mock.calls.filter(([message]) => String(message).includes("TRIAL_TEST_EMAILS is set but ignored"))).toHaveLength(1);
  });
});

describe("grantTestTrial: a free file that is never refused and never used up", () => {
  const options = { unique: { free_trials: ["email_hash", "browser_id"] }, autoId: ["free_trials"] };
  const grant = (supabase: ReturnType<typeof createFakeSupabase>["client"], fingerprint = FP_A) => grantTestTrial(supabase, { identity: "jane@example.com", secret: SECRET, fingerprint });

  it("records a new trial every time, for the same person and the same file too", async () => {
    const { client, tables } = createFakeSupabase({}, options);
    const outcomes = [await grant(client), await grant(client), await grant(client, FP_B)];
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["granted", "granted", "granted"]);
    expect(tables.free_trials).toHaveLength(3);
    expect(tables.free_trials.map((row) => row.file_fingerprint)).toEqual([FP_A, FP_A, FP_B]);
  });

  it("gives each its own random id (marked 'test-', so the rows can be found and purged) that passes for a browser id", async () => {
    const { client, tables } = createFakeSupabase({}, options);
    await grant(client);
    await grant(client);
    const ids = tables.free_trials.map((row) => String(row.browser_id));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id.startsWith(TEST_BROWSER_PREFIX)).toBe(true);
      expect(isBrowserId(id)).toBe(true);
    }
    const hashes = tables.free_trials.map((row) => String(row.email_hash));
    expect(new Set(hashes).size).toBe(2);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not look at, change or use up the person's real trial, and is not blocked by it", async () => {
    const real = { id: "real-1", email_hash: hashEmailIdentity("jane@example.com", SECRET), browser_id: BROWSER_1, file_fingerprint: FP_A, created_at: "2026-10-01T00:00:00Z" };
    const { client, tables } = createFakeSupabase({ free_trials: [real] }, options);
    const outcome = await grant(client, FP_B);
    expect(outcome.status).toBe("granted");
    expect(tables.free_trials).toHaveLength(2);
    expect(tables.free_trials[0]).toEqual(real);
    expect((await claimTrial(client, { emailHash: real.email_hash, browserIds: [BROWSER_1], fingerprint: FP_B, marketingEmail: null })).status).toBe("not_eligible"); // the real rule is untouched
  });

  it("never stores a marketing address", async () => {
    const { client, tables } = createFakeSupabase({}, options);
    await grant(client);
    expect(tables.free_trials[0]).not.toHaveProperty("marketing_email");
    expect(tables.free_trials[0]).not.toHaveProperty("marketing_opt_in_at");
  });

  it("reports a database failure instead of pretending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase({}, { ...options, failOn: ({ op }) => (op === "insert" ? { code: "XX000", message: "down", details: null, hint: null } : null) });
    expect((await grant(client)).status).toBe("error");
  });
});
