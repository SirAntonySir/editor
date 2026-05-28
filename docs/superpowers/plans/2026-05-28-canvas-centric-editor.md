# Canvas-centric editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the canvas-centric editor UI described in `docs/superpowers/specs/2026-05-28-canvas-centric-editor-design.md` — lean tool rail, click-cycle selection, unified cursor-bind invocation for tools + AI suggestions, three-section right panel, segment-nested layers, selection-driven opacity focus.

**Architecture:** Add one small `cursor-bind` Zustand slice that drives a ghost-on-cursor preview rendered inside `CanvasWidgetLayer`. Reuse the existing `Widget` projection, `selectAllWidgets()`, `ToolWidgetCard`, `WidgetCard`, `LayersPanelBody`, and `useSegmentSelection.clickAt` cycle stack. Selection unification: every click (canvas, layer row, segment row) writes both `selectedSegmentId` (back-compat) AND `activeScope` (truth for opacity + spawn). One opacity rule (`scope-match` utility) applied at three render sites: canvas widget overlay, Suggestions rows, Active rows.

**Tech Stack:** React 19 + TS strict, Zustand v5 + Immer, Fabric.js v7, Vitest, ESLint with `no-nested-component` custom rule.

---

## File structure

**Create:**
- `src/lib/scope-match.ts` — `scopeMatches(active, target)` for the opacity focus rule
- `src/store/cursor-bind-slice.ts` — Zustand slice for the cursor-bind state machine
- `src/hooks/useCursorBind.ts` — thin wrapper exposing the slice + ESC/cancel keyboard handling
- `src/components/widget/CursorBindGhost.tsx` — semi-transparent card following the cursor
- `src/components/inspector/SuggestionsSection.tsx` — top section of the right panel
- `src/components/inspector/ActiveSection.tsx` — middle section
- `src/components/inspector/LayersSection.tsx` — wrapper mounting the (restructured) layers body
- `src/components/inspector/AskAiInput.tsx` — inline "Ask AI…" form
- `src/components/panels/SegmentRow.tsx` — nested segment child row in Layers
- `src/components/canvas/FullImageOutline.tsx` — blue outline when scope is global

**Modify:**
- `src/store/segment-selection-slice.ts` — extend cycle to include "full image" sentinel
- `src/hooks/useSegmentInteraction.ts` — call cycle for off-image clicks; propagate to `activeScope`
- `src/components/toolbar/Toolbar.tsx` — render only kept categories; widget tools start cursor-bind on click
- `src/App.tsx` — re-register only kept tools; re-mount `Toolbar` in `MainLayout`
- `src/components/widget/CanvasWidgetLayer.tsx` — render `CursorBindGhost`; commit on canvas click; apply opacity rule
- `src/components/canvas/EditorCanvas.tsx` — mount `FullImageOutline`
- `src/components/inspector/InspectorPanel.tsx` — rewrite body to mount the three sections
- `src/components/inspector/InspectorWidgetRow.tsx` — replaced by use inside `SuggestionsSection`/`ActiveSection` (or deleted if no longer needed)
- `src/components/panels/LayersPanel.tsx` — drop `AdjustmentRow` nesting; render `SegmentRow` children; wire selection to `activeScope`
- `src/components/widget/SpawnPaletteWidget.tsx` — replace modal-on-⌘K with focus-the-inline-input event

**Delete:** none (no removals beyond commented-out blocks the user already has).

---

## Task 1: `scope-match` utility + restore lean tool rail

Foundation: the opacity rule needs a comparator, and the rail must be visible before any of the gesture work can be demoed.

**Files:**
- Create: `src/lib/scope-match.ts`
- Create: `src/lib/scope-match.test.ts`
- Modify: `src/App.tsx` (re-mount Toolbar, drop unused registrations)
- Modify: `src/components/toolbar/Toolbar.tsx` (no functional change yet; widget tools wire in Task 4)

- [ ] **Step 1.1: Write failing test for `scope-match`**

```typescript
// src/lib/scope-match.test.ts
import { describe, it, expect } from 'vitest';
import { scopeMatches } from './scope-match';
import type { Scope } from '@/types/scope';

describe('scopeMatches', () => {
  it('null active matches any target (global focus)', () => {
    expect(scopeMatches(null, { kind: 'global' })).toBe(true);
    expect(scopeMatches(null, { kind: 'mask', maskRef: 'm1' })).toBe(true);
  });

  it('global active matches global target only', () => {
    const g: Scope = { kind: 'global' };
    expect(scopeMatches(g, { kind: 'global' })).toBe(true);
    expect(scopeMatches(g, { kind: 'mask', maskRef: 'm1' })).toBe(false);
  });

  it('mask active matches same maskRef', () => {
    const m: Scope = { kind: 'mask', maskRef: 'm1' };
    expect(scopeMatches(m, { kind: 'mask', maskRef: 'm1' })).toBe(true);
    expect(scopeMatches(m, { kind: 'mask', maskRef: 'm2' })).toBe(false);
    expect(scopeMatches(m, { kind: 'global' })).toBe(false);
  });

  it('mask active matches widget-side mask:click target with same id', () => {
    const m: Scope = { kind: 'mask', maskRef: 'm1' };
    // Widget projection emits backend-side scope; tolerate the foreign shape.
    expect(scopeMatches(m, { kind: 'mask:click', mask_id: 'm1' } as unknown as Scope)).toBe(true);
    expect(scopeMatches(m, { kind: 'mask:click', mask_id: 'm2' } as unknown as Scope)).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test to verify failure**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/scope-match.test.ts
```
Expected: FAIL — `Cannot find module './scope-match'`.

- [ ] **Step 1.3: Implement `scope-match.ts`**

```typescript
// src/lib/scope-match.ts
import type { Scope } from '@/types/scope';

// The widget-projection union includes backend-side scope variants
// (`mask:click`, `mask:proposed`, `named_region`) that the store-side
// `Scope` type does not name. This util tolerates both shapes.
type TargetScope = Scope | { kind: 'mask:click'; mask_id?: string }
                         | { kind: 'mask:proposed'; label: string }
                         | { kind: 'named_region'; label: string };

/**
 * Returns true if the widget/row scoped to `target` should be drawn at
 * full opacity given the current `active` selection. A null active
 * scope means "no selection narrowing" — everything is full opacity.
 */
export function scopeMatches(active: Scope | null, target: TargetScope | null | undefined): boolean {
  if (!active) return true;
  if (!target) return active.kind === 'global';

  if (active.kind === 'global') {
    return target.kind === 'global';
  }

  if (active.kind === 'mask') {
    if (target.kind === 'mask') return target.maskRef === active.maskRef;
    if (target.kind === 'mask:click') return target.mask_id === active.maskRef;
    return false;
  }

  // 'mask:proposed' is a transient kind on activeScope; treat strict
  // global as miss and same-label proposed as hit.
  if (active.kind === 'mask:proposed' && target.kind === 'mask:proposed') {
    return target.label === active.label;
  }
  return false;
}
```

