# Workspace Spawn Layout — Design

**Status:** Draft
**Date:** 2026-06-08
**Author:** Anton (with Claude)
**Branch:** to be created off `main`

---

## 1. Problem

When the planner spawns multiple widgets for a single intent (e.g. 4–5 widgets for "make it look like a black and white cinema movie scene"), the current canvas layout has four visible problems:

1. **Widgets spawn expanded** — every new widget opens its full body of sliders immediately. Stacks of 5 expanded cards overlap each other and dominate the canvas.
2. **Pill width varies** — collapsed pills size to their title ("Film grain" is narrow, "Monochrome conversion" is wide). The result is a jagged column edge.
3. **Always placed to the right of the image** — irrespective of where the user is looking. If the image is already pinned to the right of the viewport, new widgets land off-screen.
4. **Widget shells scale with React Flow zoom** — when the user zooms out for an overview, pills become massive and dwarf the image they belong to.

All four are independently visible and independently fixable. Anton showed a target visual (a clean vertical pill column with edges connecting to the image's left side) that resolves all four with reusable infrastructure already in the codebase.

## 2. Goals

1. **Collapsed by default.** Planner-spawned widgets appear as pills, not expanded cards. Click to expand.
2. **Uniform pill width.** Long titles ellipsis-truncate so the column has a straight edge.
3. **Viewport-relative placement.** Widgets spawn on whichever side of the image has more screen room.
4. **Overflow to the opposite side** when one side fills up.
5. **Zoom-invariant widget shells.** Widget pills stay the same screen size regardless of canvas zoom (the existing image-node zoom-invariance pattern, applied to widgets).

## 3. Non-goals

- Re-flowing existing widgets when the user pans/zooms.
- Per-image sticky side preference.
- Animated expand/collapse transitions beyond what already exists.
- Touch / mobile-specific layout.
- Auto-zoom-to-fit when a widget column overflows.
- Changing the tether handle picker (`tether-handles.ts` already does the right thing once placement direction is correct).

## 4. Architecture

Five orthogonal concerns, each in its own file, each independently revertable:

| # | Concern | Primary file | Behavior change |
|---|---|---|---|
| 1 | Spawn collapsed | `src/lib/workspace-tether.ts` | Remove the `expandWidget(widget.id)` call. Drop `WIDGET_SPAWN_SIZE.h` from 200 → 52. |
| 2 | Uniform pill width | `src/components/widget/WidgetShell.tsx` + `src/index.css` | New `WIDGET_COLLAPSED_WIDTH` constant (220px). Title ellipsis-truncates. |
| 3 | Viewport-relative side picker | `src/components/workspace/workspace-layout.ts` | New `pickSpawnSide(target, viewport)` helper. `nextSpawnPositionFor` accepts `side: 'left' \| 'right'`. |
| 4 | Overflow to opposite side | `src/components/workspace/workspace-layout.ts` | `nextSpawnPositionFor` collision loop walks downward, switches sides when the column reaches `image_bottom + COLUMN_OVERFLOW_PAD`. |
| 5 | Zoom-invariant shells | `src/components/widget/WidgetShell.tsx` (+ new `src/components/widget/useZoomInvariantScale.ts`) | Counter-scale via CSS transform driven by React Flow's zoom. Reuses the pattern from `docs/superpowers/specs/2026-06-02-image-node-styling-zoom-invariance-design.md`. |

The five changes are independent: shipping any one yields a discrete visible improvement. Concerns 3 and 4 are the only ones that share a file (`workspace-layout.ts`); the rest are isolated.

## 5. Component changes

### 5.1 Spawn collapsed

In `src/lib/workspace-tether.ts`:

- Delete the line:
  ```typescript
  useEditorStore.getState().expandWidget(widget.id);
  ```
- Drop the height estimate:
  ```typescript
  const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH, h: 52 } as const;  // was 200
  ```
- Update the comment block above to reflect that widgets now spawn collapsed.

The existing `toggleWidgetExpanded` and `expandWidget` actions in `tool-slice.ts` are unchanged — user clicks still work normally.

### 5.2 Uniform pill width

- Add a new constant near the existing `WIDGET_SHELL_MIN_WIDTH`:
  ```typescript
  export const WIDGET_COLLAPSED_WIDTH = 220;   // px in canvas coords (pre-zoom)
  ```
- Apply it via inline style or CSS class on the shell's outer container when `isExpanded === false`.
- Title cell uses `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (already a common pattern in the codebase — reuse the design token / utility class).
- Existing tooltip primitive shows the full title on hover when the rendered text is truncated.

`WIDGET_SHELL_MIN_WIDTH` remains the expanded-state minimum width.

### 5.3 Viewport-relative side picker

New helper in `src/components/workspace/workspace-layout.ts`:

```typescript
export interface Viewport {
  pan: { x: number; y: number };
  zoom: number;
  screen: { w: number; h: number };
}

export function pickSpawnSide(target: PlacedRect, viewport: Viewport): 'left' | 'right' {
  // Convert viewport center from screen → canvas coords.
  const viewportCenterCanvasX = (-viewport.pan.x + viewport.screen.w / 2) / viewport.zoom;
  const imageCenterCanvasX = target.position.x + target.size.w / 2;

  // Tie band: within 5% of viewport width.
  const tieBand = (viewport.screen.w * 0.05) / viewport.zoom;
  if (Math.abs(imageCenterCanvasX - viewportCenterCanvasX) <= tieBand) return 'left';

  // Image in right half of viewport → place widgets in the empty left half.
  return imageCenterCanvasX > viewportCenterCanvasX ? 'left' : 'right';
}
```

`nextSpawnPositionFor` gets a `side` parameter:

```typescript
export function nextSpawnPositionFor(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right' = 'right',   // default right preserves current behavior
): { x: number; y: number } {
  // ... see §5.4 for the body
}
```

The caller (`workspace-tether.ts::buildTetherForWidget`) reads React Flow's viewport via `useReactFlow().getViewport()` (or the equivalent store hook), constructs a `Viewport` object, calls `pickSpawnSide`, then passes the result to `nextSpawnPositionFor`.

Re-evaluation is per-spawn. Existing widgets stay where they are.

### 5.4 Overflow to opposite side

`nextSpawnPositionFor` placement loop:

```typescript
const COLUMN_OVERFLOW_PAD = 100;

function attemptColumn(
  target: PlacedRect, ownSize: Size, kind: 'widget' | 'image',
  occupied: PlacedRect[], side: 'left' | 'right',
): { x: number; y: number } | null {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = side === 'right'
    ? target.position.x + xOffset + SPAWN_GAP
    : target.position.x - ownSize.w - SPAWN_GAP;

  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  const yLimit = target.position.y + target.size.h + COLUMN_OVERFLOW_PAD;

  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: ownSize }, o))) {
    y += ownSize.h + SPAWN_GAP;
    if (y + ownSize.h > yLimit) return null;   // column full
  }
  return { x, y };
}

