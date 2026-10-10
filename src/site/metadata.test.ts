import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example.test"; });

import { SITE_NAME, SITE_TAGLINE, pageMetadata } from "./metadata";

describe("pageMetadata", () => {
  const meta = pageMetadata({ title: "Terms of Service", description: "The terms.", path: "/terms" });

  it("builds an absolute canonical URL and the same OpenGraph URL from NEXT_PUBLIC_SITE_URL", () => {
    expect(meta.alternates?.canonical).toBe("https://shop.example.test/terms");
    expect(meta.openGraph).toMatchObject({ url: "https://shop.example.test/terms", siteName: SITE_NAME, type: "website" });
  });

  it("adds the site share image explicitly, because a page that sets openGraph does not inherit the file-based one", () => {
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: "https://shop.example.test/opengraph-image", width: 1200, height: 630 })]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: ["https://shop.example.test/opengraph-image"] });
  });

  it("leaves the image to the route's own opengraph-image file when it has one", () => {
    const own = pageMetadata({ title: "t", description: "d", path: "/fix/x", hasOwnShareImage: true });
    expect(own.openGraph).not.toHaveProperty("images");
    expect(own.twitter).not.toHaveProperty("images");
  });

  it("appends the brand to ordinary titles and leaves absolute titles alone", () => {
    expect(meta.openGraph).toMatchObject({ title: `Terms of Service | ${SITE_NAME}` });
    const absolute = pageMetadata({ title: "Exact title", absoluteTitle: true, description: "d", path: "/x" });
    expect(absolute.title).toEqual({ absolute: "Exact title" });
    expect(absolute.openGraph).toMatchObject({ title: "Exact title" });
  });

  it("can keep a page out of search results", () => {
    expect(pageMetadata({ title: "t", description: "d", path: "/recover", noindex: true }).robots).toEqual({ index: false, follow: false });
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("keeps the home page title short enough for a search result", () => {
    expect(`${SITE_NAME}: ${SITE_TAGLINE}`.length).toBeLessThanOrEqual(60);
  });
});