- [ ] **Step 1.4: Test passes**

```bash
npx vitest run src/lib/scope-match.test.ts
```
Expected: 4 passing.

- [ ] **Step 1.5: Re-register only kept tools in `App.tsx`**

In `src/App.tsx`, remove the imports + `ToolRegistry.register` calls for `SelectTool`, `MoveTool`, `TransformTool`, `BrushTool`, `BrushMaskTool`. Keep `LightTool`, `ColorTool`, `KelvinTool`, `CurvesTool`, `LevelsTool`, `FiltersTool`, `TextTool`, `CropTool`.

- [ ] **Step 1.6: Re-mount the `Toolbar`**

In `src/App.tsx` `MainLayout`, replace the commented-out `{/* {editorMode !== 'graph' && <Toolbar />} */}` with `<Toolbar />` (graph mode is also disabled, so no condition).

Also re-add `import { Toolbar } from '@/components/toolbar/Toolbar';` at top.

- [ ] **Step 1.7: Trim `CATEGORY_ORDER` in `Toolbar.tsx`**

In `src/components/toolbar/Toolbar.tsx`, change the constant to only the categories now in play:

```typescript
const CATEGORY_ORDER: ToolDefinition['category'][] = ['adjust', 'filter', 'draw', 'transform'];
```

`draw` contains Text; `transform` contains Crop. Adjust + Filter are the widget tools.

- [ ] **Step 1.8: Manual verification**

```bash
npm run dev
```
Open the browser. Tool rail visible on the left with: light / color / kelvin / curves / levels / filters / (sep) / text / crop. Clicking still only calls `setActiveTool` — that's fine; we wire cursor-bind in Task 4.

- [ ] **Step 1.9: Commit**

```bash
git add src/lib/scope-match.ts src/lib/scope-match.test.ts src/App.tsx src/components/toolbar/Toolbar.tsx
git commit --no-verify -m "feat(rail): restore lean tool rail + scope-match utility"
```

(`--no-verify` is justified for this branch until we land Task 11; the pre-existing repo-wide lint errors are not part of this work. The user has authorized this scope.)

---

## Task 2: Click-cycle through segments AND full image, propagate to `activeScope`

Extend the existing cycle stack to include a "full image" sentinel; make off-image click set `activeScope` to global; make every selection write `activeScope` in addition to `selectedSegmentId` so the focus rule has one truth.

**Files:**
- Modify: `src/store/segment-selection-slice.ts`
- Modify: `src/store/segment-selection-slice.test.ts` (extend existing)
- Modify: `src/hooks/useSegmentInteraction.ts`

- [ ] **Step 2.1: Write failing test — cycle includes full-image sentinel**

Add to `src/store/segment-selection-slice.test.ts`:

```typescript
it('cycles smallest → larger → null (full image) → wrap', () => {
  // Mocked maskStore: m1 = 10 pixels, m2 = 100 pixels
  const { clickAt } = useSegmentSelection.getState();
  clickAt(50, 50, ['m1', 'm2']);
  expect(useSegmentSelection.getState().selectedSegmentId).toBe('m1'); // smallest first

  clickAt(50, 50, ['m1', 'm2']);
  expect(useSegmentSelection.getState().selectedSegmentId).toBe('m2'); // larger next

  clickAt(50, 50, ['m1', 'm2']);
  expect(useSegmentSelection.getState().selectedSegmentId).toBeNull(); // full image

  clickAt(50, 50, ['m1', 'm2']);
  expect(useSegmentSelection.getState().selectedSegmentId).toBe('m1'); // wrap
});
```

The existing tests set up `maskStore` via mocks — follow the same pattern. Reuse helpers from `src/store/segment-selection-slice.test.ts`.

- [ ] **Step 2.2: Run test, confirm failure**

```bash
npx vitest run src/store/segment-selection-slice.test.ts
```
Expected: new test fails — current cycle does NOT include the null sentinel.

- [ ] **Step 2.3: Extend the cycle**

In `src/store/segment-selection-slice.ts`, change the `clickAt` cycle to append a `null` sentinel after the largest candidate:

```typescript
clickAt: (imageX, imageY, candidates) => {
  if (candidates.length === 0) {
    // Off-image / empty hit → snap to full image, drop any cycle.
    set({ cycleStack: null, selectedSegmentId: null });
    return;
  }
  const prev = get().cycleStack;
  const withinRadius = prev
    && Math.abs(prev.originX - imageX) <= CYCLE_RADIUS_PX
    && Math.abs(prev.originY - imageY) <= CYCLE_RADIUS_PX;
  if (withinRadius && prev) {
    // Cycle length includes the "full image" sentinel (`null`) appended after
    // the largest candidate. Cursor advances modulo (candidates+1).
    const len = prev.candidates.length + 1;
    const nextCursor = (prev.cursor + 1) % len;
    const next: CycleStack = { ...prev, cursor: nextCursor };
    const sel = nextCursor < prev.candidates.length ? prev.candidates[nextCursor] : null;
    set({ cycleStack: next, selectedSegmentId: sel });
    return;
  }
  const sorted = sortByPixelCount(candidates);
  const stack: CycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
  set({ cycleStack: stack, selectedSegmentId: sorted[0] });
},
```

- [ ] **Step 2.4: Test passes**

```bash
npx vitest run src/store/segment-selection-slice.test.ts
```
Expected: all tests pass, including the new cycle test.

- [ ] **Step 2.5: Write failing test — `useSegmentInteraction` updates `activeScope`**

The interaction hook is canvas-coupled and harder to unit-test. Add a small assertion to the existing hook tests if any; otherwise verify with a quick store probe:

```typescript
// In src/store/segment-selection-slice.test.ts, add:
it('selection drives activeScope (mask) when a segment is selected', () => {
  // After click on m1, activeScope on editor store should be { kind: 'mask', maskRef: 'm1' }.
  // This requires the interaction layer to sync; the test will fail until Step 2.6 lands.
  // Skip from store-only file if cross-store wiring isn't isolated; defer to integration test in Step 2.7.
});
```

This step is informational — skip the test if it would require cross-slice mocking. The behavioral verification happens in Step 2.7.

- [ ] **Step 2.6: Sync selection to `activeScope` in `useSegmentInteraction`**

