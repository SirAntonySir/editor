# Autonomous region extraction on accept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On accept (✓) of an autonomous `named_region` suggestion widget, extract the region into its own SAM image node (reusing the palette's Extract → Node/Layer chooser) and re-plan adjustments on it — mirroring the Cmd+K path.

**Architecture:** Add one exported helper `runAgentTurnForRegion` to `palette-actions.agent.ts` that feeds a single `region:ai:<label>` chip through the existing `resolveAttachedRegions` → `backendTools.agentTurn` spine. Wire `WidgetShell.handleApply` to call it for `named_region` scope and supersede the original widget via `delete_widget`; fall back to `accept_widget` when nothing was extracted.

**Tech Stack:** React 19 + TS, Zustand, Vitest.

## Global Constraints

- TypeScript strict mode; `npm run check` (tsc + eslint + custom rules + vitest) must pass.
- No new inline-defined components; no hardcoded design values.
- Reuse existing extraction helpers — no parallel extraction logic.

---

### Task 1: `runAgentTurnForRegion` helper

**Files:**
- Modify: `src/lib/palette-actions.agent.ts` (add exported function after `runAgentTurn`)
- Test: `src/lib/palette-actions.agent.test.ts`

**Interfaces:**
- Consumes (module-private, already present): `resolveAttachedRegions`, `dedupeForcedTargets`, `AGENT_LOOP_TOOLS`, `RegionChoiceFn`.
- Produces:
  `runAgentTurnForRegion(intent: string, label: string, getChoice?: RegionChoiceFn): Promise<{ extracted: boolean; ok: boolean; toolCalls: number }>`

- [ ] **Step 1: Write failing tests** in `src/lib/palette-actions.agent.test.ts`. Add a segment-region mock at top (alongside the existing object-actions mock) and a new `describe('runAgentTurnForRegion')` block:

```ts
// add near the other vi.mock calls at the top of the file:
const segmentMock = vi.fn();
vi.mock('@/lib/segmentation/segment-region', () => ({
  segmentRegionFromPoint: (...a: unknown[]) => segmentMock(...a),
}));
```

```ts
// add `segmentMock.mockReset();` inside the existing beforeEach.

// import the new export in the existing destructure:
// const { runAgentTurn, runAgentTurnForRegion, AGENT_LOOP_TOOLS } = await import('./palette-actions.agent');

describe('runAgentTurnForRegion', () => {
  async function setRegions(regions: unknown[]) {
    const { useAiSession } = await import('@/hooks/useImageContext');
    useAiSession.setState({ context: { candidateRegions: regions } as never });
  }

  it('extracts a precomputed AI region to a node and fires the agent turn', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    await setRegions([{ label: 'sky', maskRef: 'm-sky' }]);
    maskHasSet.add('m-sky');
    extractMock.mockReturnValue({ imageNodeId: 'node-new', layerId: 'L1' });

    const out = await runAgentTurnForRegion('fix the sky', 'sky', async () => 'node');
    expect(out.extracted).toBe(true);
    expect(extractMock).toHaveBeenCalledWith('m-sky', nodeId);
    const body = lastBody();
    expect(body.intent).toBe('fix the sky');
    expect(body.forced_targets).toEqual([{ image_node_id: 'node-new', layer_ids: ['L1'] }]);
  });

  it('segments a maskless AI region via its point, then extracts', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    await setRegions([{ label: 'car', representativePoint: [0.5, 0.5] }]);
    segmentMock.mockResolvedValue('m-car');
    extractMock.mockReturnValue({ imageNodeId: 'node-car', layerId: 'Lc' });

    const out = await runAgentTurnForRegion('fix the car', 'car', async () => 'node');
    expect(segmentMock).toHaveBeenCalledWith(nodeId, [0.5, 0.5], 'car');
    expect(extractMock).toHaveBeenCalledWith('m-car', nodeId);
    expect(out.extracted).toBe(true);
  });

  it('reports not-extracted (no agent turn) when the user denies', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    await setRegions([{ label: 'sky', maskRef: 'm-sky' }]);
    maskHasSet.add('m-sky');

    const out = await runAgentTurnForRegion('fix the sky', 'sky', async () => 'deny');
    expect(out.extracted).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports not-extracted when the region is unknown', async () => {
    await setRegions([]);
    const out = await runAgentTurnForRegion('fix the sky', 'sky', async () => 'node');
    expect(out.extracted).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: FAIL — `runAgentTurnForRegion is not a function`.

- [ ] **Step 3: Implement** — append to `src/lib/palette-actions.agent.ts`:

```ts
/** Accept-time mirror of {@link runAgentTurn} for a single autonomous region.
 *  Feeds one `region:ai:<label>` chip through the same approval-gated extract
 *  path (Extract → Node / Layer / ✕), then re-plans adjustments on the extracted
 *  node. `extracted` is false when the user denies, the region can't be resolved,
 *  or extraction fails — the caller then does a plain in-place accept. */
