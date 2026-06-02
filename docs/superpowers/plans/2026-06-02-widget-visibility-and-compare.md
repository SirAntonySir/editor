# Widget Visibility Toggle + ImageNode Before/After Compare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two canvas affordances: an eye-icon toggle on each widget shell that hides its render contribution, and a press-and-hold compare button on each ImageNode that temporarily reveals the unedited composite.

**Architecture:** Both features are frontend-only. Widget visibility lives in `tool-slice` as `hiddenWidgetIds: Set<string>`. The image-node renderer accepts two new args — `hiddenNodeIds: Set<string>` (filters out adjustment nodes that belong to hidden widgets) and `bypassAdjustments: boolean` (short-circuits the per-layer WebGL pass and skips the composite-then-apply pass entirely, blitting source bitmaps with blend modes only). No backend changes.

**Tech Stack:** React 19 + TypeScript strict, Zustand v5 + Immer slices, Vitest + @testing-library/react, Lucide React (named imports), React Flow (`@xyflow/react`).

**Spec:** `docs/superpowers/specs/2026-06-02-widget-visibility-and-compare-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/store/tool-slice.ts` | Modify | Add `hiddenWidgetIds: Set<string>` + `toggleWidgetHidden(id)` |
| `src/store/tool-slice.test.ts` | Modify | Coverage for the new toggle |
| `src/lib/image-node-renderer.ts` | Modify | Accept `hiddenNodeIds`, `bypassAdjustments`; filter passes; short-circuit shader path |
| `src/lib/image-node-renderer.test.tsx` | Modify | Tests for `hiddenNodeIds` filter and `bypassAdjustments` skip |
| `src/hooks/useImageNodeRender.ts` | Modify | Accept `bypassAdjustments` prop; subscribe to `hiddenWidgetIds`; derive `hiddenNodeIds` from widgets; thread both into the renderer |
| `src/components/widget/WidgetShellHeader.tsx` | Modify | Render `Eye`/`EyeOff` button (right of scope chip, before chevron); remove dirty-dot |
| `src/components/widget/WidgetShellHeader.test.tsx` | Modify | Eye click stops propagation; aria-label flips; dirty-dot gone |
| `src/components/widget/WidgetShell.tsx` | Modify | Subscribe to `hiddenWidgetIds`; pass `hidden` to header; apply `opacity-60` to shell root |
| `src/components/widget/WidgetShell.test.tsx` | Modify | Shell root has `opacity-60` when widget id is in `hiddenWidgetIds` |
| `src/components/workspace/ImageNodeBody.tsx` | Modify | Accept `bypassAdjustments` prop; forward to `useImageNodeRender` |
| `src/components/workspace/ImageNode.tsx` | Modify | Inline `Eye` button in top header strip (between title and badge); local `compareHeld` state; pointer handlers |
| `src/components/workspace/ImageNode.test.tsx` | Modify | pointerdown sets `bypassAdjustments` true, pointerup/leave clears; selection popover does not open |

---

## Task 1 — `hiddenWidgetIds` state + toggle on tool-slice

**Files:**
- Modify: `src/store/tool-slice.ts`
- Test: `src/store/tool-slice.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/tool-slice.test.ts` inside the existing `describe` block:

```ts
  it('toggleWidgetHidden adds then removes a widget id in hiddenWidgetIds', () => {
    const s = useEditorStore.getState();
    expect(s.hiddenWidgetIds.has('w-1')).toBe(false);
    s.toggleWidgetHidden('w-1');
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-1')).toBe(true);
    s.toggleWidgetHidden('w-1');
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-1')).toBe(false);
  });

  it('toggleWidgetHidden is independent per id', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetHidden('w-1');
    s.toggleWidgetHidden('w-2');
    const ids = useEditorStore.getState().hiddenWidgetIds;
    expect(ids.has('w-1')).toBe(true);
    expect(ids.has('w-2')).toBe(true);
  });
```

Also add a cleanup line in the existing `beforeEach`:

