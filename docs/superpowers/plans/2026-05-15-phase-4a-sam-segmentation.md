# Phase 4 Plan A — SAM Segmentation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual segmentation works end-to-end — user picks a selection tool, clicks the image, gets a mask, and can: extract the mask as a non-destructive branched layer, scope adjustments to the mask, or run Cmd+K targeted at the mask.

**Architecture:** First-class `MaskStore` (singleton, mirrors `pixelStore`). In-browser SAM ViT-B (ONNX Web) in a Comlink worker; embedding cached per layer, decoder runs per click. Four selection tools (point, multi-point, box, brush-mask) write to a shared `useSegmentationStore`. WebGL shader gains a `u_mask`/`u_useMask` uniform pair; `PipelineManager` uploads mask alpha as R8 texture when an adjustment has mask scope. `LayerCompositor.renderLayer` honors `Layer.parentLayerId` + `Layer.layerMask` for branch rendering. A `SegmentActionsBar` floats over the canvas after mask commit with Extract / Edit-with-AI / Scope / Discard. Cmd+K's `TargetRef` gains a `mask` variant; existing `addAiStepNode` is extended to propagate mask scope onto generated adjustments.

**Tech Stack:** TypeScript strict · Zustand v5 + immer · React 19 · Fabric.js v7 · React Flow (@xyflow/react) · Comlink workers · ONNX Runtime Web · WebGL 2 fragment shaders · vitest (Node env).

**Spec:** `docs/superpowers/specs/2026-05-15-phase-4-sam-segmentation-design.md`

**Out of scope (covered by Plan B & C):**
- Replicate inpainting and the "Remove" action — Plan B
- Backend `/api/agent` SSE loop and Cmd+K migration — Plan C
- `add_adjustment`, `extract_to_layer`, `remove_region` exposed as Anthropic tools — Plan C

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/types/scope.ts` | create | Typed `Scope` discriminated union |
| `src/types/operation-graph.ts` | modify | Reference new `Scope`; drop loose `ScopeKind` |
| `src/types/ai-target.ts` | modify | Add `{ kind: 'mask'; layerId }` variant + update `targetRefEquals` |
| `src/store/layer-slice.ts` | modify | Add `Layer.parentLayerId`, `Layer.layerMask`; add `Adjustment.scope` |
| `src/store/segmentation-slice.ts` | create | `activeMaskRef`, `committedMaskRef`, `encoderState` |
| `src/store/index.ts` | modify | Compose `SegmentationSlice` into `EditorState` |
| `src/core/mask-store.ts` | create | First-class `Mask` + `MaskStore` singleton |
| `src/core/mask-store.test.ts` | create | Unit tests for store API |
| `src/lib/sam/model-loader.ts` | create | Lazy ONNX session fetch + IDB cache |
| `src/lib/sam/sam-client.ts` | create | Embedding cache + `segment()` facade |
| `src/workers/sam.worker.ts` | create | Comlink worker wrapping ONNX sessions |
| `src/shaders/mask-snippet.glsl.ts` | create | Shared GLSL `applyMask()` snippet |
| `src/shaders/*.glsl.ts` | modify | Include `applyMask` in each adjustment shader |
| `src/lib/pipeline-manager.ts` | modify | Upload mask alpha as R8 texture, set `u_useMask`/`u_mask` |
| `src/lib/layer-compositor.ts` | modify | Honor `parentLayerId` + `layerMask` in `renderLayer` |
| `src/core/derived-graph.ts` | modify | Add branch edges for layers with `parentLayerId` siblings |
| `src/components/canvas/MaskOverlay.tsx` | create | Render live mask + marching-ants outline |
| `src/components/canvas/SegmentActionsBar.tsx` | create | Floating action bar after commit |
| `src/components/canvas/EditorCanvas.tsx` | modify | Mount MaskOverlay + SegmentActionsBar |
| `src/tools/select-point-tool.ts` | create | Single-point selection |
| `src/tools/select-multi-point-tool.ts` | create | Multi-point with +/− |
| `src/tools/select-box-tool.ts` | create | Box prompt |
| `src/tools/brush-mask-tool.tsx` | create | Paint into mask alpha |
| `src/store/segment-actions.ts` | create | `extractLayerFromMask` action |
| `src/lib/target-ref.ts` | modify | Handle `mask` variant in `humanLabelFor` and `renderTargetSnapshot` |
| `src/store/ai-panel-actions.ts` | modify | Propagate mask scope onto adjustments when target is mask |
| `src/App.tsx` | modify | Register the four new tools |
| `package.json` | modify | Add `onnxruntime-web` dependency |

---

## Test conventions

- Runner: `vitest`, node environment, no globals. Import `describe, it, expect, beforeEach` from `vitest`.
- Tests colocated as `<file>.test.ts` next to source.
- Reset pattern for editor-store-touching tests:
  ```ts
  beforeEach(() => {
    useEditorStore.setState({
      layers: [],
      activeLayerId: null,
    } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  });
  ```
- Single-run command: `npm run test:run`.
- Full check: `npm run check` (must pass before each commit; pre-commit hook enforces this).
- 43 pre-existing lint warnings; do NOT fix them.

---

## Task 1 — Typed `Scope` + `Adjustment.scope` field

**Files:**
- Create: `src/types/scope.ts`
- Modify: `src/types/operation-graph.ts`
- Modify: `src/store/layer-slice.ts`

Replaces today's loose `ScopeKind = 'global' | 'mask:click' | 'mask:proposed'` with a typed discriminated union. Adjustments gain an optional `scope` field. No runtime semantics change yet (mask compositing comes later); this task is types-only.

- [ ] **Step 1: Create `src/types/scope.ts`**

```ts
// src/types/scope.ts
export type MaskRef = string;

export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; maskRef: MaskRef }
  | { kind: 'mask:proposed'; label: string; representativePoint: [number, number]; confidence?: number };

export function scopeEquals(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'global') return true;
  if (a.kind === 'mask' && b.kind === 'mask') return a.maskRef === b.maskRef;
  if (a.kind === 'mask:proposed' && b.kind === 'mask:proposed') {
    return a.label === b.label
      && a.representativePoint[0] === b.representativePoint[0]
      && a.representativePoint[1] === b.representativePoint[1];
  }
  return false;
}

export const GLOBAL_SCOPE: Scope = { kind: 'global' };
```

- [ ] **Step 2: Update `src/types/operation-graph.ts`**

Open the file. Replace the current `ScopeKind` + `Scope` block (lines 1-8) with:

```ts
import type { Scope } from './scope';
export type { Scope, MaskRef } from './scope';

export interface Node {
  id: string;
  type: string;
  scope: Scope;
  params: Record<string, number | string | boolean>;
  inputs: string[];
}
```

If `src/lib/operation-graph-schema.ts` (Zod schema) references the old `ScopeKind`, update its scope schema to:

```ts
const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('mask'), maskRef: z.string() }),
  z.object({
    kind: z.literal('mask:proposed'),
    label: z.string(),
    representativePoint: z.tuple([z.number(), z.number()]),
    confidence: z.number().optional(),
  }),
]);
```

Backend compatibility: the existing backend may still emit `kind: 'mask:click'` (legacy). For safety, add a *coercion* before parse — convert `kind: 'mask:click'` to `kind: 'mask:proposed'` with the existing point/label fields. This keeps the legacy code path readable until Plan C deprecates it.

- [ ] **Step 3: Extend `Adjustment` in `src/store/layer-slice.ts`**

Find the `Adjustment` interface (around lines 30-40). Add `scope` field:

```ts
import type { Scope } from '@/types/scope';

export interface Adjustment {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  params: Record<string, number | Float32Array>;
  aiSource?: AiSource;
  scope?: Scope;          // new — defaults to global when absent
}
```

- [ ] **Step 4: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```
Expected: PASS (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/types/scope.ts src/types/operation-graph.ts \
        src/lib/operation-graph-schema.ts src/store/layer-slice.ts
git commit -m "feat(types): typed Scope discriminated union; Adjustment.scope field"
```

---

## Task 2 — `TargetRef` mask variant

**Files:**
- Modify: `src/types/ai-target.ts`
- Modify: `src/lib/target-ref.ts`
- Modify: `src/lib/target-ref.test.ts`

Adds a `mask` variant to `TargetRef`. Updates `humanLabelFor` and `renderTargetSnapshot` accordingly.

- [ ] **Step 1: Write failing test additions**

Append to `src/lib/target-ref.test.ts`:

```ts
import { maskStore } from '@/core/mask-store';
// NOTE: maskStore is created in Task 3. This test will run after Task 3 — for now,
// stub maskStore.get to return a fake mask in the test:
import { vi } from 'vitest';

describe('humanLabelFor with mask target', () => {
  it('returns the mask label if set', () => {
    const layerId = 'L1';
    useEditorStore.getState().addLayer({
      id: layerId, type: 'image', name: 'Portrait',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    vi.spyOn(maskStore, 'get').mockReturnValue({
      id: 'm1', layerId, width: 10, height: 10, data: new Uint8Array(100),
      source: 'sam-point', createdAt: 0, label: 'sky',
    });
    expect(humanLabelFor({ kind: 'mask', layerId, maskRef: 'm1' })).toBe('Portrait · sky');
  });
});
```

(This test is added now but depends on Task 3's `maskStore`. If you implement tasks in order, write the test in Task 3 instead. For TDD discipline, prefer running Task 1+2 tests after Task 3.)

- [ ] **Step 2: Extend the union in `src/types/ai-target.ts`**

```ts
export type TargetRef =
  | { kind: 'layer'; layerId: string }
  | { kind: 'node'; layerId: string; adjustmentId: string }
  | { kind: 'mask'; layerId: string; maskRef: string }
  | { kind: 'composite' };

export function targetRefEquals(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'composite') return true;
  if (a.kind === 'layer' && b.kind === 'layer') return a.layerId === b.layerId;
  if (a.kind === 'node' && b.kind === 'node') {
    return a.layerId === b.layerId && a.adjustmentId === b.adjustmentId;
  }
  if (a.kind === 'mask' && b.kind === 'mask') {
    return a.layerId === b.layerId && a.maskRef === b.maskRef;
  }
  return false;
}
```

- [ ] **Step 3: Update `humanLabelFor` and `renderTargetSnapshot` in `src/lib/target-ref.ts`**

In `humanLabelFor`, add the `mask` case:

```ts
if (ref.kind === 'mask') {
  const layer = editor.layers.find((l) => l.id === ref.layerId);
  if (!layer) return 'Unknown target';
  const { maskStore } = await import('@/core/mask-store');
  const mask = maskStore.get(ref.maskRef);
  return `${layer.name} · ${mask?.label ?? 'Selection'}`;
}
```

`humanLabelFor` is currently synchronous (no `async`). Since maskStore lives in plain memory (no DB), use a synchronous static import once Task 3 lands and rewrite the case as:

```ts
import { maskStore } from '@/core/mask-store';

// inside humanLabelFor:
if (ref.kind === 'mask') {
  const layer = editor.layers.find((l) => l.id === ref.layerId);
  if (!layer) return 'Unknown target';
  const mask = maskStore.get(ref.maskRef);
  return `${layer.name} · ${mask?.label ?? 'Selection'}`;
}
```

In `renderTargetSnapshot`, add the mask case (after the composite case, before the layer fallback):

```ts
if (target.kind === 'mask') {
  const { maskStore } = await import('@/core/mask-store');
  const { LayerCompositor } = await import('./layer-compositor');
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === target.layerId);
  const mask = maskStore.get(target.maskRef);
  if (!layer || !mask) throw new Error('renderTargetSnapshot: mask or layer missing');
  // Render the layer through its pipeline...
  const rendered = LayerCompositor.renderLayer(layer);
  if (!rendered) throw new Error('renderTargetSnapshot: failed to render host layer');
  // ...then multiply by the mask alpha.
  const out = document.createElement('canvas');
  out.width = rendered.width;
  out.height = rendered.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('renderTargetSnapshot: no 2d context');
  ctx.drawImage(rendered, 0, 0);
  const imageData = ctx.getImageData(0, 0, rendered.width, rendered.height);
  for (let i = 0; i < mask.data.length; i++) {
    imageData.data[i * 4 + 3] = (imageData.data[i * 4 + 3] * mask.data[i]) / 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToDownscaledPng(out);
}
```

(Assumes `mask.width === rendered.width` and `mask.height === rendered.height`. Plan A enforces this invariant by sizing masks to the source canvas at registration time — see Task 3.)

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/ai-target.ts src/lib/target-ref.ts src/lib/target-ref.test.ts
git commit -m "feat(ai): TargetRef mask variant + humanLabelFor/renderTargetSnapshot handling"
```

---

## Task 3 — `MaskStore` singleton

**Files:**
- Create: `src/core/mask-store.ts`
- Create: `src/core/mask-store.test.ts`

First-class mask storage that mirrors `pixelStore`'s API surface.

- [ ] **Step 1: Write failing tests**

```ts
// src/core/mask-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { maskStore } from './mask-store';
import type { Mask } from './mask-store';

function makeMask(overrides: Partial<Mask> = {}): Omit<Mask, 'id'> {
  return {
    layerId: 'L1',
    width: 4,
    height: 4,
    data: new Uint8Array(16).fill(255),
    source: 'sam-point',
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  maskStore.clear();
});

describe('maskStore.register', () => {
  it('assigns a unique id and stores the mask', () => {
    const id = maskStore.register(makeMask());
    expect(typeof id).toBe('string');
    const mask = maskStore.get(id);
    expect(mask?.width).toBe(4);
    expect(mask?.data.length).toBe(16);
  });

  it('preserves the provided label', () => {
    const id = maskStore.register(makeMask({ label: 'sky' }));
    expect(maskStore.get(id)?.label).toBe('sky');
  });
});

describe('maskStore.remove', () => {
  it('returns true when a mask is removed', () => {
    const id = maskStore.register(makeMask());
    expect(maskStore.remove(id)).toBe(true);
    expect(maskStore.get(id)).toBeUndefined();
  });

  it('returns false when the mask did not exist', () => {
    expect(maskStore.remove('missing')).toBe(false);
  });
});

describe('maskStore.clear', () => {
  it('removes all masks', () => {
    maskStore.register(makeMask());
    maskStore.register(makeMask());
    expect(maskStore.size).toBe(2);
    maskStore.clear();
    expect(maskStore.size).toBe(0);
  });
});

describe('maskStore.all', () => {
  it('returns all masks for a given layerId', () => {
    maskStore.register(makeMask({ layerId: 'L1', label: 'a' }));
    maskStore.register(makeMask({ layerId: 'L2', label: 'b' }));
    maskStore.register(makeMask({ layerId: 'L1', label: 'c' }));
    const layer1Masks = maskStore.allForLayer('L1');
    expect(layer1Masks).toHaveLength(2);
    expect(layer1Masks.map((m) => m.label).sort()).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/core/mask-store.test.ts
```
Expected: FAIL — "Cannot find module './mask-store'".

- [ ] **Step 3: Implement `src/core/mask-store.ts`**

```ts
// src/core/mask-store.ts
import type { MaskRef } from '@/types/scope';

export type MaskSource =
  | 'sam-point'
  | 'sam-points'
  | 'sam-box'
  | 'brush'
  | 'ai-proposed';

export interface SamPrompt {
  kind: 'point' | 'box';
  data: number[];
}

export interface Mask {
  id: string;
  layerId: string;
  label?: string;
  width: number;
  height: number;
  data: Uint8Array;
  source: MaskSource;
  prompts?: SamPrompt[];
  createdAt: number;
}

class MaskStoreImpl {
  private masks = new Map<string, Mask>();

  register(input: Omit<Mask, 'id'>): MaskRef {
    const id = crypto.randomUUID();
    this.masks.set(id, { ...input, id });
    return id;
  }

  get(ref: MaskRef): Mask | undefined {
    return this.masks.get(ref);
  }

  /** Overwrite an existing mask's data (e.g. brush refinement). Bumps an internal version. */
  updateData(ref: MaskRef, data: Uint8Array): void {
    const m = this.masks.get(ref);
    if (!m) return;
    if (data.length !== m.width * m.height) {
      throw new Error(`updateData: expected ${m.width * m.height} bytes, got ${data.length}`);
    }
    m.data = data;
  }

  setLabel(ref: MaskRef, label: string): void {
    const m = this.masks.get(ref);
    if (m) m.label = label;
  }

  remove(ref: MaskRef): boolean {
    return this.masks.delete(ref);
  }

  clear(): void {
    this.masks.clear();
  }

  has(ref: MaskRef): boolean {
    return this.masks.has(ref);
  }

  get size(): number {
    return this.masks.size;
  }

  allForLayer(layerId: string): Mask[] {
    return Array.from(this.masks.values()).filter((m) => m.layerId === layerId);
  }

  all(): Mask[] {
    return Array.from(this.masks.values());
  }
}

