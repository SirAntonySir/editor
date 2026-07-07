# Reversible (live-linked) Copy of a masked selection

**Date:** 2026-07-07
**Status:** Draft for review

## Goal

Today **Copy** (object/selection → new layer or new image node) bakes the
source's adjustments into the copied pixels: `extractLayerFromMask` renders the
source *through its adjustment pipeline* (`LayerCompositor.renderLayer`) and
clips that already-adjusted result by the mask. The copy is a dead, flat raster.

Make Copy **non-destructive and live-linked**: the copy holds the **raw** masked
pixels and renders them through the **source layer's live adjustment stack**.
Editing the source's adjustments (widgets or accepted/baked ops) updates the
copy instantly; undoing them un-adjusts the copy. Reversible, and a genuine
instance/alias of the source's grade.

Chosen model (confirmed with user): **live-linked** (shared with the source),
implemented via an **adjustment-source redirect** in the renderer.

## Model

Add one optional field to `Layer` (`src/store/layer-slice.ts`):

```ts
/** When set, this layer renders its OWN pixels through ANOTHER layer's live
 *  adjustment stack (a "linked copy"). The renderer looks up operation-graph
 *  nodes under `adjustmentSourceLayerId` instead of this layer's id, so the
 *  copy tracks the source's grade. Cleared if the source layer is deleted. */
adjustmentSourceLayerId?: string;
```

Frontend-owned layer metadata (like `parentLayerId` / `sourceOrigin`); persisted
with the layer set, no backend change.

## Renderer redirect

In `image-node-renderer.ts`, the per-layer pass selects adjustments by matching
op-graph nodes to the layer being drawn ([line ~297](../../../src/lib/image-node-renderer.ts#L297)):

```ts
for (const layerId of layerIds) {
  const layer = layersById.get(layerId);
  ...
  const source = CanvasRegistry.get(layerId);          // pixels: the COPY's own
  const adjLayerId = layer.adjustmentSourceLayerId ?? layerId;  // adjustments: SOURCE's
  const layerNodes = nodes.filter(
    (n) => matchesLayer(n, adjLayerId) && !Array.isArray(n.layerIds) && ...
  );
  ...
}
```

- Pixels stay the copy's own raw source; only the *adjustment selection* is
  redirected. Optimistic overrides ride along unchanged — the selected nodes
  carry the source's `layerId`, so `withOptimistic` keys on the source's
  `canon:<sourceLayerId>:<op>` (same live edits the source shows).
- Works **within one image node** (copy-to-layer) and **across image nodes**
  (copy-to-image-node): the op-graph is global, so filtering by the source's id
  finds its nodes wherever the copy lives.
- **Node-scope pass** (composite-then-apply, `n.layerIds` arrays,
  [line ~373](../../../src/lib/image-node-renderer.ts#L373)): v1 covers per-layer
  (single-`layerId`) adjustments, which is the common case. Node-scope /
  broadcast ops that should also cover a linked copy are a follow-up.

## Copy flow

Extend `extractLayerFromMask` (`src/store/segment-actions.ts`) with an option:

```ts
extractLayerFromMask({ sourceLayerId, maskRef, cropToMaskBbox?, linkAdjustmentsToSource? })
```

When `linkAdjustmentsToSource`:
- bake the **raw** source (`pixelStore.getSource(sourceLayerId)`) × mask alpha,
  instead of `LayerCompositor.renderLayer(source)` (the rendered composite);
- stamp `adjustmentSourceLayerId: sourceLayerId` on the new layer.

`copyObjectToLayer` and `copyObjectToImageNode` pass `linkAdjustmentsToSource:
true`. **Copy becomes reversible/linked by default** — this replaces the bake.
(A future "Copy flattened" that bakes could be re-added if a hard, independent
copy is ever wanted — see Open questions.)

The `cropToMaskBbox` path is unaffected: the cutout is raw cropped pixels; the
source's *parametric* adjustments (exposure/curves/levels/lut/color) apply
uniformly to the cutout, giving the same look the region had in the source.

## Lifecycle & cleanup

- **Source deleted:** in `removeLayer` (or the layer-lifecycle hook), clear
  `adjustmentSourceLayerId` on any layer that referenced the removed id. The
  copy then renders its raw pixels with no adjustments — a graceful degrade
  (never a crash / dangling lookup). The renderer is also defensive: a dangling
  id simply matches no nodes.
- **Undo/redo & persistence:** `adjustmentSourceLayerId` is captured with the
  layer set (SerializableState + `.edp` already persist `layers`), so links
  survive undo and reload.

## UX

- The copy should visibly read as **linked** so the user knows the adjustments
  live on the source. v1: a small link glyph on the copy's LayerStrip row /
  Layer-tab row (tooltip: "Adjustments linked to <source>"). A richer canvas
  connector (reuse the provenance tether visual) is a follow-up.
- **Thumbnails:** the active layer's thumb reflects live adjustments via
  `activeCanvasBus`, so a linked *active* copy previews correctly. Non-active
  layer thumbs draw raw source pixels today, so they won't show the linked
  grade until selected — acceptable for v1; note it.

## Testing

- Renderer: a layer with `adjustmentSourceLayerId = X` applies X's op-graph
  nodes (assert `matchesLayer` selection uses the redirect); its own pixels come
  from its own `CanvasRegistry` entry.
- `extractLayerFromMask({ linkAdjustmentsToSource: true })`: bakes from
  `pixelStore.getSource` (raw), sets `adjustmentSourceLayerId`, does NOT call
  `LayerCompositor.renderLayer`.
- `copyObjectToLayer` / `copyObjectToImageNode`: new layer carries the link.
- Lifecycle: deleting the source clears `adjustmentSourceLayerId` on linked
  copies.

## Open questions / scope

- **Default vs option:** this makes Copy linked-by-default (the user's complaint
  was the bake). Confirm we drop the flat-bake entirely for now vs keep a
  "Copy flattened" variant.
- **Independent grade on the copy ("unlink"):** the linked copy borrows the
  source's stack and can't be graded on its own yet. An explicit *Unlink*
  action (bake current look, or clone to an independent stack via the existing
  `duplicate_layer_edits`) is a natural follow-up, not v1.
- **Mask-scoped adjustments:** whole-layer adjustments link cleanly; a widget
  scoped to a *region inside* the source won't remap onto the cutout's
  coordinates. v1 links whole-layer grades; region-scoped remap is out of scope.

## Out of scope

Backend changes (none — the redirect is pure frontend render selection),
node-scope/broadcast linking, the Unlink action, region-scoped remap, and the
richer canvas link-tether visual.
