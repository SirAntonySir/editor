# Image Restore on Page Reload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist source bitmaps in IndexedDB so Cmd+R restores the image instead of leaving the canvas blank.

**Architecture:** Add a thin async IndexedDB wrapper keyed by `${sessionId}:${layerId}`. Write the source `Blob` when `document.openImage` runs. On reload, after the backend snapshot lands, read each image layer's blob back, turn it into an `ImageBitmap`, and seed the in-memory `pixelStore`. The compositor already redraws when `pixelStore` and snapshot are both ready, so the image reappears automatically. Cleanup hooks wipe stale entries on `reset()`, on backend-404, and on layer removal.

**Tech Stack:** TypeScript, IndexedDB (native), `fake-indexeddb` for tests, Vitest, Zustand, immer.

**Spec:** `docs/superpowers/specs/2026-05-29-image-reload-restore-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `fake-indexeddb` devDep |
| `src/core/pixel-source-store.ts` | Create | IDB wrapper: put/get/deleteOne/deletePrefix |
| `src/core/pixel-source-store.test.ts` | Create | Unit tests for the wrapper using `fake-indexeddb` |
| `src/core/restore-pixel-sources.ts` | Create | Pure helper that takes a sessionId, walks layers, seeds pixelStore from IDB |
| `src/core/restore-pixel-sources.test.ts` | Create | Unit tests for the restore helper |
| `src/core/document.ts` | Modify | After `pixelStore.register`, persist the originating `File` blob to IDB |
| `src/hooks/useBackendSession.ts` | Modify | Call `restorePixelSources` after snapshot lands on reattach; `deletePrefix` on 404 |
| `src/store/backend-state-slice.ts` | Modify | `reset()` calls `deletePrefix(oldSessionId)` before clearing |
| `src/core/layer-lifecycle.ts` | Modify | `deleteOne(sessionId, layerId)` alongside `pixelStore.remove` on layer removal |

---

## Task 1: Add `fake-indexeddb` devDependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dev dependency**

Run: `npm install --save-dev fake-indexeddb`
Expected: `package.json` gets a new entry under `devDependencies` and `package-lock.json` updates. No new lockfile churn beyond that.

- [ ] **Step 2: Verify install succeeded**

Run: `node -e "console.log(require('fake-indexeddb/package.json').version)"`
Expected: prints a version string (e.g. `6.x.x`), no error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add fake-indexeddb for IDB tests"
```

---

## Task 2: Create the IndexedDB wrapper — `pixel-source-store.ts`

This is the heart of the persistence layer. TDD: write failing tests, then implement.

**Files:**
- Create: `src/core/pixel-source-store.ts`
- Test: `src/core/pixel-source-store.test.ts`

### Step-by-step

- [ ] **Step 1: Write the failing test file**

Create `src/core/pixel-source-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  putSource,
  getSource,
  deleteOne,
  deletePrefix,
  __resetForTests,
} from './pixel-source-store';

function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'image/png' });
}

async function readText(blob: Blob | null): Promise<string | null> {
  if (!blob) return null;
  return await blob.text();
}

describe('pixel-source-store', () => {
  beforeEach(async () => {
    await __resetForTests();
  });

  it('returns null for missing keys', async () => {
    const got = await getSource('s1', 'l1');
    expect(got).toBeNull();
  });

  it('round-trips a blob through put then get', async () => {
    await putSource('s1', 'l1', makeBlob('hello'));
    const got = await getSource('s1', 'l1');
    expect(await readText(got)).toBe('hello');
  });

  it('overwrites on a second put with the same key', async () => {
    await putSource('s1', 'l1', makeBlob('first'));
    await putSource('s1', 'l1', makeBlob('second'));
    const got = await getSource('s1', 'l1');
    expect(await readText(got)).toBe('second');
  });

  it('keeps entries independent across (sessionId, layerId) tuples', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await putSource('s2', 'l1', makeBlob('c'));
    expect(await readText(await getSource('s1', 'l1'))).toBe('a');
    expect(await readText(await getSource('s1', 'l2'))).toBe('b');
    expect(await readText(await getSource('s2', 'l1'))).toBe('c');
  });

  it('deleteOne removes a single entry and leaves siblings', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await deleteOne('s1', 'l1');
    expect(await getSource('s1', 'l1')).toBeNull();
    expect(await readText(await getSource('s1', 'l2'))).toBe('b');
  });

  it('deletePrefix removes only entries with the matching sessionId', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await putSource('s2', 'l1', makeBlob('c'));
    await deletePrefix('s1');
    expect(await getSource('s1', 'l1')).toBeNull();
    expect(await getSource('s1', 'l2')).toBeNull();
    expect(await readText(await getSource('s2', 'l1'))).toBe('c');
  });

  it('deletePrefix on a missing session is a no-op', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await deletePrefix('nope');
    expect(await readText(await getSource('s1', 'l1'))).toBe('a');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/pixel-source-store.test.ts`
