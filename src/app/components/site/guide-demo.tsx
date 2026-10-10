import type { DemoSpec } from "../../../site/import-errors";
import { runDemo } from "../../../site/demo";

const COVERAGE_LABEL = { fixes: "Fixed automatically", helps: "Partly fixed", manual: "Not fixed by this tool" } as const;
const COVERAGE_STYLE = {
  fixes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  helps: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  manual: "border-neutral-600 bg-neutral-800/60 text-neutral-300",
} as const;

export function CoverageBadge({ coverage }: { coverage: keyof typeof COVERAGE_LABEL }) {
  return <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${COVERAGE_STYLE[coverage]}`}>{COVERAGE_LABEL[coverage]}</span>;
}

/** Before/after for one guide, produced by the real parser and sanitizer when the page is built. */
export function GuideDemo({ spec }: { spec: DemoSpec }) {
  const demo = runDemo(spec);
  return (
    <div className="space-y-3">
      {demo.lines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-rose-300">{demo.beforeLabel}</p>
            <pre className="min-h-full whitespace-pre-wrap break-all rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 font-mono text-xs leading-relaxed text-rose-200">{line.before}</pre>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">{demo.afterLabel}</p>
            <pre className="min-h-full whitespace-pre-wrap break-all rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 font-mono text-xs leading-relaxed text-emerald-200">{line.after}</pre>
          </div>
        </div>
      ))}
      {demo.note && <p className="text-xs text-neutral-500">{demo.note}</p>}
    </div>
  );
}