export const maskStore = new MaskStoreImpl();
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/core/mask-store.test.ts
```
Expected: PASS, 7/7.

- [ ] **Step 5: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/mask-store.ts src/core/mask-store.test.ts
git commit -m "feat(masks): MaskStore singleton with register/get/update/remove API"
```

---

## Task 4 — `Layer.parentLayerId` + `Layer.layerMask`

**Files:**
- Modify: `src/store/layer-slice.ts`
- Modify: `src/store/layer-slice.test.ts`

Two additive Layer fields. No behavioral change yet (compositing semantics come in Task 9). This task is types + a guard against cyclic parentage.

- [ ] **Step 1: Append failing tests**

Append to `src/store/layer-slice.test.ts`:

```ts
describe('Layer.parentLayerId + Layer.layerMask', () => {
  it('accepts new optional fields on addLayer', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'Branch',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
      layerMask: 'mask-1',
    } as unknown as Parameters<typeof useEditorStore.getState>[0] extends never ? never : Parameters<typeof useEditorStore.getState>[0]);
    const layers = useEditorStore.getState().layers;
    const branch = layers.find((l) => l.id === 'L2')!;
    expect(branch.parentLayerId).toBe('L1');
    expect(branch.layerMask).toBe('mask-1');
  });

  it('rejects a layer whose parentLayerId would create a cycle', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'A',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'B',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
    });
    expect(() => {
      useEditorStore.getState().updateLayer('L1', { parentLayerId: 'L2' });
    }).toThrow(/cycle/i);
  });

  it('blocks removeLayer for a layer that has children', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'parent',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'child',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
    });
    expect(() => useEditorStore.getState().removeLayer('L1')).toThrow(/has child/i);
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run src/store/layer-slice.test.ts
```
Expected: FAIL — `parentLayerId` not accepted, no cycle guard.

- [ ] **Step 3: Update the `Layer` interface in `src/store/layer-slice.ts`**

