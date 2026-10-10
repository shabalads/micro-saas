import { describe, expect, it, vi } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import type { PurchaseGrant, UnlockResponse } from "../types/unlock";
import { PARKED_MAX_AGE_MS, type ParkedJobMeta } from "./job-store";
import { RECOVERY_CHECK_LIMIT, type RecoveryDeps, findRecoverableFile } from "./recovery";

const NOW = 10_000_000_000;
const HOUR = 3600 * 1000;
const meta = (id: string, ageMs: number): ParkedJobMeta => ({ jobId: id, sessionId: `cs_test_${id}`, fingerprint: `sha256:${id}`, fileName: `${id}.csv`, fileSize: 1, warnings: [], savedAt: NOW - ageMs });
const grant = (id: string): PurchaseGrant => ({ token: `token-${id}`, expiresAt: NOW + 600_000, sessionId: `cs_test_${id}`, sessionRef: id, fingerprint: `sha256:${id}`, paidAt: "2026-01-01T00:00:00Z" });
const DATA: RawSupplierRow[] = [{ id: "1", title: "A", description: "", images: "", price: "", sku: "" }];

/** answers: sessionId -> what the server says. Anything not listed is "not_found". */
function setup(parked: ParkedJobMeta[], answers: Record<string, UnlockResponse>, overrides: Partial<RecoveryDeps> = {}) {
  const deleted: string[] = [];
  const asked: string[] = [];
  const deps: RecoveryDeps = {
    listParked: async () => parked,
    requestUnlock: async (sessionId) => { asked.push(sessionId); return answers[sessionId] ?? { status: "not_found" }; },
    loadData: async () => DATA,
    deleteParked: async (jobId) => { deleted.push(jobId); },
    isCancelled: () => false,
    now: () => NOW,
    ...overrides,
  };
  return { deps, deleted, asked };
}
const paid = (id: string): UnlockResponse => ({ status: "paid", purchases: [grant(id)] });

describe("recovery of a file paid for before the tab was closed", () => {
  it("hands back a parked file whose payment is confirmed", async () => {
    const { deps, deleted } = setup([meta("a", HOUR)], { cs_test_a: paid("a") });
    const outcome = await findRecoverableFile(deps);
    expect(outcome).toMatchObject({ kind: "recovered", meta: { jobId: "a" }, grant: { token: "token-a" }, rawData: DATA });
    expect(deleted).toEqual([]); // the caller deletes it only after the download has been produced
  });

  it("leaves an unpaid file parked so the customer can still pay later", async () => {
    const { deps, deleted } = setup([meta("a", HOUR)], { cs_test_a: { status: "pending" } });
    expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
    expect(deleted).toEqual([]);
  });

  it("recovers the paid file when a newer, unpaid one is parked as well (and keeps the unpaid one)", async () => {
    const { deps, deleted, asked } = setup([meta("older-paid", 5 * HOUR), meta("newer-unpaid", HOUR)], { "cs_test_older-paid": paid("older-paid"), "cs_test_newer-unpaid": { status: "pending" } });
    const outcome = await findRecoverableFile(deps);
    expect(outcome).toMatchObject({ kind: "recovered", meta: { jobId: "older-paid" } });
    expect(asked).toEqual(["cs_test_newer-unpaid", "cs_test_older-paid"]); // newest is checked first
    expect(deleted).toEqual([]);
  });

  it("still hands back a PAID file however old it is", async () => {
    const { deps, deleted } = setup([meta("a", 30 * 24 * HOUR)], { cs_test_a: paid("a") });
    expect((await findRecoverableFile(deps)).kind).toBe("recovered");
    expect(deleted).toEqual([]);
  });

  it("a refunded payment is not handed back, and its parked copy is dropped so it is not asked about on every visit", async () => {
    const { deps, deleted } = setup([meta("a", HOUR)], { cs_test_a: { status: "refunded", message: "refunded" } });
    expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
    expect(deleted).toEqual(["a"]);
  });

  it("still recovers an older paid file when a newer one was refunded", async () => {
    const { deps, deleted } = setup([meta("old-paid", 5 * HOUR), meta("new-refunded", HOUR)], { "cs_test_old-paid": paid("old-paid"), "cs_test_new-refunded": { status: "refunded", message: "refunded" } });
    expect(await findRecoverableFile(deps)).toMatchObject({ kind: "recovered", meta: { jobId: "old-paid" } });
    expect(deleted).toEqual(["new-refunded"]);
  });

  it("deletes an unpaid file once it is too old to ever be paid (so customer data does not linger)", async () => {
    const stale = PARKED_MAX_AGE_MS + HOUR;
    for (const status of ["pending", "not_found"] as const) {
      const { deps, deleted } = setup([meta("a", stale)], { cs_test_a: { status } });
      expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
      expect(deleted).toEqual(["a"]);
    }
  });

  it("does NOT delete a stale file when the server merely failed to answer", async () => {
    const { deps, deleted } = setup([meta("a", PARKED_MAX_AGE_MS + HOUR)], { cs_test_a: { status: "error", message: "boom" } });
    await findRecoverableFile(deps);
    expect(deleted).toEqual([]);
  });

  it("does not delete a recent unpaid file", async () => {
    const { deps, deleted } = setup([meta("a", PARKED_MAX_AGE_MS - HOUR)], { cs_test_a: { status: "not_found" } });
    await findRecoverableFile(deps);
    expect(deleted).toEqual([]);
  });

  it("backs off, leaving everything parked, when the visitor started something else while the server was thinking", async () => {
    let cancelled = false;
    const { deps, deleted } = setup([meta("a", HOUR)], {}, {
      requestUnlock: async () => { cancelled = true; return paid("a"); },
      isCancelled: () => cancelled,
    });
    expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
    expect(deleted).toEqual([]);
  });

  it("backs off if the visitor moved on while the file was being loaded", async () => {
    let cancelled = false;
    const { deps } = setup([meta("a", HOUR)], { cs_test_a: paid("a") }, {
      loadData: async () => { cancelled = true; return DATA; },
      isCancelled: () => cancelled,
    });
    expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
  });

  it("skips a paid file whose data is gone and does not crash", async () => {
    const { deps } = setup([meta("a", HOUR)], { cs_test_a: paid("a") }, { loadData: async () => null });
    expect(await findRecoverableFile(deps)).toEqual({ kind: "nothing" });
  });

  it("asks the server about at most RECOVERY_CHECK_LIMIT files per visit", async () => {
    const many = Array.from({ length: 12 }, (_, i) => meta(`f${i}`, (i + 1) * HOUR));
    const { deps, asked } = setup(many, {});
    await findRecoverableFile(deps);
    expect(asked).toHaveLength(RECOVERY_CHECK_LIMIT);
  });

  it("does nothing, quietly, when storage cannot be read or is empty", async () => {
    const failing = setup([], {}, { listParked: vi.fn(async () => { throw new Error("IndexedDB blocked"); }) });
    expect(await findRecoverableFile(failing.deps)).toEqual({ kind: "nothing" });
    const empty = setup([], {});
    expect(await findRecoverableFile(empty.deps)).toEqual({ kind: "nothing" });
    expect(empty.asked).toEqual([]);
  });
});
