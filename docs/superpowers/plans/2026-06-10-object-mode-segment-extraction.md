# Object Mode + Segment Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the ImageNode footer from "Layer N/M" to "Objects N", make SAM `CandidateRegion`s the primary interactive unit on the canvas, and add drag-out / drop-back-as-child-layer for any object.

**Architecture:** Re-merge is a child layer via `parentLayerId` + `layerMask` (reuses existing WebGL compositing). PNG is the canonical mask form for compositing; auto-traced polygons drive hover, outline, and hit-test. Phases 1–3 ship the USP using the backend SAM 2 path already in place; phase 4 adds browser MobileSAM (ORT-Web + WebGPU) for sub-100 ms click refinement and is **independently deferrable** — if WebGPU isn't available at runtime the same UI falls back to the existing backend SAM 2 path via a new `propose_mask` MCP tool.

**Tech Stack:** React 19 + Vite + TypeScript strict; Zustand v5 + Immer; React Flow for canvas; custom WebGL shaders + 2D Canvas composite for layer pipeline; Comlink/Web Workers for heavy compute; SSE-based MCP backend at `/api/analyze` and `/api/mcp`; ONNX Runtime Web 1.17+ with WebGPU EP (phase 4).

**Conventions:** Strict TS; named Lucide icon imports; design tokens in `src/index.css` only; 3-tier components (primitives → topic folders → page scaffolds); no inline-defined components (lint-enforced via `no-nested-component`); tests live next to source as `*.test.ts(x)` (Vitest); `npm run check` must pass before every commit.

---

## File Structure

### Phase 1 — Object-mode footer + click-select

| File | Responsibility | Action |
|---|---|---|
| `src/lib/segmentation/mask-utils.ts` | Pure helpers: `pointInPolygon`, `polygonsAtPoint`, `bboxOfPaths`, polygon transforms from normalised → image px. | Create |
| `src/lib/segmentation/mask-utils.test.ts` | Unit tests for the above. | Create |
| `src/lib/segmentation/segment-store.ts` | In-memory cache keyed by `imageNodeId`: `{ regions: CandidateRegion[]; pathCache: ImagePolygons }`. Decouples render layer from the AI session. | Create |
| `src/lib/segmentation/segment-store.test.ts` | Unit tests. | Create |
| `src/store/workspace-slice.ts` | Add `imageNodeMode: Record<string, 'layers' \| 'objects'>` and `setImageNodeMode(id, mode)`. UI-only; cleared with `resetWorkspace`. | Modify |
| `src/store/workspace-slice.test.ts` | Existing tests — extend for new field. | Modify |
| `src/components/workspace/ObjectModeFooter.tsx` | Footer cell rendered by `ImageNode` chrome strip. Renders mode pill `[ Layers ] [ Objects · N ]` and toggles `workspaceSlice.imageNodeMode`. | Create |
| `src/components/workspace/ObjectModeFooter.test.tsx` | Render-test the toggle + the count text. | Create |
| `src/components/workspace/SegmentHitLayer.tsx` | Pointer-event sibling `<canvas>` over the ImageNode body. Reads `segment-store` polygons for this `imageNodeId`, hit-tests against them, dispatches `selection.clickAt` / `setHoveredScope`. | Create |
| `src/components/workspace/SegmentHitLayer.test.tsx` | RTL test: hover sets `hoveredScope`; click sets `activeScope`. | Create |
| `src/components/workspace/ImageNode.tsx` | Replace the static `Layer N/M` span with `<ObjectModeFooter />`. Mount `<SegmentHitLayer />` when `imageNodeMode[id] === 'objects'`. | Modify (lines ~330–353) |
| `src/components/workspace/SegmentOverlay.tsx` | NEW pure-paint canvas: draws hover + selected polygon outlines using design tokens. | Create |
| `src/components/workspace/SegmentOverlay.test.tsx` | Snapshot test (rectangle outline path). | Create |
| `src/index.css` | Add `--accent-hover` and `--accent-selected` color tokens. | Modify |
| `src/hooks/useSegmentInteraction.ts` | Bridges `useAiSession.context.candidateRegions` (current image's layer) into `segment-store` whenever it changes; reads `imageNodeMode` to gate. | Create |
| `src/hooks/useSegmentInteraction.test.ts` | Test the bridge writes regions into the store. | Create |

### Phase 2 — Drag-out → standalone ImageNode

| File | Responsibility | Action |
|---|---|---|
| `src/types/workspace.ts` | Extend `ImageNodeState` with optional `origin: { kind: 'file' } \| { kind: 'extracted'; sourceImageNodeId; sourceMaskId; sourceOffset; sourceSize }`. Extend `TetherEdgeState.scope` union with `{ kind: 'extracted-from'; maskId: string }`. | Modify |
| `src/lib/workspace/segment-extraction.ts` | Pure pipeline: given (sourceCanvas, mask `Uint8Array`, bbox) → returns `{ bitmap: OffscreenCanvas; bbox; bboxPx }`. | Create |
| `src/lib/workspace/segment-extraction.test.ts` | Unit test on a 2×2 mask synthetic case. | Create |
| `src/store/workspace-slice.ts` | Add `addExtractedImageNode(args)` action that creates a node with `origin.kind = 'extracted'` and inserts a persistent tether edge. | Modify |
| `src/store/workspace-slice.test.ts` | Test the new action. | Modify |
| `src/hooks/useSegmentExtraction.ts` | Drag handler: on Alt-drag-start over a selected segment, registers a ghost cursor; on drag-end, calls `editorDocument.workspace.extractSegment(...)`. | Create |
| `src/hooks/useSegmentExtraction.test.ts` | Unit-level test driving the hook against a mocked store. | Create |
| `src/core/document.ts` | Add `editorDocument.workspace.extractSegment({ imageNodeId, maskId, dropPosition })` — calls `addLayer` + `addExtractedImageNode` in one history snapshot. | Modify |
| `src/components/workspace/ImageNode.tsx` | Wire Alt-drag handler on `SegmentHitLayer` → `useSegmentExtraction`. | Modify |
| `src/components/workspace/TetherEdge.tsx` | Render `extracted-from` tether edges with dashed style + small "from" badge. | Modify |

### Phase 3 — Drop-back → re-merge as child layer

| File | Responsibility | Action |
|---|---|---|
| `src/lib/workspace/segment-remerge.ts` | Pure: given (extractedNode, dropCoords, sourceNode) → returns `{ parentLayerId, layerMask, positionDelta }`. | Create |
| `src/lib/workspace/segment-remerge.test.ts` | Unit tests. | Create |
| `src/hooks/useSegmentRemerge.ts` | React Flow drag-stop intersection handler: detects drop-on-source for extracted nodes; calls `editorDocument.workspace.remergeExtractedNode(...)`. | Create |
| `src/hooks/useSegmentRemerge.test.ts` | Unit test driving handler with a synthetic intersection. | Create |
| `src/core/document.ts` | Add `editorDocument.workspace.remergeExtractedNode({ extractedNodeId, dropPosition })` — single history snapshot: appends a child layer with `parentLayerId` + `layerMask`, removes the extracted node + its tether edge. | Modify |
| `src/components/workspace/ImageNode.tsx` | Add inset-glow hover affordance when an extracted node hovers over its source. | Modify |

### Phase 4 — MobileSAM browser refinement (deferrable)

| File | Responsibility | Action |
|---|---|---|
| `src/lib/segmentation/mobile-sam-types.ts` | Shared types: `SamPoint`, `EncoderEmbedding`, `DecoderInput`, `DecoderOutput`. | Create |
| `src/lib/segmentation/mobile-sam-client.ts` | Wraps ORT-Web + WebGPU sessions. Lazy-loads encoder/decoder ONNX. Exposes `encode(imageBitmap): Promise<EncoderEmbedding>` and `decode(embedding, points): Promise<Uint8Array>`. | Create |
| `src/lib/segmentation/mobile-sam-client.test.ts` | Mock ORT-Web; assert lifecycle (load once, reuse session). | Create |
| `src/lib/segmentation/sam-capability.ts` | Pure: `async detectSamCapability(): Promise<'webgpu' \| 'wasm' \| 'backend'>`. WebGPU probe via `navigator.gpu?.requestAdapter()`. | Create |
| `src/lib/segmentation/sam-capability.test.ts` | Mock navigator.gpu. | Create |
| `src/lib/segmentation/segment-store.ts` | Extend with `embeddings: Map<imageNodeId, EncoderEmbedding>`. | Modify |
| `src/hooks/useMobileSam.ts` | Lazy-loads encoder once per visible ImageNode; commits embedding into segment-store. Falls back to backend path when capability !== 'webgpu' and 'wasm' is disallowed. | Create |
| `src/hooks/useMobileSam.test.ts` | Driven against mocked client. | Create |
| `src/components/workspace/SegmentHitLayer.tsx` | Extend: shift-click → positive point prompt → call `useMobileSam.decode(...)` → live preview polygon; Enter commits via `propose_mask`. | Modify |
| `src/lib/mcp/backend-tools.ts` (existing) | Add `propose_mask({ image_node_id, png_base64, paths, label?, origin }) → { mask_id, mask_summary }`. | Modify |
| `public/models/mobile-sam/mobile_sam_encoder.onnx` | Vendor binary (~10 MB). | Create |
| `public/models/mobile-sam/mobile_sam_decoder.onnx` | Vendor binary (~16 MB INT8). | Create |
| `vite.config.ts` | Ensure ORT WASM artifacts are served from `/onnxruntime/`. | Modify |

### Phase 5 — Polish

| File | Responsibility | Action |
|---|---|---|
| `src/components/workspace/SegmentHitLayer.tsx` | Add Escape-to-clear, keyboard arrow-cycle through regions, click outside segments to clear. | Modify |
| `src/components/workspace/ObjectModeFooter.tsx` | Add a context-menu "Extract" action that mirrors Alt-drag. | Modify |
| `src/lib/keyboard-shortcuts.ts` | Add `O` to toggle objects/layers mode on the active ImageNode. | Modify |

---

## Phase 1: Object-mode footer + click-select

Goal: ship the SAM-derived `CandidateRegion`s as a primary unit on the canvas. After this phase, the user can: toggle a node into Objects mode; hover SAM regions and see the outline; click to set `activeScope = { kind: 'mask', mask_id }`; toolrail spawns automatically scope to the clicked object (existing `toolrail-spawn.ts` already reads `activeScope`).

### Task 1.1: Add design tokens for segment outlines

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add the tokens to `:root`**

Find the existing token block in `src/index.css` and add (place near other accent tokens):

```css
  --accent-hover: oklch(0.74 0.18 235);     /* cyan hover outline */
  --accent-selected: oklch(0.62 0.22 290);  /* violet selected outline */
  --accent-extracted: oklch(0.78 0.16 65);  /* amber extracted-from tether */
```

- [ ] **Step 2: Run lint to verify CSS is parsed**

Run: `npm run check`
Expected: PASS (no lint regressions; pre-existing errors in `curves.tsx` / `levels.tsx` / `BackendStatusBar.tsx` may remain — they are unrelated).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(canvas): add segment outline color tokens"
```

### Task 1.2: Pure mask-utils — pointInPolygon + polygonsAtPoint

**Files:**
- Create: `src/lib/segmentation/mask-utils.ts`
- Test: `src/lib/segmentation/mask-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/segmentation/mask-utils.test.ts
import { describe, it, expect } from 'vitest';
import { pointInPolygon, polygonsAtPoint, bboxOfPaths } from './mask-utils';
import type { RegionPolygon } from '@/types/image-context';

const square: RegionPolygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
const triangle: RegionPolygon = [[0, 0], [0.5, 0], [0.25, 0.5]];

describe('pointInPolygon', () => {
  it('returns true for a point strictly inside', () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
  });
  it('returns false for a point strictly outside', () => {
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
  });
  it('handles a triangle', () => {
    expect(pointInPolygon([0.25, 0.1], triangle)).toBe(true);
    expect(pointInPolygon([0.25, 0.6], triangle)).toBe(false);
  });
});

