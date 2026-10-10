import { beforeAll, describe, expect, it, vi } from "vitest";
import { IMPORT_ERRORS } from "../site/import-errors";

vi.hoisted(() => { process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example.test"; });

import robots from "./robots";
import sitemap from "./sitemap";

describe("sitemap.xml", () => {
  let entries: ReturnType<typeof sitemap>;
  beforeAll(() => { entries = sitemap(); });

  it("lists the home page, the guide index, every guide and the legal pages", () => {
    const urls = entries.map((entry) => entry.url);
    for (const path of ["/", "/fix", "/privacy", "/terms", "/refunds", "/contact"]) expect(urls).toContain(`https://shop.example.test${path}`);
    for (const guide of IMPORT_ERRORS) expect(urls).toContain(`https://shop.example.test/fix/${guide.slug}`);
    expect(entries.length).toBe(IMPORT_ERRORS.length + 6);
  });

  it("uses only absolute URLs built from NEXT_PUBLIC_SITE_URL, with no duplicates and no localhost", () => {
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).toMatch(/^https:\/\/shop\.example\.test(\/|$)/);
    expect(urls.join(" ")).not.toMatch(/localhost|example\.com|your-domain/);
  });

  it("leaves out pages that must not be indexed", () => {
    const urls = entries.map((entry) => entry.url).join(" ");
    expect(urls).not.toMatch(/\/admin|\/recover|\/api\//);
  });

  it("gives each guide the date it was last reviewed, and every entry a valid priority", () => {
    for (const guide of IMPORT_ERRORS) expect(entries.find((entry) => entry.url.endsWith(`/fix/${guide.slug}`))?.lastModified).toBe(guide.updated);
    for (const entry of entries) expect(entry.priority).toBeGreaterThan(0);
  });
});

describe("robots.txt", () => {
  it("allows the site, keeps crawlers out of the API, admin and recover pages, and points at the sitemap", () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(["/api/", "/admin", "/recover"]);
    expect(result.sitemap).toBe("https://shop.example.test/sitemap.xml");
    expect(result.host).toBe("https://shop.example.test");
  });
});