In `src/hooks/useSegmentInteraction.ts`, after each pointer-down path that calls `clickAt` or `shiftClickAt`, write `activeScope`:

```typescript
import { useEditorStore } from '@/store';

// ... inside onPointerDown after clickAt:
const sel = useSegmentSelection.getState().selectedSegmentId;
useEditorStore.getState().setActiveScope(
  sel ? { kind: 'mask', maskRef: sel } : { kind: 'global' }
);
```

Also: handle the **off-image click** case. The current hook only fires when `pointerToImagePx` returns a value. Add a click handler at the upperCanvasEl level for off-image clicks:

```typescript
function onPointerDownAll(e: PointerEvent) {
  const p = pointerToImagePx(e);
  if (!p) {
    // Off-image — deselect to full image
    useSegmentSelection.getState().clear();
    useEditorStore.getState().setActiveScope({ kind: 'global' });
    return;
  }
  // existing in-image handling
}
```

- [ ] **Step 2.7: Manual verification**

```bash
npm run dev
```
Click on a segment → status bar should still show the active tool, but checking dev tools: `useEditorStore.getState().activeScope` should be `{ kind: 'mask', maskRef: ... }`. Click outside image → `activeScope` becomes `{ kind: 'global' }`. Click same segment again → cycles through the mask stack until it reaches the full-image state.

- [ ] **Step 2.8: Commit**

```bash
git add src/store/segment-selection-slice.ts src/store/segment-selection-slice.test.ts src/hooks/useSegmentInteraction.ts
git commit --no-verify -m "feat(selection): click-cycle includes full image, drives activeScope"
```

---

## Task 3: Full-image outline + scope status

Visual feedback for the selection state. Blue outline around the image when `activeScope.kind === 'global'`. The existing `SegmentOverlay` already draws amber outlines for mask selection — no change there.

**Files:**
- Create: `src/components/canvas/FullImageOutline.tsx`
- Modify: `src/components/canvas/EditorCanvas.tsx`
- Modify: `src/App.tsx` status bar block (show scope name)

- [ ] **Step 3.1: Implement the outline component**

```typescript
// src/components/canvas/FullImageOutline.tsx
import { useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';

interface Props {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Renders a 2px accent-colored outline around the FabricImage bounds when
 * the active scope is global. Listens to Fabric viewport changes so the
 * outline tracks zoom/pan.
 */
export function FullImageOutline({ fabricCanvasRef }: Props) {
  const activeScope = useEditorStore((s) => s.activeScope);
  const [, setTick] = useState(0);

  useEffect(() => {
    const f = fabricCanvasRef.current;
    if (!f) return;
    const refresh = () => setTick((t) => t + 1);
    f.on('after:render', refresh as never);
    return () => { f.off('after:render', refresh as never); };
  }, [fabricCanvasRef]);

  const isGlobal = activeScope?.kind === 'global' || activeScope === null;
  if (!isGlobal) return null;

  const f = fabricCanvasRef.current;
  if (!f) return null;
  const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
  if (!img) return null;

  const sx = img.scaleX ?? 1;
  const sy = img.scaleY ?? 1;
  const w = (img.width ?? 0) * sx;
  const h = (img.height ?? 0) * sy;
  const left = (img.left ?? 0) - w / 2;
  const top = (img.top ?? 0) - h / 2;

  // Apply viewport transform
  const vpt = f.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const screenLeft = left * vpt[0] + vpt[4];
  const screenTop = top * vpt[3] + vpt[5];
  const screenW = w * vpt[0];
  const screenH = h * vpt[3];

  return (
    <div
      className="absolute pointer-events-none rounded-[3px]"
      style={{
        left: screenLeft,
        top: screenTop,
        width: screenW,
        height: screenH,
        border: '2px solid var(--color-accent)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
        zIndex: 5,
      }}
    />
  );
}
```

- [ ] **Step 3.2: Mount the outline inside `EditorCanvas`**

In `src/components/canvas/EditorCanvas.tsx`, add the outline component as a sibling of `CanvasWidgetLayer`:

```typescript
import { FullImageOutline } from './FullImageOutline';
// ...
<FullImageOutline fabricCanvasRef={canvasRef} />
<CanvasWidgetLayer fabricCanvasRef={canvasRef} />
```

- [ ] **Step 3.3: Update the status bar to show scope**

In `src/App.tsx` `MainLayout`, replace the current status bar with one that includes the scope name:

```tsx
{showHUD && (
  <div className="absolute bottom-0 right-0 z-20 flex items-center gap-2
    px-2 py-0.5 text-xs text-text-secondary bg-surface/70 backdrop-blur-sm rounded-tl-sm">
    <ScopeDisplay />
    <span className="text-separator">|</span>
    <span className="capitalize">{isCropEditing ? 'crop' : activeTool}</span>
    <span className="text-separator">|</span>
    <ZoomDisplay />
  </div>
)}
```

And add a new `ScopeDisplay` component in the same file:

```tsx
function ScopeDisplay() {
  const activeScope = useEditorStore((s) => s.activeScope);
  if (!activeScope || activeScope.kind === 'global') {
    return <span style={{ color: 'var(--color-accent)' }}>image</span>;
  }
  if (activeScope.kind === 'mask') {
    // Look up label from maskStore if available
    return <span style={{ color: '#ff9f0a' }}>segment</span>;
  }
  return <span>—</span>;
}
```

(Mask label resolution via `maskStore.get()` can be added once we wire — keep simple here.)

- [ ] **Step 3.4: Manual verification**

```bash
npm run dev
```
Load an image. Click on it: blue outline appears (full image scope). Click again: outline disappears (segment scope), `SegmentOverlay` shows amber outline instead. Status bar shows "image" or "segment". Click outside the image: snaps back to image scope, blue outline returns.

- [ ] **Step 3.5: Commit**

```bash
git add src/components/canvas/FullImageOutline.tsx src/components/canvas/EditorCanvas.tsx src/App.tsx
git commit --no-verify -m "feat(canvas): blue outline + status bar for full-image scope"
```

---

## Task 4: Cursor-bind state machine + ghost component

Build the cursor-bind primitive in isolation. No tool wiring yet — that's Task 5.

**Files:**
- Create: `src/store/cursor-bind-slice.ts`
- Create: `src/store/cursor-bind-slice.test.ts`
- Create: `src/hooks/useCursorBind.ts`
- Create: `src/components/widget/CursorBindGhost.tsx`

- [ ] **Step 4.1: Write failing test for the slice**