Expected: FAIL with module-resolution error — file `./pixel-source-store` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/core/pixel-source-store.ts`:

```ts
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
  const result = await run<Blob>('readonly', (store) =>
    store.get(key(sessionId, layerId)) as IDBRequest<Blob>,
  );
  return result ?? null;
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/core/pixel-source-store.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/pixel-source-store.ts src/core/pixel-source-store.test.ts
git commit -m "feat(persistence): IndexedDB-backed pixel-source-store"
```

---

## Task 3: Create the restore helper — `restore-pixel-sources.ts`

A pure function that takes a sessionId and seeds `pixelStore` from IDB. Lives outside the React hook so it's testable in isolation.

**Files:**
- Create: `src/core/restore-pixel-sources.ts`
- Test: `src/core/restore-pixel-sources.test.ts`

### Step-by-step

- [ ] **Step 1: Write the failing test file**

Create `src/core/restore-pixel-sources.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { putSource, __resetForTests } from './pixel-source-store';
import { restorePixelSources } from './restore-pixel-sources';
import type { Layer } from '@/store/layer-slice';

function layer(id: string, type: Layer['type'] = 'image'): Layer {
  return {
    id,
    type,
    name: `layer-${id}`,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    order: 0,
  };
}

function pngBlob(): Blob {
  // 1x1 transparent PNG
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: 'image/png' });
}

describe('restorePixelSources', () => {
  beforeEach(async () => {
    await __resetForTests();
    pixelStore.clear();
    useEditorStore.setState({ layers: [], activeLayerId: null });
  });

  it('seeds pixelStore for every image layer that has a stored blob', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    // Stub createImageBitmap — the test runs in node, which doesn't ship it.
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1,
      height: 1,
      close: () => {},
    } as unknown as ImageBitmap)));
    // Stub OffscreenCanvas — same reason.
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l1', pngBlob());
    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(registerSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['l1', 'l2']);

    vi.unstubAllGlobals();
  });

  it('skips non-image layers', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} } as unknown as ImageBitmap)));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l1', pngBlob());
    useEditorStore.setState({ layers: [layer('l1', 'adjustment' as Layer['type'])] });

    await restorePixelSources('s1');

    expect(registerSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('skips layers with no stored blob and continues with the rest', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} } as unknown as ImageBitmap)));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toBe('l2');

    vi.unstubAllGlobals();
  });

  it('continues when a single blob fails to decode', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    // First call throws, second succeeds.
    let n = 0;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('decode failed');
      return { width: 1, height: 1, close: () => {} } as unknown as ImageBitmap;
    }));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l1', pngBlob());
    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/restore-pixel-sources.test.ts`
Expected: FAIL with module-resolution error — `./restore-pixel-sources` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/core/restore-pixel-sources.ts`:

```ts
/**
 * Walk the layer list and seed pixelStore from IndexedDB for any image layer
 * that has a persisted source blob. Failures (missing blob, decode error)
 * are non-fatal: that layer stays empty and the next one is tried.
 */
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { getSource } from './pixel-source-store';

export async function restorePixelSources(sessionId: string): Promise<void> {
  const layers = useEditorStore.getState().layers;
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    try {
      const blob = await getSource(sessionId, layer.id);
      if (!blob) continue;
      const bitmap = await createImageBitmap(blob);
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = source.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0);
      pixelStore.register(layer.id, source);
      bitmap.close();
    } catch (err) {
      console.warn('[restore-pixel-sources] failed for layer', layer.id, err);
    }
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/core/restore-pixel-sources.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/restore-pixel-sources.ts src/core/restore-pixel-sources.test.ts
git commit -m "feat(persistence): restorePixelSources helper"
```

---

## Task 4: Persist the source blob in `document.openImage`

After the in-memory `pixelStore.register`, write the originating `File` to IDB. Read the sessionId from `useBackendState` directly — if it isn't set yet (rare race; upload normally establishes session first), skip silently.