```ts
import type { MaskRef } from '@/types/scope';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
  adjustmentStack: AdjustmentStack;
  textMeta?: TextMeta;
  cropMeta?: CropMeta;
  operationGraph?: OperationGraph;
  panelBindings?: PanelBinding[];
  aiSteps?: Record<string, AiStepMeta>;
  parentLayerId?: string;       // new — non-destructive branching
  layerMask?: MaskRef;          // new — alpha mask applied at composite time
}
```

- [ ] **Step 4: Update `addLayer` signature**

The current type omits `'order' | 'adjustmentStack'`. Keep the same shape; the new optional fields are auto-included.

- [ ] **Step 5: Add cycle guard to `updateLayer` + child guard to `removeLayer`**

Find `updateLayer` in the slice. Add a check before applying updates:

```ts
updateLayer: (id, updates) =>
  set((state) => {
    const layer = state.layers.find((l) => l.id === id);
    if (!layer) return;
    if ('parentLayerId' in updates && updates.parentLayerId !== undefined) {
      // Walk up the proposed parent chain to detect cycles.
      let cursor: string | undefined = updates.parentLayerId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) throw new Error(`updateLayer: parentLayerId would create a cycle (${id})`);
        if (seen.has(cursor)) break;
        seen.add(cursor);
        cursor = state.layers.find((l) => l.id === cursor)?.parentLayerId;
      }
    }
    Object.assign(layer, updates);
  }),
```

Find `removeLayer`. Add the child guard at top:

```ts
removeLayer: (id) =>
  set((state) => {
    const hasChildren = state.layers.some((l) => l.parentLayerId === id);
    if (hasChildren) throw new Error(`removeLayer: layer "${id}" has child layers — remove children first`);
    // ... existing removal logic
  }),
```

Also: when a new `addLayer` is called with a `parentLayerId`, validate the parent exists (same idea as the cycle check but simpler):

```ts
addLayer: (input) =>
  set((state) => {
    if (input.parentLayerId && !state.layers.some((l) => l.id === input.parentLayerId)) {
      throw new Error(`addLayer: parentLayerId "${input.parentLayerId}" does not exist`);
    }
    // ... existing logic
  }),
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/store/layer-slice.test.ts
```
Expected: PASS.

- [ ] **Step 7: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/store/layer-slice.ts src/store/layer-slice.test.ts
git commit -m "feat(layers): parentLayerId + layerMask fields with cycle/child guards"
```

---

## Task 5 — `useSegmentationStore` Zustand slice

**Files:**
- Create: `src/store/segmentation-slice.ts`
- Modify: `src/store/index.ts`
- Create: `src/store/segmentation-slice.test.ts`

Holds the live mask state for the active selection tool.

- [ ] **Step 1: Write failing tests**

```ts
// src/store/segmentation-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    activeMaskRef: null,
    committedMaskRef: null,
    encoderState: 'idle',
    activeScope: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('segmentation slice', () => {
  it('starts with null active and committed mask', () => {
    const s = useEditorStore.getState();
    expect(s.activeMaskRef).toBeNull();
    expect(s.committedMaskRef).toBeNull();
    expect(s.encoderState).toBe('idle');
  });

  it('setActiveMask updates only activeMaskRef', () => {
    useEditorStore.getState().setActiveMask('m1');
    expect(useEditorStore.getState().activeMaskRef).toBe('m1');
    expect(useEditorStore.getState().committedMaskRef).toBeNull();
  });

  it('commitMask moves activeMaskRef into committedMaskRef and clears active', () => {
    useEditorStore.getState().setActiveMask('m1');
    useEditorStore.getState().commitMask();
    expect(useEditorStore.getState().activeMaskRef).toBeNull();
    expect(useEditorStore.getState().committedMaskRef).toBe('m1');
  });

  it('discardCommittedMask clears the committed ref', () => {
    useEditorStore.getState().setActiveMask('m1');
    useEditorStore.getState().commitMask();
    useEditorStore.getState().discardCommittedMask();
    expect(useEditorStore.getState().committedMaskRef).toBeNull();
  });

  it('setEncoderState transitions encoder lifecycle', () => {
    useEditorStore.getState().setEncoderState('loading-model');
    expect(useEditorStore.getState().encoderState).toBe('loading-model');
    useEditorStore.getState().setEncoderState('ready');
    expect(useEditorStore.getState().encoderState).toBe('ready');
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run src/store/segmentation-slice.test.ts
```
Expected: FAIL — slice not in store.

- [ ] **Step 3: Create the slice**

```ts
// src/store/segmentation-slice.ts
import type { StateCreator } from 'zustand';
import type { MaskRef, Scope } from '@/types/scope';

export type EncoderState = 'idle' | 'loading-model' | 'encoding' | 'ready' | 'error';

export interface SegmentationSlice {
  activeMaskRef: MaskRef | null;
  committedMaskRef: MaskRef | null;
  encoderState: EncoderState;
  /** When set, the next adjustment added gets this scope automatically. Cleared by setActiveScope(null). */
  activeScope: Scope | null;

  setActiveMask: (ref: MaskRef | null) => void;
  commitMask: () => void;
  discardCommittedMask: () => void;
  setEncoderState: (s: EncoderState) => void;
  setActiveScope: (scope: Scope | null) => void;
}

export const createSegmentationSlice: StateCreator<
  SegmentationSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  activeMaskRef: null,
  committedMaskRef: null,
  encoderState: 'idle',
  activeScope: null,

  setActiveMask: (ref) => set((state) => { state.activeMaskRef = ref; }),
  commitMask: () => set((state) => {
    state.committedMaskRef = state.activeMaskRef;
    state.activeMaskRef = null;
  }),
  discardCommittedMask: () => set((state) => { state.committedMaskRef = null; }),
  setEncoderState: (s) => set((state) => { state.encoderState = s; }),
  setActiveScope: (scope) => set((state) => { state.activeScope = scope; }),
});
```

- [ ] **Step 4: Compose into `src/store/index.ts`**

```ts
import { type SegmentationSlice, createSegmentationSlice } from './segmentation-slice';

export type EditorState =
  & LayerSlice
  & ViewportSlice
  & ToolSlice
  & DocumentSlice
  & SegmentationSlice;

export const useEditorStore = create<EditorState>()(
  devtools(
    immer((set, get, store) => ({
      ...createLayerSlice(set as never, get as never, store as never),
      ...createViewportSlice(set as never, get as never, store as never),
      ...createToolSlice(set as never, get as never, store as never),
      ...createDocumentSlice(set as never, get as never, store as never),
      ...createSegmentationSlice(set as never, get as never, store as never),
    }))
  )
);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/store/segmentation-slice.test.ts
```
Expected: PASS, 5/5.

- [ ] **Step 6: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/segmentation-slice.ts src/store/index.ts src/store/segmentation-slice.test.ts
git commit -m "feat(seg): useSegmentationStore slice — active/committed mask + encoder state"
```

---

## Task 6 — Install `onnxruntime-web` + SAM model loader

**Files:**
- Modify: `package.json`
- Create: `src/lib/sam/model-loader.ts`

Fetch the ViT-B encoder + decoder ONNX files on first selection action; cache as Blobs in IndexedDB.

- [ ] **Step 1: Install dependency**

```bash
cd /Users/anton/Dev/Projects/editor && npm install onnxruntime-web@^1.20.1
```

Verify the entry appears in `package.json` under `dependencies`. The package ships WASM/WebGPU runtimes — Vite serves them automatically.

- [ ] **Step 2: Create `src/lib/sam/model-loader.ts`**

```ts
// src/lib/sam/model-loader.ts
import * as ort from 'onnxruntime-web';

// Quantized SAM ViT-B from Xenova (Hugging Face) — pre-converted to ONNX.
// Encoder ~94 MB, decoder ~2 MB. Update these URLs to point at a CDN you
// control before shipping to prod — relying on Hugging Face for large
// downloads is fine for the thesis demo.
const SAM_ENCODER_URL = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_quantized.onnx';
const SAM_DECODER_URL = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/prompt_encoder_mask_decoder.onnx';

const DB_NAME = 'sam-models';
const STORE_NAME = 'sessions';
const VERSION_KEY = 'v1';

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIdb(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function saveToIdb(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function fetchModel(url: string, onProgress?: (frac: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`SAM model fetch failed: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && onProgress) onProgress(received / total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  return buf.buffer;
}

let encoderPromise: Promise<ort.InferenceSession> | null = null;
let decoderPromise: Promise<ort.InferenceSession> | null = null;

export interface ModelLoadProgress {
  encoder: number;   // 0–1
  decoder: number;   // 0–1
}

let progressListeners = new Set<(p: ModelLoadProgress) => void>();
const progress: ModelLoadProgress = { encoder: 0, decoder: 0 };
function emitProgress() { for (const cb of progressListeners) cb({ ...progress }); }

export function onModelLoadProgress(cb: (p: ModelLoadProgress) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

async function loadOrFetch(url: string, idbKey: string, which: 'encoder' | 'decoder'): Promise<ArrayBuffer> {
  const cached = await loadFromIdb(idbKey);
  if (cached) {
    progress[which] = 1;
    emitProgress();
    return cached;
  }
  const buf = await fetchModel(url, (frac) => {
    progress[which] = frac;
    emitProgress();
  });
  await saveToIdb(idbKey, buf);
  return buf;
}

export async function getEncoder(): Promise<ort.InferenceSession> {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      const buf = await loadOrFetch(SAM_ENCODER_URL, `${VERSION_KEY}/encoder`, 'encoder');
      return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    })();
  }
  return encoderPromise;
}

