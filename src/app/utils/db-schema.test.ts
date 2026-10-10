import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DB_SCHEMA, UNIQUE_KEYS } from "./db-schema";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
/** All migrations, comments removed, as one string: what the database ends up with when they run in order. */
const sql = files.map((name) => readFileSync(join(MIGRATIONS, name), "utf8")).join("\n").replace(/--[^\n]*/g, "");

/** The statements that define a table: its CREATE TABLE and every ALTER TABLE ... ADD COLUMN. */
function definitionOf(table: string): string {
  const create = new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i").exec(sql)?.[1] ?? "";
  const alters = [...sql.matchAll(new RegExp(`alter table public\\.${table}\\s+([\\s\\S]*?);`, "gi"))].map((match) => match[1]).join("\n");
  return `${create}\n${alters}`;
}

describe("supabase/migrations", () => {
  it("has a timestamped init migration", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/^\d{14}_init\.sql$/);
  });

  it.each(Object.entries(DB_SCHEMA))("%s: creates the table and every column the code uses", (table, { columns }) => {
    expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    const definition = definitionOf(table);
    for (const column of columns) expect(definition, `${table}.${column}`).toMatch(new RegExp(`(^|[\\s,(])${column}\\s+(uuid|text|integer|bigint|boolean|timestamptz)`, "m"));
  });

  it("enforces the uniqueness the code relies on (a duplicate insert must fail with 23505)", () => {
    expect(sql).toMatch(/create unique index if not exists \w+ on public\.payment_intents \(stripe_session_id\)/i);
    expect(definitionOf("stripe_events")).toMatch(/event_id text primary key/i);
    // one trial per email and one per browser
    expect(sql).toMatch(/create unique index if not exists \w+ on public\.free_trials \(email_hash\)/i);
    expect(sql).toMatch(/create unique index if not exists \w+ on public\.free_trials \(browser_id\)/i);
    expect(UNIQUE_KEYS.map((key) => `${key.table}.${key.column}`)).toEqual(["payment_intents.stripe_session_id", "stripe_events.event_id", "free_trials.email_hash", "free_trials.browser_id"]);
    for (const key of UNIQUE_KEYS) expect(DB_SCHEMA[key.table].columns as readonly string[], key.column).toContain(key.column);
  });

  it("switches row level security on for every table, with no policies, so the public keys see nothing", () => {
    for (const table of Object.keys(DB_SCHEMA)) expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    expect(sql).not.toMatch(/create policy/i);
  });

  it("free_trials stores no plaintext email unless the person opted in: only a hash column, and a separate opt-in email", () => {
    const columns = DB_SCHEMA.free_trials.columns as readonly string[];
    expect(columns).toContain("email_hash");
    expect(columns).not.toContain("email");
    expect(definitionOf("free_trials")).toMatch(/marketing_email text,?\s/);
    expect(definitionOf("free_trials")).toMatch(/marketing_opt_in_at timestamptz/);
  });

  it("is idempotent: safe to run on an empty project and again on an existing one", () => {
    expect([...sql.matchAll(/create table (?!if not exists)/gi)]).toHaveLength(0);
    expect([...sql.matchAll(/add column (?!if not exists)/gi)]).toHaveLength(0);
    expect([...sql.matchAll(/create (unique )?index (?!if not exists)/gi)]).toHaveLength(0);
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(sql).not.toMatch(/^\s*delete from/im);
  });
});
