import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../test/fake-supabase";
import { loadAdminStats, maskEmail, summarizeUsage } from "./admin-stats";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();
const upload = (hoursAgo: number, rows: number, extra: Record<string, unknown> = {}) => ({
  file_name_anonymized: "a1b2c3.csv", total_rows: rows, processing_time_ms: 10, fix_count: rows * 2, file_size_bytes: rows * 100, is_unlocked: false, created_at: ago(hoursAgo), ...extra,
});

const seed = () => ({
  usage_telemetry: [
    upload(1, 30),                                  // real, free
    upload(5, 120, { is_unlocked: true }),          // real, over the limit, paid
    upload(30, 60),                                 // real, over the limit, 30h ago
    upload(24 * 10, 80),                            // real, 10 days ago
    upload(24 * 40, 20),                            // real, 40 days ago
    upload(2, 8, { file_name_anonymized: "sample-supplier-feed.csv" }),  // landing-page sample
    upload(3, 60, { file_name_anonymized: "checkout" }),                  // created by checkout, not an upload
  ],
  payment_intents: [
    { stripe_session_id: "cs_test_paid0001", email: "Jane.Doe@Example.com", paid_at: ago(5), clicked_at: ago(6), stripe_payment_intent_id: "pi_test_0001" },
    { stripe_session_id: "cs_test_paid0002", email: "buyer@shop.test", paid_at: ago(24 * 45), clicked_at: ago(24 * 45), refunded_at: ago(24 * 44) },
    { stripe_session_id: "cs_test_paid0005", email: "wait@shop.test", paid_at: ago(3), clicked_at: ago(4), stripe_payment_intent_id: "pi_test_0005", refund_requested_at: ago(1) },
    { stripe_session_id: "cs_test_paid0006", email: "old@shop.test", paid_at: ago(2), clicked_at: ago(3) },
    { stripe_session_id: "cs_test_open0003", email: null, paid_at: null, clicked_at: ago(2) },
    { stripe_session_id: "cs_test_open0004", email: null, paid_at: null, clicked_at: ago(26) },
  ],
});