export async function getDecoder(): Promise<ort.InferenceSession> {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const buf = await loadOrFetch(SAM_DECODER_URL, `${VERSION_KEY}/decoder`, 'decoder');
      return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    })();
  }
  return decoderPromise;
}
```

**Implementation notes:**
- The Xenova `slimsam-77-uniform` model is a smaller, faster SAM variant (~80 MB total) suitable for thesis demo. If you want full SAM ViT-B (~92 MB encoder), switch to `Xenova/sam-vit-base`. Test perf on a target machine before deciding.
- WebGPU execution provider (`['webgpu', 'wasm']`) can be ~3× faster on supported hardware. Start with `wasm` for predictability; engineer may enable webgpu after the spike test.
- The model URLs are pinned to specific Xenova paths. Verify they still exist when implementing.

- [ ] **Step 3: Run check**

```bash
npm run check
```
Expected: PASS. ONNX imports may pull in TypeScript types; ensure no compilation errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/sam/model-loader.ts
git commit -m "feat(sam): ONNX Runtime Web + SAM model loader with IDB cache"
```

---

## Task 7 — SAM Comlink worker

**Files:**
- Create: `src/workers/sam.worker.ts`

Off-main-thread encoding + decoding. Encoder runs once per image (slow); decoder runs per click (fast).

- [ ] **Step 1: Create the worker**

```ts
// src/workers/sam.worker.ts
import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web';
import { getEncoder, getDecoder } from '@/lib/sam/model-loader';

export interface EncodeResult {
  embedding: Float32Array;
  embeddingShape: number[];
  imageSize: [number, number];   // [w, h] of the input
}

export interface PromptInput {
  pointCoords: Float32Array;     // shape [N, 2] flattened
  pointLabels: Float32Array;     // shape [N] (1 positive, 0 negative, 2 box-tl, 3 box-br)
  origImageSize: [number, number];
}

export interface DecodeResult {
  maskData: Uint8Array;          // length = imageSize[0]*imageSize[1]
  width: number;
  height: number;
}

class SamWorker {
  async encode(imageData: ImageData): Promise<EncodeResult> {
    const encoder = await getEncoder();
    // Convert RGBA → NCHW float32 normalized [0,1] (mean/std normalization per SAM).
    // SAM expects 1024×1024 input — caller should pass a 1024×1024 resized RGBA imageData
    // (or change resize logic here to match model input shape).
    const { width: w, height: h, data } = imageData;
    const chw = new Float32Array(3 * w * h);
    const SAM_MEAN = [123.675, 116.28, 103.53];
    const SAM_STD = [58.395, 57.12, 57.375];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          chw[c * w * h + y * w + x] = (data[p + c] - SAM_MEAN[c]) / SAM_STD[c];
        }
      }
    }
    const tensor = new ort.Tensor('float32', chw, [1, 3, h, w]);
    const out = await encoder.run({ input_image: tensor });
    // Xenova SAM encoder output name is 'image_embeddings' or similar — confirm via session.outputNames.
    const embKey = encoder.outputNames[0];
    const emb = out[embKey] as ort.Tensor;
    return {
      embedding: emb.data as Float32Array,
      embeddingShape: Array.from(emb.dims),
      imageSize: [w, h],
    };
  }

  async decode(args: {
    embedding: Float32Array;
    embeddingShape: number[];
    prompts: PromptInput;
    outputSize: [number, number];   // target mask size, usually same as origImageSize
  }): Promise<DecodeResult> {
    const decoder = await getDecoder();

    // Build decoder feeds. Names vary by ONNX export — adjust to match your converted model's input names.
    // For Xenova slimsam: image_embeddings, point_coords, point_labels, mask_input, has_mask_input, orig_im_size.
    const embTensor = new ort.Tensor('float32', args.embedding, args.embeddingShape);
    const coordsTensor = new ort.Tensor('float32', args.prompts.pointCoords,
      [1, args.prompts.pointCoords.length / 2, 2]);
    const labelsTensor = new ort.Tensor('float32', args.prompts.pointLabels,
      [1, args.prompts.pointLabels.length]);
    const maskInput = new ort.Tensor('float32', new Float32Array(1 * 1 * 256 * 256), [1, 1, 256, 256]);
    const hasMaskInput = new ort.Tensor('float32', new Float32Array([0]), [1]);
    const origImSize = new ort.Tensor('float32',
      new Float32Array([args.prompts.origImageSize[1], args.prompts.origImageSize[0]]), [2]);

    const out = await decoder.run({
      image_embeddings: embTensor,
      point_coords: coordsTensor,
      point_labels: labelsTensor,
      mask_input: maskInput,
      has_mask_input: hasMaskInput,
      orig_im_size: origImSize,
    });

    // Decoder produces three candidate masks + iou scores. Pick the highest-IoU mask.
    const masks = out.masks as ort.Tensor;          // shape [1, 3, H, W] (logits)
    const iou = out.iou_predictions as ort.Tensor;  // shape [1, 3]
    const iouArr = iou.data as Float32Array;
    let bestIdx = 0;
    for (let i = 1; i < iouArr.length; i++) if (iouArr[i] > iouArr[bestIdx]) bestIdx = i;

    const [_b, _n, mh, mw] = masks.dims as number[];
    const logits = masks.data as Float32Array;
    const offset = bestIdx * mh * mw;

    // Sigmoid threshold → 0/255 then bilinear-upscale to outputSize.
    const targetW = args.outputSize[0];
    const targetH = args.outputSize[1];
    const result = new Uint8Array(targetW * targetH);
    const sx = mw / targetW;
    const sy = mh / targetH;
    for (let y = 0; y < targetH; y++) {
      const fy = y * sy;
      const y0 = Math.floor(fy);
      const y1 = Math.min(mh - 1, y0 + 1);
      const ay = fy - y0;
      for (let x = 0; x < targetW; x++) {
        const fx = x * sx;
        const x0 = Math.floor(fx);
        const x1 = Math.min(mw - 1, x0 + 1);
        const ax = fx - x0;
        const v00 = logits[offset + y0 * mw + x0];
        const v01 = logits[offset + y0 * mw + x1];
        const v10 = logits[offset + y1 * mw + x0];
        const v11 = logits[offset + y1 * mw + x1];
        const v0 = v00 * (1 - ax) + v01 * ax;
        const v1 = v10 * (1 - ax) + v11 * ax;
        const v = v0 * (1 - ay) + v1 * ay;
        const sig = 1 / (1 + Math.exp(-v));
        result[y * targetW + x] = sig > 0.5 ? 255 : 0;
      }
    }
    return { maskData: result, width: targetW, height: targetH };
  }
}

Comlink.expose(new SamWorker());
```

**Implementation notes:**
- The exact tensor names (`input_image`, `image_embeddings`, etc.) depend on which ONNX conversion you use. Run `console.log(encoder.inputNames, encoder.outputNames)` once and adjust.
- The encoder expects 1024×1024 input for full SAM. For SlimSAM the input shape is the same. The caller (`samClient`, Task 8) is responsible for resizing the source image.

- [ ] **Step 2: Update Vite config to bundle the worker correctly**

Open `vite.config.ts`. Add:

```ts
worker: {
  format: 'es',
},
```

(If the file already has a `worker` block, merge with `format: 'es'`.)

- [ ] **Step 3: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/workers/sam.worker.ts vite.config.ts
git commit -m "feat(sam): Comlink worker wrapping ONNX encoder + decoder"
```

---

## Task 8 — `samClient` facade

**Files:**
- Create: `src/lib/sam/sam-client.ts`

Public API consumed by tools. Caches embeddings by `(layerId, sourceHash)`.

- [ ] **Step 1: Create the facade**

```ts
// src/lib/sam/sam-client.ts
import * as Comlink from 'comlink';
import type { EncodeResult, PromptInput, DecodeResult } from '@/workers/sam.worker';
import { pixelStore } from '@/core/pixel-store';
import { maskStore, type SamPrompt } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import type { MaskRef } from '@/types/scope';

interface SamWorkerApi {
  encode(imageData: ImageData): Promise<EncodeResult>;
  decode(args: {
    embedding: Float32Array;
    embeddingShape: number[];
    prompts: PromptInput;
    outputSize: [number, number];
  }): Promise<DecodeResult>;
}

let workerProxy: Comlink.Remote<SamWorkerApi> | null = null;

function ensureWorker(): Comlink.Remote<SamWorkerApi> {
  if (!workerProxy) {
    const w = new Worker(new URL('../../workers/sam.worker.ts', import.meta.url), { type: 'module' });
    workerProxy = Comlink.wrap<SamWorkerApi>(w);
  }
  return workerProxy;
}

interface CachedEmbedding {
  embedding: Float32Array;
  embeddingShape: number[];
  originalSize: [number, number];
}

const embeddingCache = new Map<string, CachedEmbedding>();

function embeddingKey(layerId: string, sourceHash: string): string {
  return `${layerId}:${sourceHash}`;
}

/** Cheap content hash: dimensions + corner pixel (matches Task 5 of the prior plan). */
function sourceHash(source: OffscreenCanvas): string {
  const ctx = source.getContext('2d');
  if (!ctx) return `${source.width}x${source.height}`;
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return `${source.width}x${source.height}:${px[0]},${px[1]},${px[2]},${px[3]}`;
}

const SAM_INPUT_SIZE = 1024;

