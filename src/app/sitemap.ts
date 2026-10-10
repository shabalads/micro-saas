import type { MetadataRoute } from "next";
import { IMPORT_ERRORS } from "../site/import-errors";
import { SITE_UPDATED } from "../site/metadata";
import { absoluteUrl } from "../site/site-url";

/** Every public page, with absolute URLs built from NEXT_PUBLIC_SITE_URL. Utility and admin pages are left out on purpose. */
export default function sitemap(): MetadataRoute.Sitemap {
  const legal = ["/privacy", "/terms", "/refunds", "/contact"].map((path) => ({
    url: absoluteUrl(path),
    lastModified: SITE_UPDATED,
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));

  return [
    { url: absoluteUrl("/"), lastModified: SITE_UPDATED, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/fix"), lastModified: SITE_UPDATED, changeFrequency: "weekly", priority: 0.8 },
    ...IMPORT_ERRORS.map((guide) => ({
      url: absoluteUrl(`/fix/${guide.slug}`),
      lastModified: guide.updated,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...legal,
  ];
}
