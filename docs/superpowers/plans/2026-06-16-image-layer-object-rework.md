# Image / Layer / Object Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three-axis selection state into a clean `(activeImageNodeId, activeLayerId, activeObjectId)` triple, fix the "Info tab always shows the newest image" bug, delete the Classic codepath, replace the standalone Layers panel with an Inspector Layer tab, and align all three adjustment spawn paths on `(layer_id, object_id)` derived from the active selection.

**Architecture:** Frontend Zustand slices. `selection-slice` replaces its discriminated `Scope` union with a plain `activeObjectId: string | null` field (null = whole image). Image-node and layer selection live in their own slices and don't share the same slot any more. The drafting register becomes the only visual style. The standalone `LayersPanel` is deleted; per-layer detail moves into a new Inspector tab. All `backendTools.proposeStack` calls derive `scope` from `activeObjectId` instead of hard-coding `{ kind: 'global' }`.

**Tech Stack:** React 19 + TypeScript strict, Zustand v5 + Immer, vitest, React Flow `@xyflow/react`, Radix UI, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-16-image-layer-object-rework-design.md`

**Conventions for this plan:**
- All paths are relative to the repo root.
- Verification command after every commit: `npm run check` (tsc + eslint + no-nested-component) and `npm test -- --run`. Both green or the task isn't done.
- Commit messages follow the existing `type(scope): summary` style seen in `git log`.
- After every commit run `npm run check`. If it fails, fix and amend the commit before moving on.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/components/inspector/layer/LayerTab.tsx` | Per-layer detail tab body — rename, opacity, blend, layer mask, lock. Mounts the visible UI for one layer. |
| `src/components/inspector/layer/LayerRow.tsx` | List row in `LayerTab` for one layer (clickable to set active). Reuses the look-and-feel patterns from the deleted `LayersPanel`. |
| `src/components/inspector/layer/LayerTab.test.tsx` | Test the LayerTab rendering, click-to-select, and mutation wiring. |
| `src/store/object-selection.ts` *(no — see Phase 1)* | (Helper module for Scope→ObjectId migration during Phase 1.) Inlined into the slice. No separate file. |

### Modified files

| Path | What changes |
|---|---|
| `src/store/selection-slice.ts` | Replace `activeScope` / `hoveredScope` with `activeObjectId` / `hoveredObjectId`. Adapt `clickAt`, `shiftClickAt`, `clearSelection`. |
| `src/types/scope.ts` | Trim the `Scope` union; keep it as a backend-side type, but remove `image_node` variant. Add `GLOBAL_SCOPE` accessor (already exists). |
| `src/lib/scope-to-mask.ts` | Adapt to take a `MaskRef | null` instead of `Scope`. |
| `src/lib/scope-to-mask.test.ts` | Adapt tests for new signature. |
| `src/components/workspace/SegmentHitLayer.tsx` | Replace `setActiveScope({ kind: 'mask', mask_id })` with `setActiveObjectId(maskRef)`. |
| `src/components/workspace/ImageNode.tsx` | Inline `ImageNodeDrafting` body; delete `ImageNodeClassic` and the wrapper branch. Replace `activeScope.kind === 'mask'` checks with `activeObjectId` comparisons. |
| `src/components/panels/SegmentRow.tsx` | Use `activeObjectId` directly. |
| `src/hooks/useImageNodeRender.ts` | Read `activeObjectId` / `hoveredObjectId`. |
| `src/lib/image-node-renderer.ts` | Replace scope-kind checks with direct id comparisons. |
| `src/store/backend-state-slice.ts` | When a mask is removed, clear `activeObjectId` if it points to it. |
| `src/tools/filters-tool.tsx` | Derive scope from `activeObjectId`. |
| `src/components/CommandPalette.tsx` | Same — derive scope from `activeObjectId`. |
| `src/core/document.ts` | `addImage` only auto-activates when `activeImageNodeId === null`. Emit a "image added" event for the toast. |
| `src/components/inspector/info/InfoTab.tsx` | Subscribe to `activeImageNodeId` and rerender on change. Drop any forced-latest behavior. |
| `src/store/preferences-store.ts` | Drop `visualStyle`. Persist version bump + migrator. Remove `data-visual-style` attr write in `applyPreferences`. |
| `src/store/preferences-store.test.ts` | Remove visualStyle tests; add persist-migrator test. |
| `src/App.tsx` | Remove the `visualStyle` watch trigger. |
| `src/index.css` | Promote `[data-visual-style="drafting"]` tokens to root scope. Remove the selector wrapping. Drop the classic-vs-drafting block. |
| `src/components/workspace/ObjectModeFooter.tsx` | **Delete** the file. |
| `src/components/panels/LayersPanel.tsx` | **Delete** the file and its tests. |
| `src/components/inspector/InspectorPanel.tsx` | Add a 4th tab "Layer" between Info and Crop. |
| `src/components/inspector/adjustments/promote.ts` | Derive `scope` from `activeObjectId` instead of `{ kind: 'global' }`. |
| `src/lib/colour-band-spawn.ts` | Same. |
| `src/lib/tool-manifest/tools/apply-adjustment.ts` | Same. |
| `src/components/inspector/adjustments/AdjustmentsAccordion.tsx` | Show a one-line "Targets: <object name> on <layer name>" header. |

---

## Phase 1 — Selection Slice Collapse

Replace `activeScope` / `hoveredScope` with `activeObjectId` / `hoveredObjectId`. Migrate consumers. Pure refactor — no user-visible change.

### Task 1.1: Add new fields to selection-slice (keep old fields temporarily)

**Files:**
- Modify: `src/store/selection-slice.ts`
- Test: `src/store/selection-slice.test.ts` (create if absent)

- [ ] **Step 1: Write failing test for `activeObjectId` and `setActiveObjectId`**