function resizeToInput(source: OffscreenCanvas): ImageData {
  const tmp = new OffscreenCanvas(SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('samClient: 2d context unavailable for resize');
  ctx.drawImage(source, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  return ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
}

export const samClient = {
  async ensureEmbedding(layerId: string): Promise<void> {
    const source = pixelStore.getSource(layerId);
    if (!source) throw new Error(`samClient: no source for layer ${layerId}`);
    const hash = sourceHash(source);
    const key = embeddingKey(layerId, hash);
    if (embeddingCache.has(key)) return;

    useEditorStore.getState().setEncoderState('loading-model');
    const worker = ensureWorker();
    useEditorStore.getState().setEncoderState('encoding');
    try {
      const resized = resizeToInput(source);
      const result = await worker.encode(resized);
      embeddingCache.set(key, {
        embedding: result.embedding,
        embeddingShape: result.embeddingShape,
        originalSize: [source.width, source.height],
      });
      useEditorStore.getState().setEncoderState('ready');
    } catch (err) {
      useEditorStore.getState().setEncoderState('error');
      throw err;
    }
  },

  async segment(args: {
    layerId: string;
    prompts: SamPrompt[];
    label?: string;
  }): Promise<MaskRef> {
    const source = pixelStore.getSource(args.layerId);
    if (!source) throw new Error(`samClient: no source for layer ${args.layerId}`);
    const hash = sourceHash(source);
    const key = embeddingKey(args.layerId, hash);
    const cached = embeddingCache.get(key);
    if (!cached) {
      await this.ensureEmbedding(args.layerId);
      return this.segment(args);
    }

    // Flatten prompts into the wire format SAM expects.
    const pointArr: number[] = [];
    const labelArr: number[] = [];
    for (const p of args.prompts) {
      if (p.kind === 'point') {
        pointArr.push(p.data[0], p.data[1]);
        labelArr.push(p.data[2]);
      } else {
        pointArr.push(p.data[0], p.data[1], p.data[2], p.data[3]);
        labelArr.push(2, 3);
      }
    }

    // SAM expects prompt coords in the resized 1024×1024 space.
    const sx = SAM_INPUT_SIZE / cached.originalSize[0];
    const sy = SAM_INPUT_SIZE / cached.originalSize[1];
    const scaledCoords = new Float32Array(pointArr.length);
    for (let i = 0; i < pointArr.length; i += 2) {
      scaledCoords[i] = pointArr[i] * sx;
      scaledCoords[i + 1] = pointArr[i + 1] * sy;
    }

    const worker = ensureWorker();
    const result = await worker.decode({
      embedding: cached.embedding,
      embeddingShape: cached.embeddingShape,
      prompts: {
        pointCoords: scaledCoords,
        pointLabels: Float32Array.from(labelArr),
        origImageSize: cached.originalSize,
      },
      outputSize: cached.originalSize,
    });

    const maskRef = maskStore.register({
      layerId: args.layerId,
      label: args.label,
      width: result.width,
      height: result.height,
      data: result.maskData,
      source: args.prompts.length > 1 ? 'sam-points'
        : args.prompts[0]?.kind === 'box' ? 'sam-box'
        : 'sam-point',
      prompts: args.prompts,
      createdAt: Date.now(),
    });
    return maskRef;
  },
};
```

- [ ] **Step 2: Run check**

```bash
npm run check
```
Expected: PASS. Comlink import + Worker URL pattern must resolve correctly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sam/sam-client.ts
git commit -m "feat(sam): samClient facade with embedding cache + segment()"
```

---

## Task 9 — Mask compositing in WebGL pipeline

**Files:**
- Create: `src/shaders/mask-snippet.glsl.ts`
- Modify: `src/shaders/basic-adjustments.glsl.ts`, `src/shaders/curves.glsl.ts`, `src/shaders/levels.glsl.ts`, `src/shaders/kelvin.glsl.ts`, `src/shaders/lut.glsl.ts`
- Modify: `src/lib/pipeline-manager.ts`

Adds a shared `applyMask` GLSL snippet. Every existing fragment shader includes it. `PipelineManager` uploads the mask alpha as an R8 texture when an adjustment carries `scope.kind === 'mask'`.

- [ ] **Step 1: Create the snippet**

```ts
// src/shaders/mask-snippet.glsl.ts
export const maskSnippet = /* glsl */`
uniform sampler2D u_mask;
uniform int u_useMask;

vec4 applyMask(vec4 base, vec4 adjusted, vec2 uv) {
  if (u_useMask == 0) return adjusted;
  float a = texture(u_mask, uv).r;
  return mix(base, adjusted, a);
}
`;
```

- [ ] **Step 2: Include the snippet in each fragment shader**

For each existing shader file (`basic-adjustments.glsl.ts`, `curves.glsl.ts`, `levels.glsl.ts`, `kelvin.glsl.ts`, `lut.glsl.ts`):

1. Import the snippet at top:
   ```ts
   import { maskSnippet } from './mask-snippet.glsl';
   ```
2. In the template literal, inject the snippet right after the precision declaration / global uniforms but before `void main()`:
   ```ts
   export const curvesFragment = `#version 300 es
   precision highp float;
   ${maskSnippet}
   in vec2 v_texCoord;
   out vec4 fragColor;
   // ... rest of shader
   ```
3. Change the `main()` so that `fragColor` is the result of `applyMask`. The pattern is:
   ```glsl
   void main() {
     vec4 srcColor = texture(u_texture, v_texCoord);
     vec3 color = srcColor.rgb;
     // ... existing adjustment logic that produces `color`
     vec4 adjusted = vec4(clamp(color, 0.0, 1.0), srcColor.a);
     fragColor = applyMask(srcColor, adjusted, v_texCoord);
   }
   ```

(Repeat for each shader — the existing `fragColor = ...` line at the end is replaced by the `applyMask` call.)

- [ ] **Step 3: Add the mask texture handling to `src/lib/pipeline-manager.ts`**

Find where shader programs are created (likely a `Program` class or where uniforms are bound). Add a `u_mask` and `u_useMask` uniform per program at creation time:

```ts
// inside Program / shader-binding code:
this.uMask = gl.getUniformLocation(this.program, 'u_mask');
this.uUseMask = gl.getUniformLocation(this.program, 'u_useMask');
this.maskTexture = gl.createTexture();
```

When applying an adjustment, before `gl.drawArrays`:

```ts
// inside renderAdjustment / applyAdjustment:
const scope = adjustment.scope ?? { kind: 'global' as const };
if (scope.kind === 'mask') {
  const { maskStore } = await import('@/core/mask-store');
  const mask = maskStore.get(scope.maskRef);
  if (mask) {
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      gl.R8, mask.width, mask.height, 0,
      gl.RED, gl.UNSIGNED_BYTE, mask.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(this.uMask, 5);
    gl.uniform1i(this.uUseMask, 1);
  } else {
    gl.uniform1i(this.uUseMask, 0);
  }
} else {
  gl.uniform1i(this.uUseMask, 0);
}
```

**Implementation notes:**
- The exact insertion point depends on the existing pipeline structure. Read `src/lib/pipeline-manager.ts` to find where each adjustment is rendered. The pattern is: per-adjustment, bind program, set uniforms, render full-screen quad.
- If the pipeline uses ping-pong framebuffers, mask should be sampled in *source-image UV space*; assuming all textures share UV `[0,1]² → image`, no special handling needed.
- The dynamic import of `maskStore` inside the render path is the same pattern used elsewhere in `target-ref.ts` to avoid circular module-init issues.

- [ ] **Step 4: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

Open an image. Apply a Curves adjustment manually. The output should be visually unchanged (because no mask is set; `u_useMask = 0`).

- [ ] **Step 5: Commit**

```bash
git add src/shaders/mask-snippet.glsl.ts \
        src/shaders/basic-adjustments.glsl.ts \
        src/shaders/curves.glsl.ts \
        src/shaders/levels.glsl.ts \
        src/shaders/kelvin.glsl.ts \
        src/shaders/lut.glsl.ts \
        src/lib/pipeline-manager.ts
git commit -m "feat(shaders): applyMask snippet + pipeline u_mask/u_useMask binding"
```

---

## Task 10 — `LayerCompositor` honors `parentLayerId` + `layerMask`

**Files:**
- Modify: `src/lib/layer-compositor.ts`

Layers with `parentLayerId` derive their source pixels from the parent's pipeline output. Layers with `layerMask` get the mask applied at composite time.

- [ ] **Step 1: Extend `renderLayer` to recursively resolve parents**

Find `renderLayer(layer)` (around lines 47-73). Replace with:

```ts
renderLayer(layer: Layer): HTMLCanvasElement | null {
  // 1. Determine source pixels. If this layer has a parentLayerId, render the
  //    parent recursively (its adjustments run) and use that as our source.
  //    Otherwise read from pixelStore.
  let source: HTMLCanvasElement | OffscreenCanvas | null;
  if (layer.parentLayerId) {
    const parent = useEditorStore.getState().layers.find((l) => l.id === layer.parentLayerId);
    if (!parent) return null;
    source = this.renderLayer(parent);
    if (!source) return null;
  } else {
    source = CanvasRegistry.get(layer.id) ?? null;
    if (!source) return null;
  }

  // 2. Apply the layer's adjustment pipeline.
  const adjustments = layer.adjustmentStack.adjustments.filter((a) => a.enabled);
  let result: HTMLCanvasElement;
  if (adjustments.length === 0) {
    result = document.createElement('canvas');
    result.width = source.width;
    result.height = source.height;
    const ctx = result.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
  } else {
    PipelineManager.setSourceCanvas(source);
    result = PipelineManager.renderSync([...adjustments]);
  }

  // 3. Apply the layer mask, if any (multiply alpha by mask).
  if (layer.layerMask) {
    const { maskStore } = require('@/core/mask-store');
    const mask = maskStore.get(layer.layerMask);
    if (mask && mask.width === result.width && mask.height === result.height) {
      const ctx = result.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, result.width, result.height);
        for (let i = 0; i < mask.data.length; i++) {
          imgData.data[i * 4 + 3] = (imgData.data[i * 4 + 3] * mask.data[i]) / 255;
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }
  }

  return result;
}
```

**Note:** the `require('@/core/mask-store')` is a placeholder because `renderLayer` is synchronous. In TypeScript+ESM you can't `require()`. Convert to an eagerly-imported singleton: add `import { maskStore } from '@/core/mask-store';` at the top of the file.

- [ ] **Step 2: Update `executeComposite` to handle the case of parent layers being composited**

The current `executeComposite` iterates `visibleLayers` and calls `renderLayer(layer)`. With branched layers, we want children to render but NOT to also render their parents independently if the parent is invisible-by-itself but is referenced.

The simplest model: render every visible layer top-down as before. `renderLayer` already recurses to parents — the parent's adjustments are applied once per visible child. Acceptable for v1.

If the user wants to hide the parent and only see the branch, they toggle parent.visible off; `executeComposite` skips it in its top-level loop, but `renderLayer(child)` still recurses to it.

This means parent's pipeline can run twice in a frame (once for its own composite, once for each child). Performance is acceptable for thesis (≤10 layers typical).

No code change needed in `executeComposite` for this — just verify the logic.

- [ ] **Step 3: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

Open an image. Create a second layer manually via the layers panel (if possible) and set its `parentLayerId` via dev console. Confirm rendering works.

- [ ] **Step 4: Commit**

```bash
git add src/lib/layer-compositor.ts
git commit -m "feat(compositor): renderLayer honors parentLayerId + layerMask"
```

---

## Task 11 — `derived-graph.ts` shows branches

**Files:**
- Modify: `src/core/derived-graph.ts`

When a layer has `parentLayerId`, its node chain begins from the parent's output node instead of its own Source node. The graph editor renders branches.

- [ ] **Step 1: Update graph construction**

Read `src/core/derived-graph.ts` (~165 lines). Find `buildGraphFromLayers` (line ~24). Logic to add:

- Before the per-layer source-node creation, check if `layer.parentLayerId` exists.
- If yes, use the parent's last-chain-output node id as the "input" of this layer's first adjustment node (skip creating a Source node for the child).
- Add an edge from parent's output to child's first node, so React Flow draws it.

Concrete snippet (insert near the per-layer node-building loop):

```ts
const parentOutputByLayerId = new Map<string, string>();

// First pass: build all layers' chains as today, but record each layer's
// "chain tail" (output node id) into parentOutputByLayerId.

// (existing per-layer logic; record chainTip in parentOutputByLayerId after
// building each layer's adjustment chain.)

for (const layer of state.layers) {
  // ... existing per-adjustment loop builds `chainTip`
  parentOutputByLayerId.set(layer.id, chainTip);
}

// Second pass: for layers with parentLayerId, replace their Source-node
// in-edge with an edge from the parent's chainTip.
for (const layer of state.layers) {
  if (!layer.parentLayerId) continue;
  const sourceNodeId = `source:${layer.id}`;   // existing convention; verify against actual code
  const parentTip = parentOutputByLayerId.get(layer.parentLayerId);
  if (!parentTip) continue;
  // Remove any edge that targets sourceNodeId (incoming).
  graph.edges = graph.edges.filter((e) => e.target !== sourceNodeId);
  // Add an edge from parent's tip to this layer's first chain node.
  // The first chain node is the one whose `source` field is sourceNodeId.
  const firstAdjEdge = graph.edges.find((e) => e.source === sourceNodeId);
  if (firstAdjEdge) {
    firstAdjEdge.source = parentTip;
  }
}
```

- [ ] **Step 2: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

Manually create a branched layer (via dev console: `useEditorStore.getState().addLayer({ id:'B', type:'image', name:'branch', visible:true, opacity:1, blendMode:'normal', locked:false, parentLayerId:'<sourceId>' })`). Enter graph mode. Confirm an edge connects the parent's output to the child's chain.

- [ ] **Step 3: Commit**

```bash
git add src/core/derived-graph.ts
git commit -m "feat(graph): render branches for layers with parentLayerId"
```

---

## Task 12 — `MaskOverlay` canvas component

**Files:**
- Create: `src/components/canvas/MaskOverlay.tsx`

Overlay canvas that renders the active or committed mask as a translucent fill plus marching-ants outline.

- [ ] **Step 1: Create the component**

```tsx
// src/components/canvas/MaskOverlay.tsx
import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

interface MaskOverlayProps {
  /** Optional fabric canvas viewport transform (zoom + pan) so overlay aligns with the image. */
  canvasWidth: number;
  canvasHeight: number;
}

export function MaskOverlay({ canvasWidth, canvasHeight }: MaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useEditorStore((s) => s.activeMaskRef);
  const committedRef = useEditorStore((s) => s.committedMaskRef);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const ref = activeRef ?? committedRef;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!ref) return;
    const mask = maskStore.get(ref);
    if (!mask) return;

    // Draw mask as a translucent magenta fill into an offscreen, then drawImage scaled.
    const off = document.createElement('canvas');
    off.width = mask.width;
    off.height = mask.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const a = mask.data[i];
      img.data[i * 4] = 255;      // R
      img.data[i * 4 + 1] = 64;   // G
      img.data[i * 4 + 2] = 200;  // B
      img.data[i * 4 + 3] = a * 0.4;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, c.width, c.height);

    // Marching-ants outline — simple approach: stroke a contour using imageData edge detection.
    // For v1, skip marching ants; just stroke a 1px outline using contour points.
    // (Future polish: animated dashed line.)
  }, [ref, pixelVersion]);

  if (!ref) return null;

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}
    />
  );
}
```

- [ ] **Step 2: Mount in `EditorCanvas.tsx`**

In the existing `EditorCanvas` render, alongside the fabric `<canvas>`:

```tsx
import { MaskOverlay } from './MaskOverlay';
// inside the returned JSX, wrap the canvas with a relative div:
<div ref={containerRef} className="relative w-full h-full">
  <canvas ref={canvasElRef} />
  <MaskOverlay
    canvasWidth={useEditorStore((s) => s.canvasWidth)}
    canvasHeight={useEditorStore((s) => s.canvasHeight)}
  />
