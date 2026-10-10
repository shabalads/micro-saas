// src/app/utils/db-schema.ts
//
// The database the code expects: every table and column it reads or writes. It is the contract between the code and
// supabase/migrations/*.sql, and it has no imports so a plain `node scripts/check-db.ts` can read it too.
//   - scripts/check-db.ts checks a real database against it;
//   - db-schema.test.ts checks that the migration file creates every table and column listed here.
// Adding a column to the code means adding it here AND to a migration.

export const DB_SCHEMA = {
  usage_telemetry: {
    columns: ["id", "file_name_anonymized", "total_rows", "processing_time_ms", "created_at", "email", "is_unlocked", "fix_count", "file_size_bytes"],
  },
  payment_intents: {
    columns: [
      "id",
      "email",
      "clicked_at",
      "telemetry_id",
      "stripe_session_id",
      "paid_at",
      "file_fingerprint",
      "stripe_payment_intent_id",
      "refunded_at",
      "refund_reason",
      "refund_requested_at",
    ],
  },
  stripe_events: {
    columns: ["event_id", "event_type", "status", "received_at", "processed_at"],
  },
  free_trials: {
    columns: ["id", "email_hash", "browser_id", "file_fingerprint", "created_at", "marketing_email", "marketing_opt_in_at"],
  },
} as const;

export type DbTable = keyof typeof DB_SCHEMA;

/**
 * Uniqueness the code relies on. A duplicate insert must fail with Postgres error 23505: that is how a second checkout
 * session id, a redelivered webhook event, and a second free trial for the same email or browser are told apart from new ones.
 * `others` are the values for the table's other required columns; they must differ between the two probe inserts
 * wherever those columns are unique too, which is why they are a function of the attempt.
 */
export const UNIQUE_KEYS: ReadonlyArray<{ table: DbTable; column: string; others: (marker: string, attempt: number) => Record<string, string> }> = [
  { table: "payment_intents", column: "stripe_session_id", others: () => ({}) },
  { table: "stripe_events", column: "event_id", others: () => ({ event_type: "check_db_probe" }) },
  { table: "free_trials", column: "email_hash", others: (marker, attempt) => ({ browser_id: `${marker}-b${attempt}`, file_fingerprint: "check-db" }) },
  { table: "free_trials", column: "browser_id", others: (marker, attempt) => ({ email_hash: `${marker}-e${attempt}`, file_fingerprint: "check-db" }) },
];
