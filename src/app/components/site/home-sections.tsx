import Link from "next/link";
import { FAQ } from "../../../site/faq";
import { DEMO_ROWS } from "../../../site/demo-data";
import { guaranteeLabel, guaranteeSentence } from "../../../site/legal";
import { FREE_ROW_LIMIT, PRICE_LABEL, taxNote } from "../../utils/pricing";
import { buildPreviewPairs, sanitizeDataset } from "../../utils/sanitizer";

const SECTION = "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8";

function SectionHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">
        {title}
      </h2>
      {children && <p className="mt-4 text-base leading-relaxed text-neutral-400">{children}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    title: "Drop in your supplier CSV",
    body: "Any messy export works: comma, semicolon or tab separated, from Excel or a supplier portal. Your file is opened right in your browser and never uploaded.",
  },
  {
    title: "Review the before and after",
    body: `See exactly what changed, field by field, on the first ${FREE_ROW_LIMIT} rows. Titles, descriptions, handles, images and prices are all shown side by side.`,
  },
  {
    title: "Download your Shopify-ready file",
    body: `Up to ${FREE_ROW_LIMIT} rows it is free, and so is your first bigger file. After that the complete cleaned CSV is a one-time ${PRICE_LABEL}, and the download is instant.`,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className={`${SECTION} scroll-mt-20`}>
      <SectionHeading id="how-heading" eyebrow="How it works" title="Three steps, no account">
        From a messy supplier file to a clean Shopify import in about the time it takes to read this sentence.
      </SectionHeading>
      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-sm font-semibold text-emerald-300">
              {index + 1}
            </span>
            <h3 className="mt-4 text-lg font-semibold text-neutral-50">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/** Before/after built from the real sanitizer at build time. */
export function BeforeAfterDemo() {
  const { rows, rowStarts } = sanitizeDataset(DEMO_ROWS);
  const pairs = buildPreviewPairs(DEMO_ROWS, rows, rowStarts, DEMO_ROWS.length);

  const fields = (pair: (typeof pairs)[number]) => [
    { label: "Title", before: pair.raw.title, after: pair.primary.Title },
    { label: "Handle", before: "(none)", after: pair.primary.Handle },
    { label: "Description", before: pair.raw.description, after: pair.primary.Body_HTML },
    { label: "Images", before: pair.raw.images, after: [pair.primary.Image_Src, ...pair.extraImageRows.map((row) => row.Image_Src)].join("\n") },
    { label: "Price", before: pair.raw.price, after: pair.primary.Variant_Price },
  ];

  return (
    <section id="demo" aria-labelledby="demo-heading" className={`${SECTION} scroll-mt-20`}>
      <SectionHeading id="demo-heading" eyebrow="See the difference" title="What a messy feed looks like before and after">
        These are real supplier-style rows, cleaned by the same code that runs on your file.
      </SectionHeading>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {pairs.map((pair, index) => (
          <article key={pair.primary.Handle} className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <p className="px-1 text-sm font-medium text-neutral-300">
              Product {index + 1}
              <span className="ml-2 text-xs text-neutral-500">{pair.extraImageRows.length + 1} Shopify rows</span>
            </p>
            {fields(pair).map((field) => (
              <div key={field.label} className="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{field.label}</p>
                <pre className="whitespace-pre-wrap break-all rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 font-mono text-xs leading-relaxed text-rose-200">
                  {field.before}
                </pre>
                <p className="text-center text-neutral-600" aria-hidden="true">&darr;</p>
                <pre className="whitespace-pre-wrap break-all rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-xs leading-relaxed text-emerald-200">
                  {field.after}
                </pre>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export function Pricing() {
  const free = [
    `Files up to ${FREE_ROW_LIMIT} rows`,
    "The complete cleaned CSV, downloaded instantly",
    "No account, no email, no card",
    "Everything runs in your browser",
  ];
  const paid = [
    `Files over ${FREE_ROW_LIMIT} rows`,
    `A free before/after preview of the first ${FREE_ROW_LIMIT} rows`,
    "Your first big file is free: one free unlock per person",
    "The complete cleaned file, downloaded instantly after payment",
    guaranteeLabel(),
    "Recover your purchase on any device",
    "Secure payment by Stripe, tax shown before you pay",
  ];

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className={`${SECTION} scroll-mt-20`}>
      <SectionHeading id="pricing-heading" eyebrow="Pricing" title="Free for small files, one flat price for big ones">
        No subscription. You pay once, per file, only when the file is larger than {FREE_ROW_LIMIT} rows, and your first big file is on us.
      </SectionHeading>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
        <div className="flex flex-col rounded-3xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-neutral-50">Small files</h3>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight text-neutral-50">Free</span>
          </p>
          <p className="mt-1 text-sm text-neutral-500">{FREE_ROW_LIMIT} rows or fewer</p>
          <ul className="mt-6 flex-1 space-y-3 text-sm text-neutral-300">
            {free.map((item) => (
              <li key={item} className="flex gap-2">
                <Check />
                {item}
              </li>
            ))}
          </ul>
          <Link href="/#tool" className="mt-8 rounded-xl border border-neutral-700 bg-neutral-900 px-5 py-3 text-center text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70">
            Clean a small file
          </Link>
        </div>

        <div className="relative flex flex-col rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-neutral-900/60 to-neutral-900/60 p-6 shadow-[0_0_60px_-25px] shadow-emerald-500/40 sm:p-8">
          <span className="absolute right-6 top-6 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            Most files
          </span>
          <h3 className="text-lg font-semibold text-neutral-50">Large files</h3>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight text-neutral-50">{PRICE_LABEL}</span>
            <span className="text-sm text-neutral-400">one-time, per file</span>
          </p>
          <p className="mt-1 text-sm text-neutral-500">USD, {taxNote()}</p>
          <ul className="mt-6 flex-1 space-y-3 text-sm text-neutral-300">
            {paid.map((item) => (
              <li key={item} className="flex gap-2">
                <Check />
                {item}
              </li>
            ))}
          </ul>
          <Link href="/#tool" className="mt-8 rounded-xl bg-emerald-500 px-5 py-3 text-center text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            Clean a CSV
          </Link>
          <p className="mt-3 text-center text-xs text-neutral-500">
            The file is a digital download delivered immediately: see the{" "}
            <Link href="/refunds" className="underline underline-offset-2 hover:text-emerald-300">
              refund policy
            </Link>
            .
          </p>
        </div>
      </div>
      <div id="guarantee" className="mx-auto mt-4 flex max-w-4xl items-start gap-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-5 sm:p-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-7 w-7 shrink-0 text-emerald-400" aria-hidden="true">
          <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5.1 7.5-9.5V6L12 3Z" />
          <path d="m9 12 2.2 2.2L15.5 10" />
        </svg>
        <div>
          <h3 className="text-base font-semibold text-neutral-50">{guaranteeLabel()}</h3>
          <p className="mt-1 text-sm leading-relaxed text-neutral-300">{guaranteeSentence()}</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            It applies on top of your legal rights and is separate from the 14-day withdrawal right that ends when a digital file is delivered. Details in the{" "}
            <Link href="/refunds" className="underline underline-offset-2 hover:text-emerald-300">
              refund policy
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className={`${SECTION} scroll-mt-20`}>
      <SectionHeading id="faq-heading" eyebrow="FAQ" title="Questions, answered straight" />
      <div className="mx-auto mt-12 max-w-3xl divide-y divide-neutral-800 rounded-2xl border border-neutral-800 bg-neutral-900/40">
        {FAQ.map((item, index) => (
          <details key={item.question} className="group px-5 py-4 sm:px-6" {...(index === 0 ? { open: true } : {})}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left text-base font-medium text-neutral-100 focus:outline-none focus-visible:text-emerald-300 [&::-webkit-details-marker]:hidden">
              {item.question}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-1 h-4 w-4 shrink-0 text-neutral-500 transition group-open:rotate-180" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">{item.answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-neutral-500">
        Something else?{" "}
        <Link href="/contact" className="text-neutral-300 underline underline-offset-2 hover:text-emerald-300">
          Get in touch
        </Link>
        .
      </p>
    </section>
  );
}