</div>
```

(`canvasWidth` and `canvasHeight` are existing viewport-slice values.)

- [ ] **Step 3: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

In dev console: `useEditorStore.getState().setActiveMask(<some-maskRef>)`. Verify the overlay appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/MaskOverlay.tsx src/components/canvas/EditorCanvas.tsx
git commit -m "feat(canvas): MaskOverlay renders active/committed masks"
```

---

## Task 13 — `SelectPointTool`

**Files:**
- Create: `src/tools/select-point-tool.ts`
- Modify: `src/App.tsx` (register tool)

Click once → segment → commit on mouseup.

- [ ] **Step 1: Create the tool**

```ts
// src/tools/select-point-tool.ts
import { MousePointerClick } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';

export const SelectPointTool: ToolDefinition = {
  name: 'select-point',
  label: 'Select Point',
  icon: MousePointerClick,
  category: 'select',
  shortcut: 'P',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],

  onActivate: (ctx: ToolContext) => {
    const layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch(console.error);
  },

  onPointerDown: async (e: CanvasPointerEvent, ctx: ToolContext) => {
    const layerId = useEditorStore.getState().activeLayerId;
    if (!layerId) return;
    try {
      const maskRef = await samClient.segment({
        layerId,
        prompts: [{ kind: 'point', data: [e.imageX, e.imageY, 1] }],
      });
      useEditorStore.getState().setActiveMask(maskRef);
    } catch (err) {
      console.error('[SelectPoint] segment failed:', err);
    }
  },

  onPointerUp: () => {
    useEditorStore.getState().commitMask();
  },
};
```

**Note:** `CanvasPointerEvent` needs to expose `imageX` / `imageY` — image-space coordinates after the canvas viewport transform. If the existing `CanvasPointerEvent` only has client coords, extend it:

```ts
// src/types/tool.ts
export interface CanvasPointerEvent {
  // ... existing fields
  imageX: number;
  imageY: number;
}
```

