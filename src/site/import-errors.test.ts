import { describe, expect, it } from "vitest";
import { runDemo } from "./demo";
import { IMPORT_ERRORS, getGuide } from "./import-errors";

const words = (text: string) => text.toLowerCase().match(/[a-z']+/g) ?? [];
const wordSet = (text: string) => new Set(words(text));
/** Overlap of two texts' vocabularies, 0 to 1. Used to catch pages that are the same text with a few words swapped. */
const similarity = (a: string, b: string) => {
  const [x, y] = [wordSet(a), wordSet(b)];
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / Math.min(x.size, y.size);
};

describe("the programmatic SEO guides (data integrity)", () => {
  it("has between 15 and 20 guides", () => {
    expect(IMPORT_ERRORS.length).toBeGreaterThanOrEqual(15);
    expect(IMPORT_ERRORS.length).toBeLessThanOrEqual(20);
  });

  it("includes the four topics that were asked for", () => {
    const slugs = IMPORT_ERRORS.map((guide) => guide.slug).join(" ");
    for (const topic of ["variant-image-position", "invalid-handle", "price-format", "encoding-broken-characters"]) expect(slugs).toContain(topic);
  });

  it("has unique, URL-safe slugs and unique titles, descriptions and headings", () => {
    for (const field of ["slug", "title", "description", "heading"] as const) {
      expect(new Set(IMPORT_ERRORS.map((guide) => guide[field])).size, field).toBe(IMPORT_ERRORS.length);
    }
    for (const guide of IMPORT_ERRORS) expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(IMPORT_ERRORS.map((guide) => [guide.slug, guide] as const))("%s has complete, search-friendly content", (_slug, guide) => {
    expect(guide.title.length, "title <= 60 characters").toBeLessThanOrEqual(60);
    expect(guide.description.length, "description 70-155 characters").toBeGreaterThanOrEqual(70);
    expect(guide.description.length).toBeLessThanOrEqual(155);
    expect(words(guide.intro).length, "intro has real substance").toBeGreaterThanOrEqual(40);
    expect(guide.causes.length).toBeGreaterThanOrEqual(2);
    expect(guide.steps.length).toBeGreaterThanOrEqual(4);
    expect(words(guide.toolNote).length).toBeGreaterThanOrEqual(20);
    expect(guide.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(guide)).not.toMatch(/TODO|lorem|\[\[|undefined/i);
  });

  it("links only to guides that exist, never to itself", () => {
    for (const guide of IMPORT_ERRORS) {
      expect(guide.related.length).toBeGreaterThanOrEqual(2);
      for (const slug of guide.related) {
        expect(getGuide(slug), `${guide.slug} -> ${slug}`).toBeDefined();
        expect(slug).not.toBe(guide.slug);
      }
    }
  });

  it("gives every page its own intro: no two pages share their opening or are near-copies", () => {
    for (let i = 0; i < IMPORT_ERRORS.length; i++) {
      for (let j = i + 1; j < IMPORT_ERRORS.length; j++) {
        const [a, b] = [IMPORT_ERRORS[i], IMPORT_ERRORS[j]];
        expect(a.intro.slice(0, 60), `${a.slug} vs ${b.slug}`).not.toBe(b.intro.slice(0, 60));
        expect(similarity(a.intro, b.intro), `intro of ${a.slug} vs ${b.slug}`).toBeLessThan(0.7);
        expect(similarity(a.causes.join(" "), b.causes.join(" ")), `causes of ${a.slug} vs ${b.slug}`).toBeLessThan(0.7);
      }
    }
  });

  it("only quotes a Shopify message when it is one of the exact strings from Shopify's help center", () => {
    const official = [
      'Ignored line #-## because handle "example" already exists',
      "Ignored line #-## because it did not contain product data",
      "Missing or stray quote on line",
      "Invalid CSV header: missing headers",
      "Validation failed: An error occurred while trying to download the image",
      "Validation failed: getaddrinfo: nodename nor servname provided, or not known",
      "Validation failed: options are not unique",
      "Validation failed: price can't be blank",
    ];
    for (const guide of IMPORT_ERRORS) {
      if (guide.shopifyMessage !== null) expect(official, guide.slug).toContain(guide.shopifyMessage);
    }
    expect(IMPORT_ERRORS.filter((guide) => guide.shopifyMessage !== null).length).toBe(official.length);
  });
});

describe("the demos run through the real parser and sanitizer", () => {
  it.each(IMPORT_ERRORS.filter((guide) => guide.demo).map((guide) => [guide.slug, guide] as const))("%s: output contains what the guide promises", (_slug, guide) => {
    const result = runDemo(guide.demo!);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines.map((line) => line.after).join("\n")).toContain(guide.demo!.expect);
  });

  it("a guide that claims 'fixes' really changes its example (before differs from after)", () => {
    const fixers = IMPORT_ERRORS.filter((guide) => guide.coverage === "fixes");
    expect(fixers.length).toBeGreaterThanOrEqual(8);
    for (const guide of fixers) {
      expect(guide.demo, `${guide.slug} claims to fix automatically, so it needs a demo`).not.toBeNull();
      const { lines } = runDemo(guide.demo!);
      expect(lines.some((line) => line.before !== line.after), guide.slug).toBe(true);
    }
  });

  it("is honest about what it does not do: 'manual' and 'partly fixed' guides each say what is left to the user", () => {
    const admitting = IMPORT_ERRORS.filter((guide) => guide.coverage !== "fixes");
    expect(admitting.length).toBeGreaterThanOrEqual(1);
    for (const guide of admitting) expect(guide.toolNote, guide.slug).toMatch(/does not|not create|cannot|never|still fix|yourself/i);
    for (const guide of IMPORT_ERRORS.filter((entry) => entry.coverage === "manual")) expect(guide.demo, guide.slug).toBeNull();
  });

  it("demonstrates the specific behaviours the copy describes", () => {
    const after = (slug: string) => runDemo(getGuide(slug)!.demo!).lines.map((line) => line.after).join("\n");
    expect(after("price-format").split("\n")).toEqual(["1299.00", "1299.00", "89.90", "1299.00"]);
    expect(after("ignored-line-handle-already-exists").split("\n")).toEqual(["mug", "mug-2", "mug-3"]);
    expect(after("title-all-caps")).toContain("Stainless Steel Water Bottle 750ml");
    expect(after("invalid-handle")).toContain("cokolada-and-mleko");
    // bare file names are dropped, not glued into a URL
    expect(after("image-download-error")).not.toContain("wallet-brown");
    expect(after("image-download-error").split("\n")).toEqual(["https://cdn.example.com/wallet-1.jpg", "https://www.example.com/wallet-2.jpg"]);
    // the broken quote no longer swallows the following row
    expect(after("missing-or-stray-quote-on-line")).toContain("next-cup | Next cup | 7.00")  // already mixed case, so left exactly as written;
    // the legacy markup demo shrinks
    expect(runDemo(getGuide("csv-file-too-large")!.demo!).note).toMatch(/\d+ bytes of description before, \d+ after/);
  });

  it("the encoding demo shows the problem Shopify sees (Czech saved as Windows-1250) and the fix", () => {
    const demo = runDemo(getGuide("encoding-broken-characters")!.demo!);
    const [line] = demo.lines;
    expect(line.before).toContain("�");
    expect(line.after).toBe("Žlutý kůň – příliš černé boty, 249 Kč");
    expect(demo.note).toMatch(/Windows-1250.*settled on Windows-1250/);
  });

  it("the options demo shows names once and a value per variant, as Shopify wants", () => {
    const [line] = runDemo(getGuide("options-are-not-unique")!.demo!).lines;
    expect(line.after.split("\n")).toEqual([
      "Handle | Title | Option1 Name | Option1 Value | Option2 Name | Option2 Value",
      "classic-tee | Classic Tee | Size | S | Color | Navy",
      "classic-tee |   |   | M |   | Navy",
      "classic-tee |   |   | S |   | Red",
    ]);
  });
});
