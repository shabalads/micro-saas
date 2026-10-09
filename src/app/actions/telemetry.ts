// src/app/actions/telemetry.ts
"use server";

import type { UsageTelemetryInput } from "../types/telemetry";
import { TELEMETRY_TABLE, getSupabaseAdmin, logSupabaseError, toSafeCount } from "../utils/telemetry-db";

const MAX_FILE_NAME_LENGTH = 255;

/**
 * Logs one anonymous usage record. This must never get in the user's way, so it never throws:
 * on any failure it logs on the server and returns null.
 *
 * Returns the id of the new row so a later lead email can be attached to the same usage record.
 */
export async function logUsageTelemetry(data: UsageTelemetryInput): Promise<string | null> {
  try {
    // This is a public endpoint: re-validate everything instead of trusting the TypeScript types.
    const fileNameAnonymized =
      typeof data?.file_name_anonymized === "string" ? data.file_name_anonymized.trim().slice(0, MAX_FILE_NAME_LENGTH) : "";
    const totalRows = toSafeCount(data?.total_rows);
    const processingTimeMs = toSafeCount(data?.processing_time_ms);
    if (fileNameAnonymized === "" || totalRows === null || processingTimeMs === null) return null;

    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    // Column names must match the real usage_telemetry table exactly; id and created_at have defaults.
    const { data: inserted, error } = await supabase
      .from(TELEMETRY_TABLE)
      .insert({
        file_name_anonymized: fileNameAnonymized,
        total_rows: totalRows,
        processing_time_ms: processingTimeMs,
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