describe('polygonsAtPoint', () => {
  it('returns ids of regions whose paths contain the point', () => {
    const regions = [
      { id: 'a', paths: [square] },
      { id: 'b', paths: [triangle] },
    ];
    expect(polygonsAtPoint([0.25, 0.1], regions)).toEqual(['a', 'b']);
    expect(polygonsAtPoint([0.9, 0.9], regions)).toEqual(['a']);
  });
  it('returns [] when nothing matches', () => {
    expect(polygonsAtPoint([2, 2], [{ id: 'a', paths: [square] }])).toEqual([]);
  });
});

describe('bboxOfPaths', () => {
  it('returns [x, y, w, h] in normalised coords', () => {
    expect(bboxOfPaths([square])).toEqual([0, 0, 1, 1]);
    expect(bboxOfPaths([triangle])).toEqual([0, 0, 0.5, 0.5]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/segmentation/mask-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/segmentation/mask-utils.ts
import type { RegionPolygon } from '@/types/image-context';

/** Standard ray-casting point-in-polygon. Point and polygon in any
 *  coordinate space (caller's convention). */
export function pointInPolygon(point: [number, number], poly: RegionPolygon): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface PolygonRegion {
  id: string;
  paths: RegionPolygon[];
}

/** Returns ids of regions whose ANY polygon contains the point. */
export function polygonsAtPoint(
  point: [number, number],
  regions: PolygonRegion[],
): string[] {
  const hits: string[] = [];
  for (const region of regions) {
    for (const poly of region.paths) {
      if (pointInPolygon(point, poly)) {
        hits.push(region.id);
        break;
      }
    }
  }
  return hits;
}

/** Normalised-coord bbox enclosing every path. Returns [x, y, w, h]. */
export function bboxOfPaths(paths: RegionPolygon[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of paths) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX - minX, maxY - minY];
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/segmentation/mask-utils.test.ts`
Expected: PASS — 3 suites, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/mask-utils.ts src/lib/segmentation/mask-utils.test.ts
git commit -m "feat(segmentation): pure point-in-polygon + region hit-test helpers"
```

### Task 1.3: Segment store — in-memory polygon cache per ImageNode

**Files:**
- Create: `src/lib/segmentation/segment-store.ts`
- Test: `src/lib/segmentation/segment-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/segmentation/segment-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { segmentStore } from './segment-store';
import type { CandidateRegion } from '@/types/image-context';

const r = (id: string): CandidateRegion => ({
  label: id, description: '',
  paths: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  maskRef: id,
});

beforeEach(() => segmentStore.clearAll());

describe('segmentStore', () => {
  it('stores and retrieves regions for an ImageNode', () => {
    segmentStore.setRegions('in-1', [r('a'), r('b')]);
    expect(segmentStore.getRegions('in-1').map((x) => x.label)).toEqual(['a', 'b']);
  });

  it('clear by id removes only one node', () => {
    segmentStore.setRegions('in-1', [r('a')]);
    segmentStore.setRegions('in-2', [r('b')]);
    segmentStore.clear('in-1');
    expect(segmentStore.getRegions('in-1')).toEqual([]);
    expect(segmentStore.getRegions('in-2')).toHaveLength(1);
  });

  it('clearAll wipes every node', () => {
    segmentStore.setRegions('in-1', [r('a')]);
    segmentStore.clearAll();
    expect(segmentStore.getRegions('in-1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/lib/segmentation/segment-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/segmentation/segment-store.ts
import type { CandidateRegion } from '@/types/image-context';

class SegmentStoreImpl {
  private regions = new Map<string, CandidateRegion[]>();

  setRegions(imageNodeId: string, regions: CandidateRegion[]): void {
    this.regions.set(imageNodeId, [...regions]);
  }

  getRegions(imageNodeId: string): CandidateRegion[] {
    return this.regions.get(imageNodeId) ?? [];
  }

  clear(imageNodeId: string): void {
    this.regions.delete(imageNodeId);
  }

  clearAll(): void {
    this.regions.clear();
  }
}

export const segmentStore = new SegmentStoreImpl();
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/segmentation/segment-store.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/segment-store.ts src/lib/segmentation/segment-store.test.ts
git commit -m "feat(segmentation): in-memory per-ImageNode region cache"
```

### Task 1.4: Workspace slice — imageNodeMode per node

**Files:**
- Modify: `src/store/workspace-slice.ts`
- Modify: `src/store/workspace-slice.test.ts` (if it exists; otherwise add one)

- [ ] **Step 1: Add the failing test**

Append to `src/store/workspace-slice.test.ts` (create the file if it does not exist with a minimal harness — see existing slice tests for the pattern):

```ts
// add inside the existing describe block, or wrap in a new one
describe('imageNodeMode', () => {
  it('defaults to undefined when not set (caller treats as "objects")', () => {
    const store = createTestStore();
    store.addImageNode(['l1']);
    expect(store.getState().imageNodeMode).toEqual({});
  });

  it('setImageNodeMode persists the mode per node', () => {
    const store = createTestStore();
    const id = store.addImageNode(['l1']);
    store.setImageNodeMode(id, 'layers');
    expect(store.getState().imageNodeMode[id]).toBe('layers');
    store.setImageNodeMode(id, 'objects');
    expect(store.getState().imageNodeMode[id]).toBe('objects');
  });

  it('resetWorkspace clears it', () => {
    const store = createTestStore();
    const id = store.addImageNode(['l1']);
    store.setImageNodeMode(id, 'layers');
    store.resetWorkspace();
    expect(store.getState().imageNodeMode).toEqual({});
  });
});
```

(If a `createTestStore` helper does not exist in the file, mirror the pattern used by the other slice tests in the repo — typically `create<WorkspaceSlice>()(immer((set) => ({...createWorkspaceSlice(set, get, store)})))`.)

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/store/workspace-slice.test.ts`
Expected: FAIL — `setImageNodeMode` is not a function.

- [ ] **Step 3: Extend the slice interface**

In `src/store/workspace-slice.ts`, inside `interface WorkspaceSlice`, add (just before `_nextNodeSeq`):

```ts
  /** Per-ImageNode UI-only display mode. Absent ⇒ default 'objects'
   *  when `candidateRegions.length > 0`, else 'layers'. UI-only;
   *  not part of the snapshot SSoT. */
  imageNodeMode: Record<string, 'layers' | 'objects'>;
```

And just before `resetWorkspace` in the interface:

```ts
  setImageNodeMode: (id: string, mode: 'layers' | 'objects') => void;
```

- [ ] **Step 4: Implement in the slice factory**

In the same file, inside `createWorkspaceSlice`, after `activeImageNodeId: null,`:

```ts
  imageNodeMode: {},
```

After `setWorkspaceViewport`, add:

```ts
  setImageNodeMode: (id, mode) =>
    set((state) => {
      state.imageNodeMode[id] = mode;
    }),
```

Inside `resetWorkspace`, add:

```ts
      state.imageNodeMode = {};
```

Inside `removeImageNode` (after the cascade block), add:

```ts
      delete state.imageNodeMode[id];
```

- [ ] **Step 5: Verify pass**

Run: `npx vitest run src/store/workspace-slice.test.ts`
Expected: PASS — new tests green; existing tests unchanged.

- [ ] **Step 6: Verify the whole project compiles**

Run: `npm run check`
Expected: no NEW TS or lint errors (pre-existing errors unrelated to this phase may persist).

- [ ] **Step 7: Commit**

```bash
git add src/store/workspace-slice.ts src/store/workspace-slice.test.ts
git commit -m "feat(workspace): per-ImageNode display-mode toggle (layers|objects)"
```

### Task 1.5: ObjectModeFooter component

**Files:**
- Create: `src/components/workspace/ObjectModeFooter.tsx`
- Test: `src/components/workspace/ObjectModeFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/workspace/ObjectModeFooter.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectModeFooter } from './ObjectModeFooter';
import { useEditorStore } from '@/store';

describe('ObjectModeFooter', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('renders Layers and Objects pills with counts', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="objects"
      />,
    );
    expect(screen.getByRole('button', { name: /Layers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Objects · 5/ })).toBeInTheDocument();
  });

  it('clicking Layers writes "layers" mode to the store', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="objects"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    expect(useEditorStore.getState().imageNodeMode['in-1']).toBe('layers');
  });

  it('clicking Objects writes "objects" mode', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="layers"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Objects · 5/ }));
    expect(useEditorStore.getState().imageNodeMode['in-1']).toBe('objects');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/components/workspace/ObjectModeFooter.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/workspace/ObjectModeFooter.tsx
import { useEditorStore } from '@/store';

interface ObjectModeFooterProps {
  imageNodeId: string;
  layerCount: number;
  objectCount: number;
  currentMode: 'layers' | 'objects';
}

