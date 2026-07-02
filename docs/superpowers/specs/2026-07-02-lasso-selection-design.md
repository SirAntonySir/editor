# Lasso Selection in Object Mode

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Frontend (tool-slice, TopMarginalia, SegmentHitLayer, new lasso
rasterizer lib) + one additive backend change (propose_mask origin →
MaskRecord source).

## Problem

Object mode selects objects by SAM point-click only. Users need a manual
fallback that trades precision-by-model for precision-by-hand: draw a
freehand region, get a mask — **no SAM call anywhere in the path**.

## Design

### Mode state

`objectSelectTool: 'point' | 'lasso'` in the tool slice, default `'point'`.
Meaningful only while a node's object mode is active; shared across image
nodes.

### Toggle UI

Two-icon segmented control in `TopMarginalia`, rendered only when that node's
object mode is on, next to the ScanSearch toggle: `MousePointerClick` (point)
/ `Lasso` (Lucide named imports).

### Gesture (SegmentHitLayer)

- Lasso mode + primary-button pointer down on the image → `setPointerCapture`
  (React Flow never sees the drag), accumulate normalized [0,1] points with a
  ~2-screen-px min-distance filter.
- While drawing: dashed polyline + faint fill preview on the overlay layer.
  Esc cancels mid-draw.
- Pointer up → auto-close the polygon. `< 3` points or negligible area
  (< ~0.01 % of the image) → discard silently.

### Rasterization (new pure lib: `src/lib/segmentation/lasso.ts`)

Normalized path → `Path2D` fill (nonzero) on an `OffscreenCanvas` at the
image's natural resolution → alpha channel → the same `DecodedMask` shape SAM
produces. From there the existing pipeline is reused verbatim:
`maskToPngBase64()` → live candidate → same preview, same right-click verbs
(extract to layer / image node / layer mask), same esc-discard. Shift-click
refinement stays SAM-only.

### Backend (additive)

- `propose_mask` input `origin` gains `'client_lasso'`; mapped to a new
  `MaskRecord.source` value `"lasso"` (Literal extension; regenerated shared
  types ride along).
- The captured normalized path ships in the tool's existing (previously
  unused) `paths` field — persisted intent for future vector-outline /
  editable-lasso work. Display continues to derive outlines from the raster.

### Out of scope

Brush add/subtract strokes, post-commit path editing, smoothing beyond the
distance filter, SAM fallback/hybrid, storing paths on MaskRecord.

## Testing

- Backend: `propose_mask` with `origin='client_lasso'` registers a MaskRecord
  with `source="lasso"`.
- Frontend (vitest, pure): rasterizer — triangle path fills expected pixels,
  respects winding/closure, empty/degenerate path → null; min-distance point
  filter.
- Manual: draw lasso in object mode → violet candidate appears → extract to
  layer works; point mode unaffected; esc cancels; node does not drag while
  drawing.
