# Crop Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken in-workspace crop modal with a third "Crop" tab in the right inspector panel, with a draggable preview canvas, aspect chips, straighten slider, dimension readout, Apply / Cancel, plus the previously-unwired live preview that updates the workspace image-node in real time.

**Architecture:** New `CropTab` component lives in `src/components/inspector/crop/`; it owns local staging state (rect, aspect lock, straighten angle), reads the source bitmap from `CanvasRegistry`, reads the existing crop from the snapshot, and renders a pure `CropPreview` subcomponent that handles drag math against the panel-local canvas. Tab activation goes through `preferences-store.inspectorTab` (extended from `'adjustments' | 'info'` to include `'crop'`) plus a new `showCrop()` action. `useImageNodeRender` is extended to merge `cropPreview` from `tool-slice` over the snapshot transforms when the panel is in Crop mode for the active image-node. The dead `CropOverlay` component, its mount in `CanvasWorkspace`, and the `cropModalImageNodeId` field are removed.

**Tech Stack:** React 19 + TypeScript, Radix `ToggleGroup`, Zustand + Immer, 2D Canvas API, Vitest + React Testing Library.

---

## File Structure

- **Create:** `src/components/inspector/crop/CropPreview.tsx` — pure component: preview canvas + 4 corner + 4 edge handles + dark mask. Owns drag math. Inputs: `sourceBitmap`, `crop`, `aspectRatio`, `onCropChange`. Outputs: `onCropChange(newCrop)`.
- **Create:** `src/components/inspector/crop/CropPreview.test.tsx` — drag math unit tests.
- **Create:** `src/components/inspector/crop/CropTab.tsx` — panel composition: reads active image-node + source bitmap + initial state from snapshot, lays out preview + chips + slider + readout + Apply/Cancel, writes `cropPreview` on every change, handles keyboard shortcuts.
- **Create:** `src/components/inspector/crop/CropTab.test.tsx` — composition + Apply/Cancel + keyboard.
- **Modify:** `src/store/preferences-store.ts` — extend `InspectorTab` union; add `showCrop()` action.
- **Modify:** `src/store/preferences-store.test.ts` — test `showCrop()` opens sidebar + sets tab to `'crop'`.
- **Modify:** `src/store/tool-slice.ts` — delete `cropModalImageNodeId` and `setCropModal`; keep `cropPreview` and `setCropPreview`.
- **Modify:** `src/components/inspector/InspectorPanel.tsx` — add the third `TabButton`; disable when `activeImageNodeId === null`; render `<CropTab />` when `tab === 'crop'`.
- **Modify:** `src/components/inspector/InspectorPanel.test.tsx` — third-tab tests.
- **Modify:** `src/hooks/useImageNodeRender.ts` — merge `cropPreview` over snapshot transforms when `inspectorTab === 'crop'` and `activeImageNodeId === imageNodeId`.
- **Modify:** `src/components/workspace/ImageNode.tsx` — `Crop…` menu item routes through `showCrop()` instead of `setCropModal(id)`.
- **Modify:** `src/components/workspace/ImageNode.test.tsx` — update the `Crop…` menu item test.
- **Modify:** `src/components/workspace/CanvasWorkspace.tsx` — delete the `{cropModalId && ...}` mount block and the `cropModalId` subscription.
- **Delete:** `src/components/workspace/CropOverlay.tsx`, `src/components/workspace/CropOverlay.test.tsx`.

---

### Task 1: Extend `InspectorTab` to include `'crop'` + add `showCrop()` action

**Files:**
- Modify: `src/store/preferences-store.ts`
- Modify: `src/store/preferences-store.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/store/preferences-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore } from './preferences-store';

describe('showCrop', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ rightSidebarCollapsed: true, inspectorTab: 'adjustments' });
  });

  it('opens the sidebar and selects the crop tab', () => {
    usePreferencesStore.getState().showCrop();
    expect(usePreferencesStore.getState().rightSidebarCollapsed).toBe(false);
    expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
  });
});
```

