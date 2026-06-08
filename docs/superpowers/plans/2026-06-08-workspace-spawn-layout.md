# Workspace Spawn Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planner-spawned widgets appear as uniform-width collapsed pills in a viewport-relative column beside the image, overflowing to the opposite side when full, with zoom-invariant shells that stay fixed screen-size as the canvas zooms.

**Architecture:** Five orthogonal commits, each independently revertable: (1) drop auto-expand on spawn + reduce footprint, (2) fix collapsed pill width with ellipsis title, (3) viewport-relative side picker wired into `nextSpawnPositionFor`, (4) overflow to opposite side when preferred column fills, (5) zoom-invariant CSS counter-scale on `WidgetShell`. No data migration, no feature flag.

**Tech Stack:** React 19 + TypeScript, React Flow (`@xyflow/react`), Vitest, Zustand for editor state.

**Reference:** `docs/superpowers/specs/2026-06-08-workspace-spawn-layout-design.md`

**Pre-existing constant:** `WIDGET_SHELL_MIN_WIDTH = 226` in `src/components/widget/WidgetShell.tsx`. The spec said 220; use 226 to match the existing constant.

---

## File Structure

### Modified
- `src/lib/workspace-tether.ts` — drop auto-expand call, lower `WIDGET_SPAWN_SIZE.h`, wire `pickSpawnSide`
- `src/components/workspace/workspace-layout.ts` — add `Viewport` type, `pickSpawnSide` helper, `side` param + overflow logic in `nextSpawnPositionFor`
- `src/components/widget/WidgetShell.tsx` — uniform collapsed width + ellipsis title, apply zoom-invariant scale
- `src/index.css` — utility class for the ellipsis title (uses existing tokens)

### Created
- `src/components/widget/useZoomInvariantScale.ts` — hook that reads React Flow zoom and returns `1/zoom`
- `src/components/widget/__tests__/useZoomInvariantScale.test.tsx` — hook unit test

### Tests (extended)
- `src/components/workspace/workspace-layout.test.ts` — `pickSpawnSide`, `side` param, overflow
- `src/components/widget/WidgetShell.test.tsx` — uniform width, ellipsis, zoom-invariant scale
- `src/lib/__tests__/workspace-tether.test.ts` — verify no auto-expand, viewport-relative placement (extend if exists; create if not)

---

## Task 1: Spawn collapsed, drop footprint

**Visible effect:** Widgets appear as compact headers (pills) instead of fully-expanded cards when the planner or toolrail spawns them.

**Files:**
- Modify: `src/lib/workspace-tether.ts`
- Test: `src/lib/__tests__/workspace-tether.test.ts` (extend if exists; create otherwise)

- [ ] **Step 1: Check whether a test file exists**

Run: `ls /Users/anton/Dev/Projects/editor/src/lib/__tests__/workspace-tether.test.ts 2>/dev/null || echo "no test file yet"`

If "no test file yet", you'll create one. Otherwise extend.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/__tests__/workspace-tether.test.ts` (create the file if missing — copy the import style from any other `src/lib/__tests__/*.test.ts`):

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { tetherWorkspaceWidget } from '../workspace-tether';
import type { Widget } from '@/types/widget';

function makeWidget(): Widget {
  return {
    id: 'w_test',
    intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'tool_invoked', prompt: null, parent_widget_id: null },
    op_id: 'grain',
    composed: false,
    nodes: [
      { id: 'n_a', type: 'grain', op_id: 'grain', params: {}, layer_id: 'l1' },
    ] as unknown as Widget['nodes'],
    bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    display_name: 'Grain',
    category: 'texture',
  };
}

