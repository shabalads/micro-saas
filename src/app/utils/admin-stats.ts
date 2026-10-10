// src/app/utils/admin-stats.ts
//
// The numbers on /admin: how much the tool is used (usage_telemetry) and what has been paid (payment_intents).
// Counts come from the database; averages are computed from the most recent AGGREGATE_ROWS uploads, which keeps the
// page fast however large the table grows. Only counts, timings and masked emails are shown, never file contents.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_ROW_LIMIT, PRICE_USD } from "./pricing";
import { PAYMENT_INTENTS_TABLE, TELEMETRY_TABLE, logSupabaseError } from "./telemetry-db";
import { TRIALS_TABLE } from "./trial-service";

/** Telemetry rows that are not real uploads: the landing-page sample, and rows created by checkout. */
const NON_UPLOADS = ["sample-supplier-feed.csv", "checkout", "lead-capture"];
const SAMPLE_FILE = "sample-supplier-feed.csv";
export const AGGREGATE_ROWS = 2000;
const RECENT_LIMIT = 15;
const DAY = 24 * 60 * 60 * 1000;

export interface UsageRow {
  created_at: string;
  total_rows: number;
  processing_time_ms: number;
  fix_count: number;
  file_size_bytes: number;
  is_unlocked: boolean | null;
}

export interface UsageSummary {
  sampled: number;
  avgRows: number;
  avgProcessingMs: number;
  avgFixes: number;
  avgFileSizeBytes: number;
}

export interface AdminStats {
  generatedAt: string;
  uploads: { total: number; last24h: number; last7d: number; last30d: number; sampleTries: number; overFreeLimit: number };
  usage: UsageSummary;
  payments: { attempts: number; paid: number; paidLast30d: number; /** paid purchases that were refunded in full or disputed */ refunded: number; /** paid / attempts, as a percentage */ conversionPercent: number | null; /** paid x price: before tax, refunds and fees */ grossUsd: number };
  /** Free first big files given out, and how many of those people ticked the optional product-updates box. */
  trials: { total: number; marketingOptIns: number };
  recentUploads: UsageRow[];
  recentPayments: AdminPayment[];
  /** Things that went wrong while loading, shown so a half-empty page is not mistaken for "no activity". */
  problems: string[];
}

export interface AdminPayment {
  paidAt: string;
  email: string;
  /** Last characters of the Stripe session id, for showing. */
  sessionRef: string;
  /** The full Checkout Session id: what the Refund button sends back. Only ever rendered on this (signed-in) page. */
  sessionId: string;
  /** Set by the webhook (full refund or dispute). The only thing that makes a purchase "refunded". */
  refunded: boolean;
  refundReason: string | null;
  /** An admin pressed Refund and Stripe accepted it, but the charge.refunded webhook has not arrived yet. */
  refundRequested: boolean;
  /** Paid, not refunded, not already requested, and its PaymentIntent is known: the Refund button is offered. */
  refundable: boolean;
}

/** j***@example.com. Enough to recognise a customer, not enough to leak the address from a screenshot. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "-";
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.charAt(0)}***${email.slice(at)}`;
}

const average = (values: number[]): number => (values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  return {
    sampled: rows.length,
    avgRows: average(rows.map((row) => row.total_rows)),
    avgProcessingMs: average(rows.map((row) => row.processing_time_ms)),
    avgFixes: average(rows.map((row) => row.fix_count)),
    avgFileSizeBytes: average(rows.map((row) => row.file_size_bytes)),
  };
}

type CountResult = { count: number | null; error: { message: string } | null };

/** A count (HEAD) request has no response body, so Supabase gives no message for it: say what is probably wrong instead. */
function describeError(error: { message?: string }): string {
  return error.message || "the query failed (a table or column from supabase/migrations is probably missing; run `npm run db:check`)";
}