Then update wherever pointer events are dispatched (likely `EditorCanvas.tsx`'s pointer handlers) to compute `imageX/imageY` via `fabric.Canvas.getPointer(e)` and the active layer's image-to-canvas transform.

- [ ] **Step 2: Register tool in `App.tsx`**

Add to the tool registration block (around lines 67-79):

```ts
import { SelectPointTool } from '@/tools/select-point-tool';
// ...
ToolRegistry.register(SelectPointTool);
```

- [ ] **Step 3: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

Open an image. Switch to Select Point tool (P). Click. A mask should appear; releasing the mouse should commit.

- [ ] **Step 4: Commit**

```bash
git add src/tools/select-point-tool.ts src/App.tsx src/types/tool.ts src/components/canvas/EditorCanvas.tsx
git commit -m "feat(tools): SelectPointTool — click to segment + commit on mouseup"
```

---

## Task 14 — `SelectMultiPointTool`

**Files:**
- Create: `src/tools/select-multi-point-tool.ts`
- Modify: `src/App.tsx` (register tool)

Accumulates +/− points; Enter commits.

- [ ] **Step 1: Create the tool**

```ts
// src/tools/select-multi-point-tool.ts
import { MousePointer } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';
import type { SamPrompt } from '@/core/mask-store';

// Module-scoped state; cleared on activate/deactivate.
let prompts: SamPrompt[] = [];
let layerId: string | null = null;

async function rerunSegmentation() {
  if (!layerId) return;
  try {
    const maskRef = await samClient.segment({ layerId, prompts });
    useEditorStore.getState().setActiveMask(maskRef);
  } catch (err) {
    console.error('[SelectMultiPoint] segment failed:', err);
  }
}

export const SelectMultiPointTool: ToolDefinition = {
  name: 'select-multi-point',
  label: 'Select Multi-Point',
  icon: MousePointer,
  category: 'select',
  shortcut: 'M',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],

  onActivate: (ctx: ToolContext) => {
    prompts = [];
    layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch(console.error);
  },

  onDeactivate: () => {
    prompts = [];
    layerId = null;
  },

  onPointerDown: async (e: CanvasPointerEvent, _ctx: ToolContext) => {
    const isNegative = (e as unknown as { altKey?: boolean }).altKey === true;
    const label = isNegative ? 0 : 1;
    prompts.push({ kind: 'point', data: [e.imageX, e.imageY, label] });
    await rerunSegmentation();
  },

  commands: {
    commit: () => useEditorStore.getState().commitMask(),
  },
};
```

Also wire `Enter` to invoke the `commit` command. The existing `KeyboardShortcuts` component likely listens for tool commands — add a case for `Enter` when the active tool is `select-multi-point`.

- [ ] **Step 2: Register in `App.tsx`**

```ts
import { SelectMultiPointTool } from '@/tools/select-multi-point-tool';
ToolRegistry.register(SelectMultiPointTool);
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/select-multi-point-tool.ts src/App.tsx
git commit -m "feat(tools): SelectMultiPointTool — accumulating +/− with Enter to commit"
```

---

## Task 15 — `SelectBoxTool`

**Files:**
- Create: `src/tools/select-box-tool.ts`
- Modify: `src/App.tsx`

Drag a box, segment within bounds, commit on mouseup.

- [ ] **Step 1: Create the tool**

```ts
// src/tools/select-box-tool.ts
import { BoxSelect } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';

let startX = 0;
let startY = 0;
let dragging = false;

export const SelectBoxTool: ToolDefinition = {
  name: 'select-box',
  label: 'Select Box',
  icon: BoxSelect,
  category: 'select',
  shortcut: 'X',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],

  onActivate: (ctx: ToolContext) => {
    const layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch(console.error);
  },

  onPointerDown: (e: CanvasPointerEvent, _ctx: ToolContext) => {
    startX = e.imageX;
    startY = e.imageY;
    dragging = true;
  },

  onPointerMove: (_e: CanvasPointerEvent, _ctx: ToolContext) => {
    // Optional: render a live box overlay. Out of scope for v1.
  },

  onPointerUp: async (e: CanvasPointerEvent, _ctx: ToolContext) => {
    if (!dragging) return;
    dragging = false;
    const x1 = Math.min(startX, e.imageX);
    const y1 = Math.min(startY, e.imageY);
    const x2 = Math.max(startX, e.imageX);
    const y2 = Math.max(startY, e.imageY);
    if (x2 - x1 < 5 || y2 - y1 < 5) return;
    const layerId = useEditorStore.getState().activeLayerId;
    if (!layerId) return;
    try {
      const maskRef = await samClient.segment({
        layerId,
        prompts: [{ kind: 'box', data: [x1, y1, x2, y2] }],
      });
      useEditorStore.getState().setActiveMask(maskRef);
      useEditorStore.getState().commitMask();
    } catch (err) {
      console.error('[SelectBox] segment failed:', err);
    }
  },
};
```

- [ ] **Step 2: Register in `App.tsx`**

```ts
import { SelectBoxTool } from '@/tools/select-box-tool';
ToolRegistry.register(SelectBoxTool);
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/select-box-tool.ts src/App.tsx
git commit -m "feat(tools): SelectBoxTool — drag box prompt"
```

---

## Task 16 — `BrushMaskTool`

**Files:**
- Create: `src/tools/brush-mask-tool.tsx`
- Modify: `src/App.tsx`

Paints directly into the active or committed mask alpha (hard alpha for v1).

- [ ] **Step 1: Create the tool**

```tsx
// src/tools/brush-mask-tool.tsx
import { useState } from 'react';
import { Paintbrush } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

const brushConfig = { size: 30, mode: 'add' as 'add' | 'subtract' };

function paintAt(maskRef: string, x: number, y: number) {
  const mask = maskStore.get(maskRef);
  if (!mask) return;
  const data = new Uint8Array(mask.data);
  const r = brushConfig.size / 2;
  const value = brushConfig.mode === 'add' ? 255 : 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const ix = Math.round(x + dx);
      const iy = Math.round(y + dy);
      if (ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) continue;
      data[iy * mask.width + ix] = value;
    }
  }
  maskStore.updateData(maskRef, data);
  useEditorStore.getState().bumpPixelVersion();   // forces overlay re-render
}

function BrushMaskOptionsPanel() {
  const [size, setSize] = useState(brushConfig.size);
  const [mode, setMode] = useState(brushConfig.mode);
  // brushConfig is module-scoped; mutate in event handlers (existing project pattern).
  return (
    <div className="p-3 flex flex-col gap-3">
      <label className="flex items-center justify-between text-xs">
        Size
        <input type="range" min={2} max={200} value={size}
               onChange={(e) => { setSize(+e.target.value); brushConfig.size = +e.target.value; }} />
      </label>
      <label className="flex items-center justify-between text-xs">
        Mode
        <select value={mode}
                onChange={(e) => { const m = e.target.value as 'add'|'subtract'; setMode(m); brushConfig.mode = m; }}>
          <option value="add">Add</option>
          <option value="subtract">Subtract</option>
        </select>
      </label>
    </div>
  );
}

export const BrushMaskTool: ToolDefinition = {
  name: 'brush-mask',
  label: 'Mask Brush',
  icon: Paintbrush,
  category: 'select',
  shortcut: 'K',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],
  OptionsPanel: BrushMaskOptionsPanel,

  onPointerMove: (e: CanvasPointerEvent, _ctx: ToolContext) => {
    if (!(e as unknown as { buttons?: number }).buttons) return;
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return;
    paintAt(ref, e.imageX, e.imageY);
  },

  onPointerDown: (e: CanvasPointerEvent, _ctx: ToolContext) => {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return;
    paintAt(ref, e.imageX, e.imageY);
  },
};
```

- [ ] **Step 2: Register in `App.tsx`**

```ts
import { BrushMaskTool } from '@/tools/brush-mask-tool';
ToolRegistry.register(BrushMaskTool);
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/brush-mask-tool.tsx src/App.tsx
git commit -m "feat(tools): BrushMaskTool — hard-alpha paint into committed mask"
```

---

## Task 17 — `extractLayerFromMask` action

**Files:**
- Create: `src/store/segment-actions.ts`
- Create: `src/store/segment-actions.test.ts`

Single action that branches a layer.

- [ ] **Step 1: Write failing tests**

```ts
// src/store/segment-actions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from './segment-actions';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
    activeMaskRef: null,
    committedMaskRef: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  maskStore.clear();
});

describe('extractLayerFromMask', () => {
  it('creates a new layer with parentLayerId + layerMask set', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    const maskRef = maskStore.register({
      layerId: 'L1', width: 10, height: 10, data: new Uint8Array(100).fill(255),
      source: 'sam-point', createdAt: 0, label: 'subject',
    });
    const newId = extractLayerFromMask({ sourceLayerId: 'L1', maskRef });
    const layers = useEditorStore.getState().layers;
    const child = layers.find((l) => l.id === newId)!;
    expect(child.parentLayerId).toBe('L1');
    expect(child.layerMask).toBe(maskRef);
    expect(child.name).toContain('subject');
  });

  it('sets the new layer as active', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    const maskRef = maskStore.register({
      layerId: 'L1', width: 10, height: 10, data: new Uint8Array(100),
      source: 'sam-point', createdAt: 0,
    });
    const newId = extractLayerFromMask({ sourceLayerId: 'L1', maskRef });
    expect(useEditorStore.getState().activeLayerId).toBe(newId);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run src/store/segment-actions.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/store/segment-actions.ts
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import type { MaskRef } from '@/types/scope';

export function extractLayerFromMask(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
  name?: string;
}): string {
  const editor = useEditorStore.getState();
  const source = editor.layers.find((l) => l.id === args.sourceLayerId);
  if (!source) throw new Error(`extractLayerFromMask: layer ${args.sourceLayerId} not found`);
  const mask = maskStore.get(args.maskRef);
  if (!mask) throw new Error(`extractLayerFromMask: mask ${args.maskRef} not found`);
  const newId = crypto.randomUUID();
  const name = args.name ?? (mask.label ? `${source.name} · ${mask.label}` : `${source.name} · branch`);
  editor.addLayer({
    id: newId,
    type: 'image',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    parentLayerId: args.sourceLayerId,
    layerMask: args.maskRef,
  });
  editor.setActiveLayer(newId);
  return newId;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/store/segment-actions.test.ts
```
Expected: PASS, 2/2.

- [ ] **Step 5: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/segment-actions.ts src/store/segment-actions.test.ts
git commit -m "feat(seg): extractLayerFromMask action creates a branched layer"
```

---

## Task 18 — `SegmentActionsBar` component

**Files:**
- Create: `src/components/canvas/SegmentActionsBar.tsx`
- Modify: `src/components/canvas/EditorCanvas.tsx` (mount the bar)
- Modify: `src/store/ai-panel-actions.ts` (propagate mask scope onto adjustments)

Floating action bar after mask commit.

- [ ] **Step 1: Extend `addAiStepNode` to propagate mask scope**

Open `src/store/ai-panel-actions.ts`. Find `addAiStepNode` (added by the prior plan). After building each adjustment, before inserting:

```ts
// inside the for-loop that builds adjustments:
if (target.kind === 'mask') {
  adjustment.scope = { kind: 'mask', maskRef: target.maskRef };
}
```

(Type guard against the `TargetRef` extension from Task 2.)

- [ ] **Step 2: Create the action bar**

```tsx
// src/components/canvas/SegmentActionsBar.tsx
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { openPaletteWith } from '@/lib/palette-bus';
import { Layers, Wand2, Lock, X } from 'lucide-react';

export function SegmentActionsBar() {
  const ref = useEditorStore((s) => s.committedMaskRef);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const discard = useEditorStore((s) => s.discardCommittedMask);
  const setActiveScope = useEditorStore((s) => s.setActiveScope);

  if (!ref || !activeLayerId) return null;
  const mask = maskStore.get(ref);
  if (!mask) return null;
  const label = mask.label ?? 'Selection';

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 glass-panel px-3 py-2 text-xs">
      <span className="text-text-secondary">✨ {label}</span>
      <span className="opacity-30">|</span>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          extractLayerFromMask({ sourceLayerId: activeLayerId, maskRef: ref });
          discard();
        }}
      >
        <Layers className="w-3 h-3" /> Extract layer
      </button>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          openPaletteWith({ kind: 'mask', layerId: activeLayerId, maskRef: ref }, 'append');
        }}
      >
        <Wand2 className="w-3 h-3" /> Edit with AI
      </button>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          setActiveScope({ kind: 'mask', maskRef: ref });
          discard();
        }}
      >
        <Lock className="w-3 h-3" /> Scope adjustment
      </button>

      <span className="opacity-30">|</span>
      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1 opacity-70"
        onClick={discard}
        title="Discard (Esc)"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Mount in `EditorCanvas.tsx`**

