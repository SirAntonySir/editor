# AI Targeted Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cmd+K target a specific layer or graph node, ship a per-call snapshot to the AI, and land output as positioned adjustments in the target's chain. Adds `+` affordances on graph edges and node output ports.

**Architecture:** A single source-image ImageContext (cached, prompt-cache-marked) plus a per-call target snapshot sent ephemerally. Selection produces a `TargetRef`. The palette and the new graph `+` affordances open the existing `AiCommandPalette` with that `TargetRef` and an `InsertionIntent` seeded. AI output flows through a new `addAiStepNode` action that inserts adjustments at a precise position in a target layer's chain, tagged by `aiSource.graphId` for grouping. Legacy `ai-panel` layers keep working untouched.

**Tech Stack:** React 19 + TypeScript strict · Zustand v5 · vitest (Node env) · Fabric.js v7 · React Flow · custom WebGL pipeline.

**Spec:** `docs/superpowers/specs/2026-05-15-ai-targeted-workflow-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/types/ai-target.ts` | create | `TargetRef`, `InsertionIntent` types |
| `src/lib/target-ref.ts` | create | `resolveSmartTarget`, `humanLabelFor`, `renderTargetSnapshot` |
| `src/lib/target-ref.test.ts` | create | unit tests for pure logic above |
| `src/store/layer-slice.ts` | modify | add `insertAdjustment` mutation; extend `Layer` with `aiSteps` map |
| `src/store/ai-panel-actions.ts` | modify | add `addAiStepNode`, `refineAiStepNode` (keep legacy functions) |
| `src/store/ai-panel-actions.test.ts` | modify | tests for new actions |
| `src/lib/ai-client.ts` | modify | extend `generatePanel` signature |
| `src/hooks/useImageContext.ts` | modify | simplify fingerprint, remove `reanalyseFromComposite` |
| `src/components/AiCommandPalette.tsx` | modify | target chip header, dropdown, ⌘T cycling, seeded props |
| `src/App.tsx` | modify | rewire submit handler to new flow |
| `src/components/inspector/AiStepSection.tsx` | create | inspector UI for an ai-step group on a non-`ai-panel` layer |
| `src/components/inspector/InspectorPanel.tsx` *(or sibling)* | modify | render `AiStepSection` per group when present |
| `src/components/graph/nodes/AdjustmentNode.tsx` | modify | output-port `+` affordance |
| `src/components/graph/CustomEdge.tsx` | modify | edge `+` affordance |

Tests are colocated next to the file they test (existing pattern).

---

## Test conventions

- Test runner: `vitest`, node environment, no globals. Import `describe, it, expect, beforeEach` from `vitest`.
- File location: colocated, `<file>.test.ts` next to the file under test.
- Editor-store reset pattern (copied from `src/store/ai-panel-actions.test.ts:40-45`):
  ```ts
  beforeEach(() => {
    useEditorStore.setState({
      layers: [],
      activeLayerId: null,
    } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  });
  ```
- Single-run command: `npm run test:run` (CI-style, exits when done).
- Check command (lint + tsc + tests): `npm run check`. Must pass before every commit (pre-commit hook enforces this).

---

## Task 1 — `TargetRef` and `InsertionIntent` types

**Files:**
- Create: `src/types/ai-target.ts`

- [ ] **Step 1: Write the file**

```ts
// src/types/ai-target.ts
export type InsertionIntent = 'append' | 'splice' | 'branch';

export type TargetRef =
  | { kind: 'layer'; layerId: string }
  | { kind: 'node'; layerId: string; adjustmentId: string }
  | { kind: 'composite' };

export function targetRefEquals(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'composite') return true;
  if (a.kind === 'layer' && b.kind === 'layer') return a.layerId === b.layerId;
  if (a.kind === 'node' && b.kind === 'node') {
    return a.layerId === b.layerId && a.adjustmentId === b.adjustmentId;
  }
  return false;
}
```

Note on naming: a "graph node" in this app is rendered from an adjustment in a layer's chain (see `src/core/derived-graph.ts`). The stable id is the adjustment id, so the `node` variant carries `adjustmentId`, not a nominal `nodeId`.

- [ ] **Step 2: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```
Expected: PASS (types-only file).

- [ ] **Step 3: Commit**

```bash
git add src/types/ai-target.ts
git commit -m "feat(ai): add TargetRef and InsertionIntent types"
```

---

## Task 2 — `resolveSmartTarget` and `humanLabelFor`

**Files:**
- Create: `src/lib/target-ref.ts`
- Create: `src/lib/target-ref.test.ts`

The smart-default resolution order per spec: selected graph node → active layer → composite.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/target-ref.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSmartTarget, humanLabelFor } from './target-ref';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  useGraphStore.setState({
    selectedNodeId: null,
  } as unknown as Parameters<typeof useGraphStore.setState>[0]);
});

describe('resolveSmartTarget', () => {
  it('returns composite when no selection and no layers', () => {
    expect(resolveSmartTarget()).toEqual({ kind: 'composite' });
  });

  it('returns the active layer when nothing is selected in the graph', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.setState({ activeLayerId: 'L1' } as never);

    expect(resolveSmartTarget()).toEqual({ kind: 'layer', layerId: 'L1' });
  });

  it('returns the node when a graph node is selected', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1',
      type: 'kelvin',
      name: 'White balance',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: { temperature: 5500 },
    });
    useGraphStore.setState({ selectedNodeId: 'A1' } as never);

    expect(resolveSmartTarget()).toEqual({
      kind: 'node',
      layerId: 'L1',
      adjustmentId: 'A1',
    });
  });

  it('falls back to composite when selectedNodeId does not match any adjustment', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useGraphStore.setState({ selectedNodeId: 'ghost' } as never);

    expect(resolveSmartTarget()).toEqual({ kind: 'layer', layerId: 'L1' });
  });
});

describe('humanLabelFor', () => {
  it('labels composite', () => {
    expect(humanLabelFor({ kind: 'composite' })).toBe('Whole composite');
  });

  it('labels a layer by its name', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(humanLabelFor({ kind: 'layer', layerId: 'L1' })).toBe('Portrait');
  });

  it('labels a node by adjustment name on its layer', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1',
      type: 'kelvin',
      name: 'White balance',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    });
    expect(humanLabelFor({ kind: 'node', layerId: 'L1', adjustmentId: 'A1' })).toBe(
      'Portrait · White balance',
    );
  });

  it('falls back to "Unknown target" when references go stale', () => {
    expect(humanLabelFor({ kind: 'layer', layerId: 'gone' })).toBe('Unknown target');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/target-ref.test.ts
```
Expected: FAIL with "Cannot find module './target-ref'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/target-ref.ts
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import type { TargetRef } from '@/types/ai-target';

