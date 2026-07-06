# Performance & Logic Audit — 2026-07-06

Scope: full `src/` scan for performance and logic bottlenecks. Conducted as four
parallel read-only audits (WebGL render path, React/Zustand re-renders, SSE/state
logic, async/worker/memory), with the top findings independently re-verified
against source before inclusion here.

**Verification legend:** ✅ verified against code by a second pass · ⚠️ plausible
from code structure, needs a runtime profile to confirm magnitude.

---

## Executive summary

The app is architecturally sound (rAF-coalesced pipeline, correct FBO lifecycle,
disciplined listener cleanup in most hooks). The bottlenecks cluster around **five
root causes**, and fixing those resolves the majority of individual findings:

1. **Whole-`optimistic`-Map subscriptions** — the live-preview Map's identity
   changes on every slider tick, and several always-mounted components/hooks
   subscribe to it wholesale. One slider drag re-renders *every* widget shell and
   re-composites *every* image node on canvas, not just the edited one.
2. **No dirty-tracking on GPU uploads** — the per-frame render re-uploads the full
   source texture (and, for RAW, re-runs a CPU normalize loop) even when only a
   param changed and pixels are identical.
3. **`operationGraph.nodes.find()` linear scans as independent subscriptions** —
   the same op-graph is scanned 5+ times per image node per backend update.
4. **Unbounded GPU/heap caches never evicted** — MobileSAM embeddings (~4 MB each)
   and LUT/curves textures leak for the page lifetime.
5. **Optimistic state can silently diverge from the backend** — fire-and-forget
   tool calls with no rollback, plus a full-replace tether reconcile that drops
   un-echoed optimistic edges.

Recommended order of attack is in the [roadmap](#remediation-roadmap) — items 1–3
are small, localized changes with broad fan-out benefit.

---

## Category A — React re-render / state fan-out

### A1. One slider tick re-composites every ImageNode on canvas — **Critical** ✅
`src/hooks/useImageNodeRender.ts:71` (subscription), effect deps `:321-350`

`const optimistic = useBackendState((s) => s.optimistic)` subscribes to the whole
Map. `applyOptimistic` (`backend-state-slice.ts:527`) reproduces the Map via Immer
on **every** keystroke/drag tick, so its identity always changes. The render effect
lists `optimistic` in its deps and calls `renderImageNodeComposite` (a real WebGL
pass) — so dragging one widget's slider repaints **every** mounted image node,
including nodes whose layers weren't touched.

**Fix:** subscribe to only the optimistic entries for this node's layers (key is
`canon:<layerId>:<op>`); build a `useShallow` selector over `layerIds`, or subscribe
to a small string signature of just the matching patch values.

### A2. Every WidgetShell re-renders on every optimistic tick — **High** ✅
`src/components/widget/WidgetShell.tsx:51`

Same whole-Map subscription. Editing one widget re-renders **all** shells; each
recomputes `dirty` by iterating all bindings + `readOptimistic` per binding
(`:120-124`). O(N widgets × bindings) per tick.

**Fix:** per-widget optimistic slice scoped to this widget's canonical node id(s),
returning a stable `useShallow` value; memoize `dirty` off it.

### A3. Five separate op-graph scans (as five subscriptions) per node — **High** ✅
`src/hooks/useImageNodeRender.ts:110-146`

`rotateAngle` + `cropRectX/Y/W/H` are five independent `useBackendState` selectors,
each doing `snapshot.operationGraph.nodes.find(...)` on two node ids — five linear
scans, five subscriptions, all re-running on every backend-state change (incl. every
optimistic tick). The same pattern recurs in `use-param.ts:55-79`.

**Fix:** one selector returning the two nodes (`{rotate, crop}`) via `useShallow`,
derive the six scalars locally. Structurally, add an `id → node` index to the
snapshot so all these lookups become O(1) instead of scans.

### A4. `storeNodes` rebuilds all RF nodes on any layer field change — **High** ✅
`src/components/workspace/CanvasWorkspace.tsx:225-272` (dep `layers`)

`storeNodes` depends on the whole `layers` array but uses it only for a header-title
fallback (`layers.find(...).name`, `:232`). Any opacity drag / visibility toggle /
reorder produces a fresh `layers` ref → rebuilds the entire node array → `nodes`
resync effect → full `derivedEdges` recompute. Large cascade for a name lookup.