(If `describe`/`it` etc. are already imported at the top, don't duplicate.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/preferences-store.test.ts -t "showCrop"`
Expected: FAIL — `showCrop is not a function` and `'crop'` not assignable to `InspectorTab`.

- [ ] **Step 3: Extend the type and add the action**

In `src/store/preferences-store.ts`:

Line 35 — extend the literal union:

```ts
export type InspectorTab = 'adjustments' | 'info' | 'crop';
```

In the state interface (around line 56), add the new action declaration:

```ts
showCrop: () => void;
```

In the `create<PreferencesState>(...)` body, alongside the existing `showImageContext` action (around line 89), add:

```ts
showCrop: () => set({ rightSidebarCollapsed: false, inspectorTab: 'crop' }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/preferences-store.test.ts -t "showCrop"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/preferences-store.ts src/store/preferences-store.test.ts
git commit -m "feat(store): extend InspectorTab with crop; add showCrop action"
```

---

### Task 2: `InspectorPanel` renders the third tab

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Modify: `src/components/inspector/InspectorPanel.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/inspector/InspectorPanel.test.tsx`:

```tsx
import { useEditorStore } from '@/store';

describe('Crop tab', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ inspectorTab: 'adjustments', rightSidebarCollapsed: false });
    useEditorStore.setState({ activeImageNodeId: null } as never);
  });

  it('renders a Crop button next to Adjustments and Info', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).toBeInTheDocument();
  });

  it('disables the Crop tab when no active image-node', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).toBeDisabled();
  });

  it('enables the Crop tab when an image-node is active', () => {
    useEditorStore.setState({ activeImageNodeId: 'in-1' } as never);
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).not.toBeDisabled();
  });

  it('switches to crop tab on click and renders the CropTab placeholder', async () => {
    useEditorStore.setState({ activeImageNodeId: 'in-1' } as never);
    render(<InspectorPanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Crop' }));
    expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
    expect(screen.getByTestId('crop-tab')).toBeInTheDocument();
  });
});
```

If the file doesn't already import `userEvent`, add `import userEvent from '@testing-library/user-event';` at the top. Likewise `usePreferencesStore` if it isn't imported yet.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/InspectorPanel.test.tsx -t "Crop tab"`
Expected: FAIL — the Crop button doesn't exist.

- [ ] **Step 3: Add the third tab and a placeholder `CropTab`**

Create a tiny placeholder so the panel test passes before the real component lands. Make a new file `src/components/inspector/crop/CropTab.tsx`:

```tsx
export function CropTab() {
  return <div data-testid="crop-tab" />;
}
```

In `src/components/inspector/InspectorPanel.tsx`, extend the imports:

```tsx
import { useEditorStore } from '@/store';
import { CropTab } from './crop/CropTab';
```

Inside the component body, read the active image-node id:

```tsx
const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
const cropDisabled = activeImageNodeId === null;
```

In the `<ToggleGroup.Root>`, add the third `TabButton`:

```tsx
<TabButton value="crop" label="Crop" active={tab === 'crop'} disabled={cropDisabled} />
```

Extend `TabButton` to accept `disabled`:

```tsx
function TabButton({
  value, label, active, disabled = false,
}: { value: string; label: string; active: boolean; disabled?: boolean }) {
  return (
    <ToggleGroup.Item value={value} asChild disabled={disabled}>
      <button
        type="button"
        disabled={disabled}
        className={`relative flex-1 text-[11px] py-1.5 transition-colors duration-150 ${
          disabled
            ? 'text-text-tertiary cursor-not-allowed'
            : active
              ? 'text-text-primary'
              : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {label}
        {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent" />}
      </button>
    </ToggleGroup.Item>
  );
}
```

Replace the body render with a three-way branch:

```tsx
{tab === 'adjustments' && <AdjustmentsAccordion />}
{tab === 'info' && <InfoTab />}
{tab === 'crop' && <CropTab />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/InspectorPanel.test.tsx -t "Crop tab"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/InspectorPanel.tsx src/components/inspector/InspectorPanel.test.tsx src/components/inspector/crop/CropTab.tsx
git commit -m "feat(inspector): third Crop tab with disabled gate + placeholder CropTab"
```

---

### Task 3: `CropPreview` drag math — corner drags

**Files:**
- Create: `src/components/inspector/crop/CropPreview.tsx`
- Create: `src/components/inspector/crop/CropPreview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/inspector/crop/CropPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { CropPreview } from './CropPreview';

afterEach(cleanup);

function makeBitmap(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

describe('CropPreview corner drag', () => {
  it('br corner drag increases w and h in source pixels', () => {
    const onCropChange = vi.fn();
    // Source 800×600, preview 200×150 → scale 4× per axis.
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // Screen delta of (+10, +10) → source delta of (+40, +40).
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 110, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 50, w: 240, h: 190 });
  });

  it('tl corner drag adjusts x, y, and shrinks w, h accordingly', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="tl"]') as HTMLElement;
    // Screen delta of (+5, +5) → source delta of (+20, +20).
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 120, y: 70, w: 180, h: 130 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/crop/CropPreview.test.tsx`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement `CropPreview` with corner-drag math**

Create `src/components/inspector/crop/CropPreview.tsx`:

```tsx
import { useEffect, useRef } from 'react';

export interface CropRect { x: number; y: number; w: number; h: number; }

export interface CropPreviewProps {
  sourceBitmap: HTMLCanvasElement | OffscreenCanvas;
  crop: CropRect;
  aspectRatio: number | null;
  previewWidth: number;
  previewHeight: number;
  onCropChange: (crop: CropRect) => void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Edge = 't' | 'b' | 'l' | 'r';
type Handle = Corner | Edge;

function clampRect(r: CropRect, sw: number, sh: number): CropRect {
  let { x, y, w, h } = r;
  x = Math.max(0, Math.min(x, sw - 1));
  y = Math.max(0, Math.min(y, sh - 1));
  w = Math.max(1, Math.min(w, sw - x));
  h = Math.max(1, Math.min(h, sh - y));
  return { x, y, w, h };
}

export function applyCornerDelta(
  start: CropRect, corner: Corner, dsx: number, dsy: number,
  sw: number, sh: number, aspectRatio: number | null,
): CropRect {
  let { x, y, w, h } = start;
  if (aspectRatio != null) {
    const dxBy = Math.abs(dsx);
    const dyBy = Math.abs(dsy * aspectRatio);
    if (dxBy >= dyBy) {
      dsy = (dsx / aspectRatio) * (corner === 'tl' || corner === 'tr' ? -1 : 1)
        * (corner === 'tl' || corner === 'bl' ? -1 : 1);
    } else {
      dsx = dsy * aspectRatio * (corner === 'tl' || corner === 'bl' ? -1 : 1)
        * (corner === 'tl' || corner === 'tr' ? -1 : 1);
    }
  }
  if (corner === 'tl') { x += dsx; y += dsy; w -= dsx; h -= dsy; }
  if (corner === 'tr') { y += dsy; w += dsx; h -= dsy; }
  if (corner === 'bl') { x += dsx; w -= dsx; h += dsy; }
  if (corner === 'br') { w += dsx; h += dsy; }
  return clampRect({ x, y, w, h }, sw, sh);
}

export function CropPreview({
  sourceBitmap, crop, aspectRatio, previewWidth, previewHeight, onCropChange,
}: CropPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sw = sourceBitmap.width;
  const sh = sourceBitmap.height;
  const scaleX = sw / previewWidth;
  const scaleY = sh / previewHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, previewWidth, previewHeight);
    ctx.drawImage(sourceBitmap, 0, 0, sw, sh, 0, 0, previewWidth, previewHeight);
  }, [sourceBitmap, previewWidth, previewHeight, sw, sh]);

  function startCornerDrag(e: React.PointerEvent, corner: Corner) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = crop;
    function onMove(ev: PointerEvent) {
      const dxScreen = ev.clientX - startX;
      const dyScreen = ev.clientY - startY;
      const dsx = dxScreen * scaleX;
      const dsy = dyScreen * scaleY;
      onCropChange(applyCornerDelta(start, corner, dsx, dsy, sw, sh, aspectRatio));
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const rectLeftPx = crop.x / scaleX;
  const rectTopPx = crop.y / scaleY;
  const rectWPx = crop.w / scaleX;
  const rectHPx = crop.h / scaleY;

  return (
    <div className="relative" style={{ width: previewWidth, height: previewHeight }} data-testid="crop-preview">
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div
        className="absolute pointer-events-none border border-accent"
        style={{
          left: rectLeftPx, top: rectTopPx, width: rectWPx, height: rectHPx,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <div
            key={corner}
            data-handle={corner}
            className="absolute w-2.5 h-2.5 bg-surface border-[1.5px] border-accent pointer-events-auto cursor-nwse-resize"
            style={{
              left:   corner.endsWith('l') ? -5 : undefined,
              right:  corner.endsWith('r') ? -5 : undefined,
              top:    corner.startsWith('t') ? -5 : undefined,
              bottom: corner.startsWith('b') ? -5 : undefined,
            }}
            onPointerDown={(e) => startCornerDrag(e, corner)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/crop/CropPreview.test.tsx`
Expected: PASS (both corner-drag tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/crop/CropPreview.tsx src/components/inspector/crop/CropPreview.test.tsx
git commit -m "feat(crop): CropPreview with corner-handle drag math"
```

---

### Task 4: `CropPreview` edge drags + aspect lock + clamps

**Files:**
- Modify: `src/components/inspector/crop/CropPreview.tsx`
- Modify: `src/components/inspector/crop/CropPreview.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/inspector/crop/CropPreview.test.tsx`:

```tsx
describe('CropPreview edge drag', () => {
  it('r edge drag increases w only', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="r"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 50, w: 220, h: 150 });
  });

  it('t edge drag adjusts y and h only', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="t"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 100, y: 70, w: 200, h: 130 });
  });
});

