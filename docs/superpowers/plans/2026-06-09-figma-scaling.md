# Drop Counter-Scale (Figma Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `useChromeScale`'s counter-scale across WidgetNode, ImageNode, and TetherEdge so widgets, image chrome, and tether edges live in canvas space and scale with React Flow's zoom transform like the image bitmap.

**Architecture:** 5 commits, each independently revertable. (1) Stub `useChromeScale` to return 1 — everything immediately scales with zoom. (2) Create `MarkerDot.tsx` for LOD-hidden widgets. (3) Clean up `WidgetNode` (drop transform wrapper, simplify handle math, wire MarkerDot). (4) Clean up `ImageNode` (drop chrome-layer transform). (5) Clean up `TetherEdge` (canvas-space stroke + delete `useChromeScale.ts`).

**Tech Stack:** React + TypeScript, `@xyflow/react` for canvas, Vitest for tests.

**Reference:** `docs/superpowers/specs/2026-06-09-zoom-aware-scaling-design.md`

**Verification commands:**
- Frontend tests: `cd /Users/anton/Dev/Projects/editor && npx vitest run <path>`
- TypeScript: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json`

---

## File Structure

### Created
- `src/components/workspace/MarkerDot.tsx` — 16×16 colored circle for LOD-hidden widgets
- `src/components/workspace/MarkerDot.test.tsx` — unit test

### Modified
- `src/hooks/useChromeScale.ts` — stub in Task 1, then deleted in Task 5
- `src/hooks/useChromeScale.test.ts` — assertion updated
- `src/components/workspace/WidgetNode.tsx` — drop transform wrapper, simplify handle math, swap in MarkerDot
- `src/components/workspace/WidgetNode.test.tsx` — extend for new behavior
- `src/components/workspace/ImageNode.tsx` — drop chrome-layer transform
- `src/components/workspace/ImageNode.test.tsx` — extend
- `src/components/workspace/TetherEdge.tsx` — drop scale multiplier on stroke + dots + borderRadius + dashArray + `--march-shift`
- `src/components/workspace/TetherEdge.test.tsx` — extend

### Deleted (Task 5)
- `src/hooks/useChromeScale.ts` and `src/hooks/useChromeScale.test.ts`

---

## Task 1: Stub `useChromeScale` to return 1

**Visible effect:** Widgets, image chrome, and tether edges immediately scale with canvas zoom. The whole UI now feels attached to the image at all zooms. Most visible commit of the plan.

**Files:**
- Modify: `src/hooks/useChromeScale.ts`
- Modify: `src/hooks/useChromeScale.test.ts`

- [ ] **Step 1: Update the test to assert the stub returns 1**

Open `src/hooks/useChromeScale.test.ts`. The existing tests assert `1/zoom` behavior. Replace them with:

```typescript
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStore } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useChromeScale } from './useChromeScale';

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe('useChromeScale (deprecated stub)', () => {
  it('always returns 1 regardless of canvas zoom', () => {
    const { result } = renderHook(() => useChromeScale(), { wrapper });
    expect(result.current).toBe(1);
  });

  it('returns 1 with no ReactFlowProvider context', () => {
    // The stub is independent of the store.
    const { result } = renderHook(() => useChromeScale());
    expect(result.current).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/hooks/useChromeScale.test.ts`
Expected: FAIL — old tests assert `1/zoom`; the function still does the counter-scale.

- [ ] **Step 3: Stub the function**

Replace the entire content of `src/hooks/useChromeScale.ts` with:

```typescript
/**
 * Deprecated. Widgets, image chrome, and tether edges now live in canvas
 * space (Figma model). Counter-scaling is removed. This stub returns 1 for
 * any remaining callers; the file is deleted in Task 5 of the
 * `2026-06-09-figma-scaling` plan once no consumers reference it.
 */
export function useChromeScale(): number {
  return 1;
}
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/hooks/useChromeScale.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Run full vitest sweep — verify nothing regresses**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/ src/hooks/ 2>&1 | tail -10`
Expected: green or only pre-existing failures.

**If a test fails because it depends on the old `1/zoom` behavior:** mock the hook to return a specific value in that test, OR update the assertion. The hook is deprecated — any test pinning specific counter-scale values is testing dead behavior.

- [ ] **Step 6: Run tsc**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/hooks/useChromeScale.ts src/hooks/useChromeScale.test.ts
git commit -m "refactor(workspace): stub useChromeScale to return 1 (drop counter-scale)"
```

---

## Task 2: Create `MarkerDot` component

**Visible effect:** None yet — component is built and tested but not wired. Task 3 swaps it in for `WidgetNode`'s low-zoom path.

**Files:**
- Create: `src/components/workspace/MarkerDot.tsx`
- Create: `src/components/workspace/MarkerDot.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/MarkerDot.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkerDot } from './MarkerDot';
import type { Widget } from '@/types/widget';

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w', intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 't', parent_widget_id: null },
    op_id: 'grain',
    composed: false,
    nodes: [], bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [], status: 'active', revision: 1,
    display_name: null, category: 'texture',
    ...overrides,
  };
}

describe('MarkerDot', () => {
  it('renders a 16x16 SVG circle', () => {
    const { container } = render(<MarkerDot widget={makeWidget()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
  });

  it('uses category color for texture (yellow)', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'texture' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#eab308');
  });

  it('uses category color for mood (purple)', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'mood' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });

  it('falls back to mood color when category is null', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: null })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });

  it('falls back to mood color when category is unknown', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'made_up_category' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/MarkerDot.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `src/components/workspace/MarkerDot.tsx`:

```typescript
import type { Widget } from '@/types/widget';

interface Props {
  widget: Widget;
}

/**
 * LOD placeholder for a widget at extreme zoom-out. Renders as a small
 * canvas-space circle colored by the widget's category so the user can
 * scan multiple widgets at a glance during overview navigation.
 *
 * Used by WidgetNode when `useChromeVisible()` returns false.
 */
const CATEGORY_COLORS: Record<string, string> = {
  tone:    '#3b82f6',  // blue
  color:   '#a855f7',  // purple
  detail:  '#22c55e',  // green
  texture: '#eab308',  // yellow
  effect:  '#ec4899',  // pink
  mood:    '#6d5cff',  // indigo
};

const FALLBACK_COLOR = '#6d5cff';

export function MarkerDot({ widget }: Props) {
  const color = CATEGORY_COLORS[widget.category ?? ''] ?? FALLBACK_COLOR;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" fill={color} fillOpacity="0.85" />
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/components/workspace/MarkerDot.test.tsx`
Expected: 5 PASS.

- [ ] **Step 5: Run tsc**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/MarkerDot.tsx src/components/workspace/MarkerDot.test.tsx
git commit -m "feat(workspace): MarkerDot component for LOD-hidden widgets"
```

---

## Task 3: Clean up `WidgetNode` — drop transform, wire MarkerDot

**Visible effect:** Widget code is cleaner. Below `LOD_THRESHOLD` (0.05) the widget renders as `MarkerDot` instead of nothing. Handle positions use the natural box (not scaled).

**Files:**
- Modify: `src/components/workspace/WidgetNode.tsx`
- Modify: `src/components/workspace/WidgetNode.test.tsx`

- [ ] **Step 1: Read the current file**

Open `/Users/anton/Dev/Projects/editor/src/components/workspace/WidgetNode.tsx`. Note the current structure:
- `const scale = useChromeScale();` (line 19)
- `const chromeVisible = useChromeVisible();` (line 20)
- `const headerY = `${10 * scale}px`;` (line 24)
- Handles positioned with `${scaledH}px`, `${scaledW}px` (lines 67, 79)
- Inner div wrapped with `transform: scale(${scale})` (line 84)
- WidgetShell only rendered when chromeVisible (line 81)

- [ ] **Step 2: Write the failing test**

Open `src/components/workspace/WidgetNode.test.tsx`. Add:

```typescript
import { MarkerDot } from './MarkerDot';

describe('WidgetNode LOD behavior', () => {
  // Replace existing render helpers as needed; mirror existing test structure.

  it('renders MarkerDot instead of WidgetShell when chromeVisible is false', () => {
    // Mock useChromeVisible to return false (zoom < LOD_THRESHOLD).
    vi.mock('@/hooks/useChromeVisible', () => ({
      useChromeVisible: () => false,
    }));
    const { container } = render(
      <ReactFlowProvider>
        <WidgetNode {...defaultProps} />
      </ReactFlowProvider>,
    );
    // The MarkerDot SVG has aria-hidden and 16x16 dims.
    const dot = container.querySelector('svg[width="16"][height="16"]');
    expect(dot).not.toBeNull();
    // WidgetShell should NOT render.
    expect(container.querySelector('.widget-shell')).toBeNull();
  });
});
```

(Adapt `defaultProps` and the test's existing setup to match how the other tests in the file construct `WidgetNode`. If `vi.mock` for `useChromeVisible` collides with an existing top-level mock, factor it into a per-test mock instead. The goal is to assert the chromeVisible=false branch renders MarkerDot.)

- [ ] **Step 3: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/WidgetNode.test.tsx`
Expected: the new MarkerDot test FAILS — current code renders nothing when chromeVisible is false.

- [ ] **Step 4: Refactor `WidgetNode.tsx`**

Replace the file's render section (lines ~18-91). Final structure:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useChromeVisible } from '@/hooks/useChromeVisible';
import { MarkerDot } from './MarkerDot';
import { WidgetShell } from '@/components/widget/WidgetShell';
import type { Widget } from '@/types/widget';

interface WidgetNodeProps {
  id: string;
  data: { widget: Widget };
  selected: boolean;
}

export function WidgetNode({ id, data, selected }: WidgetNodeProps) {
  const chromeVisible = useChromeVisible();

  // Anchor edge handles to the visual centre of the shell header so tethers
  // connect at the header band. Two source handles (left + right) let edges
  // exit on the side facing the connected image node.
  const headerY = '10px';

  // Measure the WidgetShell's natural CSS box so the bottom + right source
  // handles can anchor at its actual extent. No scale math: widgets now live
  // in canvas space and React Flow's zoom transform handles screen-pixel
  // conversion.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: 226, // WIDGET_SHELL_MIN_WIDTH fallback (kept literal to avoid an import cycle)
    h: 56,
  });
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setNaturalSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, naturalSize.w, naturalSize.h, updateNodeInternals]);

  return (
    <>
      <Handle
        type="source"
        position={Position.Top}
        id="tether-out-top"
        style={{ left: '50%', top: 0, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="tether-out-bottom"
        style={{ left: '50%', top: `${naturalSize.h}px`, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="tether-out-left"
        style={{ top: headerY, left: 0, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="tether-out-right"
        style={{ top: headerY, left: `${naturalSize.w}px`, opacity: 0 }}
      />
      {chromeVisible ? (
        <div ref={innerRef}>
          <WidgetShell widget={data.widget} selected={selected} />
        </div>
      ) : (
        <MarkerDot widget={data.widget} />
      )}
    </>
  );
}
```

Changes:
- Remove `useChromeScale` import + call.
- `headerY` is now a literal `'10px'` (was `10 * scale`).
- `naturalSize.w` / `.h` used directly in handle positions (no `* scale`).
- Inner div removed — `<WidgetShell>` is wrapped in a simple `<div ref={innerRef}>` for measurement only (no transform).
- `chromeVisible === false` path renders `<MarkerDot widget={data.widget} />` instead of `null`.

- [ ] **Step 5: Tests pass**

Run: `npx vitest run src/components/workspace/WidgetNode.test.tsx`
Expected: all PASS. If a previously-existing test asserted handle positions with `scale` math, update its assertion to use the natural box (no scale).

- [ ] **Step 6: Run full workspace test sweep**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/ 2>&1 | tail -10`
Expected: green.

- [ ] **Step 7: Run tsc**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/WidgetNode.tsx src/components/workspace/WidgetNode.test.tsx
git commit -m "refactor(workspace): WidgetNode drops transform-scale; LOD swaps in MarkerDot"
```

---

## Task 4: Clean up `ImageNode` — drop chrome-layer transform

**Visible effect:** Image border, file name label, drag handles, and any other chrome elements now scale with the image bitmap (which was already scaling naturally).

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Locate `chromeScale` usages**

Run: `grep -n "chromeScale" /Users/anton/Dev/Projects/editor/src/components/workspace/ImageNode.tsx | head -20`

Read the file at each line. Identify the chrome-layer wrapper that has `transform: scale(${chromeScale})`. There may be multiple — handle position math, badge sizing, label font-size, etc.

- [ ] **Step 2: Write failing test**

Open `src/components/workspace/ImageNode.test.tsx`. Add (or extend an existing block):

```typescript
describe('ImageNode chrome scaling (Figma model)', () => {
  it('does not apply transform-scale to the chrome layer', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ImageNode {...defaultProps} />
      </ReactFlowProvider>,
    );
    // No element in the chrome should have an inline style with `transform: scale(`.
    const allElems = container.querySelectorAll('*');
    for (const el of Array.from(allElems)) {
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).not.toMatch(/transform:\s*scale\(/);
    }
  });
});
```

(Adapt `defaultProps` to match the file's existing test fixture pattern.)

- [ ] **Step 3: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: FAIL — current code applies `transform: scale(${chromeScale})`.

- [ ] **Step 4: Remove `chromeScale` from ImageNode.tsx**

Edit `src/components/workspace/ImageNode.tsx`:
1. Delete the line: `const chromeScale = useChromeScale();`
2. Remove the `import { useChromeScale } from '@/hooks/useChromeScale';` line at the top.
3. Search the file for every `chromeScale` reference and remove it:
   - `transform: scale(${chromeScale})` → delete the property entirely
   - `${X * chromeScale}px` → `${X}px`
   - `fontSize: ${X * chromeScale}` → `fontSize: ${X}`
   - Any boolean or conditional that depends on `chromeScale !== 1` — that condition is now always false; simplify accordingly

Be thorough — there may be 5–10 references in this file.

- [ ] **Step 5: Tests pass**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: all PASS.

- [ ] **Step 6: Run tsc**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean.

- [ ] **Step 7: Run full workspace sweep**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/ 2>&1 | tail -10`
Expected: green.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "refactor(workspace): ImageNode chrome drops transform-scale (Figma model)"
```

---

## Task 5: Clean up `TetherEdge` + delete `useChromeScale.ts`

**Visible effect:** Tether edges scale with canvas zoom (stroke gets thicker at higher zoom, thinner at lower zoom). `useChromeScale` is gone.

**Files:**
- Modify: `src/components/workspace/TetherEdge.tsx`
- Modify: `src/components/workspace/TetherEdge.test.tsx`
- Delete: `src/hooks/useChromeScale.ts`
- Delete: `src/hooks/useChromeScale.test.ts`

- [ ] **Step 1: Write failing test**

Open `src/components/workspace/TetherEdge.test.tsx`. Add:

```typescript
describe('TetherEdge canvas-space stroke', () => {
  it('renders stroke-width as a constant (no chromeScale multiplier)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg><TetherEdge {...defaultEdgeProps} /></svg>
      </ReactFlowProvider>,
    );
    // BaseEdge renders a path with stroke-width in the style.
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    const strokeWidth = (path as SVGPathElement).style.strokeWidth;
    // Constant 1.5 (was 1.5 * chromeScale).
    expect(strokeWidth).toBe('1.5');
  });

  it('renders endpoint dots with constant radius (no chromeScale multiplier)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg><TetherEdge {...defaultEdgeProps} /></svg>
      </ReactFlowProvider>,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);   // source + target dot
    for (const c of Array.from(circles)) {
      expect(c.getAttribute('r')).toBe('3');
    }
  });
});
```

(Adapt `defaultEdgeProps` to match the test file's existing setup.)

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/workspace/TetherEdge.test.tsx`
Expected: FAIL — current code multiplies by `scale` (which is 1 after Task 1, but the multiplication string still differs).

- [ ] **Step 3: Refactor `TetherEdge.tsx`**

Replace `src/components/workspace/TetherEdge.tsx` with this version. The diff: drop the `useChromeScale` import + call, drop all `* scale` multipliers, simplify the borderRadius and dashArray.

```typescript
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface TetherEdgeData extends Record<string, unknown> {
  scopeKind: 'layer' | 'node';
}

export type TetherEdgeType = Edge<TetherEdgeData, 'tether'>;

const STROKE_WIDTH = 1.5;   // canvas units
const DOT_RADIUS = 3;        // canvas units
const CORNER_RADIUS = 12;    // canvas units

export function TetherEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<TetherEdgeType>) {
  // Tether edges live in canvas space (Figma model). Stroke width, corner
  // radius, and endpoint dot size are constants in canvas units; React Flow's
  // zoom transform handles screen-pixel conversion. At zoom=1 these match
  // their previous appearance; below 1 they get thinner, above 1 thicker.
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: CORNER_RADIUS,
  });
  // Marching-ants pattern. Layer-scope reads near-solid (5 on, 1 off),
  // node-scope reads as half-half dashes (3 on, 3 off). Pattern AND the
  // animation's offset shift both stay in canvas units — the dash sum equals
  // the per-cycle offset shift via the `--march-shift` CSS custom property,
  // so the loop is seamless at any zoom.
  const isNodeScope = data?.scopeKind === 'node';
  const dashSum = 6;
  const dashArray = isNodeScope ? '3 3' : '5 1';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        className="tether-march"
        style={{
          stroke: 'var(--color-accent)',
          strokeWidth: STROKE_WIDTH,
          fill: 'none',
          ['--march-shift' as string]: String(dashSum),
        }}
      />
      <circle cx={sourceX} cy={sourceY} r={DOT_RADIUS} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={DOT_RADIUS} fill="var(--color-accent)" />
    </>
  );
}
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/components/workspace/TetherEdge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete `useChromeScale.ts` and its test**

Confirm no remaining callers:
```bash
grep -rn "useChromeScale" /Users/anton/Dev/Projects/editor/src --include="*.ts" --include="*.tsx" | grep -v useChromeScale.ts | grep -v useChromeScale.test.ts
```
Expected: no output (no consumers left).

Delete the files:
```bash
cd /Users/anton/Dev/Projects/editor && git rm src/hooks/useChromeScale.ts src/hooks/useChromeScale.test.ts
```

- [ ] **Step 6: Run tsc — confirm no broken imports**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean. If a file still imports `useChromeScale`, the grep in Step 5 missed it — find and remove.

- [ ] **Step 7: Run full vitest sweep**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10`
Expected: all green (or only pre-existing failures).

- [ ] **Step 8: Manual smoke (recommended)**

If you can run the dev server:
1. Spawn an image node + a few widgets via Cmd+K.
2. Zoom out gradually (scroll-wheel). At ~5% zoom, widget bodies should disappear and small colored MarkerDots appear in their place.
3. Zoom in gradually. Widgets should grow with the image. Tether edges should thicken proportionally.
4. At zoom=1, the editor should look identical to before this work (since all the constants are tuned at zoom=1).
5. At zoom=4, widgets should feel anchored to the now-huge image.

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/workspace/TetherEdge.tsx src/components/workspace/TetherEdge.test.tsx src/hooks/useChromeScale.ts src/hooks/useChromeScale.test.ts
git commit -m "refactor(workspace): TetherEdge canvas-space; delete useChromeScale"
```

---

## Definition of Done

After Task 5:

- Widgets scale with canvas zoom (same as the image bitmap).
- Image chrome (border, file name label, drag handles) scales with zoom.
- Tether edges scale with zoom (stroke-width in canvas units).
- Below `LOD_THRESHOLD` (0.05) zoom, widgets collapse to `MarkerDot` colored by category.
- `useChromeScale` is deleted; `grep -rn useChromeScale src/` returns no results.
- At all common zooms (0.5 – 2.0), widgets feel anchored to the image they're tethered to.
- No counter-scaling math remains in `WidgetNode`, `ImageNode`, or `TetherEdge`.
- All existing tests pass; new `MarkerDot` test passes.
- `npx tsc --noEmit` clean.
