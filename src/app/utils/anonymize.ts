// src/app/utils/anonymize.ts

/**
 * Turns a file name into a short, stable token so usage stats never contain real file names (they often
 * carry supplier or customer names): "Acme Q3 Pricing.CSV" becomes something like "3f9a1c2b7d4e.csv".
 * The same name always gives the same token, so repeat uploads can still be counted.
 * This runs in the browser, so the real name never leaves the device.
 */
export async function anonymizeFileName(fileName: string): Promise<string> {
  const name = fileName.trim().toLowerCase();
  const extension = /\.[a-z0-9]{1,5}$/.exec(name)?.[0] ?? "";

  // crypto.subtle only exists in secure contexts (https or localhost), e.g. not on http://192.168.x.x.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `unknown${extension}`;

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(name));
  const token = Array.from(new Uint8Array(digest).slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${token}${extension}`;
}
