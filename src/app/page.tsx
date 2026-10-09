// src/app/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { verifyCheckout } from "./actions/checkout";
import { logUsageTelemetry } from "./actions/telemetry";
import CsvUploader, { SAMPLE_FILE_NAME } from "./components/csv-uploader";
import DataPreview from "./components/data-preview";
import type { CleanedShopifyRow, CsvState, RawSupplierRow } from "./types/csv";
import type { VerifyCheckoutResult } from "./types/telemetry";
import { anonymizeFileName } from "./utils/anonymize";
import { PARKED_MAX_AGE_MS, deleteJob, listParkedJobs, loadJob, saveJob } from "./utils/job-store";
import { buildOutputFileName, sanitizeDataset, toShopifyCsv } from "./utils/sanitizer";

/* -------------------------------------------------------------------------- */
/*  State & constants                                                          */
/* -------------------------------------------------------------------------- */

/** Keeps the loading state from flashing on screen when a small file is cleaned in a few milliseconds. */
const MIN_LOADING_MS = 900;
const DOWNLOAD_FEEDBACK_MS = 2600;
/** Files with more products than this need the one-time $9 unlock; smaller files download for free. */
const FREE_ROW_LIMIT = 50;
/** The webhook can lag behind the redirect, so the return page asks a few times before giving up. */
const VERIFY_RETRY_LIMIT = 8;
const VERIFY_RETRY_MS = 2000;
/** How many parked files recovery will ask the server about on one visit. */
const RECOVERY_CHECK_LIMIT = 5;

const INITIAL_STATE: CsvState = {
  loading: false,
  error: null,
  rawData: [],
  cleanedData: [],
  fileName: null,
  warnings: [],
  report: null,
};

type PaymentNotice =
  | { phase: "verifying" }
  | { phase: "confirmed" }
  /** A file paid for on an earlier visit (the tab was closed before Stripe redirected back) was handed back. */
  | { phase: "recovered" }
  | { phase: "canceled" }
  | { phase: "failed"; message: string };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds the Shopify CSV from cleaned rows and hands it to the browser as a file download. */
function downloadCsv(rows: CleanedShopifyRow[], fileName: string | null): void {
  const csv = toShopifyCsv(rows);
  // The BOM makes Excel open accented characters correctly; Shopify's importer accepts it.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = buildOutputFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* -------------------------------------------------------------------------- */
/*  Presentational pieces                                                      */
/* -------------------------------------------------------------------------- */

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-neutral-950 shadow-lg shadow-emerald-500/20">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <path d="m5 12 4.5 4.5L19 7" />
        </svg>
      </div>
      <span className="text-base font-semibold tracking-tight text-neutral-50">
        Shopify CSV <span className="text-emerald-400">Sanitizer</span>
      </span>
    </div>
  );
}

function Hero() {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-medium text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Built for Shopify merchants who import supplier feeds
      </p>
      <h1 className="text-balance text-4xl font-semibold tracking-tight text-neutral-50 sm:text-6xl">
        Stop fixing supplier CSVs <span className="bg-gradient-to-r from-emerald-300 to-emerald-500 bg-clip-text text-transparent">by hand.</span>
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-neutral-400 sm:text-lg">
        Drop in the messy file your supplier sent. In seconds you get ALL CAPS titles fixed, legacy HTML stripped,
        clean handles generated and clumped images split into Shopify-ready rows.
      </p>
    </div>
  );
}

