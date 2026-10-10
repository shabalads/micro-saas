import Link from "next/link";
import { IMPORT_ERRORS } from "../../../site/import-errors";
import { SITE_NAME, pageMetadata } from "../../../site/metadata";
import { absoluteUrl } from "../../../site/site-url";
import { CoverageBadge } from "../../components/site/guide-demo";
import { JsonLd } from "../../components/site/json-ld";
import { FREE_ROW_LIMIT } from "../../utils/pricing";

export const metadata = pageMetadata({
  title: "Shopify product import errors: causes and fixes",
  absoluteTitle: true,
  description: `${IMPORT_ERRORS.length} guides to the Shopify product CSV errors that supplier files cause: what each message means, why it happens and how to fix it, with a free tool that does the cleaning.`,
  path: "/fix",
});

export default function GuidesIndexPage() {
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Import errors", item: absoluteUrl("/fix") },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <JsonLd data={breadcrumbs} />
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-50 sm:text-5xl">Shopify product import errors, explained and fixed</h1>
        <p className="mt-5 text-base leading-relaxed text-neutral-400 sm:text-lg">
          Supplier CSV files break Shopify imports in a handful of predictable ways. Each guide below starts from the message Shopify shows (quoted from its help center where it prints one), explains the cause, gives the fix, and says plainly
          what this tool can and cannot do about it. Every guide has the tool built in: drop your file in, free up to {FREE_ROW_LIMIT} rows.
        </p>
      </div>
      <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {IMPORT_ERRORS.map((guide) => (
          <li key={guide.slug}>
            <Link
              href={`/fix/${guide.slug}`}
              className="group flex h-full flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 transition hover:border-emerald-500/50 hover:bg-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <CoverageBadge coverage={guide.coverage} />
              <h2 className="text-base font-semibold leading-snug text-neutral-100 group-hover:text-emerald-300">{guide.heading}</h2>
              <p className="flex-1 text-sm leading-relaxed text-neutral-500">{guide.description}</p>
              <span className="text-sm font-medium text-emerald-400">Read the fix &rarr;</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