export function nextSpawnPositionFor(...): { x: number; y: number } {
  const tried = attemptColumn(target, ownSize, kind, occupied, side);
  if (tried) return tried;

  // Preferred side full — try the other side.
  const opposite = side === 'right' ? 'left' : 'right';
  const overflowed = attemptColumn(target, ownSize, kind, occupied, opposite);
  if (overflowed) return overflowed;

  // Both sides full — keep stacking downward on preferred side, matching old behavior.
  return fallbackStackDownward(target, ownSize, kind, occupied, side);
}
```

`fallbackStackDownward` is the old `while` loop without the `yLimit` guard — it keeps stacking even past the image bottom, accepting that some widgets land off-image.

`rectsOverlap` is unchanged.

`tether-handles.ts` already picks `tether-out-right` ↔ `tether-in-left` when the widget is left of the image (and vice versa). No edge-handle changes needed.

### 5.5 Zoom-invariant shells

New hook:

```typescript
// src/components/widget/useZoomInvariantScale.ts
import { useStore } from '@xyflow/react';

export function useZoomInvariantScale(): number {
  // React Flow stores transform as [x, y, zoom].
  const zoom = useStore((s) => s.transform[2]);
  return 1 / Math.max(zoom, 0.01);   // clamp to avoid div-by-zero
}
```

`WidgetShell.tsx` consumes the hook and applies it:

```tsx
const scale = useZoomInvariantScale();

