// src/app/utils/trial-client.ts
//
// Browser side of the free first big file: the random browser id, and the call to POST /api/trial. The browser id is one
// of the two things that make "one per browser" mean something (the other is an httpOnly cookie the server sets), and it
// carries no personal data: it is random.

import type { TrialResponse } from "../types/unlock";

const BROWSER_ID_KEY = "csv-sanitizer:browser-id:v1";
const BROWSER_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 24 random bytes as URL-safe text. getRandomValues also works on plain http (LAN addresses), unlike crypto.randomUUID. */
function randomId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memoryId: string | null = null;

/** This browser's id, created on first use. If localStorage is blocked it lasts for the page's lifetime only. */
export function getBrowserId(): string {
  try {
    const stored = localStorage.getItem(BROWSER_ID_KEY);
    if (stored && BROWSER_ID_RE.test(stored)) return stored;
    const fresh = memoryId ?? randomId();
    localStorage.setItem(BROWSER_ID_KEY, fresh);
    return fresh;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

/** The server settles on one id (its cookie wins when it differs): keep it, so localStorage and the cookie agree. */
export function adoptBrowserId(id: string): void {
  if (!BROWSER_ID_RE.test(id)) return;
  memoryId = id;
  try {
    localStorage.setItem(BROWSER_ID_KEY, id);
  } catch {
    /* blocked: the cookie still identifies the browser */
  }
}

const NETWORK_ERROR: TrialResponse = { status: "error", message: "We couldn't reach the server. Check your connection and try again." };

/** POST /api/trial. Never throws: every failure becomes a { status } the UI can show. */
export async function requestTrial(
  body: { action: "claim"; email: string; marketingOptIn: boolean; fingerprint: string; rowCount: number } | { action: "renew"; fingerprint: string },
): Promise<TrialResponse> {
  try {
    const response = await fetch("/api/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, browserId: getBrowserId() }),
    });
    const data = (await response.json().catch(() => null)) as TrialResponse | null;
    if (data && typeof data === "object" && "status" in data) {
      if (data.status === "granted") adoptBrowserId(data.browserId);
      return data;
    }
    return { status: "error", message: "Unexpected response from the server." };
  } catch {
    return NETWORK_ERROR;
  }
}
