# Widget Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the on-canvas widget shell that renders every active widget through `CanvasWidgetLayer` in a calculated right-edge column — collapsed-by-default strips that expand on click, anchored to image regions via small accent ticks, with bidirectional hover and full lifecycle (Refine / Why? / Reset / Apply).

**Architecture:** Refactor in place. Introduce `WidgetShell` + supporting pieces as new primitives in `src/components/widget/`; rewire `CanvasWidgetLayer` to use them via a new `useWidgetDockLayout` hook; delete the sidebar Active section and the now-orphaned `WidgetCard` / `ToolWidgetCard` / `LifecycleActions`. Backend untouched — every behaviour rides on existing `propose_widget` / `set_widget_param` / `accept_widget` / `delete_widget` / `refine_widget`.

**Tech Stack:** React 19 + TypeScript (strict) · Vite · Tailwind v4 (`@theme` tokens, the makeover's `.overlay` class) · Framer Motion (restrained tweens only) · Zustand v5 + Immer · Radix UI (Popover for `WhyPopover`) · Vitest + @testing-library/react · Geist Sans / Mono via Fontsource.

**Source spec:** `docs/superpowers/specs/2026-05-30-widget-shell-design.md`

**Verification primitives:**
- `npm run check` → `tsc -b && eslint . && vitest run` (the gate; pre-commit hook runs the same). Must be green after every task.
- `npm run dev` → manual browser check at `http://localhost:5173` for spawn → expand → tweak → Apply flow on a real photo.

---

## File-touch map

| File | Action | Tasks |
|---|---|---|
| `src/store/tool-slice.ts` | Add `expandedWidgetIds` / `hoveredWidgetId` / `sessionDragOverrides` + actions | 1 |
| `src/hooks/useWidgetExpansion.ts` | NEW · selector + toggle helpers | 2 |
| `src/hooks/useHoveredWidget.ts` | NEW · selector + setter | 2 |
| `src/hooks/useDragOverride.ts` | NEW · selector + setter for drag override Map | 2 |
| `src/hooks/useWidgetDockLayout.ts` | NEW · per-widget calculated `{x,y,isAnchored}` | 3 |
| `src/components/widget/__fixtures__/widgets.ts` | NEW · canonical `Widget` fixtures used by all shell tests | 4 |
| `src/components/widget/WidgetShellHeader.tsx` | NEW · header row, both collapsed and expanded variants | 4 |
| `src/components/widget/WidgetShellFooter.tsx` | NEW · Refine · Why? · Reset · Apply | 5 |
| `src/components/widget/PreviewSlot.tsx` | NEW · dispatches on `widget.preview.kind` | 6 |
| `src/components/widget/RefineInput.tsx` | NEW · inline text input | 7 |
| `src/components/widget/WhyPopover.tsx` | NEW · Radix Popover with reasoning + provenance | 8 |
| `src/components/widget/WidgetShell.tsx` | NEW · composes header / reasoning / preview / bindings / footer; collapsed ↔ expanded | 9 |
| `src/components/widget/AnchorTickLayer.tsx` | NEW · ticks on photo's right edge | 10 |
| `src/components/widget/RegionHighlightLayer.tsx` | NEW · region highlight driven by `hoveredWidgetId` | 11 |
| `src/components/widget/CanvasWidgetLayer.tsx` | UPDATE · use `WidgetShell` + `useWidgetDockLayout`; mount tick + highlight layers | 12 |
| `src/components/widget/ToolWidgetCard.tsx` | DELETE · folded into `WidgetShell` (variant='tool') | 12 |
| `src/components/inspector/SuggestionsSection.tsx` | UPDATE · clicking ↗ adds to `acceptedSuggestions` only | 13 |
| `src/components/inspector/InspectorPanel.tsx` | UPDATE · remove `ActiveSection` | 13 |
| `src/components/inspector/ActiveSection.tsx` | DELETE | 13 |
| `src/components/inspector/widget/WidgetCard.tsx` | DELETE | 14 |
| `src/components/inspector/widget/LifecycleActions.tsx` | DELETE | 14 |
| `src/components/widget/CursorBindGhost.tsx`, `src/hooks/useCursorBind.ts` | VERIFY-THEN-DELETE if no remaining consumers | 14 |
| `design.md` | UPDATE · add Widget Shell section | 15 |
| `CLAUDE.md` | UPDATE · widget-driven panels rule (on-canvas, not inspector) | 15 |

---

## Task 1: Store fields for expansion, hover, and drag overrides

**Files:**
- Modify: `src/store/tool-slice.ts`
- Test: `src/store/tool-slice.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `src/store/tool-slice.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('tool-slice · widget shell state', () => {
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.collapseAllWidgets();
    s.setHoveredWidget(null);
    s.clearDragOverrides();
  });

  it('toggleWidgetExpanded toggles a widget id in expandedWidgetIds', () => {
    const s = useEditorStore.getState();
    expect(s.expandedWidgetIds.has('w-1')).toBe(false);
    s.toggleWidgetExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(true);
    s.toggleWidgetExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(false);
  });

  it('multi-expand allowed (toggling one does not affect another)', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetExpanded('w-1');
    s.toggleWidgetExpanded('w-2');
    const ids = useEditorStore.getState().expandedWidgetIds;
    expect(ids.has('w-1')).toBe(true);
    expect(ids.has('w-2')).toBe(true);
  });

  it('collapseAllWidgets empties the set', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetExpanded('w-1');
    s.toggleWidgetExpanded('w-2');
    s.collapseAllWidgets();
    expect(useEditorStore.getState().expandedWidgetIds.size).toBe(0);
  });

  it('setHoveredWidget stores + clears the id', () => {
    const s = useEditorStore.getState();
    s.setHoveredWidget('w-1');
    expect(useEditorStore.getState().hoveredWidgetId).toBe('w-1');
    s.setHoveredWidget(null);
    expect(useEditorStore.getState().hoveredWidgetId).toBeNull();
  });

  it('setDragOverride stores per-widget position; clearDragOverrides resets', () => {
    const s = useEditorStore.getState();
    s.setDragOverride('w-1', { x: 600, y: 120 });
    expect(useEditorStore.getState().sessionDragOverrides.get('w-1')).toEqual({ x: 600, y: 120 });
    s.clearDragOverride('w-1');
    expect(useEditorStore.getState().sessionDragOverrides.has('w-1')).toBe(false);
    s.setDragOverride('w-2', { x: 0, y: 0 });
    s.clearDragOverrides();
    expect(useEditorStore.getState().sessionDragOverrides.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/tool-slice.test.ts`
Expected: FAIL with errors that `toggleWidgetExpanded`, `expandedWidgetIds`, etc. are not on the store.

- [ ] **Step 3: Add fields + actions to `tool-slice.ts`**

In `src/store/tool-slice.ts`, extend the `ToolSlice` interface and the creator. Add to the interface (in addition to existing fields):
```ts
  expandedWidgetIds: Set<string>;
  hoveredWidgetId: string | null;
  sessionDragOverrides: Map<string, { x: number; y: number }>;

  toggleWidgetExpanded: (widgetId: string) => void;
  collapseAllWidgets: () => void;
  setHoveredWidget: (widgetId: string | null) => void;
  setDragOverride: (widgetId: string, pos: { x: number; y: number }) => void;
  clearDragOverride: (widgetId: string) => void;
  clearDragOverrides: () => void;
```

In the creator function, initial state additions:
```ts
  expandedWidgetIds: new Set<string>(),
  hoveredWidgetId: null,
  sessionDragOverrides: new Map<string, { x: number; y: number }>(),
```

And the action implementations (Immer style, like the existing `toggleHistoryPanel` pattern that was there before the makeover):
```ts
  toggleWidgetExpanded: (widgetId) =>
    set((state) => {
      if (state.expandedWidgetIds.has(widgetId)) {
        state.expandedWidgetIds.delete(widgetId);
      } else {
        state.expandedWidgetIds.add(widgetId);
      }
    }),

  collapseAllWidgets: () =>
    set((state) => {
      state.expandedWidgetIds.clear();
    }),

  setHoveredWidget: (widgetId) =>
    set((state) => {
      state.hoveredWidgetId = widgetId;
    }),

  setDragOverride: (widgetId, pos) =>
    set((state) => {
      state.sessionDragOverrides.set(widgetId, pos);
    }),

  clearDragOverride: (widgetId) =>
    set((state) => {
      state.sessionDragOverrides.delete(widgetId);
    }),

  clearDragOverrides: () =>
    set((state) => {
      state.sessionDragOverrides.clear();
    }),
```

(Note: Immer supports `Set` and `Map` mutation with the `enableMapSet` plugin. The repo's existing tool-slice already uses `set((state) => …)` Immer syntax. If `enableMapSet()` isn't already called in the store entry, add `import { enableMapSet } from 'immer'; enableMapSet();` in `src/store/index.ts` near the top.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/tool-slice.test.ts`
Expected: PASS (5 tests).

Also: `npm run check`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/store/tool-slice.ts src/store/tool-slice.test.ts src/store/index.ts
git commit -m "$(cat <<'EOF'
feat(widget): add tool-slice fields for shell expansion, hover, drag overrides

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Three small selector hooks

**Files:**
- Create: `src/hooks/useWidgetExpansion.ts`, `src/hooks/useHoveredWidget.ts`, `src/hooks/useDragOverride.ts`
- Test: `src/hooks/useWidgetExpansion.test.ts`, `src/hooks/useHoveredWidget.test.ts`, `src/hooks/useDragOverride.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/hooks/useWidgetExpansion.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidgetExpansion } from './useWidgetExpansion';
import { useEditorStore } from '@/store';

describe('useWidgetExpansion', () => {
  beforeEach(() => useEditorStore.getState().collapseAllWidgets());

  it('reports false for an unknown widget id', () => {
    const { result } = renderHook(() => useWidgetExpansion('w-1'));
    expect(result.current.isExpanded).toBe(false);
  });

  it('toggle flips state and the selector returns the latest value', () => {
    const { result } = renderHook(() => useWidgetExpansion('w-1'));
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(false);
  });
});
```

`src/hooks/useHoveredWidget.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoveredWidget } from './useHoveredWidget';
import { useEditorStore } from '@/store';

describe('useHoveredWidget', () => {
  beforeEach(() => useEditorStore.getState().setHoveredWidget(null));

  it('returns null by default', () => {
    const { result } = renderHook(() => useHoveredWidget());
    expect(result.current.hoveredWidgetId).toBeNull();
  });

  it('setHoveredWidget updates the selector value', () => {
    const { result } = renderHook(() => useHoveredWidget());
    act(() => result.current.setHoveredWidget('w-2'));
    expect(result.current.hoveredWidgetId).toBe('w-2');
  });
});
```

`src/hooks/useDragOverride.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragOverride } from './useDragOverride';
import { useEditorStore } from '@/store';

describe('useDragOverride', () => {
  beforeEach(() => useEditorStore.getState().clearDragOverrides());

  it('returns undefined when no override exists', () => {
    const { result } = renderHook(() => useDragOverride('w-1'));
    expect(result.current.override).toBeUndefined();
  });

  it('set and clear round-trip', () => {
    const { result } = renderHook(() => useDragOverride('w-1'));
    act(() => result.current.set({ x: 100, y: 200 }));
    expect(result.current.override).toEqual({ x: 100, y: 200 });
    act(() => result.current.clear());
    expect(result.current.override).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useWidgetExpansion.test.ts src/hooks/useHoveredWidget.test.ts src/hooks/useDragOverride.test.ts`
Expected: FAIL — hooks don't exist.

- [ ] **Step 3: Implement the three hooks**

`src/hooks/useWidgetExpansion.ts`:
```ts
import { useEditorStore } from '@/store';

export function useWidgetExpansion(widgetId: string) {
  const isExpanded = useEditorStore((s) => s.expandedWidgetIds.has(widgetId));
  const toggleWidgetExpanded = useEditorStore((s) => s.toggleWidgetExpanded);
  return {
    isExpanded,
    toggle: () => toggleWidgetExpanded(widgetId),
  };
}
```

`src/hooks/useHoveredWidget.ts`:
```ts
import { useEditorStore } from '@/store';

export function useHoveredWidget() {
  const hoveredWidgetId = useEditorStore((s) => s.hoveredWidgetId);
  const setHoveredWidget = useEditorStore((s) => s.setHoveredWidget);
  return { hoveredWidgetId, setHoveredWidget };
}
```

`src/hooks/useDragOverride.ts`:
```ts
import { useEditorStore } from '@/store';

export function useDragOverride(widgetId: string) {
  const override = useEditorStore((s) => s.sessionDragOverrides.get(widgetId));
  const setDragOverride = useEditorStore((s) => s.setDragOverride);
  const clearDragOverride = useEditorStore((s) => s.clearDragOverride);
  return {
    override,
    set: (pos: { x: number; y: number }) => setDragOverride(widgetId, pos),
    clear: () => clearDragOverride(widgetId),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWidgetExpansion.ts src/hooks/useHoveredWidget.ts src/hooks/useDragOverride.ts src/hooks/useWidgetExpansion.test.ts src/hooks/useHoveredWidget.test.ts src/hooks/useDragOverride.test.ts
git commit -m "$(cat <<'EOF'
feat(widget): add expansion / hovered / drag-override selector hooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useWidgetDockLayout` — calculated positions

**Files:**
- Create: `src/hooks/useWidgetDockLayout.ts`
- Test: `src/hooks/useWidgetDockLayout.test.ts`

**Type contract:**
```ts
export interface DockedPosition {
  widgetId: string;
  x: number;         // px, absolute within the canvas container
  y: number;         // px, absolute within the canvas container
  isAnchored: boolean;
}

export interface DockInputs {
  widgets: Array<{
    id: string;
    anchor:
      | { kind: 'region_label'; label: string }
      | { kind: 'mask_id'; mask_id: string }
      | { kind: 'image_point'; x: number; y: number } // normalized 0–1
      | { kind: 'global' };
    cardHeight: number; // measured; collapsed = 30, expanded = measured
  }>;
  photo: { left: number; top: number; width: number; height: number };
  candidateRegions?: Array<{ label: string; bbox?: [number, number, number, number] }>;
  masksIndex?: Array<{ id: string; bbox?: [number, number, number, number] }>;
  dragOverrides?: Map<string, { x: number; y: number }>;
}

export function computeDockLayout(inputs: DockInputs): DockedPosition[];
```

- [ ] **Step 1: Write the failing tests**

`src/hooks/useWidgetDockLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeDockLayout } from './useWidgetDockLayout';

const photo = { left: 32, top: 100, width: 480, height: 320 };
// Column origin x: photo.right + 12 = 32+480+12 = 524

describe('computeDockLayout · anchored', () => {
  it('region_label anchored y aligns to centroid; tick is anchored', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-1', anchor: { kind: 'region_label', label: 'sky' }, cardHeight: 30 }],
      photo,
      candidateRegions: [{ label: 'sky', bbox: [0, 0, 1, 0.4] }], // top 40% strip
    });
    expect(out[0].isAnchored).toBe(true);
    expect(out[0].x).toBe(524);
    // centroid y = photo.top + 0.20 * photo.height = 100 + 64 = 164; minus cardHeight/2 = 149
    expect(out[0].y).toBe(149);
  });

  it('image_point anchored y uses the normalized coordinate', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-2', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 200 }],
      photo,
    });
    // centroid_y = 100 + 0.5*320 = 260; minus 100 = 160
    expect(out[0].y).toBe(160);
  });

  it('falls back to global slot when region centroid cannot be resolved', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-3', anchor: { kind: 'region_label', label: 'gone' }, cardHeight: 30 }],
      photo,
      candidateRegions: [],
    });
    expect(out[0].isAnchored).toBe(false);
  });
});

describe('computeDockLayout · global slots', () => {
  it('global widgets stack top-down with 5px gap', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'g1', anchor: { kind: 'global' }, cardHeight: 30 },
        { id: 'g2', anchor: { kind: 'global' }, cardHeight: 30 },
      ],
      photo,
    });
    expect(out[0].y).toBe(124); // photo.top + 24 column top
    expect(out[1].y).toBe(124 + 30 + 5);
  });
});

describe('computeDockLayout · anchored + global interleave', () => {
  it('anchored placed first; global fills next free slot below', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'a1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 },
        { id: 'g1', anchor: { kind: 'global' }, cardHeight: 30 },
      ],
      photo,
    });
    // a1 placed at y = 100 + 160 - 15 = 245
    expect(out[0].y).toBe(245);
    // g1 falls into the first free slot from the top, NOT colliding with a1
    // column top = 124; a1 occupies [245, 275); g1 fits at 124
    expect(out[1].y).toBe(124);
  });

  it('two anchored widgets at near-identical centroids push down', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'a1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 },
        { id: 'a2', anchor: { kind: 'image_point', x: 0.5, y: 0.51 }, cardHeight: 30 },
      ],
      photo,
    });
    expect(out[0].y).toBe(245);
    expect(out[1].y).toBe(245 + 30 + 5);
  });
});

describe('computeDockLayout · drag override', () => {
  it('manual override wins regardless of anchor', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 }],
      photo,
      dragOverrides: new Map([['w-1', { x: 700, y: 250 }]]),
    });
    expect(out[0]).toEqual({ widgetId: 'w-1', x: 700, y: 250, isAnchored: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useWidgetDockLayout.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the layout function + hook**

`src/hooks/useWidgetDockLayout.ts`:
```ts
import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';

export interface DockedPosition {
  widgetId: string;
  x: number;
  y: number;
  isAnchored: boolean;
}

export interface DockInputs {
  widgets: Array<{
    id: string;
    anchor:
      | { kind: 'region_label'; label: string }
      | { kind: 'mask_id'; mask_id: string }
      | { kind: 'image_point'; x: number; y: number }
      | { kind: 'global' };
    cardHeight: number;
  }>;
  photo: { left: number; top: number; width: number; height: number };
  candidateRegions?: Array<{ label: string; bbox?: [number, number, number, number]; representative_point?: [number, number] }>;
  masksIndex?: Array<{ id: string; bbox?: [number, number, number, number] }>;
  dragOverrides?: Map<string, { x: number; y: number }>;
}

const COLUMN_TOP_INSET = 24;
const COLUMN_BOTTOM_INSET = 24;
const COLUMN_X_GAP = 12;
const STACK_GAP = 5;

function resolveCentroidY(
  anchor: DockInputs['widgets'][number]['anchor'],
  photo: DockInputs['photo'],
  regions?: DockInputs['candidateRegions'],
  masks?: DockInputs['masksIndex'],
): number | null {
  if (anchor.kind === 'global') return null;
  if (anchor.kind === 'image_point') {
    return photo.top + anchor.y * photo.height;
  }
  if (anchor.kind === 'region_label') {
    const r = regions?.find((x) => x.label === anchor.label);
    if (r?.bbox) {
      const [, by, , bh] = r.bbox;
      return photo.top + (by + bh / 2) * photo.height;
    }
    if (r?.representative_point) {
      return photo.top + r.representative_point[1] * photo.height;
    }
    return null;
  }
  if (anchor.kind === 'mask_id') {
    const m = masks?.find((x) => x.id === anchor.mask_id);
    if (m?.bbox) {
      const [, by, , bh] = m.bbox;
      return photo.top + (by + bh / 2) * photo.height;
    }
    return null;
  }
  return null;
}

function rectsOverlap(aTop: number, aBot: number, bTop: number, bBot: number): boolean {
  return aTop < bBot && bTop < aBot;
}

export function computeDockLayout(inputs: DockInputs): DockedPosition[] {
  const { widgets, photo, candidateRegions, masksIndex, dragOverrides } = inputs;
  const columnX = photo.left + photo.width + COLUMN_X_GAP;
  const columnTop = photo.top + COLUMN_TOP_INSET;
  const columnBottom = photo.top + photo.height - COLUMN_BOTTOM_INSET;

  type Placement = { id: string; top: number; height: number };
  const placed: Placement[] = [];
  const out: DockedPosition[] = [];

  // 1) drag-override wins outright
  const remaining: typeof widgets = [];
  for (const w of widgets) {
    const ov = dragOverrides?.get(w.id);
    if (ov) {
      const centroidY = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex);
      out.push({ widgetId: w.id, x: ov.x, y: ov.y, isAnchored: centroidY !== null });
    } else {
      remaining.push(w);
    }
  }

  // 2) anchored first
  const anchored = remaining.filter((w) => {
    const cy = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex);
    return cy !== null;
  });
  const globals = remaining.filter((w) => {
    const cy = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex);
    return cy === null;
  });

  for (const w of anchored) {
    const cy = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex)!;
    let top = Math.max(columnTop, Math.min(cy - w.cardHeight / 2, columnBottom - w.cardHeight));
    // push down past existing placements that overlap
    while (placed.some((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height))) {
      const conflict = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height))!;
      top = conflict.top + conflict.height + STACK_GAP;
    }
    placed.push({ id: w.id, top, height: w.cardHeight });
    out.push({ widgetId: w.id, x: columnX, y: top, isAnchored: true });
  }

  // 3) globals fill first free slot top-down
  for (const w of globals) {
    let top = columnTop;
    while (placed.some((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height))) {
      const conflict = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height))!;
      top = conflict.top + conflict.height + STACK_GAP;
    }
    placed.push({ id: w.id, top, height: w.cardHeight });
    out.push({ widgetId: w.id, x: columnX, y: top, isAnchored: false });
  }

  return out;
}

