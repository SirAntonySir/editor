# Image-Node Styling Parity + Zoom-Invariant Chrome + Four-Sided Tethers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the image-node frame zoom-invariant, align selection treatment across image node and widget shells (violet = AI identity, accent = selection state), and route tethers to the nearest of four image-node sides.

**Architecture:** `.overlay` grows three CSS custom properties (`--overlay-border-width`, `--overlay-radius`, `--overlay-shadow`) with backwards-compatible defaults. `ImageNode` writes counter-scaled values for those vars from `useChromeScale()`; `WidgetShell` keeps the defaults because `WidgetNode` already transform-scales the whole shell. A new `.workspace-node-selected` class layers an accent ring + bloom on selection and is applied by `ImageNode` and tool-invoked `WidgetShell` (AI widgets keep violet). `ImageNode` gains top + bottom target handles, `WidgetNode` gains top + bottom source handles, and `pickTetherHandles` becomes a four-way nearest-side picker.

**Tech Stack:** React 19 + TypeScript, React Flow (`@xyflow/react`), Tailwind via `index.css`, Vitest + React Testing Library, Zustand.

---

## File Structure

- `src/index.css` — variable-driven `.overlay` rule + new `.workspace-node-selected` class.
- `src/components/workspace/ImageNode.tsx` — write CSS vars on root, swap outline class for `.workspace-node-selected`, mount four target handles.
- `src/components/widget/WidgetShell.tsx` — accept `selected` prop, apply `.workspace-node-selected` when `selected && !showAiAffordances`.
- `src/components/workspace/WidgetNode.tsx` — forward React Flow `selected` to `WidgetShell`; mount top + bottom source handles in addition to left + right.
- `src/components/workspace/tether-handles.ts` — four-way `pickTetherHandles`.
- `src/components/workspace/tether-handles.test.ts` — extended coverage for top/bottom + all quadrants.
- `src/components/workspace/CanvasWorkspace.tsx` — pass widget centre y + image top/bottom to `pickTetherHandles`.

---

### Task 1: Variable-driven `.overlay` rule

**Files:**
- Modify: `src/index.css` (the `.overlay` block, currently around line 76-81)

- [ ] **Step 1: Update `.overlay` to consume three CSS variables with backwards-compatible defaults**

Edit `src/index.css`, replacing the existing `.overlay` block:

```css
.overlay {
  background: var(--color-surface);
  border: var(--overlay-border-width, 1px) solid var(--color-border-strong);
  border-radius: var(--overlay-radius, var(--radius-panel));
  box-shadow: var(--overlay-shadow, var(--shadow-overlay));
}
```

The three new vars default to the prior literal values, so existing `.overlay` consumers (menus, dropdowns, tooltips, dialogs) render identically.

- [ ] **Step 2: Verify nothing else broke**

Run: `npm run check`
Expected: PASS (no type or lint errors; all tests still pass — `.overlay` behaviour outside workspace nodes is unchanged because defaults match previous values).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor(css): make .overlay border/radius/shadow var-driven"
```

---

### Task 2: Add `.workspace-node-selected` class

**Files:**
- Modify: `src/index.css` (append after the `.widget-shell-ai` block, around line 87-93)

- [ ] **Step 1: Append the new rule to `src/index.css`**

After the `.widget-shell-ai` block, add:

```css
/* Accent selection glow for workspace nodes (image node + tool-invoked
 * widgets). AI widgets keep widget-shell-ai's violet glow on selection;
 * this class is not applied to them. Bloom geometry uses --chrome-scale
 * so the on-screen size stays constant at any workspace zoom. ImageNode
 * sets --chrome-scale via useChromeScale(); WidgetShell omits the override
 * (WidgetNode's outer transform already counter-scales the whole shell). */
