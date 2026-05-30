# Canvas Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Fabric-based `EditorCanvas` viewport with a React Flow infinite workspace whose nodes are full-res Image renders (N layers composited, mergeable/splittable) and adjustment Widgets (existing `WidgetShell`); tether edges show which Image each Widget affects (solid = layer-scope, dashed = whole-node-scope).

**Architecture:** Build the new workspace alongside the old surface behind a feature flag so every commit keeps `npm run check` green. Foundations first (deps, types, store), then components in isolation with TDD, then mounted via the flag, then real pipeline / mask wiring, then interactions and backend `ImageNodeScope` extension, then flip the flag and delete Fabric + the widget-shell dock path. Backend change is minimal — one new `Scope` variant.

**Tech Stack:** React 19 + Vite + TypeScript (strict) · `@xyflow/react` (new) · Tailwind v4 + Geist · Zustand v5 + Immer · Vitest + @testing-library/react · existing WebGL pipeline (`pipeline.ts`, `layer-compositor.ts`) · FastAPI + Pydantic (backend) · pytest (backend tests).

**Source spec:** `docs/superpowers/specs/2026-05-30-canvas-workspace-design.md`

**Verification primitives used throughout:**
- `npm run check` → `tsc -b && eslint . && vitest run`. Must be green before every commit. The pre-commit hook runs the same.
- Backend tests: `cd backend && pytest`. Run for tasks 17–19.
- Manual: `npm run dev`; with the backend on `127.0.0.1:8787`, the dev server exercises the spawn → render → tether → bake flow.

---

## File-touch map

| File | Action | Tasks |
|---|---|---|
| `package.json` | add `@xyflow/react` (T1); remove `fabric` (T20) | 1, 20 |
| `src/types/workspace.ts` | NEW · ImageNodeState, WidgetNodeState, TetherEdgeState, WorkspaceViewport, NodeScopeKind | 1 |
| `src/types/scope.ts` | UPDATE · add `image_node` variant to `Scope` discriminated union | 17 |
| `src/store/workspace-slice.ts` | NEW · the new slice (image nodes, edges, selection, viewport, expansion) | 1, 12, 15, 16 |
| `src/store/tool-slice.ts` | UPDATE in T20 only · drop widget-shell dock fields once their hook consumers are deleted | 20 |
| `src/store/preferences-store.ts` | UPDATE · add `useWorkspaceCanvas: boolean` feature flag + partialize | 7 |
| `src/components/workspace/workspace-layout.ts` | NEW · `nextSpawnPositionFor` + collision-shift | 2 |
| `src/components/workspace/workspace-fit.ts` | NEW · "fit selection" / "frame all" helpers | 2 |
| `src/components/workspace/ImageNode.tsx` | NEW · custom React Flow node | 3 |
| `src/components/workspace/ImageNodeBody.tsx` | NEW · drives WebGL pipeline render into a canvas | 3, 9, 10 |
| `src/components/workspace/WidgetNode.tsx` | NEW · wraps `WidgetShell` | 4 |
| `src/components/workspace/TetherEdge.tsx` | NEW · custom React Flow edge | 5 |
| `src/components/workspace/CanvasWorkspace.tsx` | NEW · top-level scaffold; replaces `EditorCanvas` behind the flag | 6, 13, 14 |
| `src/components/workspace/ImageNodeSelectionPopover.tsx` | NEW · "Create layer / Discard" popover (replaces SelectionActionsOverlay) | 10 |
| `src/hooks/useImageNodeRender.ts` | NEW · per-ImageNode pipeline driver | 9 |
| `src/hooks/useWorkspaceSelection.ts` | NEW · selectors for active/hover/expansion | 12 |
| `src/components/App.tsx` (or `MainLayout`) | UPDATE · conditionally render `CanvasWorkspace` vs `EditorCanvas` based on flag | 8 |
| Backend `backend/app/schemas/widget.py` | UPDATE · add `ImageNodeScope` to `Scope` union | 17 |
| Backend `backend/app/tools/atomic/accept_widget.py` | UPDATE · materialize node-scope into operation_graph | 18 |
| Backend `backend/app/tools/atomic/propose_widget.py` | UPDATE · accept node-scope from frontend | 18 |
| `src/lib/pipeline-manager.ts` | UPDATE · composite-then-apply for node-scope widgets | 19 |
| Deletions (Task 20) | DELETE · `EditorCanvas.tsx`, `useFabricOverlays.ts`, `useAdjustmentPipeline.ts`, `SelectionActionsOverlay.tsx`, `SegmentOverlay.tsx`, `FullImageOutline.tsx`, `CanvasWidgetLayer.tsx`, `AnchorTickLayer.tsx`, `RegionHighlightLayer.tsx`, `useWidgetDockLayout.ts`, `useWidgetExpansion.ts`, `useHoveredWidget.ts`, `useDragOverride.ts`, `useCursorBind.ts`, `CursorBindGhost.tsx` | 20 |
| `design.md` | UPDATE · §11 (Widget Shell → Canvas Workspace); add §12 (React Flow node anatomy + tether semantics) | 21 |
| `CLAUDE.md` | UPDATE · widget-rendering rule (CanvasWorkspace, not CanvasWidgetLayer) | 21 |

---

## Task 1: Foundations — dep, types, store

**Files:**
- Modify: `package.json`
- Create: `src/types/workspace.ts`
- Create: `src/store/workspace-slice.ts`
- Modify: `src/store/tool-slice.ts` (drop dock fields, add `activeImageNodeId`)
- Modify: `src/store/index.ts` (register workspace slice)
- Test: `src/store/workspace-slice.test.ts` (NEW)

- [ ] **Step 1: Install React Flow**

```bash
npm i @xyflow/react
```

- [ ] **Step 2: Write the failing slice tests**