```ts
// src/store/selection-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('selection-slice — activeObjectId', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
  });

  it('starts null (whole image)', () => {
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('setActiveObjectId stores the maskRef', () => {
    useEditorStore.getState().setActiveObjectId('mask-42');
    expect(useEditorStore.getState().activeObjectId).toBe('mask-42');
  });

  it('setActiveObjectId(null) clears', () => {
    useEditorStore.getState().setActiveObjectId('mask-42');
    useEditorStore.getState().setActiveObjectId(null);
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('hoveredObjectId tracks separately from active', () => {
    useEditorStore.getState().setHoveredObjectId('mask-7');
    expect(useEditorStore.getState().hoveredObjectId).toBe('mask-7');
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --run src/store/selection-slice.test.ts`
Expected: FAIL — `setActiveObjectId is not a function`.

- [ ] **Step 3: Add the new fields and setters alongside the old ones**

In `src/store/selection-slice.ts`, extend the interface:

```ts
export interface SelectionSlice {
  // existing
  activeScope: Scope;
  hoveredScope: Scope | null;
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
  activeMaskRef: MaskRef | null;
  committedMaskRef: MaskRef | null;
  // new — added in Phase 1, old ones removed at end of Phase 1
  activeObjectId: string | null;
  hoveredObjectId: string | null;

  setActiveScope: (scope: Scope) => void;
  setHoveredScope: (scope: Scope | null) => void;
  setActiveObjectId: (id: string | null) => void;
  setHoveredObjectId: (id: string | null) => void;
  // existing
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  shiftClickAt: (imageX: number, imageY: number, candidates: string[]) => string | null;
  focusWidget: (id: string | null) => void;
  clearSelection: () => void;
  setActiveMask: (ref: MaskRef | null) => void;
  commitMask: () => void;
  discardCommittedMask: () => void;
}
```

And in the `createSelectionSlice` body, add the initial state and setters:

```ts
  activeObjectId: null,
  hoveredObjectId: null,
  setActiveObjectId: (id) => set((s) => { s.activeObjectId = id; }),
  setHoveredObjectId: (id) => set((s) => { s.hoveredObjectId = id; }),
```

Make `clearSelection` also clear the new fields:

```ts
  clearSelection: () => set((s) => {
    s.activeScope = GLOBAL_SCOPE;
    s.hoveredScope = null;
    s.activeObjectId = null;
    s.hoveredObjectId = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
    s.activeMaskRef = null;
  }),
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- --run src/store/selection-slice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/selection-slice.ts src/store/selection-slice.test.ts
git commit -m "refactor(selection): add activeObjectId alongside activeScope"
```

### Task 1.2: Bridge — write activeObjectId every time activeScope changes (and vice versa)

We need both fields kept in sync during migration so we can flip consumers one at a time without breaking the canvas. This bridge is removed in Task 1.6.

**Files:**
- Modify: `src/store/selection-slice.ts`

- [ ] **Step 1: Write failing test for the bridge**

Append to `src/store/selection-slice.test.ts`:

```ts
describe('selection-slice — bridge', () => {
  beforeEach(() => useEditorStore.getState().clearSelection());

  it('setActiveScope({ kind: "mask", mask_id: X }) also sets activeObjectId = X', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm-1' });
    expect(useEditorStore.getState().activeObjectId).toBe('m-1');
  });

  it('setActiveScope({ kind: "global" }) clears activeObjectId', () => {
    useEditorStore.getState().setActiveObjectId('m-1');
    useEditorStore.getState().setActiveScope({ kind: 'global' });
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('setActiveObjectId(X) also sets activeScope to mask kind', () => {
    useEditorStore.getState().setActiveObjectId('m-2');
    const s = useEditorStore.getState().activeScope;
    expect(s.kind).toBe('mask');
    expect(s.kind === 'mask' && s.mask_id).toBe('m-2');
  });
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/store/selection-slice.test.ts`
Expected: FAIL on bridge tests.

- [ ] **Step 3: Implement the bridge in setters**

Replace `setActiveScope` and `setActiveObjectId` in `selection-slice.ts`:

```ts
  setActiveScope: (scope) => set((s) => {
    s.activeScope = scope;
    s.activeObjectId = scope.kind === 'mask' ? scope.mask_id : null;
  }),
  setHoveredScope: (scope) => set((s) => {
    s.hoveredScope = scope;
    s.hoveredObjectId = scope && scope.kind === 'mask' ? scope.mask_id : null;
  }),
  setActiveObjectId: (id) => set((s) => {
    s.activeObjectId = id;
    s.activeScope = id === null ? GLOBAL_SCOPE : { kind: 'mask', mask_id: id };
  }),
  setHoveredObjectId: (id) => set((s) => {
    s.hoveredObjectId = id;
    s.hoveredScope = id === null ? null : { kind: 'mask', mask_id: id };
  }),
```

- [ ] **Step 4: Pass**

Run: `npm test -- --run src/store/selection-slice.test.ts` → PASS.
Run: `npm test -- --run` → all green (the bridge preserves existing behavior).

- [ ] **Step 5: Commit**

```bash
git add src/store/selection-slice.ts src/store/selection-slice.test.ts
git commit -m "refactor(selection): bridge activeScope <-> activeObjectId during migration"
```

### Task 1.3: Migrate consumers from `activeScope` to `activeObjectId`