export function resolveSmartTarget(): TargetRef {
  const editor = useEditorStore.getState();
  const graph = useGraphStore.getState();

  const selectedId = graph.selectedNodeId;
  if (selectedId) {
    for (const layer of editor.layers) {
      const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === selectedId);
      if (adj) {
        return { kind: 'node', layerId: layer.id, adjustmentId: adj.id };
      }
    }
  }

  if (editor.activeLayerId) {
    return { kind: 'layer', layerId: editor.activeLayerId };
  }

  const firstImage = editor.layers.find((l) => l.type === 'image');
  if (firstImage) return { kind: 'layer', layerId: firstImage.id };

  return { kind: 'composite' };
}

export function humanLabelFor(ref: TargetRef): string {
  if (ref.kind === 'composite') return 'Whole composite';

  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === ref.layerId);
  if (!layer) return 'Unknown target';
  if (ref.kind === 'layer') return layer.name;

  const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === ref.adjustmentId);
  if (!adj) return 'Unknown target';
  return `${layer.name} · ${adj.name}`;
}
```

Notes for the implementer:
- `useGraphStore` lives at `src/store/graph-store.ts`. If the field is named differently than `selectedNodeId`, use what's there. From exploration: the current palette reads `highlightedNodeId` from the graph store. Check `graph-store.ts` and use the field that means "currently selected node in the graph"; if there are two (`selectedNodeId` vs `highlightedNodeId`) prefer the explicit selection, falling back to highlight.
- If `useEditorStore.getState().addAdjustment` requires the layer to exist (it should), the test's `addLayer + addAdjustment` order is fine.

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/target-ref.test.ts
```
Expected: PASS, 8/8.

- [ ] **Step 5: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/target-ref.ts src/lib/target-ref.test.ts
git commit -m "feat(ai): resolveSmartTarget and humanLabelFor"
```

---

## Task 3 — `insertAdjustment` mutation + `aiSteps` map on Layer

**Files:**
- Modify: `src/store/layer-slice.ts`
- Modify: `src/store/layer-slice.test.ts` (or create if absent)

Two changes to the layer slice:
1. New method `insertAdjustment(layerId, adjustment, atIndex)` that inserts at a given position rather than appending.
2. New optional field on `Layer`: `aiSteps?: Record<string, AiStepMeta>` keyed by `OperationGraph.id`. Stores per-step provenance + bindings for non-`ai-panel` layers.

- [ ] **Step 1: Write the failing tests**

If `src/store/layer-slice.test.ts` does not exist, create it:

```ts
// src/store/layer-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

function seedLayerWithAdjustments() {
  useEditorStore.getState().addLayer({
    id: 'L1',
    type: 'image',
    name: 'Portrait',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });
  for (const id of ['A', 'B', 'C']) {
    useEditorStore.getState().addAdjustment('L1', {
      id,
      type: 'kelvin',
      name: id,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    });
  }
}

describe('insertAdjustment', () => {
  it('inserts at the requested index, shifting subsequent adjustments', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'X',
      type: 'kelvin',
      name: 'X',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 1);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['A', 'X', 'B', 'C']);
  });

  it('appends when atIndex is past the end', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'Y',
      type: 'kelvin',
      name: 'Y',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 99);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['A', 'B', 'C', 'Y']);
  });

  it('prepends when atIndex is 0', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'Z',
      type: 'kelvin',
      name: 'Z',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 0);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['Z', 'A', 'B', 'C']);
  });
});

describe('aiSteps map', () => {
  it('is undefined by default on new layers', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'X',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(useEditorStore.getState().layers[0].aiSteps).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/store/layer-slice.test.ts
```
Expected: FAIL — "insertAdjustment is not a function" or similar.

- [ ] **Step 3: Open `src/store/layer-slice.ts` and add the new `AiStepMeta` type**

Place it next to the existing `AiSource` type (around line 12-20 per exploration):

```ts
import type { OperationGraph, PanelBinding } from '@/types/operation-graph';
import type { TargetRef } from '@/types/ai-target';

export interface AiStepMeta {
  graphId: string;
  operationGraph: OperationGraph;
  panelBindings: PanelBinding[];
  originTargetRef: TargetRef;
}
```

- [ ] **Step 4: Extend the `Layer` interface**

Find the `Layer` interface (around lines 63-79) and add an `aiSteps` field after the existing `operationGraph?` / `panelBindings?` fields:

```ts
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
  operationGraph?: OperationGraph;       // legacy: ai-panel layers
  panelBindings?: PanelBinding[];        // legacy: ai-panel layers
  aiSteps?: Record<string, AiStepMeta>;  // new: grouped AI-step provenance, keyed by graphId
}
```

- [ ] **Step 5: Add `insertAdjustment` action**

Find the slice's `addAdjustment` implementation (around line 194). Add `insertAdjustment` immediately after it:

```ts
insertAdjustment: (layerId, adjustment, atIndex) =>
  set((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const arr = layer.adjustmentStack.adjustments;
    const clamped = Math.max(0, Math.min(atIndex, arr.length));
    arr.splice(clamped, 0, adjustment);
  }),
```

Add the method signature to the slice's exported store-state interface (look for where `addAdjustment` is typed; mirror it):

```ts
insertAdjustment: (layerId: string, adjustment: Adjustment, atIndex: number) => void;
```

- [ ] **Step 6: Run tests, verify they pass**

```bash
npx vitest run src/store/layer-slice.test.ts
```
Expected: PASS, 4/4.

- [ ] **Step 7: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/store/layer-slice.ts src/store/layer-slice.test.ts
git commit -m "feat(layers): insertAdjustment(atIndex) and Layer.aiSteps map"
```

---

## Task 4 — `addAiStepNode` and `refineAiStepNode` actions

**Files:**
- Modify: `src/store/ai-panel-actions.ts`
- Modify: `src/store/ai-panel-actions.test.ts`

Both new actions take a `TargetRef` and an `OperationGraph`, and insert the OperationGraph's nodes as adjustments at the right position in the target's layer. Each adjustment gets the same `aiSource.graphId`, so the inspector can group them.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/ai-panel-actions.test.ts`:

```ts
import {
  addAiStepNode,
  refineAiStepNode,
} from './ai-panel-actions';
import type { TargetRef } from '@/types/ai-target';

function seedHostLayer() {
  useEditorStore.getState().addLayer({
    id: 'L1',
    type: 'image',
    name: 'Portrait',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });
  for (const id of ['existing-1', 'existing-2']) {
    useEditorStore.getState().addAdjustment('L1', {
      id,
      type: 'kelvin',
      name: id,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    });
  }
}

describe('addAiStepNode', () => {
  it('appends an ai-step to a layer target (end of chain)', () => {
    seedHostLayer();
    const target: TargetRef = { kind: 'layer', layerId: 'L1' };
    addAiStepNode(target, makeGraph({ id: 'g-1' }));

    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    expect(ids[0]).toBe('existing-1');
    expect(ids[1]).toBe('existing-2');
    // step adjustments come last; one per OperationGraph node
    expect(ids.length).toBe(3);
    const last = useEditorStore.getState().layers[0].adjustmentStack.adjustments.at(-1)!;
    expect(last.aiSource?.graphId).toBe('g-1');
  });

  it('inserts immediately after a node target', () => {
    seedHostLayer();
    const target: TargetRef = {
      kind: 'node',
      layerId: 'L1',
      adjustmentId: 'existing-1',
    };
    addAiStepNode(target, makeGraph({ id: 'g-1' }));

    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    // expected order: existing-1, <ai>, existing-2
    expect(ids[0]).toBe('existing-1');
    expect(ids[2]).toBe('existing-2');
    expect(ids.length).toBe(3);
  });

  it('records aiSteps metadata on the host layer keyed by graphId', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'layer', layerId: 'L1' }, makeGraph({ id: 'g-1' }));
    const layer = useEditorStore.getState().layers[0];
    expect(layer.aiSteps?.['g-1']).toBeDefined();
    expect(layer.aiSteps?.['g-1'].panelBindings[0].nodeId).toBe('n1');
    expect(layer.aiSteps?.['g-1'].originTargetRef).toEqual({ kind: 'layer', layerId: 'L1' });
  });

  it('appends to the topmost layer when target is composite', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'composite' }, makeGraph({ id: 'g-1' }));
    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    expect(ids.length).toBe(3);
    expect(ids.at(-1)!.startsWith('ai-step-')).toBe(true);
  });
});

