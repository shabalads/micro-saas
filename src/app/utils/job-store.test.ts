import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { RawSupplierRow } from "../types/csv";
import { type ParkedJobMeta, deleteParkedJob, listParkedJobs, loadParkedData, parkJob } from "./job-store";

const rows = (n: number): RawSupplierRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), title: `Item ${i}`, description: "", images: "", price: "", sku: "" }));
const meta = (jobId: string, savedAt: number, extra: Partial<ParkedJobMeta> = {}): ParkedJobMeta => ({
  jobId, sessionId: `cs_test_${jobId}`, fingerprint: `sha256:${jobId}`, fileName: `${jobId}.csv`, fileSize: 123, warnings: [], savedAt, ...extra,
});

async function wipe() {
  for (const m of await listParkedJobs()) await deleteParkedJob(m.jobId);
}

describe("job store (IndexedDB)", () => {
  beforeEach(wipe);

  it("parks a file and gives its rows back", async () => {
    await parkJob(meta("a", 1), rows(120));
    const data = await loadParkedData("a");
    expect(data).toHaveLength(120);
    expect(data?.[119].title).toBe("Item 119");
  });

  it("lists metadata only, oldest first, with the Stripe session and fingerprint", async () => {
    await parkJob(meta("new", 300), rows(1));
    await parkJob(meta("old", 100), rows(1));
    await parkJob(meta("mid", 200), rows(1));
    const listed = await listParkedJobs();
    expect(listed.map((m) => m.jobId)).toEqual(["old", "mid", "new"]);
    expect(listed[0]).toMatchObject({ sessionId: "cs_test_old", fingerprint: "sha256:old", fileName: "old.csv", fileSize: 123 });
    expect("rawData" in listed[0]).toBe(false);
  });

  it("replaces a file parked again for the same job (a second Unlock click)", async () => {
    await parkJob(meta("a", 1, { sessionId: "cs_test_first" }), rows(60));
    await parkJob(meta("a", 2, { sessionId: "cs_test_second" }), rows(61));
    const listed = await listParkedJobs();
    expect(listed).toHaveLength(1);
    expect(listed[0].sessionId).toBe("cs_test_second");
    expect(await loadParkedData("a")).toHaveLength(61);
  });

  it("deletes both the data and the metadata", async () => {
    await parkJob(meta("a", 1), rows(5));
    await deleteParkedJob("a");
    expect(await listParkedJobs()).toEqual([]);
    expect(await loadParkedData("a")).toBeNull();
  });

  it("returns null for an unknown job", async () => {
    expect(await loadParkedData("nope")).toBeNull();
  });
});
