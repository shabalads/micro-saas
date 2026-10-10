// src/site/metadata.ts
//
// One place that builds a page's metadata, so every page gets the same canonical URL, OpenGraph and Twitter tags.
// The OpenGraph image comes from the opengraph-image file convention in the route (see app/opengraph-image.tsx and
// app/fix/[slug]/opengraph-image.tsx), which Next adds to the page automatically.

import type { Metadata } from "next";
import { FREE_ROW_LIMIT } from "../app/utils/pricing";
import { COMPANY } from "./company";
import { absoluteUrl } from "./site-url";

/** Last time the site-level content changed (used by the sitemap). */
export const SITE_UPDATED = "2026-10-09";

export const SITE_NAME = COMPANY.brandName;
export const SITE_TAGLINE = "Clean supplier CSVs in your browser";
export const SITE_DESCRIPTION = `Fix ALL CAPS titles, strip legacy HTML, generate handles and split image cells in a messy supplier CSV, then download a Shopify-ready file. Processed in your browser, never uploaded. Free up to ${FREE_ROW_LIMIT} rows.`;

/** The site-wide share image (app/opengraph-image.tsx). A page that sets its own `openGraph` does not inherit it, so it is added explicitly. */
const DEFAULT_SHARE_IMAGE = { path: "/opengraph-image", width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` };

export function pageMetadata(options: {
  title: string;
  description: string;
  /** Path of the page, e.g. "/fix/invalid-handle". Becomes the canonical URL and og:url. */
  path: string;
  /** Use the title as written, without the " | Brand" suffix the root layout adds. */
  absoluteTitle?: boolean;
  /** Keep the page out of search results (utility pages). */
  noindex?: boolean;
  type?: "website" | "article";
  /** Set when the route has its own opengraph-image file (the guides): an explicit image here would override it. */
  hasOwnShareImage?: boolean;
  /** ISO date the content was last changed (articles only). */
  modified?: string;
}): Metadata {
  const url = absoluteUrl(options.path);
  const fullTitle = options.absoluteTitle ? options.title : `${options.title} | ${SITE_NAME}`;
  const image = { url: absoluteUrl(DEFAULT_SHARE_IMAGE.path), width: DEFAULT_SHARE_IMAGE.width, height: DEFAULT_SHARE_IMAGE.height, alt: DEFAULT_SHARE_IMAGE.alt };
  return {
    title: options.absoluteTitle ? { absolute: options.title } : options.title,
    description: options.description,
    alternates: { canonical: url },
    robots: options.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: options.type ?? "website",
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description: options.description,
      locale: "en_US",
      ...(options.hasOwnShareImage ? {} : { images: [image] }),
      ...(options.type === "article" && options.modified ? { modifiedTime: options.modified } : {}),
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: options.description, ...(options.hasOwnShareImage ? {} : { images: [image.url] }) },
  };
}
