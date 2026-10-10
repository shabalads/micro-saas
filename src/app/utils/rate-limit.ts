// src/app/utils/rate-limit.ts
//
// Sliding-window rate limiting for the public endpoints that cost something: /api/checkout creates Stripe sessions and
// database rows, /api/unlock answers "has this been paid?" for whatever session id or email it is given, and the admin
// login is guarded by a single password.
//
// Two backends, chosen by the environment:
//   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set: Upstash Redis (@upstash/ratelimit). The counters are shared by
//     every server instance, so the limit is exact on serverless platforms too.
//   - otherwise: counters in this server process's memory. On a single Node server (`next start`, a container, a VM)
//     that is exact. On serverless platforms every instance counts separately, so the effective limit is per instance:
//     still a brake on a script hammering one instance, not a global limit. In production this logs a warning once.
// If Upstash is configured but unreachable, the request is checked against the in-memory counters instead of failing, so
// a Redis outage never takes payments down.

import "server-only";
import { NextResponse } from "next/server";

export interface RateLimitRule {
  /** Requests allowed per client within the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** When blocked, how long until the oldest counted request leaves the window. */
  retryAfterSeconds: number;
}

/** Both variables are needed for Upstash; one alone means a half-finished setup, which counts as "not configured". */
export function upstashConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

/** Bounds memory when someone sprays requests with made-up client addresses. */
const MAX_TRACKED_CLIENTS = 10_000;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(readonly rule: RateLimitRule) {}

  /** Counts one request for `key` and says whether it is allowed. Blocked requests are not counted, so they do not extend the block. */
  check(key: string, now: number = Date.now()): RateLimitResult {
    this.sweep(now);
    const cutoff = now - this.rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff);

    if (recent.length >= this.rule.limit) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.rule.windowMs - now) / 1000)) };
    }
    recent.push(now);
    // Re-inserting moves the key to the end of the Map, so eviction below drops the least recently used client first.
    this.hits.delete(key);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.rule.limit - recent.length, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    if (this.hits.size < MAX_TRACKED_CLIENTS && now - this.lastSweep < this.rule.windowMs / 4) return;
    this.lastSweep = now;
    const cutoff = now - this.rule.windowMs;
    for (const [key, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) this.hits.delete(key);
    }
    for (const key of this.hits.keys()) {
      if (this.hits.size <= MAX_TRACKED_CLIENTS) break;
      this.hits.delete(key);
    }
  }
}

type RemoteLimit = (key: string) => Promise<{ success: boolean; remaining: number; reset: number }>;

let warnedInMemory = false;
let lastFallbackLog = 0;

/** The limiter the routes use: Upstash when configured, otherwise (or when Upstash fails) the in-memory window. */
export class RateLimiter {
  private readonly memory: SlidingWindowLimiter;
  private remote: Promise<RemoteLimit> | null = null;

  constructor(
    /** Part of the Redis key, so the limiters do not share counters. */
    readonly name: string,
    readonly rule: RateLimitRule,
  ) {
    this.memory = new SlidingWindowLimiter(rule);
  }

  async check(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    if (!upstashConfigured()) {
      if (process.env.NODE_ENV === "production" && !warnedInMemory) {
        warnedInMemory = true;
        console.warn(
          "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set: rate limits are counted in this server's memory. That is exact on one server, but per instance on serverless platforms. Set both to share the counters.",
        );
      }
      return this.memory.check(key, now);
    }

    try {
      const limit = await (this.remote ??= this.connect());
      const result = await limit(key);
      return {
        allowed: result.success,
        remaining: Math.max(0, result.remaining),
        retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      };
    } catch (error) {
      this.remote = null; // build a fresh connection next time
      if (Date.now() - lastFallbackLog > 60_000) {
        lastFallbackLog = Date.now();
        console.error("[rate-limit] Upstash is unreachable, using in-memory counters for now:", error instanceof Error ? error.message : error);
      }
      return this.memory.check(key, now);
    }
  }

  private async connect(): Promise<RemoteLimit> {
    // Loaded on demand, so the in-memory path never pays for (or depends on) the Upstash client.
    const [{ Ratelimit }, { Redis }] = await Promise.all([import("@upstash/ratelimit"), import("@upstash/redis")]);
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL as string, token: process.env.UPSTASH_REDIS_REST_TOKEN as string });
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(this.rule.limit, `${Math.max(1, Math.round(this.rule.windowMs / 1000))} s`),
      prefix: `ecommerce-sanitizer:${this.name}`,
      timeout: 2000, // a slow Redis must not stall a payment: past this the request is let through
      analytics: false,
    });
    return (key) => ratelimit.limit(key);
  }
}

/**
 * Identifies the client from the proxy headers. The app must run behind a proxy or platform that sets them (Vercel,
 * Cloudflare, nginx, a load balancer): the address is taken from the end of x-forwarded-for, i.e. the entry added by
 * your own proxy, never from the start, which the client controls. If more than one proxy of yours sits in front of
 * the app, set TRUSTED_PROXY_HOPS to that number. Without any proxy header every caller shares the "unknown" bucket.
 */
export function clientKey(request: Request, env: Record<string, string | undefined> = process.env): string {
  const hops = Math.max(1, Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (entries.length > 0) return entries[Math.max(0, entries.length - hops)].slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : "unknown";
}

export function tooManyRequests(result: RateLimitResult, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status: 429,
    headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" },
  });
}

const TEN_MINUTES = 10 * 60 * 1000;

/** Starting a checkout creates a Stripe session and database rows. A real customer clicks once or twice. */
export const checkoutLimiter = new RateLimiter("checkout", { limit: 10, windowMs: TEN_MINUTES });
/** Asking whether something is paid. A real visit needs a handful (the return page polls while Stripe confirms). */
export const unlockLimiter = new RateLimiter("unlock", { limit: 30, windowMs: TEN_MINUTES });
/** Email lookups can be used to probe which addresses have paid, so they get a much tighter budget. */
export const unlockEmailLimiter = new RateLimiter("unlock-email", { limit: 8, windowMs: TEN_MINUTES });
/** One check per export, plus retries. */
export const verifyLimiter = new RateLimiter("verify", { limit: 60, windowMs: TEN_MINUTES });

/** Asking for the free first big file (and asking again for the same file). Every attempt counts, so guessing is slow. */
export const trialLimiter = new RateLimiter("trial", { limit: 10, windowMs: TEN_MINUTES });
/** NEW free trials a network address may start per day. The email is not verified, so this is what keeps one person from minting many. */
export const trialGrantLimiter = new RateLimiter("trial-grant", { limit: 5, windowMs: 24 * 60 * 60 * 1000 });

/** Admin refunds: each one moves money. */
export const adminRefundLimiter = new RateLimiter("admin-refund", { limit: 20, windowMs: TEN_MINUTES });

/** Admin sign-in attempts. The password is the only thing protecting the admin area, so guessing must be slow. */
export const adminLoginLimiter = new RateLimiter("admin-login", { limit: 5, windowMs: TEN_MINUTES });
