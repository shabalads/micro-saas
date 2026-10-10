// src/app/utils/unlock-client.ts
//
// Browser-side half of the paywall: ask the server for an unlock token, and only then load the paid export module.

import type { RawSupplierRow } from "../types/csv";
import type { PurchaseGrant, UnlockResponse } from "../types/unlock";
import { isFreeFile } from "./paywall";

const NETWORK_ERROR: UnlockResponse = { status: "error", message: "We couldn't reach the server. Check your connection and try again." };

/** POST /api/unlock. Never throws: every failure becomes a { status } the UI can show. */
export async function requestUnlock(body: { sessionId: string } | { email: string }): Promise<UnlockResponse> {
  try {
    const response = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as UnlockResponse | null;
    if (data && typeof data === "object" && "status" in data) return data;
    return { status: "error", message: "Unexpected response from the server." };
  } catch {
    return NETWORK_ERROR;
  }
}

/**
 * Asks for an unlock token for a Stripe session, retrying while Stripe has not confirmed the payment yet (the
 * customer is often back before the webhook, or before the card network settles).
 */
export async function waitForUnlock(
  sessionId: string,
  options: { attempts?: number; delayMs?: number; isCancelled?: () => boolean } = {},
): Promise<UnlockResponse> {
  const { attempts = 8, delayMs = 2000, isCancelled = () => false } = options;
  let result: UnlockResponse = { status: "pending" };
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = await requestUnlock({ sessionId });
    if (result.status !== "pending" || isCancelled()) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return result;
}

/** True while a grant's token still has comfortable time left. */
export function isGrantFresh(grant: Pick<PurchaseGrant, "expiresAt"> | null, now: number = Date.now()): boolean {
  return grant !== null && grant.expiresAt - now > 30_000;
}

export class ExportBlockedError extends Error {
  constructor(
    /** "token": the server did not accept the token (missing, expired or forged); "refunded": the payment was refunded or disputed; "unavailable": it could not be checked. */
    readonly reason: "token" | "refunded" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ExportBlockedError";
  }
}

/**
 * Produces the cleaned CSV download. Files within the free limit go straight through. For anything larger the server
 * must accept the token first, and only then is the paid export module even loaded; before that its code is not
 * fetched, let alone run.
 */
export async function exportCleanedFile(params: {
  rows: RawSupplierRow[];
  fileName: string | null;
  token: string | null;
  /** The file about to be exported. A free-trial token is only good for the file it was issued for, so the server is told which. */
  fingerprint?: string | null;
}): Promise<{ products: number; outputRows: number }> {
  if (!isFreeFile(params.rows.length)) {
    if (!params.token) throw new ExportBlockedError("token", "This file needs to be unlocked first.");
    let response: Response;
    try {
      response = await fetch("/api/unlock/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token, fingerprint: params.fingerprint ?? null }),
      });
    } catch {
      throw new ExportBlockedError("unavailable", "We couldn't reach the server to confirm your payment.");
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as { reason?: unknown } | null;
      if (body?.reason === "refunded") throw new ExportBlockedError("refunded", "This payment was refunded.");
      throw new ExportBlockedError("token", "The server did not accept your unlock.");
    }
    if (response.status === 401) throw new ExportBlockedError("token", "Your unlock has expired.");
    if (!response.ok) throw new ExportBlockedError("unavailable", "We couldn't confirm your payment right now.");
  }

  const { exportCleanedCsv } = await import("../full-export/full-export");
  return exportCleanedCsv({ rows: params.rows, fileName: params.fileName, token: params.token });
}