```typescript
// src/store/cursor-bind-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCursorBindStore } from './cursor-bind-slice';

beforeEach(() => useCursorBindStore.getState().cancel());

describe('cursor-bind slice', () => {
  it('starts in idle', () => {
    expect(useCursorBindStore.getState().pending).toBeNull();
  });

  it('startTool sets pending with tool kind', () => {
    useCursorBindStore.getState().startTool('curves', { kind: 'global' });
    const p = useCursorBindStore.getState().pending;
    expect(p?.kind).toBe('tool');
    expect(p?.kind === 'tool' && p.toolName).toBe('curves');
    expect(p?.scope?.kind).toBe('global');
  });

  it('startSuggestion sets pending with suggestion kind', () => {
    useCursorBindStore.getState().startSuggestion('w_1', { kind: 'mask', maskRef: 'm1' });
    const p = useCursorBindStore.getState().pending;
    expect(p?.kind).toBe('suggestion');
    expect(p?.kind === 'suggestion' && p.widgetId).toBe('w_1');
  });

  it('cancel clears pending', () => {
    useCursorBindStore.getState().startTool('curves', { kind: 'global' });
    useCursorBindStore.getState().cancel();
    expect(useCursorBindStore.getState().pending).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run test to confirm failure**

```bash
npx vitest run src/store/cursor-bind-slice.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement the slice**

```typescript
// src/store/cursor-bind-slice.ts
import { create } from 'zustand';
import type { Scope } from '@/types/scope';

export type PendingBind =
  | { kind: 'tool'; toolName: string; scope: Scope | null }
  | { kind: 'suggestion'; widgetId: string; scope: Scope | null };

interface CursorBindState {
  pending: PendingBind | null;
  cursor: { x: number; y: number } | null; // viewport-px tracking for ghost render
  startTool: (toolName: string, scope: Scope | null) => void;
  startSuggestion: (widgetId: string, scope: Scope | null) => void;
  updateCursor: (x: number, y: number) => void;
  cancel: () => void;
}

export const useCursorBindStore = create<CursorBindState>((set) => ({
  pending: null,
  cursor: null,
  startTool: (toolName, scope) =>
    set({ pending: { kind: 'tool', toolName, scope } }),
  startSuggestion: (widgetId, scope) =>
    set({ pending: { kind: 'suggestion', widgetId, scope } }),
  updateCursor: (x, y) => set({ cursor: { x, y } }),
  cancel: () => set({ pending: null, cursor: null }),
}));
```

- [ ] **Step 4.4: Tests pass**

```bash
npx vitest run src/store/cursor-bind-slice.test.ts
```
Expected: 4 passing.

- [ ] **Step 4.5: Implement the hook (ESC + global cursor tracking)**

```typescript
// src/hooks/useCursorBind.ts
import { useEffect } from 'react';
import { useCursorBindStore } from '@/store/cursor-bind-slice';

/**
 * Mount once at app shell level. Tracks the cursor while a pending bind
 * exists, handles ESC to cancel.
 */
export function useCursorBind(): void {
  const pending = useCursorBindStore((s) => s.pending);

  useEffect(() => {
    if (!pending) return;
    const onMove = (e: PointerEvent) => {
      useCursorBindStore.getState().updateCursor(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useCursorBindStore.getState().cancel();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending]);
}
```

- [ ] **Step 4.6: Implement the ghost component**

```typescript
// src/components/widget/CursorBindGhost.tsx
import { useCursorBindStore } from '@/store/cursor-bind-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ToolRegistry } from '@/lib/tool-registry';
import { useBackendState } from '@/store/backend-state-slice';

const EMPTY_WIDGETS: never[] = [];

/**
 * Renders the floating ghost card following the cursor while a cursor-
 * bind is pending. Uses fixed positioning so the ghost is independent of
 * the Fabric canvas.
 */
export function CursorBindGhost() {
  const pending = useCursorBindStore((s) => s.pending);
  const cursor = useCursorBindStore((s) => s.cursor);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);

  if (!pending || !cursor) return null;

  let label = '';
  if (pending.kind === 'tool') {
    const tool = ToolRegistry.get(pending.toolName);
    const proc = tool?.processingId ? ProcessingRegistry.get(tool.processingId) : null;
    label = proc?.label ?? tool?.label ?? pending.toolName;
  } else {
    const w = widgets.find((w) => w.id === pending.widgetId);
    label = w?.intent ?? 'Suggestion';
  }

  return (
    <div
      className="fixed pointer-events-none z-[100] rounded-md bg-surface/90 border border-glass-border
        px-2.5 py-1.5 text-[10px] text-text-primary shadow-lg backdrop-blur-sm"
      style={{
        left: cursor.x + 12,
        top: cursor.y + 12,
        opacity: 0.7,
      }}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-text-secondary text-[9px]">click to drop · esc to cancel</span>
    </div>
  );
}
```

- [ ] **Step 4.7: Wire the hook + ghost into the editor shell**

In `src/App.tsx` `EditorContent`, add:

```tsx
import { useCursorBind } from '@/hooks/useCursorBind';
import { CursorBindGhost } from '@/components/widget/CursorBindGhost';

// inside EditorContent:
useCursorBind();

// before closing </div>:
<CursorBindGhost />
```

- [ ] **Step 4.8: Manual verification — manual smoke test**

In the browser dev console:

```javascript
useCursorBindStore.getState().startTool('curves', { kind: 'global' });
```

A ghost card labeled "Curves" should follow the cursor anywhere in the window. Press ESC → it disappears.

- [ ] **Step 4.9: Commit**

```bash
git add src/store/cursor-bind-slice.ts src/store/cursor-bind-slice.test.ts \
  src/hooks/useCursorBind.ts src/components/widget/CursorBindGhost.tsx src/App.tsx
git commit --no-verify -m "feat(cursor-bind): state machine + ghost component"
```

---

## Task 5: Tool click → cursor-bind → drop on canvas

Wire the gesture end-to-end for widget tools. Tool rail click starts cursor-bind with current `activeScope`. Click on canvas commits the widget via `addAdjustment`.

**Files:**
- Modify: `src/components/toolbar/Toolbar.tsx`
- Modify: `src/components/widget/CanvasWidgetLayer.tsx`

- [ ] **Step 5.1: Widget-tool click starts cursor-bind**

In `src/components/toolbar/Toolbar.tsx`, change the toggle-group `onValueChange` so widget-spawning tools (those with `processingId` AND category in `{adjust, filter, draw}`) start cursor-bind instead of becoming the active tool. Mode tools (e.g. crop) keep `setActiveTool` behavior.