export async function runAgentTurnForRegion(
  intent: string,
  label: string,
  getChoice: RegionChoiceFn = (l) => useRegionExtractionApproval.getState().request(l),
): Promise<{ extracted: boolean; ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { extracted: false, ok: false, toolCalls: 0 };

  const editor = useEditorStore.getState();
  const activeNodeId = editor.activeImageNodeId;
  const activeNode = activeNodeId ? editor.imageNodes[activeNodeId] : undefined;
  const candidateRegions = useAiSession.getState().context?.candidateRegions ?? [];

  const { forcedTargets, fallbackIds } = await resolveAttachedRegions(
    [`region:ai:${label}`],
    candidateRegions,
    activeNodeId,
    getChoice,
  );

  // Nothing was baked into a node (deny / unresolved / extraction failure) —
  // let the caller fall back to a plain in-place accept instead of running an
  // agent turn against the whole node.
  if (forcedTargets.length === 0) return { extracted: false, ok: true, toolCalls: 0 };

  const activeNodePayload =
    activeNodeId && activeNode
      ? { image_node_id: activeNodeId, layer_ids: activeNode.layerIds }
      : null;

  const res = await backendTools.agentTurn(sid, {
    intent,
    attached_objects: fallbackIds,
    forced_targets: dedupeForcedTargets(forcedTargets),
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNodePayload,
  });
  return { extracted: true, ...res };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: PASS (all `runAgentTurn` + `runAgentTurnForRegion` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/palette-actions.agent.ts src/lib/palette-actions.agent.test.ts
git commit -m "feat(palette): runAgentTurnForRegion — accept-time region extraction helper"
```

---

### Task 2: Wire WidgetShell accept to extract on `named_region`

**Files:**
- Modify: `src/components/widget/WidgetShell.tsx` (import + `handleApply`)
- Test: `src/components/widget/WidgetShell.test.tsx`

**Interfaces:**
- Consumes: `runAgentTurnForRegion` (Task 1), `backendTools.delete_widget`, `backendTools.accept_widget`.

- [ ] **Step 1: Update/extend tests** in `src/components/widget/WidgetShell.test.tsx`.

Add `runAgentTurnForRegion: vi.fn()` to the mock and a default resolution in `beforeEach`; update the existing accept test to be async; add the extract + global-scope tests:

```ts
// add to the top-level mocks:
vi.mock('@/lib/palette-actions.agent', () => ({
  runAgentTurnForRegion: vi.fn(),
}));

// after other imports:
import { runAgentTurnForRegion } from '@/lib/palette-actions.agent';
import { makeGlobalWidget } from './__fixtures__/widgets';
import { waitFor } from '@testing-library/react';
```

```ts
// in the main describe beforeEach, after vi.clearAllMocks():
vi.mocked(runAgentTurnForRegion).mockResolvedValue({ extracted: false, ok: true, toolCalls: 0 });
```

Replace the existing `it('Apply calls backendTools.accept_widget', ...)` (named_region widget, extraction unresolved → falls back to accept) with an async version:

```ts
it('Apply on a named_region widget with no extraction falls back to accept_widget', async () => {
  useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
  renderInFlow(<WidgetShell widget={makeAiWidget()} />);
  fireEvent.click(screen.getByRole('button', { name: /apply widget/i }));
  await waitFor(() =>
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widgetId: 'w-ai-1' }),
  );
  expect(runAgentTurnForRegion).toHaveBeenCalledWith('Warm up shadows', 'sky');
});