`src/store/workspace-slice.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('workspace-slice', () => {
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.resetWorkspace();
  });

  it('addImageNode returns a new id and stores the layerIds + position', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 100, y: 50 });
    const node = useEditorStore.getState().imageNodes[id];
    expect(node.layerIds).toEqual(['l-1']);
    expect(node.position).toEqual({ x: 100, y: 50 });
    expect(node.size).toEqual({ w: 240, h: 180 });
  });

  it('splitImageNode (1 layer) returns the same id; (N layers) returns N new ids', () => {
    const s = useEditorStore.getState();
    const id1 = s.addImageNode(['l-1']);
    expect(s.splitImageNode(id1)).toEqual([id1]);
    const idN = s.addImageNode(['l-2', 'l-3']);
    const out = s.splitImageNode(idN);
    expect(out).toHaveLength(2);
    expect(out).not.toContain(idN);
    expect(useEditorStore.getState().imageNodes[idN]).toBeUndefined();
  });

  it('mergeImageNodes combines layerIds and removes the originals', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['l-1']);
    const b = s.addImageNode(['l-2']);
    const merged = s.mergeImageNodes([a, b]);
    expect(useEditorStore.getState().imageNodes[merged].layerIds).toEqual(['l-1', 'l-2']);
    expect(useEditorStore.getState().imageNodes[a]).toBeUndefined();
    expect(useEditorStore.getState().imageNodes[b]).toBeUndefined();
  });

  it('setEdge + unbindEdge round-trip', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setEdge('w-1', img, { kind: 'layer', layerId: 'l-1' });
    const edge = Object.values(useEditorStore.getState().tetherEdges)[0];
    expect(edge.widgetNodeId).toBe('w-1');
    expect(edge.targetImageNodeId).toBe(img);
    expect(edge.scope.kind).toBe('layer');
    s.unbindEdge(edge.id);
    expect(useEditorStore.getState().tetherEdges[edge.id]).toBeUndefined();
  });

  it('toggleExpanded toggles widget expansion id', () => {
    const s = useEditorStore.getState();
    s.toggleExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(true);
    s.toggleExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(false);
  });

  it('activeImageNodeId updates when a single image node is selected', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setSelection([img], []);
    expect(useEditorStore.getState().activeImageNodeId).toBe(img);
    s.setSelection([], []);
    expect(useEditorStore.getState().activeImageNodeId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/store/workspace-slice.test.ts`
Expected: FAIL — `addImageNode` etc. not on the store.

- [ ] **Step 4: Create `src/types/workspace.ts`**

```ts
export type NodeScopeKind = 'layer' | 'node' | 'unbound';

export interface ImageNodeState {
  id: string;
  layerIds: string[];
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface WidgetNodeState {
  id: string;
  position: { x: number; y: number };
}

export interface TetherEdgeState {
  id: string;
  widgetNodeId: string;
  targetImageNodeId: string;
  scope:
    | { kind: 'layer'; layerId: string }
    | { kind: 'node' };
}

export interface WorkspaceViewport {
  zoom: number;
  pan: { x: number; y: number };
}
```

- [ ] **Step 5: Create `src/store/workspace-slice.ts`**

```ts
import type { StateCreator } from 'zustand';
import type { ImageNodeState, TetherEdgeState, WorkspaceViewport } from '@/types/workspace';

const DEFAULT_NODE_SIZE = { w: 240, h: 180 };

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetPositions: Record<string, { x: number; y: number }>;
  tetherEdges: Record<string, TetherEdgeState>;
  viewport: WorkspaceViewport;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  expandedWidgetIds: Set<string>;
  activeImageNodeId: string | null;

  addImageNode: (layerIds: string[], position?: { x: number; y: number }) => string;
  splitImageNode: (id: string) => string[];
  mergeImageNodes: (ids: string[]) => string;
  setNodePosition: (id: string, position: { x: number; y: number }) => void;
  setWidgetPosition: (id: string, position: { x: number; y: number }) => void;
  setEdge: (widgetNodeId: string, targetImageNodeId: string, scope: TetherEdgeState['scope']) => string;
  unbindEdge: (edgeId: string) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  setViewport: (v: WorkspaceViewport) => void;
  toggleExpanded: (widgetId: string) => void;
  resetWorkspace: () => void;
}

let nextNodeId = 1;
function nodeId() { return `in-${nextNodeId++}`; }
let nextEdgeId = 1;
function edgeId() { return `te-${nextEdgeId++}`; }

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetPositions: {},
  tetherEdges: {},
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  selectedNodeIds: new Set<string>(),
  selectedEdgeIds: new Set<string>(),
  expandedWidgetIds: new Set<string>(),
  activeImageNodeId: null,

  addImageNode: (layerIds, position = { x: 0, y: 0 }) => {
    const id = nodeId();
    set((s) => {
      s.imageNodes[id] = { id, layerIds: [...layerIds], position, size: { ...DEFAULT_NODE_SIZE } };
    });
    return id;
  },

  splitImageNode: (id) => {
    const node = (useGetState() as WorkspaceSlice).imageNodes[id];
    if (!node || node.layerIds.length <= 1) return [id];
    const newIds: string[] = [];
    set((s) => {
      const src = s.imageNodes[id];
      src.layerIds.forEach((lid, i) => {
        const newId = nodeId();
        newIds.push(newId);
        s.imageNodes[newId] = {
          id: newId,
          layerIds: [lid],
          position: { x: src.position.x + i * (DEFAULT_NODE_SIZE.w + 24), y: src.position.y },
          size: { ...DEFAULT_NODE_SIZE },
        };
      });
      delete s.imageNodes[id];
      // Migrate edges that pointed to the original to point at the matching new node.
      for (const edge of Object.values(s.tetherEdges)) {
        if (edge.targetImageNodeId !== id) continue;
        if (edge.scope.kind === 'layer') {
          const newOwner = newIds.find((nid) => s.imageNodes[nid].layerIds.includes(edge.scope.layerId));
          if (newOwner) edge.targetImageNodeId = newOwner;
        } else {
          // Node-scope: keep tether to the first new node and warn (see Task 15 split flow).
          edge.targetImageNodeId = newIds[0];
        }
      }
    });
    return newIds;
  },

  mergeImageNodes: (ids) => {
    if (ids.length === 0) return '';
    const newId = nodeId();
    set((s) => {
      const layerIds: string[] = [];
      let basePos: { x: number; y: number } | null = null;
      for (const id of ids) {
        const n = s.imageNodes[id];
        if (!n) continue;
        basePos ??= { ...n.position };
        layerIds.push(...n.layerIds);
        delete s.imageNodes[id];
      }
      s.imageNodes[newId] = { id: newId, layerIds, position: basePos ?? { x: 0, y: 0 }, size: { ...DEFAULT_NODE_SIZE } };
      for (const edge of Object.values(s.tetherEdges)) {
        if (ids.includes(edge.targetImageNodeId)) edge.targetImageNodeId = newId;
      }
    });
    return newId;
  },

  setNodePosition: (id, position) =>
    set((s) => {
      const n = s.imageNodes[id];
      if (n) n.position = position;
    }),

  setWidgetPosition: (id, position) =>
    set((s) => {
      s.widgetPositions[id] = position;
    }),

  setEdge: (widgetNodeId, targetImageNodeId, scope) => {
    const id = edgeId();
    set((s) => {
      s.tetherEdges[id] = { id, widgetNodeId, targetImageNodeId, scope };
    });
    return id;
  },

  unbindEdge: (edgeId) =>
    set((s) => {
      delete s.tetherEdges[edgeId];
    }),

  setSelection: (nodeIds, edgeIds) =>
    set((s) => {
      s.selectedNodeIds = new Set(nodeIds);
      s.selectedEdgeIds = new Set(edgeIds);
      const imageOnly = nodeIds.filter((id) => s.imageNodes[id]);
      s.activeImageNodeId = imageOnly.length === 1 ? imageOnly[0] : null;
    }),

  setViewport: (v) =>
    set((s) => {
      s.viewport = v;
    }),

  toggleExpanded: (widgetId) =>
    set((s) => {
      if (s.expandedWidgetIds.has(widgetId)) s.expandedWidgetIds.delete(widgetId);
      else s.expandedWidgetIds.add(widgetId);
    }),

  resetWorkspace: () =>
    set((s) => {
      s.imageNodes = {};
      s.widgetPositions = {};
      s.tetherEdges = {};
      s.viewport = { zoom: 1, pan: { x: 0, y: 0 } };
      s.selectedNodeIds.clear();
      s.selectedEdgeIds.clear();
      s.expandedWidgetIds.clear();
      s.activeImageNodeId = null;
    }),
});

// Replace this with the existing project pattern for reading the current store state.
function useGetState(): unknown {
  // Imported lazily to avoid a circular import; see store/index.ts wiring in Step 6.
  return (require('@/store') as typeof import('@/store')).useEditorStore.getState();
}
```

