// src/app/components/sanitizer-tool.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { logUsageTelemetry } from "../actions/telemetry";
import CsvUploader, { SAMPLE_FILE_NAME, type UploadSource } from "./csv-uploader";
import DataPreview from "./data-preview";
import ExportOptions from "./export-options";
import WarningsPanel from "./warnings-panel";
import type { CsvState, RawSupplierRow, SanitizeOptions, SanitizeReport } from "../types/csv";
import type { PurchaseGrant } from "../types/unlock";
import { anonymizeFileName } from "../utils/anonymize";
import { type EncodingReport, parseSupplierBytes } from "../utils/csv-parser";
import { findEntitlementFor, forgetPurchase, rememberPurchases } from "../utils/entitlements";
import { type ParkedJobMeta, deleteParkedJob, listParkedJobs, loadParkedData, parkJob } from "../utils/job-store";
import { fingerprintRows, isFreeFile, previewRows } from "../utils/paywall";
import { findRecoverableFile } from "../utils/recovery";
import { FREE_ROW_LIMIT, PRICE_LABEL, taxNote } from "../utils/pricing";
import { countFixes, defaultSanitizeOptions, mergeSanitizeOptions, sampleTitleCasing, sanitizeDataset } from "../utils/sanitizer";
import { ENCODING_LABELS, SELECTABLE_ENCODINGS, type SupplierEncoding, isSupplierEncoding } from "../utils/text-encoding";
import { WAIVER_SUMMARY, guaranteeLabel, guaranteeNearPayButton } from "../../site/legal";
import { requestTrial } from "../utils/trial-client";
import { ExportBlockedError, exportCleanedFile, isGrantFresh, requestUnlock, waitForUnlock } from "../utils/unlock-client";

/* -------------------------------------------------------------------------- */
/*  State & constants                                                          */
/* -------------------------------------------------------------------------- */

/** Keeps the loading state from flashing on screen when a small file is cleaned in a few milliseconds. */
const MIN_LOADING_MS = 900;
const DOWNLOAD_FEEDBACK_MS = 2600;

const INITIAL_STATE: CsvState = {
  loading: false,
  error: null,
  fileName: null,
  fileSize: 0,
  warnings: [],
  rawData: [],
  cleanedData: [],
  rowStarts: [],
  report: null,
  fingerprint: null,
};

type PaymentNotice =
  | { phase: "verifying" }
  | { phase: "confirmed" }
  /** A file paid for on an earlier visit (the tab was closed before Stripe redirected back) was handed back. */
  | { phase: "recovered" }
  /** This exact file was paid for before on this device, so it unlocked without a second payment. */
  | { phase: "entitled" }
  /** The person's one free first big file was used on this file (just now, or earlier on this device). */
  | { phase: "trial" }
  | { phase: "canceled" }
  /** The payment for this file was refunded or disputed, so it is locked again. */
  | { phase: "refunded" }
  | { phase: "failed"; message: string };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds what the dashboard shows for an upload. PAYWALL RULE: only the free preview (the first FREE_ROW_LIMIT rows, or
 * the whole file when it is free) is cleaned here. Cleaning the rest happens only inside the paid export module.
 */
function buildLoadedState(
  rawData: RawSupplierRow[],
  info: { fileName: string | null; fileSize: number; warnings: string[]; fingerprint: string | null },
  options: SanitizeOptions,
): CsvState {
  // report.warnings (duplicate SKUs, invalid EANs ...) are shown by the warnings panel, which says how much of the file they cover.
  const { rows, report, rowStarts } = sanitizeDataset(previewRows(rawData), options);
  return { loading: false, error: null, rawData, cleanedData: rows, rowStarts, report, ...info };
}

/** The preview and its report again after a switch was flipped. The file's own (parse) warnings stay as they are. */
function rebuildPreview(current: CsvState, options: SanitizeOptions): CsvState {
  if (current.rawData.length === 0) return current;
  const { rows, report, rowStarts } = sanitizeDataset(previewRows(current.rawData), options);
  return { ...current, cleanedData: rows, rowStarts, report };
}

