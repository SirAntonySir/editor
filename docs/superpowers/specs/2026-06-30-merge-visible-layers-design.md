# Merge Visible Layers + LayerStrip upgrades

**Date:** 2026-06-30
**Status:** Approved — implementing inline
**Branch:** `feat/merge-visible-layers`

## Problem

There's no way to flatten the visible layers of one image node into a single layer
(Photoshop "Merge Visible"). Separately, the left-side per-layer marginalia (LayerStrip)
has only a native-title tooltip and a partial right-click menu; it should get proper hover
labels and a complete context menu.

## Decisions (from brainstorming)

1. **True Merge Visible** — composite only the *visible* layers into one new flat raster
   layer; **hidden layers are untouched** (still hidden, still editable).
2. **Appearance-preserving bake** — bake each visible layer's *own* adjustments, mask,
   blend mode and opacity into the flat raster. **Whole-node** adjustments (crop/rotate,
   node-scoped grades) are left live, so they keep applying to the merged layer *and* the
   surviving hidden layers — the picture looks identical before/after merge.
3. **Entry point** — a "Merge visible layers" item on the **image-node** right-click menu
   (`ImageNodeDrafting`), disabled when `< 2` visible layers.
4. **LayerStrip** also gets hover labels + a finished context menu.

## 1. Bake mechanism

`image-node-renderer.ts`'s per-layer composite loop (`:252-327`) already produces the exact
bake target — per-layer adjustments + mask + blend + opacity — *before* the node-scope and
geometry passes. Add an opt-in flag:

- `RenderImageNodeCompositeArgs.bakePerLayerOnly?: boolean` — when true, after the per-layer
  loop, blit the internal canvas to the output `canvas` and `return`, skipping the
  node-scope pass, geometry (crop/rotate), and overlays.
- The bake calls it with `renderScale: 1` (full source resolution) and the node's full
  `layerIds` (the loop's `!layer.visible` check already skips hidden layers).

This reuses the on-screen pipeline, so the baked pixels are identical to what's rendered.

## 2. Merge orchestration

New `src/lib/merge-visible-layers.ts`:

```ts
export function mergeVisibleLayers(imageNodeId: string): void
```

Flow (entirely inside one `recordSnapshot('Merge visible layers', …)` for a single undo step):

1. Read the node + its layers. Collect **visible** layer ids in `node.layerIds` order.
   If `< 2` visible → `toast.info('Merge needs 2+ visible layers.')` and return (no snapshot).
2. **Bake:** new `OffscreenCanvas(sourceSize.w, sourceSize.h)`; call
   `renderImageNodeComposite({ canvas, imageNodeId, layerIds: node.layerIds,
   sourceWidth, sourceHeight, opGraph, widgets, renderScale: 1, bakePerLayerOnly: true })`.
3. **Register** the canvas: `pixelStore.register(mergedId, canvas)` +
   `addLayer({ id: mergedId, type:'image', name:'Merged', visible:true, opacity:1,
   blendMode:'normal', locked:false })`.
4. **Restitch** `node.layerIds` via the pure `planMergeVisible` (below): merged id at the
   bottommost-visible slot, hidden ids kept in place, other visible ids dropped.
5. **Remove** the old visible layers: `removeLayer(id)` each, wrapped in try/catch for the
   "layer has children" throw (skip those). `layer-lifecycle` then auto-cleans their pixels
   + masks; their backend op-graph nodes orphan harmlessly (now baked into pixels).

### Pure helper (TDD'd)

```ts
export function planMergeVisible(
  layerIds: string[],
  isVisible: (id: string) => boolean,
  mergedId: string,
): { newLayerIds: string[]; removedIds: string[] }
```

- `newLayerIds`: walk `layerIds`; at the first (bottommost) visible id emit `mergedId`;
  drop other visible ids; keep hidden ids in original positions.
- `removedIds`: the visible ids.
- Caller guards `removedIds.length >= 2` before invoking the side-effecting merge.

## 3. Image-node menu item

In `ImageNodeDrafting`'s `renderMenuItems(id)`, add a "Merge visible layers" `Item`,
`disabled` when the node has `< 2` visible layers (reads inert, never errors). `onSelect`
calls `mergeVisibleLayers(id)`.

## 4. LayerStrip — hover labels + context menu

`src/components/workspace/drafting/LayerStrip.tsx`:

- **Hover label:** drop the native `title`; show a styled floating label (layer name) beside
  the hovered marker via CSS `group-hover` (no JS), in the flat overlay register.
- **Context menu (final set):**
  - **Hide / Show** — toggles `visible` (new; label reflects current state).
  - **Change blend mode** — existing submenu.
  - **Open layer panel** — `usePreferencesStore.setInspectorTab('layer')` + un-collapse the
    right sidebar (`setRightSidebarCollapsed(false)`).
  - **Delete** — route through a new document-facade method
    `editorDocument.removeLayer(id)` that wraps `removeLayer` in `recordSnapshot` (so it's
    finally **undoable**) and catches the has-children throw.
  - Keep **Rename** and **Lock**.

## 5. Edge cases

- `< 2` visible: menu item disabled; orchestration also guards (defensive).
- Visible layer with children (`parentLayerId`): `removeLayer` throws → caught/skipped, layer
  survives. Rare (branched layers); acceptable.
- Single node, all layers visible: merges all into one — fine.
- Backend disconnected: merge is purely frontend (pixels baked locally); works offline. The
  removed layers' source blobs are deleted best-effort when a session exists.

## 6. Testing

- **`planMergeVisible`** (pure, node test): bottommost-visible placement; hidden preserved;
  interleaved hidden+visible; all-visible; removedIds correct.
- **`mergeVisibleLayers`** (jsdom, render mocked): `<2` visible is a no-op with toast; on
  success a new "Merged" layer exists, the visible layers are gone, `node.layerIds` matches
  the plan, and exactly one history entry is pushed.
- **LayerStrip** (jsdom): Hide toggles `visible`; Delete pushes one undo entry; Open-layer-
  panel sets the inspector tab.
- Pixel-level bake fidelity is WebGL → verified in-app, not jsdom.

## Out of scope

- Merging across image nodes (that's the existing `mergeImageNodes`).
- A full Layers panel redesign — only the LayerStrip hover label + menu.
- Backend op-graph garbage collection of orphaned removed-layer nodes (harmless; filtered by
  a layer_id that no longer exists).