- [ ] **Step 6: Register the slice in `src/store/index.ts`**

Read `src/store/index.ts` to see how existing slices are composed. Add `createWorkspaceSlice` to the combined creator and export the type accordingly. Wire so that `useEditorStore.getState().addImageNode(...)` etc. is callable. If the existing pattern uses a `combine(...)` helper or explicit slice merging, follow that.

The lazy `useGetState` shim in Step 5 can be removed if `addImageNode`/`splitImageNode` can read the latest state via the Immer `set((s) => …)` callback and an `s.imageNodes` lookup. Simplest correct rewrite:
```ts
splitImageNode: (id) => {
  let result: string[] = [];
  set((s) => {
    const node = s.imageNodes[id];
    if (!node || node.layerIds.length <= 1) { result = [id]; return; }
    // ... rest as before, using s. directly
  });
  return result;
},
```
Adopt this pattern to drop the require shim.

- [ ] **Step 7: Leave `src/store/tool-slice.ts` alone for now**

The widget-shell dock fields on `tool-slice` (`expandedWidgetIds`, `hoveredWidgetId`, `sessionDragOverrides`) are still consumed by `useWidgetExpansion` / `useHoveredWidget` / `useDragOverride` and `CanvasWidgetLayer`, which are NOT deleted until T20. Removing them here would break the build. The new `workspace-slice.expandedWidgetIds` coexists with the tool-slice copy during the migration; T20 deletes the tool-slice copy together with the hooks.

`activeImageNodeId` lives only in `workspace-slice` (added above). Don't add it to `tool-slice`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run check` → PASS. The slice tests pass; existing tests still green.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/types/workspace.ts src/store/workspace-slice.ts src/store/index.ts src/store/workspace-slice.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): add @xyflow/react dep + types + workspace-slice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: workspace-layout — soft-auto placement

**Files:**
- Create: `src/components/workspace/workspace-layout.ts`
- Create: `src/components/workspace/workspace-fit.ts`
- Test: `src/components/workspace/workspace-layout.test.ts`

- [ ] **Step 1: Write the failing test**

`src/components/workspace/workspace-layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { nextSpawnPositionFor } from './workspace-layout';

describe('nextSpawnPositionFor', () => {
  it('places widgets to the right of the target image node', () => {
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, 'widget', [])).toEqual({ x: 364, y: 95 });
  });

  it('places new images to the right with a 24px gap', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, 'image', [])).toEqual({ x: 264, y: 0 });
  });

  it('shifts down when a node already occupies the slot', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    const occupied = [{ position: { x: 264, y: 0 }, size: { w: 240, h: 180 } }];
    expect(nextSpawnPositionFor(target, 'image', occupied)).toEqual({ x: 264, y: 204 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/workspace-layout.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `workspace-layout.ts`**

```ts
export const SPAWN_GAP = 24;
const WIDGET_OFFSET_Y = 45; // visual centre of an empty widget header

export interface PlacedRect {
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export function nextSpawnPositionFor(
  target: PlacedRect,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
): { x: number; y: number } {
  let x = target.position.x + target.size.w + SPAWN_GAP;
  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: target.size }, o))) {
    y += target.size.h + SPAWN_GAP;
  }
  return { x, y };
}

function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return (
    a.position.x < b.position.x + b.size.w &&
    b.position.x < a.position.x + a.size.w &&
    a.position.y < b.position.y + b.size.h &&
    b.position.y < a.position.y + a.size.h
  );
}
```

- [ ] **Step 4: Implement `workspace-fit.ts`** (minimal placeholder for now; the real fit helpers come in T13)

```ts
import type { PlacedRect } from './workspace-layout';

export function bboxOf(rects: PlacedRect[]): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.position.x));
  const minY = Math.min(...rects.map((r) => r.position.y));
  const maxX = Math.max(...rects.map((r) => r.position.x + r.size.w));
  const maxY = Math.max(...rects.map((r) => r.position.y + r.size.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

- [ ] **Step 5: Run tests + check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/workspace-layout.ts src/components/workspace/workspace-fit.ts src/components/workspace/workspace-layout.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): soft-auto layout helper + workspace bbox

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ImageNode + ImageNodeBody (with mock canvas)

**Files:**
- Create: `src/components/workspace/ImageNode.tsx`, `ImageNodeBody.tsx`
- Test: `src/components/workspace/ImageNode.test.tsx`

**Anatomy** (matches spec §3.1 and the v1 mock):
- Header: icon · name · "N LAYERS" badge · ⋯
- Body: a `<canvas>` element (mock for now — real pipeline in T9/T11)
- Footer: dims · active-layer label
- Inline stack strip (only when `layerIds.length > 1` AND selected)
- Corner split/merge affordance (only when selected)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ImageNode } from './ImageNode';
import { ReactFlowProvider } from '@xyflow/react';

afterEach(cleanup);