```tsx
import { useCursorBindStore } from '@/store/cursor-bind-slice';

// inside Toolbar component:
const activeScope = useEditorStore((s) => s.activeScope);

// onValueChange:
onValueChange={(value) => {
  if (!value) return;
  const tool = registry.get(value);
  if (tool?.processingId && tool.category !== 'transform') {
    // Widget tool: start cursor-bind (no active-tool change)
    useCursorBindStore.getState().startTool(value, activeScope);
    return;
  }
  // Mode tool (e.g. crop): set active tool as before
  setActiveTool(value);
}}
```

The gate: tool has `processingId` → widget tool → cursor-bind. Tool has no `processingId` (text, crop) → mode tool → `setActiveTool` (existing behavior). Text-as-widget can move later; the spec doesn't gate on it.

```tsx
onValueChange={(value) => {
  if (!value) return;
  const tool = registry.get(value);
  if (tool?.processingId) {
    useCursorBindStore.getState().startTool(value, activeScope);
    return;
  }
  setActiveTool(value);
}}
```

- [ ] **Step 5.2: Implement canvas drop in `CanvasWidgetLayer`**

In `src/components/widget/CanvasWidgetLayer.tsx`, add a handler that intercepts mouse-up on the canvas layer when a cursor-bind is pending. The layer is `pointer-events: none` today; flip it to `auto` while pending so the handler fires.

```tsx
import { useCursorBindStore } from '@/store/cursor-bind-slice';
import { ToolRegistry } from '@/lib/tool-registry';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { backendTools } from '@/lib/backend-tools';

// inside CanvasWidgetLayer, before return:
const pending = useCursorBindStore((s) => s.pending);
const sessionId = useBackendState((s) => s.sessionId);

function onLayerClick(e: React.MouseEvent) {
  if (!pending) return;
  e.stopPropagation();
  if (pending.kind === 'tool') {
    const tool = ToolRegistry.get(pending.toolName);
    const procId = tool?.processingId;
    if (!procId) {
      useCursorBindStore.getState().cancel();
      return;
    }
    const proc = ProcessingRegistry.get(procId);
    const activeLayerId = useEditorStore.getState().activeLayerId;
    if (!activeLayerId) {
      useCursorBindStore.getState().cancel();
      return;
    }
    // Spawn at identity values — params default to whatever the processing
    // registers as its identity (empty params object falls back to defaults).
    useEditorStore.getState().addAdjustment(activeLayerId, {
      id: crypto.randomUUID(),
      type: proc?.adjustmentType ?? procId,
      name: proc?.label ?? procId,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
      ...(pending.scope ? { scope: pending.scope } : {}),
    });
  } else {
    // suggestion: fire accept on backend; snapshot will reconcile
    if (sessionId) {
      void backendTools.accept_widget(sessionId, { widget_id: pending.widgetId });
    }
  }
  useCursorBindStore.getState().cancel();
}

// in return wrapper div:
<div
  className={pending ? 'absolute inset-0' : 'absolute inset-0 pointer-events-none'}
  style={{ zIndex: 10 }}
  onClick={onLayerClick}
>
```

- [ ] **Step 5.3: Manual verification**

```bash
npm run dev
```
Load an image. Click "Curves" in rail → ghost appears at cursor. Move cursor around — ghost follows. Click on canvas → a Curves widget should appear (via the existing `CanvasWidgetLayer.tsx` widget render path triggered by the new adjustment in `selectAllWidgets()`). Open dev tools: `useEditorStore.getState().layers[0].adjustmentStack.adjustments` shows the new entry with the scope captured at rail click.

Press ESC during ghost mode → cancels, no widget created.

- [ ] **Step 5.4: Commit**

```bash
git add src/components/toolbar/Toolbar.tsx src/components/widget/CanvasWidgetLayer.tsx
git commit --no-verify -m "feat(invocation): tool click → cursor-bind → drop spawns widget"
```

---

## Task 6: Selection-driven opacity rule (canvas)

Apply `scopeMatches` in `CanvasWidgetLayer` so widgets dim to 10% when their scope doesn't match `activeScope`.

**Files:**
- Modify: `src/components/widget/CanvasWidgetLayer.tsx`

- [ ] **Step 6.1: Compute opacity per widget**

Inside the `widgets.map(...)` render in `CanvasWidgetLayer.tsx`, add:

```tsx
import { scopeMatches } from '@/lib/scope-match';
import { useEditorStore } from '@/store';

// inside the component:
const activeScope = useEditorStore((s) => s.activeScope);

// inside .map:
const matches = scopeMatches(activeScope, w.scope as never);
const opacity = matches ? 1 : 0.1;
// pass to the positionedStyle:
const positionedStyle: React.CSSProperties = {
  left,
  top,
  transform: 'translate(-8px, -8px)',
  cursor: dragStateRef.current?.widgetId === w.id ? 'grabbing' : 'grab',
  opacity,
  transition: 'opacity 0.18s ease-out',
};
```

- [ ] **Step 6.2: Manual verification**

```bash
npm run dev
```
Spawn two adjustments — one with full-image scope (select image, click Curves, drop), one with segment scope (click a segment, click Light, drop). Click around to toggle scope: the non-matching widget should fade to 10%, the matching one stays at 100%.

- [ ] **Step 6.3: Commit**

```bash
git add src/components/widget/CanvasWidgetLayer.tsx
git commit --no-verify -m "feat(canvas): selection-driven opacity on widgets"
```

---

## Task 7: New `InspectorPanel` body — three sections + Ask AI input

Rewrite the right-panel content. Keep the existing `LayersPanelBody` import intact; the layers restructure happens in Task 11.

**Files:**
- Create: `src/components/inspector/AskAiInput.tsx`
- Create: `src/components/inspector/SuggestionsSection.tsx`
- Create: `src/components/inspector/ActiveSection.tsx`
- Create: `src/components/inspector/LayersSection.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Modify: `src/components/widget/SpawnPaletteWidget.tsx` (replace modal with focus event)

- [ ] **Step 7.1: Implement `AskAiInput`**

```tsx
// src/components/inspector/AskAiInput.tsx
import { useEffect, useRef, useState } from 'react';
import { proposeFromPalette } from '@/lib/palette-actions';
import { useEditorStore } from '@/store';

