# Image Restore on Page Reload — Design

**Date:** 2026-05-29
**Status:** Approved (design phase)
**Branch context:** `feat/canvas-centric-ui`

## Problem

Pressing Cmd+R while an image is loaded leaves the editor empty.

Commit `def7e98` already persists `sessionId` in localStorage and re-establishes the SSE connection on reload, and the backend snapshot rehydrates widgets, masks, and `operation_graph`. But the source bitmaps live exclusively in the in-memory `pixelStore` (Map of `layerId → { source, working }: OffscreenCanvas`). The backend never stored the original image bytes (there is no `GET /api/state/{sid}/image` endpoint — sessions are metadata-only), so reload produces a half-state: the snapshot is restored, but every image layer is pixel-less and the canvas is blank.

## Goal

After Cmd+R (or any other full reload), the editor returns to the visual state it was in before reload: image layer(s) visible with all adjustments applied. No user action required.

## Non-goals

- Brush/paint working canvases (feature not shipped).
- Multi-tab coordination beyond what IndexedDB gives for free.
- Quota management, eviction strategies, compression of stored blobs.
- Persisting viewport zoom/pan.
- Persisting adjustment data (already lives on the backend per Engine SSoT Doctrine).
- Server-side image storage / a backend GET endpoint for source bytes.

## Approach

Persist source bitmaps locally in IndexedDB, keyed by `${sessionId}:${layerId}`. On reload, after the backend snapshot lands, walk the layer list and seed `pixelStore` from IDB for each image layer. Compositor already redraws on `pixelStore` + snapshot changes, so the image reappears automatically.

## Components

### New: `src/core/pixel-source-store.ts`

Thin async IndexedDB wrapper.

- DB name: `editor-pixel-sources`, version `1`.
- Object store: `pixel-sources`, key path is implicit (the string key is supplied by the caller).
- API:
  - `putSource(sessionId: string, layerId: string, blob: Blob): Promise<void>`
  - `getSource(sessionId: string, layerId: string): Promise<Blob | null>`
  - `deleteOne(sessionId: string, layerId: string): Promise<void>`
  - `deletePrefix(sessionId: string): Promise<void>` — opens a cursor, deletes every key whose string value starts with `${sessionId}:`.
- All operations wrapped in try/catch. On any IDB error (unavailable, quota, blocked upgrade), log a `console.warn` and resolve to `undefined` / `null`. Persistence is best-effort.

### Modified: `src/core/document.ts`

`openImage(file: File)` currently:
1. Calls `createImageBitmap(file)`.
2. Writes to `pixelStore` via `setSource(layerId, bitmap)`.
3. Triggers the layer-slice update.

Add: after step 2, when `sessionId` is set, call `putSource(sessionId, layerId, file)`. The `File` object passed in already satisfies the `Blob` interface, so no copy is needed. If `sessionId` is not yet set, skip — the upload flow establishes the session first, so this path is reached with a valid id in the common case. (We do not retroactively persist if `setSessionId` fires later; that complexity is YAGNI for the MVP.)

### Modified: `src/hooks/useBackendSession.ts`

The reattach branch (around lines 126–179) currently:
1. Reads persisted `sessionId` from `localStorage`.
2. Probes `GET /api/state/{sid}`.
3. On 200, reattaches SSE and fetches the snapshot.
4. On 404, calls `reset()`.

Add to the 200 branch, after the snapshot has been written to the store:

```ts
await restorePixelSources(sessionId);
```

`restorePixelSources(sessionId)` is a new private helper:

```ts
async function restorePixelSources(sessionId: string) {
  const layers = useEditorStore.getState().layers;
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    const blob = await getSource(sessionId, layer.id);
    if (!blob) continue;
    const bitmap = await createImageBitmap(blob);
    pixelStore.setSource(layer.id, bitmap);
  }
}
```

Failures inside the loop (`getSource` returning `null`, `createImageBitmap` throwing) are non-fatal — the layer stays empty and the user can re-import.

