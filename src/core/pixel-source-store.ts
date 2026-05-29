/**
 * pixel-source-store — IndexedDB-backed persistence.
 *
 * Two object stores in one DB:
 *  - `pixel-sources`: layer source bitmaps, keyed `${sessionId}:${layerId}` → Blob
 *  - `editor-state`: frontend state (layers, activeLayerId, documentMeta, …),
 *    keyed by sessionId → JSON-serializable object
 *
 * All operations are best-effort: if IDB is unavailable (private mode, quota
 * exceeded, etc.) every call logs a warning and resolves with a safe fallback.
 */

const DB_NAME = 'editor-pixel-sources';
const DB_VERSION = 2;
const SOURCES_STORE = 'pixel-sources';
const STATE_STORE = 'editor-state';

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
      if (!db.objectStoreNames.contains(SOURCES_STORE)) {
        db.createObjectStore(SOURCES_STORE);
      }
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE);
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
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, mode);
        } catch (err) {
          console.warn('[pixel-source-store] tx open failed:', err);
          resolve(null);
          return;
        }
        const req = fn(tx.objectStore(storeName));
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

// ─── Pixel sources ──────────────────────────────────────────────────

export async function putSource(
  sessionId: string,
  layerId: string,
  blob: Blob,
): Promise<void> {
  await run(SOURCES_STORE, 'readwrite', (store) => store.put(blob, key(sessionId, layerId)));
}

export async function getSource(
  sessionId: string,
  layerId: string,
): Promise<Blob | null> {
  return run<Blob>(SOURCES_STORE, 'readonly', (store) =>
    store.get(key(sessionId, layerId)) as IDBRequest<Blob>,
  );
}

export async function deleteOne(
  sessionId: string,
  layerId: string,
): Promise<void> {
  await run(SOURCES_STORE, 'readwrite', (store) => store.delete(key(sessionId, layerId)));
}

// ─── Editor state ───────────────────────────────────────────────────

export async function putEditorState(
  sessionId: string,
  state: unknown,
): Promise<void> {
  await run(STATE_STORE, 'readwrite', (store) => store.put(state, sessionId));
}

export async function getEditorState<T = unknown>(
  sessionId: string,
): Promise<T | null> {
  return run<T>(STATE_STORE, 'readonly', (store) =>
    store.get(sessionId) as IDBRequest<T>,
  );
}

// ─── Whole-session cleanup ──────────────────────────────────────────

/**
 * Delete everything (sources + editor state) for the given sessionId.
 * Used on backend reset, on 404 reattach, and on session change.
 */
export async function deletePrefix(sessionId: string): Promise<void> {
  const prefix = `${sessionId}:`;
  await openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction([SOURCES_STORE, STATE_STORE], 'readwrite');
        } catch (err) {
          console.warn('[pixel-source-store] deletePrefix tx open failed:', err);
          resolve();
          return;
        }
        // Sources: cursor-scan for matching prefix.
        const sources = tx.objectStore(SOURCES_STORE);
        const cursorReq = sources.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const k = String(cursor.key);
          if (k.startsWith(prefix)) cursor.delete();
          cursor.continue();
        };
        cursorReq.onerror = () => {
          console.warn('[pixel-source-store] deletePrefix cursor failed:', cursorReq.error);
        };
        // State: direct delete by sessionId key.
        tx.objectStore(STATE_STORE).delete(sessionId);
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
