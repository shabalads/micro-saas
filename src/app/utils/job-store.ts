// src/app/utils/job-store.ts
//
// Parks the uploaded file in the browser (IndexedDB) while the customer is away on Stripe Checkout, and keeps it
// until they have been handed the download. It stores only what was uploaded (the raw rows), never any cleaned
// output, and nothing here ever leaves the device. IndexedDB, not sessionStorage, because supplier files can be
// tens of megabytes.
//
// Two stores: "meta" is tiny (which Stripe session, which file, when) so recovery can list parked files without
// reading megabytes; "jobs" holds the rows themselves and is only read once a payment has been confirmed.

import type { RawSupplierRow, SanitizeOptions } from "../types/csv";

const DB_NAME = "shopify-csv-sanitizer";
// v3 replaced the single v1/v2 "jobs" store (which held cleaned output and had no Stripe session id) with the two
// stores below. Files parked by those older builds cannot be tied to a payment, so the upgrade drops them.
const DB_VERSION = 3;
const JOBS_STORE = "jobs";
const META_STORE = "meta";
const SAVED_AT_INDEX = "savedAt";

/**
 * Checkout Sessions expire after 24 hours, so a parked file that is still unpaid after 48 hours will never be
 * unlocked. Recovery deletes such files; paid files are handed back whatever their age.
 */
export const PARKED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface ParkedJobMeta {
  /** usage_telemetry.id: the job id that Stripe Checkout and the return URL carry. */
  jobId: string;
  /** The Stripe Checkout Session this file was parked for. */
  sessionId: string;
  /** Fingerprint of the rows (see fingerprintRows). */
  fingerprint: string | null;
  fileName: string | null;
  fileSize: number;
  warnings: string[];
  /** The switches set before paying, so the file that comes back from Stripe is the one that was configured. Absent on files parked by older builds. */
  options?: SanitizeOptions;
  savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(JOBS_STORE)) db.deleteObjectStore(JOBS_STORE);
      db.createObjectStore(JOBS_STORE, { keyPath: "jobId" });
      if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
      db.createObjectStore(META_STORE, { keyPath: "jobId" }).createIndex(SAVED_AT_INDEX, SAVED_AT_INDEX);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

/** Runs one transaction over the given stores and resolves with its result once it has been committed. */
async function inTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (open: (name: string) => IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(stores, mode);
      const request = run((name) => transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

/** Stores the file and its metadata together, so a file is never listed without its data (or the reverse). */
export async function parkJob(meta: ParkedJobMeta, rawData: RawSupplierRow[]): Promise<void> {
  await inTransaction([JOBS_STORE, META_STORE], "readwrite", (open) => {
    open(JOBS_STORE).put({ jobId: meta.jobId, rawData });
    return open(META_STORE).put(meta);
  });
}

/** Parked files, oldest first. Reads metadata only. */
export async function listParkedJobs(): Promise<ParkedJobMeta[]> {
  const all = await inTransaction([META_STORE], "readonly", (open) => open(META_STORE).getAll() as IDBRequest<ParkedJobMeta[]>);
  return all.sort((a, b) => a.savedAt - b.savedAt);
}

export async function loadParkedData(jobId: string): Promise<RawSupplierRow[] | null> {
  const record = await inTransaction(
    [JOBS_STORE],
    "readonly",
    (open) => open(JOBS_STORE).get(jobId) as IDBRequest<{ rawData: RawSupplierRow[] } | undefined>,
  );
  return record?.rawData ?? null;
}

export async function deleteParkedJob(jobId: string): Promise<void> {
  await inTransaction([JOBS_STORE, META_STORE], "readwrite", (open) => {
    open(JOBS_STORE).delete(jobId);
    return open(META_STORE).delete(jobId);
  });
}
