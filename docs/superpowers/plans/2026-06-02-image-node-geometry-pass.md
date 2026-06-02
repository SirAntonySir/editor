# Image-Node Geometry Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply crop / rotate / flip correctly in `ImageNode` by splitting compositing and geometry into two canvases — composite layers at source dims into an internal canvas, then a 2D-canvas geometry pass draws into a visible canvas sized at post-transform dims.

**Architecture:** New pure module `src/lib/image-node-geometry.ts` exports `computeEffectiveSize(...)` and `applyGeometry(internal, visible, transforms)`. `image-node-renderer.ts` keeps its existing per-layer + node-scope composite logic but now writes into an INTERNAL canvas (cached per `imageNodeId` in a module-level `Map`), then calls `applyGeometry` to draw onto the VISIBLE canvas, then paints overlays on the visible canvas. `useImageNodeRender` accepts `sourceWidth` / `sourceHeight`, reads transforms from the snapshot, sizes the visible canvas to effective dims, and passes the source dims + transforms through. `ImageNode.tsx` uses `computeEffectiveSize` for the outer wrapper width and footer pixel-count. The current 2D-canvas transform pass in `image-node-renderer.ts` (the broken one that paints into the same canvas as the composite) is replaced entirely.

**Tech Stack:** React 19 + TypeScript, React Flow (`@xyflow/react`), 2D Canvas API, Vitest + React Testing Library, Zustand.

---

## File Structure

- **Create:** `src/lib/image-node-geometry.ts` — pure `computeEffectiveSize` + `applyGeometry` + module-level internal-canvas cache + `clearInternalCanvasCache`.
- **Create:** `src/lib/image-node-geometry.test.ts` — unit tests for the pure functions and the cache.
- **Modify:** `src/lib/image-node-renderer.ts` — composite into an internal canvas, then delegate geometry to `applyGeometry`. Remove the existing transform pass.
- **Modify:** `src/lib/image-node-renderer.test.tsx` — assertions for the new delegation; drop assertions about ctx.rotate/scale being called directly on the visible canvas.
- **Modify:** `src/hooks/useImageNodeRender.ts` — rename `width`/`height` props to `sourceWidth`/`sourceHeight`; read transforms; compute effective dims; pass through.
- **Modify:** `src/components/workspace/ImageNodeBody.tsx` — rename props (`sourceWidth`, `sourceHeight`); drop style block beyond `display: 'block'`.
- **Modify:** `src/components/workspace/ImageNode.tsx` — use `computeEffectiveSize` from the geometry module (drop the local `effectiveSize` helper); incorporate crop dims into the swap calc; pass `sourceWidth` / `sourceHeight` to `ImageNodeBody`.
- **Modify:** `src/core/document.ts` — `closeDocument()` calls `clearInternalCanvasCache()` after the workspace reset.

---

### Task 1: `computeEffectiveSize` — pure function

**Files:**
- Create: `src/lib/image-node-geometry.ts`
- Create: `src/lib/image-node-geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/image-node-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeEffectiveSize } from './image-node-geometry';

describe('computeEffectiveSize', () => {
  const source = { w: 800, h: 600 };

  it('returns source dims when no rotate, no crop', () => {
    expect(computeEffectiveSize(source, null, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps source dims for 90°', () => {
    expect(computeEffectiveSize(source, 90, null)).toEqual({ w: 600, h: 800 });
  });

  it('swaps source dims for 270°', () => {
    expect(computeEffectiveSize(source, 270, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for 0°', () => {
    expect(computeEffectiveSize(source, 0, null)).toEqual({ w: 800, h: 600 });
  });

  it('does not swap for 180°', () => {
    expect(computeEffectiveSize(source, 180, null)).toEqual({ w: 800, h: 600 });
  });

  it('crop replaces source dims when no rotate', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 0, crop)).toEqual({ w: 600, h: 400 });
  });

  it('crop dims swap on 90°', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 90, crop)).toEqual({ w: 400, h: 600 });
  });

  it('normalises negative angle (-90 → 270 → swap)', () => {
    expect(computeEffectiveSize(source, -90, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for angles within 1° of 0', () => {
    expect(computeEffectiveSize(source, 0.5, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps for angles within 1° of 90', () => {
    expect(computeEffectiveSize(source, 89.5, null)).toEqual({ w: 600, h: 800 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/image-node-geometry.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `computeEffectiveSize`**

Create `src/lib/image-node-geometry.ts`:

```ts
/**
 * Pure geometry helpers for the image-node rendering pipeline.
 * No React, no store, no DOM globals other than canvas operations.
 */

