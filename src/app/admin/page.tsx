import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ADMIN_COOKIE, adminConfigured, verifySessionValue } from "../utils/admin-auth";
import { loadAdminStats } from "../utils/admin-stats";
import { PRICE_LABEL } from "../utils/pricing";
import { getSupabaseAdmin } from "../utils/telemetry-db";
import { logoutAction } from "./actions";
import { LoginForm } from "./login-form";
import { RefundControl } from "./refund-control";

const shell = "mx-auto w-full max-w-6xl px-4 py-10 sm:px-6";
const number = (value: number) => value.toLocaleString("en-US");
const dateTime = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const bytes = (value: number) => (value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-2xl font-semibold tabular-nums text-neutral-50">{value}</p>
      <p className="mt-1 text-sm text-neutral-300">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

async function AdminContent() {
  await connection();   // everything below depends on the request (session, current time, live numbers)
  if (!adminConfigured()) {
    return (
      <div className={shell}>
        <h1 className="text-2xl font-semibold">Admin is switched off</h1>
        <p className="mt-3 text-sm text-neutral-400">Set the ADMIN_PASSWORD environment variable (at least 12 characters) and restart to enable it.</p>
      </div>
    );
  }

  const session = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionValue(session)) {
    return (
      <div className={shell}>
        <h1 className="text-center text-2xl font-semibold">Admin</h1>
        <LoginForm />
      </div>
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return (
      <div className={shell}>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-3 text-sm text-rose-300">The database is not configured (Supabase environment variables are missing).</p>
      </div>
    );
  }
  const stats = await loadAdminStats(supabase);
  const { uploads, usage, payments } = stats;

  return (
    <div className={`${shell} space-y-10`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-xs text-neutral-500">Generated {dateTime(stats.generatedAt)}. Reload for fresh numbers.</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100">Sign out</button>
        </form>
      </header>

      {stats.problems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold">Some numbers could not be loaded</p>
          <ul className="mt-1 list-disc pl-5 text-xs">{stats.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          <p className="mt-2 text-xs">If a column is missing, apply supabase/migrations/*_init.sql (see the README), or run `npm run db:check`.</p>
        </div>
      )}

      <section aria-labelledby="usage-heading" className="space-y-4">
        <h2 id="usage-heading" className="text-lg font-semibold">Usage</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Uploads, all time" value={number(uploads.total)} hint="real files, sample feed excluded" />
          <Stat label="Last 24 hours" value={number(uploads.last24h)} />
          <Stat label="Last 7 days" value={number(uploads.last7d)} />
          <Stat label="Last 30 days" value={number(uploads.last30d)} />
          <Stat label="Over the free limit" value={number(uploads.overFreeLimit)} hint="files that need the paid unlock" />
          <Stat label="Sample feed tries" value={number(uploads.sampleTries)} />
          <Stat label="Free first files" value={number(stats.trials.total)} hint={`${number(stats.trials.marketingOptIns)} ticked product updates`} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Average rows per file" value={number(usage.avgRows)} hint={`last ${number(usage.sampled)} uploads`} />
          <Stat label="Average fixes per file" value={number(usage.avgFixes)} />
          <Stat label="Average processing time" value={`${number(usage.avgProcessingMs)} ms`} />
          <Stat label="Average file size" value={bytes(usage.avgFileSizeBytes)} />
        </div>
      </section>

      <section aria-labelledby="payments-heading" className="space-y-4">
        <h2 id="payments-heading" className="text-lg font-semibold">Payments</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Checkouts started" value={number(payments.attempts)} />
          <Stat label="Paid" value={number(payments.paid)} hint={`${number(payments.paidLast30d)} in the last 30 days`} />
          <Stat label="Refunded or disputed" value={number(payments.refunded)} hint="no longer unlock anything" />
          <Stat label="Started to paid" value={payments.conversionPercent === null ? "-" : `${payments.conversionPercent}%`} />
          <Stat label={`Gross at ${PRICE_LABEL}`} value={`$${number(payments.grossUsd)}`} hint="before tax, fees and refunds" />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-neutral-800">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Most recent paid purchases</caption>
            <thead className="bg-neutral-900/70 text-xs uppercase tracking-wider text-neutral-500">
              <tr><th scope="col" className="px-4 py-3">Paid</th><th scope="col" className="px-4 py-3">Receipt email</th><th scope="col" className="px-4 py-3">Session</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {stats.recentPayments.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">No paid purchases yet.</td></tr>}
              {stats.recentPayments.map((payment) => (
                <tr key={payment.sessionId}>
                  <td className="px-4 py-2.5 text-neutral-300">{dateTime(payment.paidAt)}</td>
                  <td className="px-4 py-2.5 text-neutral-300">{payment.email}</td>
                  <td className="px-4 py-2.5 text-neutral-500">...{payment.sessionRef}</td>
                  <td className={`px-4 py-2.5 ${payment.refunded || payment.refundRequested ? "text-amber-300" : "text-neutral-400"}`} data-status={payment.refunded ? "refunded" : payment.refundRequested ? "refund-requested" : "paid"}>
                    {payment.refunded ? `refunded${payment.refundReason === "dispute" ? " (dispute)" : ""}` : payment.refundRequested ? "refund requested" : "paid"}
                  </td>
                  <td className="px-4 py-2.5">
                    {payment.refundable ? <RefundControl sessionId={payment.sessionId} email={payment.email} waiting={false} /> : payment.refundRequested ? <RefundControl sessionId={payment.sessionId} email={payment.email} waiting /> : <span className="text-xs text-neutral-600">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-4">
        <h2 id="recent-heading" className="text-lg font-semibold">Recent uploads</h2>
        <div className="overflow-x-auto rounded-2xl border border-neutral-800">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Most recent uploads: counts only, no file contents</caption>
            <thead className="bg-neutral-900/70 text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th scope="col" className="px-4 py-3">When</th><th scope="col" className="px-4 py-3">Rows</th><th scope="col" className="px-4 py-3">Size</th>
                <th scope="col" className="px-4 py-3">Fixes</th><th scope="col" className="px-4 py-3">Time</th><th scope="col" className="px-4 py-3">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {stats.recentUploads.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No uploads yet.</td></tr>}
              {stats.recentUploads.map((row) => (
                <tr key={row.created_at + row.total_rows}>
                  <td className="px-4 py-2.5 text-neutral-300">{dateTime(row.created_at)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-300">{number(row.total_rows)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-400">{bytes(row.file_size_bytes)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-400">{number(row.fix_count)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-400">{number(row.processing_time_ms)} ms</td>
                  <td className="px-4 py-2.5 text-neutral-400">{row.is_unlocked ? "yes" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AdminPage() {
  // Reading the session cookie is request-time data, so it has to sit inside a Suspense boundary (Cache Components).
  return (
    <Suspense fallback={<div className={shell}><p className="text-sm text-neutral-500">Loading&hellip;</p></div>}>
      <AdminContent />
    </Suspense>
  );
}