function renderInFlow(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

const baseData = { layerIds: ['l-1'], size: { w: 240, h: 180 } };

describe('ImageNode', () => {
  it('renders header with name and layer-count badge', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky.jpg' }} selected={false} />);
    expect(screen.getByText('Sky.jpg')).toBeInTheDocument();
    expect(screen.getByText('1 LAYER')).toBeInTheDocument();
  });

  it('shows the stack strip ONLY when stacked AND selected', () => {
    const data = { layerIds: ['l-1', 'l-2'], size: baseData.size, name: 'Stacked' };
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={data} selected={false} />);
    expect(screen.queryByLabelText('Layer strip')).not.toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={data} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Layer strip')).toBeInTheDocument();
  });

  it('shows the split/merge affordance ONLY when selected', () => {
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={false} />);
    expect(screen.queryByLabelText('Split or merge')).not.toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Split or merge')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ImageNodeBody.tsx` (mock canvas for now)**

```tsx
interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function ImageNodeBody({ width, height }: ImageNodeBodyProps) {
  return (
    <div
      aria-label="Image node body"
      className="bg-surface-secondary border border-separator"
      style={{ width, height }}
    />
  );
}
```

(T9 replaces this with a real `<canvas>` wired to `useImageNodeRender`.)

- [ ] **Step 4: Implement `ImageNode.tsx`**

```tsx
import { Image, Split, MoreHorizontal } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import { ImageNodeBody } from './ImageNodeBody';

export interface ImageNodeData {
  name?: string;
  layerIds: string[];
  size: { w: number; h: number };
  activeLayerIndex?: number;
}

interface ImageNodeProps {
  id: string;
  data: ImageNodeData;
  selected: boolean;
}

export function ImageNode({ id, data, selected }: ImageNodeProps) {
  const stacked = data.layerIds.length > 1;
  const showStrip = stacked && selected;
  return (
    <div
      className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
      style={{ width: data.size.w + 2 /* outer border */ }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-separator">
        <Image size={11} className="text-text-secondary" aria-hidden />
        <span className="text-[10px] font-medium flex-1 truncate">{data.name ?? 'Image'}</span>
        <span className="text-[8px] font-semibold bg-surface-secondary border border-separator rounded-full px-1.5 py-px text-text-secondary uppercase">
          {data.layerIds.length} LAYER{data.layerIds.length === 1 ? '' : 'S'}
        </span>
        <button aria-label="Node menu" className="text-text-tertiary"><MoreHorizontal size={11} aria-hidden /></button>
      </div>
      <ImageNodeBody imageNodeId={id} layerIds={data.layerIds} width={data.size.w} height={data.size.h} />
      <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-text-secondary border-t border-separator">
        <span className="num">{data.size.w} × {data.size.h}</span>
        <span className="flex-1" />
        <span>Layer {(data.activeLayerIndex ?? 0) + 1}</span>
      </div>
      {showStrip && (
        <div aria-label="Layer strip" className="flex gap-1 px-2 py-1 bg-surface-secondary border-t border-separator">
          {data.layerIds.map((lid, i) => (
            <div
              key={lid}
              className={`flex-1 h-[18px] rounded-[3px] border border-separator bg-surface ${i === (data.activeLayerIndex ?? 0) ? 'outline-[1.5px] outline outline-accent' : ''}`}
            />
          ))}
        </div>
      )}
      {selected && (
        <button
          aria-label="Split or merge"
          className="absolute -top-2 -right-2 w-[18px] h-[18px] rounded-full bg-surface border border-border-strong shadow-[0_2px_6px_rgba(0,0,0,0.06)] flex items-center justify-center text-text-secondary"
        >
          <Split size={10} aria-hidden />
        </button>
      )}
      <Handle type="source" position={Position.Left} id="tether-out" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="tether-in" style={{ opacity: 0 }} />
    </div>
  );
}
```

(Note: React Flow nodes need `Handle` components to be connectable, even if we hide them visually. Position them on the left/right edges.)

- [ ] **Step 5: Run tests + check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNodeBody.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): ImageNode + ImageNodeBody (mock canvas, header, stack strip)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: WidgetNode wrapping WidgetShell

**Files:**
- Create: `src/components/workspace/WidgetNode.tsx`
- Test: `src/components/workspace/WidgetNode.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { WidgetNode } from './WidgetNode';
import { makeAiWidget } from '@/components/widget/__fixtures__/widgets';

afterEach(cleanup);

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  return {
    ...actual,
    useBackendState: Object.assign(
      (sel: (s: any) => any) => sel({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open' }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open' }) },
    ),
  };
});

describe('WidgetNode', () => {
  it('wraps a WidgetShell and renders the widget intent', () => {
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-ai-1" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/WidgetNode.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `WidgetNode.tsx`**

```tsx
import { Handle, Position } from '@xyflow/react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import type { Widget } from '@/types/widget';

export interface WidgetNodeData {
  widget: Widget;
}

interface WidgetNodeProps {
  id: string;
  data: WidgetNodeData;
  selected: boolean;
}

export function WidgetNode({ data, selected: _selected }: WidgetNodeProps) {
  return (
    <>
      <Handle type="source" position={Position.Right} id="tether-out" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="tether-in" style={{ opacity: 0 }} />
      <WidgetShell widget={data.widget} />
    </>
  );
}
```

- [ ] **Step 4: Run tests + check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/WidgetNode.tsx src/components/workspace/WidgetNode.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): WidgetNode wraps WidgetShell

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TetherEdge — custom React Flow edge

**Files:**
- Create: `src/components/workspace/TetherEdge.tsx`
- Test: `src/components/workspace/TetherEdge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { TetherEdge } from './TetherEdge';

afterEach(cleanup);

function renderEdge(scopeKind: 'layer' | 'node') {
  return render(
    <ReactFlowProvider>
      <svg>
        <TetherEdge
          id="te-1" source="w" target="i" sourceX={100} sourceY={50} targetX={300} targetY={50}
          sourcePosition="right" targetPosition="left"
          data={{ scopeKind }}
        />
      </svg>
    </ReactFlowProvider>,
  );
}

describe('TetherEdge', () => {
  it('solid line for layer-scope', () => {
    const { container } = renderEdge('layer');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBeFalsy();
  });
  it('dashed line for node-scope', () => {
    const { container } = renderEdge('node');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('3 3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/TetherEdge.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `TetherEdge.tsx`**

```tsx
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface TetherEdgeData {
  scopeKind: 'layer' | 'node';
}

export function TetherEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps<TetherEdgeData>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dashArray = data?.scopeKind === 'node' ? '3 3' : undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--color-accent)', strokeWidth: 1.5, strokeDasharray: dashArray, fill: 'none' }} />
      <circle cx={sourceX} cy={sourceY} r={3} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={3} fill="var(--color-accent)" />
    </>
  );
}
```

- [ ] **Step 4: Run tests + check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/TetherEdge.tsx src/components/workspace/TetherEdge.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): TetherEdge — solid (layer-scope) / dashed (node-scope)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: CanvasWorkspace scaffold

**Files:**
- Create: `src/components/workspace/CanvasWorkspace.tsx`
- Test: `src/components/workspace/CanvasWorkspace.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CanvasWorkspace } from './CanvasWorkspace';
import { useEditorStore } from '@/store';

afterEach(cleanup);

describe('CanvasWorkspace', () => {
  it('renders an empty workspace when no nodes exist', () => {
    useEditorStore.getState().resetWorkspace();
    render(<CanvasWorkspace />);
    expect(document.querySelector('.react-flow')).toBeTruthy();
  });

  it('renders an Image node for each entry in the store', () => {
    useEditorStore.getState().resetWorkspace();
    const id = useEditorStore.getState().addImageNode(['l-1'], { x: 50, y: 50 });
    render(<CanvasWorkspace />);
    expect(document.querySelector(`[data-id="${id}"]`)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `CanvasWorkspace.tsx`**

```tsx
import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditorStore } from '@/store';
import { ImageNode, type ImageNodeData } from './ImageNode';
import { WidgetNode, type WidgetNodeData } from './WidgetNode';
import { TetherEdge, type TetherEdgeData } from './TetherEdge';
import { useBackendState } from '@/store/backend-state-slice';

const nodeTypes = { image: ImageNode, widget: WidgetNode };
const edgeTypes = { tether: TetherEdge };

export function CanvasWorkspace() {
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const widgetPositions = useEditorStore((s) => s.widgetPositions);
  const tetherEdges = useEditorStore((s) => s.tetherEdges);
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const setNodePosition = useEditorStore((s) => s.setNodePosition);
  const setWidgetPosition = useEditorStore((s) => s.setWidgetPosition);
  const setSelection = useEditorStore((s) => s.setSelection);

  const nodes = useMemo<Node[]>(() => {
    const imgs: Node<ImageNodeData>[] = Object.values(imageNodes).map((n) => ({
      id: n.id,
      type: 'image',
      position: n.position,
      data: { layerIds: n.layerIds, size: n.size, name: n.layerIds[0] ?? 'Image' },
    }));
    const widgets: Node<WidgetNodeData>[] = snapshotWidgets
      .filter((w) => w.status === 'active')
      .map((w) => ({
        id: w.id,
        type: 'widget',
        position: widgetPositions[w.id] ?? { x: 0, y: 0 },
        data: { widget: w },
      }));
    return [...imgs, ...widgets];
  }, [imageNodes, widgetPositions, snapshotWidgets]);

  const edges = useMemo<Edge<TetherEdgeData>[]>(
    () =>
      Object.values(tetherEdges).map((e) => ({
        id: e.id,
        source: e.widgetNodeId,
        target: e.targetImageNodeId,
        type: 'tether',
        data: { scopeKind: e.scope.kind },
      })),
    [tetherEdges],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'image') setNodePosition(node.id, node.position);
      else if (node.type === 'widget') setWidgetPosition(node.id, node.position);
    },
    [setNodePosition, setWidgetPosition],
  );

  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      setSelection(nodes.map((n) => n.id), edges.map((e) => e.id));
    },
    [setSelection],
  );

  const onConnect = useCallback((_: Connection) => {
    // Manual edge dragging is disabled in v1; ignore.
  }, []);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

const EMPTY_WIDGETS: import('@/types/widget').Widget[] = [];
```

- [ ] **Step 4: Run tests + check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CanvasWorkspace.tsx src/components/workspace/CanvasWorkspace.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): CanvasWorkspace scaffold (React Flow wiring)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Feature flag — `useWorkspaceCanvas`

**Files:**
- Modify: `src/store/preferences-store.ts`
- Test: `src/store/preferences-store.test.ts` (NEW or extend)

- [ ] **Step 1: Read the existing `preferences-store.ts` to find the partialize pattern**

Then add to the state interface:
```ts
useWorkspaceCanvas: boolean;
setUseWorkspaceCanvas: (v: boolean) => void;
```

Initial value: `false`. Add to `partialize` so it persists.

- [ ] **Step 2: Write a quick test (and update existing preferences test if any)**

```ts
import { describe, it, expect } from 'vitest';
import { usePreferencesStore } from '@/store/preferences-store';

describe('preferences-store · useWorkspaceCanvas', () => {
  it('defaults to false and setter flips it', () => {
    usePreferencesStore.setState({ useWorkspaceCanvas: false });
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(false);
    usePreferencesStore.getState().setUseWorkspaceCanvas(true);
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(true);
  });
});
```

- [ ] **Step 3: Implement the flag**

In the creator:
```ts
useWorkspaceCanvas: false,
setUseWorkspaceCanvas: (v) => set({ useWorkspaceCanvas: v }),
```
Add `useWorkspaceCanvas: state.useWorkspaceCanvas` to the partialize block.

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/preferences-store.ts src/store/preferences-store.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): preferences flag useWorkspaceCanvas (default false)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Conditionally mount CanvasWorkspace alongside EditorCanvas

**Files:**
- Modify: `src/App.tsx` (or wherever `<MainLayout>` and `<EditorCanvas>` are mounted)

- [ ] **Step 1: Read `App.tsx`**

Find where `EditorCanvas` is rendered.

- [ ] **Step 2: Add conditional**

```tsx
import { usePreferencesStore } from '@/store/preferences-store';
import { CanvasWorkspace } from '@/components/workspace/CanvasWorkspace';
// ...
const useWorkspace = usePreferencesStore((s) => s.useWorkspaceCanvas);
// ...
{useWorkspace
  ? <CanvasWorkspace />
  : <EditorCanvas canvasRef={canvasRef} />
}
```

The `canvasRef` is no longer needed by `CanvasWorkspace`; it's only used by `EditorCanvas`. Pass it only on the Fabric branch.

- [ ] **Step 3: Manual sanity**

Run `npm run dev`. App renders the Fabric canvas by default (flag false). Toggle the flag via the React DevTools / browser console to see the new workspace render. Don't expect functional parity yet — Tasks 9–14 wire the real flows.

- [ ] **Step 4: Run check + commit**

```bash
npm run check
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): mount CanvasWorkspace behind useWorkspaceCanvas flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: useImageNodeRender — port the WebGL pipeline driver