export async function loadAdminStats(supabase: SupabaseClient, now: number = Date.now()): Promise<AdminStats> {
  const problems: string[] = [];
  const since = (days: number) => new Date(now - days * DAY).toISOString();
  const realUploads = () => supabase.from(TELEMETRY_TABLE).select("*", { count: "exact", head: true }).not("file_name_anonymized", "in", `(${NON_UPLOADS.join(",")})`);
  const payments = () => supabase.from(PAYMENT_INTENTS_TABLE).select("*", { count: "exact", head: true });

  const counted = async (label: string, query: PromiseLike<CountResult>): Promise<number> => {
    const { count, error } = await query;
    if (error) {
      logSupabaseError(`admin ${label}`, error);
      problems.push(`${label}: ${describeError(error)}`);
    }
    return count ?? 0;
  };

  const [total, last24h, last7d, last30d, sampleTries, overFreeLimit, attempts, paid, paidLast30d, refunded, trialsTotal, marketingOptIns] = await Promise.all([
    counted("uploads", realUploads()),
    counted("uploads (24h)", realUploads().gte("created_at", since(1))),
    counted("uploads (7d)", realUploads().gte("created_at", since(7))),
    counted("uploads (30d)", realUploads().gte("created_at", since(30))),
    counted("sample tries", supabase.from(TELEMETRY_TABLE).select("*", { count: "exact", head: true }).eq("file_name_anonymized", SAMPLE_FILE)),
    counted("uploads over the free limit", realUploads().gt("total_rows", FREE_ROW_LIMIT)),
    counted("checkout attempts", payments()),
    counted("paid", payments().not("paid_at", "is", null)),
    counted("paid (30d)", payments().not("paid_at", "is", null).gte("paid_at", since(30))),
    counted("refunded", payments().not("refunded_at", "is", null)),
    counted("free trials", supabase.from(TRIALS_TABLE).select("*", { count: "exact", head: true })),
    counted("free trials with product updates", supabase.from(TRIALS_TABLE).select("*", { count: "exact", head: true }).not("marketing_opt_in_at", "is", null)),
  ]);

  const { data: usageRows, error: usageError } = await supabase
    .from(TELEMETRY_TABLE)
    .select("created_at, total_rows, processing_time_ms, fix_count, file_size_bytes, is_unlocked")
    .not("file_name_anonymized", "in", `(${NON_UPLOADS.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(AGGREGATE_ROWS);
  if (usageError) {
    logSupabaseError("admin usage rows", usageError);
    problems.push(`usage rows: ${describeError(usageError)}`);
  }
  const usage = (usageRows ?? []) as UsageRow[];

  const { data: paymentRows, error: paymentError } = await supabase
    .from(PAYMENT_INTENTS_TABLE)
    .select("paid_at, email, stripe_session_id, stripe_payment_intent_id, refunded_at, refund_reason, refund_requested_at")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (paymentError) {
    logSupabaseError("admin payment rows", paymentError);
    problems.push(`payment rows: ${describeError(paymentError)}`);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    uploads: { total, last24h, last7d, last30d, sampleTries, overFreeLimit },
    trials: { total: trialsTotal, marketingOptIns },
    usage: summarizeUsage(usage),
    payments: {
      attempts,
      paid,
      paidLast30d,
      refunded,
      conversionPercent: attempts > 0 ? Math.round((paid / attempts) * 1000) / 10 : null,
      grossUsd: paid * PRICE_USD,
    },
    recentUploads: usage.slice(0, RECENT_LIMIT),
    recentPayments: ((paymentRows ?? []) as Array<{
      paid_at: string;
      email: string | null;
      stripe_session_id: string;
      stripe_payment_intent_id: string | null;
      refunded_at: string | null;
      refund_reason: string | null;
      refund_requested_at: string | null;
    }>).map((row): AdminPayment => {
      const refunded = row.refunded_at !== null && row.refunded_at !== undefined;
      const refundRequested = !refunded && row.refund_requested_at !== null && row.refund_requested_at !== undefined;
      return {
        paidAt: row.paid_at,
        email: maskEmail(row.email),
        sessionRef: row.stripe_session_id.slice(-8),
        sessionId: row.stripe_session_id,
        refunded,
        refundReason: row.refund_reason ?? null,
        refundRequested,
        refundable: !refunded && !refundRequested && typeof row.stripe_payment_intent_id === "string" && row.stripe_payment_intent_id !== "",
      };
    }),
    problems,
  };
}