```ts
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.collapseAllWidgets();
    s.setHoveredWidget(null);
    // Clear hidden ids between tests so order-independence holds.
    for (const id of Array.from(s.hiddenWidgetIds)) s.toggleWidgetHidden(id);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/tool-slice.test.ts`
Expected: FAIL with errors referencing `hiddenWidgetIds` or `toggleWidgetHidden` undefined.

- [ ] **Step 3: Implement on the slice**

Edit `src/store/tool-slice.ts`. Inside the `ToolSlice` interface, add the field and action (place near the other widget-related fields):

```ts
  hiddenWidgetIds: Set<string>;
  toggleWidgetHidden: (widgetId: string) => void;
```

Inside the `createToolSlice` factory, add the initial value with the other initial sets:

```ts
  hiddenWidgetIds: new Set<string>(),
```

And add the action implementation (mirror the shape of `toggleWidgetExpanded`):

```ts
  toggleWidgetHidden: (widgetId) =>
    set((state) => {
      if (state.hiddenWidgetIds.has(widgetId)) {
        state.hiddenWidgetIds.delete(widgetId);
      } else {
        state.hiddenWidgetIds.add(widgetId);
      }
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/tool-slice.test.ts`
Expected: PASS, both new tests green, existing tests still green.

- [ ] **Step 5: Type/lint check the slice**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/tool-slice.ts src/store/tool-slice.test.ts
git commit -m "feat(tool-slice): add hiddenWidgetIds + toggleWidgetHidden"
```

---

## Task 2 — Renderer accepts `hiddenNodeIds` and filters both passes

**Files:**
- Modify: `src/lib/image-node-renderer.ts`
- Test: `src/lib/image-node-renderer.test.tsx`

- [ ] **Step 1: Write the failing test**

Append a new `it` inside the existing `describe('renderImageNodeComposite', …)` block in `src/lib/image-node-renderer.test.tsx`:

```ts
  it('skips adjustment nodes whose ids are in hiddenNodeIds', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-keep',
            type: 'basic',
            params: { exposure: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layer_id: 'L1',
          },
          {
            id: 'n-hide',
            type: 'basic',
            params: { contrast: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layer_id: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      hiddenNodeIds: new Set(['n-hide']),
    });

    expect(pipelineRenderSync).toHaveBeenCalledTimes(1);
    const adjustments = pipelineRenderSync.mock.calls[0][0] as unknown as { id: string }[];
    expect(adjustments.map((a) => a.id)).toEqual(['n-keep']);
  });

  it('hiddenNodeIds also filters node-scope (composite-then-apply) nodes', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-composite-hidden',
            type: 'basic',
            params: { exposure: 0.25 },
            scope: { kind: 'global' },
            inputs: [],
            layer_ids: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      hiddenNodeIds: new Set(['n-composite-hidden']),
    });

    // No per-layer nodes and the only node-scope node is hidden ⇒ no shader pass.
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx`
Expected: FAIL — first failure is a TS error on the unrecognised `hiddenNodeIds` arg, then runtime assertion failures.

- [ ] **Step 3: Implement the renderer change**

In `src/lib/image-node-renderer.ts`, extend `RenderImageNodeCompositeArgs`:

```ts
  /**
   * Adjustment-node ids to omit from both the per-layer pass and the
   * composite-then-apply pass. Used by widget visibility — when a widget is
   * hidden, all of its `widget.nodes[].id` go in this set.
   */
  hiddenNodeIds?: Set<string>;