**Fix:** subscribe to a narrow `id → name` map via `useShallow` (or precompute the
title in the workspace slice); drop `layers` from `storeNodes` deps.

### A5. `derivedEdges` fully recomputes every frame during a node drag — **High** ✅
`src/components/workspace/CanvasWorkspace.tsx:310-441` (dep `nodes`)

`onNodesChange` calls `setNodes` per drag frame → `nodes` identity flips each frame →
`derivedEdges` rebuilds a Map over **all** nodes and re-runs `pickTetherHandles`
geometry for every edge, then the edge resync effect `setEdges` reconciles all edges.
O(all nodes + all edges) per drag frame, when only edges incident to the dragged node
moved. (Note: this is the same `edges` mirror added in the recent edge-delete work —
correct, but it amplifies drag cost.)

**Fix:** recompute handles only for edges incident to the dragging node; or read live
positions from RF's internal store and throttle non-incident re-routing to drag-stop.

### A6. CommandPalette recomputes target/region trees while closed — **Medium** ✅
`src/components/CommandPalette.tsx:96-101,156-159`

Always mounted; subscribes to `imageNodes`, `layers`, `activeImageNodeId`,
`masksIndex`. Even while closed, a layer drag re-renders this 1202-line component and
recomputes `elementList`/`buildTargetElements`/`genfillTarget`. Query-gated work is
fine; the target/region memos are not gated on `open`.

**Fix:** gate expensive derivations on `open` (or move the body into a child that only
mounts when open); `useShallow` the collection subscriptions.

### A7. `useLayerWidgets` returns a fresh array every render — **Medium** ✅
`src/hooks/useLayerWidgets.ts:9-17`

Unmemoized `new Set` + double `filter`, new array ref each call — defeats downstream
memoization in any consumer that deps on it. **Fix:** `useMemo` or a `useShallow`
selector.

### A8. Widget size writes ripple into node/edge rederive — **Medium** ✅
`src/components/workspace/CanvasWorkspace.tsx:291-308`

`onNodesChange` writes measured widget sizes into `widgetNodes` (subscribed by the
workspace), so ResizeObserver-driven measurement can trigger `storeNodes` → nodes →
`derivedEdges`. The 1px threshold limits thrash but doesn't remove the coupling.
**Fix:** keep footprints in a non-reactive Map read by `workspace-tether`, not in the
subscribed `widgetNodes`.

---

## Category B — WebGL render hot path

### B1. Source texture re-uploaded to GPU every frame — **Critical** ✅
`src/lib/pipeline-manager.ts:38-41` → `src/shaders/pipeline.ts` `setSource` (dirty
defaults `true`)

`setSourceCanvas` calls `setSource(canvas)` with no dirty flag, and the per-layer
render (`image-node-renderer.ts`) precedes every `renderSync` with a
`setSourceCanvas`. So a full `texImage2D` of the entire source runs **every frame**,
including slider drags where pixels are identical (~64 MB re-upload/frame for a 4K
layer). The `dirty=false` + `sourceIdentity` short-circuit already exists but is never
reached on the hot path.

**Fix:** thread a `dirty` flag through `setSourceCanvas`; pass `false` when only
params changed (bump on `pixelVersion` change only).

### B2. RAW path allocates a full Float32Array + CPU normalize loop every frame — **Critical** ✅
`src/shaders/pipeline.ts:545-590` (`setHiBitSource`)

For 16-bit layers, each render allocates `new Float32Array(w*h*4)` and runs a
per-pixel uint16→float loop (~268 MB alloc + 67M iterations per tick at 4K). The
cached `hiBitStore.getDownscaled` returns a stable object, so `dirty=false` would skip
it entirely — but the caller never passes it.

**Fix:** same dirty threading as B1; optionally cache the normalized float buffer on
the `HiBitImage`.

### B3. Per-frame layer-mask apply does GPU→CPU readback + JS pixel loop — **High** ✅
`src/lib/layer-compositor.ts:109-121`