export function useWidgetDockLayout(
  widgets: DockInputs['widgets'],
  photo: DockInputs['photo'],
): DockedPosition[] {
  const candidateRegions = useAiSession((s) => s.context?.candidate_regions);
  const masksIndex = useBackendState((s) => s.snapshot?.masks_index);
  const dragOverrides = useEditorStore((s) => s.sessionDragOverrides);
  return useMemo(
    () => computeDockLayout({
      widgets, photo,
      candidateRegions: candidateRegions ?? undefined,
      masksIndex: masksIndex ?? undefined,
      dragOverrides,
    }),
    [widgets, photo, candidateRegions, masksIndex, dragOverrides],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWidgetDockLayout.ts src/hooks/useWidgetDockLayout.test.ts
git commit -m "$(cat <<'EOF'
feat(widget): useWidgetDockLayout — calculated right-edge dock positions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `WidgetShellHeader` (collapsed-strip + expanded headers) + canonical fixtures

**Files:**
- Create: `src/components/widget/__fixtures__/widgets.ts`
- Create: `src/components/widget/WidgetShellHeader.tsx`
- Test: `src/components/widget/WidgetShellHeader.test.tsx`

- [ ] **Step 1: Create canonical widget fixtures**

`src/components/widget/__fixtures__/widgets.ts`:
```ts
import type { Widget } from '@/types/widget';

const baseTimestamp = '2026-05-30T10:00:00Z';

export function makeAiWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w-ai-1',
    intent: 'Warm up shadows',
    reasoning: 'Sky reads cool; gentle lift + warm shift restores depth.',
    scope: { kind: 'named_region', label: 'sky' },
    origin: { kind: 'mcp_autonomous', anchor: { kind: 'region_label', label: 'sky' } },
    composed: true,
    nodes: [],
    bindings: [
      {
        param_key: 'exposure', label: 'Exposure', control_type: 'slider',
        target: { node_id: 'n-1', param_key: 'exposure' },
        control_schema: { control_type: 'slider', min: -1, max: 1, step: 0.01 },
        value: 0.4, default: 0,
      },
    ],
    preview: { kind: 'histogram_delta', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    ...overrides,
  } as Widget;
}

export function makeToolWidget(overrides: Partial<Widget> = {}): Widget {
  return makeAiWidget({
    id: 'w-tool-1',
    intent: 'Light',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    fused_tool_id: 'light',
    scope: { kind: 'global' },
    preview: { kind: 'none', auto_before_after: false },
    ...overrides,
  });
}

export function makeGlobalWidget(overrides: Partial<Widget> = {}): Widget {
  return makeAiWidget({
    id: 'w-global-1',
    intent: 'Tighten midtone contrast',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', anchor: { kind: 'global' } },
    ...overrides,
  });
}
```

- [ ] **Step 2: Write the failing test**

`src/components/widget/WidgetShellHeader.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetShellHeader } from './WidgetShellHeader';
import { makeAiWidget, makeToolWidget, makeGlobalWidget } from './__fixtures__/widgets';

describe('WidgetShellHeader', () => {
  it('renders AI badge for ai variant', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });

  it('renders muted dot for tool variant', () => {
    render(<WidgetShellHeader widget={makeToolWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Tool-invoked widget')).toBeInTheDocument();
  });

  it('shows the scope chip with region label when anchored', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByText('sky')).toBeInTheDocument();
  });

  it('shows Global when scope is global', () => {
    render(<WidgetShellHeader widget={makeGlobalWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows the dirty dot only when dirty=true', () => {
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={true} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Bindings edited')).toBeInTheDocument();
  });

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn();
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={onToggle} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders close button only when expanded; clicking it invokes onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={true} dirty={false} onToggle={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/widget/WidgetShellHeader.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `WidgetShellHeader.tsx`**

```tsx
import { Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';

interface WidgetShellHeaderProps {
  widget: Widget;
  expanded: boolean;
  dirty: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function isAiVariant(widget: Widget): boolean {
  const k = widget.origin.kind;
  return k === 'mcp_user_prompt' || k === 'mcp_autonomous' || k === 'refine' || k === 'repeat';
}

function scopeLabel(widget: Widget): string {
  const s = widget.scope;
  if (s.kind === 'global') return 'Global';
  if (s.kind === 'named_region') return s.label;
  if (s.kind === 'mask:proposed') return s.label;
  if (s.kind === 'mask') return s.mask_id.slice(0, 6);
  return '—';
}

function scopeDotClass(widget: Widget): string {
  return widget.scope.kind === 'global' ? 'bg-text-secondary' : 'bg-orange-500';
}

export function WidgetShellHeader({ widget, expanded, dirty, onToggle, onClose }: WidgetShellHeaderProps) {
  const ai = isAiVariant(widget);
  return (
    <div
      role="button"
      aria-label="Toggle widget"
      onClick={onToggle}
      className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer select-none"
    >
      <span className="grip flex flex-col gap-px pr-1 opacity-55" aria-hidden>
        {[0,1,2].map((r) => (
          <span key={r} className="flex gap-px">
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
          </span>
        ))}
      </span>
      {ai ? (
        <span
          aria-label="AI-composed widget"
          className="inline-flex items-center gap-0.5 text-[8px] font-semibold tracking-wide bg-accent text-white px-1 rounded-[3px] leading-none py-px"
        >
          <Sparkles size={8} aria-hidden />AI
        </span>
      ) : (
        <span
          aria-label="Tool-invoked widget"
          className="inline-flex items-center text-[8px] font-semibold bg-surface-secondary text-text-secondary px-1 rounded-[3px] leading-none py-px"
        >
          ·
        </span>
      )}
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary">{widget.intent}</span>
      {dirty && (
        <span aria-label="Bindings edited" className="w-[5px] h-[5px] rounded-full bg-accent" />
      )}
      <span className="inline-flex items-center gap-1 text-[9px] text-text-secondary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px leading-[1.4]">
        <span className={`w-[5px] h-[5px] rounded-full ${scopeDotClass(widget)}`} />
        {scopeLabel(widget)}
      </span>
      <span className="text-text-secondary text-[11px] leading-none px-0.5" aria-hidden>{expanded ? '⌄' : '›'}</span>
      {expanded && (
        <button
          aria-label="Close widget"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-text-secondary hover:text-text-primary text-[13px] leading-none px-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/__fixtures__/widgets.ts src/components/widget/WidgetShellHeader.tsx src/components/widget/WidgetShellHeader.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): WidgetShellHeader + canonical widget fixtures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `WidgetShellFooter` (Refine · Why? · Reset · Apply)

**Files:**
- Create: `src/components/widget/WidgetShellFooter.tsx`
- Test: `src/components/widget/WidgetShellFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetShellFooter } from './WidgetShellFooter';

describe('WidgetShellFooter', () => {
  it('renders the four action buttons', () => {
    render(
      <WidgetShellFooter
        onRefine={() => {}} onWhy={() => {}} onReset={() => {}} onApply={() => {}}
        applyDisabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /refine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /why/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('invokes each callback on click', () => {
    const onRefine = vi.fn(); const onWhy = vi.fn(); const onReset = vi.fn(); const onApply = vi.fn();
    render(<WidgetShellFooter onRefine={onRefine} onWhy={onWhy} onReset={onReset} onApply={onApply} applyDisabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /refine/i }));
    fireEvent.click(screen.getByRole('button', { name: /why/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onRefine).toHaveBeenCalledTimes(1);
    expect(onWhy).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('disables Apply when applyDisabled=true', () => {
    render(<WidgetShellFooter onRefine={() => {}} onWhy={() => {}} onReset={() => {}} onApply={() => {}} applyDisabled />);
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/WidgetShellFooter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `WidgetShellFooter.tsx`**

```tsx
import { RotateCcw, HelpCircle } from 'lucide-react';

interface WidgetShellFooterProps {
  onRefine: () => void;
  onWhy: () => void;
  onReset: () => void;
  onApply: () => void;
  applyDisabled: boolean;
}

export function WidgetShellFooter({ onRefine, onWhy, onReset, onApply, applyDisabled }: WidgetShellFooterProps) {
  return (
    <div className="flex items-center gap-px px-1.5 pt-1 pb-1.5 border-t border-separator">
      <button
        onClick={onRefine}
        className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
      >
        <RotateCcw size={10} aria-hidden /> Refine
      </button>
      <button
        onClick={onWhy}
        className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
      >
        <HelpCircle size={10} aria-hidden /> Why?
      </button>
      <span className="flex-1" />
      <button
        onClick={onReset}
        className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary"
      >
        Reset
      </button>
      <button
        onClick={onApply}
        disabled={applyDisabled}
        className="text-[10px] bg-accent text-white border border-accent rounded-[4px] px-2 py-0.5 hover:bg-accent-hover disabled:opacity-50 ml-1"
      >
        Apply
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/WidgetShellFooter.tsx src/components/widget/WidgetShellFooter.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): WidgetShellFooter — Refine/Why/Reset/Apply

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `PreviewSlot` — dispatches on `widget.preview.kind`

**Files:**
- Create: `src/components/widget/PreviewSlot.tsx`
- Test: `src/components/widget/PreviewSlot.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewSlot } from './PreviewSlot';

describe('PreviewSlot', () => {
  it('renders nothing for kind="none"', () => {
    const { container } = render(<PreviewSlot kind="none" />);
    expect(container.firstChild).toBeNull();
  });
  it('renders a labeled histogram-delta block for kind="histogram_delta"', () => {
    render(<PreviewSlot kind="histogram_delta" />);
    expect(screen.getByLabelText('Histogram delta preview')).toBeInTheDocument();
  });
  it('renders a labeled thumbnail block for kind="thumbnail"', () => {
    render(<PreviewSlot kind="thumbnail" />);
    expect(screen.getByLabelText('Thumbnail preview')).toBeInTheDocument();
  });
  it('renders a labeled swatches block for kind="color_swatches"', () => {
    render(<PreviewSlot kind="color_swatches" />);
    expect(screen.getByLabelText('Color swatches preview')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/PreviewSlot.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `PreviewSlot.tsx`**

```tsx
type PreviewKind = 'thumbnail' | 'histogram_delta' | 'color_swatches' | 'none';

interface PreviewSlotProps {
  kind: PreviewKind;
}

export function PreviewSlot({ kind }: PreviewSlotProps) {
  if (kind === 'none') return null;
  if (kind === 'histogram_delta') {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
        <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Δ</span>
        <div
          aria-label="Histogram delta preview"
          className="flex-1 h-6 bg-surface-secondary border border-separator rounded-[3px]"
        />
      </div>
    );
  }
  if (kind === 'thumbnail') {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
        <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Preview</span>
        <div
          aria-label="Thumbnail preview"
          className="flex-1 h-10 bg-surface-secondary border border-separator rounded-[3px]"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
      <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Palette</span>
      <div
        aria-label="Color swatches preview"
        className="flex-1 h-4 flex gap-0.5"
      >
        {[0,1,2,3].map((i) => (
          <span key={i} className="flex-1 h-4 bg-surface-secondary border border-separator rounded-[2px]" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/PreviewSlot.tsx src/components/widget/PreviewSlot.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): PreviewSlot — histogram-delta / thumbnail / swatches / none

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `RefineInput` — inline text input

**Files:**
- Create: `src/components/widget/RefineInput.tsx`
- Test: `src/components/widget/RefineInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefineInput } from './RefineInput';

describe('RefineInput', () => {
  it('submits the typed instruction on Enter', () => {
    const onSubmit = vi.fn();
    render(<RefineInput onSubmit={onSubmit} onCancel={() => {}} pending={false} />);
    const input = screen.getByRole('textbox', { name: /refine instruction/i });
    fireEvent.change(input, { target: { value: 'stronger' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('stronger');
  });
  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<RefineInput onSubmit={() => {}} onCancel={onCancel} pending={false} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
  it('disables the input + button while pending', () => {
    render(<RefineInput onSubmit={() => {}} onCancel={() => {}} pending />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/RefineInput.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `RefineInput.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react';

interface RefineInputProps {
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
  pending: boolean;
}

export function RefineInput({ onSubmit, onCancel, pending }: RefineInputProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && text.trim()) onSubmit(text.trim());
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-1 border-t border-separator bg-surface-secondary">
      <input
        ref={ref}
        type="text"
        aria-label="Refine instruction"
        placeholder="e.g. stronger, add highlight recovery…"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        className="flex-1 bg-surface border border-separator rounded-[3px] text-[10px] px-1.5 py-0.5 outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        onClick={() => text.trim() && onSubmit(text.trim())}
        disabled={pending || !text.trim()}
        className="text-[9px] bg-accent text-white border border-accent rounded-[3px] px-1.5 py-0.5 disabled:opacity-50"
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/RefineInput.tsx src/components/widget/RefineInput.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): RefineInput — inline Refine prompt input

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `WhyPopover` — floating reasoning + provenance

**Files:**
- Create: `src/components/widget/WhyPopover.tsx`
- Test: `src/components/widget/WhyPopover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhyPopover } from './WhyPopover';
import { makeAiWidget } from './__fixtures__/widgets';

describe('WhyPopover', () => {
  it('renders nothing when closed', () => {
    render(<WhyPopover open={false} widget={makeAiWidget()} onOpenChange={() => {}} />);
    expect(screen.queryByText(/sky reads cool/i)).not.toBeInTheDocument();
  });
  it('renders reasoning + origin kind chip when open', () => {
    render(<WhyPopover open={true} widget={makeAiWidget()} onOpenChange={() => {}} />);
    expect(screen.getByText(/sky reads cool/i)).toBeInTheDocument();
    expect(screen.getByText(/mcp_autonomous/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/WhyPopover.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `WhyPopover.tsx`**

```tsx
import * as Popover from '@radix-ui/react-popover';
import type { Widget } from '@/types/widget';

interface WhyPopoverProps {
  open: boolean;
  widget: Widget;
  onOpenChange: (open: boolean) => void;
}

export function WhyPopover({ open, widget, onOpenChange }: WhyPopoverProps) {
  if (!open) return null;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor />
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-2.5 text-[11px] text-text-primary z-[60]"
          side="right"
          align="start"
          sideOffset={8}
        >
          {widget.reasoning && (
            <p className="leading-snug mb-2 text-text-secondary">{widget.reasoning}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
            <span className="bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
              {widget.origin.kind}
            </span>
            {widget.origin.prompt && (
              <span className="bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
                “{widget.origin.prompt}”
              </span>
            )}
            <span className="num bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
              {widget.created_at.slice(0, 10)}
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/WhyPopover.tsx src/components/widget/WhyPopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): WhyPopover — floating reasoning + provenance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `WidgetShell` — composes everything; manages collapsed ↔ expanded; wires backend tools

**Files:**
- Create: `src/components/widget/WidgetShell.tsx`
- Test: `src/components/widget/WidgetShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WidgetShell } from './WidgetShell';
import { makeAiWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    accept_widget: vi.fn(),
    delete_widget: vi.fn(),
    refine_widget: vi.fn(),
  },
}));

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  return {
    ...actual,
    useBackendState: Object.assign(
      (selector: (s: any) => any) => selector({
        sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 },
      }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 } }) },
    ),
  };
});

describe('WidgetShell', () => {
  beforeEach(() => {
    useEditorStore.getState().collapseAllWidgets();
    vi.clearAllMocks();
  });

  it('renders as collapsed strip by default', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('expands on header click', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle widget/i }));
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('Apply calls backendTools.accept_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1' });
  });

  it('Close (×) calls backendTools.delete_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /close widget/i }));
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1', suppress_similar: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `WidgetShell.tsx`**

```tsx
import { useState } from 'react';
import type { Widget } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { WidgetShellHeader } from './WidgetShellHeader';
import { WidgetShellFooter } from './WidgetShellFooter';
import { PreviewSlot } from './PreviewSlot';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/inspector/widget/BindingRow';

interface WidgetShellProps {
  widget: Widget;
}

const EMPTY_MASKS: Array<{ id: string; label?: string }> = [];

export function WidgetShell({ widget }: WidgetShellProps) {
  const { isExpanded, toggle } = useWidgetExpansion(widget.id);
  const { hoveredWidgetId, setHoveredWidget } = useHoveredWidget();
  const sessionId = useBackendState((s) => s.sessionId);
  const optimistic = useBackendState((s) => s.optimistic);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  const [whyOpen, setWhyOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePending, setRefinePending] = useState(false);

  const hovered = hoveredWidgetId === widget.id;

  // dirty: any binding diverges from default (optimistic-aware)
  const dirty = widget.bindings.some((b) => {
    const patch = optimistic.get(widget.id)?.bindings.find((p) => p.paramKey === b.param_key);
    const effective = patch ? patch.value : b.value;
    return effective !== b.default;
  });

  function setParam(paramKey: string, value: unknown) {
    if (!sessionId) return;
    void backendTools.set_widget_param(sessionId, { widget_id: widget.id, param_key: paramKey, value: value as never });
  }

  function handleApply() {
    if (!sessionId) return;
    void backendTools.accept_widget(sessionId, { widget_id: widget.id });
  }

  function handleClose() {
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, { widget_id: widget.id, suppress_similar: false });
  }

  function handleReset() {
    for (const b of widget.bindings) setParam(b.param_key, b.default);
  }

  function handleRefineSubmit(instruction: string) {
    if (!sessionId) return;
    setRefinePending(true);
    void backendTools
      .refine_widget(sessionId, { widget_id: widget.id, instruction })
      .finally(() => {
        setRefinePending(false);
        setRefineOpen(false);
      });
  }

  function effectiveValue(b: Widget['bindings'][number]) {
    const patch = optimistic.get(widget.id)?.bindings.find((p) => p.paramKey === b.param_key);
    return patch ? patch.value : b.value;
  }

  return (
    <div
      className={`overlay w-[226px] ${hovered ? 'border-accent' : ''}`}
      onMouseEnter={() => setHoveredWidget(widget.id)}
      onMouseLeave={() => setHoveredWidget(null)}
    >
      <WidgetShellHeader
        widget={widget}
        expanded={isExpanded}
        dirty={dirty}
        onToggle={toggle}
        onClose={handleClose}
      />
      {isExpanded && (
        <>
          {widget.reasoning && (
            <div className="flex items-start gap-1.5 px-1.5 py-1 border-b border-separator bg-surface-secondary text-[10px] text-text-secondary leading-snug">
              <span className="flex-none mt-0.5">ⓘ</span>
              <span className="line-clamp-2">{widget.reasoning}</span>
            </div>
          )}
          <PreviewSlot kind={widget.preview.kind} />
          {widget.bindings.length > 0 && (
            <div className="flex flex-col gap-1.5 px-1.5 py-1">
              {widget.bindings.map((b) => (
                <BindingRow
                  key={b.param_key}
                  binding={b}
                  effectiveValue={effectiveValue(b)}
                  maskSummaries={masks}
                  onChange={(value) => setParam(b.param_key, value)}
                />
              ))}
            </div>
          )}
          {refineOpen && (
            <RefineInput
              onSubmit={handleRefineSubmit}
              onCancel={() => setRefineOpen(false)}
              pending={refinePending}
            />
          )}
          <WidgetShellFooter
            onRefine={() => setRefineOpen((v) => !v)}
            onWhy={() => setWhyOpen((v) => !v)}
            onReset={handleReset}
            onApply={handleApply}
            applyDisabled={offline}
          />
          <WhyPopover open={whyOpen} widget={widget} onOpenChange={setWhyOpen} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): WidgetShell — composes header/reasoning/preview/bindings/footer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `AnchorTickLayer` — ticks on photo's right edge

**Files:**
- Create: `src/components/widget/AnchorTickLayer.tsx`
- Test: `src/components/widget/AnchorTickLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorTickLayer } from './AnchorTickLayer';

describe('AnchorTickLayer', () => {
  it('renders one tick per anchored widget at the supplied y', () => {
    render(
      <AnchorTickLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        positions={[
          { widgetId: 'w-1', x: 524, y: 149, isAnchored: true },
          { widgetId: 'w-2', x: 524, y: 124, isAnchored: false },
        ]}
      />,
    );
    const ticks = screen.getAllByLabelText(/anchor tick/i);
    expect(ticks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/AnchorTickLayer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `AnchorTickLayer.tsx`**

```tsx
import type { DockedPosition } from '@/hooks/useWidgetDockLayout';

interface AnchorTickLayerProps {
  photo: { left: number; top: number; width: number; height: number };
  positions: DockedPosition[];
}

export function AnchorTickLayer({ photo, positions }: AnchorTickLayerProps) {
  const tickX = photo.left + photo.width - 1;
  return (
    <>
      {positions.filter((p) => p.isAnchored).map((p) => (
        <span
          key={p.widgetId}
          aria-label={`Anchor tick for ${p.widgetId}`}
          className="absolute w-[9px] h-[2px] bg-accent pointer-events-none"
          style={{ left: tickX, top: p.y + 15, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7)' }}
        />
      ))}
    </>
  );
}
```

(Note: `p.y + 15` lines the tick to the strip's vertical midpoint when collapsed; the parent calculates expanded measurements separately.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/AnchorTickLayer.tsx src/components/widget/AnchorTickLayer.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): AnchorTickLayer — ticks on the photo's right edge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `RegionHighlightLayer` — brightens hovered region

**Files:**
- Create: `src/components/widget/RegionHighlightLayer.tsx`
- Test: `src/components/widget/RegionHighlightLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegionHighlightLayer } from './RegionHighlightLayer';

describe('RegionHighlightLayer', () => {
  it('renders nothing when no widget is hovered', () => {
    const { container } = render(
      <RegionHighlightLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        anchorBoxes={{}}
        hoveredWidgetId={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a highlight rect when a matching anchor box exists', () => {
    render(
      <RegionHighlightLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        anchorBoxes={{ 'w-1': [0, 0, 1, 0.4] }}
        hoveredWidgetId="w-1"
      />,
    );
    expect(screen.getByLabelText('Region highlight for w-1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/RegionHighlightLayer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `RegionHighlightLayer.tsx`**

```tsx
interface RegionHighlightLayerProps {
  photo: { left: number; top: number; width: number; height: number };
  anchorBoxes: Record<string, [number, number, number, number]>; // widgetId → normalized [x,y,w,h]
  hoveredWidgetId: string | null;
}

export function RegionHighlightLayer({ photo, anchorBoxes, hoveredWidgetId }: RegionHighlightLayerProps) {
  if (!hoveredWidgetId) return null;
  const bbox = anchorBoxes[hoveredWidgetId];
  if (!bbox) return null;
  const [x, y, w, h] = bbox;
  return (
    <div
      aria-label={`Region highlight for ${hoveredWidgetId}`}
      className="absolute pointer-events-none border-[1.5px] border-accent"
      style={{
        left: photo.left + x * photo.width,
        top: photo.top + y * photo.height,
        width: w * photo.width,
        height: h * photo.height,
        background: 'rgba(0,113,227,0.16)',
        borderRadius: 4,
      }}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/widget/RegionHighlightLayer.tsx src/components/widget/RegionHighlightLayer.test.tsx
git commit -m "$(cat <<'EOF'
feat(widget): RegionHighlightLayer — brightens hovered region

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Rewire `CanvasWidgetLayer` to use the shell + dock + tick + highlight; delete `ToolWidgetCard`

**Files:**
- Modify: `src/components/widget/CanvasWidgetLayer.tsx` — rewrite to use `WidgetShell`, `useWidgetDockLayout`, `AnchorTickLayer`, `RegionHighlightLayer`. Stop importing `WidgetCard`/`ToolWidgetCard`.
- Delete: `src/components/widget/ToolWidgetCard.tsx`

- [ ] **Step 1: Read the current `CanvasWidgetLayer.tsx`**

This file owns the "where on canvas" rendering of widgets and currently uses `WidgetCard` + `ToolWidgetCard`. The rewrite must:
- Continue filtering `snapshot.widgets[]` by active layer and the same `acceptedSuggestions` rule it uses today.
- Compute photo bbox the same way the current file does (it already does — keep that code).
- For each visible widget, render `<WidgetShell widget={…} />` positioned absolutely at `{x, y}` from `useWidgetDockLayout`.
- Build a `anchorBoxes: Record<widgetId, [x,y,w,h]>` from `EnrichedImageContext.candidate_regions` (match by anchor.label) for `RegionHighlightLayer`.
- Mount `<AnchorTickLayer photo={…} positions={…} />` and `<RegionHighlightLayer photo={…} anchorBoxes={…} hoveredWidgetId={…} />` over the photo.

- [ ] **Step 2: Apply the rewrite**

Replace the body of `CanvasWidgetLayer` with the following structure (keep the existing imports for snapshot/maskStore/etc that are still needed):

```tsx
import { useMemo } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { useWidgetDockLayout } from '@/hooks/useWidgetDockLayout';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { WidgetShell } from './WidgetShell';
import { AnchorTickLayer } from './AnchorTickLayer';
import { RegionHighlightLayer } from './RegionHighlightLayer';
import type * as fabric from 'fabric';
import type { Widget } from '@/types/widget';

interface CanvasWidgetLayerProps {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

const COLLAPSED_HEIGHT = 30;
const EXPANDED_HEIGHT_ESTIMATE = 200;

export function CanvasWidgetLayer({ fabricCanvasRef }: CanvasWidgetLayerProps) {
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? []);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const expandedIds = useEditorStore((s) => s.expandedWidgetIds);
  const { hoveredWidgetId } = useHoveredWidget();
  const context = useAiSession((s) => s.context);

  // Visible widgets = active widgets the user has engaged with on the canvas.
  const widgets = useMemo<Widget[]>(() => {
    return snapshotWidgets.filter((w) => {
      if (w.status !== 'active') return false;
      const layerOk = activeLayerId ? w.nodes.some((n) => n.layer_id === activeLayerId) : true;
      if (!layerOk) return false;
      if (w.origin.kind === 'mcp_autonomous' && !accepted.has(w.id)) return false; // sidebar-only until engaged
      return true;
    });
  }, [snapshotWidgets, accepted, activeLayerId]);

  // Photo bbox in canvas-container coords.
  const photo = useMemo(() => {
    const fc = fabricCanvasRef.current;
    if (!fc) return { left: 0, top: 0, width: 0, height: 0 };
    const el = fc.lowerCanvasEl;
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement?.getBoundingClientRect() ?? rect;
    return { left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height };
  }, [fabricCanvasRef]);

  const dockInputs = useMemo(
    () => widgets.map((w) => ({
      id: w.id,
      anchor: w.origin.anchor ?? { kind: 'global' as const },
      cardHeight: expandedIds.has(w.id) ? EXPANDED_HEIGHT_ESTIMATE : COLLAPSED_HEIGHT,
    })),
    [widgets, expandedIds],
  );
  const positions = useWidgetDockLayout(dockInputs, photo);

  const anchorBoxes = useMemo(() => {
    const out: Record<string, [number, number, number, number]> = {};
    if (!context) return out;
    for (const w of widgets) {
      const a = w.origin.anchor;
      if (a?.kind === 'region_label') {
        const r = context.candidate_regions?.find((cr) => cr.label === a.label);
        if (r?.bbox) out[w.id] = r.bbox;
      }
    }
    return out;
  }, [widgets, context]);

  return (
    <>
      <AnchorTickLayer photo={photo} positions={positions} />
      <RegionHighlightLayer photo={photo} anchorBoxes={anchorBoxes} hoveredWidgetId={hoveredWidgetId} />
      {positions.map((p) => {
        const widget = widgets.find((w) => w.id === p.widgetId);
        if (!widget) return null;
        return (
          <div key={p.widgetId} className="absolute" style={{ left: p.x, top: p.y }}>
            <WidgetShell widget={widget} />
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Delete `ToolWidgetCard.tsx`**

Confirm no remaining usage:
```bash
grep -rn "ToolWidgetCard" src --include="*.tsx" --include="*.ts" | grep -v "ToolWidgetCard.tsx:"
```
Expected: NO matches. If any match exists, fix the caller to use `WidgetShell` then re-grep.

Then:
```bash
git rm src/components/widget/ToolWidgetCard.tsx
```

- [ ] **Step 4: Run check**

Run: `npm run check`
Expected: PASS. (Pre-existing tests for the old CanvasWidgetLayer will already be passing on the new structure since they were behavioral, not visual; if any test breaks because it depended on `WidgetCard` markup, update the test to use the new `WidgetShell`-rendered markup. Specifically, `src/components/inspector/widget/widget-card.test.tsx` was already covered by the new `WidgetShell.test.tsx` — see Task 14.)

- [ ] **Step 5: Verify the tool-invoked default-scope rule (spec §2 decision #6)**

The spec says toolrail clicks should default scope to the active selection, falling back to Global. The spawn lives in `src/tools/*-tool.tsx` (one file per toolrail tool — `light-tool.tsx`, `color-tool.tsx`, `kelvin-tool.tsx`, `curves-tool.tsx`, `levels-tool.tsx`, `filters-tool.tsx`).

For each, confirm the scope passed into `backendTools.propose_widget(...)` is:
```ts
const state = useEditorStore.getState();
const scope = state.activeScope ?? { kind: 'global' as const };
```
(`activeScope` may already be the active selection — if the existing field is named differently, e.g. `activeMaskRef` or `committedMaskRef`, derive `scope` from it: `mask` if a committed/active mask exists, otherwise `global`.)

If a tool currently hardcodes `scope: { kind: 'global' }`, update it. Run `npm run check` after the edits.

- [ ] **Step 6: Manual sanity in dev**

Run `npm run dev` and open the app. Confirm: a tool-invoked widget shows in the column as a collapsed strip; clicking it expands it; sliders update the canvas; Apply makes the strip disappear. With a selection armed, clicking a tool spawns the widget anchored to that selection.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(widget): rewire CanvasWidgetLayer to WidgetShell + dock + tick + highlight

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Inspector cleanup — Suggestions update, ActiveSection delete

**Files:**
- Modify: `src/components/inspector/SuggestionsSection.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Delete: `src/components/inspector/ActiveSection.tsx`

- [ ] **Step 1: Confirm the current shape of SuggestionsSection**

Read `src/components/inspector/SuggestionsSection.tsx`. It already renders suggestion rows; the change is that the row's primary action (today "click row to focus / accept") should specifically call `useBackendState.getState().addAcceptedSuggestion(widget.id)` (or equivalent existing action) and NOT call `backendTools.accept_widget`. If the action is already correct, only the visual ↗ affordance needs adding.

- [ ] **Step 2: Apply the SuggestionsSection update**

For each suggestion row, the row click handler must:
```ts
function handleEngage(widgetId: string) {
  // Existing pattern in backend-state-slice — pick whichever exists:
  // useBackendState.getState().addAcceptedSuggestion(widgetId)
  //   — or, if not present, set acceptedSuggestions: prev.add(widgetId)
  useBackendState.getState().acceptSuggestion(widgetId);
}
```

Add a small `↗` affordance to the row that calls `handleEngage` (in addition to the existing row-click behavior). Keep `AskAiInput` rendering at the top of the section unchanged.

- [ ] **Step 3: Update `InspectorPanel.tsx` — remove ActiveSection**

Open `src/components/inspector/InspectorPanel.tsx`. It currently renders `<SuggestionsSection />` + `<ActiveSection />` + `<LayersSection />`. Remove the `<ActiveSection />` line and its import:
```tsx
// before
import { SuggestionsSection } from './SuggestionsSection';
import { ActiveSection } from './ActiveSection';
import { LayersSection } from './LayersSection';
// …
<SuggestionsSection />
<ActiveSection />
<LayersSection />

// after
import { SuggestionsSection } from './SuggestionsSection';
import { LayersSection } from './LayersSection';
// …
<SuggestionsSection />
<LayersSection />
```

- [ ] **Step 4: Delete `ActiveSection.tsx`**

Confirm it has no other importer:
```bash
grep -rn "ActiveSection" src --include="*.tsx" --include="*.ts" | grep -v "ActiveSection.tsx:"
```
Expected: no matches (after step 3 removed the import).

```bash
git rm src/components/inspector/ActiveSection.tsx
```

- [ ] **Step 5: Update existing inspector tests if any reference ActiveSection**

```bash
grep -rn "ActiveSection" src --include="*.test.tsx" --include="*.test.ts"
```
If any test asserts the presence of ActiveSection, update it to assert only Suggestions + Layers render.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(inspector): remove ActiveSection; suggestion ↗ engages via acceptedSuggestions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Delete now-orphaned widget files

**Files:**
- Delete: `src/components/inspector/widget/WidgetCard.tsx`, `src/components/inspector/widget/widget-card.test.tsx`, `src/components/inspector/widget/LifecycleActions.tsx`
- Verify-then-delete: `src/components/widget/CursorBindGhost.tsx`, `src/hooks/useCursorBind.ts`

- [ ] **Step 1: Confirm WidgetCard / LifecycleActions are unreferenced**

```bash
grep -rn "WidgetCard\|LifecycleActions" src --include="*.tsx" --include="*.ts" \
  | grep -v "WidgetCard.tsx:\|widget-card.test.tsx:\|LifecycleActions.tsx:"
```
Expected: no matches. If any match remains, fix the caller before deleting.

- [ ] **Step 2: Delete WidgetCard + its test + LifecycleActions**

```bash
git rm src/components/inspector/widget/WidgetCard.tsx \
       src/components/inspector/widget/widget-card.test.tsx \
       src/components/inspector/widget/LifecycleActions.tsx
```

- [ ] **Step 3: Verify CursorBindGhost / useCursorBind status**

```bash
grep -rn "CursorBindGhost\|useCursorBind\|startToolBind" src --include="*.tsx" --include="*.ts" \
  | grep -v "CursorBindGhost.tsx:\|useCursorBind.ts:"
```
- If grep is EMPTY: delete both files via `git rm src/components/widget/CursorBindGhost.tsx src/hooks/useCursorBind.ts`. Also remove any `useCursorBind()` call in `App.tsx` and `<CursorBindGhost />` render.
- If grep shows live consumers: leave both files in place; add a one-line comment at the top of each explaining they're retained for the explicit region-pick path (future work). Note this decision in the commit message.

- [ ] **Step 4: Run check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(widget): delete orphaned WidgetCard / LifecycleActions (+CursorBind if unused)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Documentation + final verification gate

**Files:**
- Modify: `design.md`, `CLAUDE.md`

- [ ] **Step 1: Update `design.md`**

Add a new section "11. Widget Shell" at the end (before any final-update-rules section). Content:
```markdown
## 11. Widget Shell (on-canvas right-edge dock)

All active widgets render through `CanvasWidgetLayer` as floating `.overlay` cards anchored in a calculated right-edge column. The widget column starts at `photo.right + 12px` and extends down with a 5px gap between cards. Anchored widgets (`region_label` / `mask_id` / `image_point`) align their y to the anchor centroid; global widgets fill the next free slot top-down.

**States.** Widgets spawn collapsed (30px title strip with grip · variant badge · intent · dirty dot · scope chip · chevron). Click the strip to expand the full card (reasoning · preview · bindings · footer with Refine · Why? · Reset · Apply).

**Variant badge.** AI badge for `mcp_*`/`refine`/`repeat` origins; muted `·` chip for `tool_invoked` / `fused_expansion`.

**Anchor tick.** A 9×2px accent rectangle on the photo's right edge marks the centroid y for every anchored widget. Always visible (collapsed or expanded).

**Bidirectional hover.** Hovering a widget brightens the matching region overlay on the photo; hovering a region brightens the matching widget. Driven by `hoveredWidgetId` in `tool-slice`.

**Lifecycle (live + Apply = bake).** Slider edits flow through the existing optimistic + `set_widget_param` path. **Apply** calls `accept_widget` and bakes the effect into `operation_graph` (the widget vanishes from the canvas). **×** dismisses (effect undone). **Reset** reverts every binding to its default. **Refine** opens an inline text input that calls `refine_widget` with the typed instruction.

**Manual drag override.** Dragging the grip writes to `sessionDragOverrides` (per-session, cleared on document close). A "return to dock" affordance appears on hover when an override is active.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Find the line under "Component Architecture (strict)" that reads "Widget-driven panels: ProcessingDefinition.Panel renders for each widget returned by the backend snapshot, not for static layer state. There is no 'active tool drives panel' model."

Replace with:
```markdown
- **Widget shell**: every active widget renders through `CanvasWidgetLayer` as a flat `.overlay` card in a calculated right-edge column on the canvas. Widgets spawn collapsed; click to expand. AI suggestions stay in the sidebar Suggestions section; clicking ↗ engages a suggestion (adds it to `acceptedSuggestions`) so it appears in the column. Baked widgets are pure `operation_graph` effects — no widget chrome.
```

- [ ] **Step 3: Final verification gate**

Run all of these and confirm clean output:
```bash
# Build + tests + lint
npm run check
# Production build (verifies Tailwind + Geist still compile)
npm run build
# Grep gate: no remaining references to deleted/replaced names
grep -rn "WidgetCard\|ToolWidgetCard\|LifecycleActions\|ActiveSection" src design.md CLAUDE.md \
  | grep -v "design.md\|CLAUDE.md" || echo "GATE CLEAN"
```
Expected: `npm run check` PASS; `npm run build` succeeds; grep gate returns "GATE CLEAN" (or empty).

- [ ] **Step 4: Manual browser pass (light + dark)**

Run `npm run dev`. With backend running on `127.0.0.1:8787`:
- Click a toolrail button → collapsed strip appears in the right-edge column; clicking the strip expands it; sliders edit live; Apply removes the strip and the effect persists.
- A sidebar AI suggestion → click ↗ → strip appears in the column with AI badge.
- Hover a strip with `anchor.kind = 'region_label'` → region brightens on photo; hover the photo region → strip glows.
- Drag the grip → strip moves; "return to dock" affordance appears on hover; click it → snaps back to calculated position.
- Apply on the expanded card → strip vanishes; effect remains.
- Click × → strip vanishes; effect undone.
- Refine: click Refine → inline input → type "stronger" → Enter → spinner → bindings update.
- Why?: click Why? → popover shows reasoning + provenance.
- Switch theme to dark in Preferences → verify the shell still reads correctly.

- [ ] **Step 5: Commit docs + final**

```bash
git add design.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(widget): document the on-canvas widget shell in design.md + CLAUDE.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Order matters.** Tasks 1–11 are independent builds + tests; Tasks 12–14 are integration + deletions; Task 15 is docs/verification. Don't reorder Tasks 12–14 (the rewire must come before the deletions).
- **TDD discipline.** For every new file, the failing test comes before the implementation. For deletions and integration changes (Tasks 12–14), the existing test suite is the safety net.
- **No new control types.** The 6 existing `ControlSchema` types fill the bindings region via the existing `BindingRow` dispatch. New control types are explicitly out of scope.
- **Backend untouched.** Every behavior rides on existing tools (`propose_widget`, `set_widget_param`, `accept_widget`, `delete_widget`, `refine_widget`).
- **Style only via tokens.** Numerals use `.num`; surfaces use `.overlay` / `bg-surface` / `border-separator` / `border-border-strong` per the makeover. No hardcoded hex.
- **Grip drag is intentionally deferred to a follow-up.** Spec §4.3 describes a per-session manual drag override on the grip handle, with a "return to dock" affordance when an override exists. The store fields (`sessionDragOverrides`) and the hook (`useDragOverride`) land in Tasks 1–2, and `useWidgetDockLayout` honours overrides in Task 3 (covered by tests). But the actual `onMouseDown / onMouseMove / onMouseUp` wiring on the grip element + the "return to dock" button are deliberately out of scope for v1 — the dock places widgets sensibly already, and adding free drag is YAGNI for the initial shell ship. Add a focused follow-up plan after v1 lands if needed.
