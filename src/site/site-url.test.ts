import { describe, expect, it } from "vitest";
import { absoluteUrl, getSiteUrl } from "./site-url";

describe("getSiteUrl (NEXT_PUBLIC_SITE_URL)", () => {
  it("returns the configured origin", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://shop.example.test" })).toBe("https://shop.example.test");
  });

  it("strips a trailing slash, a path and a query so derived URLs are never doubled up", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://shop.example.test/" })).toBe("https://shop.example.test");
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://shop.example.test/app?x=1" })).toBe("https://shop.example.test");
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "  https://shop.example.test  " })).toBe("https://shop.example.test");
  });

  it("falls back to localhost in development and tests", () => {
    expect(getSiteUrl({})).toBe("http://localhost:3000");
    expect(getSiteUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("refuses to run in production without it, so canonical URLs can never point at localhost", () => {
    expect(() => getSiteUrl({ NODE_ENV: "production" })).toThrow(/NEXT_PUBLIC_SITE_URL is not set/);
    expect(() => getSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "   " })).toThrow(/not set/);
  });

  it("rejects values that are not http(s) URLs", () => {
    expect(() => getSiteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() => getSiteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://shop.example.test" })).toThrow(/http/);
  });
});

describe("absoluteUrl", () => {
  const env = { NEXT_PUBLIC_SITE_URL: "https://shop.example.test/" };
  it("joins a path onto the origin, with or without a leading slash", () => {
    expect(absoluteUrl("/fix/invalid-handle", env)).toBe("https://shop.example.test/fix/invalid-handle");
    expect(absoluteUrl("fix", env)).toBe("https://shop.example.test/fix");
    expect(absoluteUrl("/", env)).toBe("https://shop.example.test/");
  });
});