return (
  <div
    className="widget-shell"
    style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
  >
    {/* tether <Handle> components MUST live inside this container so they
        move with the visible edge rather than the React Flow node's
        underlying (unscaled) position */}
    <Handle type="source" position="right" id="tether-out-right" />
    ...
  </div>
);
```

The hook returns 1 when React Flow's store isn't initialized (default value of `transform[2]` is 1). No additional fallback needed.

### 5.6 Caller integration

`src/lib/workspace-tether.ts::buildTetherForWidget` after the existing `targetNode` resolution:

```typescript
// At call site:
import { useReactFlow } from '@xyflow/react';
import { pickSpawnSide } from '@/components/workspace/workspace-layout';

// Inside buildTetherForWidget, replace the nextSpawnPositionFor call with:
const viewport = readViewportFromReactFlow();  // helper that pulls pan/zoom/screen size
const side = pickSpawnSide(
  { position: targetNode.position, size: targetNode.size },
  viewport,
);
const pos = nextSpawnPositionFor(
  { position: targetNode.position, size: targetNode.size },
  WIDGET_SPAWN_SIZE,
  'widget',
  occupied,
  side,
);
```

`readViewportFromReactFlow` reads from React Flow's imperative store (since `buildTetherForWidget` is called from outside a component). The exact API depends on whether React Flow exposes `getViewport()` from the imperative store — fall back to reading `useReactFlow.getState()` if needed.

If the viewport read fails (rare; the store isn't initialized at the moment of spawn), pass `side = 'left'` as a deterministic default.

## 6. Data flow

```
Backend SSE: widget.created
  ↓
Frontend onWidgetCreated handler
  → editor.addWidgetNode(widget)
  → tetherWorkspaceWidget(widget)
    ↓
buildTetherForWidget(widget):
  resolve targetImageNode
  read viewport (pan, zoom, screen size)
  side = pickSpawnSide(target, viewport)
  occupied = [imageNodes..., widgetNodes...]
  pos = nextSpawnPositionFor(target, WIDGET_SPAWN_SIZE, 'widget', occupied, side)
    ├─ try preferred side column → return pos or null
    ├─ if null, try opposite side column → return pos or null
    └─ if both null, stack downward on preferred side (unbounded)
  setWidgetPosition(widget.id, pos)
  setEdge({ widgetNodeId, targetImageNodeId, scope })
  // NO expandWidget call — widget stays collapsed
  ↓
WidgetNode renders:
  WidgetShell (collapsed, WIDGET_COLLAPSED_WIDTH wide)
    useZoomInvariantScale → scale = 1/zoom
    apply transform: scale(1/zoom) to outer div
    <Handle> components live inside the scaled div, move with visible edge
