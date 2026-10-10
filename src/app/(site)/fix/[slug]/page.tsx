import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IMPORT_ERRORS, SHOPIFY_CSV_FORMAT_URL, SHOPIFY_ERRORS_URL, SHOPIFY_IMPORT_URL, getGuide } from "../../../../site/import-errors";
import { SITE_NAME, pageMetadata } from "../../../../site/metadata";
import { absoluteUrl } from "../../../../site/site-url";
import SanitizerTool from "../../../components/sanitizer-tool";
import { CoverageBadge, GuideDemo } from "../../../components/site/guide-demo";
import { JsonLd } from "../../../components/site/json-ld";
import { FREE_ROW_LIMIT } from "../../../utils/pricing";

type Params = { params: Promise<{ slug: string }> };

// Only the guides in src/site/import-errors.ts exist: every one is prerendered at build time (generateStaticParams), so a
// visitor never waits on `params`. Any other slug is rendered on request and ends in notFound(): the visitor sees the
// 404 page, which Next marks noindex (in production the response status stays 200 because Cache Components sends the
// shell first). Reading `params` before anything streams is the one case the instant-navigation check in `next dev`
// complains about, and it only concerns those unknown slugs, so the route opts out of it.
export const instant = false;

export function generateStaticParams() {
  return IMPORT_ERRORS.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return pageMetadata({
    title: guide.title,
    absoluteTitle: true,
    description: guide.description,
    path: `/fix/${guide.slug}`,
    type: "article",
    modified: guide.updated,
    hasOwnShareImage: true,   // ./opengraph-image.tsx draws one per guide
  });
}

const heading = "text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl";

export default async function GuidePage({ params }: Params) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const related = guide.related.map((relatedSlug) => getGuide(relatedSlug)).filter((entry) => entry !== undefined);
  const url = absoluteUrl(`/fix/${guide.slug}`);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: "Import errors", item: absoluteUrl("/fix") },
        { "@type": "ListItem", position: 3, name: guide.heading, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: guide.heading,
      description: guide.description,
      datePublished: guide.updated,
      dateModified: guide.updated,
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: SITE_NAME },
      publisher: { "@type": "Organization", name: SITE_NAME },
    },
  ];
  const cite = guide.shopifyMessage ? SHOPIFY_ERRORS_URL : SHOPIFY_CSV_FORMAT_URL;

  return (
    <article className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      {structuredData.map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}

      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li><Link href="/" className="hover:text-emerald-300">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/fix" className="hover:text-emerald-300">Import errors</Link></li>
        </ol>
      </nav>

      <div className="mx-auto mt-6 max-w-3xl space-y-10">
        <header className="space-y-5">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">{guide.heading}</h1>
          {guide.shopifyMessage && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Shopify shows</p>
              <p className="mt-2 break-words rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-sm text-amber-200">{guide.shopifyMessage}</p>
            </div>
          )}
          <p className="text-base leading-relaxed text-neutral-300 sm:text-lg">{guide.intro}</p>
        </header>

        <section aria-labelledby="cause-heading" className="space-y-4">
          <h2 id="cause-heading" className={heading}>What causes it</h2>
          {guide.causes.map((paragraph) => (
            <p key={paragraph} className="text-base leading-relaxed text-neutral-400">{paragraph}</p>
          ))}
        </section>

        <section aria-labelledby="fix-heading" className="space-y-4">
          <h2 id="fix-heading" className={heading}>How to fix it</h2>
          <ol className="space-y-3">
            {guide.steps.map((step, index) => (
              <li key={step} className="flex gap-3 text-base leading-relaxed text-neutral-300">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-300">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="tool-heading" className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="tool-heading" className={heading}>What this tool does about it</h2>
            <CoverageBadge coverage={guide.coverage} />
          </div>
          <p className="text-base leading-relaxed text-neutral-400">{guide.toolNote}</p>
          {guide.demo && <GuideDemo spec={guide.demo} />}
        </section>
      </div>

      <section aria-labelledby="try-heading" className="mt-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="try-heading" className="text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">Try it on your file</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400 sm:text-base">
            Free up to {FREE_ROW_LIMIT} rows. Your file is cleaned in your browser and never uploaded.{" "}
            <Link href="/#pricing" className="underline underline-offset-2 hover:text-emerald-300">See pricing</Link>.
          </p>
        </div>
        <div className="mt-8">
          <SanitizerTool />
        </div>
      </section>

      <div className="mx-auto mt-16 max-w-3xl space-y-10">
        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="space-y-4">
            <h2 id="related-heading" className={heading}>Related guides</h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {related.map((entry) => (
                <li key={entry.slug}>
                  <Link href={`/fix/${entry.slug}`} className="flex h-full rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 text-sm font-medium leading-snug text-neutral-200 transition hover:border-emerald-500/50 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70">
                    {entry.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs leading-relaxed text-neutral-600">
          Source for the Shopify rules above: Shopify Help Center, {" "}
          <a href={cite} className="underline underline-offset-2 hover:text-neutral-400" rel="noopener noreferrer" target="_blank">{guide.shopifyMessage ? "Solutions to common product CSV import problems" : "Product CSV file format"}</a>
          {" "}and{" "}
          <a href={SHOPIFY_IMPORT_URL} className="underline underline-offset-2 hover:text-neutral-400" rel="noopener noreferrer" target="_blank">Importing products with a CSV file</a>. Shopify may change its rules; always check its
          current documentation. Last reviewed {guide.updated}.
        </p>
      </div>
    </article>
  );
}
