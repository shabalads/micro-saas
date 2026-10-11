// src/app/components/warnings-panel.tsx

import type { SanitizeReport, SanitizeWarning } from "../types/csv";

const TONE: Record<SanitizeWarning["severity"], { card: string; badge: string; label: string }> = {
  warning: { card: "border-amber-500/40 bg-amber-500/10", badge: "bg-amber-500/20 text-amber-100", label: "Check" },
  info: { card: "border-sky-500/30 bg-sky-500/5", badge: "bg-sky-500/15 text-sky-100", label: "Fixed" },
};

/** "3, 4, 5 and 87 more": the rows a warning lists, then how many more it has. */
function rowSummary(warning: SanitizeWarning): string {
  const more = warning.count - warning.rows.length;
  return `${warning.rows.join(", ")}${more > 0 ? ` and ${more.toLocaleString()} more` : ""}`;
}

function WarningItem({ warning }: { warning: SanitizeWarning }) {
  const tone = TONE[warning.severity];
  const hasDetails = warning.details !== undefined && warning.details.some((detail) => detail !== "");
  return (
    <li data-warning-kind={warning.kind} className={`rounded-2xl border px-4 py-3 text-sm ${tone.card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-neutral-50">{warning.title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone.badge}`} title={`${tone.label}: ${warning.count.toLocaleString()} in total`}>
          {warning.count.toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-neutral-200/90">{warning.message}</p>
      {warning.resolution && <p className="mt-1 text-emerald-300/90">{warning.resolution}</p>}
      <p className="mt-2 text-xs text-neutral-300">
        <span className="font-medium text-neutral-200">{warning.rows.length === 1 && warning.count === 1 ? "Row " : "Rows "}</span>
        <span className="font-mono">{rowSummary(warning)}</span>
      </p>
      {hasDetails && (
        <details className="mt-1 text-xs text-neutral-300">
          <summary className="cursor-pointer select-none text-neutral-400 transition hover:text-neutral-200">
            What is in {warning.rows.length === 1 ? "that row" : `the first ${warning.rows.length} rows`}
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {warning.rows.map((row, index) => (
              <li key={`${row}-${index}`} className="break-all">
                <span className="text-neutral-500">row {row}:</span> {warning.details?.[index] ?? ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * What the cleaner found in the file that the person should look at before importing: one entry per kind of problem, with
 * how many rows it touches and the first rows (so they can be found in the supplier's spreadsheet). It is shown for the
 * free preview too, where `scope` says that only the preview rows have been looked at.
 */
export default function WarningsPanel({ report, scope }: { report: SanitizeReport; scope: string }) {
  const { warnings } = report;
  return (
    <section aria-labelledby="warnings-heading" data-testid="warnings-panel" className="flex flex-col gap-3">
      <div>
        <h2 id="warnings-heading" className="text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl">
          Check before you import
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          {scope} Row numbers count the rows of your file below the header row.
        </p>
      </div>
      {warnings.length === 0 ? (
        <p role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Nothing to flag: no duplicate SKUs or variants, no unusable barcodes or stock, no placeholder descriptions, no mixed currencies.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {warnings.map((warning) => (
            <WarningItem key={warning.kind} warning={warning} />
          ))}
        </ul>
      )}
    </section>
  );
}
