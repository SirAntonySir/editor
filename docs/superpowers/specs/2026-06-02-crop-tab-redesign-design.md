# Crop Tab Redesign

**Date:** 2026-06-02
**Branch context:** `feat/canvas-workspace`
**Supersedes:** the modal-overlay portion of `2026-06-02-image-node-crop-rotate-design.md`. The backend portion (the `set_image_node_transform` tool, the `image_node_transforms` storage, the op-graph projection) and the geometry-pass spec (`2026-06-02-image-node-geometry-pass-design.md`) stay correct and remain implemented.

## Problem

The existing crop modal mounts inside `<ReactFlow>` but its position style uses raw flow coordinates without inheriting React Flow's viewport transform. The toolbar drifts to the screen origin while the corner handles end up wherever a flat `position: absolute` translation lands them. In practice the modal renders as detached UI floating above the workspace — handles in one corner, toolbar near the menu bar, dark mask covering the entire workspace. A user-reported screenshot shows the toolbar pinned to the top edge of the editor, a stray corner handle at the screen's top-left, and the image-node squeezed in the middle untouched.

The deeper issue is that the modal tried to be a positioned overlay over a single node inside a transformed viewport. Working around it is possible (mount the overlay inside React Flow's transformed inner container, convert all coords to flow-px) but every coordinate transform — workspace pan/zoom, image-node rotation, image-node crop — compounds.

Additionally, the `cropPreview` field on `tool-slice` is written by `CropOverlay` on every drag but no consumer reads it. Live preview was never wired, so even if the overlay positioned correctly, dragging the handles would not reflect on the workspace image-node until Apply committed to the backend.

## Decisions (from brainstorm)

- **Crop moves into the right panel** as a third tab next to `Adjustments` and `Info`. No overlay mounts inside the workspace.
- **Always show the original source** when Crop is active. Opening Crop on an image with a committed crop reveals the full bitmap with the existing crop shown as the staged rect.
- **Live preview is wired.** The workspace image-node re-renders the staged crop in real time as the user drags handles in the panel.
- **Panel preview is the only interactive surface.** The workspace image-node displays the result; no handles render over the workspace canvas.
- **Rotation is preserved across Crop edits but the preview is un-rotated.** The preview shows the raw source bitmap. Crop rect coords are in source pixels. Rotation re-applies after Apply.

## Architecture

### Panel layout

The right panel's tab strip becomes a three-tab `ToggleGroup`: `Adjustments`, `Info`, `Crop`. The `Crop` tab is disabled when `activeImageNodeId` is null and shows a tooltip explaining why.

When the Crop tab is active, the panel body renders the `CropTab` component, which lays out top-to-bottom:

1. **Preview canvas + handle overlay** — sized to the panel's inner width, with proportional height so the source bitmap is letterboxed inside.
2. **Aspect chips** — `Free / 1:1 / 3:2 / 16:9 / Original`. The first four set the lock to `null`, `1`, `1.5`, and `16/9`. `Original` sets the lock to `sw / sh` (the source's intrinsic aspect).
3. **Straighten slider** — −45° to +45° in 0.1° steps, with a numeric readout to the right.
4. **Dimension readout** — single line: `<source.w> × <source.h> → <crop.w> × <crop.h> (<aspect-label>)`.
5. **Apply** (primary) and **Cancel** (secondary).

### Activation flow

The image-node header dropdown's `Crop…` item calls `usePreferencesStore.getState().showCrop()`:

```ts
showCrop: () => set({ rightSidebarCollapsed: false, inspectorTab: 'crop' }),
```

This opens the sidebar if collapsed and switches the panel to the Crop tab. Selecting the Crop tab directly in the panel does the same thing minus the `Crop…` round-trip.

### State

- `preferences-store.ts` extends `InspectorTab` literal union to `'adjustments' | 'info' | 'crop'`. Adds `showCrop()` action.
- `tool-slice.ts`: `cropPreview` already exists and stays. The unused `cropModalImageNodeId` and `setCropModal` are removed.
- `CropTab` owns local React state for the staged `CropRect`, the locked `aspectRatio | null`, and the straighten `angle`. The initial `angle` reads the snapshot's existing rotate node `angle` (defaulting to 0) so the slider position reflects the persisted state. The initial `aspectRatio` is `null` (Free).

### Live preview wiring

The previously-missing piece. `useImageNodeRender` is extended so that when:
- `activeImageNodeId === this hook's imageNodeId`, AND
- `inspectorTab === 'crop'`, AND
- `cropPreview !== null`,

the renderer merges `cropPreview.crop` and `cropPreview.rotate` over the snapshot's transforms. Without all three conditions the hook reads transforms from the snapshot as today.

The renderer downstream (`image-node-renderer.ts`, `applyGeometry`) is unchanged — it consumes the merged transforms.

### Drag math (in the preview)

The preview canvas has CSS dims `pw × ph` and represents source bitmap dims `sw × sh`. Convert screen-px deltas to source-px via `scaleX = sw / pw`, `scaleY = sh / ph`. Both scalars are equal under letterboxing if the panel preserves the source aspect.

- **Corner handle** `(tl|tr|bl|br)`: drags the matching corner of the rect; the opposite corner stays fixed.
- **Edge handle** `(t|b|l|r)`: drags the matching edge; the opposite edge plus the two perpendicular edges stay fixed.
- **Aspect lock**: when `aspectRatio !== null`, dx and dy on corner drags are reconciled so `w / h = aspectRatio`. The larger of `|dx / scaleX|` and `|dy * aspectRatio / scaleX|` wins; the smaller value is recomputed from it.
- **Clamps**: `x ≥ 0`, `y ≥ 0`, `x + w ≤ sw`, `y + h ≤ sh`, `w ≥ 1`, `h ≥ 1`.

### Apply / Cancel

- **Apply** calls `backendTools.set_image_node_transform({ image_node_id, layer_ids, crop, rotate })` where `rotate = angle === 0 ? null : { angle, flip_h: false, flip_v: false }`, then `setCropPreview(null)` and `setInspectorTab('adjustments')`.
- **Cancel** calls `setCropPreview(null)` and `setInspectorTab('adjustments')`. No backend mutation.
- **Enter** / **Esc** shortcuts: handled inside `CropTab` via a `useEffect` keydown listener that activates only while the Crop tab is the active inspector tab. Enter = Apply, Esc = Cancel.

### Source bitmap access

The preview needs the source pixels. `CanvasRegistry.get(layerId)` already returns the source `OffscreenCanvas` for a layer; the canvas-registry pattern is unchanged. `CropTab` calls it for the first layer of the active image-node and draws that into the preview canvas at letterboxed dims.

## Components & files

### New

- **`src/components/inspector/crop/CropTab.tsx`** — the panel UI: reads the active image-node id + source dims, reads existing crop from the snapshot, owns the staged rect + aspect + angle, lays out the preview + chips + slider + readout + Apply/Cancel.
- **`src/components/inspector/crop/CropTab.test.tsx`** — tests for chip behaviour, Apply/Cancel, keyboard shortcuts, initial state from snapshot.
- **`src/components/inspector/crop/CropPreview.tsx`** — pure component: the preview canvas + handle overlay + mask. Takes `sourceBitmap`, `crop`, `aspectRatio`, `onCropChange`. Owns the drag math.
- **`src/components/inspector/crop/CropPreview.test.tsx`** — tests for corner drag, edge drag, aspect-lock constraint, boundary clamps.

### Modified

- **`src/store/preferences-store.ts`** — extend `InspectorTab`; add `showCrop()`.
- **`src/store/tool-slice.ts`** — remove `cropModalImageNodeId` and `setCropModal`. `cropPreview` and `setCropPreview` stay.
- **`src/components/inspector/InspectorPanel.tsx`** — add the third `ToggleGroup` item; render `<CropTab />` when `tab === 'crop'`; disable the tab when no active image-node.
- **`src/components/workspace/ImageNode.tsx`** — the `Crop…` menu item calls `usePreferencesStore.getState().showCrop()` instead of `setCropModal(id)`. The same item is in the right-click context menu — both paths route through `showCrop()`.
- **`src/hooks/useImageNodeRender.ts`** — merge `cropPreview` over the snapshot transforms when the three conditions above are met. The selector reads `cropPreview`, `activeImageNodeId`, `inspectorTab` from their respective stores.
- **`src/components/workspace/CanvasWorkspace.tsx`** — delete the `{cropModalId && ...}` mount block and the `cropModalId` subscription.

### Deleted

- **`src/components/workspace/CropOverlay.tsx`** + **`src/components/workspace/CropOverlay.test.tsx`**.

## Data flow

```
User clicks Crop… in image-node menu
   ↓
showCrop() — preferences-store opens sidebar + selects 'crop' tab
   ↓
CropTab renders: reads activeImageNodeId, fetches source bitmap via
CanvasRegistry, reads existing crop from snapshot for the initial rect.
   ↓
User drags handle on preview canvas → CropPreview.onCropChange
   ↓
CropTab updates local crop state + writes setCropPreview({ crop, rotate })
   ↓
useImageNodeRender sees (activeImageNodeId, inspectorTab='crop', cropPreview)
and merges the preview crop + rotate over the snapshot transforms.
   ↓
renderImageNodeComposite + applyGeometry render the workspace image-node at
the staged effective dims.
   ↓
User clicks Apply
   ↓
backendTools.set_image_node_transform({ ... }) — backend persists
   ↓
setCropPreview(null) + setInspectorTab('adjustments') — return to default state
```

## Testing

### `CropPreview.test.tsx`

- `corner-drag-br` — pointer-down on `data-handle="br"`, move +50 / +50, pointer-up. `onCropChange` was called with the new rect having `w` and `h` increased by 50 source-px (after the screen-to-source scalar).
- `edge-drag-r` — pointer-down on `data-handle="r"`, move +50 in x only. New rect has `w` increased by 50 source-px; `y` and `h` unchanged.
- `aspect-lock-1:1` — with `aspectRatio = 1`, dragging `br` by (50, 10) produces a rect with `w === h` (the larger delta wins).
- `clamp-boundary` — dragging `br` past the source bitmap's right edge clamps `w` so `x + w === sw`.

### `CropTab.test.tsx`

- `initial-rect-from-snapshot` — when the snapshot has a `transform:in-1:crop` node, the initial staged rect equals that node's params.
- `initial-rect-full-when-no-snapshot-crop` — when no crop node, initial rect is `{x: 0, y: 0, w: source.w, h: source.h}`.
- `aspect-chip-locks-ratio` — clicking `3:2` sets `aspectRatio = 1.5` and updates `h` to match `w / 1.5` once.
- `straighten-slider` — moving the slider sets the angle; `setCropPreview` receives `rotate: { angle, flip_h: false, flip_v: false }`.
- `apply-calls-backend-tool` — Apply calls `backendTools.set_image_node_transform` with the staged crop + rotate; `setCropPreview(null)` is called; `inspectorTab` is reset to `'adjustments'`.
- `cancel-does-not-call-backend` — Cancel resets state but never calls the backend tool.
- `enter-applies` and `escape-cancels` — keyboard shortcuts work when the panel is focused.

### `InspectorPanel.test.tsx`

- `crop-tab-disabled-when-no-active-image-node` — when `activeImageNodeId === null`, the `Crop` ToggleItem has `disabled` and clicking it doesn't change `inspectorTab`.
- `crop-tab-enabled-with-active-image-node` — clicking the tab sets `inspectorTab` to `'crop'`.
- `crop-tab-renders-CropTab` — when `tab === 'crop'`, the `CropTab` component renders (assert by a `data-testid` it exposes).

### `useImageNodeRender.test.tsx`

- `merges-cropPreview-when-active-and-tab-crop` — with `activeImageNodeId === 'in-1'`, `inspectorTab === 'crop'`, `cropPreview === { crop: {...}, rotate: null }`, the renderer is called with the preview's crop overriding the snapshot's.
- `ignores-cropPreview-when-tab-not-crop` — with `cropPreview` set but `inspectorTab === 'adjustments'`, the renderer uses snapshot transforms.
- `ignores-cropPreview-when-different-image-node` — `cropPreview` is set but `activeImageNodeId !== imageNodeId`; snapshot transforms win.

### `ImageNode.test.tsx`

- `Crop… menu item` — clicking the menu item calls `usePreferencesStore.getState().showCrop()` (assert by spying or by reading `inspectorTab` after click). Replace the previous assertion that checked `cropModalImageNodeId`.

## Out of scope

- **Per-layer crop.** Crop is image-node-scoped.
- **Rotated preview.** The preview shows the un-rotated source even when the snapshot has a rotate node. Adding a "show rotated preview" mode is a future enhancement.
- **Crop modal / fullscreen mode.** Approaches A and B from the brainstorm are not pursued.
- **Smart cropping** (face / object detection to pre-position the rect). Future.
- **Aspect-ratio behaviour beyond "snap height when chip is clicked".** Chips lock the aspect during subsequent drags; clicking `Free` releases the lock.

## Migration

`CropOverlay.tsx` and its mount inside `<CanvasWorkspace>` are deleted. The `cropModalImageNodeId` field on `tool-slice` is removed; one consumer (`ImageNode.tsx`'s `Crop…` menu item) is updated to call `showCrop()` instead. No data migration. The backend's `set_image_node_transform` tool and the snapshot's `image_node_transforms` storage are unchanged — the panel just commits to them via a different UI surface.
