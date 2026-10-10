// src/site/site-url.ts
//
// The public origin of the site (for example https://yourshop.com), from NEXT_PUBLIC_SITE_URL. Every canonical link, sitemap entry,
// OpenGraph URL and structured-data URL is built from this one value, so there are no hard-coded domains anywhere.
// NEXT_PUBLIC_ variables are inlined at BUILD time: set it where the site is built, not only where it runs.

const DEV_FALLBACK = "http://localhost:3000";

/**
 * Returns the origin without a trailing slash. In production a missing or malformed value is an error, so a build can
 * never ship pages whose canonical URLs point at localhost. In development and tests it falls back to localhost.
 */
export function getSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? "").trim();

  if (raw === "") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_SITE_URL is not set. Set it to the public https origin of the site (for example https://yourshop.com) wherever the site is built.",
      );
    }
    return DEV_FALLBACK;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid URL: "${raw}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_SITE_URL must start with http:// or https://, got "${raw}".`);
  }
  // Only the origin counts: a path, query or trailing slash would make every derived URL wrong.
  return url.origin;
}

/** Joins a site path onto the origin: absoluteUrl("/fix/x") is NEXT_PUBLIC_SITE_URL followed by "/fix/x". */
export function absoluteUrl(path: string, env?: Record<string, string | undefined>): string {
  return `${getSiteUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