Any layer with a `layerMask` runs `getImageData` (synchronous pipeline stall) → JS
loop over every pixel multiplying alpha → `putImageData`, **every composite** (not
just on mask change). ~33M iterations/frame per masked layer on the main thread. The
pipeline already has an R8 mask-texture path (`pipeline.ts:711-728`).

**Fix:** apply the mask as a GPU multiply, or cache the premultiplied result keyed on
(layer pixels, mask) and recompute only on change.

### B4. Uniform locations queried every uniform/pass/frame — **High** ✅
`src/shaders/pipeline.ts` (`setUniforms`/`drawPass`)

No `getUniformLocation` caching — dozens–hundreds of synchronous driver queries per
frame returning values that never change for a program. **Fix:** cache locations per
program once at `initShaders`.

### B5. `applyGeometry` allocates a full canvas + extra drawImage every frame — **High** ✅
`src/lib/image-node-geometry.ts:43-52` (called from `image-node-renderer.ts`)

Unconditionally `createElement('canvas')` at rotated-bbox size + full `drawImage`
every non-bake render. At angle 0 / no crop (the common case) this is pure waste that
defeats the `getInternalCanvas` caching right above it. **Fix:** fast-path the
identity transform (blit internal→visible directly); otherwise reuse a cached working
canvas.

### B6. No per-layer composite caching — **Medium** ✅
`src/lib/image-node-renderer.ts:268-343`

Editing one adjustment re-uploads + re-renders **all** layers of a multi-layer node
(no dirty-tracking of which layer changed). Combined with B1, an N-layer node costs N
full uploads + N pipeline runs per frame. **Fix:** cache each layer's output canvas
keyed on (pixel version, node/param signature, renderScale); skip unchanged layers.

### B7. Overlay painters allocate + full-image scan on hover — **Medium** ✅
`src/lib/overlay-painters.ts` (`paintMaskFill`/`paintMaskOutline`/`paintSegmentation`)

Fresh temp canvas + `createImageData` + full per-pixel loops each paint; the render
effect re-fires on `hoveredObjectId` changes, so hovering segments triggers full-image
rescans + a canvas alloc each time. **Fix:** cache the overlay to an offscreen canvas
keyed by mask id+version; reuse a persistent temp canvas.

---

## Category C — SSE / state-sync logic

### C1. `syncWidgetTethers` full-replace drops un-echoed optimistic edges — **High** ✅
`src/store/workspace-slice.ts:440-466`; effect `CanvasWorkspace.tsx:186-188`

`state.tetherEdges = next` rebuilds the whole map from `snapshot.widgets[].nodes[0]
.layerIds` only. The effect also fires on `imageNodes` changes, so **any node
drag-stop** re-runs the rebuild. Race: user drags a new tether (optimistic
`addWidgetTarget` + fire-and-forget backend call); before the echo lands, any node
move re-runs the rebuild from the stale snapshot → the optimistic edge silently
vanishes. `retargetWidget` can lose both old and new edge in the same window.

**Fix:** reconcile per-key (merge/diff), and preserve optimistic edges whose backend
round-trip is still pending (a pending set keyed by edge id, cleared on echo/failure).

### C2. Fire-and-forget `update_widget_targets` swallows failures — **High** ✅
`src/components/workspace/CanvasWorkspace.tsx` (connect/reconnect/delete handlers);
`src/lib/backend-tools.ts:86-113`

All tether mutations `void backendTools.update_widget_targets(...)`. `invokeTool`
throws on non-OK responses → with `void` and no `.catch`, a 500/timeout is an
**unhandled rejection** and the optimistic state diverges permanently. Remove/retarget
are worse (local state already gone) → guaranteed flip-flop on next sync.

**Fix:** `.catch` that rolls back the optimistic mutation + toasts; never `void` a
rejectable promise.

### C3. Un-versioned `setSnapshot` lets revision move backwards & drop events — **High** ✅
`src/store/backend-state-slice.ts:545` (`setSnapshot` is a blind assign); writers in
`useBackendSession.ts` + `refetchSnapshot`

Two independent fetches (bootstrap prefetch + coalesced refetch) both blind-write with
no revision comparison. If the higher-revision refetch lands first and the stale
bootstrap lands second, the store regresses, and the stale-event guard
(`ev.revision <= snapshot.revision`) then **silently drops** the intervening events.

