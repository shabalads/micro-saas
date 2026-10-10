import { absoluteUrl } from "../../site/site-url";
import { FAQ } from "../../site/faq";
import { guaranteeLabel } from "../../site/legal";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, pageMetadata } from "../../site/metadata";
import SanitizerTool from "../components/sanitizer-tool";
import { BeforeAfterDemo, Faq, HowItWorks, Pricing } from "../components/site/home-sections";
import { JsonLd } from "../components/site/json-ld";
import { FREE_ROW_LIMIT, PRICE_USD } from "../utils/pricing";

export const metadata = pageMetadata({
  title: `${SITE_NAME}: ${SITE_TAGLINE}`,
  absoluteTitle: true,
  description: SITE_DESCRIPTION,
  path: "/",
});

const TRUST = [`Free up to ${FREE_ROW_LIMIT} rows`, "Your first big file is free", "Processed in your browser", guaranteeLabel()];

export default function HomePage() {
  const applicationLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript",
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "USD", description: `Files up to ${FREE_ROW_LIMIT} rows` },
      { "@type": "Offer", price: String(PRICE_USD), priceCurrency: "USD", description: `One-time price per file over ${FREE_ROW_LIMIT} rows` },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
  };

  return (
    <>
      <JsonLd data={applicationLd} />
      <JsonLd data={faqLd} />

      <section aria-labelledby="hero-heading" className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Built for Shopify merchants who import supplier feeds
          </p>
          <h1 id="hero-heading" className="text-balance text-4xl font-semibold tracking-tight text-neutral-50 sm:text-6xl">
            Stop fixing supplier CSVs <span className="bg-gradient-to-r from-emerald-300 to-emerald-500 bg-clip-text text-transparent">by hand.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-neutral-400 sm:text-lg">
            Drop in the messy file your supplier sent. In seconds you get ALL CAPS titles fixed, legacy HTML stripped, clean
            handles generated and clumped images split into Shopify-ready rows.
          </p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-neutral-400">
            {TRUST.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-12">
          <SanitizerTool />
        </div>
      </section>

      <HowItWorks />
      <BeforeAfterDemo />
      <Pricing />
      <Faq />
    </>
  );
}