**Files:**
- Create: `src/hooks/useImageNodeRender.ts`
- Modify: `src/components/workspace/ImageNodeBody.tsx` (replace mock with the real canvas)
- Test: `src/hooks/useImageNodeRender.test.ts`

**Contract:**
```ts
useImageNodeRender({ imageNodeId: string; layerIds: string[]; width: number; height: number })
  → { canvasRef: React.RefObject<HTMLCanvasElement | null> }
```

Drives the existing pipeline (`pipeline-manager.ts`) + layer compositor over the listed layer ids and paints into the returned canvas.

- [ ] **Step 1: Read `src/components/canvas/useAdjustmentPipeline.ts` + `src/lib/layer-compositor.ts`**

Identify the entry points that take `layer_ids` and produce a composite. The existing `useAdjustmentPipeline` is wired to a Fabric canvas; replace that surface with a plain `HTMLCanvasElement` you control.

- [ ] **Step 2: Implement `useImageNodeRender.ts`**

```ts
import { useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';

export interface ImageNodeRenderInput {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function useImageNodeRender({ imageNodeId, layerIds, width, height }: ImageNodeRenderInput) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opGraph = useBackendState((s) => s.snapshot?.operation_graph);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    void renderImageNodeComposite({ canvas, layerIds, opGraph, widgets, imageNodeId });
  }, [width, height, layerIds, opGraph, widgets, imageNodeId]);

  return { canvasRef };
}
```

- [ ] **Step 3: Create `src/lib/image-node-renderer.ts`** — the actual pipeline orchestration