Flip each consumer over. The bridge in Task 1.2 keeps the old field correct until Task 1.6 deletes it.

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/panels/SegmentRow.tsx`
- Modify: `src/hooks/useImageNodeRender.ts`
- Modify: `src/lib/image-node-renderer.ts`
- Modify: `src/store/backend-state-slice.ts`
- Modify: `src/tools/filters-tool.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/panels/LayersPanel.tsx`

- [ ] **Step 1: Migrate SegmentHitLayer**

Replace at `src/components/workspace/SegmentHitLayer.tsx:115`:

```ts
editor.setActiveObjectId(maskId);
```

Replace at `src/components/workspace/SegmentHitLayer.tsx:248`:

```ts
editor.setActiveObjectId(objectHit.id);
```

Replace at `src/components/workspace/SegmentHitLayer.tsx:257-258`:

```ts
if (editor.activeObjectId !== null) {
  editor.setActiveObjectId(null);
}
```

- [ ] **Step 2: Migrate ImageNode**

In `src/components/workspace/ImageNode.tsx:157`:

```ts
const activeObjectId = useEditorStore((s) => s.activeObjectId);
```

Line 164 (the `(o) => activeScope.kind === 'mask' && activeScope.mask_id === o.id` predicate):

```ts
(o) => activeObjectId === o.id,
```

- [ ] **Step 3: Migrate SegmentRow**

In `src/components/panels/SegmentRow.tsx:17-18`:

```ts
const activeObjectId = useEditorStore((s) => s.activeObjectId);
const isSelected = activeObjectId === mask.id;
```

Line 48:

```ts
useEditorStore.getState().setActiveObjectId(mask.id);
```

- [ ] **Step 4: Migrate useImageNodeRender + image-node-renderer**

In `src/hooks/useImageNodeRender.ts:76-77`:

```ts
const activeObjectId = useEditorStore((s) => s.activeObjectId);
const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
```

Update its callsites in the same file to pass `activeObjectId` / `hoveredObjectId` (strings) into the renderer instead of Scope objects.

In `src/lib/image-node-renderer.ts:344-356`, change the function signature to accept `activeObjectId: string | null, hoveredObjectId: string | null` and replace:

```ts
// OLD
if (hoveredScope?.kind === 'mask' && hoveredScope.mask_id === mask.id) { ... }
if (activeScope.kind === 'mask' && activeScope.mask_id === mask.id) { ... }

// NEW
if (hoveredObjectId === mask.id) { ... }
if (activeObjectId === mask.id) { ... }
```

- [ ] **Step 5: Migrate backend-state-slice mask cleanup**

In `src/store/backend-state-slice.ts:419-420`:

```ts
if (editor.activeObjectId === mask_id) {
  editor.setActiveObjectId(null);
}
```

- [ ] **Step 6: Migrate filters-tool, CommandPalette (Scope readers)**

These tools build a `Scope` to pass to backend. Until Phase 5, keep producing a Scope from `activeObjectId`:

In `src/tools/filters-tool.tsx:82`:

```ts
const oid = state.activeObjectId;
const active: Scope = oid === null ? { kind: 'global' as const } : { kind: 'mask' as const, mask_id: oid };
```

Same change in `src/components/CommandPalette.tsx:237`.

- [ ] **Step 7: Migrate LayersPanel (will be deleted in Phase 4 but must compile now)**

In `src/components/panels/LayersPanel.tsx:162`:

```ts
useEditorStore.getState().setActiveObjectId(null);
```

- [ ] **Step 8: Verify**

Run: `npm run check`
Expected: PASS (tsc + eslint + no-nested-component).
Run: `npm test -- --run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx src/components/workspace/ImageNode.tsx \
        src/components/panels/SegmentRow.tsx src/hooks/useImageNodeRender.ts \
        src/lib/image-node-renderer.ts src/store/backend-state-slice.ts \
        src/tools/filters-tool.tsx src/components/CommandPalette.tsx \
        src/components/panels/LayersPanel.tsx
git commit -m "refactor(selection): migrate consumers from activeScope to activeObjectId"
```

### Task 1.4: Migrate `scope-to-mask` helper

**Files:**
- Modify: `src/lib/scope-to-mask.ts`
- Modify: `src/lib/scope-to-mask.test.ts`

- [ ] **Step 1: Rewrite test for new signature**

Replace `src/lib/scope-to-mask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { objectIdToMask } from './scope-to-mask';
import { maskStore } from '@/core/mask-store';