.workspace-node-selected {
  border-color: var(--color-accent);
  box-shadow:
    0 0 0 var(--overlay-border-width, 1px) color-mix(in srgb, var(--color-accent) 35%, transparent),
    0 0 calc(14px * var(--chrome-scale, 1)) calc(2px * var(--chrome-scale, 1)) color-mix(in srgb, var(--color-accent) 28%, transparent),
    var(--overlay-shadow, var(--shadow-overlay));
}
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(css): add .workspace-node-selected accent glow rule"
```

---

### Task 3: Test image-node CSS vars on root

**Files:**
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `ImageNode.test.tsx`:

```tsx
describe('zoom-invariant chrome', () => {
  it('writes --chrome-scale, --overlay-border-width, --overlay-radius, --overlay-shadow on the .overlay root', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    // useChromeScale defaults to 1 at workspace zoom >= 1 (the test env's default).
    const style = overlay.style;
    expect(style.getPropertyValue('--chrome-scale')).toBe('1');
    expect(style.getPropertyValue('--overlay-border-width')).toBe('1px');
    expect(style.getPropertyValue('--overlay-radius')).toBe('8px');
    expect(style.getPropertyValue('--overlay-shadow')).toContain('rgba(0, 0, 0, 0.1)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "zoom-invariant chrome"`
Expected: FAIL (`--chrome-scale` etc. are empty strings — `ImageNode` doesn't write them yet).

- [ ] **Step 3: Make the test pass — set CSS vars on the overlay root**

Edit `src/components/workspace/ImageNode.tsx`. Replace the outer `.overlay` div opener:

```tsx
<div
  className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
>
```

with:

```tsx
<div
  className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
  style={{
    ['--chrome-scale' as string]: String(chromeScale),
    ['--overlay-border-width' as string]: `${chromeScale}px`,
    ['--overlay-radius' as string]: `${8 * chromeScale}px`,
    ['--overlay-shadow' as string]: `0 ${4 * chromeScale}px ${14 * chromeScale}px rgba(0, 0, 0, 0.1)`,
  }}
>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "zoom-invariant chrome"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): write chrome-scale CSS vars on overlay root"
```

---

### Task 4: Replace 2px outline with `.workspace-node-selected` on `ImageNode`

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `ImageNode.test.tsx`:

```tsx
describe('selection glow', () => {
  it('applies .workspace-node-selected when selected and removes the old outline class', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(true);
    expect(overlay.classList.contains('outline-2')).toBe(false);
  });

  it('omits .workspace-node-selected when not selected', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "selection glow"`
Expected: FAIL (`workspace-node-selected` is not present; `outline-2` is).

- [ ] **Step 3: Swap the className**

In `ImageNode.tsx`, replace:

```tsx
className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
```

with:

```tsx
className={`overlay overflow-hidden ${selected ? 'workspace-node-selected' : ''}`}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "selection glow"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): replace 2px outline with accent glow"
```

---

### Task 5: Forward React Flow `selected` to `WidgetShell`

**Files:**
- Modify: `src/components/workspace/WidgetNode.tsx`
- Modify: `src/components/widget/WidgetShell.tsx`
- Modify: `src/components/widget/WidgetShell.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `WidgetShell.test.tsx`:

```tsx
describe('selection glow', () => {
  it('applies .workspace-node-selected when selected and NOT AI', () => {
    const widget = makeWidget({ origin: { kind: 'tool_invoked' } });
    render(<WidgetShell widget={widget} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(true);
    expect(overlay.classList.contains('widget-shell-ai')).toBe(false);
  });

  it('keeps violet (widget-shell-ai) when selected AND AI — does not add accent glow', () => {
    const widget = makeWidget({ origin: { kind: 'mcp_user_prompt' } });
    render(<WidgetShell widget={widget} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('widget-shell-ai')).toBe(true);
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
  });

  it('omits both glow classes when not selected and tool-invoked', () => {
    const widget = makeWidget({ origin: { kind: 'tool_invoked' } });
    render(<WidgetShell widget={widget} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
    expect(overlay.classList.contains('widget-shell-ai')).toBe(false);
  });
});
```

If `makeWidget` does not yet exist in this test file, add a minimal helper above `describe`:

```tsx
function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w-1',
    title: 'Test',
    revision: 0,
    origin: { kind: 'tool_invoked' },
    nodes: [],
    bindings: [],
    masks: [],
    ...overrides,
  } as Widget;
}
```

Import `Widget` from `@/types/widget` if not already.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx -t "selection glow"`
Expected: FAIL — `WidgetShell` has no `selected` prop and never applies `workspace-node-selected`.

- [ ] **Step 3: Accept and apply `selected` in `WidgetShell.tsx`**

In `src/components/widget/WidgetShell.tsx`, extend the props interface:

```tsx
interface WidgetShellProps {
  widget: Widget;
  selected?: boolean;
}
```

Destructure it:

```tsx
export function WidgetShell({ widget, selected = false }: WidgetShellProps) {
```

Update the root className:

```tsx
className={`overlay min-w-[226px] w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${selected && !showAiAffordances ? 'workspace-node-selected' : ''} ${hovered ? 'border-accent' : ''}`}
```

- [ ] **Step 4: Forward `selected` from `WidgetNode`**

In `src/components/workspace/WidgetNode.tsx`, accept the prop (rename `_selected` → `selected`) and pass it through:

```tsx
export function WidgetNode({ data, selected }: WidgetNodeProps) {
  const scale = useChromeScale();
  const headerY = `${10 * scale}px`;
  return (
    <>
      <Handle type="source" position={Position.Left}  id="tether-out-left"  style={{ top: headerY, opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="tether-out-right" style={{ top: headerY, opacity: 0 }} />
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <WidgetShell widget={data.widget} selected={selected} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx -t "selection glow"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx src/components/workspace/WidgetNode.tsx
git commit -m "feat(widget): apply accent glow on selection (AI widgets keep violet)"
```

---

### Task 6: Add top + bottom target handles to `ImageNode`

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `ImageNode.test.tsx`:

```tsx
describe('tether handles', () => {
  it('mounts target handles on all four sides', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    expect(document.querySelector('[data-handleid="tether-in-left"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-right"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-top"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-bottom"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "tether handles"`
Expected: FAIL — only left and right handles exist.

- [ ] **Step 3: Mount the two new handles**

In `ImageNode.tsx`, replace the existing two `<Handle>` elements at the bottom with four:

```tsx
<Handle type="target" position={Position.Top}
  id="tether-in-top"    style={{ left: '50%', opacity: 0 }} />
<Handle type="target" position={Position.Bottom}
  id="tether-in-bottom" style={{ left: '50%', opacity: 0 }} />
<Handle type="target" position={Position.Left}
  id="tether-in-left"   style={{ top: `${10 * chromeScale}px`, opacity: 0 }} />
<Handle type="target" position={Position.Right}
  id="tether-in-right"  style={{ top: `${10 * chromeScale}px`, opacity: 0 }} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "tether handles"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): add top and bottom target handles for tethers"
```

---

### Task 7: Add top + bottom source handles to `WidgetNode`

**Files:**
- Modify: `src/components/workspace/WidgetNode.tsx`
- Modify: `src/components/workspace/WidgetNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `WidgetNode.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { WidgetNode } from './WidgetNode';
import type { Widget } from '@/types/widget';

afterEach(cleanup);

function makeWidget(): Widget {
  return {
    id: 'w-1', title: 'Test', revision: 0, origin: { kind: 'tool_invoked' },
    nodes: [], bindings: [], masks: [],
  } as Widget;
}

describe('WidgetNode tether handles', () => {
  it('mounts source handles on all four sides', () => {
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-1" data={{ widget: makeWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(document.querySelector('[data-handleid="tether-out-left"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-right"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-top"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-bottom"]')).toBeTruthy();
  });
});
```

(If `WidgetNode.test.tsx` already exists with other tests, append just the new `describe` block and any missing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/WidgetNode.test.tsx -t "tether handles"`
Expected: FAIL.

- [ ] **Step 3: Add the two new handles to `WidgetNode.tsx`**

Inside the returned fragment, before the existing left/right handles, add:

```tsx
<Handle type="source" position={Position.Top}
  id="tether-out-top"    style={{ left: '50%', opacity: 0 }} />
<Handle type="source" position={Position.Bottom}
  id="tether-out-bottom" style={{ left: '50%', opacity: 0 }} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/WidgetNode.test.tsx -t "tether handles"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/WidgetNode.tsx src/components/workspace/WidgetNode.test.tsx
git commit -m "feat(widget-node): add top and bottom source handles for tethers"
```

---

### Task 8: Extend `pickTetherHandles` to four-way nearest-side

**Files:**
- Modify: `src/components/workspace/tether-handles.ts`
- Modify: `src/components/workspace/tether-handles.test.ts`

- [ ] **Step 1: Update existing tests for new signature and add new quadrant tests**

Replace the contents of `src/components/workspace/tether-handles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickTetherHandles } from './tether-handles';

// Image bounds used across cases: x0..x1 = 0..2000, y0..y1 = 1000..2000.
const img = { x0: 0, y0: 1000, x1: 2000, y1: 2000 };

describe('pickTetherHandles (four-way)', () => {
  it('widget far to the LEFT (same vertical band) → image left, widget right', () => {
    const widget = { x: -800, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-left');
    expect(p.sourceHandle).toBe('tether-out-right');
  });

  it('widget far to the RIGHT (same vertical band) → image right, widget left', () => {
    const widget = { x: 2800, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-left');
  });

  it('widget far ABOVE (same horizontal band) → image top, widget bottom', () => {
    const widget = { x: 1000, y: 200 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-top');
    expect(p.sourceHandle).toBe('tether-out-bottom');
  });

  it('widget far BELOW (same horizontal band) → image bottom, widget top', () => {
    const widget = { x: 1000, y: 2800 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-bottom');
    expect(p.sourceHandle).toBe('tether-out-top');
  });

  it('widget inside image left half (vertically inside too) → both use LEFT', () => {
    const widget = { x: 400, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-left');
    expect(p.sourceHandle).toBe('tether-out-left');
  });

  it('widget inside image right half (vertically inside too) → both use RIGHT', () => {
    const widget = { x: 1600, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-right');
  });

  it('diagonal: widget top-LEFT of image → horizontal distance wins when smaller', () => {
    // Widget at (-100, 950): horizontal distance to left edge = 100,
    // vertical distance to top edge = 50 → vertical axis is closer.
    const widget = { x: -100, y: 950 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-top');
    expect(p.sourceHandle).toBe('tether-out-bottom');
  });

  it('diagonal: widget bottom-RIGHT, horizontal axis closer', () => {
    // Widget at (2050, 2200): horizontal 50, vertical 200 → horizontal wins.
    const widget = { x: 2050, y: 2200 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-left');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (signature mismatch + missing top/bottom handles)**

Run: `npx vitest run src/components/workspace/tether-handles.test.ts`
Expected: FAIL — `pickTetherHandles` arity doesn't match; top/bottom handle types don't exist on `TetherHandlePick`.

- [ ] **Step 3: Rewrite `tether-handles.ts` for four-way picking**

Replace the contents of `src/components/workspace/tether-handles.ts`:

```ts
/** Pick which React Flow handles a tether edge should connect to.
 *
 *  Routes to the image's NEAREST edge (top, bottom, left, or right) based on
 *  axis-aligned distance from the widget centre to each of the four edges.
 *  Whichever axis (horizontal vs vertical) has the smaller distance wins;
 *  within the winning axis, the side closer to the widget is the entry point.
 *  The widget's outlet handle mirrors that side (top→bottom, left→right, …).
 *
 *  Widget overlapping the image bbox on one axis still resolves cleanly because
 *  distance to an edge can be zero or negative — Math.abs makes the comparison
 *  symmetric.
 */
export type ImageHandleId =
  | 'tether-in-top' | 'tether-in-bottom' | 'tether-in-left' | 'tether-in-right';
export type WidgetHandleId =
  | 'tether-out-top' | 'tether-out-bottom' | 'tether-out-left' | 'tether-out-right';

export interface TetherHandlePick {
  sourceHandle: WidgetHandleId;
  targetHandle: ImageHandleId;
}

export interface ImageBounds {
  x0: number; y0: number; x1: number; y1: number;
}

export interface Point { x: number; y: number; }

export function pickTetherHandles(
  widgetCenter: Point,
  image: ImageBounds,
): TetherHandlePick {
  const dLeft   = Math.abs(widgetCenter.x - image.x0);
  const dRight  = Math.abs(widgetCenter.x - image.x1);
  const dTop    = Math.abs(widgetCenter.y - image.y0);
  const dBottom = Math.abs(widgetCenter.y - image.y1);

  const hNearest = dLeft <= dRight ? { dist: dLeft, side: 'left' as const } : { dist: dRight, side: 'right' as const };
  const vNearest = dTop  <= dBottom ? { dist: dTop, side: 'top' as const } : { dist: dBottom, side: 'bottom' as const };

  // Tie → prefer horizontal (matches prior two-way behaviour).
  const useVertical = vNearest.dist < hNearest.dist;

  if (useVertical) {
    return vNearest.side === 'top'
      ? { sourceHandle: 'tether-out-bottom', targetHandle: 'tether-in-top' }
      : { sourceHandle: 'tether-out-top',    targetHandle: 'tether-in-bottom' };
  }
  return hNearest.side === 'left'
    ? { sourceHandle: 'tether-out-right', targetHandle: 'tether-in-left' }
    : { sourceHandle: 'tether-out-left',  targetHandle: 'tether-in-right' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/tether-handles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/tether-handles.ts src/components/workspace/tether-handles.test.ts
git commit -m "feat(tether): four-way nearest-side handle picker"
```

---

### Task 9: Update `CanvasWorkspace` caller to pass widget centre + image bounds

**Files:**
- Modify: `src/components/workspace/CanvasWorkspace.tsx` (around lines 197-205, the `pickTetherHandles` call site)

- [ ] **Step 1: Update the call site**

Find the block (around line 200):

```tsx
const widgetCenterX = widgetNode.position.x + WIDGET_SHELL_MIN_WIDTH / 2;
const { sourceHandle, targetHandle } = pickTetherHandles(
  widgetCenterX,
  target.position.x,
  target.position.x + target.size.w,
);
```

Replace with:

```tsx
// Widget header height ≈ 28px → approximate centre y at +14 from the node origin.
const widgetCenter = {
  x: widgetNode.position.x + WIDGET_SHELL_MIN_WIDTH / 2,
  y: widgetNode.position.y + 14,
};
const imageBounds = {
  x0: target.position.x,
  y0: target.position.y,
  x1: target.position.x + target.size.w,
  y1: target.position.y + target.size.h,
};
const { sourceHandle, targetHandle } = pickTetherHandles(widgetCenter, imageBounds);
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/CanvasWorkspace.tsx
git commit -m "refactor(workspace): wire CanvasWorkspace to four-way pickTetherHandles"
```

---

### Task 10: Manual smoke test + final check

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS (typecheck + lint + all tests).

- [ ] **Step 2: Boot the app and visually verify**

Run: `npm run dev` (Vite + backend per project's standard startup).

In the browser:
1. Open an image so an `ImageNode` mounts.
2. Zoom the workspace to ~0.3 (Cmd+Scroll or the React Flow controls). Verify the image-node frame's border thickness, corner radius, and drop shadow do NOT shrink — they look the same on-screen as at zoom 1.0.
3. Click the image node. Verify the accent glow appears (no 2px outline). Click off — glow goes away.
4. Spawn a tool-invoked widget (e.g. click the Light toolrail button). Click it. Verify the same accent glow appears on the widget.
5. Trigger an AI widget (Cmd+K with a prompt). Click it. Verify violet stays, accent glow does NOT layer on top.
6. Drag the widget above the image node. Verify its tether enters through the top of the image. Drag it below. Verify it enters through the bottom. Same for left/right.

- [ ] **Step 3: Final commit (no-op if step 1 produced no changes)**

If `npm run check` produced any auto-fix changes, commit them:

```bash
git status
git add -p
git commit -m "chore: lint/typecheck cleanups from full run"
```