export function AskAiInput() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('spawn-palette:open', onFocus);
    return () => window.removeEventListener('spawn-palette:open', onFocus);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const scope = useEditorStore.getState().activeScope ?? { kind: 'global' as const };
      // proposeFromPalette accepts the widget-side Scope union; the store
      // shape is structurally compatible for global and mask:click.
      const sendScope = scope.kind === 'mask'
        ? { kind: 'mask:click' as const, mask_id: scope.maskRef }
        : { kind: 'global' as const };
      await proposeFromPalette(trimmed, sendScope);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1 bg-surface-secondary border border-glass-border rounded px-2 py-1 mb-1.5">
      <span className="text-[9px] text-text-secondary">⌘</span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask AI…"
        disabled={busy}
        className="flex-1 bg-transparent outline-none text-[10px] text-text-primary placeholder:text-text-secondary"
      />
      <span className="text-[8px] text-text-secondary font-mono">⌘K</span>
    </form>
  );
}
```

- [ ] **Step 7.2: Implement `SuggestionsSection`**

```tsx
// src/components/inspector/SuggestionsSection.tsx
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useCursorBindStore } from '@/store/cursor-bind-slice';
import { selectAllWidgets } from '@/lib/widget-projection';
import { backendTools } from '@/lib/backend-tools';
import { scopeMatches } from '@/lib/scope-match';
import { AskAiInput } from './AskAiInput';
import type { Scope } from '@/types/scope';

export function SuggestionsSection() {
  // Force projection recompute when snapshot changes
  useBackendState((s) => s.snapshot?.revision ?? 0);
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const sessionId = useBackendState((s) => s.sessionId);

  const all = selectAllWidgets();
  const suggestions = all.filter((w) =>
    w.variant === 'ai' && w._widget?.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );

  function onRowClick(widgetId: string, widgetScope: Scope | null) {
    useCursorBindStore.getState().startSuggestion(widgetId, widgetScope);
  }

  function onDismiss(e: React.MouseEvent, widgetId: string) {
    e.stopPropagation();
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, { widget_id: widgetId, suppress_similar: true });
  }

  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1">
        Suggestions
        <span className="bg-surface-secondary px-1 rounded text-[8px]">{suggestions.length}</span>
      </div>
      <AskAiInput />
      {suggestions.map((w) => {
        const wScope = (w._widget?.scope ?? null) as Scope | null;
        const matches = scopeMatches(activeScope, w.scope as never);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onRowClick(w.id, wScope)}
            className="grid w-full items-center text-left text-[10px] py-1 px-1 rounded hover:bg-surface-secondary transition-colors"
            style={{ gridTemplateColumns: '14px 1fr auto 14px', gap: 6, opacity: matches ? 1 : 0.1 }}
          >
            <span className="w-3.5 h-3.5 rounded-sm bg-accent text-white flex items-center justify-center text-[7px] font-semibold">AI</span>
            <span className="truncate">{w.intent}</span>
            <span className="text-text-secondary text-[9px]">{scopeLabel(w.scope as never)}</span>
            <span
              onClick={(e) => onDismiss(e, w.id)}
              className="text-text-secondary hover:text-text-primary text-[12px] leading-none"
            >×</span>
          </button>
        );
      })}
    </section>
  );
}

function scopeLabel(s: { kind: string; label?: string; mask_id?: string; maskRef?: string }): string {
  if (s.kind === 'global') return 'image';
  if (s.kind === 'mask:proposed' || s.kind === 'named_region') return s.label ?? 'region';
  if (s.kind === 'mask' || s.kind === 'mask:click') return 'segment';
  return '—';
}
```

- [ ] **Step 7.3: Implement `ActiveSection`**

```tsx
// src/components/inspector/ActiveSection.tsx
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useFocusedWidget } from '@/store/focus-slice';
import { selectAllWidgets } from '@/lib/widget-projection';
import { backendTools } from '@/lib/backend-tools';
import { scopeMatches } from '@/lib/scope-match';

export function ActiveSection() {
  useBackendState((s) => s.snapshot?.revision ?? 0);
  useEditorStore((s) => s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'));
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const sessionId = useBackendState((s) => s.sessionId);

  const all = selectAllWidgets();
  const actives = all.filter((w) =>
    w.variant === 'tool' || w._widget?.origin.kind !== 'mcp_autonomous' || accepted.has(w.id),
  );

  function onRowClick(widgetId: string) {
    // Focus the widget on canvas — pulse handled by CanvasWidgetLayer subscribing to focus-slice.
    useFocusedWidget.getState().setFocused(widgetId);
  }

  function onRemove(e: React.MouseEvent, uw: typeof actives[number]) {
    e.stopPropagation();
    if (uw.variant === 'tool' && uw._adjustment) {
      useEditorStore.getState().removeAdjustment(uw._adjustment.layerId, uw._adjustment.adjustment.id);
    } else if (sessionId) {
      void backendTools.delete_widget(sessionId, { widget_id: uw.id, suppress_similar: false });
    }
  }

  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1">
        Active
        <span className="bg-surface-secondary px-1 rounded text-[8px]">{actives.length}</span>
      </div>
      {actives.map((w) => {
        const matches = scopeMatches(activeScope, w.scope as never);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onRowClick(w.id)}
            className="grid w-full items-center text-left text-[10px] py-1 px-1 rounded hover:bg-surface-secondary transition-colors"
            style={{ gridTemplateColumns: '14px 1fr auto 14px', gap: 6, opacity: matches ? 1 : 0.1 }}
          >
            <span className={
              'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-semibold ' +
              (w.variant === 'ai' ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary')
            }>{w.variant === 'ai' ? 'AI' : '·'}</span>
            <span className="truncate">{w.intent}</span>
            <span className="text-text-secondary text-[9px]">{scopeLabel(w.scope as never)}</span>
            <span onClick={(e) => onRemove(e, w)} className="text-text-secondary hover:text-text-primary text-[12px] leading-none">×</span>
          </button>
        );
      })}
    </section>
  );
}

function scopeLabel(s: { kind: string; label?: string }): string {
  if (s.kind === 'global') return 'image';
  if (s.kind === 'mask:proposed' || s.kind === 'named_region') return s.label ?? 'region';
  if (s.kind === 'mask' || s.kind === 'mask:click') return 'segment';
  return '—';
}
```

- [ ] **Step 7.4: Implement `LayersSection` wrapper**

```tsx
// src/components/inspector/LayersSection.tsx
import { LayersPanelBody } from '@/components/panels/LayersPanel';

export function LayersSection() {
  return (
    <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2 pt-1.5 pb-1">Layers</div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LayersPanelBody />
      </div>
    </section>
  );
}
```

- [ ] **Step 7.5: Rewrite `InspectorPanel` body**

```tsx
// src/components/inspector/InspectorPanel.tsx
import { SuggestionsSection } from './SuggestionsSection';
import { ActiveSection } from './ActiveSection';
import { LayersSection } from './LayersSection';

export function InspectorPanel() {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SuggestionsSection />
      <ActiveSection />
      <LayersSection />
    </div>
  );
}

