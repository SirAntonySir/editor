# Reversible (independent) Copy of a masked selection

**Date:** 2026-07-07
**Status:** Implemented

## Goal

Today **Copy** (object/selection → new layer or new image node) bakes the
source's adjustments into the copied pixels: `extractLayerFromMask` renders the
source *through its adjustment pipeline* (`LayerCompositor.renderLayer`) and
clips that already-adjusted result by the mask. The copy is a dead, flat raster.

Make Copy **non-destructive**: the copy carries the **raw** masked pixels plus
its **own clone** of the source's adjustment widgets, so it looks the same but
its grade is **independently editable**. Editing/undoing the copy's adjustments
never touches the source, and editing the source never touches the copy.

> Note: an earlier draft of this spec proposed a *live-linked* copy (the copy
> renders through the source's adjustments via an `adjustmentSourceLayerId`
> redirect). That was rejected in favour of an **independent clone** — the copy
> owns its adjustments and is edited separately from its source node.

## Design

Two parts: raw pixels (frontend) + adjustment clone (reusing the backend tool
that already exists).

### 1. Raw pixels

`extractLayerFromMask` (`src/store/segment-actions.ts`) gains a `rawPixels`
option. When set, it clips the source's **raw** canvas
(`pixelStore.getSource(sourceLayerId)`) by the mask instead of the rendered
composite (`LayerCompositor.renderLayer`). Raw pixels matter because the cloned
adjustments apply on top — baking the adjusted composite *and* cloning the
adjustments would double-grade the cutout.

`cropToMaskBbox` behaviour is unchanged (copy-to-image-node crops to the mask
bbox; copy-to-layer keeps full source dims).

### 2. Adjustment clone

After the copy layer exists, `copyObjectToLayer` / `copyObjectToImageNode`
(`src/lib/segmentation/object-actions.ts`) call a small fire-and-forget helper:

```ts
function cloneAdjustmentsToLayer(fromLayerId, toLayerId): void {
  const sessionId = toolSessionId();
  if (!sessionId) return;               // offline → copy stays raw pixels only
  void backendTools.duplicate_layer_edits(sessionId, {
    mapping: [{ fromLayerId, toLayerId }],
  });
}
```

`duplicate_layer_edits` (the backend clone tool built for deep-duplicate) clones
the source layer's operation-graph nodes + active widgets onto the target layer
as **fresh, independent** widgets (new ids, retargeted to the copy). One backend
revision; the cloned widgets stream back over SSE and reconcile onto the copy.
No renderer change — the copy renders through its **own** layer id and its
**own** cloned adjustments.

Data flow: the cutout + raw pixels land immediately (frontend); the cloned grade
arrives a moment later when the backend revision streams in.

## Edge cases & scope

- **Offline / no session:** the clone no-ops; the copy is raw pixels only (the
  same dependency deep-duplicate has). Acceptable — the structural copy still
  lands.
- **Source has no adjustments:** clone is a no-op; copy = raw cutout = same look
  as the source region.
- **Cloned widget scope:** a cloned widget's `scope.image_node_id` still names
  the *source* image node (pixels are driven by `layer_id`, so this is
  cosmetic). Same known caveat as deep-duplicate; a follow-up if scope-based UI
  ever depends on it.
- **Mask-scoped adjustments:** a widget scoped to a *region inside* the source
  won't remap onto the cutout's coordinates. v1 clones whole-layer grades;
  region-scoped remap is out of scope.

## Testing

- `copyObjectToLayer` / `copyObjectToImageNode`: call `extractLayerFromMask`
  with `rawPixels: true`, and call `duplicate_layer_edits` with the
  `{ fromLayerId: source, toLayerId: copy }` mapping (verified with a spy +
  seeded session id).
- Backend `duplicate_layer_edits` clone correctness (canonical deep-copy, widget
  clone with remapped ids, source untouched) is covered by its own state tests.

## Out of scope

Backend changes (reuses the existing `duplicate_layer_edits`), a live-linked
variant, an "unlink/relink" toggle, region-scoped remap, and any Copy-flattened
(bake) option (dropped — Copy is reversible by default now).
