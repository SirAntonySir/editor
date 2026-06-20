# Visibility-Driven Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LayerStrip toggle `Layer.visible` (instead of selecting a layer), gate the right sidebar on `activeImageNodeId !== null`, and make adjustment widgets broadcast live to every visible layer of their image-node via a `layerIds` array on the spawn payload + renderer filter change.

**Architecture:** Frontend-only refactor. The backend `WidgetNode` and operation-graph `Node` schemas already carry both `layerId: string` and `layerIds: string[] | null` / `layerIds?: string[]` (verified — no backend schema change). The three frontend spawn helpers will additionally pass `layerIds = imageNode.layerIds`. The two render-time layer filters (`src/lib/image-node-renderer.ts` and `src/lib/layer-compositor.ts`) will pick up nodes whose `layerIds` includes the current layer, in addition to nodes whose `layerId` equals it. Visibility is already gated at each render path; widgets broadcast through these gates live, no operation_graph mutation on toggle.

**Tech Stack:** React 19 + TypeScript strict, Zustand v5 + Immer, vitest, Radix UI (`@radix-ui/react-context-menu`), Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-17-visibility-driven-adjustments-design.md`

**Conventions:**
- All paths relative to repo root.
- After every commit run `npm run check`. If it fails, fix and amend the commit before moving on.
- Commit messages follow the existing `type(scope): summary` style.

---

## File Structure

### Modified files

| Path | What changes |
|---|---|
| `src/components/panels/RightSidebar.tsx` | Gate flips from `layers.length > 0` to `activeImageNodeId !== null`. |
| `src/components/workspace/drafting/LayerStrip.tsx` | Click toggles `visible`; right-click opens ContextMenu. |
| `src/components/inspector/adjustments/promote.ts` | `proposeStack` calls ship `layerIds = imageNode.layerIds`. |
| `src/lib/colour-band-spawn.ts` | Same — ships `layerIds`. |
| `src/tools/filters-tool.tsx` | Same — ships `layerIds`. |
| `src/lib/backend-tools.ts` | `proposeStack` arg type gains `layerIds?: string[]`. |
| `src/lib/image-node-renderer.ts` | Per-layer node filter accepts `n.layerIds?.includes(layerId)` as a match. |
| `src/lib/layer-compositor.ts` | Same filter change in `renderLayer`. |
| `src/lib/select-pipeline-nodes.ts` | If this file owns the filter helper, fold the change here so both call sites stay DRY. |

### New files

| Path | Responsibility |
|---|---|
| `src/components/workspace/drafting/LayerStrip.test.tsx` | Tests the click → toggle visibility and the right-click → context-menu items. |
| `src/components/panels/RightSidebar.test.tsx` | Tests the unmount/remount when `activeImageNodeId` changes. |
| `src/lib/select-pipeline-nodes.test.ts` | Already exists. Extend with `layerIds` matching tests if not already covered. |

---

## Phase 1 — Sidebar Gate

### Task 1.1: Flip the sidebar gate

**Files:**
- Modify: `src/components/panels/RightSidebar.tsx`
- Create: `src/components/panels/RightSidebar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/panels/RightSidebar.test.tsx
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { RightSidebar } from './RightSidebar';