**Fix:** make `setSnapshot` ignore a snapshot whose `revision` ≤ current (monotonic
guard); gate the bootstrap prefetch behind "no snapshot set since I started."

### C4. Undo/redo drains backend stack before frontend → wrong LIFO order — **High** ⚠️
`src/core/document.ts:508-542`

`undoAction` always tries `backendTools.undo()` first, falling back to frontend
`history.undo()` only on 409. But frontend ops (node moves, tether batches, info
widgets) and backend ops (slider commits, widget lifecycle) interleave on two
independent stacks. Backend-first draining means undo order ≠ action order, and a new
backend mutation never truncates the frontend redo stack (`history.ts:14-22`) — a
later redo can resurrect a stale, inconsistent frontend snapshot. `undoAction` also
calls `endInteraction()` first, so one undo press can commit one thing and undo a
different thing.

**Fix:** unify into one ordered history of `{origin, id}` markers (or a monotonic
per-push sequence compared across stacks); invalidate the opposite redo stack when a
mutation lands.

### C5. Frontend undo restores layer metadata but pixels are already gone — **High** ✅
`src/core/layer-lifecycle.ts:46-61`; `src/core/document.ts:123-140`

`restoreState` never restores pixels, while the layer-lifecycle subscriber calls
`pixelStore.remove` / `hiBitStore.remove` the instant a layer id disappears. So
deleting an image node (frontend op → 409 → `restoreState` on undo) brings the layer
metadata back but the OffscreenCanvas is gone → restored layer renders gray. A
non-destructive-undo violation.

**Fix:** capture/restore pixel handles in the history snapshot, or tombstone pixel
deletion so undo can revive it — don't eagerly destroy pixels in a store subscriber.

### C6. Layer-lifecycle issues irreversible `delete_mask` during undo/redo — **Medium-High** ✅
`src/core/layer-lifecycle.ts:33-62`

The subscriber reacts to *any* layer-id disappearance, including those caused by
`restoreState` during history navigation, firing a permanent backend `delete_mask`.
History navigation thus irreversibly deletes backend masks. It also runs its full diff
on every store mutation (viewport/tool/selection), not just layer changes.

**Fix:** flag history-restore transitions and suppress backend mask deletion during
them; distinguish user-initiated deletion from restore.

### C7. `refetchSnapshot` coalescing can drop mid-fetch events — **Medium** ⚠️
`src/store/backend-state-slice.ts:157-176`

`_snapshotRefetchInFlight` skips overlapping refetches, but an event whose backend
change commits *after* the in-flight fetch snapshotted state is neither applied nor
captured — lost until some later event triggers another refetch. No "dirty during
fetch → re-run once" flag, and `fetchSnapshot` has no timeout (a hung fetch blocks all
future refetches). **Fix:** add a dirty-during-fetch flag + a fetch timeout/abort.

---

## Category D — async / worker / memory

### D1. MobileSAM embedding cache never evicted — **High** ✅
`src/hooks/useMobileSam.ts:8,97`

Module-level `Map<imageNodeId, EncoderEmbedding>`; each embedding (1×256×64×64 f32) is
~4.2 MB. `clearMobileSamCache` exists but has **no production caller** (only a test).
`initLayerLifecycle` cleans pixel/hiBit/mask stores but not this. Every node ever
segmented leaks ~4 MB for the page lifetime, including deleted nodes.

**Fix:** call `clearMobileSamCache` for the owning image node in the layer-removal
loop and on `pixelStore.replaceSource`.

### D2. LUT / curves GPU texture caches leak per adjustment id — **High** ✅
`src/shaders/pipeline.ts:90,94,763`

`lutTextureCache` + `curvesLutTextures` hold live GPU textures keyed by `adj.id`
(3D `.cube` LUTs ~1 MB VRAM each). `clearLutCache` has **no caller** and `dispose()`
runs only at app teardown. Deleting/undoing a filter or curves widget (or id churn
from fresh AI-suggestion ids) orphans the texture → steady VRAM growth.

**Fix:** expose `PipelineManager.clearLutCache(adjId)` and invoke it on
widget/adjustment-node removal.