describe('CropPreview aspect lock', () => {
  it('br drag with aspect 1:1 produces w === h (dx wins)', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={1}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // dx=10, dy=2 → source dx=40, dy=8. dx wins → dy gets recomputed so w === h.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const last = onCropChange.mock.lastCall![0];
    expect(last.w).toBe(last.h);
  });
});

describe('CropPreview clamping', () => {
  it('br drag past source right edge clamps w so x + w === sw', () => {
    const onCropChange = vi.fn();
    const source = makeBitmap(800, 600);
    render(<CropPreview
      sourceBitmap={source}
      crop={{ x: 100, y: 50, w: 200, h: 150 }}
      aspectRatio={null}
      previewWidth={200}
      previewHeight={150}
      onCropChange={onCropChange}
    />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    // dx=200 → source dx=800. crop would become w=1000, but x+w must be ≤ 800.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const last = onCropChange.mock.lastCall![0];
    expect(last.x + last.w).toBe(800);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/crop/CropPreview.test.tsx`
Expected: FAIL — edge handles aren't rendered yet.

- [ ] **Step 3: Add edge handles + drag math**

In `src/components/inspector/crop/CropPreview.tsx`, add an `applyEdgeDelta` helper alongside `applyCornerDelta`:

```tsx
export function applyEdgeDelta(
  start: CropRect, edge: Edge, dsx: number, dsy: number, sw: number, sh: number,
): CropRect {
  let { x, y, w, h } = start;
  if (edge === 'l') { x += dsx; w -= dsx; }
  if (edge === 'r') { w += dsx; }
  if (edge === 't') { y += dsy; h -= dsy; }
  if (edge === 'b') { h += dsy; }
  return clampRect({ x, y, w, h }, sw, sh);
}
```

Add an edge-drag handler inside the component:

```tsx
function startEdgeDrag(e: React.PointerEvent, edge: Edge) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const start = crop;
  function onMove(ev: PointerEvent) {
    const dxScreen = ev.clientX - startX;
    const dyScreen = ev.clientY - startY;
    onCropChange(applyEdgeDelta(start, edge, dxScreen * scaleX, dyScreen * scaleY, sw, sh));
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
```

Inside the rect-mask `<div>`, after the four corner handles, render four edge handles:

```tsx
{(['t', 'b', 'l', 'r'] as const).map((edge) => (
  <div
    key={edge}
    data-handle={edge}
    className={`absolute pointer-events-auto bg-transparent ${
      edge === 't' || edge === 'b' ? 'cursor-ns-resize h-2.5 left-2 right-2' : 'cursor-ew-resize w-2.5 top-2 bottom-2'
    }`}
    style={{
      left:   edge === 'l' ? -5 : undefined,
      right:  edge === 'r' ? -5 : undefined,
      top:    edge === 't' ? -5 : undefined,
      bottom: edge === 'b' ? -5 : undefined,
    }}
    onPointerDown={(e) => startEdgeDrag(e, edge)}
  />
))}
```

Verify the existing aspect-lock branch in `applyCornerDelta` produces `w === h` for `aspectRatio = 1`. The current implementation handles the corner-direction sign juggling; the test `'br drag with aspect 1:1 produces w === h'` exercises it. If the test fails, the aspect math is wrong — fix the sign logic.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/crop/CropPreview.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/crop/CropPreview.tsx src/components/inspector/crop/CropPreview.test.tsx
git commit -m "feat(crop): CropPreview edge drags + aspect lock + boundary clamps"
```

---

### Task 5: `CropTab` initial state from snapshot

**Files:**
- Modify: `src/components/inspector/crop/CropTab.tsx`
- Modify: `src/components/inspector/crop/CropTab.test.tsx` (new file)

- [ ] **Step 1: Write the failing tests**

Create `src/components/inspector/crop/CropTab.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CropTab } from './CropTab';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';

afterEach(cleanup);

// CanvasRegistry mock — return a small dummy canvas as the layer source.
vi.mock('@/lib/canvas-registry', () => {
  const sources = new Map<string, HTMLCanvasElement>();
  return {
    CanvasRegistry: {
      get: (id: string) => {
        if (!sources.has(id)) {
          const c = document.createElement('canvas');
          c.width = 800;
          c.height = 600;
          sources.set(id, c);
        }
        return sources.get(id);
      },
    },
  };
});

function seedActive(imageNodeId = 'in-1') {
  useEditorStore.setState({
    activeImageNodeId: imageNodeId,
    imageNodes: {
      [imageNodeId]: {
        id: imageNodeId,
        layerIds: ['L1'],
        position: { x: 0, y: 0 },
        size: { w: 800, h: 600 },
      },
    },
  } as never);
}

beforeEach(() => {
  useBackendState.setState({ sessionId: 'sess-1', snapshot: undefined } as never);
});

describe('CropTab initial state', () => {
  it('full source crop when no transform node exists', () => {
    seedActive();
    render(<CropTab />);
    const readout = screen.getByTestId('crop-readout');
    expect(readout).toHaveTextContent('800 × 600');
    // Free is the initial aspect.
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads existing crop from snapshot', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:crop', type: 'crop',
            params: { x: 100, y: 50, w: 600, h: 400 },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    expect(screen.getByTestId('crop-readout')).toHaveTextContent('600 × 400');
  });

  it('reads existing rotate angle into the straighten slider', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:rotate', type: 'rotate',
            params: { angle: 5.0, flip_h: false, flip_v: false },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    const slider = screen.getByRole('slider', { name: /straighten/i }) as HTMLInputElement;
    expect(parseFloat(slider.value)).toBeCloseTo(5.0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx`
Expected: FAIL — `CropTab` is a placeholder, doesn't render any of the asserted UI.

- [ ] **Step 3: Implement the initial-state reads**

Replace `src/components/inspector/crop/CropTab.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { CropPreview, type CropRect } from './CropPreview';

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
];
const PREVIEW_MAX_WIDTH = 240;

export function CropTab() {
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const imageNodes = useEditorStore((s) => s.imageNodes);

  const snapshotCrop = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    if (p.w == null || p.h == null) return null;
    return { x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h };
  });
  const snapshotAngle = useBackendState((s) => {
    if (!activeImageNodeId) return 0;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:rotate`,
    );
    if (!node) return 0;
    return (node.params.angle as number) ?? 0;
  });

  const imageNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  const sw = imageNode?.size.w ?? 0;
  const sh = imageNode?.size.h ?? 0;

  const initialCrop: CropRect = snapshotCrop ?? { x: 0, y: 0, w: sw, h: sh };
  const [crop, setCrop] = useState<CropRect>(initialCrop);
  const [aspect, setAspect] = useState<number | null>(null);
  const [angle, setAngle] = useState(snapshotAngle);

  // Re-seed local state whenever the active image-node changes.
  useEffect(() => {
    setCrop(snapshotCrop ?? { x: 0, y: 0, w: sw, h: sh });
    setAngle(snapshotAngle);
    setAspect(null);
  }, [activeImageNodeId, sw, sh, snapshotCrop?.x, snapshotCrop?.y, snapshotCrop?.w, snapshotCrop?.h, snapshotAngle]);

  const source = imageNode ? CanvasRegistry.get(imageNode.layerIds[0] ?? '') : undefined;

  if (!imageNode || !source || sw === 0 || sh === 0) {
    return <div data-testid="crop-tab" className="p-3 text-[11px] text-text-secondary">Select an image to crop.</div>;
  }

  const previewWidth = Math.min(PREVIEW_MAX_WIDTH, sw);
  const previewHeight = Math.round((previewWidth / sw) * sh);
  const aspectLabel = aspect == null ? 'Free' : aspect === 1 ? '1:1' : aspect === 1.5 ? '3:2' : aspect === 16 / 9 ? '16:9' : 'Original';

  return (
    <div data-testid="crop-tab" className="p-3 flex flex-col gap-2 text-[11px]">
      <CropPreview
        sourceBitmap={source as HTMLCanvasElement}
        crop={crop}
        aspectRatio={aspect}
        previewWidth={previewWidth}
        previewHeight={previewHeight}
        onCropChange={setCrop}
      />
      <div className="flex gap-1">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={aspect === a.ratio}
            onClick={() => setAspect(a.ratio)}
            className={`px-1.5 py-0.5 rounded-[3px] ${
              aspect === a.ratio ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={aspect === sw / sh}
          onClick={() => setAspect(sw / sh)}
          className={`px-1.5 py-0.5 rounded-[3px] ${
            aspect === sw / sh ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'
          }`}
        >
          Original
        </button>
      </div>
      <label className="flex items-center gap-1 text-text-secondary">
        Straighten
        <input
          type="range"
          aria-label="Straighten"
          min={-45}
          max={45}
          step={0.1}
          value={angle}
          onChange={(e) => setAngle(parseFloat(e.target.value))}
          className="flex-1"
        />
        <span className="num w-10 text-right">{angle.toFixed(1)}°</span>
      </label>
      <div data-testid="crop-readout" className="text-text-secondary">
        {sw} × {sh} → {Math.round(crop.w)} × {Math.round(crop.h)} ({aspectLabel})
      </div>
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-accent text-white"
        >
          Apply
        </button>
        <button
          type="button"
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx -t "initial state"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/crop/CropTab.tsx src/components/inspector/crop/CropTab.test.tsx
git commit -m "feat(crop): CropTab initial state from snapshot + chips + slider + readout"
```

---

### Task 6: `CropTab` writes `cropPreview` on every change

**Files:**
- Modify: `src/components/inspector/crop/CropTab.tsx`
- Modify: `src/components/inspector/crop/CropTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/inspector/crop/CropTab.test.tsx`:

```tsx
describe('CropTab cropPreview wiring', () => {
  it('writes cropPreview on mount with the initial rect', () => {
    seedActive();
    render(<CropTab />);
    const preview = useEditorStore.getState().cropPreview;
    expect(preview).not.toBeNull();
    expect(preview!.crop).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(preview!.rotate).toBeNull();
  });

  it('writes cropPreview with rotate when angle is non-zero', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:rotate', type: 'rotate',
            params: { angle: 12.5, flip_h: false, flip_v: false },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    const preview = useEditorStore.getState().cropPreview;
    expect(preview!.rotate).toEqual({ angle: 12.5, flip_h: false, flip_v: false });
  });

  it('clears cropPreview on unmount', () => {
    seedActive();
    const { unmount } = render(<CropTab />);
    expect(useEditorStore.getState().cropPreview).not.toBeNull();
    unmount();
    expect(useEditorStore.getState().cropPreview).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx -t "cropPreview wiring"`
Expected: FAIL — nothing writes `cropPreview` yet.

- [ ] **Step 3: Add the effect to `CropTab.tsx`**

Inside `CropTab.tsx`, after the local-state declarations, add:

```tsx
useEffect(() => {
  useEditorStore.getState().setCropPreview({
    crop,
    rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
  });
  return () => { useEditorStore.getState().setCropPreview(null); };
}, [crop, angle]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx -t "cropPreview wiring"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/crop/CropTab.tsx src/components/inspector/crop/CropTab.test.tsx
git commit -m "feat(crop): CropTab writes cropPreview on change + clears on unmount"
```

---

### Task 7: `CropTab` Apply / Cancel + keyboard

**Files:**
- Modify: `src/components/inspector/crop/CropTab.tsx`
- Modify: `src/components/inspector/crop/CropTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/components/inspector/crop/CropTab.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { backendTools } from '@/lib/backend-tools';
import { usePreferencesStore } from '@/store/preferences-store';

describe('CropTab Apply / Cancel', () => {
  it('Apply calls set_image_node_transform with the staged crop + null rotate', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['L1'],
      crop: { x: 0, y: 0, w: 800, h: 600 },
      rotate: null,
    }));
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(useEditorStore.getState().cropPreview).toBeNull();
    spy.mockRestore();
  });

  it('Cancel does not call set_image_node_transform; resets state', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(useEditorStore.getState().cropPreview).toBeNull();
    spy.mockRestore();
  });

  it('Enter applies; Escape cancels', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx -t "Apply / Cancel"`
Expected: FAIL — no click handlers, no keyboard wiring.

- [ ] **Step 3: Implement the handlers**

Edit `src/components/inspector/crop/CropTab.tsx`. Add imports near the existing ones:

```tsx
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';
```

(`useBackendState` is already imported earlier — don't duplicate.)

Add inside the component body (above the `return`):

```tsx
function handleApply() {
  if (!imageNode) return;
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  void backendTools.set_image_node_transform(sessionId, {
    image_node_id: imageNode.id,
    layer_ids: imageNode.layerIds,
    crop,
    rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
  });
  useEditorStore.getState().setCropPreview(null);
  usePreferencesStore.setState({ inspectorTab: 'adjustments' });
}

function handleCancel() {
  useEditorStore.getState().setCropPreview(null);
  usePreferencesStore.setState({ inspectorTab: 'adjustments' });
}

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (usePreferencesStore.getState().inspectorTab !== 'crop') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [crop, angle, imageNode?.id, imageNode?.layerIds]);
```

Wire the existing Apply / Cancel buttons in the JSX:

```tsx
<button
  type="button"
  onClick={handleApply}
  className="flex-1 px-2 py-0.5 rounded-[3px] bg-accent text-white"
>
  Apply
</button>
<button
  type="button"
  onClick={handleCancel}
  className="flex-1 px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
>
  Cancel
</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx -t "Apply / Cancel"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/crop/CropTab.tsx src/components/inspector/crop/CropTab.test.tsx
git commit -m "feat(crop): CropTab Apply / Cancel + Enter / Escape keyboard"
```

---

### Task 8: `useImageNodeRender` merges `cropPreview` when crop tab is active

**Files:**
- Modify: `src/hooks/useImageNodeRender.ts`

- [ ] **Step 1: Identify the snapshot-read selectors**

Open `src/hooks/useImageNodeRender.ts`. The current logic reads `rotateAngle` and `cropRect` from the snapshot via two `useBackendState` selectors (around lines 81-96).

- [ ] **Step 2: Add the merge with `cropPreview`**

After the existing `cropRect` selector and before the `eff = computeEffectiveSize(...)` call, add:

```ts
const cropPreview = useEditorStore((s) => s.cropPreview);
const previewActive = useEditorStore((s) => {
  const tabIsCrop = usePreferencesStore.getState().inspectorTab === 'crop';
  return tabIsCrop && s.activeImageNodeId === imageNodeId;
});

const effectiveRotateAngle =
  previewActive && cropPreview && cropPreview.rotate
    ? cropPreview.rotate.angle
    : rotateAngle;
const effectiveCropRect =
  previewActive && cropPreview && cropPreview.crop
    ? cropPreview.crop
    : cropRect;
```

Note: importing `usePreferencesStore` synchronously inside the selector (via `getState`) is intentional — we don't want the selector itself to subscribe to preference changes; instead, we depend on the tab via `cropPreview` being set / cleared by `CropTab` mount / unmount.

Add the import at the top of the file:

```ts
import { usePreferencesStore } from '@/store/preferences-store';
```

Replace the existing `computeEffectiveSize(...)` call to use the merged values:

```ts
const eff = computeEffectiveSize(
  { w: sourceWidth, h: sourceHeight },
  effectiveRotateAngle,
  effectiveCropRect,
);
```

In the `renderImageNodeComposite` call, the renderer reads transforms from the opGraph by id (via `readTransforms` inside `image-node-renderer.ts`). To make the preview's crop / rotate flow through, we need the renderer to receive the merged transforms too. Simplest: pass overrides via the new args fields the renderer already accepts? It doesn't have them. We add a small extension to the renderer:

Open `src/lib/image-node-renderer.ts`. In `RenderImageNodeCompositeArgs`, add two optional fields:

```ts
overrideRotate?: { angle: number; flip_h: boolean; flip_v: boolean } | null;
overrideCrop?: { x: number; y: number; w: number; h: number } | null;
```

In the body of `renderImageNodeComposite`, just before the geometry pass (where `readTransforms` is called), replace:

```ts
const transforms = readTransforms(opGraph, args.imageNodeId);
```

with:

```ts
const fromSnapshot = readTransforms(opGraph, args.imageNodeId);
const transforms = {
  rotate: args.overrideRotate !== undefined ? args.overrideRotate ?? undefined : fromSnapshot.rotate,
  crop:   args.overrideCrop   !== undefined ? args.overrideCrop   ?? undefined : fromSnapshot.crop,
};
```

Back in `useImageNodeRender.ts`, extend the `renderImageNodeComposite` call to include the overrides only when preview is active:

```tsx
renderImageNodeComposite({
  canvas,
  imageNodeId,
  layerIds,
  sourceWidth,
  sourceHeight,
  opGraph,
  widgets,
  optimistic,
  hiddenNodeIds,
  bypassAdjustments,
  overrideRotate: previewActive && cropPreview ? cropPreview.rotate : undefined,
  overrideCrop:   previewActive && cropPreview ? cropPreview.crop   : undefined,
});
```

Update the `useEffect` deps to include `cropPreview` and `previewActive` (and the underlying state changes that drive them):

```tsx
}, [
  imageNodeId,
  layerIds,
  sourceWidth,
  sourceHeight,
  eff.w,
  eff.h,
  renderScale,
  opGraph,
  widgets,
  optimistic,
  pixelVersion,
  activeScope,
  hoveredScope,
  activeMaskRef,
  committedMaskRef,
  activeImageNodeId,
  hiddenWidgetIds,
  hiddenCanonNodeIds,
  bypassAdjustments,
  previewActive,
  cropPreview,
]);
```

- [ ] **Step 3: Verify build**

Run: `npx vitest run src/hooks/useImageNodeRender.test.tsx src/lib/image-node-renderer.test.tsx`
Expected: PASS (the renderer tests should still pass with the new optional args defaulting to "use snapshot").

Run: `npx tsc -b 2>&1 | grep -v canvas-reset | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useImageNodeRender.ts src/lib/image-node-renderer.ts
git commit -m "feat(hook,renderer): merge cropPreview transforms when Crop tab is active"
```

---

### Task 9: `ImageNode` `Crop…` menu item routes through `showCrop()`

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Update the failing test**

The existing test in `ImageNode.test.tsx` asserts that clicking `Crop…` sets `cropModalImageNodeId`. Update it to instead assert that `usePreferencesStore.getState().inspectorTab` becomes `'crop'`.

In `src/components/workspace/ImageNode.test.tsx`, find the `describe('Crop… menu item', ...)` block. Replace the body with:

```tsx
it('routes Crop… through showCrop() — opens sidebar and selects crop tab', async () => {
  usePreferencesStore.setState({ inspectorTab: 'adjustments', rightSidebarCollapsed: true });
  renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
  await userEvent.click(screen.getByLabelText('Image node menu'));
  await userEvent.click(screen.getByText('Crop…'));
  expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
  expect(usePreferencesStore.getState().rightSidebarCollapsed).toBe(false);
});
```

Add `import { usePreferencesStore } from '@/store/preferences-store';` at the top if not already present.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "Crop…"`
Expected: FAIL — the menu item still calls `setCropModal(id)`.

- [ ] **Step 3: Update the menu item in `ImageNode.tsx`**

In `src/components/workspace/ImageNode.tsx`, find the `Crop…` `MenuItem` inside `renderItems`. Replace:

```tsx
onSelect={() => useEditorStore.getState().setCropModal(id)}
```

with:

```tsx
onSelect={() => usePreferencesStore.getState().showCrop()}
```

Add the import at the top if not present:

```ts
import { usePreferencesStore } from '@/store/preferences-store';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "Crop…"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): Crop menu item routes through showCrop()"
```

---

### Task 10: Delete `CropOverlay` and its mount; remove `cropModalImageNodeId`

**Files:**
- Delete: `src/components/workspace/CropOverlay.tsx`
- Delete: `src/components/workspace/CropOverlay.test.tsx`
- Modify: `src/components/workspace/CanvasWorkspace.tsx`
- Modify: `src/store/tool-slice.ts`

- [ ] **Step 1: Remove the mount from `CanvasWorkspace.tsx`**

Open `src/components/workspace/CanvasWorkspace.tsx`. Delete:

```tsx
import { CropOverlay } from './CropOverlay';
```

Delete the `cropModalId` subscription:

```tsx
const cropModalId = useEditorStore((s) => s.cropModalImageNodeId);
```

Delete the JSX block:

```tsx
{cropModalId && imageNodes[cropModalId] && (
  <div ...>
    <CropOverlay ... />
  </div>
)}
```

- [ ] **Step 2: Remove `cropModalImageNodeId` from `tool-slice.ts`**

Open `src/store/tool-slice.ts`. Delete the interface entries:

```ts
cropModalImageNodeId: string | null;
setCropModal: (id: string | null) => void;
```

Delete the initial value:

```ts
cropModalImageNodeId: null,
```

Delete the setter:

```ts
setCropModal: (id) =>
  set((state) => {
    state.cropModalImageNodeId = id;
  }),
```

- [ ] **Step 3: Delete `CropOverlay.tsx` and its test**

```bash
rm src/components/workspace/CropOverlay.tsx
rm src/components/workspace/CropOverlay.test.tsx
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b 2>&1 | grep -v canvas-reset | tail -5`
Expected: no new errors. (If anything still imports `CropOverlay` or `setCropModal`/`cropModalImageNodeId`, fix the import.)

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CanvasWorkspace.tsx src/store/tool-slice.ts
git rm src/components/workspace/CropOverlay.tsx src/components/workspace/CropOverlay.test.tsx
git commit -m "refactor(workspace): delete CropOverlay; remove cropModalImageNodeId"
```

---

### Task 11: Smoke test + final check

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: clean except the two pre-existing `canvas-reset.ts` errors (untracked file, not part of this work).

- [ ] **Step 2: Manual browser smoke**

Boot the dev server (`npm run dev` + backend).

1. Open an image (e.g., a 3840×2160 landscape).
2. The right panel's tab strip shows **Adjustments / Info / Crop**. Crop is enabled now that there's an active image-node.
3. Click the image-node's ⋯ menu → **Crop…**. The right panel switches to the Crop tab.
4. The panel shows a preview of the source image, four corner handles, four edge handles, the chips, the straighten slider, the readout (`3840 × 2160 → 3840 × 2160 (Free)`), and Apply / Cancel.
5. Drag the bottom-right corner inward. The dark mask updates live in the panel preview. The workspace image-node simultaneously shrinks to show the staged crop.
6. Click the `3:2` chip. The rect snaps height to `crop.w / 1.5`.
7. Move the straighten slider to `+5°`. The workspace image-node rotates +5° live.
8. Press `Esc`. The panel returns to Adjustments. The workspace image-node returns to its un-staged state (no committed change).
9. Re-open Crop, drag, press `Enter` (or click Apply). Snapshot persists. Workspace image-node now shows the cropped + rotated result. Refresh the page — crop + rotate persist.
10. Without an active image-node (deselect everything), the Crop tab in the panel is disabled with a "Select an image node to crop" message.

- [ ] **Step 3: Final commit (no-op if nothing changed)**

```bash
git status
# If lint / format auto-fixed anything, stage + commit; otherwise skip.
```