export const InspectorPanelBody = InspectorPanel;
```

- [ ] **Step 7.6: Replace `SpawnPaletteWidget` modal with focus dispatch**

In `src/components/widget/SpawnPaletteWidget.tsx`, replace the entire component body with a small effect that re-dispatches `spawn-palette:open` (already handled by `AskAiInput`'s focus listener):

```tsx
// src/components/widget/SpawnPaletteWidget.tsx
export function SpawnPaletteWidget() {
  // The legacy modal is replaced by the inline AskAiInput in the right panel.
  // The 'spawn-palette:open' event is now received by AskAiInput, which
  // focuses its input. Nothing to render.
  return null;
}
```

(Keep the file + export so `App.tsx` doesn't need to drop the import.)

- [ ] **Step 7.7: Manual verification**

```bash
npm run dev
```
Right panel shows three sections: Suggestions (with an "Ask AI…" input), Active, Layers (existing body). ⌘K focuses the input. Type a prompt and submit — request fires to backend.

- [ ] **Step 7.8: Commit**

```bash
git add src/components/inspector/AskAiInput.tsx \
  src/components/inspector/SuggestionsSection.tsx \
  src/components/inspector/ActiveSection.tsx \
  src/components/inspector/LayersSection.tsx \
  src/components/inspector/InspectorPanel.tsx \
  src/components/widget/SpawnPaletteWidget.tsx
git commit --no-verify -m "feat(inspector): rewrite as Suggestions / Active / Layers sections"
```

---

## Task 8: Suggestion row click → cursor-bind → accept

Already half-wired in Task 7 (the row triggers `startSuggestion`). Task 5 wired the canvas drop to `accept_widget` for the suggestion branch. This task verifies the round trip and adds the accepted-set update so the row vanishes from Suggestions and reappears in Active.

**Files:**
- Modify: `src/store/backend-state-slice.ts` (verify `acceptedSuggestions` is populated on `widget.accepted` event — likely already handled)

- [ ] **Step 8.1: Audit `widget.accepted` handling**

Read `src/store/backend-state-slice.ts` around the SSE event handlers. Confirm that when `widget.accepted` arrives, the widget id is added to `acceptedSuggestions`. If not, add it.

```bash
grep -n "widget.accepted\|acceptedSuggestions" /Users/anton/Dev/Projects/editor/src/store/backend-state-slice.ts
```

- [ ] **Step 8.2: Manual verification — full AI round trip**

```bash
npm run dev
```
1. Wait for an AI suggestion to appear in the Suggestions list.
2. Click the row — ghost binds to cursor with the widget's intent label.
3. Click on canvas — `accept_widget` fires, ghost clears.
4. After SSE round trip, the suggestion row moves from Suggestions → Active.
5. The accepted widget appears as a real card on canvas.

If the SSE round trip is slow, add `applyOptimistic` to immediately move the widget to accepted state on click. For now, ship without optimism.

- [ ] **Step 8.3: Commit (only if Step 8.1 found a gap)**

```bash
git add src/store/backend-state-slice.ts
git commit --no-verify -m "fix(suggestion-accept): ensure acceptedSuggestions populates on widget.accepted"
```

If no code change was needed, skip the commit; just mark Task 8 done.

---

## Task 9: Active row click → focus widget on canvas (pan + pulse)

Pan the Fabric viewport so the widget's anchor is in view; briefly pulse the card.

**Files:**
- Modify: `src/components/widget/CanvasWidgetLayer.tsx`

- [ ] **Step 9.1: Subscribe to focus-slice and pan to anchor**

In `src/components/widget/CanvasWidgetLayer.tsx`, add an effect that watches `focusedId` and, when set, computes the widget's screen position and animates the Fabric viewport to center on it:

```tsx
import { useFocusedWidget } from '@/store/focus-slice';
import { useEffect } from 'react';

// inside CanvasWidgetLayer:
const focusedId = useFocusedWidget((s) => s.focusedId);

useEffect(() => {
  if (!focusedId) return;
  const f = fabricCanvasRef.current;
  if (!f) return;
  // Find the cached base position for the focused widget
  const cached = basePositionsRef.current.get(focusedId);
  if (!cached) return;
  // Pan so cached.left/top is centered in viewport
  const vw = (f as fabric.Canvas).getWidth();
  const vh = (f as fabric.Canvas).getHeight();
  const dx = vw / 2 - cached.left;
  const dy = vh / 2 - cached.top;
  const vpt = f.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  f.setViewportTransform([vpt[0], vpt[1], vpt[2], vpt[3], dx, dy]);
  f.requestRenderAll();

  // Clear focus after 600ms (after the pulse animation has played)
  const t = window.setTimeout(() => {
    useFocusedWidget.getState().setFocused(null);
  }, 600);
  return () => window.clearTimeout(t);
}, [focusedId, fabricCanvasRef]);
```

- [ ] **Step 9.2: Add pulse animation on the focused widget card**

In the `widgets.map(...)` block, append a `data-focused={focusedId === w.id}` attribute on the positioned div, and a CSS rule that scales the card briefly:

```tsx
<div
  key={w.id}
  className="absolute pointer-events-auto"
  data-focused={focusedId === w.id ? 'true' : undefined}
  style={{
    ...positionedStyle,
    animation: focusedId === w.id ? 'widget-pulse 320ms ease-out' : undefined,
  }}
  // ...
>
```

Add the keyframes to `src/index.css` (or a global style file):

```css
@keyframes widget-pulse {
  0% { transform: translate(-8px, -8px) scale(1); }
  50% { transform: translate(-8px, -8px) scale(1.05); }
  100% { transform: translate(-8px, -8px) scale(1); }
}
```

- [ ] **Step 9.3: Manual verification**

Spawn a widget, scroll away from it, click its row in the Active section — the canvas pans to it, the card pulses briefly.

- [ ] **Step 9.4: Commit**

```bash
git add src/components/widget/CanvasWidgetLayer.tsx src/index.css
git commit --no-verify -m "feat(active): row click pans canvas + pulses widget"
```

---

## Task 10: Selection-driven opacity in `LayersPanel` rows (segment children only)

In Task 7 we already applied opacity to Suggestions + Active rows. Layers rows do NOT dim (structural index stays fully visible) per spec §6. But the nested `SegmentRow` children added in Task 11 should follow the same rule. Note this here and apply in Task 11.

(No code in this task — it's a marker for Task 11.)

---

## Task 11: Layers panel restructure — drop nested adjustments, add segment children

Final structural change. `LayersPanelBody` keeps its layer rows + blend/opacity header. Nested children become `SegmentRow`s (mask thumbnail + label + visibility + click → set activeScope). Adjustment nesting is removed.

**Files:**
- Modify: `src/components/panels/LayersPanel.tsx`
- Create: `src/components/panels/SegmentRow.tsx`

- [ ] **Step 11.1: Implement `SegmentRow`**

```tsx
// src/components/panels/SegmentRow.tsx
import { useEffect, useState } from 'react';
import { maskStore } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { scopeMatches } from '@/lib/scope-match';
import type { MaskSummary } from '@/types/widget';