describe('RightSidebar — gate on activeImageNodeId', () => {
  beforeEach(() => {
    useEditorStore.setState({
      imageNodes: {},
      activeImageNodeId: null,
      layers: [],
    });
  });

  it('unmounts when activeImageNodeId is null, even when layers exist', () => {
    useEditorStore.setState({
      layers: [{ id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }],
      activeImageNodeId: null,
    });
    const { container } = render(<RightSidebar />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts when activeImageNodeId is non-null', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': { id: 'in-1', layerIds: ['L1'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
      },
      layers: [{ id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }],
      activeImageNodeId: 'in-1',
    });
    const { container } = render(<RightSidebar />);
    expect(container.firstChild).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failing**

Run: `npm test -- --run src/components/panels/RightSidebar.test.tsx`
Expected: FAIL — first test passes (no image, no layer renders nothing) BUT the gate today is `layers.length > 0` so the test that asserts "unmounts when activeImageNodeId is null even when layers exist" FAILS because the sidebar renders.

- [ ] **Step 3: Implement**

In `src/components/panels/RightSidebar.tsx`:

Replace line 18:
```ts
const hasImage = useEditorStore((s) => s.layers.length > 0);
```
with:
```ts
const hasImageNodeSelected = useEditorStore((s) => s.activeImageNodeId !== null);
```

And line 20:
```ts
if (!hasImage) return null;
```
becomes:
```ts
if (!hasImageNodeSelected) return null;
```

Update the docstring at the top of the file to reflect the new gate ("…drop the whole sidebar while no image-node is selected.").

- [ ] **Step 4: Run to verify passing**

Run: `npm test -- --run src/components/panels/RightSidebar.test.tsx` → PASS.
Run: `npm test -- --run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/RightSidebar.tsx src/components/panels/RightSidebar.test.tsx
git commit -m "feat(sidebar): gate right sidebar on activeImageNodeId, not layer count"
```

Run `npm run check` — must be green.

---

## Phase 2 — LayerStrip Role Flip

Click toggles `Layer.visible`; right-click opens a context menu (Rename / Blend / Lock / Delete).

### Task 2.1: Click → toggle visibility

**Files:**
- Modify: `src/components/workspace/drafting/LayerStrip.tsx`
- Create: `src/components/workspace/drafting/LayerStrip.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/workspace/drafting/LayerStrip.test.tsx
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { LayerStrip } from './LayerStrip';

const SEED_NODE = {
  id: 'in-1',
  layerIds: ['L1', 'L2'],
  position: { x: 0, y: 0 },
  size: { w: 100, h: 100 },
  sourceSize: { w: 100, h: 100 },
};

const SEED_LAYERS = [
  { id: 'L1', type: 'image' as const, name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 0 },
  { id: 'L2', type: 'brush' as const, name: 'paint',     visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 1 },
];

describe('LayerStrip — click toggles visibility', () => {
  beforeEach(() => {
    useEditorStore.setState({
      imageNodes: { 'in-1': SEED_NODE },
      layers: SEED_LAYERS,
      activeImageNodeId: 'in-1',
      activeLayerId: null,
    });
  });

  it('clicking a visible sheet flips visible to false', () => {
    const { getAllByRole } = render(<LayerStrip imageNodeId="in-1" />);
    const sheets = getAllByRole('button');
    fireEvent.click(sheets[0]); // top-most sheet in column-reverse = L2
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L2');
    expect(after?.visible).toBe(false);
  });

  it('clicking a hidden sheet flips visible to true', () => {
    useEditorStore.setState({
      layers: SEED_LAYERS.map((l) => l.id === 'L1' ? { ...l, visible: false } : l),
    });
    const { getAllByRole } = render(<LayerStrip imageNodeId="in-1" />);
    const sheets = getAllByRole('button');
    fireEvent.click(sheets[1]); // L1
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L1');
    expect(after?.visible).toBe(true);
  });

  it('does not touch activeLayerId', () => {
    const { getAllByRole } = render(<LayerStrip imageNodeId="in-1" />);
    fireEvent.click(getAllByRole('button')[0]);
    expect(useEditorStore.getState().activeLayerId).toBeNull();
  });
});
```

Adjust the `imageNodeId` prop name to match what `LayerStrip` accepts. (Read the file's existing props before writing.)

- [ ] **Step 2: Run to verify failing**

Run: `npm test -- --run src/components/workspace/drafting/LayerStrip.test.tsx`
Expected: FAIL — clicks set `activeLayerId` instead of toggling `visible`.

- [ ] **Step 3: Implement**

In `src/components/workspace/drafting/LayerStrip.tsx`:

- Remove the `setActiveLayer` selector at line 23.
- Read `updateLayer` instead:

```ts
const updateLayer = useEditorStore((s) => s.updateLayer);
```

- Replace the click handler around line 49:

```tsx
onClick={(e) => {
  e.stopPropagation();
  updateLayer(layer.id, { visible: !layer.visible });
}}
```

- Update the sheet visual to render hidden-state styling when `!layer.visible`. The strip already uses ochre when active; switch the rule to "ochre when visible, hairline-outline only when hidden". Concretely: change the `className` that previously read "active vs inactive" to "visible vs hidden". Example:

```tsx
className={[
  'layer-sheet …',
  layer.visible ? 'bg-ochre' : 'bg-transparent border-hairline',
].join(' ')}
```

Use whatever the file's existing token classes are — match by reading the current source. The intent: visible = filled ochre, hidden = empty outline.

- Add `aria-pressed={layer.visible}` to the button for accessibility.

- [ ] **Step 4: Run to verify passing**

Run: `npm test -- --run src/components/workspace/drafting/LayerStrip.test.tsx` → PASS.
Run: `npm test -- --run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/drafting/LayerStrip.tsx src/components/workspace/drafting/LayerStrip.test.tsx
git commit -m "feat(layer-strip): click toggles visibility instead of selecting"
```

### Task 2.2: Right-click → ContextMenu (Rename / Blend / Lock / Delete)

**Files:**
- Modify: `src/components/workspace/drafting/LayerStrip.tsx`
- Modify: `src/components/workspace/drafting/LayerStrip.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';

describe('LayerStrip — right-click context menu', () => {
  beforeEach(() => {
    useEditorStore.setState({
      imageNodes: { 'in-1': SEED_NODE },
      layers: SEED_LAYERS,
      activeImageNodeId: 'in-1',
    });
  });

  it('right-click opens a menu with Rename / Blend / Lock / Delete', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="in-1" />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    expect(await findByText(/rename/i)).toBeInTheDocument();
    expect(await findByText(/blend/i)).toBeInTheDocument();
    expect(await findByText(/lock/i)).toBeInTheDocument();
    expect(await findByText(/delete/i)).toBeInTheDocument();
  });

  it('Lock toggles layer.locked', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="in-1" />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    fireEvent.click(await findByText(/lock/i));
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L2');
    expect(after?.locked).toBe(true);
  });

  it('Delete removes the layer', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="in-1" />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    fireEvent.click(await findByText(/delete/i));
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failing**

Run: `npm test -- --run src/components/workspace/drafting/LayerStrip.test.tsx`
Expected: FAIL — no menu opens; `findByText` rejects.

- [ ] **Step 3: Implement**

In `src/components/workspace/drafting/LayerStrip.tsx`, wrap each sheet's button in a `ContextMenu`. Mirror the pattern in `src/components/workspace/ImageNodeObjectsLayer.tsx` (Radix `@radix-ui/react-context-menu` with `Portal`).

Add imports:

```tsx
import * as ContextMenu from '@radix-ui/react-context-menu';
```

Inside the per-layer render, wrap the existing `<button>`:

```tsx
<ContextMenu.Root key={layer.id}>
  <ContextMenu.Trigger asChild>
    <button
      type="button"
      aria-pressed={layer.visible}
      onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
      className={…}
    >
      {/* existing sheet content */}
    </button>
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content className="z-50 min-w-[140px] rounded-[var(--radius-overlay)] border border-separator bg-surface shadow-overlay text-sm">
      <ContextMenu.Item
        className="px-3 py-1.5 cursor-pointer hover:bg-surface-secondary outline-none"
        onSelect={() => useEditorStore.getState().setActiveLayer(layer.id) /* expand in Layer tab to rename inline */}
      >
        Rename
      </ContextMenu.Item>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="px-3 py-1.5 cursor-pointer hover:bg-surface-secondary outline-none">Blend mode</ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="z-50 min-w-[120px] rounded-[var(--radius-overlay)] border border-separator bg-surface shadow-overlay text-sm">
            {(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light'] as const).map((mode) => (
              <ContextMenu.Item
                key={mode}
                className="px-3 py-1.5 cursor-pointer hover:bg-surface-secondary outline-none"
                onSelect={() => updateLayer(layer.id, { blendMode: mode })}
              >
                {mode}
              </ContextMenu.Item>
            ))}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Item
        className="px-3 py-1.5 cursor-pointer hover:bg-surface-secondary outline-none"
        onSelect={() => updateLayer(layer.id, { locked: !layer.locked })}
      >
        {layer.locked ? 'Unlock' : 'Lock'}
      </ContextMenu.Item>
      <ContextMenu.Separator className="h-px bg-separator my-1" />
      <ContextMenu.Item
        className="px-3 py-1.5 cursor-pointer hover:bg-surface-secondary outline-none text-text-secondary"
        onSelect={() => useEditorStore.getState().removeLayer(layer.id)}
      >
        Delete
      </ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
```

If `--radius-overlay`, `shadow-overlay` etc don't exist as tokens, use whatever classes the existing `ImageNodeObjectsLayer.tsx` uses for its ContextMenu (mirror those exactly). Read that file first.

The Rename action sets the active layer; the user finishes the rename in the Layer tab (which has the existing inline-rename UI). That keeps the menu small and lets the existing renaming code carry the load.

- [ ] **Step 4: Run to verify passing**

Run: `npm test -- --run src/components/workspace/drafting/LayerStrip.test.tsx` → PASS.
Run: `npm test -- --run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/drafting/LayerStrip.tsx src/components/workspace/drafting/LayerStrip.test.tsx
git commit -m "feat(layer-strip): right-click opens layer context menu"
```

---

## Phase 3 — Spawn Paths Ship `layerIds`

### Task 3.1: Extend `proposeStack` arg type

**Files:**
- Modify: `src/lib/backend-tools.ts`

- [ ] **Step 1: Edit the type**

Find the `proposeStack` signature (around line 125–138). Add `layerIds?: string[]` next to `layerId?: string`:

```ts
proposeStack(sessionId: string, args: {
  intent: string;
  scope: Scope;
  origin: 'mcp_user_prompt' | 'mcp_autonomous' | 'tool_invoked';
  forced_ops?: string[];
  forced_params?: Record<string, Record<string, number | string | boolean>>;
  preset_id?: string;
  prompt?: string;
  layerId?: string;
  layerIds?: string[];
}) {
  return invokeTool<{ widgets: Widget[] }>('propose_stack', sessionId, args);
}
```

- [ ] **Step 2: Verify**

Run: `npm run check` → green (no consumer changes yet).
Run: `npm test -- --run` → green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/backend-tools.ts
git commit -m "feat(backend-tools): proposeStack accepts optional layerIds"
```

### Task 3.2: `promote.ts` ships `layerIds`

**Files:**
- Modify: `src/components/inspector/adjustments/promote.ts`
- Modify: `src/components/inspector/adjustments/promote.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `promote.test.ts` (use the file's existing mock pattern):

```ts
it('ships layerIds derived from the active image-node', () => {
  useEditorStore.setState({
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
    },
    activeImageNodeId: 'in-1',
  });
  promoteToCanvas('S1', 'curves', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    layerId: 'L1',
    layerIds: ['L1', 'L2'],
  }));
});

it('ships layerIds = undefined when no active image-node', () => {
  useEditorStore.setState({ activeImageNodeId: null });
  promoteToCanvas('S1', 'curves', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    layerId: 'L1',
  }));
  const call = vi.mocked(backendTools.proposeStack).mock.calls.at(-1)?.[1];
  expect(call?.layerIds).toBeUndefined();
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/components/inspector/adjustments/promote.test.ts`
Expected: FAIL — `layerIds` is not in the call args.

- [ ] **Step 3: Implement**

In `src/components/inspector/adjustments/promote.ts`, add a helper at the top of the file (after imports):

```ts
function activeNodeLayerIds(): string[] | undefined {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) return undefined;
  return editor.imageNodes[id]?.layerIds;
}
```

Use it in both functions:

```ts
export function promoteToCanvas(sessionId: string | null, toolId: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: toolId,
    scope,
    forced_ops: [toolId],
    layerId,
    ...(layerIds ? { layerIds } : {}),
    origin: 'tool_invoked',
  });
}