describe('objectIdToMask', () => {
  it('returns null for null id (whole image)', () => {
    expect(objectIdToMask(null)).toBeNull();
  });

  it('returns the mask for a known id', () => {
    const ref = maskStore.register({
      layerId: 'L1',
      source: 'sam',
      width: 4,
      height: 4,
      data: new Uint8Array(16),
    });
    expect(objectIdToMask(ref)?.layerId).toBe('L1');
    maskStore.unregister(ref);
  });

  it('returns null for an unknown id', () => {
    expect(objectIdToMask('missing-mask')).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/lib/scope-to-mask.test.ts`
Expected: FAIL — `objectIdToMask` not exported.

- [ ] **Step 3: Rewrite the helper**

Replace `src/lib/scope-to-mask.ts`:

```ts
import { maskStore, type Mask } from '@/core/mask-store';

export function objectIdToMask(id: string | null): Mask | null {
  if (id === null) return null;
  return maskStore.get(id) ?? null;
}
```

- [ ] **Step 4: Update callers**

Run: `git grep -n 'scopeToMask\|scope-to-mask' src` to find callers and replace each `scopeToMask(scope)` with `objectIdToMask(activeObjectId)` (or the appropriate id).

- [ ] **Step 5: Pass**

Run: `npm run check && npm test -- --run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scope-to-mask.ts src/lib/scope-to-mask.test.ts
# plus any caller files touched
git commit -m "refactor(selection): rename scopeToMask to objectIdToMask"
```

### Task 1.5: Update Scope union (remove `image_node` variant)

The `image_node` variant of `Scope` is no longer needed — image-node selection lives in `workspace-slice.activeImageNodeId`. The other variants (`global`, `mask`, `mask:proposed`, `named_region`) stay because the backend still uses them in `SessionStateSnapshot` and `proposeStack` args.

**Files:**
- Modify: `src/types/scope.ts`

- [ ] **Step 1: Edit the union**

In `src/types/scope.ts`, remove the `image_node` variant:

```ts
export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string };
```

- [ ] **Step 2: Verify**

Run: `npm run check` — any leftover consumer of the removed variant surfaces as a tsc error. Fix each by removing the dead branch.

- [ ] **Step 3: Commit**

```bash
git add src/types/scope.ts
# plus any callers touched
git commit -m "refactor(selection): drop image_node variant from Scope"
```

### Task 1.6: Delete the bridge — remove `activeScope` and `hoveredScope`

The last step of Phase 1. After this, there is one selection field per axis.

**Files:**
- Modify: `src/store/selection-slice.ts`
- Modify: `src/store/selection-slice.test.ts`
- Modify: any remaining consumers (should be none after Task 1.3, but verify)

- [ ] **Step 1: Remove the bridge fields**

In `src/store/selection-slice.ts`, delete `activeScope`, `hoveredScope`, `setActiveScope`, `setHoveredScope` from the interface and the implementation. Trim the bridge logic from `setActiveObjectId` and `setHoveredObjectId`:

```ts
  activeObjectId: null,
  hoveredObjectId: null,
  setActiveObjectId: (id) => set((s) => { s.activeObjectId = id; }),
  setHoveredObjectId: (id) => set((s) => { s.hoveredObjectId = id; }),
```

And `clearSelection`:

```ts
  clearSelection: () => set((s) => {
    s.activeObjectId = null;
    s.hoveredObjectId = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
    s.activeMaskRef = null;
  }),
```

- [ ] **Step 2: Remove the bridge tests**

In `src/store/selection-slice.test.ts`, delete the `describe('selection-slice — bridge', …)` block. Keep the `activeObjectId` tests.

- [ ] **Step 3: Verify**

Run: `npm run check` — any leftover `activeScope` / `setActiveScope` reference surfaces here. Fix each.
Run: `npm test -- --run` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/store/selection-slice.ts src/store/selection-slice.test.ts
git commit -m "refactor(selection): remove activeScope bridge — activeObjectId only"
```

---

## Phase 2 — Info Tab + Add-Image Fix

The user-visible bug fix. `addImage` no longer steals selection from an active image node.

### Task 2.1: Conditional auto-activate in `addImage`

**Files:**
- Modify: `src/core/document.ts`
- Modify: `src/core/document.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

```ts
// src/core/document.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';

// Helper to make a fake File from a 1x1 PNG.
async function pixelFile(name = 'a.png'): Promise<File> {
  const blob = await new Promise<Blob>((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    c.toBlob((b) => resolve(b!), 'image/png');
  });
  return new File([blob], name, { type: 'image/png' });
}

describe('document.addImage — selection behavior', () => {
  beforeEach(() => useEditorStore.getState().reset?.());

  it('activates the new node when nothing was active', async () => {
    await editorDocument.addImage(await pixelFile('a.png'));
    const a = useEditorStore.getState().activeImageNodeId;
    expect(a).not.toBeNull();
  });

  it('keeps existing selection when a node is already active', async () => {
    await editorDocument.addImage(await pixelFile('a.png'));
    const first = useEditorStore.getState().activeImageNodeId!;
    await editorDocument.addImage(await pixelFile('b.png'));
    expect(useEditorStore.getState().activeImageNodeId).toBe(first);
  });
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/core/document.test.ts`
Expected: FAIL — second test, active flips to the new image.

- [ ] **Step 3: Implement**

In `src/core/document.ts`, change the `addImage` tail (lines around 340):

```ts
    // Promote the new node to active ONLY when there's nothing to preserve.
    if (useEditorStore.getState().activeImageNodeId === null) {
      useEditorStore.getState().setActiveImageNode(newNodeId);
    }
```

- [ ] **Step 4: Pass**

Run: `npm test -- --run src/core/document.test.ts` → PASS.
Run: `npm test -- --run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/document.ts src/core/document.test.ts
git commit -m "fix(document): addImage preserves active selection"
```

### Task 2.2: "Image added" toast event with burst-coalesce

**Files:**
- Modify: `src/core/document.ts`
- Modify: `src/core/document.test.ts`

- [ ] **Step 1: Identify the toast API**

Run: `git grep -n "toast(\|useToast\|sonner" src/components src/lib src/core | head -20`. Use whichever export the codebase already uses (`toast` from `sonner`, a project-local `notify`, etc.). Record the import line; use it verbatim in steps below.

- [ ] **Step 2: Write failing test**

Append to `src/core/document.test.ts`. The test asserts the toast call happened by spying on the imported `toast` function (use `vi.mock` of the module identified in Step 1):

```ts
import { toast } from 'sonner';                       // replace with whatever Step 1 found
vi.mock('sonner', () => ({ toast: vi.fn() }));

it('emits a toast on non-stealing add', async () => {
  await editorDocument.addImage(await pixelFile('a.png'));   // first — activates
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  await editorDocument.addImage(await pixelFile('b.png'));   // second — does NOT steal
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Image added/i));
});

it('coalesces a burst into one toast message', async () => {
  await editorDocument.addImage(await pixelFile('a.png'));
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  await Promise.all([
    editorDocument.addImage(await pixelFile('b.png')),
    editorDocument.addImage(await pixelFile('c.png')),
  ]);
  // One coalesced call, message reflects the count.
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/2 images added/i));
});
```

- [ ] **Step 3: Run failing**

Run: `npm test -- --run src/core/document.test.ts`
Expected: FAIL — no toast emitted; burst case fails too.

- [ ] **Step 4: Implement the toast + coalesce buffer**

Add at module scope in `src/core/document.ts`:

```ts
import { toast } from 'sonner';   // or whatever Step 1 identified

let pendingImageAdds = 0;
let imageAddFlush: ReturnType<typeof setTimeout> | null = null;
const BURST_WINDOW_MS = 250;

function notifyImageAdded(): void {
  pendingImageAdds += 1;
  if (imageAddFlush !== null) return;
  imageAddFlush = setTimeout(() => {
    const n = pendingImageAdds;
    pendingImageAdds = 0;
    imageAddFlush = null;
    toast(n === 1 ? 'Image added — click to edit.' : `${n} images added — click to edit.`);
  }, BURST_WINDOW_MS);
}
```

In `addImage`, replace the tail (from Task 2.1) with:

```ts
    if (useEditorStore.getState().activeImageNodeId === null) {
      useEditorStore.getState().setActiveImageNode(newNodeId);
    } else {
      notifyImageAdded();
    }
```

- [ ] **Step 5: Use fake timers in the test**

Wrap the burst test body with `vi.useFakeTimers()` / `vi.runAllTimers()` so the 250ms flush happens deterministically.

- [ ] **Step 6: Pass + commit**

Run: `npm test -- --run` → PASS.

```bash
git add src/core/document.ts src/core/document.test.ts
git commit -m "feat(document): coalesced toast on non-stealing image add"
```

### Task 2.3: InfoTab subscribes to `activeImageNodeId`

`InfoTab` should rerender when the user clicks a different image. Today it reads via `useImageContextSnapshot`, which is keyed off the active layer — verify, then make the rerender explicit.

**Files:**
- Modify: `src/components/inspector/info/InfoTab.tsx`
- Modify: `src/components/inspector/info/InfoTab.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/components/inspector/info/InfoTab.test.tsx`:

```ts
it('rerenders for the new activeImageNodeId', () => {
  // Seed two image nodes with distinct contexts; set #1 active.
  setSnapshotWithContext(/* ctx for image 1 */);
  useEditorStore.setState({ activeImageNodeId: 'in-1' });
  const { getByText, rerender } = render(<InfoTab />);
  expect(getByText('Image 1 metadata')).toBeInTheDocument();

  // Switch to #2.
  setSnapshotWithContext(/* ctx for image 2 */);
  useEditorStore.setState({ activeImageNodeId: 'in-2' });
  rerender(<InfoTab />);
  expect(getByText('Image 2 metadata')).toBeInTheDocument();
});
```

(The existing `InfoTab.test.tsx` already has a `setSnapshotWithContext` helper — extend it to take an `imageNodeId` arg.)

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/components/inspector/info/InfoTab.test.tsx`
Expected: FAIL — second assertion finds stale text.

- [ ] **Step 3: Implement**

At the top of `InfoTab` add:

```ts
const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
```

…and pass it (or use it to scope the `useImageContextSnapshot` lookup, depending on how the snapshot reader is built — if the reader already keys off active layer, then deriving "active layer of the active image node" produces the correct result).

The key is that React subscribes to `activeImageNodeId` so changes trigger a rerender.

- [ ] **Step 4: Pass + commit**

Run: `npm test -- --run` → PASS.

```bash
git add src/components/inspector/info/InfoTab.tsx src/components/inspector/info/InfoTab.test.tsx
git commit -m "fix(info-tab): rerender on activeImageNodeId change"
```

---

## Phase 3 — Classic Deletion

Remove `ImageNodeClassic`, `visualStyle` field, classic CSS block, `ObjectModeFooter`, and the persisted setting. Promote drafting tokens to root.

### Task 3.1: Inline `ImageNodeDrafting`; delete `ImageNodeClassic`

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`

- [ ] **Step 1: Delete the function and wrapper**

In `src/components/workspace/ImageNode.tsx`:
- Remove the entire `function ImageNodeClassic(...)` body.
- Remove the wrapper at lines 555–580; replace with a direct re-export:

```ts
export { ImageNodeDrafting as ImageNode } from './drafting/ImageNodeDrafting';
```

Or, if React Flow's `nodeTypes` registration needs a stable name and the drafting body wants `id, data, selected`:

```ts
export function ImageNode(props: ImageNodeProps) {
  return <ImageNodeDrafting {...props} />;
}
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: PASS. (Any orphan imports inside the deleted Classic body should be removed too — tsc / eslint will flag unused imports.)
Run: `npm test -- --run` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/ImageNode.tsx
git commit -m "refactor(image-node): drop Classic branch, drafting only"
```

### Task 3.2: Remove `visualStyle` from preferences-store

**Files:**
- Modify: `src/store/preferences-store.ts`
- Modify: `src/store/preferences-store.test.ts`

- [ ] **Step 1: Update test**

Edit `src/store/preferences-store.test.ts` to remove the `visualStyle` describe blocks. Add a migration test:

```ts
it('persist migrator drops visualStyle', () => {
  // Simulate an older persisted snapshot containing visualStyle.
  localStorage.setItem('editor-preferences', JSON.stringify({
    state: { themeMode: 'dark', visualStyle: 'classic' },
    version: 0,
  }));
  // Re-import via fresh dynamic import so persist middleware re-reads.
  // Or, call the migrator export directly if exposed.
  const migrated = (await import('./preferences-store')).migratePreferences(
    { themeMode: 'dark', visualStyle: 'classic' as unknown }, 0,
  );
  expect('visualStyle' in migrated).toBe(false);
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/store/preferences-store.test.ts`
Expected: FAIL — `visualStyle` still present.

- [ ] **Step 3: Edit `preferences-store.ts`**

- Delete `export type VisualStyle = ...`.
- Delete the `visualStyle: VisualStyle` field from `PreferencesState`.
- Delete the `setVisualStyle` method.
- Remove `visualStyle: 'classic'` from initial state.
- Remove `visualStyle: state.visualStyle` from `partialize`.
- In `applyPreferences`, remove the `root.setAttribute('data-visual-style', ...)` line.
- Add `version: 1` to the `persist` config, and a `migrate` function:

```ts
export function migratePreferences(state: unknown, version: number): unknown {
  if (typeof state !== 'object' || state === null) return state;
  const next: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  if ('visualStyle' in next) delete next.visualStyle;
  return next;
}

// In `persist(...)` config:
{
  name: 'editor-preferences',
  version: 1,
  migrate: migratePreferences,
  partialize: (state) => ({ /* fields, no visualStyle */ }),
}
```

- [ ] **Step 4: Update `applyPreferences` callers**

If `applyPreferences`'s `Pick<PreferencesState, ...>` argument type includes `visualStyle`, drop it. The function signature changes from:

```ts
state: Pick<PreferencesState, 'themeMode' | 'accentColor' | 'radiusScale' | 'visualStyle'>
```

to:

```ts
state: Pick<PreferencesState, 'themeMode' | 'accentColor' | 'radiusScale'>
```

- [ ] **Step 5: Remove App.tsx watcher**

In `src/App.tsx:213`, find `next.visualStyle !== prev.visualStyle` and remove it from the diff condition (likely a `||` chain).

- [ ] **Step 6: Verify**

Run: `npm run check` → PASS.
Run: `npm test -- --run` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/preferences-store.ts src/store/preferences-store.test.ts src/App.tsx
git commit -m "refactor(preferences): drop visualStyle field, migrate persisted state"
```

### Task 3.3: Delete `ObjectModeFooter`

**Files:**
- Delete: `src/components/workspace/ObjectModeFooter.tsx`
- Modify: any importers (tsc surfaces them)

- [ ] **Step 1: Delete the file**

```bash
git rm src/components/workspace/ObjectModeFooter.tsx
```

- [ ] **Step 2: Find and clean importers**

Run: `git grep -n 'ObjectModeFooter' src` — for each match, remove the import and the JSX usage. The drafting body uses `BottomMarginalia` already.

- [ ] **Step 3: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.

```bash
git add -u
git commit -m "refactor(workspace): delete ObjectModeFooter (drafting uses BottomMarginalia)"
```

### Task 3.4: Promote drafting CSS tokens to root

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Edit the CSS**

In `src/index.css`:
- Find the `[data-visual-style="drafting"]` block (around lines 60–80) and the dark variant.
- Move the rules into `:root` (light) and `[data-theme="dark"]` (dark) respectively.
- Delete the wrapping `[data-visual-style="drafting"]` selectors entirely.
- Delete any other `[data-visual-style="classic"]` block.

The resulting `:root` block carries the drafting palette unconditionally. `[data-theme="dark"]` carries the dark drafting palette.

- [ ] **Step 2: Verify visually**

Run: `npm run dev`. Confirm the canvas renders in the drafting palette as before (cream paper, ochre accent). Look at one image node, the inspector, the toolrail.

- [ ] **Step 3: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.

```bash
git add src/index.css
git commit -m "refactor(css): promote drafting tokens to root, drop visual-style selector"
```

### Task 3.5: Clean up classic-vs-drafting conditionals in remaining components

**Files:**
- Modify: `src/components/workspace/ImageNodeObjectsLayer.tsx`
- Modify: `src/components/workspace/SegmentMaskPreview.tsx`
- Modify: `src/components/workspace/drafting/TopMarginalia.tsx`

- [ ] **Step 1: Find all `visualStyle` / `data-visual-style` reads**

Run: `git grep -n 'visualStyle\|data-visual-style' src` — there should be zero matches after this task. Inline the drafting branch in each; delete the classic branch.

- [ ] **Step 2: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.

```bash
git add -u
git commit -m "refactor: inline drafting branches in object/preview/marginalia components"
```

---

## Phase 4 — Inspector Layer Tab + Delete Standalone Layers Panel

Replace the standalone `LayersPanel` with an Inspector tab. The on-node `LayerStrip` remains the primary navigator; the new tab is per-layer detail.

### Task 4.1: Create the `LayerTab` and `LayerRow` components

**Files:**
- Create: `src/components/inspector/layer/LayerTab.tsx`
- Create: `src/components/inspector/layer/LayerRow.tsx`
- Create: `src/components/inspector/layer/LayerTab.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/inspector/layer/LayerTab.test.tsx
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { LayerTab } from './LayerTab';

describe('LayerTab', () => {
  beforeEach(() => useEditorStore.getState().reset?.());

  it('renders one row per layer of the active image node', () => {
    useEditorStore.setState({
      imageNodes: { 'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, size: { w: 600, h: 400 }, sourceSize: { w: 600, h: 400 } } },
      activeImageNodeId: 'in-1',
      layers: [
        { id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
        { id: 'L2', type: 'brush', name: 'paint', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 1 },
      ],
      activeLayerId: 'L1',
    });
    const { getByText } = render(<LayerTab />);
    expect(getByText('photo.jpg')).toBeInTheDocument();
    expect(getByText('paint')).toBeInTheDocument();
  });

  it('shows an empty state when no image node is active', () => {
    useEditorStore.setState({ activeImageNodeId: null });
    const { getByText } = render(<LayerTab />);
    expect(getByText(/select an image/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/components/inspector/layer/LayerTab.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `LayerTab`**

```tsx
// src/components/inspector/layer/LayerTab.tsx
import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty } from '@/components/ui/empty';
import { LayerRow } from './LayerRow';

export function LayerTab() {
  const activeImageNode = useEditorStore((s) =>
    s.activeImageNodeId ? s.imageNodes[s.activeImageNodeId] : null,
  );
  const allLayers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const layers = useMemo(() => {
    if (!activeImageNode) return [];
    const idSet = new Set(activeImageNode.layerIds);
    return allLayers
      .filter((l) => idSet.has(l.id))
      .sort((a, b) => b.order - a.order);
  }, [allLayers, activeImageNode]);

  if (!activeImageNode) {
    return <Empty>Select an image to inspect its layers.</Empty>;
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col">
        {layers.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            isActive={layer.id === activeLayerId}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 4: Implement `LayerRow`**

```tsx
// src/components/inspector/layer/LayerRow.tsx
import { useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Pencil } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { Layer, BlendMode } from '@/store/layer-slice';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
];

export function LayerRow({ layer, isActive }: { layer: Layer; isActive: boolean }) {
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);

  return (
    <div
      className={[
        'flex flex-col gap-2 px-3 py-2 border-b border-separator cursor-pointer',
        isActive ? 'bg-accent-selected/10 text-text-primary' : 'text-text-secondary',
      ].join(' ')}
      onClick={() => setActiveLayer(layer.id)}
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              updateLayer(layer.id, { name: draftName.trim() || layer.name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setDraftName(layer.name); setRenaming(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-b border-separator text-sm outline-none"
            aria-label={`Rename ${layer.name}`}
          />
        ) : (
          <span className="text-sm truncate flex-1">{layer.name}</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          aria-label={`Rename ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">Opacity</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Opacity for ${layer.name}`}
          className="flex-1"
        />
        <span className="text-[10px] tabular-nums w-8 text-right">{Math.round(layer.opacity * 100)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">Blend</label>
        <select
          value={layer.blendMode}
          onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as BlendMode })}
          onClick={(e) => e.stopPropagation()}
          className="bg-transparent text-sm border-b border-separator outline-none flex-1"
          aria-label={`Blend mode for ${layer.name}`}
        >
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}
```

(The mask toggle — adding/removing `layer.layerMask` — is a follow-up; today's `LayersPanel` exposes it as a click on a thumbnail. The row above keeps parity for everything the panel surfaced *as controls*; mask UI ports over in a small task at the end of Phase 4 if it's needed.)

- [ ] **Step 5: Pass + commit**

Run: `npm test -- --run src/components/inspector/layer/LayerTab.test.tsx` → PASS.

```bash
git add src/components/inspector/layer/LayerTab.tsx src/components/inspector/layer/LayerRow.tsx src/components/inspector/layer/LayerTab.test.tsx
git commit -m "feat(inspector): add Layer tab with per-layer rows"
```

### Task 4.2: Mount the `LayerTab` in `InspectorPanel`

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Modify: `src/store/preferences-store.ts` (extend `InspectorTab`)

- [ ] **Step 1: Extend the tab union**

In `src/store/preferences-store.ts`, find `InspectorTab` and add `'layer'`:

```ts
export type InspectorTab = 'adjustments' | 'info' | 'layer' | 'crop';
```

- [ ] **Step 2: Add the tab button**

In `src/components/inspector/InspectorPanel.tsx`, between Info and Crop:

```tsx
<TabButton value="info" label="Info" active={tab === 'info'} />
<TabButton value="layer" label="Layer" active={tab === 'layer'} />
<TabButton value="crop" label="Crop" active={tab === 'crop'} disabled={cropDisabled} />
```

And in the render section:

```tsx
{tab === 'info' && <InfoTab />}
{tab === 'layer' && <LayerTab />}
{tab === 'crop' && <CropTab />}
```

Add the import:

```ts
import { LayerTab } from './layer/LayerTab';
```

- [ ] **Step 3: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.
Manual: open the app, click "Layer" tab, see one row per layer.

```bash
git add src/components/inspector/InspectorPanel.tsx src/store/preferences-store.ts
git commit -m "feat(inspector): wire Layer tab into the inspector"
```

### Task 4.3: Delete `LayersPanel`

**Files:**
- Delete: `src/components/panels/LayersPanel.tsx`
- Delete: `src/components/panels/LayersPanel.test.tsx` (if present)
- Modify: any mounting site

- [ ] **Step 1: Find mount site**

Run: `git grep -n 'LayersPanel\|LayersPanelBody' src` — for each match outside the deleted file, remove the import and the JSX (or refactor to use `LayerTab` if there's a sidebar that needs filling).

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/panels/LayersPanel.tsx
# and any test file
```

- [ ] **Step 3: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.
Manual: confirm the standalone Layers panel is gone, the LayerStrip on the node still works, and the Inspector → Layer tab is the only sidebar place that exposes per-layer detail.

```bash
git add -u
git commit -m "refactor(layers): delete standalone LayersPanel"
```

---

## Phase 5 — Adjustment Binding Alignment

Every `backendTools.proposeStack` call ships an explicit `scope` derived from `(activeLayerId, activeObjectId)`. No more silent `{ kind: 'global' }` defaults from the toolrail / inspector promote paths.

### Task 5.1: Add a helper `scopeFromSelection`

**Files:**
- Create: `src/lib/scope-from-selection.ts`
- Create: `src/lib/scope-from-selection.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/scope-from-selection.test.ts
import { describe, it, expect } from 'vitest';
import { scopeFromSelection } from './scope-from-selection';

describe('scopeFromSelection', () => {
  it('returns global when no object is active', () => {
    expect(scopeFromSelection(null)).toEqual({ kind: 'global' });
  });
  it('returns mask scope when an object is active', () => {
    expect(scopeFromSelection('m-7')).toEqual({ kind: 'mask', mask_id: 'm-7' });
  });
});
```

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/lib/scope-from-selection.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/scope-from-selection.ts
import type { Scope } from '@/types/scope';

export function scopeFromSelection(activeObjectId: string | null): Scope {
  return activeObjectId === null
    ? { kind: 'global' }
    : { kind: 'mask', mask_id: activeObjectId };
}
```

- [ ] **Step 4: Pass + commit**

Run: `npm test -- --run src/lib/scope-from-selection.test.ts` → PASS.

```bash
git add src/lib/scope-from-selection.ts src/lib/scope-from-selection.test.ts
git commit -m "feat(scope): add scopeFromSelection helper"
```

### Task 5.2: Use the helper in `inspector/adjustments/promote.ts`

**Files:**
- Modify: `src/components/inspector/adjustments/promote.ts`
- Modify: `src/components/inspector/adjustments/promote.test.ts`

- [ ] **Step 1: Write/extend failing test**

Add a case asserting that `promoteToCanvas` ships the active object's scope:

```ts
it('uses activeObjectId for scope when set', () => {
  useEditorStore.setState({ activeObjectId: 'mask-42' });
  promoteToCanvas('S1', 'curves', 'L1');
  // assert the recorded proposeStack call args.scope === { kind: 'mask', mask_id: 'mask-42' }
});
```

(Use the existing test seam in `promote.test.ts` that intercepts `backendTools.proposeStack`.)

- [ ] **Step 2: Run failing**

Run: `npm test -- --run src/components/inspector/adjustments/promote.test.ts`
Expected: FAIL — args.scope is still `{ kind: 'global' }`.

- [ ] **Step 3: Implement**

In `src/components/inspector/adjustments/promote.ts`:

```ts
import { scopeFromSelection } from '@/lib/scope-from-selection';

export function promoteToCanvas(sessionId: string | null, toolId: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  void backendTools.proposeStack(sessionId, {
    intent: toolId,
    scope,
    forced_ops: [toolId],
    layerId,
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
  void backendTools.proposeStack(sessionId, {
    intent: `${toolId}:${paramKey}`,
    scope,
    forced_ops: [toolId],
    layerId,
    origin: 'tool_invoked',
  });
}
```

- [ ] **Step 4: Pass + commit**

Run: `npm test -- --run` → PASS.

```bash
git add src/components/inspector/adjustments/promote.ts src/components/inspector/adjustments/promote.test.ts
git commit -m "fix(promote): bind adjustments to active object scope"
```

### Task 5.3: Use the helper in `colour-band-spawn` and `apply-adjustment`

**Files:**
- Modify: `src/lib/colour-band-spawn.ts`
- Modify: `src/lib/tool-manifest/tools/apply-adjustment.ts`
- Modify: existing tests for these modules (or add coverage if missing)

- [ ] **Step 1: Edit `colour-band-spawn.ts`**

```ts
import { scopeFromSelection } from '@/lib/scope-from-selection';

export function promoteSingleBand(sessionId: string | null, band: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  void backendTools.proposeStack(sessionId, {
    intent: `HSL ${band}`,
    scope,
    preset_id: `tone_${band}`,
    layerId,
    origin: 'tool_invoked',
  });
}
```

- [ ] **Step 2: Edit `apply-adjustment.ts`**

Around line 67, the existing variable `resolved` is the scope being passed. If `resolved` already derives from the active selection, this file is correct. If not, change to:

```ts
const resolved = scopeFromSelection(useEditorStore.getState().activeObjectId);
```

- [ ] **Step 3: Add unit test for `promoteSingleBand`**

If no test file exists, create `src/lib/colour-band-spawn.test.ts` with the same pattern as `promote.test.ts`.

- [ ] **Step 4: Pass + commit**

Run: `npm run check && npm test -- --run` → PASS.

```bash
git add -u
git commit -m "fix(spawn): colour-band and apply-adjustment derive scope from selection"
```

### Task 5.4: Surface the binding in the Adjustments tab header

**Files:**
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.tsx`

- [ ] **Step 1: Add a one-line header**

At the top of the accordion body:

```tsx
const activeLayer = useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId));
const activeObjectId = useEditorStore((s) => s.activeObjectId);
const objectName = useImageNodeObjects(
  useEditorStore((s) => s.activeImageNodeId ?? ''),
).find((o) => o.id === activeObjectId)?.label ?? 'Whole image';

return (
  <div className="flex flex-col">
    <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-text-secondary border-b border-separator">
      Targets: <span className="text-text-primary">{objectName}</span>
      {activeLayer && <> on <span className="text-text-primary">{activeLayer.name}</span></>}
    </div>
    {/* existing accordion content */}
  </div>
);
```

- [ ] **Step 2: Verify + commit**

Run: `npm run check && npm test -- --run` → PASS.
Manual: with an active image node, click an Object marker → the Adjustments tab header reads "Targets: <object name> on <layer name>". Click empty canvas (no object) → reads "Targets: Whole image".

```bash
git add src/components/inspector/adjustments/AdjustmentsAccordion.tsx
git commit -m "feat(inspector): show current adjustment binding in tab header"
```

### Task 5.5: End-to-end audit — every `proposeStack` call ships a derived scope

**Files:**
- Touch: every remaining `proposeStack` call site (Cmd+K, autonomous, toolrail).

- [ ] **Step 1: Audit**

Run: `git grep -n 'proposeStack' src` and inspect each call site. For each:

1. If `args.scope` is hard-coded to `{ kind: 'global' }`, replace with `scopeFromSelection(activeObjectId)`.
2. If `args.scope` is derived from a Scope param that came from elsewhere (e.g. autonomous backend), leave it — the backend is authoritative for `mcp_autonomous`.
3. If the call has no `args.scope` field today, add one derived from the active selection.

- [ ] **Step 2: Verify**

Run: `npm run check && npm test -- --run` → PASS.
Manual: click an Object marker, then a toolrail tool — the new widget binds to that mask. Re-click the marker (deselect), trigger the same tool — the new widget binds to whole image.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "fix(spawn): all three propose paths derive scope from active selection"
```

---

## Final Verification

- [ ] **Step 1: Full check + tests**

```bash
npm run check && npm test -- --run
```

Both green.

- [ ] **Step 2: Manual flow**

1. Open the editor. No selection → toolrail disabled.
2. Add image A → it activates. Add image B → selection stays on A; toast says "Image added".
3. Click image B → Info tab updates to B's metadata.
4. Click an Object marker on B → marker + leader line highlight; Adjustments tab header reads "Targets: <object> on <layer>".
5. Drag a Light slider → the widget binds to the marker's mask.
6. Re-click the marker → marker clears; next widget binds to whole image.
7. Inspector → Layer tab shows one row per layer of B; clicking a row sets active layer.
8. Confirm no Classic UI: `git grep -n 'visualStyle\|ImageNodeClassic\|ObjectModeFooter\|data-visual-style' src` returns nothing.

- [ ] **Step 3: Update CLAUDE.md if needed**

The project root `CLAUDE.md` mentions a standalone Layers panel and "Layers panel with drag reorder" under panels — update those lines to point to the Inspector Layer tab.

```bash
git add CLAUDE.md
git commit -m "docs(claude): update layers panel notes after Inspector Layer tab move"
```

---

## Out of Scope (reminder from spec)

- `.edp` save/open format — follow-up spec.
- Brush / text pixel layers gaining their own adjustment graph.
- Multi-image Objects.
