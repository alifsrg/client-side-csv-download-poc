import type { HistoryEntry } from '../types';

const DB_NAME = 'csvExportHistory';
const STORE_NAME = 'history';
const DB_VERSION = 1;
const MAX_ENTRIES = 3;

const dbPromise: Promise<IDBDatabase> = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = e => {
    const db = (e.target as IDBOpenDBRequest).result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'companyId' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEntries(): Promise<HistoryEntry[]> {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readonly');
  const entries = await idbRequest<HistoryEntry[]>(tx.objectStore(STORE_NAME).getAll());
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getEntry(companyId: string): Promise<HistoryEntry | undefined> {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readonly');
  return idbRequest<HistoryEntry | undefined>(tx.objectStore(STORE_NAME).get(companyId));
}

export async function upsertEntry(entry: HistoryEntry): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).put(entry));
}

export async function deleteEntry(companyId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).delete(companyId));
}

export async function ensureSlotAvailable(newCompanyId: string): Promise<void> {
  const entries = await getAllEntries();
  const alreadyExists = entries.some(e => e.companyId === newCompanyId);
  if (alreadyExists) return;

  if (entries.length >= MAX_ENTRIES) {
    const oldest = entries[entries.length - 1];
    await deleteEntry(oldest.companyId);
  }
}

export async function markStaleInProgressAsFailed(): Promise<void> {
  const entries = await getAllEntries();
  await Promise.all(
    entries
      .filter(e => e.status === 'in-progress')
      .map(e => upsertEntry({ ...e, status: 'failed', updatedAt: Date.now() })),
  );
}