/** What a file starts with: SKUs made unique when its variants share one, and products as drafts. Only the preview rows are looked at. */
const startingOptions = (rawData: RawSupplierRow[]): SanitizeOptions => defaultSanitizeOptions(previewRows(rawData));

function describeExportError(error: unknown): string {
  if (error instanceof ExportBlockedError) {
    if (error.reason === "refunded") return "This payment was refunded, so the file is no longer unlocked.";
    return error.reason === "token"
      ? "We couldn't confirm your payment for this file. Try again, or use the Recover page with your receipt email."
      : "We couldn't reach the server to confirm your payment. Please try again in a moment.";
  }
  return "The file couldn't be produced. Please try again.";
}

/**
 * Produces the download. For a paid file it first makes sure the unlock token is fresh, and if the server still
 * rejects it (expired a moment ago) it fetches a new one once. Never loads the paid module without a token the
 * server accepted: that check lives in exportCleanedFile.
 */
async function exportFile(
  rows: RawSupplierRow[],
  fileName: string | null,
  grant: PurchaseGrant | null,
  onGrant: (grant: PurchaseGrant) => void,
  fingerprint: string | null,
  options: SanitizeOptions,
): Promise<SanitizeReport> {
  let current = grant;
  const refresh = async (): Promise<boolean> => {
    if (!current) return false;
    if (current.kind === "trial") {
      // The free first file has no payment to look up: this browser's own trial for this very file is the proof.
      if (!fingerprint) return false;
      const renewed = await requestTrial({ action: "renew", fingerprint });
      if (renewed.status !== "granted") return false;
      current = renewed.grant;
      onGrant(current);
      return true;
    }
    const result = await requestUnlock({ sessionId: current.sessionId });
    if (result.status !== "paid" || !result.purchases[0]) return false;
    current = result.purchases[0];
    onGrant(current);
    return true;
  };

  if (!isFreeFile(rows.length) && !isGrantFresh(current)) await refresh();
  try {
    return (await exportCleanedFile({ rows, fileName, token: current?.token ?? null, fingerprint, options })).report;
  } catch (error) {
    if (error instanceof ExportBlockedError && error.reason === "token" && (await refresh())) {
      return (await exportCleanedFile({ rows, fileName, token: current?.token ?? null, fingerprint, options })).report;
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Presentational pieces                                                      */
/* -------------------------------------------------------------------------- */

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

/**
 * The "Get your first big file free" form: an email (needed to give one free file per person) and a separate, optional,
 * unticked box for product updates. The free file does not depend on the box.
 */
function TrialForm({
  pending,
  message,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  message: { tone: "warning" | "error"; text: string } | null;
  onSubmit: (email: string, marketingOptIn: boolean) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [updates, setUpdates] = useState(false);
  return (
    <form
      id="trial-form"
      aria-labelledby="trial-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() !== "" && !pending) onSubmit(email.trim(), updates);
      }}
      className="mt-5 space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-5"
    >
      <div>
        <h3 id="trial-heading" className="text-base font-semibold text-neutral-50">
          Get your first big file free
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          Your first file over {FREE_ROW_LIMIT} rows is on us: one free unlock per person. To keep it to one, we store a one-way hash of your email address (not the address itself)
          and a random id of this browser, and nothing else.{" "}
          <Link href="/privacy" className="underline underline-offset-2 transition hover:text-emerald-300">
            Privacy policy
          </Link>
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="trial-email" className="text-xs font-medium text-neutral-300">
          Your email address
        </label>
        <input
          id="trial-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@yourshop.com"
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-50 placeholder:text-neutral-600 transition focus:border-emerald-500/70 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        />
      </div>
      <label htmlFor="trial-updates" className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-neutral-400">
        <input
          id="trial-updates"
          name="updates"
          type="checkbox"
          checked={updates}
          onChange={(event) => setUpdates(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
        />
        <span>
          <strong className="font-medium text-neutral-300">Optional:</strong> email me occasional product updates. Not needed for your free file, and you can ask us to stop at any time.
        </span>
      </label>
      {message && (
        <p role="alert" className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${message.tone === "warning" ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-rose-500/40 bg-rose-500/10 text-rose-100"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-80"
        >
          {pending ? (
            <>
              <Spinner />
              Unlocking&hellip;
            </>
          ) : (
            "Unlock this file free"
          )}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 transition hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Shows how the file's text was read and lets the user pick another encoding, which re-reads the same bytes. Detection
 * is a judgement call for short files, so when it is unsure this says so instead of looking certain.
 */
function EncodingPicker({ encoding, locked, onChange }: { encoding: EncodingReport; locked: boolean; onChange: (choice: SupplierEncoding | "auto") => void }) {
  const unsure = encoding.auto && encoding.confidence === "uncertain";
  return (
    <div className="mt-3 flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="encoding-select" className="font-medium text-neutral-400">
          Text encoding
        </label>
        <select
          id="encoding-select"
          value={encoding.auto ? "auto" : encoding.encoding}
          disabled={locked}
          title={locked ? "The payment covers the file as it was read when you paid, so the encoding is locked." : undefined}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "auto" || isSupplierEncoding(value)) onChange(value);
          }}
          className="max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-neutral-200 focus:border-emerald-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="auto">Auto-detect (reading as {ENCODING_LABELS[encoding.encoding]})</option>
          {SELECTABLE_ENCODINGS.map((value) => (
            <option key={value} value={value}>
              {ENCODING_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <p className={unsure ? "text-amber-300" : "text-neutral-500"}>
        {encoding.auto
          ? unsure
            ? `Not sure about this one (${encoding.why}). If accented or non-Latin letters look wrong below, pick the right encoding.`
            : `Detected ${ENCODING_LABELS[encoding.encoding]}: ${encoding.why}.`
          : `Reading the file as ${ENCODING_LABELS[encoding.encoding]}, as you chose.`}
        {unsure && encoding.alternatives.length > 0 && <> It could also be {encoding.alternatives.map((value) => ENCODING_LABELS[value]).join(" or ")}.</>}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function SanitizerTool() {
  const [state, setState] = useState<CsvState>(INITIAL_STATE);
  const [justDownloaded, setJustDownloaded] = useState(false);
  /** Id of this file's usage_telemetry row. It is the job id that Stripe Checkout and the return URL carry. */
  const [telemetryId, setTelemetryId] = useState<string | null>(null);
  /** Proof of payment for the file on screen. Without one, a file over the free limit cannot be exported. */
  const [grant, setGrant] = useState<PurchaseGrant | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  /** The "first big file free" form: open or closed, waiting for the server, and what the server said when it said no. */
  const [trialOpen, setTrialOpen] = useState(false);
  const [trialPending, setTrialPending] = useState(false);
  const [trialMessage, setTrialMessage] = useState<{ tone: "warning" | "error"; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The two export switches (unique SKUs, import as active). They change the preview, the download and what the warnings say. */
  const [options, setOptions] = useState<SanitizeOptions>({ uniqueSkus: false, status: "draft", casing: "title", removeDuplicates: true, noRetailPrice: "empty", markupPercent: 100 });
  /** Whether the file's variants share one SKU, which is why "unique SKUs" started switched on (for the hint next to it). */
  const [skusShared, setSkusShared] = useState(false);
  /** The report of the WHOLE file, once a download has produced it. Until then the warnings come from the free preview. */
  const [fullReport, setFullReport] = useState<SanitizeReport | null>(null);
  /** What happened when the customer came back from Stripe or a paid file was recovered, if anything. */
  const [payment, setPayment] = useState<PaymentNotice | null>(null);
  /** How the uploaded bytes were read, and the bytes themselves so another encoding can be tried without uploading again. */
  const [encoding, setEncoding] = useState<EncodingReport | null>(null);
  const sourceBytes = useRef<ArrayBuffer | null>(null);
  const runId = useRef(0);
  const encodingChange = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnHandled = useRef(false);
  const recoveryStarted = useRef(false);
  /** Synchronous guard against a double click creating two Stripe sessions (state updates land a render later). */
  const checkoutInFlight = useRef(false);

  const { loading, error, report } = state;
  const totalRows = state.rawData.length;
  const isDashboard = !loading && report !== null && totalRows > 0;
  /** True when only the free preview has been cleaned (the upload has more rows than the preview covers). */
  const isPartial = report !== null && totalRows > report.sourceRows;
  const isGated = !isFreeFile(totalRows) && grant === null;
  const isVerifying = payment?.phase === "verifying";
  /** Three titles of the file as supplied and as the chosen casing writes them, shown under the casing selector. */
  const casingSamples = useMemo(() => sampleTitleCasing(previewRows(state.rawData), options.casing), [state.rawData, options.casing]);
  /** What the warnings panel says about how much of the file it looked at. Before a download only the free preview has been checked. */
  const warningsScope =
    fullReport !== null || !isPartial
      ? `Checked all ${totalRows.toLocaleString()} rows.`
      : `Checked the free preview: the first ${(report?.sourceRows ?? 0).toLocaleString()} of your ${totalRows.toLocaleString()} rows. The whole file is checked when you ${grant ? "download" : "unlock"} it.`;

  /** Puts a file's switches on screen: its own when it was parked with some, otherwise the starting ones. */
  const adoptOptions = (rawData: RawSupplierRow[], saved?: SanitizeOptions): SanitizeOptions => {
    const starting = startingOptions(rawData);
    setSkusShared(starting.uniqueSkus);
    // A file parked by an older build has no casing (or no other newer option): those fall back to the starting ones.
    const chosen = saved ? mergeSanitizeOptions(starting, saved) : starting;
    setOptions(chosen);
    return chosen;
  };

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

  // Stripe sends the customer back to "/?session_id=...&job_id=..." after paying, or to "/?checkout=canceled&job_id=..."
  // if they backed out. The page was fully reloaded, so the uploaded file has to come back from the copy parked in
  // IndexedDB before the redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job_id");
    const sessionId = params.get("session_id");
    const canceled = params.get("checkout") === "canceled";
    if (!jobId || returnHandled.current || (!sessionId && !canceled)) return;
    returnHandled.current = true;

    const clearUrl = () => window.history.replaceState(null, "", window.location.pathname);

    const findParked = async (): Promise<{ meta: ParkedJobMeta; rawData: RawSupplierRow[] } | null> => {
      const meta = (await listParkedJobs().catch(() => [])).find((candidate) => candidate.jobId === jobId);
      const rawData = meta ? await loadParkedData(jobId).catch(() => null) : null;
      return meta && rawData ? { meta, rawData } : null;
    };

    const returnCanceled = async () => {
      clearUrl();
      const parked = await findParked();
      if (!parked) return;
      setState(buildLoadedState(parked.rawData, parked.meta, adoptOptions(parked.rawData, parked.meta.options)));
      setTelemetryId(jobId);
      setPayment({ phase: "canceled" });
    };

    const returnPaid = async (paidSessionId: string) => {
      setPayment({ phase: "verifying" });
      // The webhook can lag behind the redirect; "pending" means Stripe has not confirmed yet.
      const result = await waitForUnlock(paidSessionId);

      if (result.status !== "paid") {
        // Keep the URL for "pending" and "error" so a refresh tries again; drop it when it can never work.
        if (result.status === "not_found" || result.status === "invalid" || result.status === "refunded") clearUrl();
        setPayment({
          phase: "failed",
          message:
            result.status === "refunded"
              ? "This payment was refunded, so nothing was unlocked."
              : result.status === "pending"
              ? "Stripe hasn't confirmed this payment yet. Refresh this page in a minute. You won't be charged twice."
              : result.status === "not_found" || result.status === "invalid"
                ? "We couldn't match this payment to a file, so nothing was unlocked."
                : "We couldn't check your payment right now. Refresh this page to try again. You won't be charged twice.",
        });
        return;
      }

      clearUrl();
      const paid = result.purchases[0];
      rememberPurchases(result.purchases);
      const parked = await findParked();
      if (!parked) {
        setPayment({
          phase: "failed",
          message: `Your payment went through (reference ${paid.sessionRef}), but this browser no longer has your file. Upload the same file again and it will unlock automatically, with no second payment. If you're on another device, use the Recover page.`,
        });
        return;
      }

      const chosen = adoptOptions(parked.rawData, parked.meta.options);
      setState(buildLoadedState(parked.rawData, parked.meta, chosen));
      setTelemetryId(jobId);
      setGrant(paid);
      setPayment({ phase: "confirmed" });
      try {
        setFullReport(await exportFile(parked.rawData, parked.meta.fileName, paid, setGrant, parked.meta.fingerprint, chosen));
        // The file has been handed over, so the parked copy can go.
        await deleteParkedJob(jobId).catch(() => {});
      } catch (exportError) {
        setActionError(`${describeExportError(exportError)} Your file is still here: use the download button.`);
      }
    };

    void (canceled ? returnCanceled() : returnPaid(sessionId as string));
  }, []);

  // Recovery for a customer who paid and closed the tab before Stripe's redirect, so they never saw the download.
  // Their file is still parked on this device: on a plain page load, ask the server whether any parked file has been
  // paid for since, and if so hand it back. Unpaid files stay parked so the customer can still pay later.
  // (A load that carries "job_id" is the return-from-Stripe flow above, which owns it.)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("job_id") || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const startedRun = runId.current;

    const recover = async () => {
      const outcome = await findRecoverableFile({
        listParked: listParkedJobs,
        requestUnlock: (sessionId) => requestUnlock({ sessionId }),
        loadData: loadParkedData,
        deleteParked: deleteParkedJob,
        // The visitor already started something else. Leave the file parked; the next visit will pick it up.
        isCancelled: () => runId.current !== startedRun,
        now: Date.now,
      });
      if (outcome.kind !== "recovered") return;

      const { meta, grant: paid, rawData } = outcome;
      rememberPurchases([paid]);
      const chosen = adoptOptions(rawData, meta.options);
      setState(buildLoadedState(rawData, meta, chosen));
      setTelemetryId(meta.jobId);
      setGrant(paid);
      setPayment({ phase: "recovered" });
      try {
        setFullReport(await exportFile(rawData, meta.fileName, paid, setGrant, meta.fingerprint, chosen));
        // Handed over (and the download button still works if the browser blocked it): the parked copy can go.
        await deleteParkedJob(meta.jobId).catch(() => {});
      } catch (exportError) {
        setActionError(`${describeExportError(exportError)} Your file is still here: use the download button.`);
      }
    };
    void recover();
  }, []);

  const resetFileState = () => {
    setTrialOpen(false);
    setTrialPending(false);
    setTrialMessage(null);
    sourceBytes.current = null;
    setEncoding(null);
    setTelemetryId(null);
    setGrant(null);
    setActionError(null);
    setPayment(null);
    setFullReport(null);
  };

  const handleFileLoadStart = (fileName: string) => {
    runId.current++;
    resetFileState();
    setState({ ...INITIAL_STATE, loading: true, fileName });
  };

  /** Already paid for this exact file on this device (for example after recovering it on the Recover page)? Unlock it. */
  const applyKnownPayment = async (rowCount: number, fingerprint: string | null, isStale: () => boolean) => {
    const known = isFreeFile(rowCount) ? null : findEntitlementFor(fingerprint);
    if (!known) return;
    if (known.sessionId.startsWith("trial_")) {
      // This browser used its free first file on this very file: hand out a fresh token if the server still knows the trial.
      const renewed = fingerprint ? await requestTrial({ action: "renew", fingerprint }) : null;
      if (isStale()) return;
      if (renewed?.status === "granted") {
        setGrant(renewed.grant);
        setPayment({ phase: "trial" });
      } else if (renewed?.status === "not_found") forgetPurchase(known.sessionId);
      return;
    }
    const result = await requestUnlock({ sessionId: known.sessionId });
    if (isStale()) return;
    if (result.status === "paid") {
      setGrant(result.purchases[0]);
      setPayment({ phase: "entitled" });
    } else if (result.status === "refunded") {
      forgetPurchase(known.sessionId);
      setPayment({ phase: "refunded" });
    }
  };

  const handleDataParsed = async (rows: RawSupplierRow[], fileName: string, warnings: string[], fileSize: number, source?: UploadSource) => {
    const currentRun = ++runId.current;
    sourceBytes.current = source?.bytes ?? null;
    setEncoding(source?.encoding ?? null);
    const startedAt = performance.now();
    // Give React a moment to paint the loading state before the synchronous cleaning work starts.
    await wait(60);

    try {
      const starting = startingOptions(rows);
      const loaded = buildLoadedState(rows, { fileName, fileSize, warnings, fingerprint: null }, starting);
      loaded.fingerprint = await fingerprintRows(rows);
      const loadedReport = loaded.report;
      const remaining = MIN_LOADING_MS - (performance.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      if (currentRun !== runId.current || !loadedReport) return;

      // Fire and forget: the action never throws, and the catch covers a failed network call, so telemetry can neither
      // delay nor break the dashboard. Only counts, timings and the file size are sent, never any file content (see the
      // PRIVACY note in actions/telemetry.ts); the file name is hashed here, and the built-in sample keeps its label so
      // test clicks can be told apart from real uploads.
      (fileName === SAMPLE_FILE_NAME ? Promise.resolve(fileName) : anonymizeFileName(fileName))
        .then((fileNameAnonymized) =>
          logUsageTelemetry({
            file_name_anonymized: fileNameAnonymized,
            total_rows: rows.length,
            processing_time_ms: loadedReport.processingMs,
            fix_count: countFixes(loadedReport),
            file_size_bytes: fileSize,
          }),
        )
        .then((id) => {
          if (currentRun === runId.current) setTelemetryId(id);
        })
        .catch(() => {});

      setSkusShared(starting.uniqueSkus);
      setOptions(starting);
      setState(loaded);

      await applyKnownPayment(rows.length, loaded.fingerprint, () => currentRun !== runId.current);
    } catch (parseError) {
      if (currentRun !== runId.current) return;
      setState({
        ...INITIAL_STATE,
        error: parseError instanceof Error ? `Cleaning failed: ${parseError.message}` : "Cleaning failed for an unknown reason.",
      });
    }
  };

  /** The "Text encoding" menu: read the same bytes again with the chosen encoding (or "auto" to detect again). */
  const handleEncodingChange = async (choice: SupplierEncoding | "auto") => {
    const bytes = sourceBytes.current;
    if (!bytes || isExporting) return;
    // Not runId: that would also cancel the usage_telemetry call of this upload, which may still be in flight.
    const fileRun = runId.current;
    const thisChange = ++encodingChange.current;
    const isStale = () => runId.current !== fileRun || encodingChange.current !== thisChange;
    setActionError(null);
    try {
      const parsed = parseSupplierBytes(bytes, choice);
      const loaded = buildLoadedState(parsed.rows, { fileName: state.fileName, fileSize: state.fileSize, warnings: parsed.warnings, fingerprint: null }, options);
      loaded.fingerprint = await fingerprintRows(parsed.rows);
      if (isStale()) return;
      // The rows changed, so the file is a different file as far as a payment is concerned: look for a payment again.
      setGrant(null);
      setPayment(null);
      setFullReport(null);
      setSkusShared(startingOptions(parsed.rows).uniqueSkus);
      setEncoding(parsed.encoding);
      setState(loaded);
      await applyKnownPayment(parsed.rows.length, loaded.fingerprint, isStale);
    } catch (encodingError) {
      if (isStale()) return;
      setActionError(
        encodingError instanceof Error
          ? `That encoding doesn't work for this file: ${encodingError.message}`
          : "That encoding doesn't work for this file.",
      );
    }
  };

  const handleError = (message: string) => {
    runId.current++;
    resetFileState();
    setState({ ...INITIAL_STATE, error: message });
  };

  const handleReset = () => {
    runId.current++;
    setJustDownloaded(false);
    checkoutInFlight.current = false;
    setIsRedirecting(false);
    resetFileState();
    setState(INITIAL_STATE);
  };

  const handleDownload = async () => {
    // The paywall button replaces this one for a file that needs unlocking; this guard keeps it that way.
    if (totalRows === 0 || isGated || isExporting) return;
    setActionError(null);
    setIsExporting(true);
    try {
      setFullReport(await exportFile(state.rawData, state.fileName, grant, setGrant, state.fingerprint, options));
      setJustDownloaded(true);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setJustDownloaded(false), DOWNLOAD_FEEDBACK_MS);
    } catch (exportError) {
      setActionError(describeExportError(exportError));
    } finally {
      setIsExporting(false);
    }
  };

  /** Claims the person's one free unlock for this file and, if the server agrees, downloads it straight away. */
  const handleTrialSubmit = async (email: string, marketingOptIn: boolean) => {
    if (!state.fingerprint || trialPending) return;
    const fingerprint = state.fingerprint;
    const run = runId.current;
    setTrialPending(true);
    setTrialMessage(null);
    setActionError(null);
    const result = await requestTrial({ action: "claim", email, marketingOptIn, fingerprint, rowCount: totalRows });
    if (run !== runId.current) return;
    setTrialPending(false);

    if (result.status !== "granted") {
      setTrialMessage({
        tone: result.status === "not_eligible" ? "warning" : "error",
        text: result.status === "not_found" ? "We couldn't find a free file for this browser." : result.message,
      });
      return;
    }
    rememberPurchases([result.grant]);
    setGrant(result.grant);
    setTrialOpen(false);
    setPayment({ phase: "trial" });
    try {
      setFullReport(await exportFile(state.rawData, state.fileName, result.grant, setGrant, fingerprint, options));
    } catch (exportError) {
      setActionError(`${describeExportError(exportError)} Your file is unlocked: use the download button.`);
    }
  };

  /** A switch was flipped: the preview, the warnings and the next download follow it; a report from an earlier download no longer fits. */
  const handleOptionsChange = (next: SanitizeOptions) => {
    setOptions(next);
    setFullReport(null);
    setJustDownloaded(false);
    setState((current) => rebuildPreview(current, next));
  };

  const handleCheckout = async () => {
    if (!report || checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    setActionError(null);
    setIsRedirecting(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telemetryId: telemetryId ?? "", rowCount: totalRows, fingerprint: state.fingerprint }),
      });
      const data: { url?: unknown; jobId?: unknown; sessionId?: unknown; error?: unknown } | null = await response.json().catch(() => null);
      if (!response.ok || typeof data?.url !== "string" || typeof data.jobId !== "string" || typeof data.sessionId !== "string") {
        throw new Error(typeof data?.error === "string" ? data.error : "Checkout is unavailable right now. Please try again.");
      }

      // Stripe takes the whole page away, so park the upload on this device (with the Stripe session it belongs to)
      // until the customer is back. If that fails, stop here: paying and then losing the file is the one outcome to avoid.
      try {
        await parkJob(
          {
            jobId: data.jobId,
            sessionId: data.sessionId,
            fingerprint: state.fingerprint,
            fileName: state.fileName,
            fileSize: state.fileSize,
            warnings: state.warnings,
            options,
            savedAt: Date.now(),
          },
          state.rawData,
        );
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
      setActionError(
        checkoutFailure instanceof Error && !(checkoutFailure instanceof TypeError)
          ? checkoutFailure.message
          : "We couldn't reach checkout. Check your connection and try again.",
      );
    }
  };

  return (
    <section id="tool" aria-label="Clean your CSV" className="scroll-mt-24">
      {/* Stage 1: empty state with the upload zone */}
      {!loading && !isDashboard && !isVerifying && (
        <div key="stage-upload" className="animate-fade-up motion-reduce:animate-none">
          <div className="mx-auto max-w-3xl space-y-4">
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
            detail="Matching your payment to your file. This only takes a moment."
          />
        </div>
      )}

      {/* Stage 3: before/after dashboard */}
      {isDashboard && report && (
        <div key="stage-dashboard" className="flex flex-col gap-8">
          <div className="animate-fade-up rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 motion-reduce:animate-none sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  {!isPartial ? "Your Shopify import is ready" : grant ? "Complete file unlocked" : "Free preview ready"}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
                  {!isPartial ? (
                    <>
                      {report.productCount.toLocaleString()} products cleaned
                      <span className="text-neutral-500"> &rarr; </span>
                      {report.outputRowCount.toLocaleString()} Shopify rows
                    </>
                  ) : grant ? (
                    <>{totalRows.toLocaleString()} rows ready to download</>
                  ) : (
                    <>
                      First {report.sourceRows.toLocaleString()} of {totalRows.toLocaleString()} rows cleaned
                    </>
                  )}
                </h2>
                <p className="mt-1 truncate text-sm text-neutral-400" title={state.fileName ?? undefined}>
                  from <span className="font-mono text-neutral-300">{state.fileName}</span>
                </p>
                {encoding && (
                  <EncodingPicker encoding={encoding} locked={grant !== null} onChange={(choice) => void handleEncodingChange(choice)} />
                )}
                {isGated && (
                  <div className="mt-2 max-w-xl space-y-1 text-xs text-neutral-500">
                    <p>
                      Files over {FREE_ROW_LIMIT} rows unlock for a one-time {PRICE_LABEL}, {taxNote()}. The before/after
                      preview below is free, and the rest of your file is not cleaned until you unlock it.
                    </p>
                    <p>
                      {WAIVER_SUMMARY}{" "}
                      <Link href="/refunds" className="underline underline-offset-2 transition hover:text-emerald-300">
                        Refund policy
                      </Link>
                    </p>
                    <p>
                      <strong className="font-semibold text-neutral-300">{guaranteeLabel()}.</strong> {guaranteeNearPayButton()}
                    </p>
                  </div>
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
                  <>
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
                        Unlock Complete File ({PRICE_LABEL})
                      </>
                    )}
                  </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTrialMessage(null);
                        setTrialOpen((open) => !open);
                      }}
                      aria-expanded={trialOpen}
                      aria-controls="trial-form"
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                    >
                      Get your first big file free
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={isExporting}
                    aria-busy={isExporting}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-300/30 transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 active:scale-[0.98] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-80 disabled:hover:bg-emerald-500"
                  >
                    {isExporting ? (
                      <>
                        <Spinner />
                        Preparing your file&hellip;
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                          <path d="M12 4v12" />
                          <path d="m7 11 5 5 5-5" />
                          <path d="M5 20h14" />
                        </svg>
                        {justDownloaded ? "Downloaded" : "Download Cleaned CSV"}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
            {isGated && trialOpen && (
              <TrialForm pending={trialPending} message={trialMessage} onSubmit={handleTrialSubmit} onCancel={() => setTrialOpen(false)} />
            )}
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
          {payment?.phase === "entitled" && (
            <Banner tone="success" title="Payment found for this file" onDismiss={() => setPayment(null)}>
              <p>You already paid for this exact file, so it is unlocked. No second payment needed.</p>
            </Banner>
          )}
          {payment?.phase === "trial" && (
            <Banner tone="success" title="Your first big file is free" onDismiss={() => setPayment(null)}>
              <p>
                This file is unlocked and your complete cleaned file is downloading. If nothing happened, use the download button above. That was your one free
                unlock of a file over {FREE_ROW_LIMIT} rows; the next one is {PRICE_LABEL}.
              </p>
            </Banner>
          )}
          {payment?.phase === "refunded" && (
            <Banner tone="warning" title="That payment was refunded" onDismiss={() => setPayment(null)}>
              <p>You paid for this file earlier, but the payment was refunded, so the complete file is locked again.</p>
            </Banner>
          )}
          {payment?.phase === "canceled" && (
            <Banner tone="warning" title="Checkout canceled" onDismiss={() => setPayment(null)}>
              <p>Nothing was charged, and your file is still here whenever you want to unlock it.</p>
            </Banner>
          )}
          {actionError && (
            <Banner tone="error" title="That didn't work" onDismiss={() => setActionError(null)}>
              {actionError}
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

          <ExportOptions options={options} skusShared={skusShared} samples={casingSamples} onChange={handleOptionsChange} />

          <WarningsPanel report={fullReport ?? report} scope={warningsScope} />

          <DataPreview
            rawData={state.rawData}
            cleanedData={state.cleanedData}
            rowStarts={state.rowStarts}
            report={report}
            totalRows={totalRows}
          />
        </div>
      )}
    </section>
  );
}