```

Inside `renderImageNodeComposite`, destructure the new arg with a default empty Set and apply it to both filters. The relevant section becomes:

```ts
export function renderImageNodeComposite(args: RenderImageNodeCompositeArgs): void {
  const { canvas, layerIds, opGraph, widgets, optimistic } = args;
  const hiddenNodeIds = args.hiddenNodeIds ?? new Set<string>();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (layerIds.length === 0) return;

  const allLayers = useEditorStore.getState().layers;
  const layersById = new Map(allLayers.map((l) => [l.id, l] as const));
  const nodes = opGraph?.nodes ?? [];

  for (const layerId of layerIds) {
    const layer = layersById.get(layerId);
    if (!layer || !layer.visible) continue;

    const source = CanvasRegistry.get(layerId);
    if (!source) continue;

    const layerNodes = nodes.filter(
      (n) => n.layer_id === layerId && !hiddenNodeIds.has(n.id),
    );
```

And the node-scope filter immediately below it:

```ts
  const layerSetForComposite = new Set(layerIds);
  const nodeScopeNodes = nodes.filter((n) => {
    if (hiddenNodeIds.has(n.id)) return false;
    const ids = n.layer_ids;
    return Array.isArray(ids) && ids.length > 0 && ids.every((lid) => layerSetForComposite.has(lid));
  });
```

Leave everything else (overlay pass, composite-then-apply call structure) unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx`
Expected: PASS — both new cases plus all existing ones.

- [ ] **Step 5: Type/lint check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/image-node-renderer.ts src/lib/image-node-renderer.test.tsx
git commit -m "feat(renderer): filter adjustment nodes by hiddenNodeIds"
```

---

## Task 3 — Renderer accepts `bypassAdjustments` and short-circuits the shader path

**Files:**
- Modify: `src/lib/image-node-renderer.ts`
- Test: `src/lib/image-node-renderer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append two more `it` cases inside the existing `describe('renderImageNodeComposite', …)` block in `src/lib/image-node-renderer.test.tsx`:

```ts
  it('bypassAdjustments=true skips the WebGL pipeline entirely', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context from jsdom');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n1',
            type: 'basic',
            params: { exposure: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layer_id: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      bypassAdjustments: true,
    });

    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
    // Source bitmap is still painted onto the target canvas.
    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('bypassAdjustments=true skips the node-scope composite pass even when nodes exist', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-composite',
            type: 'basic',
            params: { exposure: 0.25 },
            scope: { kind: 'global' },
            inputs: [],
            layer_ids: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      bypassAdjustments: true,
    });

    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx`
Expected: FAIL — TS error on unknown `bypassAdjustments` arg, then assertion failure because the existing per-layer code still calls the pipeline.

- [ ] **Step 3: Implement the bypass**

In `src/lib/image-node-renderer.ts`, extend `RenderImageNodeCompositeArgs`:

```ts
  /**
   * Press-and-hold compare on an ImageNode. When true, skip every shader pass
   * and just composite the source bitmaps with blend modes and opacities. The
   * overlay pass still runs so selection chrome stays visible.
   */
  bypassAdjustments?: boolean;
```

Destructure the new arg at the top of the function, alongside the existing destructure:

```ts
  const hiddenNodeIds = args.hiddenNodeIds ?? new Set<string>();
  const bypassAdjustments = args.bypassAdjustments ?? false;
```

Inside the per-layer loop, gate the adjustments and the shader call on `bypassAdjustments`:

```ts
    const layerNodes = nodes.filter(
      (n) => n.layer_id === layerId && !hiddenNodeIds.has(n.id),
    );
    const adjustments: Adjustment[] = bypassAdjustments
      ? []
      : layerNodes
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
```

And short-circuit the composite-then-apply pass entirely. Wrap the existing `if (nodeScopeNodes.length > 0) { … }` block:

```ts
  if (!bypassAdjustments && nodeScopeNodes.length > 0) {
    const nodeAdjustments: Adjustment[] = nodeScopeNodes
      .map((n) => withOptimistic(n, optimistic))
      .map(nodeToAdjustment)
      .filter((a) => a.enabled);

    if (nodeAdjustments.length > 0) {
      PipelineManager.setSourceCanvas(canvas);
      const final = PipelineManager.renderSync(nodeAdjustments);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(final, 0, 0, canvas.width, canvas.height);
    }
  }
```

The overlay pass stays unchanged below.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx`
Expected: PASS — bypass cases plus everything from earlier tasks.

- [ ] **Step 5: Type/lint check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/image-node-renderer.ts src/lib/image-node-renderer.test.tsx
git commit -m "feat(renderer): bypassAdjustments skips shader passes for hold-to-compare"
```

---

## Task 4 — Thread `bypassAdjustments` + `hiddenWidgetIds` through `useImageNodeRender`

**Files:**
- Modify: `src/hooks/useImageNodeRender.ts`

This task has no test of its own — the prop pass-through is exercised by Task 7 (ImageNode pointer event test) and by the renderer tests in Tasks 2–3.

- [ ] **Step 1: Add a prop, derive `hiddenNodeIds`, thread both to the renderer**

Edit `src/hooks/useImageNodeRender.ts`. Extend `ImageNodeRenderInput`:

```ts
export interface ImageNodeRenderInput {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
  /** When true, the renderer skips every shader pass (press-and-hold compare). */
  bypassAdjustments?: boolean;
}
```

Update the function signature to destructure the new prop, then subscribe to `hiddenWidgetIds` from the editor store. Add these alongside the existing selectors:

```ts
export function useImageNodeRender({
  imageNodeId,
  layerIds,
  width,
  height,
  bypassAdjustments = false,
}: ImageNodeRenderInput) {
  // …existing selectors…
  const hiddenWidgetIds = useEditorStore((s) => s.hiddenWidgetIds);
```

Inside the `useEffect`, derive the set of hidden node ids from the snapshot widgets and pass both new args to the renderer:

```ts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const backingW = Math.max(1, Math.round(width * renderScale));
    const backingH = Math.max(1, Math.round(height * renderScale));
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;

    const hiddenNodeIds = new Set<string>();
    for (const w of widgets) {
      if (!hiddenWidgetIds.has(w.id)) continue;
      for (const n of w.nodes) hiddenNodeIds.add(n.id);
    }

    renderImageNodeComposite({
      canvas,
      imageNodeId,
      layerIds,
      opGraph,
      widgets,
      optimistic,
      hiddenNodeIds,
      bypassAdjustments,
    });
  }, [
    imageNodeId,
    layerIds,
    width,
    height,
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
    bypassAdjustments,
  ]);
```

- [ ] **Step 2: Type/lint check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Re-run renderer tests to confirm no regressions**

Run: `npx vitest run src/lib/image-node-renderer.test.tsx src/store/tool-slice.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useImageNodeRender.ts
git commit -m "feat(useImageNodeRender): thread hiddenWidgetIds + bypassAdjustments to renderer"
```

---

## Task 5 — Eye button on `WidgetShellHeader`; drop the dirty dot

**Files:**
- Modify: `src/components/widget/WidgetShellHeader.tsx`
- Test: `src/components/widget/WidgetShellHeader.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/widget/WidgetShellHeader.test.tsx`, replace the `dirty dot` test with the new specification:

Find this existing test:
```ts
  it('shows the dirty dot only when dirty=true', () => {
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={true} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Bindings edited')).toBeInTheDocument();
  });
```

Replace it with:

```ts
  it('never renders the legacy "Bindings edited" dot, regardless of dirty', () => {
    const { rerender } = render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={true}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
  });
```

Also update **every other call to `<WidgetShellHeader …>`** in this file to pass the two new required props `hidden={false}` and `onToggleHidden={() => {}}` (six call sites). For example:

```ts
  it('renders AI badge for ai variant', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });
```

Apply the same pattern to: the "renders muted dot for tool variant", "shows the scope chip", "shows Global", "clicking the header invokes onToggle", and "renders close button only when expanded" tests.

Append three new `it` cases at the end of the describe block:

```ts
  it('renders an eye button right of the scope chip and before the chevron', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /hide widget/i });
    expect(btn).toBeInTheDocument();
    // Position check: scope chip → eye → chevron.
    const header = btn.closest('[aria-label="Toggle widget"]') as HTMLElement;
    const children = Array.from(header.children) as HTMLElement[];
    const scopeIdx = children.findIndex((c) => c.textContent?.toLowerCase().includes('sky'));
    const eyeIdx = children.indexOf(btn);
    const chevIdx = children.findIndex((c) => c.textContent === '›' || c.textContent === '⌄');
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(eyeIdx).toBeGreaterThan(scopeIdx);
    expect(chevIdx).toBeGreaterThan(eyeIdx);
  });

  it('eye button aria-label flips between Hide and Show based on hidden prop', () => {
    const { rerender } = render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /hide widget/i })).toBeInTheDocument();
    rerender(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={true}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /show widget/i })).toBeInTheDocument();
  });

  it('clicking the eye fires onToggleHidden and does not fire onToggle', () => {
    const onToggle = vi.fn();
    const onToggleHidden = vi.fn();
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={onToggle}
        onClose={() => {}}
        onToggleHidden={onToggleHidden}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/widget/WidgetShellHeader.test.tsx`
Expected: FAIL — TS errors on unknown props (`hidden`, `onToggleHidden`) and missing eye button.

- [ ] **Step 3: Implement the header changes**

Replace the full contents of `src/components/widget/WidgetShellHeader.tsx` with:

```tsx
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';

interface WidgetShellHeaderProps {
  widget: Widget;
  expanded: boolean;
  dirty: boolean;
  hidden: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleHidden: () => void;
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
  if (s.kind === 'image_node') return `Image (${s.layer_ids.length} layer${s.layer_ids.length === 1 ? '' : 's'})`;
  return '—';
}

function scopeDotClass(widget: Widget): string {
  return widget.scope.kind === 'global' ? 'bg-text-secondary' : 'bg-orange-500';
}

export function WidgetShellHeader({
  widget,
  expanded,
  dirty,
  hidden,
  onToggle,
  onClose,
  onToggleHidden,
}: WidgetShellHeaderProps) {
  // `dirty` is kept in the prop interface as a hook for future affordances;
  // the legacy edit-state dot has been removed in favour of slider-level
  // provenance colour.
  void dirty;
  const ai = isAiVariant(widget);
  return (
    <div
      role="button"
      aria-label="Toggle widget"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className="workspace-drag-handle flex items-center gap-1.5 px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
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
        <Sparkles
          size={12}
          className="shrink-0 text-ai"
          aria-label="AI-composed widget"
        />
      ) : (
        <span
          aria-label="Tool-invoked widget"
          className="inline-flex items-center text-[8px] font-semibold bg-surface-secondary text-text-secondary px-1 rounded-[3px] leading-none py-px"
        >
          ·
        </span>
      )}
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary">{widget.intent}</span>
      <span className="inline-flex items-center gap-1 text-[9px] text-text-secondary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px leading-[1.4]">
        <span className={`w-[5px] h-[5px] rounded-full ${scopeDotClass(widget)}`} />
        {scopeLabel(widget)}
      </span>
      <button
        type="button"
        aria-label={hidden ? 'Show widget' : 'Hide widget'}
        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
        className="inline-flex items-center justify-center text-text-secondary hover:text-text-primary px-0.5"
      >
        {hidden ? <Eye size={11} aria-hidden /> : <EyeOff size={11} aria-hidden />}
      </button>
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

Notes:
- The eye icon flips between `Eye` (when visible — clicking will *hide*, aria-label "Hide widget") and `EyeOff` (when hidden — clicking will *show*, aria-label "Show widget"). This matches Lightroom's convention.
- `void dirty;` keeps the prop in the interface for future use without an unused-arg lint warning. The header simply never renders a dirty indicator anymore.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/widget/WidgetShellHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type/lint check**

Run: `npm run check`
Expected: This may surface an error in `WidgetShell.tsx` (and possibly any other caller) because the header now requires `hidden` and `onToggleHidden`. That's fine — Task 6 fixes the caller. To narrow the scope here, run only the new file's compile:

```bash
npx tsc -b --pretty false 2>&1 | grep -E "(WidgetShellHeader|widget/)" || true
```
Expected: errors limited to the two new required props missing in `WidgetShell.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/WidgetShellHeader.tsx src/components/widget/WidgetShellHeader.test.tsx
git commit -m "feat(widget-header): add eye toggle; drop legacy dirty dot"
```

---

## Task 6 — Wire `WidgetShell` to `hiddenWidgetIds` and apply hidden styling

**Files:**
- Modify: `src/components/widget/WidgetShell.tsx`
- Test: `src/components/widget/WidgetShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Append a new `it` to the `describe('WidgetShell', …)` block in `src/components/widget/WidgetShell.test.tsx`:

```ts
  it('applies opacity-60 to the shell root when the widget id is in hiddenWidgetIds', () => {
    useEditorStore.getState().toggleWidgetHidden('w-ai-1');
    const { container } = render(<WidgetShell widget={makeAiWidget()} />);
    expect(container.firstChild as HTMLElement).toHaveClass('opacity-60');
  });

  it('clicking the eye button calls toggleWidgetHidden on the store', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-ai-1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-ai-1')).toBe(true);
  });
```

Also extend the existing `beforeEach` in this file to clear hidden state between tests:

```ts
  beforeEach(() => {
    useEditorStore.getState().collapseAllWidgets();
    const ids = Array.from(useEditorStore.getState().hiddenWidgetIds);
    for (const id of ids) useEditorStore.getState().toggleWidgetHidden(id);
    vi.clearAllMocks();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: FAIL — eye button not yet wired; root missing `opacity-60`.

- [ ] **Step 3: Implement the shell changes**

Edit `src/components/widget/WidgetShell.tsx`. At the top of the component body, add a selector that reads the hidden state and the action:

```tsx
  const hidden = useEditorStore((s) => s.hiddenWidgetIds.has(widget.id));
  const toggleHidden = useEditorStore((s) => s.toggleWidgetHidden);
```

Pass `hidden` and `onToggleHidden` to the header and add `opacity-60` to the root className when hidden. The root `<div>` becomes:

```tsx
    <div
      // min-w-[226px] matches WIDGET_SHELL_MIN_WIDTH; width grows to fit content.
      // AI-composed widgets get a violet outline + glow (widget-shell-ai) so
      // they read as distinct from tool-invoked widgets on the canvas.
      className={`overlay min-w-[226px] w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${selected && !showAiAffordances ? 'workspace-node-selected' : ''} ${hovered ? 'border-accent' : ''} ${hidden ? 'opacity-60' : ''}`}
      onMouseEnter={() => setHoveredWidget(widget.id)}
      onMouseLeave={() => setHoveredWidget(null)}
    >
      <WidgetShellHeader
        widget={widget}
        expanded={isExpanded}
        dirty={dirty}
        hidden={hidden}
        onToggle={toggle}
        onClose={handleClose}
        onToggleHidden={() => toggleHidden(widget.id)}
      />
```

Leave the rest of the component (body rendering, footer, refine input, etc.) unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: PASS — new tests green, existing tests still green.

- [ ] **Step 5: Type/lint check (full pass — this should now be clean)**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx
git commit -m "feat(widget-shell): wire eye to hiddenWidgetIds; dim hidden shell"
```

---

## Task 7 — Compare button on ImageNode (inline in header strip)

**Files:**
- Modify: `src/components/workspace/ImageNodeBody.tsx`
- Modify: `src/components/workspace/ImageNode.tsx`
- Test: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Write the failing test**

Look at `src/components/workspace/ImageNode.test.tsx` to find the existing import / setup conventions, then append a new `describe` block (or `it` block in the existing one):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

afterEach(cleanup);

// `ImageNodeBody` runs the WebGL pipeline; stub it so we can inspect props.
vi.mock('@/components/workspace/ImageNodeBody', () => ({
  ImageNodeBody: vi.fn(({ bypassAdjustments }: { bypassAdjustments?: boolean }) => (
    <div data-testid="image-node-body" data-bypass={bypassAdjustments ? 'true' : 'false'} />
  )),
}));

import { ImageNode } from './ImageNode';

function renderNode(selected = true) {
  return render(
    <ReactFlowProvider>
      <ImageNode
        id="in-1"
        selected={selected}
        data={{ name: 'Image', layerIds: ['L1'], size: { w: 200, h: 120 }, activeLayerIndex: 0 }}
      />
    </ReactFlowProvider>,
  );
}

describe('ImageNode · compare button', () => {
  it('renders the compare button inline in the header strip regardless of selection', () => {
    renderNode(false);
    expect(screen.getByRole('button', { name: /show original/i })).toBeInTheDocument();
  });

  it('pointerdown sets bypassAdjustments true on the body; pointerup clears it', () => {
    renderNode();
    const body = screen.getByTestId('image-node-body');
    expect(body.getAttribute('data-bypass')).toBe('false');

    const btn = screen.getByRole('button', { name: /show original/i });
    fireEvent.pointerDown(btn);
    expect(screen.getByTestId('image-node-body').getAttribute('data-bypass')).toBe('true');

    fireEvent.pointerUp(btn);
    expect(screen.getByTestId('image-node-body').getAttribute('data-bypass')).toBe('false');
  });

  it('pointerleave on the button also clears bypassAdjustments', () => {
    renderNode();
    const btn = screen.getByRole('button', { name: /show original/i });
    fireEvent.pointerDown(btn);
    expect(screen.getByTestId('image-node-body').getAttribute('data-bypass')).toBe('true');
    fireEvent.pointerLeave(btn);
    expect(screen.getByTestId('image-node-body').getAttribute('data-bypass')).toBe('false');
  });

  it('compare button stops pointerdown propagation (does not bubble to the drag-handle strip)', () => {
    renderNode();
    const btn = screen.getByRole('button', { name: /show original/i });
    const handle = btn.closest('.workspace-drag-handle') as HTMLElement;
    const handleSpy = vi.fn();
    handle.addEventListener('pointerdown', handleSpy);
    fireEvent.pointerDown(btn);
    expect(handleSpy).not.toHaveBeenCalled();
  });
});
```

If the test file already exists with a different setup, integrate by adding only the new `describe` block at the bottom (still mock `ImageNodeBody` at the top of the file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: FAIL — "Unable to find button with name /show original/i" and friends.

- [ ] **Step 3: Add `bypassAdjustments` to `ImageNodeBody`**

Edit `src/components/workspace/ImageNodeBody.tsx`:

```tsx
import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
  bypassAdjustments?: boolean;
}

export function ImageNodeBody({ imageNodeId, layerIds, width, height, bypassAdjustments }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height, bypassAdjustments });
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

