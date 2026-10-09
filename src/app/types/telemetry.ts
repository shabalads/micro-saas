// src/app/types/telemetry.ts

/**
 * Anonymous usage numbers logged once per cleaned file. File contents are never sent, and neither is
 * the real file name: `file_name_anonymized` is a short hash plus the extension (see utils/anonymize.ts).
 * The fields mirror the usage_telemetry columns of the same name.
 */
export interface UsageTelemetryInput {
  file_name_anonymized: string;
  total_rows: number;
  processing_time_ms: number;
}

/**
 * What the return page learns about a payment:
 * paid = unlocked, pending = Stripe has not confirmed it yet (retry shortly),
 * invalid = the session does not belong to this job, error = something failed on our side.
 */
export type VerifyCheckoutResult =
  | { status: "paid" }
  | { status: "pending" }
  | { status: "invalid" }
  | { status: "error" };
