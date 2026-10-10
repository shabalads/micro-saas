// src/app/types/telemetry.ts

/**
 * What usage telemetry may contain, and nothing else: counts, timings and a size. See the PRIVACY note in
 * actions/telemetry.ts. The fields mirror the usage_telemetry columns of the same name.
 */
export interface UsageTelemetryInput {
  /** One-way hash of the file name plus its extension (utils/anonymize.ts). Never the name itself. */
  file_name_anonymized: string;
  /** Number of data rows in the upload. */
  total_rows: number;
  /** How long cleaning the preview took, in milliseconds. */
  processing_time_ms: number;
  /** How many individual fixes the cleaner applied (titles, descriptions, handles, image cells, prices). */
  fix_count: number;
  /** Size of the uploaded file in bytes. */
  file_size_bytes: number;
}
