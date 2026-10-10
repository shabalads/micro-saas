// src/app/utils/recovery.ts
//
// Recovery for a customer who paid and closed the tab before Stripe redirected them back, so they never got their
// download. Their file is still parked on this device. On a plain page load, find a parked file whose payment has
// since been confirmed. Unpaid files stay parked (they can still pay later); unpaid files too old to ever be paid
// are deleted so the customer's data does not linger. Pure decision logic with injected I/O, so it is unit-tested.

import type { RawSupplierRow } from "../types/csv";
import type { PurchaseGrant, UnlockResponse } from "../types/unlock";
import { PARKED_MAX_AGE_MS, type ParkedJobMeta } from "./job-store";

/** How many parked files one visit asks the server about. */
export const RECOVERY_CHECK_LIMIT = 5;

export interface RecoveryDeps {
  listParked(): Promise<ParkedJobMeta[]>;
  requestUnlock(sessionId: string): Promise<UnlockResponse>;
  loadData(jobId: string): Promise<RawSupplierRow[] | null>;
  deleteParked(jobId: string): Promise<void>;
  /** True once the visitor has started something else; recovery then backs off and leaves the file parked. */
  isCancelled(): boolean;
  now(): number;
}

export type RecoveryOutcome =
  | { kind: "recovered"; meta: ParkedJobMeta; grant: PurchaseGrant; rawData: RawSupplierRow[] }
  | { kind: "nothing" };

/** Returns the newest parked file that has been paid for, or nothing. One file per visit. */
export async function findRecoverableFile(deps: RecoveryDeps): Promise<RecoveryOutcome> {
  const parked = (await deps.listParked().catch(() => [])).slice().reverse().slice(0, RECOVERY_CHECK_LIMIT); // newest first

  for (const meta of parked) {
    const result = await deps.requestUnlock(meta.sessionId);
    if (deps.isCancelled()) return { kind: "nothing" };

    if (result.status === "paid") {
      const grant = result.purchases[0];
      const rawData = await deps.loadData(meta.jobId).catch(() => null);
      if (deps.isCancelled()) return { kind: "nothing" };
      if (grant && rawData) return { kind: "recovered", meta, grant, rawData };
      continue;
    }

    // Refunded: the payment no longer counts, so there is nothing to hand back and no reason to keep asking. The customer
    // already has the file they uploaded; drop the parked copy.
    if (result.status === "refunded") {
      await deps.deleteParked(meta.jobId).catch(() => {});
      continue;
    }

    // Not paid. A server answer that is not a transient error, for a file past the point where it can be paid: drop it.
    if (result.status !== "error" && deps.now() - meta.savedAt > PARKED_MAX_AGE_MS) {
      await deps.deleteParked(meta.jobId).catch(() => {});
    }
  }
  return { kind: "nothing" };
}
