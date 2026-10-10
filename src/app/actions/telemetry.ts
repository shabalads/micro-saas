// src/app/actions/telemetry.ts
"use server";

import type { UsageTelemetryInput } from "../types/telemetry";
import { TELEMETRY_TABLE, getSupabaseAdmin, logSupabaseError, toSafeCount } from "../utils/telemetry-db";

const MAX_FILE_NAME_LENGTH = 255;

/*
 * PRIVACY: usage telemetry records ONLY row counts, timings, fix counts and the file size, plus a one-way hash of
 * the file name. It NEVER contains file contents: no cell values, titles, descriptions, SKUs, prices, URLs or
 * file text of any kind, and no real file name. This is enforced here, not trusted to the caller: the row is built
 * field by field from validated numbers, so any extra property a client sends is ignored. Keep it that way: do not
 * add free-text or per-row fields to UsageTelemetryInput.
 *
 * Telemetry also never holds an email address or anything from the free-first-file flow (/api/trial, table free_trials):
 * that record is a keyed hash of the email plus a random browser id and a file fingerprint, and nothing links it to a
 * telemetry row. Do not add an email, a browser id or a fingerprint here, or the privacy policy stops being true.
 */

/**
 * Logs one anonymous usage record. This must never get in the user's way, so it never throws:
 * on any failure it logs on the server and returns null.
 *
 * Returns the id of the new row, which later links a checkout to the same usage record.
 */
export async function logUsageTelemetry(data: UsageTelemetryInput): Promise<string | null> {
  try {
    // This is a public endpoint: re-validate everything instead of trusting the TypeScript types.
    const fileNameAnonymized =
      typeof data?.file_name_anonymized === "string" ? data.file_name_anonymized.trim().slice(0, MAX_FILE_NAME_LENGTH) : "";
    const totalRows = toSafeCount(data?.total_rows);
    const processingTimeMs = toSafeCount(data?.processing_time_ms);
    const fixCount = toSafeCount(data?.fix_count);
    const fileSizeBytes = toSafeCount(data?.file_size_bytes);
    if (fileNameAnonymized === "" || totalRows === null || processingTimeMs === null || fixCount === null || fileSizeBytes === null) {
      return null;
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    // Column names must match the real usage_telemetry table exactly; id and created_at have defaults.
    const { data: inserted, error } = await supabase
      .from(TELEMETRY_TABLE)
      .insert({
        file_name_anonymized: fileNameAnonymized,
        total_rows: totalRows,
        processing_time_ms: processingTimeMs,
        fix_count: fixCount,
        file_size_bytes: fileSizeBytes,
      })
      .select("id")
      .single();

    if (error) {
      logSupabaseError("logUsageTelemetry insert", error);
      return null;
    }
    return inserted?.id != null ? String(inserted.id) : null;
  } catch (error) {
    logSupabaseError("logUsageTelemetry catch", error);
    return null;
  }
}
