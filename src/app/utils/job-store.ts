// src/app/utils/job-store.ts
//
// Parks the cleaned file in the browser (IndexedDB) while the customer is away on Stripe Checkout, and
// keeps it there until the customer has been handed the download. The data never leaves the device.
// IndexedDB is used instead of sessionStorage because supplier files can be tens of megabytes.

import type { CsvState } from "../types/csv";

const DB_NAME = "shopify-csv-sanitizer";
const DB_VERSION = 2;
const STORE = "jobs";
const SAVED_AT_INDEX = "savedAt";

/**
 * Checkout Sessions expire after 24 hours, so a parked file that is still unpaid after 48 hours will never
 * be unlocked. Recovery deletes such files; paid files are handed back whatever their age.
 */
export const PARKED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface StoredJob {
  /** usage_telemetry.id, the same id that comes back in the return URL. */
  jobId: string;
  savedAt: number;
  state: Pick<CsvState, "rawData" | "cleanedData" | "fileName" | "warnings" | "report">;
}

/** Everything needed to decide what to do with a parked file, without loading its (large) data. */
export interface ParkedJob {
  jobId: string;
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
      // v1 had the store without the index, so upgrade in place and keep any parked files.
      const store = db.objectStoreNames.contains(STORE)
        ? (request.transaction as IDBTransaction).objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "jobId" });
      if (!store.indexNames.contains(SAVED_AT_INDEX)) store.createIndex(SAVED_AT_INDEX, SAVED_AT_INDEX);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

/** Runs one transaction and resolves with the request result once it has been committed. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export async function saveJob(job: StoredJob): Promise<void> {
  await withStore("readwrite", (store) => store.put(job));
}

export async function loadJob(jobId: string): Promise<StoredJob | null> {
  const job = await withStore("readonly", (store) => store.get(jobId) as IDBRequest<StoredJob | undefined>);
  return job ?? null;
}

export async function deleteJob(jobId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(jobId));
}

/** Lists parked files, oldest first. Uses a key cursor on the savedAt index, so no file data is read. */
export async function listParkedJobs(): Promise<ParkedJob[]> {
  const db = await openDatabase();
  try {
    return await new Promise<ParkedJob[]>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const parked: ParkedJob[] = [];
      const cursorRequest = transaction.objectStore(STORE).index(SAVED_AT_INDEX).openKeyCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        parked.push({ jobId: String(cursor.primaryKey), savedAt: Number(cursor.key) });
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(parked);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}
