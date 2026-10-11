import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example.test"; });

// The tool is a big client component (IndexedDB, Stripe redirects). The pages only need to put it on the page.
vi.mock("./components/sanitizer-tool", () => ({ default: () => <div data-testid="sanitizer-tool" /> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import { COMPANY, findUnfilledPlaceholders } from "../site/company";
import { FAQ } from "../site/faq";
import { CONSENT_STATEMENT, checkoutSubmitMessage, guaranteeLabel, guaranteeNearPayButton, guaranteeSentence } from "../site/legal";
import { IMPORT_ERRORS } from "../site/import-errors";
import ContactPage from "./(site)/contact/page";
import GuidePage, { generateMetadata, generateStaticParams } from "./(site)/fix/[slug]/page";
import GuideIndex from "./(site)/fix/page";
import HomePage from "./(site)/page";
import PrivacyPage from "./(site)/privacy/page";
import RefundsPage from "./(site)/refunds/page";
import TermsPage from "./(site)/terms/page";
import SiteLayout from "./(site)/layout";
import { SiteFooter } from "./components/site/site-footer";
import { SiteHeader } from "./components/site/site-header";
import { FREE_ROW_LIMIT, PRICE_LABEL } from "./utils/pricing";

const html = (element: React.ReactElement) => renderToStaticMarkup(element);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "\u201c", rdquo: "\u201d", rsquo: "\u2019", lsquo: "\u2018" };
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
const text = (markup: string) => decode(markup.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const jsonLd = (markup: string): Array<Record<string, unknown>> =>
  [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1].replace(/\\u003c/g, "<")));

describe("landing page", () => {
  const markup = html(<HomePage />);

  it("has one h1, the tool, and every section the brief asks for", () => {
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    expect(markup.match(/data-testid="sanitizer-tool"/g)).toHaveLength(1);
    for (const id of ["how-heading", "demo-heading", "pricing", "faq"]) expect(markup, id).toMatch(new RegExp(`id="${id}`));
  });

  it("states the price and the free limit consistently", () => {
    const visible = text(markup);
    expect(visible).toContain(PRICE_LABEL);
    expect(visible).toContain(`${FREE_ROW_LIMIT} rows`);
  });

  it("answers the privacy question in the FAQ and in the FAQPage structured data", () => {
    const faq = jsonLd(markup).find((data) => data["@type"] === "FAQPage") as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(faq.mainEntity).toHaveLength(FAQ.length);
    const privacy = faq.mainEntity.find((entry) => /uploaded/i.test(entry.name))!;
    expect(privacy.acceptedAnswer.text).toMatch(/browser/i);
    for (const item of FAQ) expect(text(markup)).toContain(item.question);
  });

  it("describes the product as a web app with the free and paid offers, using the configured site URL", () => {
    const app = jsonLd(markup).find((data) => data["@type"] === "WebApplication") as { url: string; offers: Array<{ price: string }> };
    expect(app.url).toBe("https://shop.example.test/");
    expect(app.offers.map((offer) => offer.price)).toEqual(["0", "9"]);
  });
});

describe("guide pages", () => {
  it("are generated for every guide in the data file, and only those", async () => {
    expect(generateStaticParams().map((entry) => entry.slug)).toEqual(IMPORT_ERRORS.map((guide) => guide.slug));
    await expect(GuidePage({ params: Promise.resolve({ slug: "not-a-real-guide" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(IMPORT_ERRORS.map((guide) => [guide.slug, guide] as const))("%s has its own intro, cause, fix, the tool, a canonical URL and structured data", async (slug, guide) => {
    const markup = html(await GuidePage({ params: Promise.resolve({ slug }) }));
    const visible = text(markup);
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    expect(visible).toContain(guide.heading);
    expect(visible).toContain(guide.intro.slice(0, 40));
    expect(markup).toContain("What causes it");
    expect(markup).toContain("How to fix it");
    expect(markup.match(/data-testid="sanitizer-tool"/g)).toHaveLength(1);

    const data = jsonLd(markup);
    expect(data.map((entry) => entry["@type"])).toEqual(["BreadcrumbList", "TechArticle"]);
    expect((data[1] as { mainEntityOfPage: string }).mainEntityOfPage).toBe(`https://shop.example.test/fix/${slug}`);

    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expect(meta.alternates?.canonical).toBe(`https://shop.example.test/fix/${slug}`);
    expect(meta.openGraph).toMatchObject({ url: `https://shop.example.test/fix/${slug}`, type: "article", title: guide.title });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.robots).toMatchObject({ index: true });
  });

  it("do not share the same intro or cause text (no duplicate-content pages)", () => {
    const intros = IMPORT_ERRORS.map((guide) => guide.intro);
    const causes = IMPORT_ERRORS.map((guide) => guide.causes.join(" "));
    expect(new Set(intros).size).toBe(intros.length);
    expect(new Set(causes).size).toBe(causes.length);
  });

  it("index page links to every guide", () => {
    const markup = html(<GuideIndex />);
    for (const guide of IMPORT_ERRORS) expect(markup).toContain(`href="/fix/${guide.slug}"`);
  });
});

describe("legal pages", () => {
  const unfilled = findUnfilledPlaceholders().length;
  const pages = { privacy: <PrivacyPage />, terms: <TermsPage />, refunds: <RefundsPage />, contact: <ContactPage /> };

  it.each(Object.entries(pages))("%s page: placeholders are highlighted (and warned about) until the company details are filled in", (_name, page) => {
    const markup = html(page);
    if (unfilled > 0) {
      expect(markup).toContain("Not ready to publish");
      expect(markup).toContain("<mark");
    } else {
      expect(markup).not.toContain("Not ready to publish");
      expect(markup).not.toContain("[[");
    }
  });

  it.each(Object.entries(pages))("%s page has one h1 and no leftover template URLs", (_name, page) => {
    const markup = html(page);
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    // Placeholder hints such as "support@your-domain.com" live inside highlighted <mark> elements; everything else must be real.
    expect(markup.replace(/<mark[\s\S]*?<\/mark>/g, "")).not.toMatch(/your-domain|app\.example\.com|yourdomain/i);
  });

  it("refund policy carries the same waiver sentence the customer ticks at checkout", () => {
    const visible = text(html(<RefundsPage />));
    expect(visible).toContain(CONSENT_STATEMENT.replace(/’/g, "'").slice(0, 60));
    expect(visible).toMatch(/14[- ]day/);
    expect(visible).toContain(String(COMPANY.goodwillDays));
  });

  it("terms and refunds explain the withdrawal right for consumers and the digital-content exception", () => {
    for (const page of [<TermsPage key="t" />, <RefundsPage key="r" />]) {
      const visible = text(html(page));
      expect(visible).toMatch(/withdraw/i);
      expect(visible).toMatch(/digital/i);
    }
  });

  it("privacy policy names the processors it relies on and the supervisory authority, and says files stay in the browser", () => {
    const visible = text(html(<PrivacyPage />));
    for (const word of ["Stripe", "Supabase", "browser", COMPANY.dataProtectionAuthority.name]) expect(visible, word).toContain(word);
    expect(visible).toMatch(/not uploaded|never uploaded|never leaves|does not leave/i);
  });

  it("does not mention the closed EU Online Dispute Resolution platform as if it were available", () => {
    for (const page of Object.values(pages)) expect(html(page)).not.toContain("ec.europa.eu/consumers/odr");
  });
});

describe("site chrome", () => {
  it("header links to the guides and pricing; footer links to every legal page and shows the company line", () => {
    const header = html(<SiteHeader />);
    expect(header).toContain('href="/fix"');
    const footer = html(<SiteFooter />);
    for (const href of ["/privacy", "/terms", "/refunds", "/contact"]) expect(footer).toContain(`href="${href}"`);
    expect(text(footer)).toContain(COMPANY.brandName);
  });
});

describe("site header (smart sticky)", () => {
  const header = html(<SiteHeader />);
  const links = ["/#how-it-works", "/#pricing", "/fix", "/#faq"];

  it("is a sticky bar above the page content, animated with a transform and not with height or top", () => {
    expect(header).toMatch(/<header[^>]*class="[^"]*\bsticky\b[^"]*\btop-0\b[^"]*\bz-40\b/);
    expect(header).toContain("backdrop-blur");
    expect(header).toContain("bg-neutral-950/70");
    expect(header).toContain("transition-[transform,border-color]");
    expect(header).toContain("duration-200");
    expect(header).toContain("motion-reduce:transition-none");
    expect(header).toContain("transform:translateY(0)");   // shown on first paint, before any script runs
    expect(header).toContain('data-state="visible"');
    expect(header).not.toMatch(/transition-(all|\[height|\[top)/);
  });

  it("keeps every link reachable on a phone: in the bar from md up, in the menu below it, and the menu starts closed", () => {
    for (const href of links) expect(header.split(`href="${href}"`).length - 1, `${href} in the bar and in the menu`).toBe(2);
    expect(header).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="site-mobile-menu"|<button[^>]*aria-controls="site-mobile-menu"[^>]*aria-expanded="false"/);
    expect(header).toMatch(/<div id="site-mobile-menu" class="hidden /);
  });

  it("sits in a frame that does not turn into a scroll container (overflow-x-hidden would stop the header sticking), scoped for the anchor offset", () => {
    const frame = html(<SiteLayout>content</SiteLayout>);
    expect(frame).toContain("site-frame");
    expect(frame).toContain("overflow-x-clip");
    expect(frame).not.toContain("overflow-x-hidden");
    expect(frame).not.toMatch(/overflow-(y-)?(auto|scroll|hidden)/);
  });

  it("has a scroll-margin-top rule for headings and anchor targets, scoped to the site frame so /admin is untouched", () => {
    const css = readFileSync(join(__dirname, "globals.css"), "utf8");
    expect(css).toMatch(/\.site-frame :where\(h1, h2, h3, h4, h5, h6, \[id\]\)\s*\{\s*scroll-margin-top:\s*5rem;/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/(^|\})\s*(:where\()?(h[1-6]|\[id\])/m);   // no unscoped rule
  });
});

describe("the money-back guarantee", () => {
  const SENTENCE = `If the cleaned file doesn't work for you, full refund within ${COMPANY.goodwillDays} days, no questions asked.`;

  it("is the promise word for word, and its length is COMPANY.goodwillDays", () => {
    expect(COMPANY.goodwillDays).toBe(30);
    expect(guaranteeSentence()).toBe(SENTENCE);
    expect(guaranteeLabel()).toBe("30-day money-back guarantee");
  });

  it("is on the landing page (headline list and pricing), word for word", () => {
    const visible = text(html(<HomePage />));
    expect(visible).toContain(SENTENCE);
    expect(visible).toContain(guaranteeLabel());
    expect(html(<HomePage />)).toContain('id="guarantee"');
  });

  it("is in the refund policy, word for word, next to the unchanged withdrawal-waiver wording, and says it is separate from it", () => {
    const visible = text(html(<RefundsPage />));
    expect(visible).toContain(SENTENCE);
    expect(visible).toContain(CONSENT_STATEMENT);
    expect(visible).toMatch(/separate from the right of withdrawal in section 1/);
    expect(visible).toMatch(/does not limit the rights in section 2/);
  });

  it("is in the terms, and in the FAQ answer to 'Can I get a refund?'", () => {
    expect(text(html(<TermsPage />))).toContain(SENTENCE);
    const faq = FAQ.find((item) => item.question === "Can I get a refund?")!;
    expect(faq.answer).toContain(SENTENCE);
    expect(faq.answer).toMatch(/separate from the legal 14-day right of withdrawal/);
  });

  it("is right beside the pay button and in Stripe's checkout, each time saying it is separate from the waiver rather than part of it", () => {
    expect(guaranteeNearPayButton()).toContain(SENTENCE);
    expect(guaranteeNearPayButton()).toMatch(/separate from the legal right of withdrawal/);
    for (const taxOn of [false, true]) {
      expect(checkoutSubmitMessage(taxOn)).toContain(SENTENCE);
      expect(checkoutSubmitMessage(taxOn)).toMatch(/separate from the withdrawal right you waive/);
      expect(checkoutSubmitMessage(taxOn).length).toBeLessThanOrEqual(1200);
    }
  });

  it("does not change what the waiver checkbox says: it still asks for immediate delivery and the loss of the 14-day right, and does not mention the guarantee", () => {
    expect(CONSENT_STATEMENT).toMatch(/expressly ask/i);
    expect(CONSENT_STATEMENT).toMatch(/lose my 14-day right to withdraw/);
    expect(CONSENT_STATEMENT).not.toMatch(/guarantee|refund/i);
  });
});

describe("the free first big file in the copy", () => {
  it("is on the landing page and in the FAQ, with the one-per-person rule", () => {
    const visible = text(html(<HomePage />));
    expect(visible).toContain("Your first big file is free");
    const faq = FAQ.find((item) => item.question === "Is the first big file really free?")!;
    expect(faq.answer).toContain(`${FREE_ROW_LIMIT} rows`);
    expect(faq.answer).toMatch(/one free file per person/);
    expect(faq.answer).toMatch(/one-way hash of your email address \(the address itself is not stored\)/);
    expect(faq.answer).toMatch(/optional, unticked/);
  });

  it("the privacy policy covers the email, its hash, the browser id and cookie, the purpose, the retention and the optional updates box", () => {
    const visible = text(html(<PrivacyPage />));
    expect(visible).toContain("Your free first big file");
    expect(visible).toMatch(/We do not store the address: we compute a keyed one-way hash/);
    expect(visible).toMatch(/HMAC-SHA256/);
    expect(visible).toMatch(/random identifier of your browser/);
    expect(visible).toContain("csv_trial_browser");
    expect(visible).toMatch(/Purpose: giving one free file per person/);
    expect(visible).toContain(`We keep this record for ${COMPANY.trialRetention}`);
    expect(visible).toMatch(/Product updates are optional/);
    expect(visible).toMatch(/separate and unticked by default/);
    expect(visible).toMatch(/consent \(Art\. 6\(1\)\(a\) GDPR\)/);
    expect(visible).toMatch(/withdraw it at any time/);
  });

  it("the privacy policy says usage statistics never hold an email and are not linked to the free-file record", () => {
    expect(text(html(<PrivacyPage />))).toMatch(/never contain your email address, and they are not linked to the record of a free first file/);
  });

  it("the terms describe it as a free offer, not a sale, and forbid getting around it", () => {
    const visible = text(html(<TermsPage />));
    expect(visible).toContain("Your first big file is free.");
    expect(visible).toMatch(/free offer, not a sale/);
    expect(visible).toMatch(/one-free-file-per-person limit/);
  });
});

describe("the free limit is written in one place", () => {
  /** Every source file that is not a test or generated, as [path, content]. */
  function sources(dir: string, found: Array<[string, string]> = []): Array<[string, string]> {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, found);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|encoding-fixtures|single-byte-tables/.test(name)) found.push([full, readFileSync(full, "utf8")]);
    }
    return found;
  }

  it("is 100, and exactly 100 rows is free", () => {
    expect(FREE_ROW_LIMIT).toBe(100);
  });

  it("no page, component, share image, guide or checkout text spells out a number of free rows: it all comes from pricing.ts", () => {
    const hardcoded = /\b(50|100)[- ]rows?\b|\b(first|top|over|under|up to|within|than) (50|100)\b|\b(50|100) or fewer\b|=== ?(50|100)\b|<=? ?(50|100)\b/i;
    const offenders = sources(join(process.cwd(), "src"))
      .filter(([path]) => !path.endsWith(join("utils", "pricing.ts")))
      .filter(([, content]) => hardcoded.test(content))
      .map(([path]) => path.replace(process.cwd() + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("every page that mentions the limit shows the same number", () => {
    const pages = [<HomePage key="h" />, <RefundsPage key="r" />, <TermsPage key="t" />, <PrivacyPage key="p" />];
    for (const page of pages) {
      const numbers = [...text(html(page)).matchAll(/\b(\d+)[- ]rows? or fewer|up to (\d+) rows|over (\d+) rows|than (\d+) rows|first (\d+) rows/g)].map((match) => match.slice(1).find(Boolean));
      for (const number of numbers) expect(number).toBe(String(FREE_ROW_LIMIT));
    }
  });
});