describe('refineAiStepNode', () => {
  it('appends the refined step downstream of the prior step', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'layer', layerId: 'L1' }, makeGraph({ id: 'g-1' }));
    refineAiStepNode('L1', 'g-1', makeGraph({ id: 'g-2', userGoal: 'subtler' }));

    const adjustments = useEditorStore.getState().layers[0].adjustmentStack.adjustments;
    const g1Idx = adjustments.findIndex((a) => a.aiSource?.graphId === 'g-1');
    const g2Idx = adjustments.findIndex((a) => a.aiSource?.graphId === 'g-2');
    expect(g2Idx).toBeGreaterThan(g1Idx);
    expect(useEditorStore.getState().layers[0].aiSteps?.['g-2']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/store/ai-panel-actions.test.ts
```
Expected: FAIL — "addAiStepNode is not exported" and "refineAiStepNode is not exported".

- [ ] **Step 3: Implement `addAiStepNode`**

Append to `src/store/ai-panel-actions.ts` (keep existing `addAiPanelLayer` untouched):

```ts
import type { TargetRef } from '@/types/ai-target';
import type { AiStepMeta } from './layer-slice';

let aiStepCounter = 0;

function pickHostLayerId(target: TargetRef): string | null {
  const editor = useEditorStore.getState();
  if (target.kind === 'layer' || target.kind === 'node') {
    return editor.layers.find((l) => l.id === target.layerId)?.id ?? null;
  }
  // composite → topmost layer
  return editor.layers.at(-1)?.id ?? null;
}

function insertionIndexFor(target: TargetRef, hostLayerId: string): number {
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === hostLayerId);
  if (!layer) return 0;
  if (target.kind === 'node') {
    const idx = layer.adjustmentStack.adjustments.findIndex((a) => a.id === target.adjustmentId);
    return idx >= 0 ? idx + 1 : layer.adjustmentStack.adjustments.length;
  }
  // layer or composite → append
  return layer.adjustmentStack.adjustments.length;
}

export function addAiStepNode(target: TargetRef, graph: OperationGraph): void {
  console.log('[OperationGraph] addAiStepNode', target, graph);
  const hostLayerId = pickHostLayerId(target);
  if (!hostLayerId) {
    throw new Error('addAiStepNode: no host layer found for target');
  }

  // Record per-step metadata on the host layer.
  const stepMeta: AiStepMeta = {
    graphId: graph.id,
    operationGraph: graph,
    panelBindings: graph.panelBindings,
    originTargetRef: target,
  };
  useEditorStore.setState((state) => {
    const layer = state.layers.find((l) => l.id === hostLayerId);
    if (!layer) return state;
    layer.aiSteps = { ...(layer.aiSteps ?? {}), [graph.id]: stepMeta };
    return state;
  });

  // Insert one adjustment per OperationGraph node at the target index.
  let cursor = insertionIndexFor(target, hostLayerId);
  for (const node of graph.nodes) {
    const firstBinding = graph.panelBindings.find((b) => b.nodeId === node.id);
    const label = firstBinding?.label ?? node.type;
    const adjustmentId = `ai-step-${graph.id}-${node.id}-${++aiStepCounter}`;
    const adjustment: Adjustment = {
      id: adjustmentId,
      type: node.type,
      name: label,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: toNumericParams(node.params),
      aiSource: {
        graphId: graph.id,
        nodeId: node.id,
        label,
        reasoning: firstBinding?.reasoning ?? graph.reasoning,
        modelName: graph.metadata.model_name ?? '',
        modelVersion: graph.metadata.model_version ?? '',
        generatedAt: graph.metadata.generated_at ?? new Date().toISOString(),
      },
    };
    useEditorStore.getState().insertAdjustment(hostLayerId, adjustment, cursor);
    cursor += 1;
  }
}

export function refineAiStepNode(
  hostLayerId: string,
  priorGraphId: string,
  graph: OperationGraph,
): void {
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === hostLayerId);
  if (!layer) {
    throw new Error(`refineAiStepNode: unknown hostLayerId "${hostLayerId}"`);
  }
  // Find the LAST adjustment in the prior step, then insert immediately after it.
  const adjustments = layer.adjustmentStack.adjustments;
  let lastIdx = -1;
  for (let i = adjustments.length - 1; i >= 0; i--) {
    if (adjustments[i].aiSource?.graphId === priorGraphId) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) {
    throw new Error(`refineAiStepNode: priorGraphId "${priorGraphId}" not found on layer`);
  }

  const anchorAdjustment = adjustments[lastIdx];
  addAiStepNode(
    { kind: 'node', layerId: hostLayerId, adjustmentId: anchorAdjustment.id },
    graph,
  );
}
```

Notes:
- `toNumericParams` already exists in this file (used by `addAiPanelLayer`). Reuse it.
- `Adjustment` is imported from `./layer-slice`. The current file already imports it.
- `OperationGraph` is imported from `@/types/operation-graph`. Already present.

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/store/ai-panel-actions.test.ts
```
Expected: PASS (existing tests + 5 new tests).