export interface Crop { x: number; y: number; w: number; h: number }
export interface Rotate { angle: number; flip_h: boolean; flip_v: boolean }
export interface Transforms { rotate?: Rotate; crop?: Crop }

/** Effective output dimensions for the visible canvas given source dims,
 *  rotation angle, and an optional source-coords crop. Rotation by 90°/270°
 *  swaps the effective width and height; 0° / 180° do not. Flip never swaps.
 *  Crop reduces dims to the crop rect's `w` / `h` before the swap. */
export function computeEffectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
  crop: Crop | null,
): { w: number; h: number } {
  const baseW = crop ? crop.w : source.w;
  const baseH = crop ? crop.h : source.h;
  if (rotateAngle == null) return { w: baseW, h: baseH };
  const a = ((rotateAngle % 360) + 360) % 360;
  const swap = Math.abs(a - 90) < 1 || Math.abs(a - 270) < 1;
  return swap ? { w: baseH, h: baseW } : { w: baseW, h: baseH };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-geometry.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-node-geometry.ts src/lib/image-node-geometry.test.ts
git commit -m "feat(geometry): computeEffectiveSize pure helper"
```

---

### Task 2: `applyGeometry` — identity case

**Files:**
- Modify: `src/lib/image-node-geometry.ts`
- Modify: `src/lib/image-node-geometry.test.ts`

- [ ] **Step 1: Add failing identity test**

Append to `src/lib/image-node-geometry.test.ts`:

```ts
import { vi } from 'vitest';
import { applyGeometry } from './image-node-geometry';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

describe('applyGeometry — identity', () => {
  it('clears the visible canvas and drawImage(internal, 0, 0)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {});

    expect(clearSpy).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    // 9-arg drawImage form: image, sx, sy, sw, sh, dx, dy, dw, dh
    expect(drawSpy).toHaveBeenCalledWith(internal, 0, 0, 800, 600, 0, 0, 800, 600);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/image-node-geometry.test.ts -t "applyGeometry — identity"`
Expected: FAIL — `applyGeometry` is not exported.

- [ ] **Step 3: Implement `applyGeometry`**

Append to `src/lib/image-node-geometry.ts`:

```ts
/** Apply the geometry pass: clear the visible canvas and draw from `internal`
 *  applying source-coords crop + rotation (about the visible-canvas centre) +
 *  flips. Assumes the caller has sized `visible` to the effective output dims
 *  computed via `computeEffectiveSize`. */
export function applyGeometry(
  internal: HTMLCanvasElement,
  visible: HTMLCanvasElement,
  transforms: Transforms,
): void {
  const ctx = visible.getContext('2d');
  if (!ctx) return;

  const crop = transforms.crop ?? { x: 0, y: 0, w: internal.width, h: internal.height };
  const angle = transforms.rotate?.angle ?? 0;
  const flipH = transforms.rotate?.flip_h ?? false;
  const flipV = transforms.rotate?.flip_v ?? false;

  ctx.clearRect(0, 0, visible.width, visible.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(visible.width / 2, visible.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.translate(-crop.w / 2, -crop.h / 2);
  ctx.drawImage(internal, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-geometry.test.ts -t "applyGeometry — identity"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-node-geometry.ts src/lib/image-node-geometry.test.ts
git commit -m "feat(geometry): applyGeometry identity case"
```

---

### Task 3: `applyGeometry` — rotate, flip, crop cases

**Files:**
- Modify: `src/lib/image-node-geometry.test.ts`

- [ ] **Step 1: Add the full case-coverage tests**

Append to `src/lib/image-node-geometry.test.ts`:

```ts
describe('applyGeometry — rotation', () => {
  it('rotate-90 issues rotate(π/2) and draws full internal at source dims', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800); // caller pre-sized to swapped dims
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { rotate: { angle: 90, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawSpy).toHaveBeenCalledWith(internal, 0, 0, 800, 600, 0, 0, 800, 600);
  });

  it('rotate-180 leaves visible dims at source (caller pre-sized to source)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, { rotate: { angle: 180, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI);
  });

  it('rotate-270 issues rotate(3π/2)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, { rotate: { angle: 270, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith((270 * Math.PI) / 180);
  });
});

describe('applyGeometry — flip', () => {
  it('flip-h calls scale(-1, 1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: false } });

    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
  });

  it('flip-v calls scale(1, -1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: false, flip_v: true } });

    expect(scaleSpy).toHaveBeenCalledWith(1, -1);
  });

  it('flip-both calls scale(-1, -1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: true } });

    expect(scaleSpy).toHaveBeenCalledWith(-1, -1);
  });
});

describe('applyGeometry — crop', () => {
  it('crop-only samples the crop rect into a same-sized visible canvas', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 400);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { crop: { x: 100, y: 50, w: 600, h: 400 } });

    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });

  it('crop-plus-rotate-90 keeps crop in source coords, rotates after', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(400, 600); // crop is 600×400, rotated → 400×600
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, {
      crop: { x: 100, y: 50, w: 600, h: 400 },
      rotate: { angle: 90, flip_h: false, flip_v: false },
    });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });

  it('crop-plus-flip-h samples crop, scales(-1, 1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 400);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {
      crop: { x: 100, y: 50, w: 600, h: 400 },
      rotate: { angle: 0, flip_h: true, flip_v: false },
    });

    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });
});

