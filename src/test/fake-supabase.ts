// src/test/fake-supabase.ts
//
// A small in-memory stand-in for the parts of the supabase-js query builder that the server code uses, so route and
// database logic can be unit-tested without a network. It enforces unique keys and can inject failures.

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;

interface FakeError {
  code: string;
  message: string;
  details: null;
  hint: null;
}

export interface FakeSupabaseOptions {
  /** Columns that must be unique per table; a duplicate insert fails with Postgres' 23505. */
  unique?: Record<string, string[]>;
  /** Tables whose id column is filled in on insert (the real tables default it to gen_random_uuid()). */
  autoId?: string[];
  /** Return an error to make a specific operation fail, or null to let it run. */
  failOn?: (operation: { table: string; op: "select" | "insert" | "update" | "delete" }) => FakeError | null;
}

type Op = "select" | "insert" | "update" | "delete";

class Query implements PromiseLike<{ data: unknown; error: FakeError | null }> {
  private op: Op = "select";
  private payload: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private expectOne: "single" | "maybe" | null = null;
  private countOnly = false;
  private columns: string[] | null = null;

  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly table: string,
    private readonly options: FakeSupabaseOptions,
  ) {}

  /** After insert/update this means "return the rows", which is always what we do. With { count, head } it only counts. */
  select(columns?: string, options?: { count?: string; head?: boolean }): this {
    if (options?.head) this.countOnly = true;
    // A plain read returns only the columns it asked for, like PostgREST. (After insert/update the whole row comes back.)
    if (this.op === "select" && columns && columns.trim() !== "*") this.columns = columns.split(",").map((name) => name.trim());
    return this;
  }
  insert(row: Row): this { this.op = "insert"; this.payload = row; return this; }
  update(values: Row): this { this.op = "update"; this.payload = values; return this; }
  delete(): this { this.op = "delete"; return this; }
  eq(column: string, value: unknown): this { this.filters.push((row) => row[column] === value); return this; }
  gt(column: string, value: number | string): this { this.filters.push((row) => (row[column] as number | string) > value); return this; }
  gte(column: string, value: number | string): this { this.filters.push((row) => (row[column] as number | string) >= value); return this; }
  in(column: string, values: unknown[]): this { this.filters.push((row) => values.includes(row[column])); return this; }
  neq(column: string, value: unknown): this { this.filters.push((row) => row[column] !== value); return this; }
  lt(column: string, value: string): this { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) < value); return this; }
  is(column: string, value: null): this { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  not(column: string, operator: string, value: unknown): this {
    if (operator === "in") {
      const excluded = String(value).replace(/^\(|\)$/g, "").split(",");
      this.filters.push((row) => !excluded.includes(String(row[column])));
      return this;
    }
    if (operator !== "is") throw new Error("fake supabase: only .not(col, 'is'|'in', ...) is supported");
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this { this.sort = { column, ascending: options?.ascending ?? true }; return this; }
  limit(count: number): this { this.max = count; return this; }
  single(): this { this.expectOne = "single"; return this; }
  maybeSingle(): this { this.expectOne = "maybe"; return this; }

  then<R1 = { data: unknown; error: FakeError | null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: FakeError | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: unknown; error: FakeError | null } {
    const injected = this.options.failOn?.({ table: this.table, op: this.op }) ?? null;
    if (injected) return { data: null, error: injected };

    const rows = (this.tables[this.table] ??= []);
    let result: Row[];

    if (this.op === "insert") {
      for (const column of this.options.unique?.[this.table] ?? []) {
        if (this.payload?.[column] != null && rows.some((row) => row[column] === this.payload?.[column])) {
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${this.table}_${column}_key"`, details: null, hint: null } };
        }
      }
      const inserted = { ...this.payload };
      if (this.options.autoId?.includes(this.table) && inserted.id === undefined) inserted.id = randomUUID();
      if (this.table === "free_trials" && inserted.created_at === undefined) inserted.created_at = new Date().toISOString();
      rows.push(inserted);
      result = [inserted];
    } else {
      const matched = rows.filter((row) => this.filters.every((test) => test(row)));
      if (this.op === "update") matched.forEach((row) => Object.assign(row, this.payload));
      if (this.op === "delete") this.tables[this.table] = rows.filter((row) => !matched.includes(row));
      result = matched;
    }

    if (this.countOnly) return { data: null, count: result.length, error: null } as { data: unknown; error: FakeError | null };
    if (this.sort) {
      const { column, ascending } = this.sort;
      result = [...result].sort((a, b) => ((a[column] as string) < (b[column] as string) ? -1 : (a[column] as string) > (b[column] as string) ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (this.max !== null) result = result.slice(0, this.max);
    if (this.columns && this.op === "select") {
      const wanted = this.columns;
      result = result.map((row) => Object.fromEntries(wanted.filter((name) => name in row).map((name) => [name, row[name]])));
    }
    if (this.expectOne === "maybe") return { data: result[0] ?? null, error: null };
    if (this.expectOne === "single") {
      return result.length === 1
        ? { data: result[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null } };
    }
    return { data: result, error: null };
  }
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}, options: FakeSupabaseOptions = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const client = { from: (table: string) => new Query(tables, table, options) } as unknown as SupabaseClient;
  return { client, tables };
}