### D3. "Heavy work in workers" is unwired — main-thread pixel loops — **Medium** ✅
`src/workers/worker-pool.ts`, `src/workers/processing.worker.ts`

`WorkerPool` has **zero production callers** (dead code), yet the heavy loops all run
on the main thread: mask apply (B3), the RAW normalize (B2), the MobileSAM threshold
loop (`mobile-sam-client.ts:141-144`), `rasterisePathsToMask`
(`useImageContext.ts:82-107`). CLAUDE.md claims workers for all heavy compute.
**Fix:** either delete the dead module, or route these loops through it with
transferables both directions.

### D4. `renderLayer` allocates a fresh `<canvas>` every composite — **Medium** ✅
`src/lib/layer-compositor.ts:97-101`

No-adjustments branch does `createElement('canvas')` per visible layer per composite
(rAF cadence during drags) — multi-MB backing store created and discarded each frame.
**Fix:** reusable per-layer scratch canvas keyed by layer id, resized in place.

### D5. Fire-and-forget backend calls without `.catch` — **Low** ✅
`src/core/layer-lifecycle.ts:50,59` (`void deleteOne` / `void delete_mask`)

Network failure → unhandled rejection. **Fix:** attach `.catch`. (Same class as C2.)

### D6. Analyze `ImageBitmap`s never `close()`d — **Low** ✅
`src/hooks/useImageContext.ts:431,466,484`

`createImageBitmap(source)` is uploaded but never closed, unlike the disciplined
`bitmap.close()` elsewhere (`useMobileSam.ts:79`, `pixel-store.ts`). Holds decoded
pixels until GC. **Fix:** `close()` after upload resolves.

---

## Confirmed NOT bugs (checked, no action)

- The tether reconcile effect (`CanvasWorkspace.tsx:186`) intentionally omits
  `tetherEdges` from deps — it does **not** self-loop. The problem is the rebuild
  *content* (C1), not a loop.
- `useCallback` tether handlers read fresh state via `getState()`/`sid()` — no
  stale-closure capture despite thin dep arrays.
- Frontend history is bounded (`MAX_ENTRIES = 20`, `history.ts`); optimistic map is
  cleaned on revision advance. No unbounded growth there.
- `mask.created` is idempotent by id — safe against SSE replay.
- Listener/rAF/ResizeObserver cleanup is correct in `App.tsx`, `WidgetNode.tsx`,
  `useNodePreview.ts`, `CircularDial.tsx`, `pipeline-manager.ts`. FBO/texture
  `dispose()` is thorough.

---

## Remediation roadmap

Ordered by (impact ÷ effort). The first three are small and high-leverage.

| # | Fix | Resolves | Effort |
|---|-----|----------|--------|
| 1 | Scope optimistic subscriptions to relevant canonical node ids (stop subscribing to the whole Map) | A1, A2, and the D-side of per-tick fan-out | S |
| 2 | Thread a `dirty` flag through `setSourceCanvas`/`setHiBitSource` (skip re-upload when only params changed) | B1, B2 | S |
| 3 | Add an `id → node` index to the snapshot; collapse the 5 crop/rotate selectors | A3, `use-param` scans | S |
| 4 | Per-key merge in `syncWidgetTethers` + pending-set; add `.catch` rollback to tether tool calls | C1, C2 | M |
| 5 | Wire `clearMobileSamCache` + `clearLutCache(adjId)` into layer/widget removal | D1, D2 | S |
| 6 | Move layer-mask multiply onto the GPU (kill the readback loop) | B3, part of D3 | M |
| 7 | Monotonic-revision guard in `setSnapshot`; dirty-during-fetch flag + fetch timeout | C3, C7 | M |
| 8 | Narrow `storeNodes`/`derivedEdges` recompute to changed inputs | A4, A5, A8 | M |
| 9 | Cache per-layer composite + geometry canvas; cache uniform locations | B4, B5, B6, D4 | M |
| 10 | Rework undo/redo into a unified ordered history; restore pixels / tombstone deletion | C4, C5, C6 | L |

Items 4, 7, and 10 are correctness (data-loss / divergence) risks, not just perf —
worth prioritizing even though they're larger than the perf quick-wins.