- [ ] **Step 5: Run full check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/ai-panel-actions.ts src/store/ai-panel-actions.test.ts
git commit -m "feat(ai): addAiStepNode and refineAiStepNode actions"
```

---

## Task 5 — Simplify `useImageContext` fingerprint

**Files:**
- Modify: `src/hooks/useImageContext.ts`

Per spec: fingerprint reflects *source-image pixels only*, not the whole layer stack. Remove `reanalyseFromComposite` and its call site.

- [ ] **Step 1: Replace `currentImageFingerprint`**

Replace the function at lines 30-51 with:

```ts
import { pixelStore } from '@/lib/canvas-registry';

/**
 * Hash of the source-image pixels for the document.
 * Used to decide when to re-analyse the base image (e.g. user replaced the source).
 * Adjustments, new layers, ai-step output do NOT invalidate this.
 */
export function currentImageFingerprint(): string {
  const editor = useEditorStore.getState();
  const firstImage = editor.layers.find((l) => l.type === 'image');
  if (!firstImage) return 'empty';
  const source = pixelStore.getSource(firstImage.id);
  if (!source) return `nopixels:${firstImage.id}`;
  // Use width × height × an arbitrary corner pixel as a cheap content hash.
  // The expensive option (full pixel digest) is unnecessary — we only need to
  // catch source replacement, not adjustment drift.
  const ctx = source instanceof HTMLCanvasElement
    ? source.getContext('2d')
    : (source as OffscreenCanvas).getContext('2d');
  if (!ctx) return `${firstImage.id}:${source.width}x${source.height}`;
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return `${firstImage.id}:${source.width}x${source.height}:${px[0]},${px[1]},${px[2]},${px[3]}`;
}
```

- [ ] **Step 2: Delete `reanalyseFromComposite`**

Remove the entire function (lines 160-175 in current file).

- [ ] **Step 3: Find and remove the caller**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rn "reanalyseFromComposite" src/
```
Expected: matches in `src/App.tsx`. Open `App.tsx`, find the import and the call site (around line 235 — the `if (stale) { ... reanalyseFromComposite() ... }` branch in `handlePaletteSubmit`), and remove both the import and the entire `if (stale)` block. The Cmd+K submit handler will be rewritten in Task 8 anyway, but for now leave it so the file compiles:

```ts
// in App.tsx handlePaletteSubmit, after the import cleanup, the staleness
// branch becomes a no-op: just trust the cached context, never re-analyse here.
const handlePaletteSubmit = useCallback(
  async (text: string) => {
    const session = useAiSession.getState();
    let sid = session.sessionId;
    if (!sid && session.context) {
      await bindSessionFromFirstImageLayer();
      sid = useAiSession.getState().sessionId;
    }
    if (!sid) return;
    try {
      const graph = await generatePanel(sid, text);
      addAiPanelLayer(graph);
    } catch (err) {
      console.error(err);
    }
  },
  [],
);
```

(This is interim — Task 8 rewrites the whole handler.)

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```
1. Open an image.
2. Apply a Curves adjustment.
3. Open Cmd+K and submit a goal.
4. Confirm the request goes through without re-analysis (no `[ImageContext] reanalyseFromComposite` log).
5. Replace the source image (drag a new file in). Confirm the AI session re-binds with the new source.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useImageContext.ts src/App.tsx
git commit -m "refactor(ai): fingerprint reflects source pixels only; drop reanalyse-on-Cmd+K"
```

---

## Task 6 — Extend `generatePanel` client signature

**Files:**
- Modify: `src/lib/ai-client.ts`

Per spec the payload gains `target_snapshot` (base64 PNG/JPEG), `target_ref`, and `insertion_intent`. The response shape is unchanged.

**Coordination note:** The backend in the `journalist` project must accept these new fields. Until that lands, the new fields are passed but the backend ignores them; existing behaviour is preserved.

- [ ] **Step 1: Change the function signature**

Replace the existing `generatePanel` (lines 63-66):

```ts
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

export interface GeneratePanelOptions {
  targetSnapshotPng: Blob;      // PNG/JPEG blob of the target's current pixel state
  targetRef: TargetRef;
  insertionIntent: InsertionIntent;
}

export async function generatePanel(
  sessionId: string,
  userGoal: string,
  opts: GeneratePanelOptions,
): Promise<OperationGraph> {
  const snapshotBase64 = await blobToBase64(opts.targetSnapshotPng);
  const raw = await postJson<unknown>('/api/panel', {
    session_id: sessionId,
    user_goal: userGoal,
    target_snapshot_base64: snapshotBase64,
    target_ref: opts.targetRef,
    insertion_intent: opts.insertionIntent,
  });
  return OperationGraphSchema.parse(raw);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
```

- [ ] **Step 2: Update App.tsx caller**

In `src/App.tsx`, the `handlePaletteSubmit` currently calls `generatePanel(sid, text)`. It will compile-fail. Either temporarily pass a stub or move on to Task 8 immediately. Stub approach:

```ts
// TEMP: full new flow lands in Task 8
const fakeSnapshot = new Blob([new Uint8Array([0])], { type: 'image/png' });
const graph = await generatePanel(sid, text, {
  targetSnapshotPng: fakeSnapshot,
  targetRef: { kind: 'composite' },
  insertionIntent: 'append',
});
```

- [ ] **Step 3: Run check**

