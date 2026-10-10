import type { ReactNode } from "react";
import { COMPANY, findUnfilledPlaceholders } from "../../../site/company";

/** Frame for the legal pages. While company details are still [[placeholders]], a notice makes that impossible to miss. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const unfilled = findUnfilledPlaceholders();
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6">
      {unfilled.length > 0 && (
        <p role="note" className="mb-8 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <strong>Not ready to publish.</strong> This page still contains {unfilled.length} placeholder{unfilled.length === 1 ? "" : "s"} (highlighted).
          Fill them in <code className="rounded bg-black/30 px-1">src/site/company.ts</code>; this notice disappears once nothing is left.
        </p>
      )}
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">{COMPANY.brandName}</p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-neutral-300 sm:text-base">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 pt-6">
      <h2 className="text-xl font-semibold tracking-tight text-neutral-50">{title}</h2>
      {children}
    </section>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-neutral-600">{children}</ul>;
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-50">{children}</div>;
}
