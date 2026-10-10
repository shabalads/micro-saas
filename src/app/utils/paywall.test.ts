import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import { fingerprintRows, isFingerprint, isFreeFile, previewRows } from "./paywall";
import { FREE_ROW_LIMIT } from "./pricing";
import { sanitizeDataset } from "./sanitizer";
import { ExportBlockedError, exportCleanedFile } from "./unlock-client";

const rows = (n: number, label = "Q"): RawSupplierRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1), title: `WIDGET ${label} ${i + 1}`, description: `<div>Desc ${i + 1}</div>`,
    images: `https://cdn.example.com/${i + 1}.jpg`, price: `$${i + 1}.00`, sku: `SKU-${i + 1}`,
  }));

describe("the free limit", () => {
  it("is exactly FREE_ROW_LIMIT (100) rows: 100 is free, 101 is not", () => {
    expect(FREE_ROW_LIMIT).toBe(100);
    expect(isFreeFile(0)).toBe(true);
    expect(isFreeFile(1)).toBe(true);
    expect(isFreeFile(FREE_ROW_LIMIT - 1)).toBe(true);
    expect(isFreeFile(FREE_ROW_LIMIT)).toBe(true);
    expect(isFreeFile(FREE_ROW_LIMIT + 1)).toBe(false);
    expect(isFreeFile(5000)).toBe(false);
    expect([99, 100, 101].map(isFreeFile)).toEqual([true, true, false]);
  });

  it("previews at most the first FREE_ROW_LIMIT rows, and a free file in full", () => {
    expect(previewRows(rows(FREE_ROW_LIMIT + 1))).toHaveLength(FREE_ROW_LIMIT);
    expect(previewRows(rows(FREE_ROW_LIMIT + 1))[FREE_ROW_LIMIT - 1].id).toBe(String(FREE_ROW_LIMIT));
    expect(previewRows(rows(FREE_ROW_LIMIT))).toHaveLength(FREE_ROW_LIMIT);
    expect(previewRows(rows(7))).toHaveLength(7);
    expect(previewRows([])).toEqual([]);
  });

  it("cleaning the preview of a huge file only ever touches FREE_ROW_LIMIT rows", () => {
    const { rows: cleaned, report } = sanitizeDataset(previewRows(rows(10_000)));
    expect(report.sourceRows).toBe(FREE_ROW_LIMIT);
    expect(cleaned).toHaveLength(FREE_ROW_LIMIT);
  });
});

describe("isFingerprint (what fingerprintRows produces, and nothing else)", () => {
  it.each(["sha256:" + "ab".repeat(32), "fnv:0123456789abcdef"])("accepts %s", (value) => expect(isFingerprint(value)).toBe(true));
  it.each([null, undefined, 5, "", "sha256:", "sha256:xyz", "sha256:" + "ab".repeat(80), "SHA256:" + "ab".repeat(32), "../etc/passwd", "sha256:" + "ab".repeat(32) + "\n"])("rejects %j", (value) => expect(isFingerprint(value)).toBe(false));
});

describe("fingerprintRows (ties a payment to one file)", () => {
  it("is stable and has the sha256 format the checkout route accepts", async () => {
    const a = await fingerprintRows(rows(FREE_ROW_LIMIT + 10));
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await fingerprintRows(rows(FREE_ROW_LIMIT + 10))).toBe(a);
  });

  it("changes when any content or the row order changes, and differs per file", async () => {
    const base = rows(FREE_ROW_LIMIT + 10);
    const fp = await fingerprintRows(base);
    expect(await fingerprintRows(rows(FREE_ROW_LIMIT + 10, "B"))).not.toBe(fp);
    expect(await fingerprintRows(rows(FREE_ROW_LIMIT + 11))).not.toBe(fp);
    expect(await fingerprintRows([...base].reverse())).not.toBe(fp);
    const edited = base.map((r, i) => (i === FREE_ROW_LIMIT + 9 ? { ...r, price: "$999.00" } : r));
    expect(await fingerprintRows(edited)).not.toBe(fp);
  });

  it("falls back to a deterministic hash where crypto.subtle does not exist (plain http on a LAN address)", async () => {
    vi.stubGlobal("crypto", {});
    try {
      const fp = await fingerprintRows(rows(FREE_ROW_LIMIT + 10));
      expect(fp).toMatch(/^fnv:[0-9a-f]{16}$/);
      expect(await fingerprintRows(rows(FREE_ROW_LIMIT + 10))).toBe(fp);
      expect(await fingerprintRows(rows(FREE_ROW_LIMIT + 11))).not.toBe(fp);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the paid export gate (unlock-client + the lazily imported module)", () => {
  /** Minimal browser pieces that the export module touches. */
  function stubBrowser() {
    // Blob.text() drops a UTF-8 BOM by spec, so keep the raw bytes and decode them with the BOM preserved.
    const downloads: Array<{ name: string; text: Promise<string>; bytes: Promise<Uint8Array> }> = [];
    let lastBlob: Blob | null = null;
    vi.stubGlobal("document", {
      createElement: () => ({ href: "", download: "", click() {
        const blob = lastBlob!;
        downloads.push({
          name: this.download,
          text: blob.arrayBuffer().then((buffer) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer)),
          bytes: blob.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        });
      }, remove() {} }),
      body: { appendChild() {} },
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { lastBlob = blob as Blob; return "blob:test"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return downloads;
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a file within the free limit downloads without a token and without asking the server", async () => {
    const downloads = stubBrowser();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await exportCleanedFile({ rows: rows(FREE_ROW_LIMIT), fileName: "Free feed.csv", token: null });
    expect(result.products).toBe(FREE_ROW_LIMIT);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(downloads[0].name).toBe("Free-feed-shopify-clean.csv");
  });

  it("a file over the limit is refused without a token, and the server is never even asked", async () => {
    const downloads = stubBrowser();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 1), fileName: "big.csv", token: null })).rejects.toMatchObject({ reason: "token" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(0);
  });

  it("a token the server rejects (expired or forged) produces no file", async () => {
    const downloads = stubBrowser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: false }), { status: 401 })));
    await expect(exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 10), fileName: "big.csv", token: "forged.token" })).rejects.toBeInstanceOf(ExportBlockedError);
    await expect(exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 10), fileName: "big.csv", token: "forged.token" })).rejects.toMatchObject({ reason: "token" });
    expect(downloads).toHaveLength(0);
  });

  it("an unreachable or failing server also produces no file (and says it is unavailable, not that payment failed)", async () => {
    const downloads = stubBrowser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 10), fileName: "big.csv", token: "t" })).rejects.toMatchObject({ reason: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 10), fileName: "big.csv", token: "t" })).rejects.toMatchObject({ reason: "unavailable" });
    expect(downloads).toHaveLength(0);
  });

  it("a token the server accepts unlocks the COMPLETE cleaned file (every row, not just the preview)", async () => {
    const downloads = stubBrowser();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ valid: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await exportCleanedFile({ rows: rows(FREE_ROW_LIMIT + 70), fileName: "big.csv", token: "good.token" });
    expect(fetchSpy).toHaveBeenCalledWith("/api/unlock/verify", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "good.token", fingerprint: null }) }));
    expect(result).toMatchObject({ products: FREE_ROW_LIMIT + 70, outputRows: FREE_ROW_LIMIT + 70 });
    const csv = await downloads[0].text;
    expect(csv.startsWith("﻿Handle,Title,Body (HTML),Image Src,Variant Price,Variant SKU\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(FREE_ROW_LIMIT + 71);
    expect(csv).toContain("widget-q-120,Widget Q 120,<p>Desc 120</p>");
  });
});