export function promoteSingleParamToCanvas(
  sessionId: string | null,
  toolId: string,
  opAdjustmentType: string,
  layerId: string | null,
  paramKey: string,
): void {
  if (!sessionId || !layerId) return;
  useEditorStore.getState().queuePinRequest(layerId, opAdjustmentType, [paramKey]);
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: `${toolId}:${paramKey}`,
    scope,
    forced_ops: [toolId],
    layerId,
    ...(layerIds ? { layerIds } : {}),
    origin: 'tool_invoked',
  });
}
```

- [ ] **Step 4: Pass**

Run: `npm test -- --run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/adjustments/promote.ts src/components/inspector/adjustments/promote.test.ts
git commit -m "feat(promote): ship layerIds from active image-node for broadcast"
```

### Task 3.3: `colour-band-spawn.ts` ships `layerIds`

**Files:**
- Modify: `src/lib/colour-band-spawn.ts`
- Modify: `src/lib/colour-band-spawn.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `colour-band-spawn.test.ts` (match the existing mock pattern):

```ts
it('ships layerIds derived from the active image-node', () => {
  useEditorStore.setState({
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
    },
    activeImageNodeId: 'in-1',
  });
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    layerId: 'L1',
    layerIds: ['L1', 'L2'],
  }));
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/lib/colour-band-spawn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/lib/colour-band-spawn.ts`, mirror the helper used in promote.ts (or import it if you extract it to a shared place — for now copy is fine, it's three lines):

```ts
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { scopeFromSelection } from '@/lib/scope-from-selection';

function activeNodeLayerIds(): string[] | undefined {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) return undefined;
  return editor.imageNodes[id]?.layerIds;
}

export function promoteSingleBand(sessionId: string | null, band: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: `HSL ${band}`,
    scope,
    preset_id: `tone_${band}`,
    layerId,
    ...(layerIds ? { layerIds } : {}),
    origin: 'tool_invoked',
  });
}
```

- [ ] **Step 4: Pass + commit**

Run: `npm test -- --run` → green.

```bash
git add src/lib/colour-band-spawn.ts src/lib/colour-band-spawn.test.ts
git commit -m "feat(colour-band-spawn): ship layerIds from active image-node"
```

### Task 3.4: `filters-tool.tsx` ships `layerIds`

**Files:**
- Modify: `src/tools/filters-tool.tsx`

- [ ] **Step 1: Implement directly**

(`filters-tool` has no existing unit test file; the helper is exercised through other paths. Adding a test for one function call ships disproportionate test infra, so we make the change and rely on `npm run check`.)

Around line 75–89 (the `proposeStack` call), thread `layerIds` through. Add the helper at the top of the file:

```ts
function activeNodeLayerIds(): string[] | undefined {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) return undefined;
  return editor.imageNodes[id]?.layerIds;
}
```

Update the call site:

```tsx
const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
const layerIds = activeNodeLayerIds();
void backendTools.proposeStack(sid, {
  intent: `Apply ${lut.title} filter`,
  scope,
  forced_ops: ['filter'],
  layerId: activeLayerId,
  ...(layerIds ? { layerIds } : {}),
  origin: 'tool_invoked',
});
```

- [ ] **Step 2: Verify + commit**

Run: `npm run check && npm test -- --run` → green.

```bash
git add src/tools/filters-tool.tsx
git commit -m "feat(filters-tool): ship layerIds from active image-node"
```

---

## Phase 4 — Renderer Per-Visible-Layer

The renderer's per-layer filter today is `n.layerId === layerId`. We extend it to also match when `n.layerIds?.includes(layerId)`. Two filter sites: `src/lib/image-node-renderer.ts` (around line 215–220) and `src/lib/layer-compositor.ts` (around line 78). If `selectPipelineNodes` in `src/lib/select-pipeline-nodes.ts` is the common helper, fold the change there.

### Task 4.1: Extract / extend the per-layer filter helper

**Files:**
- Modify: `src/lib/select-pipeline-nodes.ts`
- Modify: `src/lib/select-pipeline-nodes.test.ts`

- [ ] **Step 1: Read existing code**

Read `src/lib/select-pipeline-nodes.ts` and `src/lib/select-pipeline-nodes.test.ts`. Look for:
- A helper like `selectPipelineNodes()` returning the ordered ops to apply on a given layer.
- A predicate like `n.layerId === layerId` somewhere in the chain.

If a single helper owns this filter, modify it there. If both `image-node-renderer.ts` and `layer-compositor.ts` inline their own filter, decide whether to extract to this file or update both call sites. Prefer extraction for DRY.

- [ ] **Step 2: Write failing test**

Append to `src/lib/select-pipeline-nodes.test.ts` (or create a new test for the predicate if extracted):

```ts
it('matches a node when n.layerIds includes the target layer', () => {
  const nodes = [
    { id: 'n1', type: 'curves', layerId: 'L1', layerIds: undefined, params: {}, scope: { kind: 'global' as const }, inputs: [] },
    { id: 'n2', type: 'curves', layerId: 'someAnchor', layerIds: ['L1', 'L2'], params: {}, scope: { kind: 'global' as const }, inputs: [] },
    { id: 'n3', type: 'curves', layerId: 'L3', layerIds: undefined, params: {}, scope: { kind: 'global' as const }, inputs: [] },
  ];
  expect(selectPipelineNodes(nodes, 'L1').map((n) => n.id)).toEqual(['n1', 'n2']);
  expect(selectPipelineNodes(nodes, 'L2').map((n) => n.id)).toEqual(['n2']);
  expect(selectPipelineNodes(nodes, 'L3').map((n) => n.id)).toEqual(['n3']);
});
```

Adjust call shape to whatever the actual exported function looks like. The point: a node with `layerIds: ['L1', 'L2']` should match for both `L1` and `L2`.

- [ ] **Step 3: Run failing**

Run: `npm test -- --run src/lib/select-pipeline-nodes.test.ts`
Expected: FAIL — the broadcast node isn't matched for the secondary layer.

- [ ] **Step 4: Implement**

In `src/lib/select-pipeline-nodes.ts`, find the predicate and extend it:

```ts
// before
const matches = (n: OpNode) => n.layerId === targetLayerId;

// after
const matches = (n: OpNode) =>
  n.layerId === targetLayerId
  || (Array.isArray(n.layerIds) && n.layerIds.includes(targetLayerId));
```

Preserve the rest of the chain (filtering on `hiddenNodeIds`, `type !== 'crop'`, etc.).

If the file doesn't currently export the predicate, that's fine — the inline change above stays internal.

- [ ] **Step 5: Pass**

Run: `npm test -- --run` → green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/select-pipeline-nodes.ts src/lib/select-pipeline-nodes.test.ts
git commit -m "feat(pipeline): match broadcast widgets via layerIds in per-layer filter"
```

### Task 4.2: Update inline filters in `image-node-renderer` and `layer-compositor`

This task is only needed if Task 4.1 did NOT cover both call sites by routing through `selectPipelineNodes`. If `image-node-renderer.ts` or `layer-compositor.ts` still has its own inline `nodes.filter((n) => n.layerId === layerId && …)`, update each one.

**Files:**
- Modify: `src/lib/image-node-renderer.ts` (if applicable)
- Modify: `src/lib/layer-compositor.ts` (if applicable)

- [ ] **Step 1: Audit**

Run:

```
git grep -nE 'layerId === |\.layerId ==' src/lib
```

Each match is a candidate. For each, decide:
- If it's filtering pipeline nodes per layer, update the predicate to include the `layerIds.includes` branch.
- If it's something else (e.g. identifying the active layer), leave it.

- [ ] **Step 2: Apply changes**

For each inline filter, replace:

```ts
nodes.filter((n) => n.layerId === layerId && …)
```

with:

```ts
nodes.filter((n) =>
  (n.layerId === layerId || (Array.isArray(n.layerIds) && n.layerIds.includes(layerId)))
  && …
)
```

Preserve every existing condition in the trailing `&& …` (`!hiddenNodeIds.has(n.id)`, `n.type !== 'crop'`, etc.). The only change is the layer-id match.

- [ ] **Step 3: Verify**

Run: `npm run check && npm test -- --run` → green.

If a render-related test exists (e.g. `image-node-renderer.test.ts`), it should now also pass the broadcast scenario implicitly. Add one focused test if not covered:

```ts
it('picks up a broadcast op for every visible layer of its node', () => {
  // Use whatever test seam image-node-renderer offers — at minimum, assert
  // selectPipelineNodes returns the broadcast node for each layer of the node.
});
```

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "feat(renderer): inline filters honor broadcast layerIds"
```

### Task 4.3: Update the Adjustments tab header copy

The spec calls for the binding header to drop the " on \<layer\>" suffix (because the widget broadcasts).

**Files:**
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.tsx`
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx`

- [ ] **Step 1: Adjust the test**

In the existing `binding header` describe block, replace the assertion that includes the layer-name suffix with one that asserts only the object name (or "Whole image"):

```ts
it('shows just "Whole image" when no object is selected, no layer suffix', () => {
  useEditorStore.setState({ activeObjectId: null, activeLayerId: 'L1' });
  const { getByText, queryByText } = render(<AdjustmentsAccordion />);
  expect(getByText('Whole image')).toBeInTheDocument();
  expect(queryByText(/ on /i)).toBeNull(); // no "on photo.jpg"
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx`
Expected: FAIL — the existing header includes " on \<layer\>".

- [ ] **Step 3: Implement**

In `AdjustmentsAccordion.tsx`, find the header. Remove the layer suffix:

```tsx
// Before
Targets: <span className="text-text-primary">{objectName}</span>
{activeLayer && <> on <span className="text-text-primary">{activeLayer.name}</span></>}

// After
Targets: <span className="text-text-primary">{objectName}</span>
```

Drop the unused `activeLayer` selector if it's no longer read elsewhere in the file.

- [ ] **Step 4: Pass + commit**

Run: `npm run check && npm test -- --run` → green.

```bash
git add src/components/inspector/adjustments/AdjustmentsAccordion.tsx src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx
git commit -m "fix(inspector): drop 'on <layer>' suffix from Adjustments header"
```

---

## Final Verification

- [ ] **Step 1: Full check + tests**

```bash
npm run check && npm test -- --run
```

Both green.

- [ ] **Step 2: Manual flow**

1. Click blank canvas → right sidebar disappears. Click an image → sidebar reappears.
2. On an image with multiple layers (e.g. photo + a brush layer), click a sheet on the LayerStrip → the layer composite hides/shows; `activeLayerId` is unchanged.
3. Right-click a sheet → menu shows Rename / Blend / Lock / Delete. Pick "Lock" → the layer's `locked` flips (verify via the Layer tab's row icon).
4. Spawn a Light widget (Cmd+K or toolrail) → backend snapshot shows the widget with `layerIds` populated. Drag the Exposure slider → effect appears on every visible layer.
5. Hide one layer on the strip → that layer's contribution drops out of the composite, and the widget's effect drops out of it specifically; other layers still show the effect. Show it again → effect returns.
6. Adjustments tab header reads `Targets: Whole image` or `Targets: <object name>` — no " on \<layer\>".

- [ ] **Step 3: Update CLAUDE.md if needed**

Skim the project `CLAUDE.md` for any line that describes the LayerStrip as "active layer selector" or the sidebar gating as "any layer exists." Update the line. The Engine SSoT Doctrine table doesn't need changes (selection slice fields are unchanged).

```bash
git add CLAUDE.md
git commit -m "docs(claude): update LayerStrip + sidebar notes for visibility-driven model"
```

---

## Out of Scope (reminder from spec)

- Per-widget "single-layer pin" UI. Solo-then-spawn is the escape hatch.
- Backfilling old single-layer widgets to broadcast.
- Visibility animation polish on the strip.
- Cmd/Shift+click "solo" gesture.
- Layer-mask UI in the Layer tab.
