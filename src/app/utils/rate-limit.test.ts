import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter, clientKey, tooManyRequests } from "./rate-limit";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { headers });

describe("SlidingWindowLimiter", () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit, then blocks, and says how long to wait", () => {
    const limiter = new SlidingWindowLimiter(rule);
    expect([0, 1000, 2000].map((t) => limiter.check("a", t).allowed)).toEqual([true, true, true]);
    const blocked = limiter.check("a", 3000);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBe(57); // the first request leaves the window at t=60s
  });

  it("reports how many requests are left", () => {
    const limiter = new SlidingWindowLimiter(rule);
    expect(limiter.check("a", 0).remaining).toBe(2);
    expect(limiter.check("a", 1).remaining).toBe(1);
    expect(limiter.check("a", 2).remaining).toBe(0);
  });

  it("slides: capacity comes back one request at a time as old ones age out", () => {
    const limiter = new SlidingWindowLimiter(rule);
    limiter.check("a", 0); limiter.check("a", 10_000); limiter.check("a", 20_000);
    expect(limiter.check("a", 59_999).allowed).toBe(false);
    expect(limiter.check("a", 60_001).allowed).toBe(true);   // the t=0 request has left
    expect(limiter.check("a", 60_002).allowed).toBe(false);  // t=10s and t=20s are still inside, plus the new one
    expect(limiter.check("a", 70_002).allowed).toBe(true);
  });

  it("does not extend the block when blocked requests keep coming", () => {
    const limiter = new SlidingWindowLimiter(rule);
    limiter.check("a", 0); limiter.check("a", 1); limiter.check("a", 2);
    for (let t = 1000; t < 59_000; t += 1000) expect(limiter.check("a", t).allowed).toBe(false);
    expect(limiter.check("a", 60_001).allowed).toBe(true);
  });

  it("counts each client separately", () => {
    const limiter = new SlidingWindowLimiter(rule);
    for (let i = 0; i < 3; i++) limiter.check("a", i);
    expect(limiter.check("a", 5).allowed).toBe(false);
    expect(limiter.check("b", 5).allowed).toBe(true);
  });

  it("forgets idle clients so memory stays bounded", () => {
    const limiter = new SlidingWindowLimiter(rule);
    for (let i = 0; i < 500; i++) limiter.check(`client-${i}`, 0);
    limiter.check("later", 10 * 60_000); // far past the window: triggers a sweep
    expect((limiter as unknown as { hits: Map<string, number[]> }).hits.size).toBe(1);
  });
});

describe("clientKey (which address a request is counted against)", () => {
  it("is 'unknown' without proxy headers (everyone shares one bucket, e.g. local development)", () => {
    expect(clientKey(req(), {})).toBe("unknown");
  });

  it("uses the single x-forwarded-for entry that a platform like Vercel sets", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.7" }), {})).toBe("203.0.113.7");
  });

  it("takes the entry added by our own proxy (the LAST one), so a client cannot dodge the limit by forging the first", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }), {})).toBe("203.0.113.7");
    expect(clientKey(req({ "x-forwarded-for": "9.9.9.9" }), {})).toBe("9.9.9.9");
  });

  it("honours TRUSTED_PROXY_HOPS when several of our own proxies sit in front", () => {
    const headers = { "x-forwarded-for": "198.51.100.5, 203.0.113.7, 10.0.0.2" };
    expect(clientKey(req(headers), { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.7");
    expect(clientKey(req(headers), { TRUSTED_PROXY_HOPS: "3" })).toBe("198.51.100.5");
    expect(clientKey(req(headers), { TRUSTED_PROXY_HOPS: "9" })).toBe("198.51.100.5");
    expect(clientKey(req(headers), { TRUSTED_PROXY_HOPS: "nonsense" })).toBe("10.0.0.2");
    expect(clientKey(req(headers), { TRUSTED_PROXY_HOPS: "0" })).toBe("10.0.0.2");
  });

  it("falls back to x-real-ip, trims whitespace and caps the length", () => {
    expect(clientKey(req({ "x-real-ip": " 192.0.2.1 " }), {})).toBe("192.0.2.1");
    expect(clientKey(req({ "x-forwarded-for": " , " }), {})).toBe("unknown");
    expect(clientKey(req({ "x-forwarded-for": "x".repeat(500) }), {}).length).toBe(64);
  });
});

describe("tooManyRequests", () => {
  it("answers 429 with a Retry-After header and the given body, uncached", async () => {
    const response = tooManyRequests({ allowed: false, remaining: 0, retryAfterSeconds: 42 }, { error: "slow down" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "slow down" });
  });
});