Also extend the 404 branch:

```ts
await deletePrefix(staleSessionId);
```

so orphan blobs from killed backend sessions don't accumulate.

### Modified: `src/store/backend-state-slice.ts`

`reset()` currently clears `sessionId` from localStorage and resets in-memory state. Add `await deletePrefix(oldSessionId)` before clearing, so that explicit resets also clear stored blobs. Because `reset` is currently synchronous and callers don't await it, change its signature to return a `Promise<void>` and update the (small number of) call sites accordingly.

### Modified: `src/core/layer-lifecycle.ts`

The existing subscription already deletes `pixelStore` entries on layer removal. Add `deleteOne(sessionId, layerId)` alongside, reading `sessionId` from `useBackendState.getState()`. If `sessionId` is null (no live session), skip — there is nothing to delete.

## Data flow

```
Upload:
  user picks file
    → document.openImage(file)
      → createImageBitmap → pixelStore.setSource(layerId, bitmap)
      → putSource(sessionId, layerId, file)  // NEW

Reload (Cmd+R):
  app boots
    → localStorage has sessionId
    → useBackendSession probes /api/state/{sid}
    → 200: reattach SSE, fetch snapshot → store
      → restorePixelSources(sessionId)  // NEW
        → for each image layer:
          → getSource(sessionId, layer.id) → Blob
          → createImageBitmap → pixelStore.setSource(layer.id, bitmap)
      → compositor redraws (existing subscription)
    → 404: deletePrefix(staleSessionId) + reset()  // NEW prefix wipe

Layer removed:
  layer-lifecycle subscription
    → pixelStore.delete(layerId)
    → deleteOne(sessionId, layerId)  // NEW

Explicit reset:
  reset()
    → deletePrefix(sessionId)  // NEW
    → clear localStorage + in-memory state
```

## Error handling

- IDB unavailable (Safari private browsing, blocked upgrade, denied permission): wrapper logs once, returns `null` / resolves immediately. Editor behaves as today — reload shows empty canvas, user re-imports.
- Quota exceeded on `putSource`: log warning, do not surface. Reload will show empty canvas for that session.
- `createImageBitmap` throws on a corrupted blob: catch in `restorePixelSources`, leave the layer empty, continue with remaining layers.
- Stale entries from sessions the backend has already forgotten: cleaned up by the 404-branch `deletePrefix`.

## Testing

### Unit — `src/core/pixel-source-store.test.ts`

Uses `fake-indexeddb` (add as devDependency if not already present).

- put then get returns the same blob bytes
- get of a missing key returns `null`
- deleteOne removes one entry, leaves siblings
- deletePrefix removes only entries with matching prefix
- put / get / delete on a closed-then-reopened DB still work (verifies no state pinned to a single connection)
- IDB unavailable path: monkey-patch `indexedDB` to throw, assert all operations resolve without throwing

### Integration — `src/hooks/useBackendSession.test.ts` (extend or add)

Mocks: `fake-indexeddb`, `fetch` for `/api/state/{sid}`, a fixture snapshot containing two image layers.

- Pre-seed `pixel-sources` with blobs for both layer ids. After reattach completes, assert `pixelStore.setSource` was called twice with the expected bitmaps.
- One blob present, one missing: assert one `setSource` call, no throw.
- 404 reattach: assert `deletePrefix` was called with the stale id.

No live backend in tests; reuse the existing mocking pattern from the suite.

## Migration / rollout

No data migration. First load after deploy: nothing in IDB → first reload shows empty canvas (current behavior). After the user opens an image, future reloads of that session restore correctly.

No feature flag — the change is additive and falls back cleanly when IDB is unavailable.

## Open questions

None at design time.

## Out-of-scope follow-ups (do NOT do as part of this work)

- Persisting brush/paint working canvases (revisit when destructive brush ships).
- Persisting per-layer imported pixels (e.g., a future "place image" tool) — the keying scheme already supports it, so no design change needed when that ships.
- Cross-tab coordination for the same sessionId.