```bash
npm run check
```
Expected: PASS (compiles; runtime impact deferred to Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai-client.ts src/App.tsx
git commit -m "feat(ai): extend generatePanel with targetSnapshot, targetRef, insertionIntent"
```

---

## Task 7 — `renderTargetSnapshot`

**Files:**
- Modify: `src/lib/target-ref.ts`

Generates a downscaled PNG blob of the target's current pixel state.

- [ ] **Step 1: Append to `src/lib/target-ref.ts`**

```ts
import { LayerCompositor } from './layer-compositor';
import { PipelineManager } from './pipeline-manager';
import { pixelStore } from './canvas-registry';

const SNAPSHOT_MAX_EDGE = 768;

async function canvasToDownscaledPng(
  source: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob> {
  const w = source.width;
  const h = source.height;
  if (w === 0 || h === 0) throw new Error('renderTargetSnapshot: empty source');

  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  const tmp = document.createElement('canvas');
  tmp.width = targetW;
  tmp.height = targetH;
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('renderTargetSnapshot: 2d context unavailable');
  ctx.drawImage(source, 0, 0, targetW, targetH);

  return await new Promise<Blob>((resolve, reject) => {
    tmp.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
}

/**
 * Returns a downscaled PNG blob of the target's current pixel state.
 * Sent ephemerally to the backend; never cached.
 *
 * Initial implementation:
 *   - composite → full document composite
 *   - layer    → that layer's pipeline output (per-layer post-adjustment pixels)
 *   - node     → the host layer's current output (TODO: precise mid-chain rendering)
 *
 * The 'node' case falls back to layer rendering until partial-pipeline rendering
 * is implemented (tracked in the spec's future-work list).
 */
export async function renderTargetSnapshot(target: TargetRef): Promise<Blob> {
  if (target.kind === 'composite') {
    const composite = LayerCompositor.compositeSync();
    return canvasToDownscaledPng(composite);
  }

  // layer or node — both render the host layer's current output.
  const out = PipelineManager.getOutputFor?.(target.layerId);
  if (out) return canvasToDownscaledPng(out);

  // Fallback: raw source pixels for that layer.
  const src = pixelStore.getSource(target.layerId);
  if (src) return canvasToDownscaledPng(src);

  throw new Error(`renderTargetSnapshot: no pixels for target ${JSON.stringify(target)}`);
}
```

**Implementer notes:**
- `PipelineManager.getOutputFor` may not exist; check `src/lib/pipeline-manager.ts`. If only a global `getOutput()` is available, use it when `target.kind === 'composite'` is not but `layerId === activeLayerId`. Otherwise fall back to `pixelStore.getSource`. The exact method name should be discovered when you open the file — adapt the call accordingly, but keep the API surface (`renderTargetSnapshot(target)`) the same.
- Optional chaining (`?.`) guards the call. If absent, the fallback path runs.

- [ ] **Step 2: Run check**

```bash
npm run check
```
Expected: PASS.

No unit test for this — it talks to WebGL/canvas. Verified end-to-end in Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/lib/target-ref.ts
git commit -m "feat(ai): renderTargetSnapshot for per-call target image"
```

---

## Task 8 — Rewrite `App.tsx` submit handler

**Files:**
- Modify: `src/App.tsx`

Full end-to-end flow using the new pieces.

- [ ] **Step 1: Imports**

Ensure these imports exist at the top of `App.tsx`:

```ts
import { resolveSmartTarget, renderTargetSnapshot } from '@/lib/target-ref';
import { addAiStepNode } from '@/store/ai-panel-actions';
import type { TargetRef, InsertionIntent } from '@/types/ai-target';
```

Remove any leftover `reanalyseFromComposite` import and the `currentImageFingerprint` import if it's only used for the stale check (we keep the function in `useImageContext.ts` but no longer reference it here).

- [ ] **Step 2: State for seeded target/intent**

Add palette-related state next to `paletteOpen`:

```ts
const [paletteOpen, setPaletteOpen] = useState(false);
const [paletteSeed, setPaletteSeed] = useState<{
  target: TargetRef;
  intent: InsertionIntent;
} | null>(null);
```

Export a function siblings can call to open the palette with a seed (used by Task 10 + 11):

```ts
// near the bottom of the component body, before return:
const openPaletteWith = useCallback(
  (target: TargetRef, intent: InsertionIntent = 'append') => {
    setPaletteSeed({ target, intent });
    setPaletteOpen(true);
  },
  [],
);
```

For cross-component access, expose via a small module-scoped emitter:

```ts
// src/lib/palette-bus.ts  (new file)
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

type Handler = (target: TargetRef, intent: InsertionIntent) => void;
let handler: Handler | null = null;
export function setPaletteOpenHandler(h: Handler | null) { handler = h; }
export function openPaletteWith(target: TargetRef, intent: InsertionIntent = 'append') {
  handler?.(target, intent);
}
```

Then in `App.tsx` register on mount:

```ts
useEffect(() => {
  setPaletteOpenHandler((t, i) => {
    setPaletteSeed({ target: t, intent: i });
    setPaletteOpen(true);
  });
  return () => setPaletteOpenHandler(null);
}, []);
```

- [ ] **Step 3: Replace the submit handler**

```ts
const handlePaletteSubmit = useCallback(
  async (text: string) => {
    const session = useAiSession.getState();
    let sid = session.sessionId;
    if (!sid && session.context) {
      await bindSessionFromFirstImageLayer();
      sid = useAiSession.getState().sessionId;
    }
    if (!sid) return;

    const target: TargetRef = paletteSeed?.target ?? resolveSmartTarget();
    const intent: InsertionIntent = paletteSeed?.intent ?? 'append';

    try {
      const snapshot = await renderTargetSnapshot(target);
      const graph = await generatePanel(sid, text, {
        targetSnapshotPng: snapshot,
        targetRef: target,
        insertionIntent: intent,
      });
      addAiStepNode(target, graph);
    } catch (err) {
      console.error('[Cmd+K] generate failed:', err);
    }
  },
  [paletteSeed],
);
```

- [ ] **Step 4: Clear seed when palette closes**

In the existing palette close handler:

```ts
onClose={() => {
  setPaletteOpen(false);
  setPaletteSeed(null);
}}
```

- [ ] **Step 5: Run check + manual smoke test**

```bash
npm run check
npm run dev
```
1. Open an image.
2. Press Cmd+K, submit a goal.
3. Expect: AI step adjustments appear in the layer's chain (not as a new ai-panel layer).
4. With a graph node selected, press Cmd+K → adjustments appear *after* that node.

The graph affordances aren't there yet — that's Tasks 10/11. The palette UI still lacks the chip — that's Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/lib/palette-bus.ts
git commit -m "feat(ai): Cmd+K resolves TargetRef, ships snapshot, lands as ai-step adjustments"
```

---

## Task 9 — Target chip in `AiCommandPalette`

**Files:**
- Modify: `src/components/AiCommandPalette.tsx`

Per spec, the palette displays the current `TargetRef` as a chip in its header. Clicking opens a dropdown of eligible targets. `⌘T` cycles forward.

- [ ] **Step 1: Add props for seeded target**

Extend the props interface:

```ts
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

interface AiCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
  initialTarget?: TargetRef;
  initialIntent?: InsertionIntent;
}
```

- [ ] **Step 2: Replace `pickPreviewSource` with TargetRef state**

Remove the existing `pickPreviewSource` function. Replace its callers with reads from a new `target` state:

```ts
import { resolveSmartTarget, humanLabelFor, renderTargetSnapshot } from '@/lib/target-ref';

const [target, setTarget] = useState<TargetRef>(() =>
  initialTarget ?? resolveSmartTarget(),
);
const [targetIntent] = useState<InsertionIntent>(initialIntent ?? 'append');
```

Re-resolve when the palette opens (in case selection changed since last open):

```ts
useEffect(() => {
  if (open && !initialTarget) {
    setTarget(resolveSmartTarget());
  }
}, [open, initialTarget]);
```

- [ ] **Step 3: Render the chip in the header**

Place this above the existing prompt input. Use the existing Tailwind tokens and the project's `GlassPanel` / chip styles (look at other chips like the region pills as reference):

```tsx
<div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 text-[11px]">
  <button
    type="button"
    className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 hover:bg-accent/25 px-2.5 py-1 text-xs"
    onClick={() => setTargetPickerOpen((v) => !v)}
    title="Change AI target (⌘T)"
  >
    <span aria-hidden>🎯</span>
    <span>{humanLabelFor(target)}</span>
    <ChevronDown className="h-3 w-3 opacity-60" />
  </button>
  <span className="text-text-secondary text-[10px]">
    {initialIntent === 'splice' ? 'splice' : 'append'}
  </span>
</div>
```

- [ ] **Step 4: Target picker dropdown**

Build the list of eligible targets. For the v1, three categories: layers (excluding `ai-panel` layers), the adjustment nodes under each layer, and `Whole composite`.

```tsx
function buildTargetOptions(): { ref: TargetRef; label: string }[] {
  const layers = useEditorStore.getState().layers.filter((l) => l.type !== 'ai-panel');
  const out: { ref: TargetRef; label: string }[] = [];
  for (const layer of layers) {
    out.push({ ref: { kind: 'layer', layerId: layer.id }, label: layer.name });
    for (const adj of layer.adjustmentStack?.adjustments ?? []) {
      out.push({
        ref: { kind: 'node', layerId: layer.id, adjustmentId: adj.id },
        label: `${layer.name} · ${adj.name}`,
      });
    }
  }
  out.push({ ref: { kind: 'composite' }, label: 'Whole composite' });
  return out;
}

// render when targetPickerOpen is true; close on outside-click and on Esc.
```

Wrap it in the same `GlassPanel` aesthetic used elsewhere. Keyboard nav: up/down arrows + Enter to pick.

- [ ] **Step 5: ⌘T cycling**

```tsx
useEffect(() => {
  if (!open) return;
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const opts = buildTargetOptions();
      const idx = opts.findIndex((o) => targetRefEquals(o.ref, target));
      const next = opts[(idx + 1) % opts.length];
      setTarget(next.ref);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [open, target]);
```

`targetRefEquals` is exported from `@/types/ai-target` (defined in Task 1).

- [ ] **Step 6: Replace `pickPreviewSource()` calls in the preview area**

The preview canvas should reflect the current `target`. Use `renderTargetSnapshot(target)` to produce a blob, or — for cheaper live preview without re-encoding — call the same `LayerCompositor` / `PipelineManager` paths that `renderTargetSnapshot` uses internally and draw to the preview canvas directly.

Simplest path that matches today's UX: keep the existing preview-canvas rendering loop, but feed it from a small helper that takes a `TargetRef`:

```ts
function previewCanvasFor(target: TargetRef): HTMLCanvasElement | OffscreenCanvas | null {
  if (target.kind === 'composite') {
    const c = LayerCompositor.compositeSync();
    return c.width > 0 ? c : null;
  }
  // layer/node: use per-layer output if available, fall back to source
  const out = PipelineManager.getOutputFor?.(target.layerId);
  if (out && out.width > 0) return out;
  return pixelStore.getSource(target.layerId) ?? null;
}
```

Reuse this helper in the existing preview-rendering `useEffect`. Drop the old `pickPreviewSource`.

- [ ] **Step 7: Pass the resolved target to submit**

`onSubmit` currently takes just the prompt text. Extend the contract:

```ts
// AiCommandPalette
async function handleSubmit(e: FormEvent) {
  e.preventDefault();
  if (!value.trim() || disabled || busy) return;
  setBusy(true);
  try {
    await onSubmit(value.trim());
  } finally {
    setBusy(false);
    onClose();
  }
}
```

`onSubmit` is already aware of the target via the `palette-bus` seed (set by `+`-button callers) and the smart default (Cmd+K case). So the palette doesn't actually need to pass the target out — App.tsx resolves it via `paletteSeed ?? resolveSmartTarget()`. **However**, if the user changed the chip inside the palette, that change needs to be reflected. Easiest path: when the user changes the target chip, call back to App via the bus:

```ts
// when chip changes:
import { setPaletteSeed } from '@/lib/palette-bus';
// expose a setter that App listens for
```

Add to `palette-bus.ts`:

```ts
let seedSetter: ((s: { target: TargetRef; intent: InsertionIntent } | null) => void) | null = null;
export function bindSeedSetter(fn: typeof seedSetter) { seedSetter = fn; }
export function setPaletteSeed(seed: { target: TargetRef; intent: InsertionIntent } | null) {
  seedSetter?.(seed);
}
```

In App.tsx wire `bindSeedSetter(setPaletteSeed)` next to `setPaletteOpenHandler`. In the palette, when the chip changes:

```ts
function commitTargetChange(next: TargetRef) {
  setTarget(next);
  setPaletteSeed({ target: next, intent: targetIntent });
}
```

- [ ] **Step 8: Run check + manual smoke test**

```bash
npm run check
npm run dev
```
1. Cmd+K with a layer selected → chip shows layer name.
2. Click chip → dropdown opens; pick a node → chip updates; preview reflects target.
3. Press ⌘T → chip cycles.
4. Submit goal → ai-step lands on the chosen target.

- [ ] **Step 9: Commit**

```bash
git add src/components/AiCommandPalette.tsx src/lib/palette-bus.ts
git commit -m "feat(palette): target chip header, dropdown picker, ⌘T cycling"
```

---

## Task 10 — Output-port `+` affordance

**Files:**
- Modify: `src/components/graph/nodes/AdjustmentNode.tsx`

Show a small `+` button on hover over a node's output handle. Click opens the palette pre-seeded with `{ kind: 'node', layerId, adjustmentId }` and `intent = 'append'`.

- [ ] **Step 1: Add the button**

In `AdjustmentNode.tsx`, identify where the output `Handle` is rendered (React Flow). Wrap or sibling it with a hover-revealed button:

```tsx
import { Plus } from 'lucide-react';
import { openPaletteWith } from '@/lib/palette-bus';

// inside the node JSX, near the output Handle:
<div className="group/output relative">
  <Handle type="source" position={Position.Right} />
  <button
    type="button"
    className="
      absolute -right-7 top-1/2 -translate-y-1/2
      opacity-0 group-hover/output:opacity-100
      transition-opacity
      w-5 h-5 rounded-full bg-accent text-white
      flex items-center justify-center shadow-md
    "
    title="Add AI step here"
    onClick={(e) => {
      e.stopPropagation();
      openPaletteWith(
        { kind: 'node', layerId: data.layerId, adjustmentId: data.adjustmentId },
        'append',
      );
    }}
  >
    <Plus className="w-3 h-3" />
  </button>
</div>
```

The `data` prop on a React Flow node carries `layerId` and `adjustmentId` per existing patterns — confirm by reading the node's `data` typing. If the field is named differently (e.g. `id` for the adjustment id) adapt accordingly. Reference: `src/core/derived-graph.ts` shows how the graph nodes are populated.

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
```
1. Enter graph mode.
2. Hover an adjustment node's right side. A `+` appears.
3. Click. Palette opens with chip = "Layer · Adjustment".
4. Submit a goal. New AI adjustments appear after that node.

- [ ] **Step 3: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/graph/nodes/AdjustmentNode.tsx
git commit -m "feat(graph): output-port + affordance opens palette pre-targeted"
```

---

## Task 11 — Edge `+` affordance

**Files:**
- Modify: `src/components/graph/CustomEdge.tsx`

Show a `+` at the midpoint of an edge on hover. Click opens the palette pre-seeded with `{ kind: 'node', layerId, adjustmentId: <upstream id> }` and `intent = 'splice'`.

Inserting between two nodes that live in the same layer's chain reduces to "append after the upstream node" because chains are linear — the next adjustment will naturally end up between upstream and downstream. The `'splice'` intent is recorded for the backend but the insertion math is the same as `'append'` (see Task 4's `insertionIndexFor`).

- [ ] **Step 1: Add midpoint button**

In `CustomEdge.tsx`, around the existing path/label rendering:

```tsx
import { Plus } from 'lucide-react';
import { openPaletteWith } from '@/lib/palette-bus';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

const [hover, setHover] = useState(false);

const [edgePath, labelX, labelY] = getBezierPath({
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
});

return (
  <>
    <BaseEdge
      path={edgePath}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
    <EdgeLabelRenderer>
      <div
        style={{
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          position: 'absolute',
          pointerEvents: 'all',
          opacity: hover ? 1 : 0,
          transition: 'opacity 120ms',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          type="button"
          className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center shadow-md"
          title="Insert AI step here"
          onClick={(e) => {
            e.stopPropagation();
            const upstreamLayerId = data?.sourceLayerId;
            const upstreamAdjustmentId = data?.sourceAdjustmentId;
            if (!upstreamLayerId || !upstreamAdjustmentId) {
              console.warn('[Edge+] missing source ids on edge data');
              return;
            }
            openPaletteWith(
              { kind: 'node', layerId: upstreamLayerId, adjustmentId: upstreamAdjustmentId },
              'splice',
            );
          }}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </EdgeLabelRenderer>
  </>
);
```

**Implementer note:** the `data` prop on a React Flow edge is whatever was attached when the edge was created. Check `src/core/derived-graph.ts` (where edges are built) for the actual field names; if missing, add `sourceLayerId` and `sourceAdjustmentId` to edge data when building the graph. Edges purely between structural nodes (source → adjustment, adjustment → output) should also work — the `+` between `source` and the first adjustment would target `{ kind: 'layer', layerId }` rather than `{ kind: 'node', ... }`. Handle both cases:

```ts
const ref: TargetRef = upstreamAdjustmentId
  ? { kind: 'node', layerId: upstreamLayerId, adjustmentId: upstreamAdjustmentId }
  : { kind: 'layer', layerId: upstreamLayerId };
```

- [ ] **Step 2: Ensure edges carry layer/adjustment provenance**

Open `src/core/derived-graph.ts` and confirm edges include `sourceLayerId` and (where applicable) `sourceAdjustmentId` in their `data` payload. If not, add them — every edge has a source node, and the source node's data already carries those ids.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```
1. Enter graph mode.
2. Hover over an edge → `+` appears at midpoint.
3. Click → palette opens with chip targeting the upstream node and "splice" indicator.
4. Submit a goal → adjustments appear between upstream and downstream.

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/graph/CustomEdge.tsx src/core/derived-graph.ts
git commit -m "feat(graph): edge + affordance pre-targets the upstream node with splice intent"
```

---

## Task 12 — `AiStepSection` inspector + InspectorPanel routing

**Files:**
- Create: `src/components/inspector/AiStepSection.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx` (or whichever file routes layer inspector content)

For non-`ai-panel` layers that contain `aiSteps`, render an `AiStepSection` per group. Reuses the same `BindingRow` rendering as `AiPanelSection`.

- [ ] **Step 1: Create `AiStepSection.tsx`**

```tsx
// src/components/inspector/AiStepSection.tsx
import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import type { AiStepMeta } from '@/store/layer-slice';
// Reuse BindingRow + ReasoningBadge from AiPanelSection. Either extract them
// to a shared file, or re-export them. Suggested: move BindingRow into
// `src/components/inspector/BindingRow.tsx` and import it in both places.
import { BindingRow } from './BindingRow';

interface AiStepSectionProps {
  layerId: string;
  graphId: string;
}

export function AiStepSection({ layerId, graphId }: AiStepSectionProps): ReactElement | null {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  const sessionId = useAiSession((s) => s.sessionId);

  if (!layer || !layer.aiSteps?.[graphId]) return null;
  const step: AiStepMeta = layer.aiSteps[graphId];

  const adjustmentsByNode = new Map(
    layer.adjustmentStack.adjustments
      .filter((a) => a.aiSource?.graphId === graphId)
      .map((a) => [a.aiSource!.nodeId, a]),
  );
  const nodesById = new Map(step.operationGraph.nodes.map((n) => [n.id, n]));

  return (
    <div className="flex flex-col border-t border-border/40">
      <div className="px-3 py-2 flex items-center gap-2 text-[11px]">
        <span aria-hidden>✨</span>
        <span className="text-text-secondary">AI step:</span>
        <span className="text-text-primary">{step.operationGraph.userGoal}</span>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2">
        {step.panelBindings.map((binding) => {
          const adjustmentType = nodesById.get(binding.nodeId)?.type ?? 'basic';
          const aiSource = adjustmentsByNode.get(binding.nodeId)?.aiSource;
          return (
            <BindingRow
              key={`${binding.nodeId}-${binding.paramKey}`}
              layerId={layerId}
              adjustmentType={adjustmentType}
              binding={binding}
              aiSource={aiSource}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Extract `BindingRow`**

Move the `BindingRow` component out of `AiPanelSection.tsx` into its own file `src/components/inspector/BindingRow.tsx` and re-import it in both `AiPanelSection.tsx` and `AiStepSection.tsx`. Its current shape (from exploration):

```tsx
// src/components/inspector/BindingRow.tsx
import { useProcessingParam } from '@/lib/use-processing-param';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { ReasoningBadge } from '@/components/inspector/ReasoningBadge';
import type { PanelBinding } from '@/types/operation-graph';
import type { AiSource } from '@/store/layer-slice';

interface BindingRowProps {
  layerId: string;
  adjustmentType: string;
  binding: PanelBinding;
  aiSource: AiSource | undefined;
}

export function BindingRow({ layerId, adjustmentType, binding, aiSource }: BindingRowProps) {
  const defaultNumber = typeof binding.default === 'number' ? binding.default : 0;
  const min = binding.min ?? 0;
  const max = binding.max ?? 100;
  const step = binding.step ?? 1;

  const [value, setValue] = useProcessingParam(
    layerId,
    adjustmentType,
    undefined,
    binding.paramKey,
    defaultNumber,
  );

  const reasoning = binding.reasoning ?? aiSource?.reasoning;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{binding.label}</span>
        {reasoning && (
          <ReasoningBadge
            reasoning={reasoning}
            modelName={aiSource?.modelName}
            modelVersion={aiSource?.modelVersion}
            timestamp={aiSource?.generatedAt}
          />
        )}
      </div>
      <AdjustmentSlider
        label={binding.label}
        value={value}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultNumber}
        onChange={setValue}
      />
    </div>
  );
}
```

(Confirm import paths against the actual file. The names above match exploration findings.)

- [ ] **Step 3: Wire `AiStepSection` into the inspector**

Open the inspector panel router. Find where layer-level sections are composed for a selected layer. Add:

```tsx
{Object.keys(layer.aiSteps ?? {}).map((graphId) => (
  <AiStepSection key={graphId} layerId={layer.id} graphId={graphId} />
))}
```

Place this above (or below — match existing visual hierarchy) the per-adjustment editor section.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```
1. Cmd+K on a regular image layer with no AI history.
2. Submit "warm up the highlights".
3. In the inspector for that layer, expect:
   - Existing adjustment rows (unchanged)
   - A new "AI step: warm up the highlights" section with the panel bindings as sliders + reasoning badges
4. Run a second Cmd+K on the same layer → second AI step group renders below the first.

- [ ] **Step 5: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/inspector/AiStepSection.tsx \
        src/components/inspector/BindingRow.tsx \
        src/components/inspector/AiPanelSection.tsx \
        src/components/inspector/InspectorPanel.tsx
git commit -m "feat(inspector): AiStepSection renders per-step bindings for non-ai-panel layers"
```

---

## Task 13 — Backward-compat smoke test

**Files:** none modified; sanity check only.

- [ ] **Step 1: Manual test against a legacy document**

```bash
npm run dev
```
1. If you have an `.edp` file produced by a previous build that contains `ai-panel` layers, open it. Expected: it loads, layers render, sliders work as before.
2. If you don't have one, generate one against the current `dev` build before starting this plan (or check git history for fixtures).

- [ ] **Step 2: Verify existing automated tests still pass**

```bash
npm run check
```
Expected: PASS. All existing tests including the ones in `ai-panel-actions.test.ts` covering `addAiPanelLayer`, `addRefinedAiPanelLayer`, and `resetPanelToSuggestion` remain green.

- [ ] **Step 3: Commit (no-op, just marks the plan complete)**

If nothing was changed, skip. If a small adjustment was needed (e.g. a serialization-version bump in `src/core/document.ts` to tolerate the new `aiSteps` field), commit it:

```bash
git add -p
git commit -m "chore(ai): legacy ai-panel documents still load alongside new ai-step path"
```

---

## Self-review checklist (run after writing the plan)

- [ ] Each spec section has a corresponding task:
  - Core model (TargetRef + context anchoring) → Tasks 1, 2, 5, 7
  - Palette UX (chip, smart default) → Task 9
  - `ai-step` as graph node (insertion semantics) → Tasks 3, 4
  - `+` affordances → Tasks 10, 11
  - Backend API delta → Task 6
  - Coexistence with `ai-panel` → Task 13 (and the unchanged legacy code paths)
  - Inspector binding → Task 12
- [ ] No placeholders or "TBD" in any task.
- [ ] Type and function names are consistent across tasks: `TargetRef`, `InsertionIntent`, `addAiStepNode`, `refineAiStepNode`, `resolveSmartTarget`, `humanLabelFor`, `renderTargetSnapshot`, `insertAdjustment`, `AiStepMeta`, `Layer.aiSteps`.
- [ ] Every code-bearing step shows actual code.
- [ ] Every task ends in a commit.

## Out of scope (per spec, deferred to future plans)

- 3-up variants and Regenerate UX
- Live before/after preview with canvas ghost
- Clarifying-question loop (AI returns a question instead of a graph)
- Tweak-before-commit slider stage
- True `'branch'` insertion (creating a parallel graph path)
- `@layer` cross-branch references
- Expand-to-edit for an `ai-step`'s internal subgraph
- Single-node visual rendering of an ai-step group in the graph (currently shows as N adjacent adjustment nodes)
- Precise mid-chain target snapshot (currently falls back to host-layer output)

## Coordination with the `journalist` backend

Tasks 6 and 8 send new fields (`target_snapshot_base64`, `target_ref`, `insertion_intent`) to `POST /api/panel`. The backend in `~/Dev/Projects/journalist/` needs to:
- Accept the new fields without error (ignore safely if not yet wired into prompting).
- Eventually include the target snapshot in the user turn after the cache marker (image content block, no `cache_control`).
- Pass `target_ref` and `insertion_intent` into the system / user prompt so the model can reason about scope and downstream operations.

A sibling plan in `~/Dev/Projects/journalist/docs/` should cover these backend changes. This plan ships frontend-first; the new fields are inert until the backend consumes them.