- [ ] **Step 4: Add the compare button inline in the ImageNode header strip**

Edit `src/components/workspace/ImageNode.tsx`. Add the `Eye` icon and `useState` to the imports at the top:

```tsx
import { useState } from 'react';
import { Eye, Image, Split } from 'lucide-react';
```

Inside the `ImageNode` function body, add the compare state hook near the other top-of-function state (after `chromeScale`):

```tsx
  const [compareHeld, setCompareHeld] = useState(false);
```

Modify the existing top header strip (inside `ImageNodeSelectionPopover`) to insert the compare button between the title span and the layer badge. Replace this block:

```tsx
        <ImageNodeSelectionPopover layerIds={data.layerIds}>
          <div
            className="workspace-drag-handle flex items-center gap-1.5 px-2 py-1 bg-surface border-b border-separator cursor-grab active:cursor-grabbing"
            style={stripScaleTop}
          >
            <Image size={11} className="text-text-secondary" aria-hidden />
            <span className="text-[10px] font-medium flex-1 truncate">{data.name ?? 'Image'}</span>
            <span className="text-[8px] font-semibold bg-surface-secondary border border-separator rounded-full px-1.5 py-px text-text-secondary uppercase">
              {data.layerIds.length} LAYER{data.layerIds.length === 1 ? '' : 'S'}
            </span>
          </div>
        </ImageNodeSelectionPopover>
```