Take the logic from `useAdjustmentPipeline.ts`, extract into a pure function `renderImageNodeComposite({ canvas, layerIds, opGraph, widgets, imageNodeId })`. The existing function feeds Fabric; the new one writes to a generic `HTMLCanvasElement`. Per-layer adjustments are filtered as today; node-scope widgets (added in T17–T19) get applied to the composite after the layers are blended.

Provide a unit test for the pure function with a mocked pipeline (similar to existing tests in the area). See the spec §5.1 for the order of operations.

- [ ] **Step 4: Update `ImageNodeBody.tsx`**

```tsx
import { useImageNodeRender } from '@/hooks/useImageNodeRender';

export function ImageNodeBody({ imageNodeId, layerIds, width, height }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height });
  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{ width, height, display: 'block' }}
    />
  );
}
```

- [ ] **Step 5: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useImageNodeRender.ts src/hooks/useImageNodeRender.test.ts src/lib/image-node-renderer.ts src/components/workspace/ImageNodeBody.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): useImageNodeRender — drive the WebGL composite per node

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Mask + segmentation overlays in ImageNodeBody

**Files:**
- Modify: `src/components/workspace/ImageNodeBody.tsx`
- Create: `src/components/workspace/ImageNodeSelectionPopover.tsx`
- Move logic from: `src/components/canvas/useFabricOverlays.ts`, `SelectionActionsOverlay.tsx`, `SegmentOverlay.tsx`

- [ ] **Step 1: Read the existing overlay code**

`useFabricOverlays.ts`, `SegmentOverlay.tsx`, `FullImageOutline.tsx`, `SelectionActionsOverlay.tsx`. Identify the canvas-2D drawing routines and the event hooks that update them. They currently draw onto Fabric objects; we need them to draw onto the per-node canvas.

- [ ] **Step 2: Refactor the drawing routines into pure functions**

Each routine becomes a `(ctx: CanvasRenderingContext2D, args) => void` painted on top of the composite render inside `image-node-renderer.ts`. Existing event hooks (which listened to mask store mutations) move into the `useImageNodeRender` effect dependency array.

- [ ] **Step 3: Create `ImageNodeSelectionPopover.tsx`** for the create-layer / discard-mask actions

Port the contents of `SelectionActionsOverlay.tsx`. Mount via Radix Popover anchored to the ImageNode header.

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS. Existing mask/segment tests should still pass against the new pure functions (they may need to import from the new module).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(workspace): mask + segment overlays render inside ImageNodeBody

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire ImageNode → real layers from the existing layer store

**Files:**
- Modify: `src/components/workspace/CanvasWorkspace.tsx`
- Modify: `src/components/workspace/ImageNode.tsx` (data shape)

- [ ] **Step 1: Auto-create an ImageNode for the current document on first mount**

In `CanvasWorkspace`, add a `useEffect` that — when `imageNodes` is empty AND `useEditorStore.getState().layers` has any layers — calls `addImageNode(layers.map((l) => l.id), { x: 100, y: 100 })` once.

```tsx
const layers = useEditorStore((s) => s.layers);
const addImageNode = useEditorStore((s) => s.addImageNode);
useEffect(() => {
  if (Object.keys(imageNodes).length === 0 && layers.length > 0) {
    addImageNode(layers.map((l) => l.id), { x: 100, y: 100 });
  }
}, [imageNodes, layers, addImageNode]);
```

- [ ] **Step 2: Manual sanity in dev**

Toggle `useWorkspaceCanvas` to true. Open an image. Confirm a single ImageNode appears with the composite render visible.

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): auto-create ImageNode for current document layers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: useWorkspaceSelection hook

**Files:**
- Create: `src/hooks/useWorkspaceSelection.ts`
- Test: `src/hooks/useWorkspaceSelection.test.tsx`

Selector hook reading `selectedNodeIds`, `selectedEdgeIds`, `activeImageNodeId`, `expandedWidgetIds`. Mirrors the pattern of the deleted `useHoveredWidget` / `useWidgetExpansion`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useEditorStore } from '@/store';

beforeEach(() => useEditorStore.getState().resetWorkspace());

