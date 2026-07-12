# Viewport-anchored Widget Spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canvas widgets spawn anchored to the visible viewport — always in view, column growing both up and down (bounded) — instead of marching downward off the bottom of an image node that may be off-screen.

**Architecture:** Add a pure placement function `placeWidgetInView` to `workspace-layout.ts` that anchors to the viewport rect (in canvas coords), clamps the widget into view, scans a column outward (down/up) for a free slot, and falls back to a bounded cascade near viewport center. Swap the single non-genfill call site in `workspace-tether.ts` to use it. Genfill, image-node, no-viewport, and tether/undo paths are untouched. No canvas panning.

**Tech Stack:** TypeScript (strict), Vitest, React Flow (`@xyflow/react`) canvas, Zustand store.

## Global Constraints

- TypeScript strict mode; named imports only.
- Pure layout logic lives in `src/components/workspace/workspace-layout.ts` and is unit-tested in `src/components/workspace/workspace-layout.test.ts` (no React/store).
- Reuse existing module constants/helpers: `SPAWN_GAP = 24`, `WIDGET_OFFSET_Y = 45`, `MAX_TARGET_SPAWN_OFFSET = 400`, `pickSpawnSide`, `rectsOverlap`.
- New constants (exact values): `VIEW_MARGIN_PX = 24`, `CASCADE_STEP = 24`, `CASCADE_MAX = 8`.
- Widget spawn footprint used by callers: `WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH (226), h: 220 }`.
- No viewport panning / scroll-into-view. No changes to genfill placement, image stacking, the no-viewport fallback, the tether/undo batch, or any backend / React Flow viewport API.
- Spec: `docs/superpowers/specs/2026-07-11-viewport-anchored-widget-spawn-design.md`.

---

## File Structure

- `src/components/workspace/workspace-layout.ts` — **Modify.** Add `VIEW_MARGIN_PX`, `CASCADE_STEP`, `CASCADE_MAX`, a module-local `clamp`, `visibleRect(vp)`, and `placeWidgetInView(target, ownSize, occupied, viewport)`. Existing `attemptColumn` / `fallbackStackDownward` / `nextSpawnPositionFor` stay (still used for images + no-viewport widgets).
- `src/components/workspace/workspace-layout.test.ts` — **Modify.** Add a `placeWidgetInView` describe block (pure, no React).
- `src/lib/workspace-tether.ts` — **Modify.** In `buildTetherForWidget`, replace the non-genfill viewport branch with `placeWidgetInView`; keep the no-viewport `nextSpawnPositionFor` fallback and the genfill branch.
- `src/lib/workspace-tether.test.ts` — **Modify.** Add integration tests: off-screen image clamps into view; no-viewport still places beside the image (unchanged).

---

## Task 1: `placeWidgetInView` pure placement (workspace-layout.ts)

**Files:**
- Modify: `src/components/workspace/workspace-layout.ts`
- Test: `src/components/workspace/workspace-layout.test.ts`

**Interfaces:**
- Consumes (already in the module): `SPAWN_GAP`, `WIDGET_OFFSET_Y`, `MAX_TARGET_SPAWN_OFFSET`, `pickSpawnSide(target, vp)`, `rectsOverlap(a, b)`, types `PlacedRect`, `Viewport`, `Size`.
- Produces (used by Task 2):
  - `export function visibleRect(vp: Viewport): PlacedRect`
  - `export function placeWidgetInView(target: PlacedRect, ownSize: Size, occupied: PlacedRect[], viewport: Viewport): { x: number; y: number }`
  - `export const VIEW_MARGIN_PX = 24`, `export const CASCADE_STEP = 24`, `export const CASCADE_MAX = 8`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/workspace/workspace-layout.test.ts`:

```ts
import { placeWidgetInView, visibleRect, type Viewport } from './workspace-layout';