**Files:**
- Modify: `src/core/document.ts:123-170`

### Step-by-step

- [ ] **Step 1: Add the import block**

In `src/core/document.ts`, add the imports just below the existing import block (around line 13):

```ts
import { putSource } from './pixel-source-store';
import { useBackendState } from '@/store/backend-state-slice';
```

- [ ] **Step 2: Add the persistence call inside `openImage`**

Find the block in `src/core/document.ts:133-134`:

```ts
  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);
```

Change it to:

```ts
  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);

  // Best-effort: persist the source blob so Cmd+R can rehydrate this layer.
  const sid = useBackendState.getState().sessionId;
  if (sid) void putSource(sid, layerId, file);
```

- [ ] **Step 3: Run the type-check and the affected tests**

Run: `npx tsc -b && npx vitest run src/core`
Expected: no TS errors; existing core tests still pass; no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/core/document.ts
git commit -m "feat(persistence): persist source blob on openImage"
```

---

## Task 5: Restore on reattach + cleanup on 404 in `useBackendSession`

Two edits in `src/hooks/useBackendSession.ts`:

1. Inside the reattach 200 branch (after `setSnapshot(snap)`), call `restorePixelSources(persisted)`.
2. Inside the 404 branch (where `console.info('[backend-session] persisted session', persisted, 'is gone; starting fresh')`), call `deletePrefix(persisted)` before `reset()`.

**Files:**
- Modify: `src/hooks/useBackendSession.ts:140-186`

### Step-by-step

- [ ] **Step 1: Add the imports**

In `src/hooks/useBackendSession.ts`, add to the existing import block (just below the `maskPngBase64ToBytes` import):

```ts
import { deletePrefix } from '@/core/pixel-source-store';
import { restorePixelSources } from '@/core/restore-pixel-sources';
```

- [ ] **Step 2: Add the restore call after snapshot lands on reattach**

Find lines 169-175 in `src/hooks/useBackendSession.ts`:

```ts
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${persisted}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          const snap = await snapshotResp.json();
          setSnapshot(snap);
          void rehydrateMaskBytes(persisted, snap.masks_index ?? []);
        }
```

Change to:

```ts
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${persisted}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          const snap = await snapshotResp.json();
          setSnapshot(snap);
          void rehydrateMaskBytes(persisted, snap.masks_index ?? []);
          // Restore source bitmaps from IDB so the canvas isn't blank after reload.
          void restorePixelSources(persisted);
        }
```

- [ ] **Step 3: Wipe stale IDB entries when the backend has forgotten the session**

Find lines 151-156 in `src/hooks/useBackendSession.ts`:

```ts
      if (!alive) {
        // Backend has restarted or session evicted — start fresh.
        console.info('[backend-session] persisted session', persisted, 'is gone; starting fresh');
        reset();
        return;
      }
```

Change to:

```ts
      if (!alive) {
        // Backend has restarted or session evicted — start fresh.
        console.info('[backend-session] persisted session', persisted, 'is gone; starting fresh');
        await deletePrefix(persisted);
        reset();
        return;
      }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBackendSession.ts
git commit -m "feat(persistence): restore pixel sources on SSE reattach; wipe IDB on 404"
```

---

## Task 6: Clear IDB blobs on explicit `reset()`

When `backend-state-slice.reset()` runs, blow away every entry for the outgoing sessionId before clearing it from in-memory state.

**Files:**
- Modify: `src/store/backend-state-slice.ts:209-221`

### Step-by-step

- [ ] **Step 1: Add the import**

In `src/store/backend-state-slice.ts`, add to the existing imports:

```ts
import { deletePrefix } from '@/core/pixel-source-store';
```

- [ ] **Step 2: Modify `reset()` to wipe IDB blobs**

Find lines 209-221 in `src/store/backend-state-slice.ts`:

```ts
    reset: () =>
      set((s) => {
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.acceptedSuggestions = new Set();
        s.sseStatus = 'idle';
        s.currentPhase = null;
        s.mcpAnalyzeComplete = false;
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch { /* localStorage may be disabled (private mode); ignore. */ }
      }),
```

Replace with:

```ts
    reset: () =>
      set((s) => {
        // Fire-and-forget IDB wipe of the outgoing session's blobs before
        // we clear the id from in-memory state.
        if (s.sessionId) void deletePrefix(s.sessionId);
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.acceptedSuggestions = new Set();
        s.sseStatus = 'idle';
        s.currentPhase = null;
        s.mcpAnalyzeComplete = false;
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch { /* localStorage may be disabled (private mode); ignore. */ }
      }),