describe('useWorkspaceSelection', () => {
  it('returns the activeImageNodeId after setSelection', () => {
    const { result } = renderHook(() => useWorkspaceSelection());
    act(() => {
      const id = useEditorStore.getState().addImageNode(['l-1']);
      useEditorStore.getState().setSelection([id], []);
    });
    expect(result.current.activeImageNodeId).not.toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { useEditorStore } from '@/store';

export function useWorkspaceSelection() {
  return {
    activeImageNodeId: useEditorStore((s) => s.activeImageNodeId),
    selectedNodeIds: useEditorStore((s) => s.selectedNodeIds),
    selectedEdgeIds: useEditorStore((s) => s.selectedEdgeIds),
    expandedWidgetIds: useEditorStore((s) => s.expandedWidgetIds),
    setSelection: useEditorStore((s) => s.setSelection),
    toggleExpanded: useEditorStore((s) => s.toggleExpanded),
  };
}
```

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add src/hooks/useWorkspaceSelection.ts src/hooks/useWorkspaceSelection.test.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): useWorkspaceSelection selector hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Toolrail click → spawn WidgetNode + tether

**Files:**
- Modify: each `src/tools/*-tool.tsx` (or wherever the toolrail click goes to `propose_widget`)
- Modify: `src/store/backend-state-slice.ts` (react to widget arrival via SSE; create a `widgetPositions` entry + a `TetherEdgeState` for fresh widgets)

- [ ] **Step 1: Pre-condition**

Read `src/tools/light-tool.tsx` (or the equivalent toolrail click handler) to see the current `propose_widget` payload.

- [ ] **Step 2: Add the disabled state when no active ImageNode**

When toolrail click fires and `useEditorStore.getState().activeImageNodeId === null`, abort with a toast (use the existing toast system if available, otherwise `console.warn`).

When a node is active: compute scope per spec §6.2 and call `propose_widget` with the right scope value.

- [ ] **Step 3: SSE handler — create tether for fresh widgets**

In `backend-state-slice`'s `widget.created` SSE event handler (find where new widgets are added to `snapshot.widgets`), additionally:
- If the widget's scope is `layer` → look up the ImageNode containing that layerId; create a TetherEdge.
- If the widget's scope is `image_node` → create a TetherEdge to the matching ImageNode.
- Compute a soft-auto widget position via `nextSpawnPositionFor(targetImageNode, 'widget', occupiedRects)`; write to `widgetPositions`.

- [ ] **Step 4: Run check + manual sanity**

```bash
npm run check
```
Toggle the flag, click Light on an active ImageNode → widget appears next to it, tether visible.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): toolrail click spawns WidgetNode tethered to active ImageNode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Suggestions ↗ engage → spawn WidgetNode + tether

**Files:**
- Modify: `src/components/inspector/SuggestionsSection.tsx`

Mirror Task 13's flow but for sidebar suggestions: clicking ↗ calls `addAcceptedSuggestion(widgetId)` (existing) AND creates a `TetherEdge` + a `widgetPositions[widgetId]` entry computed via `nextSpawnPositionFor`. The widget already exists in `snapshot.widgets` (it was an autonomous suggestion), so the SSE-create handler doesn't fire — the engage path needs to do the placement directly.

- [ ] **Step 1: Update `SuggestionsSection.tsx`**

After `addAcceptedSuggestion(widget.id)`, derive the active ImageNode + create the tether + write the widget position. If no active ImageNode, abort + toast.

- [ ] **Step 2: Run check + commit**

```bash
npm run check
git add src/components/inspector/SuggestionsSection.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): Suggestions ↗ engage spawns tethered WidgetNode on canvas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Workspace operations — split / merge / unbind edge / delete node

**Files:**
- Modify: `src/components/workspace/CanvasWorkspace.tsx` (key handlers)
- Modify: `src/components/workspace/ImageNode.tsx` (the corner affordance → context menu)

- [ ] **Step 1: Wire the corner affordance to a small menu**

Clicking the "split or merge" button opens a Radix DropdownMenu with `Split`, `Merge with selection`, `Rename`, `Delete`.

- [ ] **Step 2: Implement the four ops**

- `Split`: call `splitImageNode(id)` from the slice.
- `Merge`: if `selectedNodeIds.size > 1` (and they're all ImageNodes), call `mergeImageNodes([...selectedNodeIds])`. Otherwise show a tooltip "Select two or more image nodes to merge."
- `Rename`: inline edit on the header name (existing pattern).
- `Delete`: confirm dialog → remove from `imageNodes`; remove tether edges pointing to it; if the node was the document's only ImageNode, the user is left with an empty workspace.

- [ ] **Step 3: Wire `Delete` key**

Add a `keydown` handler on the React Flow container:
- `Delete` on a selected edge → `unbindEdge(edgeId)`.
- `Delete` on a selected widget node → `backendTools.delete_widget(sessionId, { widget_id, suppress_similar: false })`.
- `Delete` on a selected image node → trigger the confirm flow above.

- [ ] **Step 4: Run check + commit**

```bash
npm run check
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): split / merge / delete / unbind operations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Workspace ops into the history store

**Files:**
- Modify: `src/core/history.ts` (extend the history-entry kind union)
- Modify: `src/store/workspace-slice.ts` (push entries on each mutation)
- Tests: `src/core/history.test.ts` (extend)

- [ ] **Step 1: Read `src/core/history.ts`**

Identify the entry-kind union + the `push(entry)` API.

- [ ] **Step 2: Add new kinds**

```ts
type WorkspaceEntry =
  | { kind: 'workspace_move'; id: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'workspace_split'; oldId: string; layerIds: string[]; newIds: string[] }
  | { kind: 'workspace_merge'; oldIds: string[]; layerIdsByOldId: Record<string, string[]>; newId: string }
  | { kind: 'workspace_bind'; edgeId: string; widgetNodeId: string; targetImageNodeId: string; scope: TetherEdgeState['scope'] }
  | { kind: 'workspace_unbind'; edgeId: string; widgetNodeId: string; targetImageNodeId: string; scope: TetherEdgeState['scope'] }
  | { kind: 'widget_spawn'; widgetId: string; sessionId: string };
```

Provide `apply` / `revert` for each.

- [ ] **Step 3: Wire push() from `workspace-slice` mutations**

Each `addImageNode` / `splitImageNode` / etc. pushes an entry after mutating state.

- [ ] **Step 4: Tests**

Round-trip tests: split → undo → original node restored; merge → undo → originals restored; unbind → undo → edge re-bound.

- [ ] **Step 5: Run check + commit**

```bash
npm run check
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): integrate workspace ops with editorDocument.historyStore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Backend Scope extension + frontend mirror

**Files:**
- Modify: `backend/app/schemas/widget.py`
- Modify: `src/types/scope.ts`
- Tests: `backend/tests/schemas/test_scope.py`, `src/types/scope.test.ts`

- [ ] **Step 1: Read `backend/app/schemas/widget.py` (Scope union) and `src/types/scope.ts`**

- [ ] **Step 2: Add `ImageNodeScope` to backend union**

```python
class ImageNodeScope(BaseModel):
    kind: Literal["image_node"]
    image_node_id: str = Field(min_length=1)
    layer_ids: list[str] = Field(default_factory=list)

# extend the existing _ScopeAny union
_ScopeAny = Annotated[
    GlobalScope | NamedRegionScope | MaskScope | ImageNodeScope,
    Field(discriminator="kind"),
]
```

Mirror in `src/types/scope.ts`:
```ts
export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string }
  | { kind: 'image_node'; image_node_id: string; layer_ids: string[] };
```

Update any switch statements that exhaustively match `Scope.kind` (e.g. `scopeLabel` in `WidgetShellHeader`) to add the `'image_node'` case.

- [ ] **Step 3: Tests**

Python: a round-trip JSON validation test for the new variant.
TS: extend `src/types/scope.test.ts` with the new case.

- [ ] **Step 4: Run check + backend tests**

```bash
npm run check
cd backend && pytest && cd -
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): add ImageNodeScope variant (backend + frontend mirror)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Backend propose_widget + accept_widget for ImageNodeScope

**Files:**
- Modify: `backend/app/tools/atomic/propose_widget.py`
- Modify: `backend/app/tools/atomic/accept_widget.py`
- Tests: `backend/tests/tools/test_propose_widget_image_node.py` (NEW), `backend/tests/tools/test_accept_widget_image_node.py` (NEW)

- [ ] **Step 1: Read both tool handlers**

- [ ] **Step 2: propose_widget** — accept scope.kind === 'image_node' (no special logic; it just flows into the widget). Confirm existing fused-tool defaults handle the variant.

- [ ] **Step 3: accept_widget** — when materialising into `operation_graph`, the node-scope adjustment emits WidgetNode entries that carry `layer_ids: string[]` instead of a single `layer_id`. Document the new field in the Pydantic schema for `WidgetNode`:
```python
class WidgetNode(BaseModel):
    # existing fields...
    layer_ids: list[str] | None = None  # populated for node-scope adjustments
```

The frontend pipeline uses `layer_ids` (when present) to drive composite-then-apply.

- [ ] **Step 4: Tests**

Tests assert: proposing with `ImageNodeScope` succeeds; accepting materialises a `WidgetNode` with the `layer_ids` populated.

- [ ] **Step 5: Run check + backend tests + commit**

```bash
npm run check
cd backend && pytest && cd -
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): accept_widget materialises node-scope into layer_ids[]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Pipeline — composite-then-apply for node-scope

**Files:**
- Modify: `src/lib/pipeline-manager.ts` or `src/lib/image-node-renderer.ts`

Per the spec §5.1: for each widget tethered to a node with `scope.kind === 'image_node'`, after compositing the listed `layer_ids`, run the widget's shader pass against the composite output.

- [ ] **Step 1: Identify the materialised node shape**

After T18, an `operation_graph.nodes[].layer_ids: string[]` indicates a node-scope adjustment. The pipeline detects this and routes accordingly.

- [ ] **Step 2: Implement the composite-then-apply branch**

In `image-node-renderer.ts` (from T9): after per-layer adjustments are applied and the layers are blended into the composite, iterate the node-scope op-graph entries belonging to this ImageNode and run the corresponding shader pass against the composite framebuffer.

- [ ] **Step 3: Test**

Add a test that constructs a fixture op-graph with one node-scope entry, runs the renderer, and asserts the shader pass is invoked against the composite. Mock the shader pass or use a no-op shader and assert call ordering.

- [ ] **Step 4: Run check + commit**

```bash
npm run check
git add -A
git commit -m "$(cat <<'EOF'
feat(workspace): composite-then-apply pipeline for node-scope adjustments

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Flip the flag, delete Fabric + widget-shell dock

**Files:**
- Modify: `src/store/preferences-store.ts` (default `useWorkspaceCanvas: true`)
- Delete: see the file-touch map deletions in the header.

- [ ] **Step 1: Flip default**

Change `useWorkspaceCanvas: false` → `true` in the initial state. Existing persisted preferences will load the false value for returning users; on next save it flips. Optionally, bump the persist `version` to clear stale prefs.

- [ ] **Step 2: Confirm `EditorCanvas` path is unreachable**

After the flag is on by default, the Fabric branch in `App.tsx` is unreachable in fresh sessions. Verify by manual sanity (`npm run dev`).

- [ ] **Step 3: Delete the Fabric path + widget-shell dock**

```bash
git rm \
  src/components/canvas/EditorCanvas.tsx \
  src/components/canvas/useFabricOverlays.ts \
  src/components/canvas/useAdjustmentPipeline.ts \
  src/components/canvas/SelectionActionsOverlay.tsx \
  src/components/canvas/SegmentOverlay.tsx \
  src/components/canvas/FullImageOutline.tsx \
  src/components/widget/CanvasWidgetLayer.tsx \
  src/components/widget/AnchorTickLayer.tsx \
  src/components/widget/RegionHighlightLayer.tsx \
  src/components/widget/CursorBindGhost.tsx \
  src/hooks/useWidgetDockLayout.ts \
  src/hooks/useWidgetExpansion.ts \
  src/hooks/useHoveredWidget.ts \
  src/hooks/useDragOverride.ts \
  src/hooks/useCursorBind.ts
```

Plus matching `*.test.*` files.

Remove the conditional in `App.tsx`; mount `CanvasWorkspace` unconditionally.

Remove the flag entirely from preferences-store (it's served its purpose).

- [ ] **Step 4: Remove fabric**

```bash
npm uninstall fabric
```

Audit `grep -rn "fabric" src` and remove any straggling imports.

- [ ] **Step 5: Run check + manual sanity**

```bash
npm run check
npm run build
```
Expected: both PASS. Manual: open an image, perform spawn → tweak → bake → undo.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(workspace): delete Fabric + widget-shell dock; flag retired

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Docs — design.md + CLAUDE.md

**Files:**
- Modify: `design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `design.md`**

Replace §11 (Widget Shell) with §11 + §12:

§11 — **Canvas Workspace (React Flow)**: describe the infinite workspace, ImageNode anatomy, WidgetNode body, TetherEdge styles (solid/dashed), soft auto-layout rule, selection/keyboard semantics, sidebar = Suggestions only.

§12 — **Widget Shell (inside WidgetNode)**: the WidgetShell anatomy is unchanged from the prior project; it lives as the body of every WidgetNode. Cross-reference the existing WidgetShell description; the calculated dock and anchor tick are explicitly retired.

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the line under "Component Architecture (strict)" that mentions `CanvasWidgetLayer` with:
> **Canvas surface**: the editor canvas is a React Flow workspace (`src/components/workspace/CanvasWorkspace.tsx`). Image nodes render via the existing WebGL pipeline (`useImageNodeRender`); Widget nodes wrap `WidgetShell`. Tether edges carry attribution only — they have no DAG semantics.

- [ ] **Step 3: Grep gate**

```bash
grep -rn "CanvasWidgetLayer\|useWidgetDockLayout\|AnchorTickLayer\|RegionHighlightLayer\|useFabricOverlays\|EditorCanvas\|fabric" src design.md CLAUDE.md \
  | grep -v "design.md\|CLAUDE.md"
```
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add design.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(workspace): update design.md + CLAUDE.md for React Flow canvas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Final verification gate

- [ ] **Step 1: Grep gate**

```bash
grep -rn "CanvasWidgetLayer\|useWidgetDockLayout\|AnchorTickLayer\|RegionHighlightLayer\|useFabricOverlays\|useAdjustmentPipeline\|SelectionActionsOverlay\|SegmentOverlay\|FullImageOutline\|useCursorBind\|CursorBindGhost\|fabric" src
```
Expected: empty.

- [ ] **Step 2: Full check + build**

```bash
npm run check
npm run build
cd backend && pytest && cd -
```
All PASS.

- [ ] **Step 3: Manual browser pass (BOTH themes)**

`npm run dev` with backend on `127.0.0.1:8787`:
- App loads to a workspace with one ImageNode showing the current image.
- Toolrail click on Light → widget node appears tethered to right of the image.
- Drag widget → tether re-paths smoothly.
- Click Apply on a widget → strip vanishes, effect persists.
- Open a stacked node, split → two single-layer nodes.
- Select two → merge → one stacked node.
- Tether an adjustment to the stacked node as node-scope → composite re-renders.
- Click a tether edge, press Delete → unbinds (effect goes away, widget stays "Unbound").
- Undo / redo each operation.

- [ ] **Step 4: Report results**

Verification is the final task. No commit unless Step 3 surfaces a fix.

---

## Notes for the implementer

- **Keep every commit green.** The flag in T7–T8 lets every middle commit ship a working app; T20 flips and deletes only when the new path is fully wired.
- **Order matters.** Tasks 1–8 are foundations; 9–12 wire real rendering; 13–16 wire interactions + history; 17–19 do the backend extension; 20–22 close out.
- **Reuse aggressively.** `WidgetShell` and the 6 binding primitives are dropped in unchanged. `pipeline.ts`, `layer-compositor.ts`, and the shader catalog are reused via `useImageNodeRender`.
- **Backend SSoT preserved.** `operation_graph` stays the engine SSoT; the only new concept on the wire is `ImageNodeScope`, materialised into `WidgetNode.layer_ids[]`.
- **YAGNI gates:** decimation, multi-document tabs, minimap, persistence-to-edp, edge auto-routing — all out of scope for v1 per spec §11.