function PillButton({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'px-1.5 py-0.5 rounded-[3px] text-[9px] font-sans leading-none transition-[background,color] duration-[120ms]',
        active
          ? 'bg-accent-selected/15 text-text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary/40',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function ObjectModeFooter({
  imageNodeId, layerCount, objectCount, currentMode,
}: ObjectModeFooterProps) {
  const setMode = useEditorStore((s) => s.setImageNodeMode);
  return (
    <div className="flex items-center gap-1">
      <PillButton
        active={currentMode === 'layers'}
        label={`Layers · ${layerCount}`}
        onClick={() => setMode(imageNodeId, 'layers')}
      />
      <PillButton
        active={currentMode === 'objects'}
        label={`Objects · ${objectCount}`}
        onClick={() => setMode(imageNodeId, 'objects')}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/components/workspace/ObjectModeFooter.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ObjectModeFooter.tsx src/components/workspace/ObjectModeFooter.test.tsx
git commit -m "feat(canvas): ObjectModeFooter — Layers/Objects pill toggle"
```

### Task 1.6: Wire ObjectModeFooter into ImageNode

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx` (lines ~330–340)

- [ ] **Step 1: Import and read mode**

Near the top of `ImageNode` (in the component body, after the existing `useEditorStore` calls), add:

```tsx
  const imageNodeMode = useEditorStore((s) => s.imageNodeMode[data.id]);
  const objectCount = useAiSession((s) => s.context?.candidateRegions?.length ?? 0);
  const currentMode: 'layers' | 'objects' =
    imageNodeMode ?? (objectCount > 0 ? 'objects' : 'layers');
```

(Add `useAiSession` to imports if not already present: `import { useAiSession } from '@/hooks/useImageContext';`.)

Add `ObjectModeFooter` import at the top of the file:

```tsx
import { ObjectModeFooter } from './ObjectModeFooter';
```

- [ ] **Step 2: Replace the Layer N/M span**

Find the existing line (~337):

```tsx
            <span>Layer {(data.activeLayerIndex ?? 0) + 1}/{data.layerIds.length}</span>
```

Replace with:

```tsx
            <ObjectModeFooter
              imageNodeId={data.id}
              layerCount={data.layerIds.length}
              objectCount={objectCount}
              currentMode={currentMode}
            />
```

- [ ] **Step 3: Run the existing ImageNode test**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: tests that asserted the old `Layer 1/1` text fail — update the assertion to look for `Layers · 1` and `Objects · 0` pills. If no such assertion exists, the test still passes.

- [ ] **Step 4: Verify check**

Run: `npm run check`
Expected: no new TS / lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(canvas): replace static layer count with ObjectModeFooter"
```

### Task 1.7: SegmentOverlay — pure outline painter

**Files:**
- Create: `src/components/workspace/SegmentOverlay.tsx`
- Test: `src/components/workspace/SegmentOverlay.test.tsx`

- [ ] **Step 1: Write failing test (render snapshot)**

```tsx
// src/components/workspace/SegmentOverlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentOverlay } from './SegmentOverlay';

describe('SegmentOverlay', () => {
  it('renders an svg with one path per region path', () => {
    const { container } = render(
      <SegmentOverlay
        widthPx={200}
        heightPx={100}
        hoveredPolygons={[[[0, 0], [1, 0], [1, 1], [0, 1]]]}
        selectedPolygons={[]}
      />,
    );
    const paths = container.querySelectorAll('svg path');
    expect(paths).toHaveLength(1);
  });

  it('renders both hovered and selected polygons', () => {
    const { container } = render(
      <SegmentOverlay
        widthPx={200}
        heightPx={100}
        hoveredPolygons={[[[0, 0], [1, 0], [1, 1], [0, 1]]]}
        selectedPolygons={[[[0, 0], [0.5, 0], [0.25, 0.5]]]}
      />,
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/components/workspace/SegmentOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/workspace/SegmentOverlay.tsx
import type { RegionPolygon } from '@/types/image-context';

interface SegmentOverlayProps {
  widthPx: number;
  heightPx: number;
  hoveredPolygons: RegionPolygon[];
  selectedPolygons: RegionPolygon[];
}

function pathFromPolygon(p: RegionPolygon, w: number, h: number): string {
  if (p.length === 0) return '';
  return p
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x * w} ${y * h}`)
    .join(' ') + ' Z';
}

export function SegmentOverlay({
  widthPx, heightPx, hoveredPolygons, selectedPolygons,
}: SegmentOverlayProps) {
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={widthPx}
      height={heightPx}
      aria-hidden
    >
      {hoveredPolygons.map((poly, i) => (
        <path
          key={`h-${i}`}
          d={pathFromPolygon(poly, widthPx, heightPx)}
          fill="none"
          stroke="var(--accent-hover)"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.85}
        />
      ))}
      {selectedPolygons.map((poly, i) => (
        <path
          key={`s-${i}`}
          d={pathFromPolygon(poly, widthPx, heightPx)}
          fill="none"
          stroke="var(--accent-selected)"
          strokeWidth={1.5}
          opacity={0.95}
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/components/workspace/SegmentOverlay.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/SegmentOverlay.tsx src/components/workspace/SegmentOverlay.test.tsx
git commit -m "feat(canvas): SegmentOverlay — pure SVG outline painter for SAM regions"
```

### Task 1.8: SegmentHitLayer — pointer interaction layer

**Files:**
- Create: `src/components/workspace/SegmentHitLayer.tsx`
- Test: `src/components/workspace/SegmentHitLayer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/workspace/SegmentHitLayer.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SegmentHitLayer } from './SegmentHitLayer';
import { useEditorStore } from '@/store';
import { segmentStore } from '@/lib/segmentation/segment-store';

const region = (id: string, label: string) => ({
  label,
  description: '',
  paths: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]] as [number, number][]],
  maskRef: id,
});

describe('SegmentHitLayer', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
    segmentStore.clearAll();
    segmentStore.setRegions('in-1', [region('mask-a', 'dog'), region('mask-b', 'sky')]);
  });

  it('click on a region sets activeScope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    // Click at canvas (50, 50) = normalised (0.125, 0.167) — inside both regions (same paths).
    fireEvent.click(layer, { clientX: 50, clientY: 50 });
    const scope = useEditorStore.getState().activeScope;
    expect(scope.kind).toBe('mask');
  });

  it('pointer-move sets hoveredScope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    expect(useEditorStore.getState().hoveredScope?.kind).toBe('mask');
  });

  it('pointer-move outside any region clears hoveredScope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 350, clientY: 250 });
    expect(useEditorStore.getState().hoveredScope).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/components/workspace/SegmentHitLayer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/workspace/SegmentHitLayer.tsx
import { useCallback, useMemo, useRef } from 'react';
import { useEditorStore } from '@/store';
import { segmentStore } from '@/lib/segmentation/segment-store';
import { polygonsAtPoint } from '@/lib/segmentation/mask-utils';
import { useAiSession } from '@/hooks/useImageContext';
import { SegmentOverlay } from './SegmentOverlay';
import type { RegionPolygon } from '@/types/image-context';

interface SegmentHitLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}

interface HitRegion {
  id: string;
  paths: RegionPolygon[];
}

function readHitRegions(imageNodeId: string): HitRegion[] {
  return segmentStore
    .getRegions(imageNodeId)
    .filter((r) => r.maskRef && r.paths && r.paths.length > 0)
    .map((r) => ({ id: r.maskRef!, paths: r.paths! }));
}

function findPolygonsForMaskId(regions: HitRegion[], maskId: string | undefined): RegionPolygon[] {
  if (!maskId) return [];
  const r = regions.find((x) => x.id === maskId);
  return r ? r.paths : [];
}

function clientToNormalised(
  evt: { clientX: number; clientY: number },
  el: HTMLElement,
): [number, number] {
  const rect = el.getBoundingClientRect();
  return [(evt.clientX - rect.left) / rect.width, (evt.clientY - rect.top) / rect.height];
}

export function SegmentHitLayer({ imageNodeId, widthPx, heightPx }: SegmentHitLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Subscribe to AI context version so we re-pull regions whenever the
  // backend analyze pass produces new ones for the active layer.
  const aiContextVersion = useAiSession((s) => s.context?.generatedAt);
  const regions = useMemo<HitRegion[]>(
    () => readHitRegions(imageNodeId),
    [imageNodeId, aiContextVersion],
  );

  const activeScope = useEditorStore((s) => s.activeScope);
  const hoveredScope = useEditorStore((s) => s.hoveredScope);
  const clickAt = useEditorStore((s) => s.clickAt);
  const setHoveredScope = useEditorStore((s) => s.setHoveredScope);

  const activeMaskId =
    activeScope.kind === 'mask' ? activeScope.mask_id : undefined;
  const hoveredMaskId =
    hoveredScope?.kind === 'mask' ? hoveredScope.mask_id : undefined;

  const hoveredPolys = findPolygonsForMaskId(regions, hoveredMaskId);
  const selectedPolys = findPolygonsForMaskId(regions, activeMaskId);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);
      if (hits.length === 0) {
        setHoveredScope(null);
        return;
      }
      setHoveredScope({ kind: 'mask', mask_id: hits[0] });
    },
    [regions, setHoveredScope],
  );

  const handlePointerLeave = useCallback(() => setHoveredScope(null), [setHoveredScope]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);
      clickAt(nx, ny, hits);
    },
    [regions, clickAt],
  );

  return (
    <div
      ref={layerRef}
      data-testid="segment-hit-layer"
      className="absolute inset-0 cursor-crosshair"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <SegmentOverlay
        widthPx={widthPx}
        heightPx={heightPx}
        hoveredPolygons={hoveredPolys}
        selectedPolygons={selectedPolys}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/components/workspace/SegmentHitLayer.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx src/components/workspace/SegmentHitLayer.test.tsx
git commit -m "feat(canvas): SegmentHitLayer — hover/click → selection.activeScope"
```

### Task 1.9: useSegmentInteraction — bridge AI session into segment-store

**Files:**
- Create: `src/hooks/useSegmentInteraction.ts`
- Test: `src/hooks/useSegmentInteraction.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/useSegmentInteraction.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSegmentInteraction } from './useSegmentInteraction';
import { useAiSession } from './useImageContext';
import { segmentStore } from '@/lib/segmentation/segment-store';
import type { ImageContext } from '@/types/image-context';

const ctx: ImageContext = {
  subjects: [],
  lighting: 'flat',
  dominantTones: [],
  mood: '',
  candidateRegions: [
    { label: 'dog', description: '',
      paths: [[[0, 0], [1, 0], [1, 1], [0, 1]]], maskRef: 'mask-a' },
  ],
  modelName: 'test',
  modelVersion: '1',
  generatedAt: '2026-06-10T00:00:00Z',
};

describe('useSegmentInteraction', () => {
  beforeEach(() => {
    segmentStore.clearAll();
    useAiSession.setState({ context: null, status: 'idle' });
  });

  it('writes the current AI context regions into segment-store keyed by imageNodeId', () => {
    useAiSession.setState({ context: ctx, status: 'ready' });
    renderHook(() => useSegmentInteraction('in-1'));
    expect(segmentStore.getRegions('in-1')).toHaveLength(1);
    expect(segmentStore.getRegions('in-1')[0].maskRef).toBe('mask-a');
  });

  it('clears the entry on context null', () => {
    segmentStore.setRegions('in-1', ctx.candidateRegions);
    useAiSession.setState({ context: null, status: 'idle' });
    renderHook(() => useSegmentInteraction('in-1'));
    expect(segmentStore.getRegions('in-1')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/hooks/useSegmentInteraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useSegmentInteraction.ts
import { useEffect } from 'react';
import { useAiSession } from './useImageContext';
import { segmentStore } from '@/lib/segmentation/segment-store';

/** Bridges AI session `candidateRegions` into the per-ImageNode
 *  `segmentStore`. Phase 1 wiring: every ImageNode that mounts a
 *  SegmentHitLayer calls this hook with its id; whenever the active AI
 *  context changes, the regions land in the store keyed by that id.
 *
 *  Phase 4 (MobileSAM) will extend this hook to also publish
 *  per-ImageNode embeddings — until then, regions come from the backend. */
export function useSegmentInteraction(imageNodeId: string): void {
  const regions = useAiSession((s) => s.context?.candidateRegions);
  useEffect(() => {
    if (!regions || regions.length === 0) {
      segmentStore.clear(imageNodeId);
      return;
    }
    segmentStore.setRegions(imageNodeId, regions);
  }, [imageNodeId, regions]);
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/hooks/useSegmentInteraction.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSegmentInteraction.ts src/hooks/useSegmentInteraction.test.ts
git commit -m "feat(segmentation): useSegmentInteraction bridges AI regions into segment-store"
```

### Task 1.10: Mount SegmentHitLayer + the bridge in ImageNode

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`

- [ ] **Step 1: Import the new pieces**

Add imports near the top of the file:

```tsx
import { SegmentHitLayer } from './SegmentHitLayer';
import { useSegmentInteraction } from '@/hooks/useSegmentInteraction';
```

- [ ] **Step 2: Call the bridge hook inside `ImageNode`**

Inside the component body (top, alongside the other hooks):

```tsx
  useSegmentInteraction(data.id);
```

- [ ] **Step 3: Mount the hit layer when Objects mode is active**

Inside the JSX that renders the image body (next to the `ContextMenu.Trigger` block, sibling of the existing render canvas), conditionally render:

```tsx
        {currentMode === 'objects' && (
          <SegmentHitLayer
            imageNodeId={data.id}
            widthPx={displayW}
            heightPx={displayH}
          />
        )}
```

(`displayW` / `displayH` are existing locals in this file — confirm names against the surrounding code; if they're called something else, use the existing pixel dim variables passed to `ImageNodeBody`.)

- [ ] **Step 4: Verify with the dev server**

Run: `npm run dev`
Manually open an image, wait for `/api/analyze` to populate `candidateRegions`, hover and click a region. Expected:
- Hover paints a dashed cyan outline.
- Click paints a solid violet outline and the scope chip in the inspector shows the region's mask label.
- Clicking the Light/Color toolrail spawns a widget whose chip displays the mask scope (already wired by `toolrail-spawn.ts`).

- [ ] **Step 5: Verify type/lint pass**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/ImageNode.tsx
git commit -m "feat(canvas): mount SegmentHitLayer + AI-region bridge in ImageNode"
```

### Phase 1 Verification Gate

- [ ] Manually verify on the dev server (record in PR description):
  - Object mode is the default when `candidateRegions.length > 0`.
  - Hovering a region paints a cyan dashed outline; the outline disappears when leaving the region.
  - Clicking a region paints a violet solid outline and shows the mask label in the inspector scope chip.
  - Clicking twice within ~8 px cycles through overlapping regions (existing `cycleStack` behaviour).
  - Toggling to Layers mode hides the hit layer and outlines.
  - Toolrail spawn (Light) on a selected region produces a widget scoped to that mask.
- [ ] `npm run check` clean.
- [ ] All new tests green.

---

## Phase 2: Drag-out → standalone ImageNode

Goal: Alt-drag a selected segment off the source ImageNode and drop it on empty canvas; a new ImageNode appears holding only that segment's pixels (RGBA with the mask as alpha), with a persistent dashed tether back to the source. No re-merge yet — that's phase 3.

### Task 2.1: Extend types — ImageNodeState.origin + TetherEdgeState.scope

**Files:**
- Modify: `src/types/workspace.ts`

- [ ] **Step 1: Extend ImageNodeState**

Inside `ImageNodeState` (after `sourceSize`), add:

```ts
  /** Provenance of the pixels in this node. Defaults to file-loaded when
   *  absent — every node loaded via the file picker has no `origin`. */
  origin?:
    | { kind: 'file' }
    | {
        kind: 'extracted';
        sourceImageNodeId: string;
        sourceMaskId: string;
        /** Top-left of the mask bbox in source-image normalised coords. */
        sourceOffset: { x: number; y: number };
        /** Original source bitmap size at extraction time. Used to remap
         *  re-merge coords when the source has been resized since. */
        sourceSize: Size;
      };
```

- [ ] **Step 2: Extend TetherEdgeState.scope**

```ts
export interface TetherEdgeState {
  id: string;
  widgetNodeId: string;
  targetImageNodeId: string;
  scope:
    | { kind: 'layer'; layerId: string }
    | { kind: 'node' }
    | { kind: 'extracted-from'; maskId: string };
}
```

- [ ] **Step 3: Verify type compile**

Run: `npm run check`
Expected: no errors. If existing tests reference `scope.kind` exhaustively, they may need a default branch — fix as needed.

- [ ] **Step 4: Commit**

```bash
git add src/types/workspace.ts
git commit -m "feat(types): ImageNodeState.origin + extracted-from tether scope"
```

### Task 2.2: Pure segment-extraction pipeline

**Files:**
- Create: `src/lib/workspace/segment-extraction.ts`
- Test: `src/lib/workspace/segment-extraction.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/workspace/segment-extraction.test.ts
import { describe, it, expect } from 'vitest';
import { extractMaskedBitmap, computeBboxPx } from './segment-extraction';

describe('computeBboxPx', () => {
  it('multiplies normalised bbox by source dims', () => {
    expect(computeBboxPx([0.1, 0.2, 0.3, 0.4], { w: 100, h: 200 })).toEqual({
      x: 10, y: 40, w: 30, h: 80,
    });
  });
});

describe('extractMaskedBitmap', () => {
  it('produces an OffscreenCanvas cropped to bbox with mask as alpha', async () => {
    // 4x4 source: red
    const src = new OffscreenCanvas(4, 4);
    const ctx = src.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 4, 4);

    // 4x4 mask: only top-left 2x2 set
    const mask = new Uint8Array([
      255, 255, 0, 0,
      255, 255, 0, 0,
      0,   0,   0, 0,
      0,   0,   0, 0,
    ]);

    const { bitmap, bboxPx } = extractMaskedBitmap(src, mask, 4, 4);
    expect(bboxPx).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(bitmap.width).toBe(2);
    expect(bitmap.height).toBe(2);

    const outCtx = bitmap.getContext('2d')!;
    const data = outCtx.getImageData(0, 0, 2, 2).data;
    // RGBA[0..3] for pixel (0,0): red with alpha 255
    expect(data[3]).toBe(255);
    expect(data[0]).toBe(255);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/lib/workspace/segment-extraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/workspace/segment-extraction.ts
import type { Size } from '@/types/workspace';

export function computeBboxPx(
  bbox: [number, number, number, number],
  source: Size,
): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = bbox;
  return {
    x: Math.round(x * source.w),
    y: Math.round(y * source.h),
    w: Math.round(w * source.w),
    h: Math.round(h * source.h),
  };
}

/** Scan the mask to find the tight bounding box of set pixels. Returns
 *  null when the mask is empty. */
function findMaskBbox(
  mask: Uint8Array,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Crop the source bitmap to the tight bbox of `mask`, applying `mask` as
 * the alpha channel. Returns the cropped bitmap and its bbox in source-px.
 *
 * @param source  Source canvas. Read with `getImageData`.
 * @param mask    1-channel mask, 0/non-zero, dims = (width, height).
 * @param width   Mask & source width in px.
 * @param height  Mask & source height in px.
 */
export function extractMaskedBitmap(
  source: OffscreenCanvas | HTMLCanvasElement,
  mask: Uint8Array,
  width: number,
  height: number,
): { bitmap: OffscreenCanvas; bboxPx: { x: number; y: number; w: number; h: number } } {
  const bbox = findMaskBbox(mask, width, height);
  if (!bbox) throw new Error('extractMaskedBitmap: mask is empty');

  const srcCtx = source.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!srcCtx) throw new Error('extractMaskedBitmap: no 2d context on source');
  const srcImg = srcCtx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);

  for (let y = 0; y < bbox.h; y++) {
    for (let x = 0; x < bbox.w; x++) {
      const maskIdx = (bbox.y + y) * width + (bbox.x + x);
      const rgbaIdx = (y * bbox.w + x) * 4;
      srcImg.data[rgbaIdx + 3] = mask[maskIdx] ? srcImg.data[rgbaIdx + 3] : 0;
    }
  }

  const out = new OffscreenCanvas(bbox.w, bbox.h);
  const outCtx = out.getContext('2d')!;
  outCtx.putImageData(srcImg, 0, 0);
  return { bitmap: out, bboxPx: bbox };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/workspace/segment-extraction.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/segment-extraction.ts src/lib/workspace/segment-extraction.test.ts
git commit -m "feat(workspace): pure segment-extraction (mask → cropped RGBA OffscreenCanvas)"
```

### Task 2.3: Workspace slice — addExtractedImageNode action

**Files:**
- Modify: `src/store/workspace-slice.ts`
- Modify: `src/store/workspace-slice.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('addExtractedImageNode', () => {
  it('creates a new node with origin.kind = "extracted" and a persistent tether edge', () => {
    const store = createTestStore();
    const sourceId = store.addImageNode(['source-layer']);
    const newId = store.addExtractedImageNode({
      layerIds: ['child-layer'],
      position: { x: 800, y: 200 },
      sourceSize: { w: 200, h: 200 },
      sourceImageNodeId: sourceId,
      sourceMaskId: 'mask-a',
      sourceOffset: { x: 0.1, y: 0.2 },
      sourceSizeAtExtraction: { w: 4000, h: 3000 },
    });
    expect(newId).toBeTruthy();
    const node = store.getState().imageNodes[newId!];
    expect(node.origin?.kind).toBe('extracted');
    if (node.origin?.kind === 'extracted') {
      expect(node.origin.sourceImageNodeId).toBe(sourceId);
      expect(node.origin.sourceMaskId).toBe('mask-a');
    }
    const edges = Object.values(store.getState().tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0].targetImageNodeId).toBe(sourceId);
    expect(edges[0].scope.kind).toBe('extracted-from');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/store/workspace-slice.test.ts`
Expected: FAIL — `addExtractedImageNode` undefined.

- [ ] **Step 3: Extend the interface**

In `WorkspaceSlice`, add (near `splitImageNode`):

```ts
  /**
   * Create a new ImageNode marked as extracted from `sourceImageNodeId`.
   * Inserts a persistent tether edge with scope `{ kind: 'extracted-from', maskId }`
   * pointing at the source. Returns the new node id, or null if the source is missing.
   */
  addExtractedImageNode: (args: {
    layerIds: string[];
    position: Point;
    sourceSize: Size;
    sourceImageNodeId: string;
    sourceMaskId: string;
    sourceOffset: Point;
    sourceSizeAtExtraction: Size;
  }) => string | null;
```

- [ ] **Step 4: Implement**

Inside `createWorkspaceSlice`, after `splitImageNode`:

```ts
  addExtractedImageNode: (args) => {
    let id: string | null = null;
    set((state) => {
      if (!state.imageNodes[args.sourceImageNodeId]) return;
      id = `in-${state._nextNodeSeq++}`;
      state.imageNodes[id] = {
        id,
        layerIds: [...args.layerIds],
        position: args.position,
        size: deriveDisplaySize(args.sourceSize, DEFAULT_IMAGE_NODE_DISPLAY_WIDTH),
        sourceSize: { ...args.sourceSize },
        origin: {
          kind: 'extracted',
          sourceImageNodeId: args.sourceImageNodeId,
          sourceMaskId: args.sourceMaskId,
          sourceOffset: { ...args.sourceOffset },
          sourceSize: { ...args.sourceSizeAtExtraction },
        },
      };
      const edgeId = `te-${state._nextEdgeSeq++}`;
      state.tetherEdges[edgeId] = {
        id: edgeId,
        widgetNodeId: id,
        targetImageNodeId: args.sourceImageNodeId,
        scope: { kind: 'extracted-from', maskId: args.sourceMaskId },
      };
    });
    return id;
  },
```

- [ ] **Step 5: Verify pass**

Run: `npx vitest run src/store/workspace-slice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/workspace-slice.ts src/store/workspace-slice.test.ts
git commit -m "feat(workspace): addExtractedImageNode + persistent extracted-from tether"
```

### Task 2.4: Document facade — workspace.extractSegment

**Files:**
- Modify: `src/core/document.ts`

- [ ] **Step 1: Add the wrapper**

Inside the `workspace` const, after `addImageNode`:

```ts
  extractSegment(args: {
    sourceImageNodeId: string;
    sourceMaskId: string;
    sourceOffset: Point;
    sourceSizeAtExtraction: Size;
    layerIds: string[];
    extractedSourceSize: Size;
    dropPosition: Point;
  }): string | null | undefined {
    return recordSnapshot('Extract segment', () =>
      useEditorStore.getState().addExtractedImageNode({
        layerIds: args.layerIds,
        position: args.dropPosition,
        sourceSize: args.extractedSourceSize,
        sourceImageNodeId: args.sourceImageNodeId,
        sourceMaskId: args.sourceMaskId,
        sourceOffset: args.sourceOffset,
        sourceSizeAtExtraction: args.sourceSizeAtExtraction,
      }),
    );
  },
```

- [ ] **Step 2: Verify check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/document.ts
git commit -m "feat(document): workspace.extractSegment — history-wrapped extracted-node insert"
```

### Task 2.5: useSegmentExtraction hook

**Files:**
- Create: `src/hooks/useSegmentExtraction.ts`
- Test: `src/hooks/useSegmentExtraction.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/useSegmentExtraction.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegmentExtraction } from './useSegmentExtraction';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { editorDocument } from '@/core/document';

describe('useSegmentExtraction', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
    useEditorStore.getState().clearSelection();
    maskStore.clear();
  });

  it('extracts a segment and spawns a new image node when extract() is called', async () => {
    const sourceId = useEditorStore.getState().addImageNode(['l-source']);
    // Synthesize a 4x4 mask in maskStore.
    const ref = maskStore.register({
      layerId: 'l-source',
      width: 4,
      height: 4,
      data: new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      source: 'sam-point',
      createdAt: Date.now(),
    });
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: ref });

    const spy = vi.spyOn(editorDocument.workspace, 'extractSegment');

    const { result } = renderHook(() => useSegmentExtraction(sourceId));
    // Fake a 4x4 source canvas via OffscreenCanvas.
    const fakeSource = new OffscreenCanvas(4, 4);
    fakeSource.getContext('2d')!.fillStyle = 'red';
    fakeSource.getContext('2d')!.fillRect(0, 0, 4, 4);

    await act(async () => {
      await result.current.extract({
        sourceCanvas: fakeSource as unknown as HTMLCanvasElement,
        sourceSize: { w: 4, h: 4 },
        dropPosition: { x: 500, y: 200 },
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/hooks/useSegmentExtraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useSegmentExtraction.ts
import { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { editorDocument } from '@/core/document';
import { extractMaskedBitmap } from '@/lib/workspace/segment-extraction';
import { CanvasRegistry } from '@/lib/canvas-registry';
import type { Point, Size } from '@/types/workspace';

export interface ExtractArgs {
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas;
  sourceSize: Size;
  dropPosition: Point;
}

export interface SegmentExtractionApi {
  /** True iff a mask is currently the active scope. */
  canExtract: boolean;
  /** Run the extraction pipeline; returns the new ImageNode id or null. */
  extract: (args: ExtractArgs) => Promise<string | null>;
}

export function useSegmentExtraction(sourceImageNodeId: string): SegmentExtractionApi {
  const activeScope = useEditorStore((s) => s.activeScope);
  const canExtract = activeScope.kind === 'mask';

  const extract = useCallback(
    async ({ sourceCanvas, sourceSize, dropPosition }: ExtractArgs): Promise<string | null> => {
      if (activeScope.kind !== 'mask') return null;
      const mask = maskStore.get(activeScope.mask_id);
      if (!mask) return null;
      if (mask.width !== sourceSize.w || mask.height !== sourceSize.h) {
        console.warn(
          '[useSegmentExtraction] mask size != source size — skipping',
          { mask: { w: mask.width, h: mask.height }, sourceSize },
        );
        return null;
      }

      const { bitmap, bboxPx } = extractMaskedBitmap(
        sourceCanvas,
        mask.data,
        sourceSize.w,
        sourceSize.h,
      );

      // Create the new layer for the extracted bitmap. CanvasRegistry holds
      // pixel data outside the store; we register the bitmap under a fresh
      // layer id and create that layer in the layer slice.
      const newLayerId = `layer-extracted-${crypto.randomUUID().slice(0, 8)}`;
      const newCanvas = bitmap;
      CanvasRegistry.register(newLayerId, newCanvas);

      editorDocument.addLayerForExtractedSegment({
        layerId: newLayerId,
        name: mask.label ? `Object · ${mask.label}` : 'Extracted object',
      });

      const newId = editorDocument.workspace.extractSegment({
        sourceImageNodeId,
        sourceMaskId: activeScope.mask_id,
        sourceOffset: { x: bboxPx.x / sourceSize.w, y: bboxPx.y / sourceSize.h },
        sourceSizeAtExtraction: sourceSize,
        layerIds: [newLayerId],
        extractedSourceSize: { w: bboxPx.w, h: bboxPx.h },
        dropPosition,
      });
      return newId ?? null;
    },
    [activeScope, sourceImageNodeId],
  );

  return useMemo<SegmentExtractionApi>(() => ({ canExtract, extract }), [canExtract, extract]);
}
```

- [ ] **Step 4: Add `editorDocument.addLayerForExtractedSegment` helper**

In `src/core/document.ts`, find an existing layer-adding helper (e.g. wherever `addLayer` is called from inside the facade) and append a new method to the facade. If `editorDocument` is an object literal, add the method at top level alongside `workspace`:

```ts
  addLayerForExtractedSegment(args: { layerId: string; name: string }): void {
    recordSnapshot('Add extracted segment layer', () => {
      useEditorStore.getState().addLayer({
        id: args.layerId,
        type: 'image',
        name: args.name,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
      });
    });
  },
```

(The exact layer `type` string should match the project's existing convention for image layers — grep `addLayer(` in `src/core/document.ts` or `src/hooks/useFileIO.ts` to confirm the right value before committing.)

- [ ] **Step 5: Verify pass**

Run: `npx vitest run src/hooks/useSegmentExtraction.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSegmentExtraction.ts src/hooks/useSegmentExtraction.test.ts src/core/document.ts
git commit -m "feat(workspace): useSegmentExtraction — Alt-drag drives mask→ImageNode pipeline"
```

### Task 2.6: Wire Alt-drag into SegmentHitLayer

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`

- [ ] **Step 1: Add Alt-drag handler**

Inside the existing `SegmentHitLayer`, replace the `onClick` handler with a click vs. Alt-drag dispatcher. Add at the top:

```tsx
import { useSegmentExtraction } from '@/hooks/useSegmentExtraction';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';
```

(`useEditorStore` is already imported; just confirm.)

Add inside the component body:

```tsx
  const { canExtract, extract } = useSegmentExtraction(imageNodeId);
  const activeImageNode = useEditorStore((s) => s.imageNodes[imageNodeId]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.altKey || !canExtract) return;
      const el = layerRef.current;
      if (!el) return;
      e.preventDefault();
      const startClient = { x: e.clientX, y: e.clientY };

      const onMove = (_ev: PointerEvent) => {
        // future: paint a drag ghost
      };

      const onUp = async (ev: PointerEvent) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const sourceLayerId = activeImageNode?.layerIds[0];
        if (!sourceLayerId) return;
        const srcCanvas = CanvasRegistry.get(sourceLayerId);
        if (!srcCanvas) return;
        const dropPosition = {
          x: (activeImageNode?.position.x ?? 0) + (ev.clientX - startClient.x),
          y: (activeImageNode?.position.y ?? 0) + (ev.clientY - startClient.y),
        };
        await extract({
          sourceCanvas: srcCanvas as HTMLCanvasElement,
          sourceSize: activeImageNode!.sourceSize,
          dropPosition,
        });
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    },
    [canExtract, extract, activeImageNode],
  );
```

Add `onPointerDown={handlePointerDown}` to the layer's `<div>`.

(Confirm the exact CanvasRegistry API surface: `CanvasRegistry.get(layerId)` may return an object with `{ source, working }` — adapt the access to extract the working canvas.)

- [ ] **Step 2: Verify on dev server**

Run: `npm run dev`
Open an image, wait for SAM analyze, select a region, Alt-drag it onto empty canvas. Expected:
- A new ImageNode appears at drop position holding only the extracted segment (visible because background is transparent).
- A dashed tether edge connects it back to the source.
- Undo (Cmd+Z) removes the extracted node + tether and restores selection.

- [ ] **Step 3: Verify check + existing tests**

Run: `npm run check && npx vitest run`
Expected: no new errors; SegmentHitLayer tests still pass (Alt-drag path isn't covered by them — that's fine).

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx
git commit -m "feat(canvas): Alt-drag on a segment extracts it to a new ImageNode"
```

### Task 2.7: Render extracted-from tether edges with their own style

**Files:**
- Modify: `src/components/workspace/TetherEdge.tsx`

- [ ] **Step 1: Read the existing component**

Run: `grep -n "scope.kind\|kind === 'layer'\|extracted-from" src/components/workspace/TetherEdge.tsx`
Identify where `scope.kind` is read.

- [ ] **Step 2: Add the extracted-from branch**

Inside `TetherEdge`, branch on `edge.scope.kind`. For `'extracted-from'`, render a path with `strokeDasharray="6 4"` and `stroke="var(--accent-extracted)"`, plus a small inline-SVG badge with text "from" near the source end. Existing scope branches (`layer`, `node`) keep their current rendering.

The exact code shape depends on the existing component structure; the key change is a conditional branch:

```tsx
  if (edge.scope.kind === 'extracted-from') {
    return (
      <BaseEdgePath
        {...baseProps}
        stroke="var(--accent-extracted)"
        strokeDasharray="6 4"
        badgeLabel="from"
      />
    );
  }
```

(If `BaseEdgePath` doesn't exist with that shape, mirror whatever pattern the existing branches use — add a dashed stroke + a small `<text>` element along the path.)

- [ ] **Step 3: Verify the dev surface**

Run: `npm run dev`
Repeat the Alt-drag from Task 2.6. Expected: dashed amber tether with a "from" badge near the source node.

- [ ] **Step 4: Verify check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/TetherEdge.tsx
git commit -m "feat(canvas): extracted-from tether — dashed amber + 'from' badge"
```

### Phase 2 Verification Gate

- [ ] Manually verify on the dev server:
  - Alt-drag on a selected object produces a new ImageNode at drop position.
  - The new node shows only the cropped masked pixels with transparency.
  - A dashed amber tether with a "from" badge connects it to the source.
  - Cmd+Z removes both the extracted node and the tether in one step.
  - Toolrail spawns (Light/Color) on the extracted node still scope correctly to the new layer.
- [ ] `npm run check` clean.
- [ ] All new tests green.

---

## Phase 3: Drop-back → re-merge as child layer

Goal: dragging an extracted ImageNode back over its source ImageNode re-attaches its layer as a child of the source layer (via `parentLayerId` + `layerMask`), removes the extracted node, and the existing per-layer compositing pipeline does the rest. No new render code.

### Task 3.1: Pure remerge math

**Files:**
- Create: `src/lib/workspace/segment-remerge.ts`
- Test: `src/lib/workspace/segment-remerge.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/workspace/segment-remerge.test.ts
import { describe, it, expect } from 'vitest';
import { computeRemergeParams, isDropInsideSource } from './segment-remerge';
import type { ImageNodeState } from '@/types/workspace';

const source: ImageNodeState = {
  id: 'src',
  layerIds: ['source-layer'],
  position: { x: 100, y: 100 },
  size: { w: 600, h: 400 },
  sourceSize: { w: 4000, h: 3000 },
};

describe('isDropInsideSource', () => {
  it('returns true when drop coords are inside the source bbox', () => {
    expect(isDropInsideSource(source, { x: 300, y: 200 })).toBe(true);
  });
  it('returns false when drop coords are outside', () => {
    expect(isDropInsideSource(source, { x: 800, y: 200 })).toBe(false);
  });
});

describe('computeRemergeParams', () => {
  it('returns parent layer id and a translated position', () => {
    const extracted: ImageNodeState = {
      id: 'ext',
      layerIds: ['child-layer'],
      position: { x: 200, y: 200 },
      size: { w: 200, h: 150 },
      sourceSize: { w: 1000, h: 750 },
      origin: {
        kind: 'extracted',
        sourceImageNodeId: 'src',
        sourceMaskId: 'mask-a',
        sourceOffset: { x: 0.1, y: 0.2 },
        sourceSize: { w: 4000, h: 3000 },
      },
    };
    const params = computeRemergeParams(extracted, source, { x: 250, y: 250 });
    expect(params.parentLayerId).toBe('source-layer');
    expect(params.childLayerId).toBe('child-layer');
    expect(params.sourceMaskId).toBe('mask-a');
    // sanity: the position delta is finite
    expect(Number.isFinite(params.positionDelta.x)).toBe(true);
    expect(Number.isFinite(params.positionDelta.y)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/lib/workspace/segment-remerge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/workspace/segment-remerge.ts
import type { ImageNodeState, Point } from '@/types/workspace';

export function isDropInsideSource(source: ImageNodeState, drop: Point): boolean {
  return (
    drop.x >= source.position.x &&
    drop.y >= source.position.y &&
    drop.x <= source.position.x + source.size.w &&
    drop.y <= source.position.y + source.size.h
  );
}

export interface RemergeParams {
  parentLayerId: string;
  childLayerId: string;
  sourceMaskId: string;
  /** Translation from the original masked position, in normalised source-image coords. */
  positionDelta: Point;
}

export function computeRemergeParams(
  extracted: ImageNodeState,
  source: ImageNodeState,
  dropCanvas: Point,
): RemergeParams {
  if (extracted.origin?.kind !== 'extracted') {
    throw new Error('computeRemergeParams: extracted node has no extracted origin');
  }
  const parentLayerId = source.layerIds[0];
  if (!parentLayerId) {
    throw new Error('computeRemergeParams: source has no layers');
  }
  const childLayerId = extracted.layerIds[0];
  if (!childLayerId) {
    throw new Error('computeRemergeParams: extracted node has no layers');
  }

  // Drop position in source canvas-space → normalised source coords.
  const dropNormX = (dropCanvas.x - source.position.x) / source.size.w;
  const dropNormY = (dropCanvas.y - source.position.y) / source.size.h;
  const positionDelta = {
    x: dropNormX - extracted.origin.sourceOffset.x,
    y: dropNormY - extracted.origin.sourceOffset.y,
  };

  return {
    parentLayerId,
    childLayerId,
    sourceMaskId: extracted.origin.sourceMaskId,
    positionDelta,
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/workspace/segment-remerge.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/segment-remerge.ts src/lib/workspace/segment-remerge.test.ts
git commit -m "feat(workspace): pure compute for re-merge (drop-in-source + parent params)"
```

### Task 3.2: Document facade — workspace.remergeExtractedNode

**Files:**
- Modify: `src/core/document.ts`

- [ ] **Step 1: Add wrapper inside `workspace`**

```ts
  remergeExtractedNode(args: { extractedNodeId: string; dropPosition: Point }): boolean {
    const state = useEditorStore.getState();
    const extracted = state.imageNodes[args.extractedNodeId];
    if (!extracted || extracted.origin?.kind !== 'extracted') return false;
    const source = state.imageNodes[extracted.origin.sourceImageNodeId];
    if (!source) return false;
    if (!isDropInsideSource(source, args.dropPosition)) return false;

    const params = computeRemergeParams(extracted, source, args.dropPosition);

    recordSnapshot('Re-merge segment', () => {
      const s = useEditorStore.getState();
      s.updateLayer(params.childLayerId, {
        parentLayerId: params.parentLayerId,
        layerMask: params.sourceMaskId,
      });
      // Remove the extracted node + its tether edge(s).
      for (const edge of Object.values(s.tetherEdges)) {
        if (
          edge.targetImageNodeId === source.id &&
          edge.scope.kind === 'extracted-from' &&
          edge.scope.maskId === params.sourceMaskId
        ) {
          s.unbindEdge(edge.id);
        }
      }
      s.removeImageNode(args.extractedNodeId);
    });
    return true;
  },
```

- [ ] **Step 2: Add imports**

```ts
import {
  computeRemergeParams,
  isDropInsideSource,
} from '@/lib/workspace/segment-remerge';
```

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/document.ts
git commit -m "feat(document): workspace.remergeExtractedNode — child layer + layerMask write"
```

### Task 3.3: useSegmentRemerge — React Flow drag-stop intersection handler

**Files:**
- Create: `src/hooks/useSegmentRemerge.ts`
- Test: `src/hooks/useSegmentRemerge.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/useSegmentRemerge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegmentRemerge } from './useSegmentRemerge';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';

describe('useSegmentRemerge', () => {
  beforeEach(() => useEditorStore.getState().resetWorkspace());

  it('calls remergeExtractedNode when dropping an extracted node over its source', async () => {
    const sourceId = useEditorStore.getState().addImageNode(['source-layer']);
    const extractedId = useEditorStore.getState().addExtractedImageNode({
      layerIds: ['child-layer'],
      position: { x: 800, y: 200 },
      sourceSize: { w: 200, h: 150 },
      sourceImageNodeId: sourceId,
      sourceMaskId: 'mask-a',
      sourceOffset: { x: 0.1, y: 0.2 },
      sourceSizeAtExtraction: { w: 4000, h: 3000 },
    })!;
    const spy = vi.spyOn(editorDocument.workspace, 'remergeExtractedNode');
    const { result } = renderHook(() => useSegmentRemerge());

    await act(async () => {
      result.current.handleDragStop(extractedId, { x: 250, y: 200 });
    });
    expect(spy).toHaveBeenCalledWith({
      extractedNodeId: extractedId,
      dropPosition: { x: 250, y: 200 },
    });
  });

  it('does nothing for a non-extracted node', async () => {
    const id = useEditorStore.getState().addImageNode(['l1']);
    const spy = vi.spyOn(editorDocument.workspace, 'remergeExtractedNode');
    const { result } = renderHook(() => useSegmentRemerge());
    await act(async () => result.current.handleDragStop(id, { x: 1, y: 1 }));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/hooks/useSegmentRemerge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useSegmentRemerge.ts
import { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import type { Point } from '@/types/workspace';

export interface SegmentRemergeApi {
  /** Called by React Flow's onNodeDragStop (or equivalent) with the drag-stop coords in canvas-space. */
  handleDragStop: (nodeId: string, dropPosition: Point) => boolean;
}

export function useSegmentRemerge(): SegmentRemergeApi {
  const handleDragStop = useCallback((nodeId: string, dropPosition: Point) => {
    const node = useEditorStore.getState().imageNodes[nodeId];
    if (!node || node.origin?.kind !== 'extracted') return false;
    return editorDocument.workspace.remergeExtractedNode({
      extractedNodeId: nodeId,
      dropPosition,
    });
  }, []);
  return useMemo(() => ({ handleDragStop }), [handleDragStop]);
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/hooks/useSegmentRemerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSegmentRemerge.ts src/hooks/useSegmentRemerge.test.ts
git commit -m "feat(workspace): useSegmentRemerge — drag-stop intersection driver"
```

### Task 3.4: Wire useSegmentRemerge into CanvasWorkspace

**Files:**
- Modify: `src/components/workspace/CanvasWorkspace.tsx`

- [ ] **Step 1: Inspect the existing node-drag handler**

Run: `grep -n "onNodeDragStop\|onNodesChange" src/components/workspace/CanvasWorkspace.tsx`
Identify the existing drag-stop wiring.

- [ ] **Step 2: Add the remerge call inside onNodeDragStop**

```tsx
import { useSegmentRemerge } from '@/hooks/useSegmentRemerge';
```

Inside the component:

```tsx
  const remerge = useSegmentRemerge();
```

In the `onNodeDragStop` handler (or whatever the existing drag-stop callback is called), before persisting the new position, attempt remerge:

```tsx
  // If this is an extracted node and the drop landed on its source, the
  // remerge handler consumes the drop and the node ceases to exist.
  // Otherwise we fall through and persist the new position normally.
  const consumed = remerge.handleDragStop(node.id, {
    x: node.positionAbsolute?.x ?? node.position.x,
    y: node.positionAbsolute?.y ?? node.position.y,
  });
  if (consumed) return;
```

(Adjust the exact field name for canvas-space coords against React Flow's actual node payload — `positionAbsolute` is the typical field.)

- [ ] **Step 3: Verify on dev server**

Run: `npm run dev`
Repeat phase-2 extract, then drag the extracted node back onto the source. Expected:
- The extracted node disappears on drop.
- The source ImageNode's layer panel now shows a child layer with the mask applied.
- The image looks unchanged (the child reproduces the original pixels exactly when dropped at its origin position).
- Editing the child layer (e.g. Light → Exposure) shows the effect inside the mask only.
- Cmd+Z restores the extracted node.

- [ ] **Step 4: Verify check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CanvasWorkspace.tsx
git commit -m "feat(canvas): drop-on-source re-merges extracted nodes as child layers"
```

### Phase 3 Verification Gate

- [ ] Manually verify the full extract → edit → drop-back cycle:
  - Select a SAM region on an ImageNode.
  - Alt-drag → extracted node spawns.
  - Apply Light → Exposure +1 to the extracted node (toolrail spawn scoped to its layer).
  - Drag the extracted node back onto the source.
  - The source's composite now shows the brightened object only inside the mask area; pixels outside the mask are unchanged.
  - Cmd+Z reverses to extracted state; another Cmd+Z reverses to original.
- [ ] `npm run check` clean.
- [ ] All new tests green.

**🎬 At this point the user-facing USP demo is complete.** Phase 4 only improves the interactive-segmentation latency floor; phases 1–3 should be merged independently if the thesis demo deadline is the next milestone.

---

## Phase 4 (DEFERRABLE): MobileSAM browser refinement

Goal: replace the SSE round-trip for click-to-segment with an in-browser MobileSAM session running through ONNX Runtime Web + WebGPU. New `propose_mask` MCP tool registers any committed mask back into the backend's `masks_index` for persistence + undo/redo.

**Fallback path:** if `detectSamCapability()` returns `'backend'` (no WebGPU and `wasm` disallowed), the same UI dispatches click prompts to the backend via `propose_mask` with the click coords; the backend runs SAM 2 and returns the same `MaskSummary` shape. Phase-1/2/3 UX is unchanged in this case — only refinement is slower.

### Task 4.1: ORT-Web + ONNX assets in the bundle

**Files:**
- Create: `public/models/mobile-sam/mobile_sam_encoder.onnx` (~10 MB)
- Create: `public/models/mobile-sam/mobile_sam_decoder.onnx` (~16 MB INT8)
- Modify: `vite.config.ts`
- Modify: `package.json` (dependency)

- [ ] **Step 1: Install ORT-Web**

```bash
npm install onnxruntime-web@^1.17.0
```

- [ ] **Step 2: Configure vite to serve ORT WASM**

In `vite.config.ts`, add a `optimizeDeps.exclude` for `onnxruntime-web` and a `server.headers` block (only if cross-origin isolation is needed by WebGPU). Confirm the project's vite config style; the canonical setup looks like:

```ts
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
```

- [ ] **Step 3: Vendor the ONNX weights**

Download the MobileSAM ONNX exports (encoder + INT8 decoder) following the official export script at https://github.com/ChaoningZhang/MobileSAM (run their `scripts/export_onnx_model.py`). Place both files under `public/models/mobile-sam/`.

- [ ] **Step 4: Verify the build still passes**

Run: `npm run build`
Expected: no bundle errors. The ONNX files are served as static assets, not bundled into JS chunks.

- [ ] **Step 5: Commit**

```bash
git add public/models/mobile-sam/ vite.config.ts package.json package-lock.json
git commit -m "build(segmentation): vendor MobileSAM ONNX + onnxruntime-web setup"
```

### Task 4.2: SAM capability probe

**Files:**
- Create: `src/lib/segmentation/sam-capability.ts`
- Test: `src/lib/segmentation/sam-capability.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/segmentation/sam-capability.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectSamCapability } from './sam-capability';

afterEach(() => vi.restoreAllMocks());

describe('detectSamCapability', () => {
  it('returns "webgpu" when navigator.gpu.requestAdapter resolves', async () => {
    (globalThis as unknown as { navigator: { gpu?: { requestAdapter: () => Promise<unknown> } } }).navigator = {
      gpu: { requestAdapter: async () => ({}) },
    };
    expect(await detectSamCapability()).toBe('webgpu');
  });

  it('returns "wasm" when navigator.gpu is absent but wasm is allowed', async () => {
    (globalThis as unknown as { navigator: { gpu?: unknown } }).navigator = {};
    expect(await detectSamCapability({ allowWasm: true })).toBe('wasm');
  });

  it('returns "backend" when neither is available', async () => {
    (globalThis as unknown as { navigator: { gpu?: unknown } }).navigator = {};
    expect(await detectSamCapability({ allowWasm: false })).toBe('backend');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/lib/segmentation/sam-capability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/segmentation/sam-capability.ts
export type SamCapability = 'webgpu' | 'wasm' | 'backend';

interface NavigatorWithGpu {
  gpu?: { requestAdapter: () => Promise<unknown> };
}

export async function detectSamCapability(
  options: { allowWasm?: boolean } = { allowWasm: true },
): Promise<SamCapability> {
  const nav = (globalThis as unknown as { navigator?: NavigatorWithGpu }).navigator;
  if (nav?.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      // fall through
    }
  }
  if (options.allowWasm) return 'wasm';
  return 'backend';
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/segmentation/sam-capability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/sam-capability.ts src/lib/segmentation/sam-capability.test.ts
git commit -m "feat(segmentation): SAM capability probe (webgpu|wasm|backend)"
```

### Task 4.3: MobileSAM types

**Files:**
- Create: `src/lib/segmentation/mobile-sam-types.ts`

- [ ] **Step 1: Define types**

```ts
// src/lib/segmentation/mobile-sam-types.ts

/** A click-prompt point in normalised [0,1] image coords. */
export interface SamPoint {
  x: number;
  y: number;
  /** 1 = positive (include), 0 = negative (exclude). */
  label: 0 | 1;
}

/** Opaque encoder output. Persisted in segment-store, fed to decode(). */
export interface EncoderEmbedding {
  imageNodeId: string;
  /** The raw embedding tensor; carrier is intentionally opaque so the
   *  client can swap to a different runtime without changing consumers. */
  data: Float32Array;
  shape: number[];
  /** Original image dims (px) at encode time. */
  imageSize: { w: number; h: number };
}

export interface DecoderInput {
  embedding: EncoderEmbedding;
  points: SamPoint[];
}

export interface DecoderOutput {
  /** 1-channel mask, 0 / 255, same dims as the source image. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Decoder confidence in [0,1]. */
  score: number;
}
```

- [ ] **Step 2: Verify check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/segmentation/mobile-sam-types.ts
git commit -m "feat(segmentation): shared MobileSAM types"
```

### Task 4.4: MobileSAM client wrapper

**Files:**
- Create: `src/lib/segmentation/mobile-sam-client.ts`
- Test: `src/lib/segmentation/mobile-sam-client.test.ts`

- [ ] **Step 1: Write failing test (mocked ORT)**

```ts
// src/lib/segmentation/mobile-sam-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock onnxruntime-web BEFORE importing the client.
vi.mock('onnxruntime-web', () => {
  const sessionCreate = vi.fn(async () => ({
    run: vi.fn(async () => ({
      output: { data: new Float32Array(1), dims: [1] },
      masks: { data: new Float32Array(4), dims: [1, 1, 2, 2] },
      iou_predictions: { data: new Float32Array([0.9]), dims: [1, 1] },
    })),
  }));
  return {
    InferenceSession: { create: sessionCreate },
    Tensor: class { constructor(_t: unknown, _d: unknown, _s: unknown) {} },
    env: { wasm: { wasmPaths: '' } },
  };
});

import { MobileSamClient } from './mobile-sam-client';

describe('MobileSamClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates encoder/decoder sessions lazily and reuses them', async () => {
    const ort = await import('onnxruntime-web');
    const client = new MobileSamClient({ encoderUrl: '/e.onnx', decoderUrl: '/d.onnx' });
    await client.warmup();
    await client.warmup();
    // Two sessions (encoder + decoder), created once each.
    expect((ort.InferenceSession.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/lib/segmentation/mobile-sam-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/segmentation/mobile-sam-client.ts
import * as ort from 'onnxruntime-web';
import type {
  EncoderEmbedding,
  DecoderInput,
  DecoderOutput,
  SamPoint,
} from './mobile-sam-types';

interface ClientConfig {
  encoderUrl: string;
  decoderUrl: string;
  /** Execution providers, in priority order. Defaults to ['webgpu', 'wasm']. */
  executionProviders?: ('webgpu' | 'wasm')[];
}

const MOBILE_SAM_INPUT_SIZE = 1024;

export class MobileSamClient {
  private encoder: ort.InferenceSession | null = null;
  private decoder: ort.InferenceSession | null = null;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly config: ClientConfig) {}

  warmup(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;
    const providers = this.config.executionProviders ?? ['webgpu', 'wasm'];
    this.warmupPromise = Promise.all([
      ort.InferenceSession.create(this.config.encoderUrl, { executionProviders: providers }),
      ort.InferenceSession.create(this.config.decoderUrl, { executionProviders: providers }),
    ]).then(([enc, dec]) => {
      this.encoder = enc;
      this.decoder = dec;
    });
    return this.warmupPromise;
  }

  /** Run the encoder on a (downscaled) image bitmap. */
  async encode(image: ImageBitmap, imageNodeId: string): Promise<EncoderEmbedding> {
    await this.warmup();
    if (!this.encoder) throw new Error('MobileSamClient: encoder not ready');
    // Resize to model's expected input size on an OffscreenCanvas, convert
    // to NCHW float32 normalised by ImageNet mean/std (MobileSAM follows
    // the SAM pre-processing pipeline).
    const tensor = await prepareEncoderInput(image);
    const out = await this.encoder.run({ input_image: tensor });
    const emb = out['image_embeddings'];
    return {
      imageNodeId,
      data: new Float32Array(emb.data as Float32Array),
      shape: [...emb.dims],
      imageSize: { w: image.width, h: image.height },
    };
  }

  /** Decode a mask from cached embedding + a list of point prompts. */
  async decode(input: DecoderInput): Promise<DecoderOutput> {
    await this.warmup();
    if (!this.decoder) throw new Error('MobileSamClient: decoder not ready');
    const { tensors } = packDecoderInput(input.embedding, input.points);
    const out = await this.decoder.run(tensors);
    return unpackDecoderOutput(out, input.embedding.imageSize);
  }
}

// ── Pre/post-processing helpers ─────────────────────────────────────────

async function prepareEncoderInput(image: ImageBitmap): Promise<ort.Tensor> {
  const canvas = new OffscreenCanvas(MOBILE_SAM_INPUT_SIZE, MOBILE_SAM_INPUT_SIZE);
  const ctx = canvas.getContext('2d')!;
  // Letterbox: preserve aspect, pad with zeros.
  const scale = Math.min(MOBILE_SAM_INPUT_SIZE / image.width, MOBILE_SAM_INPUT_SIZE / image.height);
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  ctx.drawImage(image, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, MOBILE_SAM_INPUT_SIZE, MOBILE_SAM_INPUT_SIZE);
  const N = MOBILE_SAM_INPUT_SIZE * MOBILE_SAM_INPUT_SIZE;
  // ImageNet normalisation per channel.
  const MEAN = [123.675, 116.28, 103.53];
  const STD = [58.395, 57.12, 57.375];
  const float = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    float[i] = (img.data[i * 4] - MEAN[0]) / STD[0];           // R
    float[i + N] = (img.data[i * 4 + 1] - MEAN[1]) / STD[1];   // G
    float[i + 2 * N] = (img.data[i * 4 + 2] - MEAN[2]) / STD[2]; // B
  }
  return new ort.Tensor('float32', float, [1, 3, MOBILE_SAM_INPUT_SIZE, MOBILE_SAM_INPUT_SIZE]);
}

function packDecoderInput(emb: EncoderEmbedding, points: SamPoint[]) {
  const coords = new Float32Array(points.length * 2);
  const labels = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    // MobileSAM expects coords in the encoder's letterboxed space (1024x1024).
    const scale = Math.min(MOBILE_SAM_INPUT_SIZE / emb.imageSize.w, MOBILE_SAM_INPUT_SIZE / emb.imageSize.h);
    coords[i * 2] = points[i].x * emb.imageSize.w * scale;
    coords[i * 2 + 1] = points[i].y * emb.imageSize.h * scale;
    labels[i] = points[i].label;
  }
  const embTensor = new ort.Tensor('float32', emb.data, emb.shape);
  const coordsTensor = new ort.Tensor('float32', coords, [1, points.length, 2]);
  const labelsTensor = new ort.Tensor('float32', labels, [1, points.length]);
  // Empty mask input + hasMaskInput=0 (no prior mask).
  const maskInput = new ort.Tensor('float32', new Float32Array(1 * 1 * 256 * 256), [1, 1, 256, 256]);
  const hasMaskInput = new ort.Tensor('float32', new Float32Array([0]), [1]);
  const origImSize = new ort.Tensor('float32', new Float32Array([emb.imageSize.h, emb.imageSize.w]), [2]);
  return {
    tensors: {
      image_embeddings: embTensor,
      point_coords: coordsTensor,
      point_labels: labelsTensor,
      mask_input: maskInput,
      has_mask_input: hasMaskInput,
      orig_im_size: origImSize,
    },
  };
}

function unpackDecoderOutput(
  out: ort.InferenceSession.OnnxValueMapType,
  imageSize: { w: number; h: number },
): DecoderOutput {
  const masksTensor = out['masks'];
  const iouTensor = out['iou_predictions'];
  const masks = masksTensor.data as Float32Array;
  const [, , h, w] = masksTensor.dims as number[];
  // Threshold at 0; binarise into a uint8 1-channel.
  const flat = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) flat[i] = masks[i] > 0 ? 255 : 0;
  const score = (iouTensor.data as Float32Array)[0];
  // The decoder upsamples to (h, w) ≈ orig_im_size; if it's not exactly
  // the source size, resample with nearest-neighbour in JS. (Skip for now
  // if dims match — typical case.)
  if (w === imageSize.w && h === imageSize.h) {
    return { mask: flat, width: w, height: h, score };
  }
  // Nearest-neighbour resample.
  const out2 = new Uint8Array(imageSize.w * imageSize.h);
  for (let y = 0; y < imageSize.h; y++) {
    const srcY = Math.floor((y / imageSize.h) * h);
    for (let x = 0; x < imageSize.w; x++) {
      const srcX = Math.floor((x / imageSize.w) * w);
      out2[y * imageSize.w + x] = flat[srcY * w + srcX];
    }
  }
  return { mask: out2, width: imageSize.w, height: imageSize.h, score };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/lib/segmentation/mobile-sam-client.test.ts`
Expected: PASS (lifecycle test only — actual encode/decode is exercised in the dev server).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/mobile-sam-client.ts src/lib/segmentation/mobile-sam-client.test.ts
git commit -m "feat(segmentation): MobileSAM ORT-Web client (encoder + decoder)"
```

### Task 4.5: useMobileSam hook

**Files:**
- Create: `src/hooks/useMobileSam.ts`
- Test: `src/hooks/useMobileSam.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/useMobileSam.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/segmentation/sam-capability', () => ({
  detectSamCapability: vi.fn(async () => 'webgpu'),
}));
vi.mock('@/lib/segmentation/mobile-sam-client', () => ({
  MobileSamClient: vi.fn().mockImplementation(() => ({
    warmup: vi.fn(async () => {}),
    encode: vi.fn(async () => ({
      imageNodeId: 'in-1',
      data: new Float32Array(0),
      shape: [],
      imageSize: { w: 100, h: 100 },
    })),
    decode: vi.fn(async () => ({
      mask: new Uint8Array(100 * 100),
      width: 100,
      height: 100,
      score: 0.9,
    })),
  })),
}));

import { useMobileSam } from './useMobileSam';

describe('useMobileSam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports ready=true after warmup completes', async () => {
    const { result } = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npx vitest run src/hooks/useMobileSam.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useMobileSam.ts
import { useEffect, useRef, useState } from 'react';
import { detectSamCapability } from '@/lib/segmentation/sam-capability';
import { MobileSamClient } from '@/lib/segmentation/mobile-sam-client';
import type { SamPoint } from '@/lib/segmentation/mobile-sam-types';
import type { EncoderEmbedding, DecoderOutput } from '@/lib/segmentation/mobile-sam-types';

let sharedClient: MobileSamClient | null = null;

function getClient(): MobileSamClient {
  if (!sharedClient) {
    sharedClient = new MobileSamClient({
      encoderUrl: '/models/mobile-sam/mobile_sam_encoder.onnx',
      decoderUrl: '/models/mobile-sam/mobile_sam_decoder.onnx',
    });
  }
  return sharedClient;
}

export interface MobileSamApi {
  ready: boolean;
  capability: 'webgpu' | 'wasm' | 'backend' | 'probing';
  /** True when this hook should use the backend `propose_mask` path instead. */
  useBackend: boolean;
  encode: (bitmap: ImageBitmap) => Promise<EncoderEmbedding | null>;
  decode: (emb: EncoderEmbedding, points: SamPoint[]) => Promise<DecoderOutput | null>;
}

export function useMobileSam(imageNodeId: string): MobileSamApi {
  const [capability, setCapability] = useState<MobileSamApi['capability']>('probing');
  const [ready, setReady] = useState(false);
  const clientRef = useRef<MobileSamClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cap = await detectSamCapability();
      if (cancelled) return;
      setCapability(cap);
      if (cap === 'backend') {
        setReady(true);
        return;
      }
      const client = getClient();
      clientRef.current = client;
      await client.warmup();
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [imageNodeId]);

  return {
    ready,
    capability,
    useBackend: capability === 'backend',
    encode: async (bitmap) => {
      if (!clientRef.current || capability === 'backend') return null;
      return clientRef.current.encode(bitmap, imageNodeId);
    },
    decode: async (emb, points) => {
      if (!clientRef.current || capability === 'backend') return null;
      return clientRef.current.decode({ embedding: emb, points });
    },
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/hooks/useMobileSam.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMobileSam.ts src/hooks/useMobileSam.test.ts
git commit -m "feat(segmentation): useMobileSam lazy client + capability gating"
```

### Task 4.6: propose_mask MCP tool client wrapper

**Files:**
- Modify: `src/lib/mcp/backend-tools.ts` (or wherever `backendTools.propose_widget` lives — grep to confirm)

- [ ] **Step 1: Locate the tools client**

Run: `grep -rn "export.*backendTools\|propose_widget\b" src/lib/ --include="*.ts"`
Identify the right module.

- [ ] **Step 2: Add the `propose_mask` request**

Following the existing patterns (`propose_widget`), add:

```ts
export interface ProposeMaskRequest {
  image_node_id: string;
  png_base64: string;
  /** Auto-traced polygons in normalised [0,1] coords. Backend regenerates
   *  if absent. */
  paths?: [number, number][][];
  label?: string;
  /** Provenance for `MaskSummary.source`. */
  origin: 'client_refinement' | 'client_extracted' | 'backend_click';
  /** When `origin: 'backend_click'`, send the click coords and let the
   *  backend run SAM 2 — fallback path when no WebGPU available. */
  click_point?: { x: number; y: number; label: 0 | 1 };
}

export interface ProposeMaskResponse {
  mask_id: string;
  mask_summary: MaskSummary; // import the type from @/types/widget
}

export async function propose_mask(req: ProposeMaskRequest): Promise<ProposeMaskResponse> {
  return mcpCall('propose_mask', req); // or whatever the call helper is
}
```

Add `propose_mask` to whatever export object backend tools live on.

(Adapt the request shape and call mechanism to match the existing pattern. Confirm `mcpCall` (or equivalent) is the right transport.)

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: no new errors. If the backend doesn't yet implement `propose_mask`, that's fine — the call will error at runtime; that surfaces as a no-op in phase 4 commit flow until the backend lands. Document this in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/backend-tools.ts  # (adjust path)
git commit -m "feat(mcp): propose_mask tool (browser-refined + backend-click fallback)"
```

> **Backend TODO (out of this plan's scope):** implement the `propose_mask` MCP tool server-side. It accepts either a baked `png_base64` (browser path) or a `click_point` (backend path, runs SAM 2), returns `{ mask_id, mask_summary }`, and inserts the summary into the snapshot's `masks_index`. Coordinate with the backend agent.

### Task 4.7: SegmentHitLayer — shift-click refinement (browser path)

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`

- [ ] **Step 1: Add shift-click hook + preview state**

```tsx
import { useMobileSam } from '@/hooks/useMobileSam';
import { propose_mask } from '@/lib/mcp/backend-tools';
import { segmentStore } from '@/lib/segmentation/segment-store';
import type { SamPoint, EncoderEmbedding } from '@/lib/segmentation/mobile-sam-types';
```

Add state:

```tsx
  const sam = useMobileSam(imageNodeId);
  const [previewMask, setPreviewMask] = useState<Uint8Array | null>(null);
  const embeddingRef = useRef<EncoderEmbedding | null>(null);
```

Lazy-encode the source bitmap on first shift-click:

```tsx
  const ensureEmbedding = useCallback(async (): Promise<EncoderEmbedding | null> => {
    if (embeddingRef.current) return embeddingRef.current;
    if (sam.useBackend) return null;
    const sourceCanvas = CanvasRegistry.get(/* active layer id */); // adapt
    if (!sourceCanvas) return null;
    const bitmap = await createImageBitmap(sourceCanvas as unknown as ImageBitmapSource);
    const emb = await sam.encode(bitmap);
    embeddingRef.current = emb;
    return emb;
  }, [sam]);
```

Add the shift-click handler:

```tsx
  const handleShiftClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.shiftKey) return;
    const el = layerRef.current;
    if (!el) return;
    const [nx, ny] = clientToNormalised(e, el);
    const points: SamPoint[] = [{ x: nx, y: ny, label: 1 }];
    if (sam.useBackend) {
      // Backend fallback: round-trip immediately, register the resulting mask.
      const res = await propose_mask({
        image_node_id: imageNodeId,
        png_base64: '', // backend computes from click_point
        origin: 'backend_click',
        click_point: { x: nx, y: ny, label: 1 },
      });
      // The mask_summary will arrive through the existing SSE channel and
      // land in masks_index; segment-store picks it up via useSegmentInteraction.
      return;
    }
    const emb = await ensureEmbedding();
    if (!emb) return;
    const out = await sam.decode(emb, points);
    if (!out) return;
    setPreviewMask(out.mask);
  }, [sam, imageNodeId, ensureEmbedding]);
```

Wire `handleShiftClick` into `handleClick` (gate on `e.shiftKey`).

- [ ] **Step 2: Add Enter-to-commit**

Inside the component, add a keydown listener for Enter that converts `previewMask` → PNG base64 + auto-traced polygons, then calls `propose_mask`. (Add helpers to `mask-utils.ts` for `maskToPngBase64` and `traceMaskToPolygons` — quick marching-squares.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
Open an image. Wait for analyze. Shift-click somewhere SAM missed. Expected:
- Encoder warm-up status appears once (~hundreds of ms).
- Subsequent shift-clicks paint a cyan dashed preview outline within ~50 ms.
- Enter commits → the SSE channel echoes `mask.created` and the new region becomes selectable.
- If WebGPU isn't available (test by disabling it in browser flags), the same shift-click round-trips through `propose_mask` with `origin: 'backend_click'` and the new mask appears via the existing SSE channel.

- [ ] **Step 4: Verify check + tests**

Run: `npm run check && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx src/lib/segmentation/mask-utils.ts
git commit -m "feat(segmentation): shift-click MobileSAM refinement + backend fallback"
```

### Phase 4 Verification Gate

- [ ] On a WebGPU-capable machine:
  - First shift-click on a new ImageNode loads the encoder (one-time ~hundreds of ms).
  - Subsequent shift-clicks refine a preview within ~50 ms.
  - Enter commits the mask via `propose_mask`; the mask appears in `masks_index` and is selectable.
- [ ] On a non-WebGPU machine (test in Safari with WebGPU disabled, or via the `?allowWasm=0` flag if you add one):
  - Shift-click triggers a backend call via `propose_mask` with `origin: 'backend_click'`.
  - The mask appears via the SSE channel within ~500 ms.
- [ ] `npm run check` clean.
- [ ] All tests green.

---

## Phase 5: Polish

Goal: small ergonomics fixes that take the feature from "demoable" to "shippable."

### Task 5.1: Escape clears segment selection

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`

- [ ] **Step 1: Add a global keydown effect**

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useEditorStore.getState().clearSelection();
        setPreviewMask(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx
git commit -m "feat(canvas): Escape clears segment selection + pending preview"
```

### Task 5.2: O toggles object mode on the active ImageNode

**Files:**
- Modify: `src/lib/keyboard-shortcuts.ts`

- [ ] **Step 1: Add the shortcut**

Inside `buildShortcuts`, push:

```ts
  shortcuts.push({
    key: 'o',
    action: () => {
      const state = useEditorStore.getState();
      const id = state.activeImageNodeId;
      if (!id) return;
      const current = state.imageNodeMode[id] ?? 'objects';
      state.setImageNodeMode(id, current === 'objects' ? 'layers' : 'objects');
    },
    label: 'Toggle Objects Mode',
  });
```

(This binds bare `O`. Confirm no other unmodified-letter shortcut already uses `o`; if so, use `Shift+O`.)

- [ ] **Step 2: Verify on dev server**

Run: `npm run dev`
With an ImageNode active, press `O`. Expected: the mode toggles; the hit layer mounts/unmounts accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/keyboard-shortcuts.ts
git commit -m "feat(canvas): O toggles Objects/Layers mode on active ImageNode"
```

### Task 5.3: Right-click "Extract" context menu

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`

- [ ] **Step 1: Add a Radix ContextMenu wrapper**

Wrap the existing layer `<div>` in a `<ContextMenu.Root>` whose `<ContextMenu.Item>` for "Extract" triggers `useSegmentExtraction.extract(...)` with the current selection. The implementation mirrors the existing right-click menus in `ImageNode.tsx`.

- [ ] **Step 2: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx
git commit -m "feat(canvas): right-click Extract action on a selected segment"
```

### Phase 5 Verification Gate

- [ ] Escape clears selection from any segment state.
- [ ] `O` toggles modes on the active ImageNode.
- [ ] Right-click on a selected segment offers "Extract" and runs the same pipeline as Alt-drag.
- [ ] `npm run check` clean. All tests green.

---

## Self-Review Notes

**Spec coverage:** Every section of `2026-06-10-object-mode-segment-extraction-design.md` is mapped to phase-tagged tasks above — Object-mode footer (1.5, 1.6), click-select (1.2–1.10), drag-out (2.2–2.7), drop-back-as-child-layer (3.1–3.4), MobileSAM refinement (4.1–4.7), and the polish list (5.1–5.3). The two unavoidable gotchas from the spec — mask-ID consistency (browser refinement → fresh `mask_id` via `propose_mask`) and double encoding cost (~hundreds of ms one-time per ImageNode) — are baked into Task 4.6 and 4.7's UX. The fallback for missing WebGPU is Task 4.6's `origin: 'backend_click'` branch and 4.7's `sam.useBackend` check.

**Open assumptions the executor needs to validate against the live codebase:**
- The exact name of the image-layer `type` string used by `addLayer` (Task 2.5 Step 4 — grep `addLayer(` in `useFileIO.ts`).
- The `CanvasRegistry.get(layerId)` return shape (Task 2.6 Step 1 — could be a `{ source, working }` pair, in which case use `.working`).
- The display-dimension variable names in `ImageNode.tsx` for `displayW` / `displayH` (Task 1.10 Step 3).
- The MCP transport helper name (`mcpCall`, `backendTools`, or similar) in Task 4.6 Step 2.
- Whether `O` is already bound; if so, use `Shift+O` (Task 5.2).