describe("loadAdminStats", () => {
  it("counts real uploads over time, leaving out the sample feed and checkout rows", async () => {
    const { client } = createFakeSupabase(seed());
    const stats = await loadAdminStats(client, NOW);
    // of the real uploads (30, 120, 60, 80 and 20 rows) only the 120-row one is over the free limit of 100
    expect(stats.uploads).toEqual({ total: 5, last24h: 2, last7d: 3, last30d: 4, sampleTries: 1, overFreeLimit: 1 });
    expect(stats.problems).toEqual([]);
  });

  it("averages the real uploads only", async () => {
    const { client } = createFakeSupabase(seed());
    const { usage } = await loadAdminStats(client, NOW);
    expect(usage).toEqual({ sampled: 5, avgRows: 62, avgProcessingMs: 10, avgFixes: 124, avgFileSizeBytes: 6200 });
  });

  it("counts payments: attempts, paid, recent paid, conversion and gross revenue at the price", async () => {
    const { client } = createFakeSupabase(seed());
    const { payments } = await loadAdminStats(client, NOW);
    expect(payments).toEqual({ attempts: 6, paid: 4, paidLast30d: 3, refunded: 1, conversionPercent: 66.7, grossUsd: 36 });
  });

  it("lists recent paid purchases newest first with the email masked, only a session reference for display and the full id for the Refund button", async () => {
    const { client } = createFakeSupabase(seed());
    const { recentPayments } = await loadAdminStats(client, NOW);
    expect(recentPayments.map((payment) => [payment.sessionRef, payment.email])).toEqual([
      ["paid0006", "o***@shop.test"],
      ["paid0005", "w***@shop.test"],
      ["paid0001", "J***@Example.com"],
      ["paid0002", "b***@shop.test"],
    ]);
    expect(recentPayments[2]).toMatchObject({ sessionId: "cs_test_paid0001", paidAt: ago(5) });
    expect(JSON.stringify(recentPayments)).not.toMatch(/Jane\.Doe|buyer@|wait@|old@/);
  });

  it("says which purchases can be refunded: paid, not refunded, not already requested, and with a known Stripe payment", async () => {
    const { client } = createFakeSupabase(seed());
    const { recentPayments } = await loadAdminStats(client, NOW);
    const byRef = Object.fromEntries(recentPayments.map((payment) => [payment.sessionRef, payment]));
    expect(byRef.paid0001).toMatchObject({ refundable: true, refunded: false, refundRequested: false });
    expect(byRef.paid0005).toMatchObject({ refundable: false, refundRequested: true, refunded: false });   // waiting for the webhook
    expect(byRef.paid0006).toMatchObject({ refundable: false });                                           // no payment intent on record
    expect(byRef.paid0002).toMatchObject({ refundable: false, refunded: true, refundRequested: false });   // the webhook has confirmed it
  });

  it("counts the free first files and how many people ticked the optional product-updates box", async () => {
    const { client } = createFakeSupabase({
      ...seed(),
      free_trials: [
        { id: "a", email_hash: "h1", browser_id: "b1", file_fingerprint: "f", marketing_opt_in_at: ago(1) },
        { id: "b", email_hash: "h2", browser_id: "b2", file_fingerprint: "f", marketing_opt_in_at: null },
        { id: "c", email_hash: "h3", browser_id: "b3", file_fingerprint: "f" },
      ],
    });
    expect((await loadAdminStats(client, NOW)).trials).toEqual({ total: 3, marketingOptIns: 1 });
  });

  it("shows recent uploads newest first, with numbers only (no file names or contents)", async () => {
    const { client } = createFakeSupabase(seed());
    const { recentUploads } = await loadAdminStats(client, NOW);
    expect(recentUploads.map((row) => row.total_rows)).toEqual([30, 120, 60, 80, 20]);
    expect(Object.keys(recentUploads[0]).sort()).toEqual(["created_at", "file_size_bytes", "fix_count", "is_unlocked", "processing_time_ms", "total_rows"]);
  });

  it("handles an empty database without dividing by zero", async () => {
    const { client } = createFakeSupabase({ usage_telemetry: [], payment_intents: [] });
    const stats = await loadAdminStats(client, NOW);
    expect(stats.payments.conversionPercent).toBeNull();
    expect(stats.usage).toEqual({ sampled: 0, avgRows: 0, avgProcessingMs: 0, avgFixes: 0, avgFileSizeBytes: 0 });
    expect(stats.recentPayments).toEqual([]);
  });

  it("reports what failed instead of silently showing zeros", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase(seed(), { failOn: ({ table }) => (table === "payment_intents" ? { code: "42703", message: "column payment_intents.paid_at does not exist", details: null, hint: null } : null) });
    const stats = await loadAdminStats(client, NOW);
    expect(stats.problems.length).toBeGreaterThan(0);
    expect(stats.problems.join(" ")).toMatch(/paid_at does not exist/);
    expect(stats.uploads.total).toBe(5);   // the usage side still loads
  });
});

describe("loadAdminStats: count requests without a message", () => {
  it("still tells the operator what is probably wrong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase(seed(), { failOn: ({ table }) => (table === "payment_intents" ? { code: "", message: "", details: null, hint: null } : null) });
    const stats = await loadAdminStats(client, NOW);
    expect(stats.problems.some((problem) => /^checkout attempts: the query failed/.test(problem))).toBe(true);
    expect(stats.problems.every((problem) => !/:\s*$/.test(problem))).toBe(true);
  });
});

describe("maskEmail", () => {
  it.each([
    ["jane.doe@example.com", "j***@example.com"],
    ["A@b.co", "A***@b.co"],
    [null, "-"],
    ["", "-"],
    ["no-at-sign", "***"],
    ["@nolocal.com", "***"],
  ])("%s -> %s", (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe("summarizeUsage", () => {
  it("rounds averages", () => {
    expect(summarizeUsage([upload(1, 1), upload(1, 2)] as never).avgRows).toBe(2);
  });
});