describe('applyGeometry — order of operations', () => {
  it('translate-rotate-scale-translate-drawImage in that sequence', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const calls: string[] = [];
    vi.spyOn(ctx, 'setTransform').mockImplementation(() => { calls.push('setTransform'); });
    vi.spyOn(ctx, 'translate').mockImplementation(() => { calls.push('translate'); });
    vi.spyOn(ctx, 'rotate').mockImplementation(() => { calls.push('rotate'); });
    vi.spyOn(ctx, 'scale').mockImplementation(() => { calls.push('scale'); });
    vi.spyOn(ctx, 'drawImage').mockImplementation(() => { calls.push('drawImage'); });

    applyGeometry(internal, visible, {
      rotate: { angle: 90, flip_h: true, flip_v: false },
    });

    // setTransform (reset), translate (to centre), rotate, scale (flip),
    // translate (to crop top-left), drawImage, setTransform (final reset).
    expect(calls).toEqual([
      'setTransform', 'translate', 'rotate', 'scale', 'translate', 'drawImage', 'setTransform',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-geometry.test.ts`
Expected: PASS (all describe blocks). The implementation already covers these cases — the new tests just pin down the contract.

- [ ] **Step 3: Commit**

```bash
git add src/lib/image-node-geometry.test.ts
git commit -m "test(geometry): rotate / flip / crop / order coverage"
```

---

### Task 4: Internal-canvas cache

**Files:**
- Modify: `src/lib/image-node-geometry.ts`
- Modify: `src/lib/image-node-geometry.test.ts`

- [ ] **Step 1: Add failing tests for the cache**

Append to `src/lib/image-node-geometry.test.ts`:

```ts
import { getInternalCanvas, clearInternalCanvasCache } from './image-node-geometry';

describe('internal-canvas cache', () => {
  beforeEach(() => {
    clearInternalCanvasCache();
  });

  it('returns the same canvas instance for the same imageNodeId', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-1', 800, 600);
    expect(a).toBe(b);
  });

  it('resizes the cached canvas when dims change but keeps the same instance', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-1', 1024, 768);
    expect(a).toBe(b);
    expect(b.width).toBe(1024);
    expect(b.height).toBe(768);
  });

  it('returns different instances for different imageNodeIds', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-2', 800, 600);
    expect(a).not.toBe(b);
  });

  it('clearInternalCanvasCache() drops all entries', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    clearInternalCanvasCache();
    const b = getInternalCanvas('in-1', 800, 600);
    expect(a).not.toBe(b);
  });

  it('clearInternalCanvasCache(id) drops only that entry', () => {
    const a1 = getInternalCanvas('in-1', 800, 600);
    const a2 = getInternalCanvas('in-2', 800, 600);
    clearInternalCanvasCache('in-1');
    const b1 = getInternalCanvas('in-1', 800, 600);
    const b2 = getInternalCanvas('in-2', 800, 600);
    expect(b1).not.toBe(a1);
    expect(b2).toBe(a2);
  });
});
```

`beforeEach` and `vi` are already imported from earlier blocks in the file.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/image-node-geometry.test.ts -t "internal-canvas cache"`
Expected: FAIL — `getInternalCanvas` / `clearInternalCanvasCache` not exported.

- [ ] **Step 3: Implement the cache**

Append to `src/lib/image-node-geometry.ts`:

```ts
const internalCache = new Map<string, HTMLCanvasElement>();

/** Returns a cached internal canvas for the given image-node id, sized at
 *  `w × h`. Reuses the same canvas instance across calls; resizes if dims
 *  changed. */
export function getInternalCanvas(imageNodeId: string, w: number, h: number): HTMLCanvasElement {
  let canvas = internalCache.get(imageNodeId);
  if (!canvas) {
    canvas = document.createElement('canvas');
    internalCache.set(imageNodeId, canvas);
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

/** Drop one entry or the whole cache. Called by `editorDocument.closeDocument()`. */
export function clearInternalCanvasCache(imageNodeId?: string): void {
  if (imageNodeId) internalCache.delete(imageNodeId);
  else internalCache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-geometry.test.ts -t "internal-canvas cache"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-node-geometry.ts src/lib/image-node-geometry.test.ts
git commit -m "feat(geometry): internal-canvas cache with explicit clear"
```

---

### Task 5: Renderer uses internal canvas + delegates to `applyGeometry`

**Files:**
- Modify: `src/lib/image-node-renderer.ts`
- Modify: `src/lib/image-node-renderer.test.tsx`

- [ ] **Step 1: Add the failing test**

Add to `src/lib/image-node-renderer.test.tsx`, after the existing tests, inside the same `describe('renderImageNodeComposite')` block:

```tsx
it('paints layers into the internal cache canvas, not directly into visible', () => {
  setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
  const visible = makeCanvas();
  const ctx = visible.getContext('2d');
  if (!ctx) throw new Error('expected a 2d context');
  const drawSpy = vi.spyOn(ctx, 'drawImage');

  renderImageNodeComposite({
    canvas: visible,
    imageNodeId: 'in-1',
    layerIds: ['L1'],
    sourceWidth: 8,
    sourceHeight: 8,
    opGraph: undefined,
    widgets: [],
  });

  // With the two-canvas split, the per-layer paint targets the internal canvas
  // (not the visible one). The visible canvas only receives one drawImage —
  // from applyGeometry, with the internal canvas as source.
  expect(drawSpy).toHaveBeenCalledTimes(1);
  const [src] = drawSpy.mock.calls[0];
  // The source is the internal cache canvas — distinct from fakeWorking.
  expect(src).not.toBe(fakeWorking);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx -t "paints layers into the internal cache canvas"`
Expected: FAIL — the renderer currently paints into `canvas` (the visible) directly.

- [ ] **Step 3: Refactor `image-node-renderer.ts` for the two-canvas split**

Open `src/lib/image-node-renderer.ts`. Make these changes:

1. Add imports at top:
   ```ts
   import { applyGeometry, getInternalCanvas, type Crop, type Rotate } from './image-node-geometry';
   ```

2. Update the `RenderImageNodeCompositeArgs` interface to add `sourceWidth` / `sourceHeight` (the internal canvas must hold the full source composite; visible dims alone aren't enough because crop shrinks them):

   ```ts
   export interface RenderImageNodeCompositeArgs {
     /** The visible canvas, pre-sized to effective output dims by the caller. */
     canvas: HTMLCanvasElement;
     imageNodeId: string;
     layerIds: string[];
     /** Source dims — what the per-layer pipeline composites into the internal cache. */
     sourceWidth: number;
     sourceHeight: number;
     opGraph: OperationGraph | undefined;
     widgets: Widget[];
     optimistic?: Map<string, OptimisticPatch>;
   }
   ```

3. Add a private helper `readTransforms` after the imports:

   ```ts
   function readTransforms(
     opGraph: OperationGraph | undefined,
     imageNodeId: string,
   ): { rotate?: Rotate; crop?: Crop } {
     const nodes = opGraph?.nodes ?? [];
     const r = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
     const c = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
     const rotate = r ? (r.params as unknown as Rotate) : undefined;
     const crop = c ? (c.params as unknown as Crop) : undefined;
     return { rotate, crop };
   }
   ```

4. Rewrite the body of `renderImageNodeComposite`:

   ```ts
   export function renderImageNodeComposite(args: RenderImageNodeCompositeArgs): void {
     const { canvas: visible, layerIds, opGraph, widgets, optimistic } = args;
     const visibleCtx = visible.getContext('2d');
     if (!visibleCtx) return;

     const internal = getInternalCanvas(args.imageNodeId, args.sourceWidth, args.sourceHeight);
     const ctx = internal.getContext('2d');
     if (!ctx) return;

     ctx.clearRect(0, 0, internal.width, internal.height);
     if (layerIds.length === 0) {
       visibleCtx.clearRect(0, 0, visible.width, visible.height);
       return;
     }

     const allLayers = useEditorStore.getState().layers;
     const layersById = new Map(allLayers.map((l) => [l.id, l] as const));
     const nodes = opGraph?.nodes ?? [];

     for (const layerId of layerIds) {
       const layer = layersById.get(layerId);
       if (!layer || !layer.visible) continue;
       const source = CanvasRegistry.get(layerId);
       if (!source) continue;

       const layerNodes = nodes.filter((n) => n.layer_id === layerId);
       const adjustments: Adjustment[] = layerNodes
         .map((n) => withOptimistic(n, optimistic))
         .map(nodeToAdjustment)
         .filter((a) => a.enabled);

       let rendered: HTMLCanvasElement | OffscreenCanvas;
       if (adjustments.length === 0) {
         rendered = source;
       } else {
         PipelineManager.setSourceCanvas(source);
         rendered = PipelineManager.renderSync(adjustments);
       }

       ctx.save();
       ctx.globalAlpha = layer.opacity;
       ctx.globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode] ?? 'source-over';
       ctx.drawImage(rendered, 0, 0, internal.width, internal.height);
       ctx.restore();
     }

     // ---- Composite-then-apply pass: node-scope adjustments (color only) ----
     const layerSetForComposite = new Set(layerIds);
     const nodeScopeNodes = nodes.filter((n) => {
       if (n.type === 'crop' || n.type === 'rotate') return false;
       const ids = n.layer_ids;
       return Array.isArray(ids) && ids.length > 0 && ids.every((lid) => layerSetForComposite.has(lid));
     });
     if (nodeScopeNodes.length > 0) {
       const nodeAdjustments: Adjustment[] = nodeScopeNodes
         .map((n) => withOptimistic(n, optimistic))
         .map(nodeToAdjustment)
         .filter((a) => a.enabled);
       if (nodeAdjustments.length > 0) {
         PipelineManager.setSourceCanvas(internal);
         const final = PipelineManager.renderSync(nodeAdjustments);
         ctx.clearRect(0, 0, internal.width, internal.height);
         ctx.drawImage(final, 0, 0, internal.width, internal.height);
       }
     }

     void widgets;

     // ---- Geometry pass: internal → visible at effective dims ---------------
     const transforms = readTransforms(opGraph, args.imageNodeId);
     applyGeometry(internal, visible, transforms);

     // ---- Overlay pass on the visible (post-transform) canvas ---------------
     paintOverlays({ ctx: visibleCtx, canvas: visible, imageNodeId: args.imageNodeId, layerIds });
   }
   ```

- [ ] **Step 4: Update the renderer test calls to pass `sourceWidth` / `sourceHeight`**

In `src/lib/image-node-renderer.test.tsx`, update every `renderImageNodeComposite({ ... })` call to also include `sourceWidth: 8, sourceHeight: 8` (matching the existing 8×8 makeCanvas dims). The existing tests pre-date the prop and need this addition.

For the new test added in Step 1, the call already needs `sourceWidth: 8, sourceHeight: 8`.

- [ ] **Step 5: Run tests to verify the suite passes**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx`
Expected: PASS — both the new and existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/image-node-renderer.ts src/lib/image-node-renderer.test.tsx
git commit -m "feat(renderer): two-canvas split delegating geometry to applyGeometry"
```

---

### Task 6: `useImageNodeRender` accepts source dims and sizes the visible canvas

**Files:**
- Modify: `src/hooks/useImageNodeRender.ts`

- [ ] **Step 1: Update the hook**

Open `src/hooks/useImageNodeRender.ts`. The current `ImageNodeRenderInput` has `width` and `height` (which were source dims). Rename and add transform reads + effective-size computation.

Make these changes:

1. Add imports:
   ```ts
   import { computeEffectiveSize } from '@/lib/image-node-geometry';
   ```

2. Update the input interface:
   ```ts
   export interface ImageNodeRenderInput {
     imageNodeId: string;
     layerIds: string[];
     sourceWidth: number;
     sourceHeight: number;
   }
   ```

3. Rename destructuring inside the hook from `{ imageNodeId, layerIds, width, height }` to `{ imageNodeId, layerIds, sourceWidth, sourceHeight }`.

4. After the existing store selectors at the top of the function body, add:
   ```ts
   // Effective output dims derived from the snapshot's rotate + crop nodes for
   // this image-node. The visible canvas is sized to these; `applyGeometry`
   // inside the renderer then maps the internal (source-dims) composite onto it.
   const rotateAngle = useBackendState((s) => {
     const node = s.snapshot?.operation_graph.nodes.find(
       (n) => n.id === `transform:${imageNodeId}:rotate`,
     );
     if (!node) return null;
     return (node.params.angle as number) ?? null;
   });
   const cropRect = useBackendState((s) => {
     const node = s.snapshot?.operation_graph.nodes.find(
       (n) => n.id === `transform:${imageNodeId}:crop`,
     );
     if (!node) return null;
     const p = node.params as { x?: number; y?: number; w?: number; h?: number };
     if (p.w == null || p.h == null) return null;
     return { x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h };
   });
   const eff = computeEffectiveSize(
     { w: sourceWidth, h: sourceHeight },
     rotateAngle,
     cropRect,
   );
   ```

5. Inside the existing `useEffect`, replace `width` / `height` references:
   ```ts
   const backingW = Math.max(1, Math.round(eff.w * renderScale));
   const backingH = Math.max(1, Math.round(eff.h * renderScale));
   if (canvas.width !== backingW) canvas.width = backingW;
   if (canvas.height !== backingH) canvas.height = backingH;
   renderImageNodeComposite({
     canvas,
     imageNodeId,
     layerIds,
     sourceWidth,
     sourceHeight,
     opGraph,
     widgets,
     optimistic,
   });
   ```

6. Update the `useEffect` dependencies to include `eff.w`, `eff.h`, `sourceWidth`, `sourceHeight` and drop the old `width` / `height`:
   ```ts
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
   ]);
   ```

- [ ] **Step 2: Verify build**

Run: `npm run check`
Expected: `tsc -b` fails because `ImageNodeBody.tsx` and `ImageNode.tsx` still call the hook with the old prop names. That's fine — Tasks 7 + 8 fix them. Move on.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useImageNodeRender.ts
git commit -m "feat(hook): useImageNodeRender takes source dims + reads transforms"
```

---

### Task 7: `ImageNodeBody` uses the new prop names

**Files:**
- Modify: `src/components/workspace/ImageNodeBody.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the contents of `src/components/workspace/ImageNodeBody.tsx`:

```tsx
import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  sourceWidth: number;
  sourceHeight: number;
}

export function ImageNodeBody({ imageNodeId, layerIds, sourceWidth, sourceHeight }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({
    imageNodeId, layerIds, sourceWidth, sourceHeight,
  });
  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{ display: 'block' }}
    />
  );
}
```

Notes:
- No explicit `width` / `height` CSS — the hook sets `canvas.width` and `canvas.height` (backing store), and a canvas without explicit CSS size renders at its intrinsic backing size.
- No CSS transform, no clip-path. Geometry is the renderer's responsibility now.

- [ ] **Step 2: Verify**

`npm run check` still type-fails on `ImageNode.tsx` (it passes the old prop names). That's expected — Task 8 fixes it.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/ImageNodeBody.tsx
git commit -m "refactor(image-node): ImageNodeBody just renders a sized canvas"
```

---

### Task 8: `ImageNode` reads transforms via the geometry helper

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`

- [ ] **Step 1: Refactor `ImageNode.tsx`**

Open `src/components/workspace/ImageNode.tsx`. Make these changes:

1. Replace the local `effectiveSize` helper at the top of the file. Delete the existing function (lines around 15–25 of the current file) and import it instead:
   ```ts
   import { computeEffectiveSize, type Crop } from '@/lib/image-node-geometry';
   ```

2. Inside the component body, replace the existing `rotateAngle` selector + `size = effectiveSize(...)` call. The new code reads BOTH rotate and crop from the snapshot, then uses `computeEffectiveSize` so the effective dims account for crop too:

   ```ts
   const rotateAngle = useBackendState((s) => {
     const node = s.snapshot?.operation_graph.nodes.find(
       (n) => n.id === `transform:${id}:rotate`,
     );
     if (!node) return null;
     return (node.params.angle as number) ?? null;
   });
   const cropRect = useBackendState((s): Crop | null => {
     const node = s.snapshot?.operation_graph.nodes.find(
       (n) => n.id === `transform:${id}:crop`,
     );
     if (!node) return null;
     const p = node.params as { x?: number; y?: number; w?: number; h?: number };
     if (p.w == null || p.h == null) return null;
     return { x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h };
   });

   const size = computeEffectiveSize(data.size, rotateAngle, cropRect);
   ```

3. Find the `<ImageNodeBody>` JSX and update its props:
   ```tsx
   <ImageNodeBody
     imageNodeId={id}
     layerIds={data.layerIds}
     sourceWidth={data.size.w}
     sourceHeight={data.size.h}
   />
   ```

4. Leave the outer wrapper `<div style={{ width: size.w + 2 }}>` and the footer `{size.w} × {size.h}` as they are — they already use `size` (the effective dims), and now `size` correctly accounts for crop.

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: PASS — TypeScript clean, all tests pass (the 4 pre-existing Levels warnings and 2 jsdom DOMMatrixReadOnly errors are fine).

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/ImageNode.tsx
git commit -m "refactor(image-node): use computeEffectiveSize from geometry module"
```

---

### Task 9: `closeDocument` clears the internal-canvas cache

**Files:**
- Modify: `src/core/document.ts`

- [ ] **Step 1: Wire the cache clear**

In `src/core/document.ts`, find `function closeDocument()` (around line 146). Add the import at the top of the file:

```ts
import { clearInternalCanvasCache } from '@/lib/image-node-geometry';
```

Inside `closeDocument()`, after the existing `useEditorStore.getState().resetWorkspace()` line, add:

```ts
clearInternalCanvasCache();
```

The final `closeDocument` body should read:

```ts
function closeDocument(): void {
  pixelStore.clear();
  history.clear();
  useBackendState.getState().reset();
  useEditorStore.getState().resetWorkspace();
  clearInternalCanvasCache();
  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      documentMeta: null,
      isDirty: false,
    });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/document.ts
git commit -m "fix(document): clear internal-canvas cache on closeDocument"
```

---

### Task 10: Smoke test + final check

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: PASS (4 pre-existing Levels warnings + 2 jsdom DOMMatrixReadOnly errors are fine).

- [ ] **Step 2: Boot the app and verify each case manually**

Run: `npm run dev` (plus the backend per project standard).

In the browser:
1. Open an image. Menu → **Rotate 90° CW**: image rotates 90°; image-node bounds grow taller and narrower; footer pixel-count shows swapped dims (e.g., `1600 × 2400` for a 2400×1600 source).
2. Click **Rotate 90° CW** three more times: returns to original orientation, original dims.
3. **Flip Horizontal**: image mirrors; dims unchanged.
4. **Flip Vertical**: flips vertically; dims unchanged.
5. Rotate 90° + Flip H: combined.
6. **Crop…**: modal opens; drag bottom-right handle inward; mask updates live; image bounds shrink to crop dims when you commit; footer shows crop dims.
7. Rotate 90° + Crop: combined; image bounds = swapped crop dims.
8. Reload the page: rotate + crop + flip persist (backend-driven).

- [ ] **Step 3: Final commit if any auto-fixes happened**

```bash
git status
# If anything was modified by lint/format, stage + commit; otherwise skip.
```