```

- [ ] **Step 3: Run the existing backend-state-slice tests**

Run: `npx vitest run src/store/backend-state-slice.test.ts`
Expected: all existing tests still pass. (They do not assert on IDB; `fake-indexeddb` is not imported here, so the `deletePrefix` call hits the unwrapped `indexedDB` global — which in node is `undefined`, and the wrapper logs a warning and resolves. That is exactly the documented best-effort path.)

- [ ] **Step 4: Commit**

```bash
git add src/store/backend-state-slice.ts
git commit -m "feat(persistence): wipe IDB pixel sources on backend reset"
```

---

## Task 7: Clean IDB entries when a layer is removed

The existing subscription in `layer-lifecycle.ts` removes the in-memory pixelStore pair. Add the matching IDB delete.

**Files:**
- Modify: `src/core/layer-lifecycle.ts:23-35`

### Step-by-step

- [ ] **Step 1: Add the imports**

In `src/core/layer-lifecycle.ts`, append to the existing imports:

```ts
import { deleteOne } from './pixel-source-store';
import { useBackendState } from '@/store/backend-state-slice';
```

- [ ] **Step 2: Wire the cleanup call**

Find lines 23-34 in `src/core/layer-lifecycle.ts`:

```ts
  return useEditorStore.subscribe((state) => {
    const currentIds = new Set(state.layers.map((l: Layer) => l.id));

    // Detect removed layers → clean up pixel data
    for (const id of prevLayerIds) {
      if (!currentIds.has(id)) {
        pixelStore.remove(id);
      }
    }

    prevLayerIds = currentIds;
  });
```

Change to:

```ts
  return useEditorStore.subscribe((state) => {
    const currentIds = new Set(state.layers.map((l: Layer) => l.id));
    const sid = useBackendState.getState().sessionId;

    // Detect removed layers → clean up pixel data + persisted source.
    for (const id of prevLayerIds) {
      if (!currentIds.has(id)) {
        pixelStore.remove(id);
        if (sid) void deleteOne(sid, id);
      }
    }

    prevLayerIds = currentIds;
  });
```

- [ ] **Step 3: Type-check + run the affected tests**

Run: `npx tsc -b && npx vitest run src/core src/store`
Expected: no TS errors; all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/layer-lifecycle.ts
git commit -m "feat(persistence): drop persisted source blob on layer removal"
```

---

## Task 8: Final verification

Run the full check pipeline and manually verify the bug is fixed.

- [ ] **Step 1: Run the project check**

Run: `npm run check`
Expected: tsc passes, lint passes, all tests pass (104 existing + 11 new = 115).

- [ ] **Step 2: Manual smoke test — golden path**

1. Start backend: `npm run dev:backend`
2. Start frontend: `npm run dev`
3. Open the editor, upload an image.
4. Open DevTools → Application → IndexedDB → `editor-pixel-sources` → `pixel-sources`. Confirm one entry keyed `<sessionId>:<layerId>` exists.
5. Press Cmd+R.
6. Expected: image reappears on the canvas with all adjustments. SSE status indicator shows reconnected.

- [ ] **Step 3: Manual smoke test — backend forgotten branch**

1. With an image loaded, stop the backend (Ctrl+C in its terminal).
2. Restart it: `npm run dev:backend`. (This starts a fresh process with no session memory.)
3. Press Cmd+R in the browser.
4. Expected: editor opens with no image, no error toast. DevTools → IndexedDB → `pixel-sources` is empty for the old session key.

- [ ] **Step 4: Manual smoke test — IDB-unavailable fallback**

1. Open the editor in a private browsing window (Safari private mode disables IDB writes).
2. Upload an image. Confirm console shows the warning from `pixel-source-store` but the editor remains usable.
3. Press Cmd+R. Expected: image is gone (pre-fix behavior preserved gracefully), no crash.

- [ ] **Step 5: Final commit (only if something needed adjusting)**

Only if any of the smoke tests required a code change, stage and commit it. Otherwise, this step is a no-op.

---

## Out of scope (do NOT do as part of this work)

- Persisting brush/paint working canvases.
- Persisting per-layer imported pixels beyond what the keying already supports.
- Cross-tab coordination for the same sessionId.
- A "session restored" toast or any new UI surface.
- Backend changes — no new endpoints, no schema changes.
