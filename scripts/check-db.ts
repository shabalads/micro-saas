// scripts/check-db.ts
//
// Checks the REAL Supabase project against what the code uses: every table and column in src/app/utils/db-schema.ts,
// and (with --probe-constraints) the uniqueness the webhook and checkout rely on. Rerun it any time:
//
//   npm run db:check                       read-only: tables, columns, row level security
//   npm run db:check -- --probe-constraints   also inserts and deletes two throw-away rows to prove the unique keys work
//
// Reads NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY from .env.local. It never prints a
// key. Exit code 0 = everything is in place, 1 = something is missing or wrong, 2 = it could not run.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { DB_SCHEMA, UNIQUE_KEYS } from "../src/app/utils/db-schema.ts";
import type { DbTable } from "../src/app/utils/db-schema.ts";

export interface ColumnResult {
  column: string;
  ok: boolean;
  detail?: string;
}
export interface TableResult {
  table: DbTable;
  exists: boolean;
  columns: ColumnResult[];
  /** What the public (anon) key can see. "protected" = nothing, "open" = it can read rows, "unknown" = empty table or no key. */
  publicAccess: "protected" | "open" | "unknown";
  detail?: string;
}
export interface ProbeResult {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface DbReport {
  tables: TableResult[];
  probes: ProbeResult[];
  ok: boolean;
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/** PGRST205 / 42P01: the table is not there. 42703 / PGRST204: the column is not there. */
function isMissingTable(error: PostgrestLikeError): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

async function checkTable(admin: SupabaseClient, anon: SupabaseClient | null, table: DbTable): Promise<TableResult> {
  const columns = DB_SCHEMA[table].columns;
  const first = await admin.from(table).select(columns[0]).limit(0);
  if (first.error && isMissingTable(first.error)) {
    return { table, exists: false, columns: columns.map((column) => ({ column, ok: false, detail: "table is missing" })), publicAccess: "unknown", detail: first.error.message };
  }
  if (first.error && first.error.code !== "42703") {
    return { table, exists: false, columns: columns.map((column) => ({ column, ok: false })), publicAccess: "unknown", detail: `${first.error.code ?? ""} ${first.error.message}`.trim() };
  }

  const results = await Promise.all(
    columns.map(async (column): Promise<ColumnResult> => {
      const { error } = await admin.from(table).select(column).limit(0);
      return error ? { column, ok: false, detail: error.message } : { column, ok: true };
    }),
  );

  let publicAccess: TableResult["publicAccess"] = "unknown";
  if (anon) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (error) publicAccess = "protected";
    else if (data && data.length > 0) publicAccess = "open";
    else {
      // An empty answer is what row level security gives, but it is also what an empty table gives.
      const { count } = await admin.from(table).select("*", { count: "exact", head: true });
      publicAccess = (count ?? 0) > 0 ? "protected" : "unknown";
    }
  }
  return { table, exists: true, columns: results, publicAccess };
}

/** Inserts the same unique value twice and expects Postgres to refuse the second. Always deletes what it inserted. */
async function probeUnique(admin: SupabaseClient, key: (typeof UNIQUE_KEYS)[number]): Promise<ProbeResult> {
  const { table, column } = key;
  const marker = `check-db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `${table}.${column} is unique`;
  const rows = [0, 1].map((attempt) => ({ ...key.others(marker, attempt), [column]: marker }));
  try {
    const one = await admin.from(table).insert(rows[0]);
    if (one.error) return { name, ok: false, detail: `first insert failed: ${one.error.message}` };
    const two = await admin.from(table).insert(rows[1]);
    if (!two.error) return { name, ok: false, detail: "a second row with the same value was ACCEPTED: the unique key is missing (run the migration)" };
    if (two.error.code !== "23505") return { name, ok: false, detail: `second insert failed with ${two.error.code}: ${two.error.message}` };
    return { name, ok: true };
  } finally {
    await admin.from(table).delete().eq(column, marker);
    for (const row of rows) for (const [other, value] of Object.entries(row)) if (other !== column && typeof value === "string" && value.startsWith(marker)) await admin.from(table).delete().eq(other, value);
  }
}

export async function checkDatabase(options: { url: string; serviceKey: string; anonKey?: string; probeConstraints?: boolean }): Promise<DbReport> {
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(options.url, options.serviceKey, settings);
  const anon = options.anonKey ? createClient(options.url, options.anonKey, settings) : null;

  const tables: TableResult[] = [];
  for (const table of Object.keys(DB_SCHEMA) as DbTable[]) tables.push(await checkTable(admin, anon, table));

  const probes: ProbeResult[] = [];
  if (options.probeConstraints) {
    for (const key of UNIQUE_KEYS) {
      const columns = tables.find((entry) => entry.table === key.table)?.columns ?? [];
      const ready = [key.column, ...Object.keys(key.others("x", 0))].every((name) => columns.find((column) => column.column === name)?.ok);
      probes.push(ready ? await probeUnique(admin, key) : { name: `${key.table}.${key.column} is unique`, ok: false, detail: "skipped: a column is missing" });
    }
  }

  const ok = tables.every((table) => table.exists && table.columns.every((column) => column.ok) && table.publicAccess !== "open") && probes.every((probe) => probe.ok);
  return { tables, probes, ok };
}

export function formatReport(report: DbReport): string {
  const lines: string[] = [];
  for (const table of report.tables) {
    const missing = table.columns.filter((column) => !column.ok);
    lines.push(`${table.exists && missing.length === 0 ? "ok  " : "FAIL"}  ${table.table}${table.exists ? "" : "  (table is missing)"}`);
    if (table.exists) {
      for (const column of table.columns) lines.push(`        ${column.ok ? "ok  " : "MISSING"} ${column.column}`);
    }
    if (table.detail && !table.exists) lines.push(`        ${table.detail}`);
    lines.push(
      table.publicAccess === "open"
        ? "        FAIL  row level security: the public key can read rows from this table"
        : table.publicAccess === "protected"
          ? "        ok    row level security: the public key sees nothing"
          : "        --    row level security: could not tell (empty table or no public key in the env)",
    );
  }
  for (const probe of report.probes) lines.push(`${probe.ok ? "ok  " : "FAIL"}  ${probe.name}${probe.detail ? `: ${probe.detail}` : ""}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* no .env.local: the variables may come from the shell */
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (in .env.local).");
    return 2;
  }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const probeConstraints = process.argv.includes("--probe-constraints");

  console.log(`Checking ${new URL(url).host}${probeConstraints ? " (with constraint probes)" : ""}\n`);
  const report = await checkDatabase({ url, serviceKey, anonKey, probeConstraints });
  console.log(formatReport(report));
  if (!probeConstraints) console.log("\nTip: add --probe-constraints to also prove the unique keys work (inserts and deletes two throw-away rows).");

  if (report.ok) {
    console.log("\nThe database matches what the code expects.");
    return 0;
  }
  console.log("\nThe database does NOT match. Apply supabase/migrations/*_init.sql (it is safe to run again), then rerun this check:");
  console.log("  - Supabase Dashboard -> SQL Editor -> New query -> paste the file -> Run, or");
  console.log("  - npx supabase link --project-ref <ref> && npx supabase db push");
  return 1;
}

// Run only when started directly (`node scripts/check-db.ts`), not when e2e-stripe.ts imports checkDatabase.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error("check-db failed:", error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
