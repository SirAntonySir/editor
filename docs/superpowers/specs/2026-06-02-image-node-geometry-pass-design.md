# Image-Node Geometry Pass (Crop / Rotate / Flip)

**Date:** 2026-06-02
**Branch context:** `feat/canvas-workspace`
**Supersedes:** the rendering portion of `2026-06-02-image-node-crop-rotate-design.md`. The backend portion of that spec (`SessionDocument.image_node_transforms`, `set_image_node_transform` tool, op-graph projection) stays correct and is already implemented; only the frontend rendering changes.

## Problem

Crop, rotate, and flip don't fit the current renderer's mental model. The existing `image-node-renderer.ts` composites layers into a single canvas and then runs WebGL "node-scope" adjustments via the same per-layer pipeline. That pipeline expects shader-driven color adjustments — it has no shader for geometry. Past attempts to bolt geometry on:

1. **CSS on the canvas element.** Worked but detaches the bitmap from the rendered visual. Doesn't survive export. Subpixel issues at low zoom. Hard to compose with future features.
2. **2D-canvas transform pass on the same canvas as the composite.** Broken: layer compositing painted into a backing store whose dims were already swapped for rotation, squashing the source aspect ratio before the transform pass even ran. The transform pass then captured those squashed pixels and stretched them.

The root cause for #2 is a missing boundary: the composite and the transform pass need *different* canvases — one at source dims, one at post-transform dims.

## Decisions (from brainstorm)

- **Two-canvas split.** Composite layers + WebGL color adjustments into an INTERNAL canvas at SOURCE dims. Final geometry pass draws from INTERNAL → VISIBLE canvas (sized at post-transform dims) using `ctx.setTransform` + `ctx.drawImage` in source-rect form.
- **Crop in source coordinates.** The crop rect is "what pixels of the original to keep". Rotation happens after the crop selection — same semantic as Photopea / Photoshop. Backend params unchanged: `crop = {x, y, w, h}` in source pixels.
- **Effective output dims drive everything visible.** When the snapshot carries a rotate near 90° / 270°, the visible canvas, the image-node wrapper, and the footer pixel-count all size to the swapped dims. `imageNodes[id].size` in the workspace slice stays at source dims (immutable record of the source bitmap).
- **Geometry pass is pure.** A new module `image-node-geometry.ts` exports `applyGeometry(internal, visible, transforms)` and `computeEffectiveSize(source, rotateAngle, crop)`. Pure functions, easy to unit-test with mocked canvases.
- **Overlays paint after geometry.** Masks, segmentation outlines, full-image outline — all paint onto the visible canvas at post-transform dims. Sufficient for now; mask coordinate rotation is its own future spec.

## Architecture

### Pipeline shape

Three sequential stages inside `renderImageNodeComposite`:

```
                                    rotate node
                                    crop node      ┌──────────────┐
                                          ↓        ↓              │
        source              source              effective         │
        dims                dims                 dims              │
        ↓                   ↓                    ↓                 │
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐   ┌──┴────────┐
│ Per-layer    │ →  │ Node-scope WebGL │ →  │ Geometry     │ → │ Overlay   │
│ WebGL pass   │    │ pass             │    │ pass         │   │ paint     │
└──────────────┘    └──────────────────┘    └──────────────┘   └───────────┘
   into INTERNAL       into INTERNAL           INTERNAL →           on VISIBLE
   at source dims      at source dims          VISIBLE
```

- **Per-layer + node-scope** stages are unchanged. They write into the INTERNAL canvas. Today's filter that skips `'crop'` / `'rotate'` from `nodeScopeNodes` stays.
- **Geometry pass** is new. Reads crop + rotate from the snapshot, draws from INTERNAL to VISIBLE.
- **Overlay paint** runs at the end on the VISIBLE canvas (so the full-image outline, masks, and segmentation overlays appear correctly framed around the post-transform image).

### Geometry pass math

Inputs:
- `internal: HTMLCanvasElement` — sized at source dims.
- `visible: HTMLCanvasElement` — will be resized to effective dims by the caller before the pass runs.
- `transforms: { rotate?: {angle, flip_h, flip_v}; crop?: {x, y, w, h} }`.

Pseudocode (real code in `applyGeometry`):

```ts
const crop = transforms.crop ?? { x: 0, y: 0, w: internal.width, h: internal.height };
const angle = transforms.rotate?.angle ?? 0;
const flipH = transforms.rotate?.flip_h ?? false;
const flipV = transforms.rotate?.flip_v ?? false;

const ctx = visible.getContext('2d')!;
ctx.clearRect(0, 0, visible.width, visible.height);
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.translate(visible.width / 2, visible.height / 2);
ctx.rotate(angle * Math.PI / 180);
ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
ctx.translate(-crop.w / 2, -crop.h / 2);
ctx.drawImage(internal, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
```