In the existing render JSX:

```tsx
import { SegmentActionsBar } from './SegmentActionsBar';
// near the other overlays:
<SegmentActionsBar />
```

- [ ] **Step 4: Escape-to-discard**

Add a window-level keydown listener (or extend the existing one in `KeyboardShortcuts.tsx`):

```ts
if (e.key === 'Escape' && useEditorStore.getState().committedMaskRef) {
  useEditorStore.getState().discardCommittedMask();
}
```

- [ ] **Step 5: Run check + manual smoke test**

```bash
npm run check
npm run dev
```

Open image → SelectPointTool → click → commit. Bar appears. Click "Extract layer" → new branched layer appears in layers panel. Click "Edit with AI" → palette opens with mask label as chip.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/SegmentActionsBar.tsx \
        src/components/canvas/EditorCanvas.tsx \
        src/store/ai-panel-actions.ts \
        src/components/KeyboardShortcuts.tsx
git commit -m "feat(seg): SegmentActionsBar (extract/edit/scope/discard) + mask scope propagation"
```

---

## Task 19 — `activeScope` consumption: new adjustments get the scope

**Files:**
- Modify: `src/store/layer-slice.ts`

When the user adds a new adjustment via a toolbar tool and `activeScope` is set in `useSegmentationStore`, the new adjustment receives that scope. After the adjustment is added, `activeScope` is cleared.

- [ ] **Step 1: Extend `addAdjustment`**

In `src/store/layer-slice.ts`'s `addAdjustment`:

```ts
addAdjustment: (layerId, adjustment) =>
  set((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const scoped = state.activeScope
      ? { ...adjustment, scope: state.activeScope }
      : adjustment;
    layer.adjustmentStack.adjustments.push(scoped);
    state.activeScope = null;  // single-shot
  }),
```

Apply the same pattern to `insertAdjustment`.

- [ ] **Step 2: Append a test to `src/store/segmentation-slice.test.ts`**

```ts
describe('activeScope is consumed by addAdjustment', () => {
  it('attaches scope to the new adjustment then clears activeScope', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'X',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().setActiveScope({ kind: 'mask', maskRef: 'm1' });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1', type: 'kelvin', name: 'k', enabled: true,
      blendMode: 'normal', opacity: 1, params: {},
    });
    const adj = useEditorStore.getState().layers[0].adjustmentStack.adjustments[0];
    expect(adj.scope).toEqual({ kind: 'mask', maskRef: 'm1' });
    expect(useEditorStore.getState().activeScope).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/store/segmentation-slice.test.ts
```
Expected: PASS.

- [ ] **Step 4: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/layer-slice.ts src/store/segmentation-slice.test.ts
git commit -m "feat(seg): activeScope is consumed by addAdjustment (single-shot)"
```

---

## Task 20 — Smoke test the full Plan A flow

**Files:** none (manual verification).

- [ ] **Step 1: Run dev + script through the success criteria**

```bash
npm run dev
```

For each of these, open DevTools console to spot errors:

1. **SelectPoint commits a mask within ~1.2 s on first invocation.** Open image → press P → click. Watch `encoderState` go `loading-model → encoding → ready`.
2. **SegmentActionsBar appears after commit.** Verify all four buttons.
3. **Extract layer.** Click Extract. Layers panel shows a new layer with `parent: <source>`. Enter graph mode — the graph fans out at the source's output node.
4. **Edit with AI.** Click Edit. Cmd+K palette opens; chip reads "<source> · <mask label>". Type a goal, submit. New `ai-step` adjustments appear on the (branched) layer with `scope: { kind:'mask', maskRef }` (verify in dev console: `useEditorStore.getState().layers[0].adjustmentStack.adjustments`).
5. **Scope adjustment.** Click Scope. Now add a Curves adjustment from the toolbar — verify its `scope` matches the mask. After it's added, `activeScope` is cleared.
6. **SelectMultiPoint refinement.** Switch to M tool. Click positive then alt-click negative; mask shape updates each click.
7. **SelectBox.** Switch to X. Drag a box. Mask commits at mouseup.
8. **BrushMask.** Activate K with a committed mask present. Paint into it; overlay updates.

- [ ] **Step 2: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 3: Commit if anything else was tweaked during smoke test**

If everything works as-is, no commit needed — Plan A is complete.

If small fixes were needed (toast text, layout tweaks), commit as `chore(seg): plan-A smoke-test polish` with a short message.

---

## Self-review checklist

- [ ] **Spec coverage:**
  - Mask data model (MaskStore + Scope + Layer fields) → Tasks 1, 3, 4
  - SAM client (model loader + worker + facade) → Tasks 6, 7, 8
  - Four selection tools → Tasks 13, 14, 15, 16
  - Mask compositing → Task 9
  - Layer extraction + graph branching → Tasks 10, 11, 17
  - Segment Actions bar → Task 18
  - TargetRef mask + AI scope propagation → Tasks 2, 18 (step 1)
  - activeScope consumption → Task 19
  - Out of scope: Remove (Plan B), agent loop (Plan C) — explicitly noted

- [ ] **Placeholder scan:** No "TBD" / "implement later". Some tasks call out "depends on existing pipeline structure" — that's a real implementation detail, not a placeholder. Engineer is expected to read the existing file and integrate.

- [ ] **Type consistency:**
  - `MaskRef = string` defined once in `src/types/scope.ts`; re-exported from `operation-graph.ts`.
  - `Scope` shape used identically across Task 1 (definition), Task 9 (pipeline reading), Task 18 (assignment).
  - `TargetRef` mask variant has `{ kind: 'mask'; layerId; maskRef }` everywhere.
  - `Mask` interface: same fields in Task 3 (definition), Task 8 (registration), Task 17 (consumption).
  - `useSegmentationStore` methods: `setActiveMask`, `commitMask`, `discardCommittedMask`, `setEncoderState`, `setActiveScope` — same names everywhere.

- [ ] **Every code-bearing step has actual code.** Where the existing file's exact structure determines insertion, the plan gives the snippet + the pattern.

- [ ] **Every task ends in a commit.**

## Out of scope (deferred to Plan B & C)

- `/api/inpaint` + Replicate integration — Plan B
- "Remove" button in `SegmentActionsBar` — Plan B
- `/api/agent` SSE loop + 8-tool definitions — Plan C
- Cmd+K migration from `/api/panel` to `/api/agent` — Plan C
- `add_adjustment`, `extract_to_layer`, `remove_region`, `segment_at_point` exposed as Anthropic tools — Plan C
- Pressure-sensitive brush + soft alpha — future polish
- Marching-ants animated outline — future polish
- `.edp` persistence of masks + parentLayerId relationships — future (Plan B can address if needed, otherwise a fourth small plan)
- Mask thumbnail in inspector — future polish
- `mask:proposed` rendering as a hover overlay before SAM is invoked — Plan C territory (since the agent flow is what produces proposed masks)