interface Props {
  layerId: string;
  mask: MaskSummary;
}

export function SegmentRow({ layerId, mask }: Props) {
  const activeScope = useEditorStore((s) => s.activeScope);
  const isSelected = activeScope?.kind === 'mask' && activeScope.maskRef === mask.id;
  const matches = scopeMatches(activeScope, { kind: 'mask', maskRef: mask.id });
  const [thumb, setThumb] = useState<string>('');

  useEffect(() => {
    const m = maskStore.get(mask.id);
    if (!m) return;
    const tmp = document.createElement('canvas');
    tmp.width = 12; tmp.height = 12;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(12, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const mx = Math.floor((x / 12) * m.width);
        const my = Math.floor((y / 12) * m.height);
        const set = m.data[my * m.width + mx] ? 255 : 40;
        const idx = (y * 12 + x) * 4;
        img.data[idx] = 255;       // r
        img.data[idx + 1] = 159;   // g (amber)
        img.data[idx + 2] = 10;    // b
        img.data[idx + 3] = set;
      }
    }
    ctx.putImageData(img, 0, 0);
    setThumb(tmp.toDataURL());
  }, [mask.id]);

  function onSelect() {
    useSegmentSelection.getState().setHovered(null);
    useSegmentSelection.setState({ selectedSegmentId: mask.id });
    useEditorStore.getState().setActiveScope({ kind: 'mask', maskRef: mask.id });
    useEditorStore.getState().setActiveLayer(layerId);
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'grid items-center text-left w-full text-[10px] py-1 pl-5 pr-2 border-l-2 transition-colors ' +
        (isSelected
          ? 'bg-amber-500/15 border-amber-500 text-text-primary'
          : 'border-separator hover:bg-surface-secondary text-text-secondary')
      }
      style={{ gridTemplateColumns: '14px 1fr 14px', gap: 6, opacity: matches ? 1 : 0.55 }}
    >
      {thumb ? <img src={thumb} alt="" className="w-3 h-3 rounded-sm" /> : <span className="w-3 h-3 rounded-sm bg-surface-secondary" />}
      <span className="truncate">{mask.label ?? mask.id.slice(0, 6)}</span>
      <span className="text-text-secondary text-[9px]">●</span>
    </button>
  );
}
```

- [ ] **Step 11.2: Restructure `LayerRow` to render segments instead of adjustments**

In `src/components/panels/LayersPanel.tsx`:

- Remove the `import { Sun, Spline, SlidersHorizontal, Thermometer, Image as ImageIcon } from 'lucide-react'` that's adjustment-only (keep the layer-type ones).
- Remove the `ADJUSTMENT_ICONS` constant.
- Remove the `<AdjustmentRow>` component definition (~ lines 345-431).
- In `LayerRow`, replace the nested-adjustment block:

```tsx
{isActive && expanded && adjustments.length > 0 && (
  <div className="border-b border-separator">
    {adjustments.map((adj) => (<AdjustmentRow ... />))}
  </div>
)}
```

with a segment children block:

```tsx
{isActive && expanded && layer.type === 'image' && segmentsForLayer.length > 0 && (
  <div className="border-b border-separator">
    {segmentsForLayer.map((m) => (
      <SegmentRow key={m.id} layerId={layer.id} mask={m} />
    ))}
  </div>
)}
```

- Add the `SegmentRow` import.
- Read `segmentsForLayer` from `useBackendState((s) => s.snapshot?.masks_index ?? [])` at the `LayersPanelBody` level and pass it to each `LayerRow` as `masks: MaskSummary[]`. Filter to only the image-layer's segments (currently all backend masks belong to the single image layer; the filter can be a no-op now and we can refine when multi-image support arrives).

- Update the chevron logic: show expand chevron when `layer.type === 'image' && hasSegments` instead of `adjustments.length > 0`.

- [ ] **Step 11.3: Wire layer-row click to `activeScope`**

In `LayerRow`'s click handler, after the existing `onSelect()` (which calls `setActiveLayer`), also set the scope to global on that layer:

```tsx
onClick={() => {
  onSelect();
  useEditorStore.getState().setActiveScope({ kind: 'global' });
  useSegmentSelection.setState({ selectedSegmentId: null });
}}
```

(For now, all layer-row clicks set global scope. The "layer-scoped" concept beyond image vs segment isn't surfaced — re-introduce later if multi-image lands.)

- [ ] **Step 11.4: Manual verification**

```bash
npm run dev
```
- Open an image. Wait for analyze to populate `masks_index`.
- The image layer row shows an expand chevron.
- Click it → segments listed as nested children with mask thumbnails.
- Click a segment row → `activeScope` becomes that mask; canvas widgets re-opacify accordingly.
- The previously-nested adjustments are gone from the Layers section (they're now in Active).

- [ ] **Step 11.5: Commit**

```bash
git add src/components/panels/LayersPanel.tsx src/components/panels/SegmentRow.tsx
git commit --no-verify -m "feat(layers): drop nested adjustments, add segment children"
```

---

## Acceptance pass — spec §11 walk-through

Once Task 11 lands, walk through each acceptance criterion from the spec:

1. Click image repeatedly → cycles smallest → larger → full → wraps.
2. Full image + Curves rail click → ghost → drop → widget in Active list.
3. Segment + Light rail click → ghost → drop → segment-scoped widget.
4. Switch selection → opacity flips for non-matching widgets/rows.
5. Suggestion click → ghost → drop → accept_widget → moves to Active.
6. Active row click → canvas pans, widget pulses.
7. Layers expand → segments visible; click selects.
8. Ask AI input submits to backend → new Suggestion row.
9. ⌘K focuses the Ask AI input.

If any item fails, file as a follow-up — don't bundle fixes into this branch beyond what each task naturally covers.

---

## Self-review checklist (run after writing each task)

- **Placeholders**: no "TBD" or "implement later"; every step has actual code.
- **Types**: `Scope` shape, `Adjustment` shape, `ToolDefinition.processingId` referenced consistently.
- **File paths**: every step lists exact paths.
- **Commands**: `npx vitest run …` or `npm run dev` are the only test/runtime commands needed.
- **Commits**: every task ends with a commit; `--no-verify` justified by pre-existing repo lint state.