```

## 7. Failure handling

| Failure | Behavior |
|---|---|
| React Flow viewport state unavailable when picking side | Default to LEFT; log once per session. |
| `nextSpawnPositionFor` returns a position outside the visible viewport (extreme zoom / pan) | Accept it. User can pan to find it. Don't force-relocate. |
| `useZoomInvariantScale` reads `zoom = 0` (edge case during init) | Clamp to `Math.max(zoom, 0.01)`. |
| Widget shell renders before React Flow store exists | `useStore(s => s.transform[2])` returns default 1; hook returns 1 (no-op scale). |
| Existing widgets persisted with expanded state | Stay expanded. Only NEW spawns default to collapsed. |
| Long widget title overflows the pill width | CSS `text-overflow: ellipsis`. Hover tooltip shows full text via existing primitive. |
| Both columns fill (rare, ≥10 widgets) | Fallback `fallbackStackDownward` keeps stacking. Some widgets land below the image; acceptable. |

## 8. Testing

### 8.1 Unit
- `pickSpawnSide(target, viewport)` returns `'left'` when image is in right half, `'right'` when in left half, `'left'` in tie band.
- `nextSpawnPositionFor(side='left', ...)` produces x values to the left of image.
- `nextSpawnPositionFor(side='right', ...)` produces x values to the right of image (preserves old behavior).
- `nextSpawnPositionFor` with full preferred column triggers overflow to opposite side.
- `nextSpawnPositionFor` with both columns full returns a position via `fallbackStackDownward`.
- `useZoomInvariantScale()` returns `1/zoom`, clamps `zoom < 0.01` to `0.01`.

### 8.2 Integration
- Spawning 3 widgets via `tetherWorkspaceWidget` with a mocked viewport positions all three in a vertical column on the expected side.
- Spawning 8 widgets where the first column fills causes the 6th–8th to land on the opposite side.

### 8.3 Component
- `WidgetShell` in collapsed state renders at `WIDGET_COLLAPSED_WIDTH`; long title shows ellipsis.
- `WidgetShell` consumes `useZoomInvariantScale` and applies `transform: scale(...)`.

No vintage-prompt-style end-to-end test needed — placement is deterministic given the inputs.

## 9. Migration & rollout

No feature flag. No data migration. Pure UI behavior.

Each commit is independently revertable and produces a discrete visible change in the dev server:

| Commit | Visible effect |
|---|---|
| 1. Spawn collapsed | Widgets appear as pills instead of expanded cards |
| 2. Uniform pill width | Pills form a straight-edged column |
| 3. Side picker | Widgets land on the side with more viewport space |
| 4. Overflow | When one column fills, the next widget appears on the opposite side |
| 5. Zoom-invariant shells | Pill size stays constant as you zoom in/out |

If any one feels wrong, revert just that commit.

## 10. Definition of done

After commit 5:

- A spawn of 4–5 widgets via the planner produces a vertical column of collapsed pills on whichever side of the image has more viewport space.
- All pills share a fixed width; long titles show ellipsis and reveal full text on hover.
- Tether edges connect from the pill's right (or left) side to the image's left (or right) side — no edges into the header.
- Zooming the canvas in or out leaves the pill sizes visually unchanged on screen.
- Filling one column (≥10 widgets, or a smaller image) causes overflow to the opposite side.
- Toolrail-spawned single widgets retain their existing one-widget UX (no regression).
- Existing widget undo / redo, drag-to-reposition, and click-to-expand still work identically.
- Frontend test suite: ≥557 tests passing.
- `npx tsc --noEmit` clean.

## 11. Open questions deferred

1. **Sticky-per-image side preference** — if the user manually drags a widget across, should the next spawn for the same image follow it? Today: no. Worth revisiting if "widgets jumping sides" feels jarring in practice.
2. **Animated transitions** between collapsed and expanded states — current behavior is instant. Polish item.
3. **Auto-zoom-to-fit** the whole widget cluster when the user spawns N widgets. Could be a "fit to suggestions" button in the menu bar.
4. **Touch / trackpad** layout — the column metaphor works on a mouse. Touch gestures may want a different model.
5. **Counter-scaling tether handles** — if the visual quality of the edge endpoint at high zoom looks off, we may need to also counter-scale the handle's hit zone. Defer until visible.

## 12. Why these choices

**Why not a feature flag?**
Each commit is small and independently revertable. The blast radius of any one change is one visible behavior. Faster to ship without a flag, easier to reason about.

**Why re-evaluate side per-spawn instead of sticky?**
Sticky adds state (where? per-image? per-session?) and feels surprising when the user pans far away. Re-evaluation is simpler. The "widgets jumping sides" case only happens when the user actively pans between spawns — uncommon for the AI-prompt flow which spawns N widgets simultaneously.

**Why overflow to the opposite side instead of just stacking down?**
Stacking down forever pushes widgets off-image and out of sight. Overflowing to the opposite side keeps every widget visually anchored to the image. Worst case (both sides full) falls back to the old stacking behavior — graceful degradation.

**Why a fixed pill width instead of fit-to-content?**
Image 3 from the user shows a column with a straight left edge. A varying-width column reads as messy. Truncating with ellipsis and showing the full title on hover is the standard tradeoff and the codebase already has the tooltip primitive.

**Why counter-scale via CSS transform instead of switching React Flow's zoom mode?**
React Flow's per-node zoom-disable is a global flag affecting ALL nodes. We want image nodes to scale (so the image visibly grows/shrinks) but widgets to stay constant. Counter-scaling on the widget container only is the precise tool for the precise need. The image-node spec from 2026-06-02 used the same approach for the same reason.