describe('placeWidgetInView', () => {
  const own = { w: 226, h: 60 };
  const screen = { w: 1200, h: 800 };

  it('places beside an on-screen image and in view (matches beside-image slot)', () => {
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    // image LEFT of viewport center → spawn RIGHT: x = 100 + min(240,400) + 24
    // = 364; anchorY = 50 + 45 = 95, in band, empty → used as-is.
    expect(placeWidgetInView(target, own, [], vp)).toEqual({ x: 364, y: 95 });
  });

  it('clamps into view when the source image is off-screen, biased to the image side', () => {
    // Pan far right so the visible canvas region is [2000, 3200]; image at x=100
    // is off-screen to the LEFT.
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    const vp: Viewport = { pan: { x: -2000, y: 0 }, zoom: 1, screen };
    // minX = view.x + margin = 2000 + 24 = 2024 (viewport's LEFT edge, toward
    // the off-screen image). rawX (364) clamps up to 2024.
    expect(placeWidgetInView(target, own, [], vp)).toEqual({ x: 2024, y: 95 });
  });

  it('grows the column UPWARD when the below-anchor slots are blocked', () => {
    const target = { position: { x: 100, y: 300 }, size: { w: 240, h: 180 } };
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    // colX = 100 + 240 + 24 = 364; anchorY = 345; step = 60 + 24 = 84.
    // Block anchor (345) and first-down (429) → next candidate is UP (261).
    const occupied = [
      { position: { x: 364, y: 345 }, size: own },
      { position: { x: 364, y: 429 }, size: own },
    ];
    const pos = placeWidgetInView(target, own, occupied, vp);
    expect(pos).toEqual({ x: 364, y: 261 });
    expect(pos.y).toBeLessThan(345); // proves upward growth
  });

  it('falls back to a BOUNDED cascade near viewport center when the column is full', () => {
    // Short viewport so only the anchor row fits the band; block the whole
    // column with a tall rect → forces the cascade branch.
    const target = { position: { x: 100, y: 0 }, size: { w: 240, h: 180 } };
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen: { w: 1200, h: 140 } };
    const occupied = [{ position: { x: 364, y: 0 }, size: { w: 226, h: 800 } }];
    const pos = placeWidgetInView(target, own, occupied, vp);
    // Band: minX=24,maxX=950, minY=24,maxY=140-60-24=56. Must stay in view and
    // NEVER march far below the image (bounded), unlike the old downward stack.
    expect(pos.x).toBeGreaterThanOrEqual(24);
    expect(pos.x).toBeLessThanOrEqual(950);
    expect(pos.y).toBeGreaterThanOrEqual(24);
    expect(pos.y).toBeLessThanOrEqual(56);
  });

  it('returns a finite, in-view-as-possible position for a degenerate viewport', () => {
    // Viewport smaller than widget + margins → maxX<minX / maxY<minY collapse.
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen: { w: 100, h: 100 } };
    const pos = placeWidgetInView(target, own, [], vp);
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);
    expect(pos).toEqual({ x: 24, y: 24 });
  });

  it('visibleRect inverts pan/zoom into a canvas-coord rect', () => {
    expect(visibleRect({ pan: { x: -200, y: -100 }, zoom: 2, screen: { w: 1200, h: 800 } }))
      .toEqual({ position: { x: 100, y: 50 }, size: { w: 600, h: 400 } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts -t placeWidgetInView`
Expected: FAIL — `placeWidgetInView`/`visibleRect` are not exported (`is not a function` / import error).

- [ ] **Step 3: Implement `visibleRect` + `placeWidgetInView`**

In `src/components/workspace/workspace-layout.ts`, add near the existing constants (after `COLUMN_OVERFLOW_PAD`):

```ts
export const VIEW_MARGIN_PX = 24;
export const CASCADE_STEP = 24;
export const CASCADE_MAX = 8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** The current viewport as a rect in canvas coordinates. React Flow maps canvas
 *  (cx,cy) → screen (cx*zoom + pan.x, …); inverting gives the visible region. */
export function visibleRect(vp: Viewport): PlacedRect {
  return {
    position: { x: -vp.pan.x / vp.zoom, y: -vp.pan.y / vp.zoom },
    size: { w: vp.screen.w / vp.zoom, h: vp.screen.h / vp.zoom },
  };
}

/**
 * Place a widget anchored to the VISIBLE viewport, not the raw image node.
 * Beside the image when it is on-screen; clamped into view otherwise, so an
 * off-screen source yields an in-view widget whose tether points toward it.
 * The column grows both up and down within the visible band; a bounded cascade
 * near viewport center is the last resort. Never returns an unbounded-downward
 * position and never pans the canvas.
 */
export function placeWidgetInView(
  target: PlacedRect,
  ownSize: Size,
  occupied: PlacedRect[],
  viewport: Viewport,
): { x: number; y: number } {
  const view = visibleRect(viewport);
  const m = VIEW_MARGIN_PX / viewport.zoom;
  const minX = view.position.x + m;
  let maxX = view.position.x + view.size.w - ownSize.w - m;
  const minY = view.position.y + m;
  let maxY = view.position.y + view.size.h - ownSize.h - m;
  // Degenerate viewport (widget + margins exceed the view): collapse max to min
  // so clamp() stays well-defined and the widget lands as in-view as possible.
  if (maxX < minX) maxX = minX;
  if (maxY < minY) maxY = minY;

  // Column X: beside the image (existing side logic), clamped into view. When
  // the image is off-screen the clamp pins the column to the viewport edge on
  // the image's side.
  const side = pickSpawnSide(target, viewport);
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const rawX =
    side === 'right'
      ? target.position.x + xOffset + SPAWN_GAP
      : target.position.x - ownSize.w - SPAWN_GAP;
  const colX = clamp(rawX, minX, maxX);

  // Column Y: anchor at the image top (clamped into view), then scan outward,
  // alternating down then up, within the band. First non-colliding slot wins.
  const anchorY = clamp(target.position.y + WIDGET_OFFSET_Y, minY, maxY);
  const step = ownSize.h + SPAWN_GAP;
  for (let k = 0; ; k++) {
    const down = anchorY + k * step;
    const up = anchorY - k * step;
    if (down > maxY && up < minY) break;
    for (const y of k === 0 ? [anchorY] : [down, up]) {
      if (y < minY || y > maxY) continue;
      const rect = { position: { x: colX, y }, size: ownSize };
      if (!occupied.some((o) => rectsOverlap(rect, o))) return { x: colX, y };
    }
  }

  // Crowded: bounded diagonal cascade from viewport center.
  const cx = clamp(view.position.x + view.size.w / 2 - ownSize.w / 2, minX, maxX);
  const cy = clamp(view.position.y + view.size.h / 2 - ownSize.h / 2, minY, maxY);
  for (let i = 0; i < CASCADE_MAX; i++) {
    const x = clamp(cx + i * CASCADE_STEP, minX, maxX);
    const y = clamp(cy + i * CASCADE_STEP, minY, maxY);
    const rect = { position: { x, y }, size: ownSize };
    if (!occupied.some((o) => rectsOverlap(rect, o))) return { x, y };
  }
  return { x: cx, y: cy };
}
```

Note: `pickSpawnSide`, `SPAWN_GAP`, `WIDGET_OFFSET_Y`, `MAX_TARGET_SPAWN_OFFSET`, `rectsOverlap`, `PlacedRect`, `Viewport`, and `Size` already exist in this module — no new imports beyond the `Size` type already imported at the top.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts`
Expected: PASS (new `placeWidgetInView` block + all pre-existing `nextSpawnPositionFor` / `pickSpawnSide` tests).

- [ ] **Step 5: Typecheck + lint the changed file**

Run: `npx tsc -b && npx eslint src/components/workspace/workspace-layout.ts src/components/workspace/workspace-layout.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/workspace-layout.ts src/components/workspace/workspace-layout.test.ts
git commit -m "feat(workspace): placeWidgetInView — viewport-anchored, up/down, bounded

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Route non-genfill widget spawns through `placeWidgetInView`

**Files:**
- Modify: `src/lib/workspace-tether.ts` (the non-genfill branch inside `buildTetherForWidget`, around lines 82–85)
- Test: `src/lib/workspace-tether.test.ts`

**Interfaces:**
- Consumes (from Task 1): `placeWidgetInView(target, ownSize, occupied, viewport)`.
- Keeps: `nextSpawnPositionFor` (no-viewport fallback), `pickSpawnSide` is no longer called directly here (it now lives inside `placeWidgetInView`).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/workspace-tether.test.ts` (reuses the file's existing `makeWidget` helper + `useEditorStore`):

```ts
describe('tetherWorkspaceWidget — viewport-anchored placement', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('clamps an off-screen image spawn into the visible viewport', () => {
    // Image far off-screen bottom-right; viewport shows canvas [0,0]–[1000,800].
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 5000, y: 5000 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_far', {
      origin: { kind: 'mcp_user_prompt', prompt: 'brighter' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_far', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidget(w, { pan: { x: 0, y: 0 }, zoom: 1, screen: { w: 1000, h: 800 } });

    // WIDGET_SPAWN_SIZE = 226×220; margin 24. Image is RIGHT of viewport center
    // → spawn LEFT; rawX (5000-226-24) clamps to the RIGHT viewport edge
    // maxX = 1000-226-24 = 750 (toward the off-screen image). anchorY clamps to
    // maxY = 800-220-24 = 556.
    expect(useEditorStore.getState().widgetNodes[w.id]?.position).toEqual({ x: 750, y: 556 });
  });

  it('no-viewport call still places beside the image (unchanged behavior)', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 5000, y: 5000 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_nvp', {
      origin: { kind: 'mcp_user_prompt', prompt: 'brighter' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_nvp', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidget(w); // no viewport → nextSpawnPositionFor(side 'left')

    // Left column beside the image: x = 5000 - 226 - 24 = 4750; y = 5000 + 45 = 5045.
    expect(useEditorStore.getState().widgetNodes[w.id]?.position).toEqual({ x: 4750, y: 5045 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/workspace-tether.test.ts -t "viewport-anchored"`
Expected: the off-screen test FAILS — current code returns `{ x: 4750, y: 5045 }` (beside-image, not clamped into view) instead of `{ x: 750, y: 556 }`. (The no-viewport test passes already; it locks the unchanged path.)

- [ ] **Step 3: Swap the call site**

In `src/lib/workspace-tether.ts`, update the import from `workspace-layout` to add `placeWidgetInView` (and drop `pickSpawnSide` if it's no longer referenced elsewhere in the file):

```ts
import { nextSpawnPositionFor, placeWidgetInView, type PlacedRect, type Viewport } from '@/components/workspace/workspace-layout';
```

Then replace the non-genfill branch of the `if (widget.genfill && viewport) { … } else { … }` block:

```ts
  } else if (viewport) {
    pos = placeWidgetInView(targetRect, WIDGET_SPAWN_SIZE, occupied, viewport);
  } else {
    // Headless / first paint: no viewport known → keep the original beside-image
    // stacking on the left column.
    pos = nextSpawnPositionFor(targetRect, WIDGET_SPAWN_SIZE, 'widget', occupied, 'left');
  }
```

The `if (widget.genfill && viewport)` branch above it is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/workspace-tether.test.ts`
Expected: PASS — including the pre-existing genfill/origin-filter tests (untouched paths).

- [ ] **Step 5: Typecheck + lint the changed file**

Run: `npx tsc -b && npx eslint src/lib/workspace-tether.ts src/lib/workspace-tether.test.ts`
Expected: no errors. If `pickSpawnSide` is now unused, its import must be removed (lint will flag it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace-tether.ts src/lib/workspace-tether.test.ts
git commit -m "feat(workspace): spawn widgets into view via placeWidgetInView

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS (`tsc -b` + `eslint .` + `vitest run`). Only pre-existing warnings — no new errors, no failing tests.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Launch the app, open an image, pan so the image sits at a viewport edge (and again fully off-screen), then spawn several widgets from the toolrail / Cmd+K. Confirm: each new widget appears within the visible viewport, the column fills upward as well as downward, widgets never march far below the image, and the canvas never auto-pans. Genfill still centers.

---

## Self-Review

**Spec coverage:**
- Visible-rect helper → `visibleRect` (Task 1). ✓
- Column X clamp into view / off-screen bias → `placeWidgetInView` step + Task 1 off-screen test + Task 2 integration test. ✓
- Column Y grows up and down, bounded → `placeWidgetInView` outward scan + Task 1 upward-growth test. ✓
- Crowded cascade near viewport center → cascade branch + Task 1 bounded-cascade test. ✓
- Degenerate viewport guard → collapse `maxX/maxY` + Task 1 degenerate test. ✓
- Untouched: genfill (unchanged branch), images, no-viewport fallback (Task 2 no-viewport test), tether/undo batch, occupied list. ✓
- Non-goals (no pan, no Tidy-up command, no backend change) → nothing in the plan touches those. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test asserts concrete values (or explicit in-band bounds for the intentionally property-based cascade case).

**Type consistency:** `placeWidgetInView(target: PlacedRect, ownSize: Size, occupied: PlacedRect[], viewport: Viewport)` and `visibleRect(vp: Viewport): PlacedRect` are used identically in Task 2. `WIDGET_SPAWN_SIZE` (226×220), `SPAWN_GAP` (24), `WIDGET_OFFSET_Y` (45), `MAX_TARGET_SPAWN_OFFSET` (400) match the numbers baked into the test assertions.