Why this works:
- After `setTransform`/`translate`/`rotate`, the canvas origin is at the centre of the output canvas with the drawing space rotated.
- `translate(-crop.w / 2, -crop.h / 2)` then puts the origin at the top-left of where a `crop.w × crop.h` source rectangle should sit, in rotated space.
- `drawImage(internal, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)` samples the crop rectangle from internal and draws it as a `crop.w × crop.h` rectangle in the rotated drawing space.
- After unwinding the rotation, that rectangle's bounding box on the output canvas matches the effective dims (`crop.w × crop.h` for 0/180, `crop.h × crop.w` for 90/270).
- No subsequent scaling, no aspect-ratio squashing.

### Effective dims

```ts
function computeEffectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
  crop: { x: number; y: number; w: number; h: number } | null,
): { w: number; h: number } {
  const baseW = crop ? crop.w : source.w;
  const baseH = crop ? crop.h : source.h;
  if (rotateAngle == null) return { w: baseW, h: baseH };
  const a = ((rotateAngle % 360) + 360) % 360;
  if (Math.abs(a - 90) < 1 || Math.abs(a - 270) < 1) return { w: baseH, h: baseW };
  return { w: baseW, h: baseH };
}
```

180° doesn't swap. Flip alone doesn't swap. Crop reduces dims (then rotation may swap). Angle close to 0 or near a multiple of 180 doesn't swap (tolerance 1°).

### Internal canvas lifecycle

The renderer owns one internal canvas per `imageNodeId`, lazily created and cached. Resized when source dims change. Held in a module-level `Map<imageNodeId, HTMLCanvasElement>` keyed by id, exported as `clearInternalCanvasCache(imageNodeId?)` so `editorDocument.closeDocument()` can call it. For MVP we accept slow growth between explicit clears; the working set is small (one entry per image node, of which there is typically one).

## Components

### `src/lib/image-node-geometry.ts` (new)

Pure, no React, no store, no DOM globals other than what's needed for canvas operations.

```ts
export interface Crop { x: number; y: number; w: number; h: number }
export interface Rotate { angle: number; flip_h: boolean; flip_v: boolean }
export interface Transforms { rotate?: Rotate; crop?: Crop }

export function computeEffectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
  crop: Crop | null,
): { w: number; h: number };

export function applyGeometry(
  internal: HTMLCanvasElement,
  visible: HTMLCanvasElement,
  transforms: Transforms,
): void;
```

### `src/lib/image-node-renderer.ts` (modified)

- The existing per-layer + node-scope code becomes the body of an internal helper `compositeLayersToInternal(internal, args)`.
- The orchestrator `renderImageNodeComposite`:
  1. Gets or creates the internal canvas for this image node, sized at source dims.
  2. Calls `compositeLayersToInternal(internal, args)`.
  3. Reads rotate/crop nodes from the snapshot (the same selector pattern as today, by id `transform:{imageNodeId}:rotate` / `:crop`).
  4. Resizes the visible canvas to `computeEffectiveSize(...)`.
  5. Calls `applyGeometry(internal, visible, transforms)`.
  6. Calls `paintOverlays({ ctx, canvas: visible, imageNodeId, layerIds })`.

The current 2D-canvas transform pass (the one painted by the recent revert) goes away.

### `src/hooks/useImageNodeRender.ts` (modified)

- Accepts `sourceWidth`, `sourceHeight` instead of the current `width`, `height`. Caller passes source dims always.
- Reads rotate + crop from the snapshot (same selectors used by the renderer; the hook centralises the snapshot read so the effective dim calc happens in one place).
- Computes effective dims via `computeEffectiveSize`.
- Sizes the visible canvas to effective dims (CSS `width`/`height` AND backing-store `canvas.width`/`canvas.height` with the render-scale quantisation that exists today).
- Calls `renderImageNodeComposite(...)` passing source dims and the transforms.

### `src/components/workspace/ImageNodeBody.tsx` (simplified)

```tsx
export function ImageNodeBody({ imageNodeId, layerIds, sourceWidth, sourceHeight }: Props) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, sourceWidth, sourceHeight });
  return <canvas ref={canvasRef} aria-label="Image node body" className="bg-surface-secondary border-y border-separator" style={{ display: 'block' }} />;
}
```

No `width`/`height` style — the hook sets backing-store dims and the canvas's intrinsic size renders at that size by default. No CSS transform. No clip-path.

### `src/components/workspace/ImageNode.tsx` (slim adjustments)