it('Apply on a named_region widget that extracts supersedes it via delete_widget', async () => {
  vi.mocked(runAgentTurnForRegion).mockResolvedValue({ extracted: true, ok: true, toolCalls: 2 });
  useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
  renderInFlow(<WidgetShell widget={makeAiWidget()} />);
  fireEvent.click(screen.getByRole('button', { name: /apply widget/i }));
  await waitFor(() =>
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s-1', { widgetId: 'w-ai-1', suppressSimilar: false }),
  );
  expect(backendTools.accept_widget).not.toHaveBeenCalled();
});

it('Apply on a global-scope widget accepts directly (no extraction)', async () => {
  useEditorStore.getState().toggleWidgetExpanded('w-global-1');
  renderInFlow(<WidgetShell widget={makeGlobalWidget()} />);
  fireEvent.click(screen.getByRole('button', { name: /apply widget/i }));
  await waitFor(() =>
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widgetId: 'w-global-1' }),
  );
  expect(runAgentTurnForRegion).not.toHaveBeenCalled();
});
```

Also add `refine_widget: vi.fn()` already exists in the backend-tools mock; ensure `delete_widget` and `accept_widget` are present (they are).

- [ ] **Step 2: Run tests, verify the new/updated ones fail**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: FAIL — `named_region` Apply currently calls `accept_widget` synchronously and never calls `runAgentTurnForRegion`/`delete_widget`.

- [ ] **Step 3: Implement** — in `src/components/widget/WidgetShell.tsx`:

Add the import near the other `@/lib` imports:

```ts
import { runAgentTurnForRegion } from '@/lib/palette-actions.agent';
```

Replace the tail of `handleApply` (the final `logWidgetUndoDiag(...) ; void backendTools.accept_widget(...)`) with:

```ts
    // Autonomous local-region suggestions mirror the Cmd+K palette on accept:
    // extract the region into its own SAM image node (same Extract → Node/Layer
    // chooser) and re-plan adjustments on it. Falls back to a plain in-place
    // accept when the user denies or the region can't be resolved/extracted.
    if (widget.scope.kind === 'named_region') {
      logWidgetUndoDiag('apply(extract_region)', { widgetId: widget.id });
      const { extracted } = await runAgentTurnForRegion(widget.intent, widget.scope.label);
      if (extracted) {
        void backendTools.delete_widget(sessionId, { widgetId: widget.id, suppressSimilar: false });
        return;
      }
    }

    logWidgetUndoDiag('apply(accept_widget)', { widgetId: widget.id });
    void backendTools.accept_widget(sessionId, { widgetId: widget.id });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

```bash
npm run check
git add src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx
git commit -m "feat(widget): accept on a region suggestion extracts it into its own SAM node"
```

---

## Self-Review

- **Spec coverage:** Trigger on accept (Task 2) ✓; reuse `resolveAttachedRegions`/chooser (Task 1) ✓; agent re-plan via `agentTurn` (Task 1) ✓; supersede original via `delete_widget` (Task 2) ✓; fall-back to in-place accept on deny/failure/unresolved (Task 1 empty-forcedTargets → Task 2 accept) ✓; segmentable + extractable paths (Task 1 tests) ✓.
- **Placeholder scan:** none.
- **Type consistency:** `runAgentTurnForRegion` returns `{ extracted, ok, toolCalls }`; WidgetShell destructures `{ extracted }`. `agentTurn` body matches `backendTools.agentTurn` signature (intent, attached_objects, forced_targets, client_tools, active_node). `delete_widget` args `{ widgetId, suppressSimilar }` match existing `handleClose`.
```