With:

```tsx
        <ImageNodeSelectionPopover layerIds={data.layerIds}>
          <div
            className="workspace-drag-handle flex items-center gap-1.5 px-2 py-1 bg-surface border-b border-separator cursor-grab active:cursor-grabbing"
            style={stripScaleTop}
          >
            <Image size={11} className="text-text-secondary" aria-hidden />
            <span className="text-[10px] font-medium flex-1 truncate">{data.name ?? 'Image'}</span>
            <button
              type="button"
              aria-label="Show original (hold)"
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setCompareHeld(true); }}
              onPointerUp={() => setCompareHeld(false)}
              onPointerLeave={() => setCompareHeld(false)}
              onPointerCancel={() => setCompareHeld(false)}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center w-4 h-4 rounded-[3px] text-text-secondary hover:text-text-primary"
            >
              <Eye size={11} aria-hidden />
            </button>
            <span className="text-[8px] font-semibold bg-surface-secondary border border-separator rounded-full px-1.5 py-px text-text-secondary uppercase">
              {data.layerIds.length} LAYER{data.layerIds.length === 1 ? '' : 'S'}
            </span>
          </div>
        </ImageNodeSelectionPopover>
```

Finally, pass `bypassAdjustments` to the body. Find:

```tsx
        <ImageNodeBody imageNodeId={id} layerIds={data.layerIds} width={data.size.w} height={data.size.h} />
```

