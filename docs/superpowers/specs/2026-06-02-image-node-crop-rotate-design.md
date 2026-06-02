# Image-Node Crop &amp; Rotate

**Date:** 2026-06-02
**Branch context:** `feat/canvas-workspace`

## Problem

The editor has no way to crop or rotate an image. `STRUCTURAL_NODE_TYPES` already lists `'crop'` as a structural op-graph node, signalling the intent for non-destructive crop, but nothing implements it yet. Rotate has no representation at all.

The UX needs to match how every photo and design editor handles this: instant 90° / flip from a menu, modal mode for free crop and straighten with handles on the image.

## Decisions (from brainstorm)

- **Non-destructive** — both `crop` and `rotate` live as nodes in the op-graph, not as bitmap rewrites.
- **Canvas-level scope** — crop and free-rotate apply to the whole `ImageNode` (all layers). Per-layer transform is out of scope for MVP.
- **Two UX surfaces, one entry point.**
  - **Header dropdown** on the selected image node (the existing Split menu, extended):
    - `Crop…` — enters modal.
    - `Rotate 90° CW`, `Rotate 90° CCW` — instant commits, no modal.
    - `Flip Horizontal`, `Flip Vertical` — instant commits, no modal.
  - **Modal tool overlay** when `Crop…` is chosen. A floating bar above the node holds aspect chips (Free / 1:1 / 3:2 / 16:9 / Original), a straighten slider (−45°…+45°), Rotate-90° CW / CCW + flip buttons, **Apply** (⏎), **Cancel** (⎋). Corner crop handles render on the node. Dragging a handle resizes the crop; dragging outside the bounding box rotates (Figma-style straighten).
- **Client-side preview** — while the modal is open, all transforms are previewed by the existing canvas-rendering layer (no backend round-trip per frame). On Apply, a single backend mutation upserts the op-graph nodes. Cancel discards local state.

## Architecture

### 1. Op-graph node types

Add two structural node types on the frontend, and the matching `Node.type` values on the backend (no schema change — `type: str` already accepts any string; only `STRUCTURAL_NODE_TYPES` needs extending).

```ts
// src/types/graph.ts
export const STRUCTURAL_NODE_TYPES = ['source', 'blend', 'crop', 'rotate', 'output'] as const;
```

`crop` node params:
- `x: int`, `y: int` — top-left of crop rect in source pixels.
- `w: int`, `h: int` — crop size in source pixels.

`rotate` node params:
- `angle: float` — degrees, signed. Includes both 90° snaps (90 / 180 / 270) and straighten values.
- `flip_h: bool`, `flip_v: bool` — independent of `angle` so 90° + flip combinations don't ambiguate.

Both are **image-node-scoped**: the backend `Node` already supports this via `layer_ids: list[str] | None`. Crop and rotate nodes populate `layer_ids` with every layer in the image node and leave `scope.kind = "global"`. `layer_id` is set to the image node's primary layer (required by the schema) but the renderer treats `layer_ids` as the authoritative list.

Pipeline placement: `rotate` runs before `crop` (rotate the canvas, then crop the rotated result). Both run before any per-layer adjustment node — they reshape the source bitmap that the layer pipeline reads from. Post-transform reported dimensions in `image_context` come from the crop rect (when present) or the rotated source bounds, so downstream consumers (export, exif, viewport fit) see the effective image size.

### 2. Backend tool: `set_image_node_transform`

Single MCP tool that upserts (or removes) the crop and rotate nodes for an image node. Idempotent.

```python
async def set_image_node_transform(
    session_id: str,
    image_node_id: str,
    crop: CropRect | None,        # None = clear crop
    rotate: RotateState | None,   # None = clear rotate (angle 0, no flips)
) -> SessionStateSnapshot: ...
```

`CropRect` = `{x, y, w, h}` in source-bitmap pixels. `RotateState` = `{angle: float, flip_h: bool, flip_v: bool}`.

The tool:
1. Removes any existing `crop` / `rotate` nodes for this image node.
2. Inserts new nodes with `layer_ids` populated for every layer in the node.
3. Bumps snapshot revision; SSE pushes to all clients.