function FeatureGrid() {
  const features: Array<{ title: string; before: string; after: string }> = [
    { title: "Professional titles", before: "  BLUE   T-SHIRT 123 ", after: "Blue T-Shirt 123" },
    { title: "Clean descriptions", before: '<div style="..."><font>Soft tee</font></div>', after: "<p>Soft tee</p>" },
    { title: "URL-safe handles", before: "BLUE T-SHIRT 123", after: "blue-t-shirt-123" },
    { title: "Split image rows", before: "img1.jpg|img2.jpg|img3.jpg", after: "3 Shopify image rows" },
  ];
  return (
    <ul className="mx-auto mt-16 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((feature) => (
        <li key={feature.title} className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="mb-3 text-sm font-semibold text-neutral-100">{feature.title}</p>
          <p className="truncate rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 font-mono text-xs text-rose-200" title={feature.before}>
            {feature.before}
          </p>
          <p className="py-1 text-center text-neutral-600" aria-hidden="true">&darr;</p>
          <p className="truncate rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-xs text-emerald-200" title={feature.after}>
            {feature.after}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 50 50" className="h-4 w-4 animate-spin" aria-hidden="true">
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="6" />
      <path d="M25 5a20 20 0 0 1 20 20" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function Banner({
  tone,
  title,
  onDismiss,
  children,
}: {
  tone: "error" | "warning" | "success";
  title: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const styles = {
    error: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`animate-fade-up rounded-2xl border px-4 py-3 text-sm motion-reduce:animate-none ${styles}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{title}</p>
          <div className="mt-1 space-y-1 opacity-90">{children}</div>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium opacity-80 transition hover:bg-white/10 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="status" aria-live="polite" className="mx-auto flex max-w-2xl animate-fade-up flex-col items-center rounded-3xl border border-neutral-800 bg-neutral-900/50 px-6 py-20 text-center motion-reduce:animate-none">
      <div className="relative mb-8 h-20 w-20">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-emerald-400/30 motion-reduce:animate-none" />
        <svg viewBox="0 0 50 50" className="relative h-20 w-20 animate-spin text-emerald-400" aria-hidden="true">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="4" />
          <path d="M25 5a20 20 0 0 1 20 20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-xl font-semibold tracking-tight text-neutral-50">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-neutral-400">{detail}</p>
      <div className="mt-8 w-full max-w-sm space-y-2.5" aria-hidden="true">
        <div className="h-2.5 animate-pulse rounded-full bg-neutral-800" />
        <div className="h-2.5 w-5/6 animate-pulse rounded-full bg-neutral-800 [animation-delay:150ms]" />
        <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-neutral-800 [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function HomePage() {
  const [state, setState] = useState<CsvState>(INITIAL_STATE);
  const [justDownloaded, setJustDownloaded] = useState(false);
  /** Id of this file's usage_telemetry row. It is the job id that Stripe Checkout and the return URL carry. */
  const [telemetryId, setTelemetryId] = useState<string | null>(null);
  /** True once Stripe has confirmed payment for the file on screen. */
  const [unlocked, setUnlocked] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  /** What happened when the customer came back from Stripe, if they did. */
  const [payment, setPayment] = useState<PaymentNotice | null>(null);
  const runId = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnHandled = useRef(false);
  const recoveryStarted = useRef(false);
  /** Synchronous guard against a double click creating two Stripe sessions (state updates land a render later). */
  const checkoutInFlight = useRef(false);

  const { loading, error, report } = state;
  const isDashboard = !loading && report !== null && state.cleanedData.length > 0;
  const isGated = report !== null && report.productCount > FREE_ROW_LIMIT && !unlocked;
  const isVerifying = payment?.phase === "verifying";

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  // Pressing Back on the Stripe page can restore this page from the browser cache still "redirecting".
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        checkoutInFlight.current = false;
        setIsRedirecting(false);
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // Stripe sends the customer back to "/?session_id=...&job_id=..." after paying, or to
  // "/?checkout=canceled&job_id=..." if they backed out. The page was fully reloaded, so the cleaned file
  // has to come back from the copy parked in IndexedDB before the redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job_id");
    const sessionId = params.get("session_id");
    const canceled = params.get("checkout") === "canceled";
    if (!jobId || returnHandled.current || (!sessionId && !canceled)) return;
    returnHandled.current = true;

    const clearUrl = () => window.history.replaceState(null, "", window.location.pathname);

    const returnCanceled = async () => {
      clearUrl();
      const job = await loadJob(jobId).catch(() => null);
      if (!job) return;
      setState({ ...job.state, loading: false, error: null });
      setTelemetryId(jobId);
      setPayment({ phase: "canceled" });
    };

    const returnPaid = async (paidSessionId: string) => {
      setPayment({ phase: "verifying" });
      const job = await loadJob(jobId).catch(() => null);

      // The webhook can lag behind the redirect; "pending" means Stripe has not confirmed yet.
      let result: VerifyCheckoutResult = { status: "error" };
      for (let attempt = 0; attempt <= VERIFY_RETRY_LIMIT; attempt++) {
        result = await verifyCheckout(paidSessionId, jobId).catch((): VerifyCheckoutResult => ({ status: "error" }));
        if (result.status !== "pending") break;
        await wait(VERIFY_RETRY_MS);
      }

      if (result.status !== "paid") {
        // Keep the URL for "pending" and "error" so a refresh tries again; drop it when it can never work.
        if (result.status === "invalid") clearUrl();
        setPayment({
          phase: "failed",
          message:
            result.status === "pending"
              ? "Stripe hasn't confirmed this payment yet. Refresh this page in a minute. You won't be charged twice."
              : result.status === "invalid"
                ? "We couldn't match this payment to a file, so nothing was unlocked."
                : "We couldn't check your payment right now. Refresh this page to try again. You won't be charged twice.",
        });
        return;
      }

      clearUrl();
      if (!job) {
        setPayment({
          phase: "failed",
          message: `Your payment went through (reference ${paidSessionId.slice(-8)}), but your cleaned file is no longer stored in this browser. Upload the file again and contact us with that reference so we can unlock it.`,
        });
        return;
      }

      setState({ ...job.state, loading: false, error: null });
      setTelemetryId(jobId);
      setUnlocked(true);
      setPayment({ phase: "confirmed" });
      downloadCsv(job.state.cleanedData, job.state.fileName);
      // The file is no longer needed on this device once it has been handed back.
      await deleteJob(jobId).catch(() => {});
    };

    void (canceled ? returnCanceled() : returnPaid(sessionId as string));
  }, []);

  // Recovery for a customer who paid and closed the tab before Stripe's redirect, so they never saw the
  // download. Their cleaned file is still parked on this device: on a plain page load, ask the server whether
  // any parked file has been paid for since, and if so hand it back. Unpaid files stay parked so the customer
  // can still pay later. (A load that carries "job_id" is the return-from-Stripe flow above, which owns it.)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("job_id") || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const startedRun = runId.current;

    const recoverParkedFile = async () => {
      const parked = (await listParkedJobs().catch(() => [])).reverse().slice(0, RECOVERY_CHECK_LIMIT); // newest first
      for (const { jobId, savedAt } of parked) {
        const result = await verifyCheckout(null, jobId).catch((): VerifyCheckoutResult => ({ status: "error" }));
        // The visitor already started something else. Leave the file parked; the next visit will pick it up.
        if (runId.current !== startedRun) return;

        if (result.status === "paid") {
          const job = await loadJob(jobId).catch(() => null);
          if (!job || runId.current !== startedRun) return;
          setState({ ...job.state, loading: false, error: null });
          setTelemetryId(jobId);
          setUnlocked(true);
          setPayment({ phase: "recovered" });
          downloadCsv(job.state.cleanedData, job.state.fileName);
          // The file is on screen now (the download button still works if the browser blocked the automatic
          // download), so the parked copy can go. One file per visit keeps the browser from blocking a burst of downloads.
          await deleteJob(jobId).catch(() => {});
          return;
        }
        // Not paid and too old to ever be: Stripe sessions have long expired, so stop keeping the customer's data.
        if (result.status !== "error" && Date.now() - savedAt > PARKED_MAX_AGE_MS) {
          await deleteJob(jobId).catch(() => {});
        }
      }
    };
    void recoverParkedFile();
  }, []);

  const handleFileLoadStart = (fileName: string) => {
    runId.current++;
    setTelemetryId(null);
    setUnlocked(false);
    setCheckoutError(null);
    setPayment(null);
    setState({ ...INITIAL_STATE, loading: true, fileName });
  };

  const handleDataParsed = async (rows: RawSupplierRow[], fileName: string, warnings: string[]) => {
    const currentRun = ++runId.current;
    const startedAt = performance.now();
    // Give React a moment to paint the loading state before the synchronous cleaning work starts.
    await wait(60);

    try {
      const { rows: cleaned, report } = sanitizeDataset(rows);
      const remaining = MIN_LOADING_MS - (performance.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      if (currentRun !== runId.current) return;

      // Fire and forget: the action never throws, and the catch covers a failed network call, so
      // telemetry can neither delay nor break the dashboard. Only numbers and a hashed file name are sent;
      // the built-in sample keeps its label so test clicks can be told apart from real uploads.
      (fileName === SAMPLE_FILE_NAME ? Promise.resolve(fileName) : anonymizeFileName(fileName))
        .then((fileNameAnonymized) =>
          logUsageTelemetry({
            file_name_anonymized: fileNameAnonymized,
            total_rows: rows.length,
            processing_time_ms: report.processingMs,
          }),
        )
        .then((id) => {
          if (currentRun === runId.current) setTelemetryId(id);
        })
        .catch(() => {});

      setState({
        loading: false,
        error: null,
        rawData: rows,
        cleanedData: cleaned,
        fileName,
        warnings,
        report,
      });
    } catch (error) {
      if (currentRun !== runId.current) return;
      setState({
        ...INITIAL_STATE,
        error: error instanceof Error ? `Cleaning failed: ${error.message}` : "Cleaning failed for an unknown reason.",
      });
    }
  };

  const handleError = (message: string) => {
    runId.current++;
    setTelemetryId(null);
    setUnlocked(false);
    setCheckoutError(null);
    setPayment(null);
    setState({ ...INITIAL_STATE, error: message });
  };

  const handleReset = () => {
    runId.current++;
    setJustDownloaded(false);
    setTelemetryId(null);
    setUnlocked(false);
    checkoutInFlight.current = false;
    setIsRedirecting(false);
    setCheckoutError(null);
    setPayment(null);
    setState(INITIAL_STATE);
  };

  const handleDownload = () => {
    // The paywall button replaces this one for large files; this guard keeps it that way.
    if (state.cleanedData.length === 0 || isGated) return;

    downloadCsv(state.cleanedData, state.fileName);

    setJustDownloaded(true);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setJustDownloaded(false), DOWNLOAD_FEEDBACK_MS);
  };

  const handleCheckout = async () => {
    if (!report || checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    setCheckoutError(null);
    setIsRedirecting(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telemetryId: telemetryId ?? "", rowCount: report.productCount }),
      });
      const data: { url?: unknown; jobId?: unknown; error?: unknown } | null = await response.json().catch(() => null);
      if (!response.ok || typeof data?.url !== "string" || typeof data.jobId !== "string") {
        throw new Error(typeof data?.error === "string" ? data.error : "Checkout is unavailable right now. Please try again.");
      }

      // Stripe takes the whole page away, so park the cleaned file on this device until the customer is back.
      // If that fails, stop here: paying and then losing the file is the one outcome to avoid.
      try {
        await saveJob({
          jobId: data.jobId,
          savedAt: Date.now(),
          state: {
            rawData: state.rawData,
            cleanedData: state.cleanedData,
            fileName: state.fileName,
            warnings: state.warnings,
            report,
          },
        });
      } catch {
        throw new Error(
          "Your browser blocked local storage, so we can't keep your file safe while you pay. Nothing was charged. Try again in a regular, non-private window.",
        );
      }

      window.location.assign(data.url);
    } catch (checkoutFailure) {
      checkoutInFlight.current = false;
      setIsRedirecting(false);
      // fetch() rejects with a TypeError when the network is down; every other message here is ours.
      setCheckoutError(
        checkoutFailure instanceof Error && !(checkoutFailure instanceof TypeError)
          ? checkoutFailure.message
          : "We couldn't reach checkout. Check your connection and try again.",
      );
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-neutral-950 font-mono text-neutral-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <div className="h-0.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-500" />
        <div className="h-3 bg-gradient-to-r from-emerald-400/30 via-teal-400/20 to-indigo-500/30 blur-md" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_60%_at_50%_0%,rgba(16,185,129,0.14),transparent)]"
      />

      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <BrandMark />
        <span className="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs text-neutral-400">
          Local prototype
        </span>
      </header>

      <main className="relative mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        {/* Stage 1: empty state with the upload zone */}
        {!loading && !isDashboard && !isVerifying && (
          <div key="stage-upload" className="animate-fade-up motion-reduce:animate-none">
            <Hero />
            <div className="mx-auto mt-12 max-w-3xl space-y-4">
              {payment?.phase === "failed" && (
                <Banner tone="error" title="We couldn't finish unlocking your file" onDismiss={() => setPayment(null)}>
                  {payment.message}
                </Banner>
              )}
              {error && <Banner tone="error" title="We couldn't use that file" onDismiss={() => setState(INITIAL_STATE)}>{error}</Banner>}
              <CsvUploader
                onFileLoadStart={handleFileLoadStart}
                onDataParsed={handleDataParsed}
                onError={handleError}
              />
            </div>
            <FeatureGrid />
          </div>
        )}

        {/* Stage 2: loading spinner */}
        {loading && (
          <div key="stage-loading" className="pt-10">
            <LoadingPanel
              title={`Cleaning ${state.fileName ?? "your file"}…`}
              detail="Fixing titles, stripping legacy HTML, generating handles and splitting image cells."
            />
          </div>
        )}

        {/* Stage 2b: back from Stripe, confirming the payment */}
        {isVerifying && (
          <div key="stage-verifying" className="pt-10">
            <LoadingPanel
              title={"Confirming your payment…"}
              detail="Matching your payment to your cleaned file. This only takes a moment."
            />
          </div>
        )}

        {/* Stage 3: before/after dashboard */}
        {isDashboard && report && (
          <div key="stage-dashboard" className="flex flex-col gap-8">
            <div className="animate-fade-up rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 motion-reduce:animate-none sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Your Shopify import is ready</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
                    {report.productCount.toLocaleString()} products cleaned
                    <span className="text-neutral-500"> &rarr; </span>
                    {report.outputRowCount.toLocaleString()} Shopify rows
                  </h1>
                  <p className="mt-1 truncate text-sm text-neutral-400" title={state.fileName ?? undefined}>
                    from <span className="font-mono text-neutral-300">{state.fileName}</span>
                  </p>
                  {isGated && (
                    <p className="mt-2 text-xs text-neutral-500">
                      Files over {FREE_ROW_LIMIT} products unlock for a one-time $9. The before/after preview below is free.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="whitespace-nowrap rounded-xl border border-neutral-700 bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  >
                    Clean another file
                  </button>
                  {isGated ? (
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isRedirecting}
                      aria-busy={isRedirecting}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-300/30 transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 active:scale-[0.98] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-80 disabled:hover:bg-emerald-500"
                    >
                      {isRedirecting ? (
                        <>
                          <Spinner />
                          Redirecting to Stripe&hellip;
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                            <rect x="4" y="11" width="16" height="10" rx="2" />
                            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                          </svg>
                          Unlock Complete File ($9)
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-300/30 transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 active:scale-[0.98]"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                        <path d="M12 4v12" />
                        <path d="m7 11 5 5 5-5" />
                        <path d="M5 20h14" />
                      </svg>
                      {justDownloaded ? "Downloaded" : "Download Cleaned CSV"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {payment?.phase === "confirmed" && (
              <Banner tone="success" title="Payment confirmed" onDismiss={() => setPayment(null)}>
                <p>Your complete cleaned file is downloading. If nothing happened, use the download button above.</p>
              </Banner>
            )}
            {payment?.phase === "recovered" && (
              <Banner tone="success" title="Welcome back, your paid file is ready" onDismiss={() => setPayment(null)}>
                <p>
                  We found a file you paid for earlier and downloaded it for you. If nothing happened, use the
                  download button above.
                </p>
              </Banner>
            )}
            {payment?.phase === "canceled" && (
              <Banner tone="warning" title="Checkout canceled" onDismiss={() => setPayment(null)}>
                <p>Nothing was charged, and your cleaned file is still here whenever you want to unlock it.</p>
              </Banner>
            )}
            {checkoutError && (
              <Banner tone="error" title="We couldn't start checkout" onDismiss={() => setCheckoutError(null)}>
                {checkoutError}
              </Banner>
            )}

            {state.warnings.length > 0 && (
              <Banner tone="warning" title="Heads up about your source file">
                {state.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </Banner>
            )}
            {error && <Banner tone="error" title="Something went wrong" onDismiss={() => setState((current) => ({ ...current, error: null }))}>{error}</Banner>}

            <DataPreview rawData={state.rawData} cleanedData={state.cleanedData} report={report} />
          </div>
        )}
      </main>

      <footer className="relative mx-auto max-w-7xl px-4 pb-10 text-center text-xs text-neutral-600 sm:px-6 lg:px-8">
        Your files are processed entirely in your browser and never leave your device.
      </footer>
    </div>
  );
}