Replace with:

```tsx
        <ImageNodeBody imageNodeId={id} layerIds={data.layerIds} width={data.size.w} height={data.size.h} bypassAdjustments={compareHeld} />
```

Notes:
- `onPointerDown` calls both `stopPropagation` (to prevent React Flow from initiating a drag) and `preventDefault` (to avoid the default focus / text-select behavior).
- `onClick` also stops propagation so the wrapping `ImageNodeSelectionPopover` trigger does not fire on a click sequence.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx`
Expected: PASS — all four new tests green.

- [ ] **Step 6: Full type/lint pass**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNodeBody.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): inline press-and-hold compare button in header strip"
```

---

## Task 8 — Full-suite verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all PASS, including all six new/modified test files.

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run the dev server (`npm run dev`) and verify in the browser that:

1. Opening an image and clicking a toolrail tool spawns a widget. The widget header shows the eye icon (open) right of the scope chip, before the chevron.
2. Clicking the eye dims the widget shell (opacity-60), the icon flips to "eye off," and the WebGL composite reverts to show the layer **without** that widget's adjustment contribution.
3. Clicking the eye again restores both the shell opacity and the adjustment.
4. The dirty-dot indicator no longer appears in the widget header even after dragging a slider away from its default.
5. The ImageNode top header strip shows the Eye button between the "Image" title and the "1 LAYER" badge. Pressing and holding the button blits the source bitmap (no adjustments visible); releasing restores the composite. Dragging the cursor off the button while held also restores the composite. The press does not initiate a node drag.

