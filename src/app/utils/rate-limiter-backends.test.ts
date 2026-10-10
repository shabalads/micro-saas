import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  construct: vi.fn(),
  redis: vi.fn(),
  slidingWindow: vi.fn((count: number, window: string) => ({ count, window })),
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = mocks.slidingWindow;
    constructor(options: unknown) { mocks.construct(options); }
    limit = mocks.limit;
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(options: unknown) { mocks.redis(options); }
  },
}));

const RULE = { limit: 2, windowMs: 10 * 60 * 1000 };
const loadModule = async () => {
  vi.resetModules();
  return import("./rate-limit");
};

describe("RateLimiter without Upstash (in-memory)", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.limit.mockReset();
    mocks.construct.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("limits per client in memory and never touches Upstash", async () => {
    const { RateLimiter } = await loadModule();
    const limiter = new RateLimiter("test", RULE);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect(await limiter.check("a")).toMatchObject({ allowed: false, remaining: 0 });
    expect((await limiter.check("b")).allowed).toBe(true);
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it("warns once in production that the counters are per server instance, and not at all in development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    let { RateLimiter } = await loadModule();
    await new RateLimiter("test", RULE).check("a");
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    ({ RateLimiter } = await loadModule());
    const limiter = new RateLimiter("test", RULE);
    await limiter.check("a");
    await limiter.check("b");
    await new RateLimiter("other", RULE).check("a");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/UPSTASH_REDIS_REST_URL.*in this server's memory/);
  });

  it("treats a half-finished Upstash setup (only the URL) as not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    const { RateLimiter, upstashConfigured } = await loadModule();
    expect(upstashConfigured()).toBe(false);
    await new RateLimiter("test", RULE).check("a");
    expect(mocks.construct).not.toHaveBeenCalled();
  });
});

describe("RateLimiter with Upstash", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://unit-test.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "unit-test-token");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.limit.mockReset();
    mocks.construct.mockReset();
    mocks.redis.mockReset();
    mocks.slidingWindow.mockClear();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("counts in Redis with this limiter's own prefix and a sliding window of the same size as the rule", async () => {
    mocks.limit.mockResolvedValue({ success: true, remaining: 1, reset: Date.now() + 600_000 });
    const { RateLimiter, upstashConfigured } = await loadModule();
    expect(upstashConfigured()).toBe(true);
    const result = await new RateLimiter("checkout", RULE).check("203.0.113.9");

    expect(result).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    expect(mocks.redis).toHaveBeenCalledWith({ url: "https://unit-test.upstash.io", token: "unit-test-token" });
    expect(mocks.slidingWindow).toHaveBeenCalledWith(2, "600 s");
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({ prefix: "ecommerce-sanitizer:checkout", analytics: false, limiter: { count: 2, window: "600 s" } }));
    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.9");
  });

  it("does not warn about in-memory counters when Upstash is configured", async () => {
    mocks.limit.mockResolvedValue({ success: true, remaining: 1, reset: Date.now() + 1000 });
    const { RateLimiter } = await loadModule();
    await new RateLimiter("x", RULE).check("a");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("blocks when Upstash says so, and turns its reset time into Retry-After seconds", async () => {
    mocks.limit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 90_000 });
    const { RateLimiter } = await loadModule();
    const result = await new RateLimiter("x", RULE).check("a");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(89);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(90);
  });

  it("connects once per limiter, not once per request", async () => {
    mocks.limit.mockResolvedValue({ success: true, remaining: 1, reset: Date.now() + 1000 });
    const { RateLimiter } = await loadModule();
    const limiter = new RateLimiter("x", RULE);
    await limiter.check("a");
    await limiter.check("b");
    await limiter.check("c");
    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.limit).toHaveBeenCalledTimes(3);
  });

  it("falls back to in-memory counters when Upstash fails, so a Redis outage never blocks or unthrottles checkout", async () => {
    mocks.limit.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const { RateLimiter } = await loadModule();
    const limiter = new RateLimiter("x", RULE);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false); // still limited, by this instance
    expect(console.error).toHaveBeenCalledTimes(1);          // logged once, not per request
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(/Upstash is unreachable/);
  });

  it("goes back to Upstash once it recovers", async () => {
    mocks.limit.mockRejectedValueOnce(new Error("blip")).mockResolvedValue({ success: true, remaining: 1, reset: Date.now() + 1000 });
    const { RateLimiter } = await loadModule();
    const limiter = new RateLimiter("x", RULE);
    await limiter.check("a");
    mocks.limit.mockClear();
    await limiter.check("a");
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("gives each route its own prefix, so one route's traffic never uses up another's budget", async () => {
    mocks.limit.mockResolvedValue({ success: true, remaining: 1, reset: Date.now() + 1000 });
    const limiters = await loadModule();
    await limiters.checkoutLimiter.check("a");
    await limiters.unlockLimiter.check("a");
    await limiters.unlockEmailLimiter.check("a");
    await limiters.verifyLimiter.check("a");
    await limiters.adminLoginLimiter.check("a");
    const prefixes = mocks.construct.mock.calls.map((call) => (call[0] as { prefix: string }).prefix).sort();
    expect(prefixes).toEqual(["ecommerce-sanitizer:admin-login", "ecommerce-sanitizer:checkout", "ecommerce-sanitizer:unlock", "ecommerce-sanitizer:unlock-email", "ecommerce-sanitizer:verify"]);
    expect(new Set(prefixes).size).toBe(5);
  });
});
