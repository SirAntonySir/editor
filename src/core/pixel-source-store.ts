/**
 * pixel-source-store — IndexedDB-backed persistence for layer source bitmaps.
 *
 * Keys are `${sessionId}:${layerId}` strings. Values are Blobs (the original
 * uploaded File, which already satisfies Blob). All operations are best-effort:
 * if IDB is unavailable (private mode, quota exceeded, etc.) every call logs
 * a warning and resolves with a safe fallback (null / undefined).
 */

const DB_NAME = 'editor-pixel-sources';
const DB_VERSION = 1;
const STORE = 'pixel-sources';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB open blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function key(sessionId: string, layerId: string): string {
  return `${sessionId}:${layerId}`;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE, mode);
        } catch (err) {
          console.warn('[pixel-source-store] tx open failed:', err);
          resolve(null);
          return;
        }
        const req = fn(tx.objectStore(STORE));
        if (!req) {
          tx.oncomplete = () => resolve(null);
          tx.onerror = () => {
            console.warn('[pixel-source-store] tx failed:', tx.error);
            resolve(null);
          };
          return;
        }
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => {
          console.warn('[pixel-source-store] request failed:', req.error);
          resolve(null);
        };
      }),
  ).catch((err) => {
    console.warn('[pixel-source-store] db unavailable:', err);
    return null;
  });
}

export async function putSource(
  sessionId: string,
  layerId: string,
  blob: Blob,
): Promise<void> {
  await run('readwrite', (store) => store.put(blob, key(sessionId, layerId)));
}

export async function getSource(
  sessionId: string,
  layerId: string,
): Promise<Blob | null> {
  return run<Blob>('readonly', (store) =>
    store.get(key(sessionId, layerId)) as IDBRequest<Blob>,
  );
}

export async function deleteOne(
  sessionId: string,
  layerId: string,
): Promise<void> {
  await run('readwrite', (store) => store.delete(key(sessionId, layerId)));
}

export async function deletePrefix(sessionId: string): Promise<void> {
  const prefix = `${sessionId}:`;
  await openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE, 'readwrite');
        } catch (err) {
          console.warn('[pixel-source-store] deletePrefix tx open failed:', err);
          resolve();
          return;
        }
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const k = String(cursor.key);
          if (k.startsWith(prefix)) cursor.delete();
          cursor.continue();
        };
        req.onerror = () => {
          console.warn('[pixel-source-store] deletePrefix cursor failed:', req.error);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.warn('[pixel-source-store] deletePrefix tx failed:', tx.error);
          resolve();
        };
      }),
  ).catch((err) => {
    console.warn('[pixel-source-store] db unavailable:', err);
  });
}

/** Test-only: closes the cached DB connection and clears all entries. */
export async function __resetForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch { /* ignore */ }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