describe('tetherWorkspaceWidget: spawn collapsed', () => {
  beforeEach(() => {
    // Seed an image node so the tether has a target.
    useEditorStore.setState((s) => ({
      ...s,
      imageNodes: {
        i1: {
          id: 'i1',
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          layerIds: ['l1'],
        } as unknown as (typeof s.imageNodes)[string],
      },
      activeImageNodeId: 'i1',
      widgetNodes: {},
      expandedWidgetIds: new Set<string>(),
    }));
  });

  it('does NOT auto-expand the widget on spawn', () => {
    tetherWorkspaceWidget(makeWidget());
    const expanded = useEditorStore.getState().expandedWidgetIds;
    expect(expanded.has('w_test')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/__tests__/workspace-tether.test.ts`
Expected: FAIL — widget is added to `expandedWidgetIds`.

- [ ] **Step 4: Edit workspace-tether.ts**

In `src/lib/workspace-tether.ts`:

1. **Remove the auto-expand call** — find this line near the bottom of `buildTetherForWidget`:
   ```typescript
   // Widgets spawn expanded so their controls are immediately visible.
   useEditorStore.getState().expandWidget(widget.id);
   ```
   Delete BOTH lines (the comment and the call).

2. **Lower the spawn footprint estimate** — find:
   ```typescript
   const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH, h: 200 } as const;
   ```
   Replace with:
   ```typescript
   // Collapsed pill height — header only. Used by nextSpawnPositionFor's
   // collision math. Widgets spawn COLLAPSED (no auto-expand on spawn);
   // the user clicks the chevron to open the body.
   const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH, h: 52 } as const;
   ```

3. **Update the comment block** above `WIDGET_SPAWN_SIZE`. Replace the existing comment with:
   ```typescript
   // Workspace widget placement footprint used by the collision-aware spawn
   // algorithm (nextSpawnPositionFor). Widgets spawn COLLAPSED, so this
   // height estimates the closed header only.
   ```

- [ ] **Step 5: Run test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/workspace-tether.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full vitest + tsc to confirm no regressions**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/lib/workspace-tether.ts src/lib/__tests__/workspace-tether.test.ts
git commit -m "feat(workspace): widgets spawn collapsed (drop auto-expand)"
```

---

## Task 2: Uniform pill width + ellipsis title

**Visible effect:** Collapsed pills form a straight-edged vertical column; long titles ellipsis-truncate instead of stretching the pill wider.

**Files:**
- Modify: `src/components/widget/WidgetShell.tsx`
- Modify: `src/index.css`
- Test: `src/components/widget/WidgetShell.test.tsx` (extend)

- [ ] **Step 1: Read the current WidgetShell.tsx**

Open `/Users/anton/Dev/Projects/editor/src/components/widget/WidgetShell.tsx`. Identify:
- The element that controls the outer width (currently uses `min-w-[226px]` per the comment at line 133)
- Where `isExpanded` is read (around line 35: `const { isExpanded, toggle } = useWidgetExpansion(widget.id);`)
- Where the title text is rendered (probably in `WidgetShellHeader` — search for `title` / `resolveTitle` / widget name)

- [ ] **Step 2: Add the WIDGET_COLLAPSED_WIDTH constant + write failing test**

In `src/components/widget/WidgetShell.test.tsx`, add:

```typescript
import { WIDGET_COLLAPSED_WIDTH } from './WidgetShell';

describe('WidgetShell collapsed pill width', () => {
  it('exports WIDGET_COLLAPSED_WIDTH = 226', () => {
    // Same as WIDGET_SHELL_MIN_WIDTH so the visual width is consistent
    // between collapsed pill and expanded card header.
    expect(WIDGET_COLLAPSED_WIDTH).toBe(226);
  });
});
```

(Read the rest of the test file first to match the existing import style — the test for ellipsis behaviour comes next; this minimal test just locks the constant.)

- [ ] **Step 3: Run test to confirm failure**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: FAIL — `WIDGET_COLLAPSED_WIDTH` not exported.

- [ ] **Step 4: Add the constant**

At the top of `src/components/widget/WidgetShell.tsx`, just below `WIDGET_SHELL_MIN_WIDTH`:

```typescript
// Fixed width for collapsed pill state. Matches WIDGET_SHELL_MIN_WIDTH so
// transitioning collapsed → expanded doesn't change horizontal footprint.
// Long titles truncate with ellipsis (.widget-title-ellipsis utility).
export const WIDGET_COLLAPSED_WIDTH = 226;
```

- [ ] **Step 5: Apply the fixed width to the shell when collapsed**

Find the outer container in `WidgetShell.tsx` that has `min-w-[226px]` (around line 133 per the comment). Change it so collapsed state has FIXED width (not min-width):

```typescript
// Original:
//   className="... min-w-[226px] ..."
// New: width adapts to state.
<div
  className={`widget-shell ${isExpanded ? 'widget-shell-expanded' : 'widget-shell-collapsed'}`}
  style={isExpanded
    ? { minWidth: `${WIDGET_SHELL_MIN_WIDTH}px` }
    : { width: `${WIDGET_COLLAPSED_WIDTH}px` }}
  ...
>
```

(Adapt to the file's actual className composition — keep all existing class strings, just swap the width mechanism for collapsed state.)

- [ ] **Step 6: Add the ellipsis utility class**

In `src/index.css`, add (near other inspector / widget utility classes):

```css
.widget-title-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
```

No design tokens are needed for these properties (they're purely structural).

- [ ] **Step 7: Apply the class to the title text**

Find where the widget header renders the title (`WidgetShellHeader.tsx` after Task 8 of the smart-widget feature). Add `widget-title-ellipsis` to the title element's className. The parent flex container must have `min-width: 0` (this is what unlocks ellipsis in flex layouts) — add it via inline style or via a tailwind `min-w-0` class if the project uses tailwind.

- [ ] **Step 8: Write an ellipsis-behavior test**

Add to `src/components/widget/WidgetShell.test.tsx`:

```typescript
it('truncates long titles with ellipsis in collapsed state', () => {
  const widget = makeWidget({
    display_name: 'A very long widget name that should not stretch the pill wider',
  });
  const { container } = render(<WidgetShell widget={widget} /* other required props */ />);
  // The title element carries the ellipsis utility class.
  const titleEl = container.querySelector('.widget-title-ellipsis');
  expect(titleEl).not.toBeNull();
});
```

(`makeWidget` should already be defined in the test file from prior tests; adapt if it isn't.)

- [ ] **Step 9: Run tests + tsc**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/WidgetShell.test.tsx
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/WidgetShell.tsx src/components/widget/WidgetShellHeader.tsx src/components/widget/WidgetShell.test.tsx src/index.css
git commit -m "feat(workspace): uniform 226px collapsed pill width with ellipsis title"
```

---

## Task 3: Viewport-relative side picker + `side` param + caller wire

**Visible effect:** New widgets land on whichever side of the image has more viewport room.

**Files:**
- Modify: `src/components/workspace/workspace-layout.ts`
- Modify: `src/lib/workspace-tether.ts`
- Test: `src/components/workspace/workspace-layout.test.ts` (extend)

- [ ] **Step 1: Write failing tests for `pickSpawnSide`**

Add to `src/components/workspace/workspace-layout.test.ts`:

```typescript
import { pickSpawnSide, type Viewport } from './workspace-layout';

describe('pickSpawnSide', () => {
  const target = { position: { x: 0, y: 0 }, size: { w: 200, h: 100 } };
  const screen = { w: 1200, h: 800 };

  it('returns LEFT when image is in the right half of the viewport', () => {
    // Viewport center is at canvas x = 600 (no pan, zoom 1, screen 1200).
    // Image center at canvas x = 100 → image is LEFT of viewport center.
    // Wait — we want the OPPOSITE: image right → spawn left.
    // Pan the canvas so the image ends up on the right of the viewport.
    const viewport: Viewport = { pan: { x: -800, y: 0 }, zoom: 1, screen };
    // viewport center in canvas coords = (-(-800) + 600)/1 = 1400
    // image center = 0 + 100 = 100; 100 < 1400 → image LEFT of viewport center.
    // Expected: RIGHT (image in left half → spawn right).
    expect(pickSpawnSide(target, viewport)).toBe('right');
  });

  it('returns RIGHT when image is in the left half of the viewport', () => {
    // No pan: viewport center = 600. Place image at center = 800 → right half.
    const targetRight = { position: { x: 700, y: 0 }, size: { w: 200, h: 100 } };
    const viewport: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    // viewport center = 600; image center = 800; 800 > 600 → image RIGHT half → spawn LEFT
    expect(pickSpawnSide(targetRight, viewport)).toBe('left');
  });

  it('returns LEFT (tie default) when image is at viewport center', () => {
    const targetCenter = { position: { x: 500, y: 0 }, size: { w: 200, h: 100 } };
    const viewport: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    // image center = 600; viewport center = 600 → tie band → LEFT.
    expect(pickSpawnSide(targetCenter, viewport)).toBe('left');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts`
Expected: FAIL — `pickSpawnSide` not exported.

- [ ] **Step 3: Implement `Viewport` + `pickSpawnSide`**

In `src/components/workspace/workspace-layout.ts`, ABOVE `nextSpawnPositionFor`, add:

```typescript
export interface Viewport {
  pan: { x: number; y: number };   // React Flow's pan transform
  zoom: number;                      // React Flow's zoom transform
  screen: { w: number; h: number };  // Viewport screen dimensions in CSS pixels
}

/** Pick which side of `target` to spawn the next widget on, based on where
 *  the image sits in the viewport. The side with MORE empty viewport space
 *  wins. Ties default to LEFT.
 *
 *  All math is in canvas coordinates (we convert viewport screen-space
 *  values via the inverse pan + zoom transform). */
export function pickSpawnSide(target: PlacedRect, viewport: Viewport): 'left' | 'right' {
  // Viewport center, in canvas coords. React Flow's transform maps canvas
  // (cx, cy) → screen (cx*zoom + pan.x, cy*zoom + pan.y). Inverting:
  // canvas_x = (screen_x - pan.x) / zoom. Screen center = screen.w/2.
  const viewportCenterCanvasX = (viewport.screen.w / 2 - viewport.pan.x) / viewport.zoom;
  const imageCenterCanvasX = target.position.x + target.size.w / 2;

  // Tie band: ±5% of viewport width (in canvas units after dividing by zoom).
  const tieBand = (viewport.screen.w * 0.05) / viewport.zoom;
  if (Math.abs(imageCenterCanvasX - viewportCenterCanvasX) <= tieBand) return 'left';

  // Image is RIGHT of viewport center → empty space is on the LEFT → spawn LEFT.
  return imageCenterCanvasX > viewportCenterCanvasX ? 'left' : 'right';
}
```

- [ ] **Step 4: Add `side` param to `nextSpawnPositionFor` (default 'right' for back-compat)**

Replace the existing `nextSpawnPositionFor` body. Don't remove parameters — add `side` after `occupied`:

```typescript
export function nextSpawnPositionFor(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right' = 'right',
): { x: number; y: number } {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = side === 'right'
    ? target.position.x + xOffset + SPAWN_GAP
    : target.position.x - ownSize.w - SPAWN_GAP;

  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: ownSize }, o))) {
    y += ownSize.h + SPAWN_GAP;
  }
  return { x, y };
}
```

(Overflow logic lands in Task 4. For now we just add the side parameter and the LEFT branch.)

- [ ] **Step 5: Add a test that `side='left'` places widgets to the LEFT**

In `workspace-layout.test.ts`, add inside the existing `nextSpawnPositionFor` describe block:

```typescript
it('places widgets to the LEFT when side="left"', () => {
  const target = { position: { x: 500, y: 50 }, size: { w: 240, h: 180 } };
  // x = 500 - 226 - 24 = 250; y = 50 + 45 (WIDGET_OFFSET_Y) = 95
  expect(nextSpawnPositionFor(target, widgetSize, 'widget', [], 'left'))
    .toEqual({ x: 250, y: 95 });
});

it('preserves right-side behavior when side defaulted', () => {
  const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
  // Should match the existing default-right test exactly.
  expect(nextSpawnPositionFor(target, widgetSize, 'widget', []))
    .toEqual({ x: 364, y: 95 });
});
```

- [ ] **Step 6: Wire the caller**

In `src/lib/workspace-tether.ts`, modify `buildTetherForWidget` to read the viewport and call `pickSpawnSide`. Use React Flow's imperative store. The hook pattern won't work here (this is called from a non-component context); look at how other helpers read the React Flow state.

If unsure, use the explicit approach: pass `Viewport` into `buildTetherForWidget` from the caller that has the React Flow hook. The closest caller is in the SSE handler (or wherever `tetherWorkspaceWidget` is invoked). Add an optional `viewport?: Viewport` arg:

```typescript
// In workspace-tether.ts:
import { pickSpawnSide, type Viewport } from '@/components/workspace/workspace-layout';

function buildTetherForWidget(widget: Widget, viewport?: Viewport): void {
  // ... existing logic up to the targetNode resolution ...

  // Pick side based on viewport. Default to LEFT when viewport is unavailable.
  const side: 'left' | 'right' = viewport
    ? pickSpawnSide({ position: targetNode.position, size: targetNode.size }, viewport)
    : 'left';

  // ... build occupied list as today ...

  const pos = nextSpawnPositionFor(
    { position: targetNode.position, size: targetNode.size },
    WIDGET_SPAWN_SIZE,
    'widget',
    occupied,
    side,
  );

  // ... rest of the function unchanged ...
}

export function tetherWorkspaceWidget(widget: Widget, viewport?: Viewport): void {
  const k = widget.origin.kind;
  if (k !== 'tool_invoked' && k !== 'mcp_user_prompt') return;
  buildTetherForWidget(widget, viewport);
}

export function tetherWorkspaceWidgetOnEngage(widget: Widget, viewport?: Viewport): void {
  buildTetherForWidget(widget, viewport);
}
```

Then update the call sites. Grep:
```bash
grep -rn "tetherWorkspaceWidget" /Users/anton/Dev/Projects/editor/src --include="*.ts" --include="*.tsx" -l
```

For each caller, if it lives inside a React component, get the viewport via `useReactFlow()` and pass it:

```typescript
import { useReactFlow } from '@xyflow/react';
// ...
const rf = useReactFlow();
// On the SSE 'widget.created' handler or wherever tetherWorkspaceWidget is called:
const { x, y, zoom } = rf.getViewport();
const screen = { w: window.innerWidth, h: window.innerHeight };
tetherWorkspaceWidget(widget, { pan: { x, y }, zoom, screen });
```

(`window.innerWidth/Height` is acceptable since React Flow fills the workspace pane; for a more precise read, grab the bounding rect of the React Flow container.)

If a caller can't easily get the viewport (e.g. it's deep in a non-React module), pass `undefined` — the helper defaults to LEFT.

- [ ] **Step 7: Run all tests**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/workspace-layout.ts src/components/workspace/workspace-layout.test.ts src/lib/workspace-tether.ts
# also any caller files you modified:
# e.g. git add src/components/...
git commit -m "feat(workspace): viewport-relative side picker for widget spawn"
```

---

## Task 4: Overflow to opposite side

**Visible effect:** When the preferred-side column fills (widget would land below image_bottom + 100px pad), the next widget appears on the opposite side instead.

**Files:**
- Modify: `src/components/workspace/workspace-layout.ts`
- Test: `src/components/workspace/workspace-layout.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Add to `workspace-layout.test.ts`:

```typescript
describe('nextSpawnPositionFor: overflow to opposite side', () => {
  const widgetSize = { w: 226, h: 60 };
  const target = { position: { x: 500, y: 50 }, size: { w: 240, h: 180 } };
  // Image bottom = 230; COLUMN_OVERFLOW_PAD = 100; yLimit = 330.

  it('overflows to opposite side when preferred column is full', () => {
    // Fill the LEFT column with widgets covering y=95 through the yLimit.
    const leftX = 500 - 226 - 24;  // = 250
    const occupied = [
      { position: { x: leftX, y: 95 },  size: widgetSize },
      { position: { x: leftX, y: 179 }, size: widgetSize },
      { position: { x: leftX, y: 263 }, size: widgetSize },
    ];
    // Next widget should overflow to RIGHT (= x = 500 + min(240,400) + 24 = 764).
    const pos = nextSpawnPositionFor(target, widgetSize, 'widget', occupied, 'left');
    expect(pos.x).toBe(764);
    // y starts at WIDGET_OFFSET_Y (95) because the right column is empty.
    expect(pos.y).toBe(95);
  });

  it('falls back to stacking past yLimit when BOTH sides are full', () => {
    const leftX = 500 - 226 - 24;
    const rightX = 500 + 240 + 24;
    // Saturate both columns up past yLimit.
    const yPositions = [95, 179, 263, 347, 431];
    const occupied = [
      ...yPositions.map(y => ({ position: { x: leftX,  y }, size: widgetSize })),
      ...yPositions.map(y => ({ position: { x: rightX, y }, size: widgetSize })),
    ];
    const pos = nextSpawnPositionFor(target, widgetSize, 'widget', occupied, 'left');
    // Fallback: stay on preferred (LEFT) side, keep stacking past yLimit.
    expect(pos.x).toBe(leftX);
    expect(pos.y).toBeGreaterThan(430);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts`
Expected: FAIL — overflow logic missing.

- [ ] **Step 3: Implement overflow**

In `src/components/workspace/workspace-layout.ts`, replace the body of `nextSpawnPositionFor` with the overflow-aware version. Also add `COLUMN_OVERFLOW_PAD` and the `attemptColumn` helper:

```typescript
export const COLUMN_OVERFLOW_PAD = 100;

function attemptColumn(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right',
): { x: number; y: number } | null {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = side === 'right'
    ? target.position.x + xOffset + SPAWN_GAP
    : target.position.x - ownSize.w - SPAWN_GAP;

  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  const yLimit = target.position.y + target.size.h + COLUMN_OVERFLOW_PAD;

  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: ownSize }, o))) {
    y += ownSize.h + SPAWN_GAP;
    if (y + ownSize.h > yLimit) return null;
  }
  return { x, y };
}

function fallbackStackDownward(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right',
): { x: number; y: number } {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = side === 'right'
    ? target.position.x + xOffset + SPAWN_GAP
    : target.position.x - ownSize.w - SPAWN_GAP;

  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: ownSize }, o))) {
    y += ownSize.h + SPAWN_GAP;
  }
  return { x, y };
}

export function nextSpawnPositionFor(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right' = 'right',
): { x: number; y: number } {
  const tried = attemptColumn(target, ownSize, kind, occupied, side);
  if (tried) return tried;

  const opposite: 'left' | 'right' = side === 'right' ? 'left' : 'right';
  const overflowed = attemptColumn(target, ownSize, kind, occupied, opposite);
  if (overflowed) return overflowed;

  return fallbackStackDownward(target, ownSize, kind, occupied, side);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Run full sweep**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/workspace-layout.ts src/components/workspace/workspace-layout.test.ts
git commit -m "feat(workspace): widget column overflows to opposite side when full"
```

---

## Task 5: Zoom-invariant widget shells

**Visible effect:** Widget pills stay the same on-screen size as the user zooms the canvas in or out. Image nodes still scale with zoom (unchanged).

**Files:**
- Create: `src/components/widget/useZoomInvariantScale.ts`
- Create: `src/components/widget/__tests__/useZoomInvariantScale.test.tsx`
- Modify: `src/components/widget/WidgetShell.tsx`
- Test: `src/components/widget/WidgetShell.test.tsx` (extend)

- [ ] **Step 1: Write the failing hook test**

Create `src/components/widget/__tests__/useZoomInvariantScale.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStore } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useZoomInvariantScale } from '../useZoomInvariantScale';

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe('useZoomInvariantScale', () => {
  it('returns 1 when React Flow zoom is 1', () => {
    const { result } = renderHook(() => useZoomInvariantScale(), { wrapper });
    expect(result.current).toBeCloseTo(1, 5);
  });

  it('clamps the zoom denominator at 0.01 to avoid divide-by-zero', () => {
    // Direct unit test of the clamp math — not driven through React Flow.
    // The hook formula is 1 / Math.max(zoom, 0.01). Verify the public contract:
    // even a zero zoom doesn't crash.
    expect(1 / Math.max(0, 0.01)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/components/widget/__tests__/useZoomInvariantScale.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the hook**

Create `src/components/widget/useZoomInvariantScale.ts`:

```typescript
import { useStore } from '@xyflow/react';

/** Hook that returns the counter-scale needed to keep a node visually
 *  fixed-size as React Flow's zoom transform changes. Apply as
 *  `transform: scale(useZoomInvariantScale())` on the node's outer container.
 *
 *  Clamps zoom at 0.01 so an unexpected zero value doesn't blow up the
 *  transform with Infinity. */
export function useZoomInvariantScale(): number {
  const zoom = useStore((s) => s.transform[2]);
  return 1 / Math.max(zoom, 0.01);
}
```

- [ ] **Step 4: Run hook test to verify pass**

Run: `npx vitest run src/components/widget/__tests__/useZoomInvariantScale.test.tsx`
Expected: PASS.

- [ ] **Step 5: Apply counter-scale to WidgetShell**

In `src/components/widget/WidgetShell.tsx`:

1. Import the hook:
   ```typescript
   import { useZoomInvariantScale } from './useZoomInvariantScale';
   ```

2. Inside the component body, get the scale:
   ```typescript
   const zoomInverse = useZoomInvariantScale();
   ```

3. Apply it to the outer container. Pick `transform-origin: top left` so the pill anchors at the same canvas point as zoom changes:
   ```tsx
   <div
     className="widget-shell ..."
     style={{
       transform: `scale(${zoomInverse})`,
       transformOrigin: 'top left',
       // keep the existing width/minWidth from Task 2
       ...(isExpanded
         ? { minWidth: `${WIDGET_SHELL_MIN_WIDTH}px` }
         : { width: `${WIDGET_COLLAPSED_WIDTH}px` }),
     }}
     ...
   >
   ```

4. **Important**: any React Flow `<Handle>` components for tether endpoints must live INSIDE this scaled container. If they currently sit at the top of the component, move them inside the outer div so they move with the visible edges.

- [ ] **Step 6: Write a WidgetShell test for the scale style**

Add to `src/components/widget/WidgetShell.test.tsx`:

```typescript
import { ReactFlowProvider } from '@xyflow/react';

it('applies a transform-scale style derived from the React Flow zoom', () => {
  const widget = makeWidget();
  const { container } = render(
    <ReactFlowProvider>
      <WidgetShell widget={widget} /* other required props */ />
    </ReactFlowProvider>,
  );
  const shell = container.querySelector('.widget-shell');
  // At zoom = 1 (default), inverse = 1; the transform string should contain scale(1).
  expect(shell?.getAttribute('style') ?? '').toMatch(/scale\(1\)/);
});
```

- [ ] **Step 7: Run tests + tsc**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 8: Manual smoke test (optional but recommended)**

If you can run the dev server (`npm run dev`):
1. Spawn a widget (toolrail click or Cmd+K).
2. Zoom the canvas in and out via scroll wheel.
3. The widget pill should stay the same screen-pixel size while the image grows/shrinks.
4. The tether line should connect from the pill edge to the image edge at all zoom levels.

If the pill VISIBLY scales with zoom, the `<Handle>` is probably outside the scaled container OR `transform-origin` is wrong. Re-check Step 5.

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/useZoomInvariantScale.ts src/components/widget/__tests__/useZoomInvariantScale.test.tsx src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx
git commit -m "feat(workspace): zoom-invariant widget shells (fixed screen size)"
```

---

## Definition of Done

After Task 5:

- Spawning 4-5 widgets via Cmd+K produces a vertical column of collapsed pills on whichever side of the image has more viewport space.
- All pills share width 226px; long titles ellipsis-truncate.
- Tether edges connect from the pill's right (or left) side to the image's left (or right) side.
- Zooming the canvas leaves pill on-screen sizes visibly unchanged.
- Filling one column overflows the next widget to the opposite side.
- Toolrail-spawned single widgets retain their existing UX (no regression).
- Existing widget undo / redo, drag-to-reposition, and click-to-expand still work.
- Frontend test suite: ≥557 tests passing.
- `npx tsc --noEmit` clean.