- [ ] **Step 4: Final commit (only if step 3 surfaced fixes)**

If the manual smoke pass surfaced an issue, fix it and commit with a descriptive message. Otherwise this task has no commit.

---

## Self-Review Notes

- **Spec coverage:** Every spec requirement maps to a task. Widget visibility state → Task 1. Renderer hidden-node filter → Task 2. Renderer bypass → Task 3. Hook wiring → Task 4. Widget header eye + dirty-dot removal → Task 5. Shell hidden styling → Task 6. ImageNode compare button (inline placement, stop-propagation against drag-handle and popover) → Task 7.
- **Type consistency:** `hiddenWidgetIds`, `toggleWidgetHidden`, `hiddenNodeIds`, `bypassAdjustments`, `onToggleHidden`, `hidden` (header prop) — all spelled consistently across tasks. Slice action `toggleWidgetHidden(widgetId: string)` matches the signature used by `WidgetShell` (`() => toggleHidden(widget.id)`).
- **Tests align with implementation:** the renderer tests assert on the mocked `PipelineManager` (matching the existing test infrastructure), and the ImageNode tests mock `ImageNodeBody` to inspect prop pass-through rather than trying to verify canvas pixels.
- **Edge case explicitly handled:** the compare button lives inside the React Flow drag-handle strip, so Task 7 includes a test that `pointerdown` does not bubble to that handle.