- Reuses `computeEffectiveSize` (imported from `image-node-geometry.ts`) for the outer overlay wrapper, the footer pixel-count, and the React Flow `useUpdateNodeInternals` trigger.
- Passes `sourceWidth={data.size.w}` and `sourceHeight={data.size.h}` to `ImageNodeBody`.
- `data.size` continues to come from the workspace slice unchanged.

## Data flow

```
SSE → backend snapshot.operation_graph.nodes
        contains transform:{id}:rotate, transform:{id}:crop

snapshot       ─→ ImageNode reads rotate/crop, computes effective size,
                  passes sourceWidth/sourceHeight (immutable source dims) to ImageNodeBody.

ImageNodeBody  ─→ useImageNodeRender reads same rotate/crop (cropPreview merged
                  when modal is active), computes effective dims,
                  sizes the visible canvas, calls renderImageNodeComposite.

renderImageNodeComposite ─→ compositeLayersToInternal (existing logic, internal canvas)
                          ─→ applyGeometry(internal → visible)
                          ─→ paintOverlays(visible)
```

## Testing

### Unit tests for `applyGeometry` (new `src/lib/image-node-geometry.test.ts`)

Mock canvas + context with `vi.spyOn`. Verify the sequence of context calls and the resulting `drawImage` arguments.

- `rotate-only-90` — internal 800×600, no crop, rotate 90°. Visible 600×800. Single `drawImage(internal, 0, 0, 800, 600, 0, 0, 800, 600)`.
- `rotate-only-180` — internal 800×600, no crop, rotate 180°. Visible 800×600 (no swap).
- `rotate-only-270` — internal 800×600. Visible 600×800.
- `flip-h-only` — no rotation, no crop. Visible 800×600; `scale(-1, 1)` once.
- `flip-v-only` — `scale(1, -1)`.
- `flip-both` — both scales.
- `crop-only` — `{x:100, y:50, w:600, h:400}`. Visible 600×400; `drawImage(internal, 100, 50, 600, 400, 0, 0, 600, 400)`.
- `crop-plus-rotate-90` — crop `{0,0,600,400}` + rotate 90°. Visible 400×600.
- `crop-plus-flip-h` — visible at crop dims, `scale(-1, 1)`.
- `rotate-plus-flip-h` — confirms transform order: rotate before scale.
- `identity` — visible 800×600; one `drawImage(internal, 0, 0)`.

### Unit tests for `computeEffectiveSize`

- `(source, null, null)` → source.
- `(source, 90, null)` → swapped source.
- `(source, 0, crop)` → crop dims.
- `(source, 90, crop)` → swapped crop dims.
- `(source, 180, null)` → source (180° doesn't swap).
- `(source, 359.5, null)` → source (close-to-0 doesn't swap).
- `(source, -90, null)` → swapped source (negative angle normalises to 270).

### `image-node-renderer.test.tsx`

- New: `'no longer calls ctx.rotate / ctx.scale directly on the visible canvas when a rotate node is present'` (the renderer delegates to `applyGeometry`, which is mocked).
- Existing tests for compositing keep passing unchanged.

### `ImageNode.test.tsx` / `ImageNodeBody.test.tsx`

- Revert ImageNodeBody tests to pre-CSS-attempt baseline. Body just renders a `<canvas>`; tests assert backing-store width/height matches effective dims (read from the snapshot — needs the mock seeded with a rotate/crop node).
- No `style.transform` or `clip-path` assertions.
- Add one ImageNode test: when the snapshot carries a 90° rotate node, the outer wrapper's `style.width` matches `data.size.h + 2` (swapped) and the footer text shows the swapped pixel count.

## Out of scope

- Backend rendering. Architecture stays frontend-WebGL + 2D-canvas geometry.
- Vertex-shader geometry pass (Approach A). Long-term direction; deferred.
- Per-layer transforms. Canvas-level only.
- Mask transforms. Masks paint in pre-transform coords today; we let `paintOverlays` carry through to post-transform without rotating the mask geometry. Refining mask coordinate rotation is its own design.
- Export pipeline. Once the visible canvas carries the final post-transform bitmap, export can call `canvas.toBlob()` on it as a follow-up.
- Crop modal UX refinements. The existing modal (corner handles, aspect chips, straighten slider, Apply/Cancel, Enter/Esc) stays exactly as is.

## Migration

The current state on `feat/canvas-workspace` (after the revert of `0ebb42a`) has a `renderImageNodeComposite` containing the broken transform pass that paints onto the same canvas as the composite. This spec replaces that transform pass with the two-canvas split. No data migration needed — the backend's `image_node_transforms` storage and `set_image_node_transform` tool are correct as-is.
