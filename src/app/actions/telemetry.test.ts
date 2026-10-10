import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Array<Record<string, unknown>> = [];
vi.mock("../utils/telemetry-db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils/telemetry-db")>();
  return {
    ...original,
    getSupabaseAdmin: () => ({
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "row-1" }, error: null }) }) };
        },
      }),
    }),
  };
});

import { logUsageTelemetry } from "./telemetry";

const VALID = { file_name_anonymized: "3f9a1c2b7d4e.csv", total_rows: 1200, processing_time_ms: 42, fix_count: 3100, file_size_bytes: 482_113 };

describe("usage telemetry never contains file contents", () => {
  beforeEach(() => { inserted.length = 0; });

  it("stores exactly counts, timings, fix count, file size and the hashed file name", async () => {
    expect(await logUsageTelemetry(VALID)).toBe("row-1");
    expect(inserted).toEqual([VALID]);
  });

  it("drops anything else a client tries to send: contents, real file names, per-row data, emails", async () => {
    const hostile = {
      ...VALID,
      file_name: "Acme Secret Pricing.csv",
      rows: [{ title: "Secret product", price: "9.99" }],
      content: "id,title\n1,Secret product",
      sample: "Secret product",
      email: "someone@example.com",
      is_unlocked: true,
      id: "hijack",
    };
    await logUsageTelemetry(hostile as never);
    expect(Object.keys(inserted[0]).sort()).toEqual(["file_name_anonymized", "file_size_bytes", "fix_count", "processing_time_ms", "total_rows"]);
    expect(JSON.stringify(inserted[0])).not.toMatch(/Secret|Acme|someone@|hijack/);
  });

  it("only accepts sane numbers for every numeric field, so a value cannot smuggle text", async () => {
    for (const field of ["total_rows", "processing_time_ms", "fix_count", "file_size_bytes"] as const) {
      for (const bad of [-1, NaN, Infinity, "12", "Secret product", null, undefined, {}]) {
        expect(await logUsageTelemetry({ ...VALID, [field]: bad } as never)).toBeNull();
      }
    }
    expect(inserted).toEqual([]);
  });

  it("rejects an empty or non-string file name hash", async () => {
    for (const bad of ["", "   ", 42, null, { a: 1 }]) expect(await logUsageTelemetry({ ...VALID, file_name_anonymized: bad } as never)).toBeNull();
    expect(inserted).toEqual([]);
  });

  it("caps the hash length and clamps huge numbers", async () => {
    await logUsageTelemetry({ ...VALID, file_name_anonymized: "x".repeat(900), file_size_bytes: 9e15 });
    expect((inserted[0].file_name_anonymized as string).length).toBe(255);
    expect(inserted[0].file_size_bytes).toBe(2_000_000_000);
  });
});