Instant menu items (90°/flip) call the same tool, passing only the rotate delta.

### 3. Modal tool overlay (frontend)

A new component `src/components/workspace/CropOverlay.tsx`. Mounted by `CanvasWorkspace` when a new local UI state `cropModalImageNodeId` is set. Renders absolutely over the target image node:

- 8 crop handles (4 corners + 4 edges) — drag to resize the crop rect.
- A straighten gesture region just outside the bounding box.
- Darkened mask outside the staged crop rect.
- A floating toolbar above the node with the controls listed above.

State is local React state inside `CropOverlay` — staged `{crop, rotate}` not yet committed. Canvas preview is achieved by writing the staged values to a new local-only field on the `ImageNodeBody` render path (e.g. `useImageNodeRender` accepts an optional `previewTransform` and applies it after reading the snapshot).

On **Apply** → call `backendTools.set_image_node_transform(...)` with staged values, clear `cropModalImageNodeId`.
On **Cancel** / **Esc** → clear `cropModalImageNodeId`, discard.

The image-node header dropdown gains the new items. Selecting `Crop…` sets `cropModalImageNodeId = id`. The instant items call the backend tool directly without entering the modal.

### 4. Tool-slice UI state

Extend `tool-slice.ts` with:
- `cropModalImageNodeId: string | null`
- `setCropModal(id: string | null): void`

While the modal is open, other workspace interactions on this node should pause (block tether creation, block selection-change). Keep this minimal — easy to scope by checking `cropModalImageNodeId !== null` in the relevant handlers.

### 5. Toolrail unchanged

No 7th toolrail button. Crop/rotate is reached from the image-node header. Toolrail remains the 6 adjustment tools, consistent with the project's "toolrail = adjustment slider tools" framing.

## Files Touched

**Frontend:**
- `src/types/graph.ts` — extend `STRUCTURAL_NODE_TYPES`.
- `src/components/workspace/ImageNode.tsx` — add menu items, route `Crop…` to set modal state, route instant items to a thin frontend helper.
- `src/components/workspace/CropOverlay.tsx` — new modal overlay component.
- `src/components/workspace/CanvasWorkspace.tsx` — mount `CropOverlay` when modal state is set.
- `src/hooks/useImageNodeRender.ts` — accept optional `previewTransform`, apply after snapshot reads.
- `src/store/tool-slice.ts` — `cropModalImageNodeId` + setter.
- `src/lib/backend-tools.ts` — `set_image_node_transform` client wrapper.

**Backend:**
- `backend/app/tools/atomic/set_image_node_transform.py` — new tool implementation.
- Wire the tool into the MCP server registration (existing pattern).

No schema changes (the `Node` model already permits arbitrary `type` strings and image-node-scoped nodes via `layer_ids`).

## Testing

**Frontend:**
- `ImageNode.test.tsx` — assert new dropdown items appear; clicking `Crop…` sets `cropModalImageNodeId`; clicking `Rotate 90° CW` calls `backendTools.set_image_node_transform` with `{angle: +90}` delta and does not enter the modal.
- `CropOverlay.test.tsx` — staged state persists across drags; Apply calls the backend tool with the staged values; Cancel/Esc clears without calling the backend.
- `useImageNodeRender.test.ts` — when `previewTransform` is provided, render output is the staged transform; without it, snapshot values are authoritative.

**Backend:**
- `test_set_image_node_transform.py` — calling with `crop=None, rotate=None` removes existing nodes; calling with values upserts; `layer_ids` is populated correctly; revision bumps once per call.

**Manual smoke:**
- Crop, Apply, undo. Crop should revert.
- Rotate 90° CW four times → returns to original orientation.
- Open crop modal, hit Esc, no snapshot mutation.

## Out of Scope

- Per-layer transform (each layer rotates independently).
- Crop with non-rectangular shapes.
- Animated transitions when committing.
- Live preview of layer adjustments while in crop mode (they keep rendering, but we don't re-compose on every drag — the staged transform applies to the already-composited bitmap).
- Toolrail integration (explicitly rejected during brainstorm).
