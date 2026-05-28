# Engine SSoT Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip non-MVP code and consolidate state so the backend `SessionStateSnapshot` is the single source of truth for all pixel-affecting data, with three widget spawn paths (Cmd+K palette, autonomous backend analyze, toolrail buttons) all routing through `backendTools.propose_widget`.

**Architecture:** Five phases on `feat/canvas-centric-ui`. Phase 1 deletes graph/.edp/text/crop/brush (pure delete day). Phase 2 unifies the two `Scope` types. Phase 3 moves adjustment data to the backend `operation_graph` and rewires the WebGL pipeline to a single source. Phase 4 merges four selection-related stores into one slice. Phase 5 renames + lint sweep + smoke test.

**Tech Stack:** React 19 + Vite + TypeScript (strict), Zustand v5 + Immer, Fabric.js v7, WebGL custom shaders, FastAPI + Anthropic SDK backend, vitest (frontend), pytest (backend), SSE for state events.

**Spec:** `docs/superpowers/specs/2026-05-28-engine-ssot-reset-design.md`

---

## File inventory

### Delete (Phase 1 — MVP strip)

```
# Graph editor
src/components/graph/                                  (entire folder)
src/core/derived-graph.ts
src/store/graph-store.ts

# Save/load + persistence
src/core/serializer.ts
src/core/serializer.test.ts
src/core/session-storage.ts
src/core/transaction.ts
src/core/history-tree.ts
src/core/history-tree.test.ts

# Crop
src/lib/crop-display.ts
src/lib/crop-rect.ts
src/lib/crop-utils.ts
src/store/crop-editing-slice.ts
src/components/canvas/CropOverlay.tsx
src/tools/crop-tool.tsx

# Text
src/tools/text-tool.tsx

# Brush + leftover tools
src/tools/brush-tool.tsx
src/tools/brush-mask-tool.tsx
src/tools/select-box-tool.ts
```

### Delete (Phase 3+5 — SSoT cleanup)

```
src/lib/materialize-adjustments.ts
src/lib/materialize-adjustments.test.ts
src/lib/widget-projection.ts
src/lib/widget-projection.test.ts
src/lib/scope-match.ts
src/lib/scope-match.test.ts
src/store/focus-slice.ts
src/store/focus-slice.test.ts
src/store/segment-selection-slice.ts
src/store/segment-selection-slice.test.ts
src/store/cursor-bind-slice.ts
src/store/cursor-bind-slice.test.ts
```

### Create

```
src/store/selection-slice.ts                    (Phase 4)
src/store/selection-slice.test.ts               (Phase 4)
src/hooks/useLayerWidgets.ts                    (Phase 3)
src/hooks/useLayerWidgets.test.ts               (Phase 3)
```

### Rewrite

```
src/types/scope.ts                              (Phase 2)
src/types/widget.ts                             (Phase 2)
src/types/operation-graph.ts                    (Phase 3)
src/core/history.ts                             (Phase 1 — linear stack)
src/core/document.ts                            (Phase 1 — drop save/restore/transactions)
src/store/layer-slice.ts                        (Phase 3 — drop adjustmentStack + actions)
src/store/segmentation-slice.ts                 (Phase 4 — keep encoderState only)
src/store/tool-slice.ts                         (Phase 1 — drop compose/graph modes)
src/store/index.ts                              (multi-phase)
src/components/widget/CanvasWidgetLayer.tsx     (Phase 3)
src/components/canvas/useAdjustmentPipeline.ts  (Phase 3)
src/components/toolbar/MenuBar.tsx              (Phase 1)
src/components/toolbar/Toolbar.tsx              (Phase 3)
src/lib/scope-to-mask.ts                        (Phase 2)
src/lib/select-pipeline-nodes.ts                (Phase 3)
src/lib/palette-actions.ts                      (Phase 3)
src/App.tsx                                     (Phase 1)
package.json                                    (Phase 1 — drop deps)
```

### Rename (Phase 5)

```
src/lib/tool-registry.ts          → src/lib/canvas-tool-registry.ts (CanvasToolRegistry)
src/lib/tool-manifest/registry.ts → src/lib/tool-manifest/llm-tool-registry.ts (LlmToolRegistry)
```

### Backend (Phase 3)

```
backend/app/schemas/operation_graph.py     (modify)
backend/app/schemas/widget.py              (verify)
backend/app/tools/propose_widget.py        (modify)
backend/app/tools/accept_widget.py         (modify)
backend/app/tools/delete_widget.py         (modify)
backend/tests/test_propose_widget.py       (new tests)
backend/tests/test_accept_widget.py        (new tests)
backend/tests/test_delete_widget.py        (new tests)
```

---

## Phase 1 — MVP strip (1 day)

### Task 1: Delete unused tool files

**Files:**
- Delete: `src/tools/brush-tool.tsx`
- Delete: `src/tools/brush-mask-tool.tsx`
- Delete: `src/tools/select-box-tool.ts`

These are no longer registered in `App.tsx` (the canvas-centric design dropped them) but still on disk.

- [ ] **Step 1: Verify no remaining importers**

```bash
grep -rln "from '@/tools/brush-tool'\|from '@/tools/brush-mask-tool'\|from '@/tools/select-box-tool'" src/
```

Expected: no output (no importers).

- [ ] **Step 2: Delete the files**

```bash
rm src/tools/brush-tool.tsx src/tools/brush-mask-tool.tsx src/tools/select-box-tool.ts
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(strip): remove brush, brush-mask, select-box tools (not registered)"
```

---

### Task 2: Delete text tool + remove TextMeta field

**Files:**
- Delete: `src/tools/text-tool.tsx`
- Modify: `src/store/layer-slice.ts` (remove `TextMeta` interface + `textMeta` field on `Layer`)
- Modify: `src/App.tsx` (remove `TextTool` import + registration)

- [ ] **Step 1: Find all TextMeta / textMeta references**

```bash
grep -rln "TextMeta\|textMeta" src/
```

Note the list; expect: layer-slice.ts, text-tool.tsx, possibly EditorCanvas.tsx, document/serializer.ts.

- [ ] **Step 2: Delete the tool file**

```bash
rm src/tools/text-tool.tsx
```

- [ ] **Step 3: Remove TextTool from App.tsx**

Edit `src/App.tsx`: delete the `import { TextTool } from '@/tools/text-tool';` line and the `ToolRegistry.register(TextTool);` line.

- [ ] **Step 4: Remove TextMeta from layer-slice.ts**

Edit `src/store/layer-slice.ts`:

- Delete the `TextMeta` interface block (lines 37–46 currently).
- Remove the `textMeta?: TextMeta;` field from the `Layer` interface.

- [ ] **Step 5: Remove any remaining textMeta consumers**

Re-run `grep -rln "TextMeta\|textMeta" src/`. For each hit, remove the line or block — text rendering is gone.

- [ ] **Step 6: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "chore(strip): remove text tool + TextMeta from Layer"
```

---

### Task 3: Delete crop system

**Files:**
- Delete: `src/tools/crop-tool.tsx`
- Delete: `src/components/canvas/CropOverlay.tsx`
- Delete: `src/store/crop-editing-slice.ts`
- Delete: `src/lib/crop-display.ts`, `src/lib/crop-rect.ts`, `src/lib/crop-utils.ts`
- Modify: `src/store/layer-slice.ts` (remove `CropMeta` interface + `cropMeta` field)
- Modify: `src/App.tsx` (remove `CropTool` + `CropCanvasOverlay` imports/mounts)
- Modify: `src/components/canvas/useAdjustmentPipeline.ts` (remove `applyCropForExport` + `useCropEditingStore` usages)
- Modify: `src/components/toolbar/MenuBar.tsx` (remove crop-related menu items if any)

- [ ] **Step 1: Find all crop references**

```bash
grep -rln "crop-tool\|CropOverlay\|crop-editing\|crop-display\|crop-rect\|crop-utils\|CropMeta\|cropMeta\|useCropEditingStore" src/
```

Save the list.

- [ ] **Step 2: Delete the crop files**

```bash
rm src/tools/crop-tool.tsx \
   src/components/canvas/CropOverlay.tsx \
   src/store/crop-editing-slice.ts \
   src/lib/crop-display.ts \
   src/lib/crop-rect.ts \
   src/lib/crop-utils.ts
```

- [ ] **Step 3: Strip crop from layer-slice.ts**

Edit `src/store/layer-slice.ts`:

Delete the `CropMeta` interface block (lines 48–60 currently) and the `cropMeta?: CropMeta;` field on `Layer`. Also remove `layer.cropMeta = undefined;` line inside `revertAll`.

- [ ] **Step 4: Strip crop from App.tsx**

Edit `src/App.tsx`:

- Delete `import { CropCanvasOverlay } from '@/components/canvas/CropOverlay';`
- Delete `import { useCropEditingStore } from '@/store/crop-editing-slice';`
- Delete `import { CropTool } from '@/tools/crop-tool';`
- Delete `ToolRegistry.register(CropTool);` line.
- In `MainLayout`, delete the `const isCropEditing = useCropEditingStore((s) => s.isCropEditing);` line.
- Replace `const showHUD = !isGraph;` with itself (unchanged, but `isCropEditing` references in JSX need removal).
- Delete `{isCropEditing && <CropCanvasOverlay canvasRef={canvasRef} />}`.
- Replace `{showHUD && !isCropEditing && toolDef?.CanvasOverlay && …}` with `{showHUD && toolDef?.CanvasOverlay && <toolDef.CanvasOverlay ctx={toolContext} />}`.
- In status bar, replace `{isCropEditing ? 'crop' : activeTool}` with `{activeTool}`.

- [ ] **Step 5: Strip crop from useAdjustmentPipeline.ts**

Edit `src/components/canvas/useAdjustmentPipeline.ts`:

- Delete `import { useCropEditingStore } from '@/store/crop-editing-slice';`
- Delete `import { applyCropForExport } from '@/lib/crop-display';`
- Delete `import type { Adjustment, CropMeta } from '@/store/layer-slice';` → replace with `import type { Adjustment } from '@/store/layer-slice';`
- In the `prevRef` initial object: remove `cropMeta: undefined`.
- Inside `updateFabricImage`: replace the entire crop-conditional block (`if (cropMeta && !inCropMode) { … } else { displayCanvas = outputCanvas; }`) with just `displayCanvas = outputCanvas;`.
- Inside `updateFabricImage`: remove `if (cropMeta && !inCropMode) { fabricImg.set({ angle: 0, flipX: false, flipY: false }); }`.
- Inside `recompute()`: remove all `cropMeta` references in the dirty-check.

- [ ] **Step 6: Run check**

```bash
npm run check
```

If failures point to remaining crop consumers (e.g., MenuBar.tsx, EditorCanvas.tsx), strip those references too. Expected after full sweep: PASS.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "chore(strip): remove crop system (tool, overlay, slice, lib, layer field)"
```

---

### Task 4: Delete graph editor

**Files:**
- Delete: entire `src/components/graph/` folder
- Delete: `src/core/derived-graph.ts`
- Delete: `src/store/graph-store.ts`
- Modify: `src/App.tsx` (remove graph imports + mode handling)
- Modify: `src/core/document.ts` (remove all `useGraphStore` usages)
- Modify: `src/store/tool-slice.ts` (remove `'graph'` from `EditorMode`)
- Modify: `src/components/toolbar/MenuBar.tsx` (remove "Graph mode" menu item if present)

- [ ] **Step 1: Verify graph editor is not currently mounted**

```bash
grep -n "GraphEditor\|useDerivedGraph\|useGraphStore" src/App.tsx
```

Expected: only commented-out references (the canvas-centric design already disabled mounting).

- [ ] **Step 2: Delete the graph files**

```bash
rm -rf src/components/graph/
rm src/core/derived-graph.ts
rm src/store/graph-store.ts
```

- [ ] **Step 3: Strip graph references from App.tsx**

Edit `src/App.tsx`:

- Delete commented-out `// const GraphEditor = lazy(...)` block.
- Delete `import { registerAllNodes } from '@/components/graph/registerNodes';`
- Delete `import { initNodeTypes } from '@/components/graph/nodeTypes';`
- Delete the `registerAllNodes();` and `initNodeTypes();` calls.
- Delete the `const isGraph = editorMode === 'graph' && layers.length > 0;` line in `MainLayout`.
- Replace `className={isGraph ? 'w-0 h-0 overflow-hidden absolute' : 'absolute inset-0'}` with `className="absolute inset-0"`.
- Delete the commented-out `{/* {isGraph && ( … )} */}` block.

- [ ] **Step 4: Strip useGraphStore from document.ts**

Edit `src/core/document.ts`:

- Delete `import { useGraphStore } from '@/store/graph-store';`
- Delete the `graphPositions` field from `captureState()` return.
- Delete the `useGraphStore.getState().setGraphPositions(snapshot.graphPositions);` line in `restoreState`.
- Delete all `useGraphStore.getState()...` calls in `persistSession`, `newDocument`, `openImage`, `openEdp`, `save`, `restoreSession`.
- Update the type of `SerializableState` in `src/core/types.ts` to drop `graphPositions` (verify file path first).

- [ ] **Step 5: Drop 'graph' from EditorMode**

Edit `src/store/tool-slice.ts`:

Find the `EditorMode` type definition. Replace the union to:

```ts
export type EditorMode = 'develop' | 'compose';
```

Update any code that checks for `'graph'` mode — those checks become unreachable; remove them.

- [ ] **Step 6: Run check**

```bash
npm run check
```

Expected: PASS. If failures point to remaining graph imports (e.g., MenuBar.tsx), strip them.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "chore(strip): remove graph editor (folder, store, derived-graph)"
```

---

### Task 5: Replace history.ts with linear stack

**Files:**
- Rewrite: `src/core/history.ts`
- Delete: `src/core/history-tree.ts`
- Delete: `src/core/history-tree.test.ts`
- Delete: `src/core/transaction.ts`
- Modify: `src/core/document.ts` (remove transaction methods)

- [ ] **Step 1: Write the failing test**

Create `src/core/history.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as history from './history';

interface FakeSnap { value: number }

describe('history (linear stack)', () => {
  beforeEach(() => history.clear());

  it('returns null undo when empty', () => {
    expect(history.undo()).toBeNull();
  });

  it('push then undo returns the prior snap', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    expect(history.undo<FakeSnap>()).toEqual({ value: 1 });
  });

  it('undo then redo restores', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.undo<FakeSnap>();
    expect(history.redo<FakeSnap>()).toEqual({ value: 2 });
  });

  it('push truncates redo tail', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.push<FakeSnap>({ value: 3 });
    history.undo<FakeSnap>();
    history.undo<FakeSnap>();
    history.push<FakeSnap>({ value: 99 });
    expect(history.redo<FakeSnap>()).toBeNull();
  });

  it('caps stack at MAX_ENTRIES', () => {
    history.initWith<FakeSnap>({ value: 0 });
    for (let i = 1; i <= 25; i++) history.push<FakeSnap>({ value: i });
    // After 25 pushes plus initial, we should still be able to undo MAX-1 times max
    let count = 0;
    while (history.undo<FakeSnap>() !== null) count++;
    expect(count).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/history.test.ts
```

Expected: FAIL (current `history.ts` exports differ from this API).

- [ ] **Step 3: Rewrite history.ts**

Replace `src/core/history.ts` with:

```ts
const MAX_ENTRIES = 20;

let stack: unknown[] = [];
let cursor = -1;

export function initWith<T>(snap: T): void {
  stack = [snap];
  cursor = 0;
}

export function push<T>(snap: T): void {
  stack = stack.slice(0, cursor + 1);
  stack.push(snap);
  if (stack.length > MAX_ENTRIES) {
    stack.shift();
  } else {
    cursor++;
  }
  if (stack.length === MAX_ENTRIES + 1) {
    stack = stack.slice(1);
  }
  cursor = stack.length - 1;
}

export function undo<T>(): T | null {
  if (cursor <= 0) return null;
  cursor--;
  return stack[cursor] as T;
}

export function redo<T>(): T | null {
  if (cursor >= stack.length - 1) return null;
  cursor++;
  return stack[cursor] as T;
}

export function clear(): void {
  stack = [];
  cursor = -1;
}

export function canUndo(): boolean {
  return cursor > 0;
}

export function canRedo(): boolean {
  return cursor < stack.length - 1;
}
```

- [ ] **Step 4: Delete the old tree + transaction modules**

```bash
rm src/core/history-tree.ts src/core/history-tree.test.ts src/core/transaction.ts
```

- [ ] **Step 5: Strip transaction + tree from document.ts**

Edit `src/core/document.ts`:

- Delete `import * as historyTree from '@/core/history-tree';`
- Delete `import * as transaction from './transaction';`
- Delete the exports `beginTransaction`, `commitTransaction`, `rollbackTransaction` from the public `editorDocument` object.
- Inside `undoAction` and `redoAction`: remove `if (transaction.isActive()) { … }` and `transaction.rollback()` calls. Keep `await history.undo()` / `history.redo()`.
- Remove `pendingAction` block + `recordAction` exports — they integrate with the old debounced history; not needed for MVP.
- Remove `flushPendingAction` calls in undo/redo.

Replace the whole `editorDocument` export with the slimmed version (keep only: `init`, `dispose`, `newDocument`, `openImage`, `undo`, `redo`, `meta`, `pixelStore`, `history`).

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/core/history.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "feat(history): replace tree+transactions with linear stack (~80 LOC)"
```

---

### Task 6: Delete .edp save/load + IndexedDB

**Files:**
- Delete: `src/core/serializer.ts`, `src/core/serializer.test.ts`
- Delete: `src/core/session-storage.ts`
- Modify: `src/core/document.ts` (remove save/saveAs/openEdp/restoreSession)
- Modify: `src/components/toolbar/MenuBar.tsx` (remove Save/Save As/Open EDP menu items)
- Modify: `src/App.tsx` (remove `editorDocument.restoreSession()` call)

- [ ] **Step 1: Delete the persistence files**

```bash
rm src/core/serializer.ts src/core/serializer.test.ts src/core/session-storage.ts
```

- [ ] **Step 2: Strip from document.ts**

Edit `src/core/document.ts`:

- Delete `import * as serializer from './serializer';`
- Delete `import * as session from './session-storage';`
- Delete `SESSION_SAVE_DEBOUNCE_MS`, `sessionSaveTimer`, `scheduleSessionSave`, `persistSession` functions.
- Delete `save`, `saveAs`, `openEdp`, `restoreSession` functions.
- Delete `beforeUnloadHandler` block (the dirty guard).
- Delete `aiSessionUnsubscribe` block.
- Inside `dispose`: remove the `persistSession()` synchronous flush.
- Inside the public `editorDocument` export object, remove `save`, `saveAs`, `restoreSession`, `openEdp` keys.

- [ ] **Step 3: Strip from MenuBar.tsx**

Edit `src/components/toolbar/MenuBar.tsx`:

Find and remove menu items / event handlers for "Save", "Save As", "Open Project (.edp)" — keep "Open Image" and "Export as PNG/JPG" only.

- [ ] **Step 4: Strip from App.tsx**

Edit `src/App.tsx`:

In the first `useEffect`, remove the line `editorDocument.restoreSession().catch(() => {});`.

In the HMR `useEffect`, remove `editorDocument.restoreSession().catch(() => {});`.

- [ ] **Step 5: Run check**

```bash
npm run check
```

If errors point to other files reading `editorDocument.save` etc., strip those callers. Expected after sweep: PASS.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "chore(strip): remove .edp serializer + IndexedDB session storage"
```

---

### Task 7: Drop unused npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify deps are no longer used**

```bash
grep -rln "from '@xyflow/react'\|from 'elkjs'\|from 'fflate'" src/
```

Expected: no output.

- [ ] **Step 2: Remove from package.json**

Edit `package.json` `dependencies`: delete the `@xyflow/react`, `elkjs`, and `fflate` lines.

- [ ] **Step 3: Reinstall**

```bash
npm install
```

Expected: lockfile updated, no errors.

- [ ] **Step 4: Verify build**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): drop @xyflow/react, elkjs, fflate (graph + edp gone)"
```

---

### Task 8: Phase 1 smoke verification

**No file changes — manual verification gate.**

- [ ] **Step 1: Boot dev server**

```bash
npm run dev
```

Open http://localhost:5173/ (or whatever port Vite picks).

- [ ] **Step 2: Manual smoke test**

Verify in the browser:
- Empty state shows the "No image loaded" panel with the Open Image button.
- Click "Open Image", pick a JPG/PNG → image appears on canvas.
- Toolrail (left) shows only Light, Color, Kelvin, Curves, Levels, Filters buttons.
- No "Save" / "Save As" / "Open Project" entries in the File menu.
- Console: no errors.
- Reload the page → image is gone (session restore was removed — expected).

- [ ] **Step 3: Commit if any sweep fixes needed**

If you found stragglers, commit them with `chore(strip): mop up remaining references`. Otherwise skip.

---

## Phase 2 — Type unification (1 day)

### Task 9: Write tests for new Scope union

**Files:**
- Create: `src/types/scope.test.ts`

- [ ] **Step 1: Write the test**

Create `src/types/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scopeEquals, GLOBAL_SCOPE, type Scope } from './scope';

describe('scopeEquals', () => {
  it('global equals global', () => {
    expect(scopeEquals(GLOBAL_SCOPE, { kind: 'global' })).toBe(true);
  });

  it('mask equals same mask_id', () => {
    const a: Scope = { kind: 'mask', mask_id: 'm1' };
    const b: Scope = { kind: 'mask', mask_id: 'm1' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('mask different mask_id is not equal', () => {
    const a: Scope = { kind: 'mask', mask_id: 'm1' };
    const b: Scope = { kind: 'mask', mask_id: 'm2' };
    expect(scopeEquals(a, b)).toBe(false);
  });

  it('mask:proposed equals same label', () => {
    const a: Scope = { kind: 'mask:proposed', label: 'face' };
    const b: Scope = { kind: 'mask:proposed', label: 'face' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('named_region equals same label', () => {
    const a: Scope = { kind: 'named_region', label: 'sky' };
    const b: Scope = { kind: 'named_region', label: 'sky' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('different kinds are not equal', () => {
    const a: Scope = { kind: 'global' };
    const b: Scope = { kind: 'mask', mask_id: 'm1' };
    expect(scopeEquals(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/scope.test.ts
```

Expected: FAIL (current Scope type doesn't match the new shape).

- [ ] **Step 3: Rewrite src/types/scope.ts**

Replace the entire contents with:

```ts
export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string };

export const GLOBAL_SCOPE: Scope = { kind: 'global' };

export function scopeEquals(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'global') return true;
  if (a.kind === 'mask' && b.kind === 'mask') return a.mask_id === b.mask_id;
  if (a.kind === 'mask:proposed' && b.kind === 'mask:proposed') return a.label === b.label;
  if (a.kind === 'named_region' && b.kind === 'named_region') return a.label === b.label;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(scope): unified Scope union (mask, mask:proposed, named_region, global)"
```

---

### Task 10: Update widget.ts to re-export Scope

**Files:**
- Modify: `src/types/widget.ts`

- [ ] **Step 1: Replace local Scope with re-export**

Edit `src/types/widget.ts`:

- Find lines 3–7 (the local `Scope` definition).
- Replace with: `export type { Scope } from './scope';`
- Find any other local references to the old `mask:click` kind in this file — there should be none after the deletion above.

- [ ] **Step 2: Run check**

```bash
npm run check 2>&1 | head -60
```

Expected: TypeScript errors at every site that uses `kind: 'mask:click'` — these will be fixed in Task 11.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "refactor(types): widget.ts re-exports Scope from scope.ts"
```

---

### Task 11: Codemod mask:click → mask everywhere

**Files:**
- Modify: every file that uses `'mask:click'` or `mask_id` (verify list first)

- [ ] **Step 1: Find all sites**

```bash
grep -rln "'mask:click'\|kind: 'mask:click'" src/
```

Expected hits include: `widget-projection.ts`, `CanvasWidgetLayer.tsx`, `scope-to-mask.ts`, possibly `useSegmentInteraction.ts` (if not already deleted).

- [ ] **Step 2: Replace literal strings**

For each file in the list, replace `'mask:click'` with `'mask'`.

- [ ] **Step 3: Remove `mask:click`-specific narrowings**

Search for code that destructures or checks `scope.kind === 'mask:click'` and references `mask_id` — these are now just the unified `mask` kind. Adjust any field-name mismatches.

- [ ] **Step 4: Run check**

```bash
npm run check 2>&1 | head -40
```

Expected: PASS (or only remaining errors related to the dual-type cast in `widget-projection.ts`, fixed in Task 14).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(scope): rename mask:click → mask everywhere"
```

---

### Task 12: Delete scope-match.ts

**Files:**
- Delete: `src/lib/scope-match.ts`
- Delete: `src/lib/scope-match.test.ts`
- Modify: every caller of `scopeMatches`

- [ ] **Step 1: Find all callers**

```bash
grep -rln "from '@/lib/scope-match'\|scopeMatches" src/
```

Expected: `CanvasWidgetLayer.tsx` (line ~13, ~306), possibly inspector components.

- [ ] **Step 2: Replace callers**

For each caller, replace `scopeMatches(activeScope, w.scope as never)` with an inline computation using `scopeEquals`:

```ts
import { scopeEquals } from '@/types/scope';
// ...
const matches = activeScope === null || scopeEquals(activeScope, w.scope);
```

Add the import if not present.

- [ ] **Step 3: Delete the files**

```bash
rm src/lib/scope-match.ts src/lib/scope-match.test.ts
```

- [ ] **Step 4: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(scope): delete scope-match.ts (callers use scopeEquals directly)"
```

---

### Task 13: Simplify scope-to-mask.ts

**Files:**
- Modify: `src/lib/scope-to-mask.ts`

- [ ] **Step 1: Replace contents**

Replace `src/lib/scope-to-mask.ts` with:

```ts
import { maskStore, type Mask } from '@/core/mask-store';
import type { Scope } from '@/types/scope';

/** Resolve a Scope to a concrete mask. Returns null for global / no-mask scopes. */
export function scopeToMask(scope: Scope): Mask | null {
  if (scope.kind === 'global') return null;
  if (scope.kind === 'mask') return maskStore.get(scope.mask_id) ?? null;
  // mask:proposed | named_region — look up by label
  const label = scope.label;
  for (const mask of maskStore.all()) {
    if (mask.label === label) return mask;
  }
  return null;
}
```

- [ ] **Step 2: Update the existing test**

Edit `src/lib/scope-to-mask.test.ts` so all `Scope` literals use the new shape (`{ kind: 'mask', mask_id: ... }` instead of `{ kind: 'mask:click', mask_id: ... }`, and `{ kind: 'mask', maskRef: ... }` → `{ kind: 'mask', mask_id: ... }`).

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/scope-to-mask.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(scope): simplify scope-to-mask to the single Scope union"
```

---

### Task 14: Remove `as unknown as Scope` casts

**Files:**
- Modify: `src/lib/widget-projection.ts` (will be fully deleted in Phase 5; for now just clean the casts)

- [ ] **Step 1: Find the casts**

```bash
grep -n "as unknown as Scope\|as { kind: string }" src/lib/widget-projection.ts
```

- [ ] **Step 2: Replace each cast with a direct read**

Edit `src/lib/widget-projection.ts`:

- Line ~62: `const widgetScope = adj.scope as unknown as Scope;` → `const widgetScope = adj.scope;`
- Lines ~26–29: delete the `if ((scope as { kind: string }).kind === 'mask') { … }` branch entirely (the unified Scope has only `mask`, which is covered by an earlier branch).
- Remove the `WidgetAnchor` import if no longer needed.

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: PASS. If TypeScript complains that `Adjustment.scope` (frontend) and Widget `Scope` (now shared) differ, that's because they don't — both now refer to the unified type.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(scope): remove unsafe Scope casts (unified type)"
```

---

### Task 15: Phase 2 smoke verification

- [ ] **Step 1: Boot dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manual smoke**

- Open image → canvas displays it.
- Click on a region of the image → if SAM is loaded, mask outline appears (verifies scope-to-mask still works).
- Inspector renders without console errors.
- Toolrail buttons still functional (will be rewired in Phase 3, but should not crash).

If errors, debug and commit fixes before Phase 3.

---

## Phase 3 — Backend SSoT for adjustments (2 days)

### Task 16: Backend test for Node.layer_id

**Files:**
- Modify: `backend/tests/test_schemas.py` (add a test)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from app.schemas.operation_graph import Node

def test_node_carries_layer_id():
    node = Node(
        id="n1",
        type="curves",
        scope={"kind": "global"},
        params={"intensity": 0.5},
        inputs=[],
        layer_id="layer_a",
    )
    assert node.layer_id == "layer_a"

def test_node_layer_id_required():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Node(
            id="n1",
            type="curves",
            scope={"kind": "global"},
            params={},
            inputs=[],
        )  # missing layer_id
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && source .venv/bin/activate && pytest tests/test_schemas.py -v
```

Expected: FAIL on `test_node_carries_layer_id` (field doesn't exist yet).

- [ ] **Step 3: Add layer_id to Node schema**

Edit `backend/app/schemas/operation_graph.py`:

Find the `Node` class. Add the `layer_id: str` field (no default — required).

```python
class Node(BaseModel):
    id: str
    type: str
    scope: Scope
    params: dict[str, float | str | bool]
    inputs: list[str]
    layer_id: str
    widget_id: str  # also required — the originating Widget id (for delete_widget cleanup)
```

Verify `widget_id` is already present on Node before adding — search `class Node` in the schema file. If missing, add it (this is needed for `delete_widget` to remove the right nodes).

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_schemas.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/operation_graph.py backend/tests/test_schemas.py
git commit -m "feat(backend): Node carries layer_id field (SSoT routing key)"
```

---

### Task 17: Backend — propose_widget accepts layer_id + origin

**Files:**
- Modify: `backend/app/tools/propose_widget.py` (path may differ; check `backend/app/tools/`)
- Modify: `backend/app/schemas/widget.py` (if WidgetOriginKind needs `tool_invoked`)
- Modify: `backend/tests/test_propose_widget.py` (or create)

- [ ] **Step 1: Verify WidgetOriginKind includes tool_invoked**

```bash
grep -n "tool_invoked\|WidgetOriginKind" backend/app/schemas/widget.py
```

If absent, add `'tool_invoked'` to the literal union.

- [ ] **Step 2: Write the failing test**

Find or create `backend/tests/test_propose_widget.py`. Add:

```python
import pytest
from app.tools.propose_widget import propose_widget

@pytest.mark.asyncio
async def test_propose_widget_accepts_layer_id(session_with_image):
    result = await propose_widget(
        session_id=session_with_image,
        intent="Brighten",
        scope={"kind": "global"},
        layer_id="layer_a",
        origin="mcp_user_prompt",
    )
    widget = result["widget"]
    assert all(node["layer_id"] == "layer_a" for node in widget["nodes"])

@pytest.mark.asyncio
async def test_propose_widget_tool_invoked_skips_llm(session_with_image, mock_anthropic_client):
    mock_anthropic_client.reset_mock()
    result = await propose_widget(
        session_id=session_with_image,
        intent="Curves",
        scope={"kind": "global"},
        layer_id="layer_a",
        origin="tool_invoked",
        fused_tool_id="curves",
    )
    assert not mock_anthropic_client.messages.create.called
    assert result["widget"]["origin"]["kind"] == "tool_invoked"
```

The fixtures `session_with_image` and `mock_anthropic_client` may need creation in `backend/tests/conftest.py` — check current contents for similar fixtures and pattern-match.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && pytest tests/test_propose_widget.py -v
```

Expected: FAIL.

- [ ] **Step 4: Add a hardcoded TOOL_DEFAULTS dict**

Create `backend/app/tools/tool_defaults.py`:

```python
"""Per-tool default node + binding payloads for tool_invoked widgets.

When the user clicks a toolrail button (Light, Curves, etc.) the backend
ships these defaults instead of calling the LLM. Keys must match the
fused_tool_id sent by the frontend.
"""
from typing import Any

TOOL_DEFAULTS: dict[str, dict[str, Any]] = {
    "light": {
        "nodes": [{"type": "basic", "params": {"exposure": 0.0, "contrast": 0.0,
                                                 "highlights": 0.0, "shadows": 0.0}}],
        "bindings": [
            {"param_key": "exposure", "label": "Exposure", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "contrast", "label": "Contrast", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            # ... highlights, shadows
        ],
    },
    "curves": {
        "nodes": [{"type": "curves", "params": {"intensity": 1.0}}],
        "bindings": [
            {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
             "value": 1.0, "default": 1.0},
        ],
    },
    "levels": {"nodes": [{"type": "levels", "params": {"black": 0.0, "white": 1.0, "gamma": 1.0}}],
               "bindings": [...]},  # fill in similarly
    "kelvin": {"nodes": [{"type": "kelvin", "params": {"temp": 5500.0, "tint": 0.0}}],
               "bindings": [...]},
    "color": {"nodes": [{"type": "basic", "params": {"saturation": 0.0, "vibrance": 0.0}}],
              "bindings": [...]},
    "filter": {"nodes": [{"type": "lut", "params": {"intensity": 1.0}}],
               "bindings": [...]},
}
```

Fill in the elided bindings using the same shape — one binding per param. Match exact ranges to those used in the frontend `ProcessingDefinition`s under `src/processing/`.

- [ ] **Step 5: Implement the handler changes**

Edit `backend/app/tools/propose_widget.py`:

1. Add `layer_id: str` and `origin: WidgetOriginKind` to the input schema (Pydantic).
2. After receiving input, pass `layer_id` and `widget_id` through to every Node in the produced operation_graph.
3. Add an early-return branch for `origin == "tool_invoked"`:

```python
from app.tools.tool_defaults import TOOL_DEFAULTS

if input.origin == "tool_invoked":
    defaults = TOOL_DEFAULTS.get(input.fused_tool_id)
    if not defaults:
        raise ToolError(f"Unknown fused_tool_id: {input.fused_tool_id}")
    widget_id = generate_widget_id()
    widget = Widget(
        id=widget_id,
        intent=input.intent,
        scope=input.scope,
        origin=WidgetOrigin(kind="tool_invoked"),
        nodes=[
            Node(
                id=generate_node_id(),
                type=n["type"],
                scope=input.scope,
                params=n["params"],
                inputs=[],
                layer_id=input.layer_id,
                widget_id=widget_id,
            )
            for n in defaults["nodes"]
        ],
        bindings=[ControlBinding(**b, target=NodeParamTarget(node_id=..., param_key=...))
                  for b in defaults["bindings"]],
        composed=False,
        preview={"kind": "none", "auto_before_after": False},
        rejected_attempts=[],
        status="accepted",  # tool click = accept
        revision=session.next_revision(),
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.snapshot.widgets.append(widget)
    session.snapshot.operation_graph.nodes.extend(widget.nodes)
    session.emit_event("widget.created", {"widget": widget.model_dump()})
    return ToolOk(widget=widget)
```

For the `origin: 'mcp_user_prompt'` / `mcp_autonomous` paths, the existing LLM-call path stays — just ensure `layer_id` and `widget_id` are plumbed through to the resulting Nodes.

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/test_propose_widget.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "feat(backend): propose_widget accepts layer_id + origin; tool_invoked skips LLM"
```

---

### Task 18: Backend — accept_widget = status flip only

**Files:**
- Modify: `backend/app/tools/accept_widget.py`
- Modify: `backend/tests/test_accept_widget.py` (or create)

- [ ] **Step 1: Write the failing test**

Append/create in `backend/tests/test_accept_widget.py`:

```python
@pytest.mark.asyncio
async def test_accept_widget_keeps_in_snapshot(session_with_widget):
    sid, widget_id = session_with_widget
    snap_before = await get_snapshot(sid)
    assert any(w["id"] == widget_id for w in snap_before["widgets"])

    await accept_widget(session_id=sid, widget_id=widget_id)

    snap_after = await get_snapshot(sid)
    found = next(w for w in snap_after["widgets"] if w["id"] == widget_id)
    assert found["status"] == "accepted"

@pytest.mark.asyncio
async def test_accept_widget_keeps_nodes_in_op_graph(session_with_widget):
    sid, widget_id = session_with_widget
    nodes_before = (await get_snapshot(sid))["operation_graph"]["nodes"]
    node_ids = {n["id"] for n in nodes_before if n.get("widget_id") == widget_id}

    await accept_widget(session_id=sid, widget_id=widget_id)

    nodes_after = (await get_snapshot(sid))["operation_graph"]["nodes"]
    node_ids_after = {n["id"] for n in nodes_after if n.get("widget_id") == widget_id}
    assert node_ids_after == node_ids
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_accept_widget.py -v
```

Expected: FAIL (current implementation removes the widget from snapshot).

- [ ] **Step 3: Rewrite the handler**

Edit `backend/app/tools/accept_widget.py`:

Replace the body of the `accept_widget` handler with:

```python
async def accept_widget(session_id: str, widget_id: str):
    session = get_session(session_id)
    widget = session.snapshot.find_widget(widget_id)
    if not widget:
        raise ToolError(f"Widget {widget_id} not found")
    widget.status = "accepted"
    session.emit_event("widget.accepted", {"widget_id": widget_id})
    return ToolOk(widget_id=widget_id)
```

The previous "remove from snapshot.widgets" behavior is deleted entirely.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_accept_widget.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(backend): accept_widget flips status only, keeps widget+nodes"
```

---

### Task 19: Backend — delete_widget removes op_graph nodes

**Files:**
- Modify: `backend/app/tools/delete_widget.py`
- Modify: `backend/tests/test_delete_widget.py` (or create)

- [ ] **Step 1: Write the failing test**

Append/create:

```python
@pytest.mark.asyncio
async def test_delete_widget_removes_nodes_from_op_graph(session_with_widget):
    sid, widget_id = session_with_widget
    nodes_before = (await get_snapshot(sid))["operation_graph"]["nodes"]
    assert any(n.get("widget_id") == widget_id for n in nodes_before)

    await delete_widget(session_id=sid, widget_id=widget_id, suppress_similar=False)

    nodes_after = (await get_snapshot(sid))["operation_graph"]["nodes"]
    assert not any(n.get("widget_id") == widget_id for n in nodes_after)

@pytest.mark.asyncio
async def test_delete_widget_flips_status(session_with_widget):
    sid, widget_id = session_with_widget
    await delete_widget(session_id=sid, widget_id=widget_id, suppress_similar=False)
    widget = (await get_snapshot(sid))["widgets"]
    found = next(w for w in widget if w["id"] == widget_id)
    assert found["status"] == "dismissed"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_delete_widget.py -v
```

Expected: FAIL.

- [ ] **Step 3: Rewrite the handler**

Edit `backend/app/tools/delete_widget.py`:

```python
async def delete_widget(session_id: str, widget_id: str, suppress_similar: bool):
    session = get_session(session_id)
    widget = session.snapshot.find_widget(widget_id)
    if not widget:
        raise ToolError(f"Widget {widget_id} not found")
    widget.status = "dismissed"
    session.snapshot.operation_graph.nodes = [
        n for n in session.snapshot.operation_graph.nodes
        if n.widget_id != widget_id
    ]
    if suppress_similar:
        session.add_dismissal_signature(widget)
    session.emit_event("widget.deleted", {"widget_id": widget_id})
    return ToolOk(widget_id=widget_id)
```

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_delete_widget.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(backend): delete_widget flips status and removes op_graph nodes"
```

---

### Task 20: Create useLayerWidgets hook

**Files:**
- Create: `src/hooks/useLayerWidgets.ts`
- Create: `src/hooks/useLayerWidgets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useLayerWidgets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLayerWidgets } from './useLayerWidgets';
import { useBackendState } from '@/store/backend-state-slice';

const baseWidget = {
  id: 'w1', intent: 'Curves', scope: { kind: 'global' } as const,
  origin: { kind: 'tool_invoked' as const }, composed: false,
  bindings: [], preview: { kind: 'none', auto_before_after: false },
  rejected_attempts: [], status: 'accepted' as const, revision: 1,
  created_at: '', updated_at: '',
  nodes: [{ id: 'n1', type: 'curves', scope: { kind: 'global' } as const,
            params: { intensity: 0.5 }, inputs: [], widget_id: 'w1', layer_id: 'L1' }],
};

describe('useLayerWidgets', () => {
  beforeEach(() => {
    useBackendState.getState().reset();
  });

  it('returns widgets whose nodes target the given layer', () => {
    useBackendState.getState().setSnapshot({
      session_id: 's', image_context: null,
      widgets: [{ ...baseWidget }],
      masks_index: [],
      operation_graph: {
        id: 'g', userGoal: '', nodes: baseWidget.nodes,
        panelBindings: [], metadata: {},
      },
      revision: 1,
    });
    const { result } = renderHook(() => useLayerWidgets('L1'));
    expect(result.current.map((w) => w.id)).toEqual(['w1']);
  });

  it('excludes widgets with no nodes on the layer', () => {
    useBackendState.getState().setSnapshot({
      session_id: 's', image_context: null,
      widgets: [{ ...baseWidget }],
      masks_index: [],
      operation_graph: {
        id: 'g', userGoal: '', nodes: baseWidget.nodes,
        panelBindings: [], metadata: {},
      },
      revision: 1,
    });
    const { result } = renderHook(() => useLayerWidgets('OTHER'));
    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useLayerWidgets.test.ts
```

Expected: FAIL (file doesn't exist).

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useLayerWidgets.ts`:

```ts
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

/**
 * Returns the widgets whose operation_graph nodes target the given layer.
 * Reads directly from the backend snapshot — no client-side materialization.
 */
export function useLayerWidgets(layerId: string | null): Widget[] {
  const widgets = useBackendState((s) => s.snapshot?.widgets);
  const nodes = useBackendState((s) => s.snapshot?.operation_graph.nodes);
  if (!layerId || !widgets || !nodes) return [];
  const widgetIdsOnLayer = new Set(
    nodes.filter((n) => n.layer_id === layerId).map((n) => n.widget_id),
  );
  return widgets.filter((w) => widgetIdsOnLayer.has(w.id) && w.status !== 'dismissed');
}
```

Note: this assumes `Node.widget_id` exists. If the backend Node schema doesn't have `widget_id`, add it in Task 16 alongside `layer_id` (verify before this task).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/useLayerWidgets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(hooks): useLayerWidgets reads snapshot filtered by layer_id"
```

---

### Task 21: Rewrite useAdjustmentPipeline.recompute() to single source

**Files:**
- Modify: `src/components/canvas/useAdjustmentPipeline.ts`

- [ ] **Step 1: Replace recompute()**

Edit `src/components/canvas/useAdjustmentPipeline.ts`. Replace the entire `function recompute(): void` body with:

```ts
function recompute(): void {
  const state = useEditorStore.getState();
  const { activeLayerId, layers, pixelVersion } = state;
  const layer = layers.find((l) => l.id === activeLayerId);
  if (!layer) return;

  // Single source: backend op_graph filtered by layer_id.
  const allNodes = selectPipelineNodes();
  const nodes = allNodes.filter((n) => (n as { layer_id?: string }).layer_id === layer.id);
  const adjustments = nodes.map(nodeToAdjustment);

  const optSize = useBackendState.getState().optimistic.size;
  const sig = nodes
    .map((n) => `${n.id}:${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join(',')}`)
    .join('|');
  const combinedSig = `${activeLayerId}|n:${sig}|opt:${optSize}|pv:${pixelVersion}`;

  if (prevRef.current.layerHash === combinedSig) return;
  prevRef.current = {
    mode: 'develop',
    layerId: activeLayerId,
    adjustments,
    layerHash: combinedSig,
    pixelVersion,
  };

  const multipleVisible = layers.filter((l) => l.visible).length > 1;
  if (multipleVisible || adjustments.length === 0) {
    LayerCompositor.requestComposite();
    return;
  }

  PipelineManager.setSource(layer.id);
  PipelineManager.requestRender(adjustments);
}
```

Also update the `prevRef` initial value to drop the `cropMeta` field (was already dropped in Task 3 — verify).

- [ ] **Step 2: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

- Open image.
- Click "Curves" toolrail button → cursor-bind starts.
- Drop on canvas → widget should appear, sliders should affect pixels.

(If the toolrail button doesn't yet call backend — that's Task 23. For now verify just that the canvas didn't crash.)

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(pipeline): single source — read only from snapshot.operation_graph"
```

---

### Task 22: Drop Layer.adjustmentStack + slice actions

**Files:**
- Modify: `src/store/layer-slice.ts`

- [ ] **Step 1: Create src/types/adjustment.ts (extracted from layer-slice)**

The `Adjustment` interface is still needed by `nodeToAdjustment.ts` and the WebGL pipeline. Move it to a dedicated types file.

Create `src/types/adjustment.ts` with:

```ts
import type { Scope } from './scope';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'soft-light' | 'hard-light';

export interface AiSource {
  widgetId: string;
  intent: string;
  reasoning?: string;
  acceptedAt: string;
}

export interface Adjustment {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  params: Record<string, number | Float32Array>;
  scope?: Scope;
  aiSource?: AiSource;
}
```

- [ ] **Step 2: Update Adjustment importers**

```bash
grep -rln "import.*Adjustment.*from '@/store/layer-slice'" src/
```

For each hit, change the import to `import type { Adjustment } from '@/types/adjustment';`.

- [ ] **Step 3: Strip layer-slice.ts**

Edit `src/store/layer-slice.ts`:

Delete from the `Layer` interface: `adjustmentStack: AdjustmentStack;` field. Also delete the `AdjustmentStack` interface and the local `Adjustment`, `BlendMode`, `AiSource` definitions (they live in `src/types/adjustment.ts` now).

Re-import `BlendMode` if other parts of layer-slice still use it: `import type { BlendMode } from '@/types/adjustment';`.

Delete from `LayerSlice` actions: `setAdjustment`, `addAdjustment`, `insertAdjustment`, `removeAdjustment`, `updateAdjustmentMeta`, `updateAdjustmentParams`, `toggleAdjustment`, `reorderAdjustments`, `setActiveScope`.

Delete from `createLayerSlice`: all the function bodies for those actions.

In `addLayer`: remove the `adjustmentStack: { adjustments: [] }` line from the pushed layer object.

In `revertAll`: remove the `for (const layer of state.layers) { layer.adjustmentStack.adjustments = []; … }` block.

- [ ] **Step 4: Run check**

```bash
npm run check 2>&1 | head -80
```

Expected: many errors at every site that called `addAdjustment`, `updateAdjustmentParams`, etc. These will be fixed in Task 23.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(layer-slice): drop adjustmentStack, all *Adjustment* actions, activeScope; extract types"
```

---

### Task 23: Update palette-actions + toolrail handlers to call propose_widget

**Files:**
- Modify: `src/lib/palette-actions.ts`
- Modify: `src/components/widget/CanvasWidgetLayer.tsx` (the toolrail-drop branch)
- Modify: every tool file in `src/tools/` that uses `addAdjustment`

- [ ] **Step 1: Update palette-actions.ts**

Replace the body of `proposeFromPalette` with:

```ts
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<void> {
  const sid = useBackendState.getState().sessionId;
  const layerId = useEditorStore.getState().activeLayerId;
  if (!sid || !layerId) return;
  const env = await backendTools.propose_widget(sid, {
    intent: text,
    scope,
    prompt: text,
    layer_id: layerId,
    origin: 'mcp_user_prompt',
  });
  if (!env.ok) console.error('[palette] propose_widget failed:', env.error);
}
```

Update the import of `useEditorStore` if not present.

Update `backendTools.propose_widget` signature in `src/lib/backend-tools.ts`:

```ts
propose_widget(sessionId: string, args: {
  intent: string;
  scope: Scope;
  fused_tool_id?: string;
  prompt?: string;
  layer_id: string;
  origin: WidgetOriginKind;
}) {
  return invokeTool<{ widget: Widget }>('propose_widget', sessionId, args);
}
```

Add `WidgetOriginKind` to the imports at top of `backend-tools.ts`.

- [ ] **Step 2: Update toolrail drop handler in CanvasWidgetLayer.tsx**

Replace the `if (pending.kind === 'tool') { … }` branch inside `onCanvasDrop`:

```ts
if (pending.kind === 'tool') {
  const tool = CanvasToolRegistry.get(pending.toolName);  // renamed in Phase 5; for now ToolRegistry
  const procId = tool?.processingId;
  const layerId = useEditorStore.getState().activeLayerId;
  const sid = useBackendState.getState().sessionId;
  if (!procId || !layerId || !sid) {
    useCursorBindStore.getState().cancel();
    return;
  }
  void backendTools.propose_widget(sid, {
    intent: tool.label,
    scope: pending.scope ?? { kind: 'global' },
    fused_tool_id: procId,
    layer_id: layerId,
    origin: 'tool_invoked',
  });
  useCursorBindStore.getState().cancel();
}
```

The local-materialization path is gone.

- [ ] **Step 3: Disable toolrail + Cmd+K when backend is down**

In the toolrail click handler (and Cmd+K palette open handler), early-return when `useBackendState.getState().sseStatus !== 'open'`. Add visual `disabled` state to buttons:

```ts
const sseStatus = useBackendState((s) => s.sseStatus);
const backendReady = sseStatus === 'open';
// In JSX: <button disabled={!backendReady} ...>
```

This implements the spec §9 backend-down behavior.

- [ ] **Step 4: Sweep tool files for `addAdjustment` / slider callers**

```bash
grep -rln "addAdjustment\|insertAdjustment\|setAdjustment\|updateAdjustmentParams\|updateAdjustmentMeta\|useAdjustment\b" src/
```

Expected hits: `src/processing/*.tsx` (panels), `src/lib/use-adjustment.ts`, `src/lib/use-graph-adjustment.ts`, `src/lib/use-processing-param.ts`, `src/components/inspector/AdjustmentSlider.tsx`, the 6 `src/tools/*-tool.tsx` files.

For each Panel/slider:

```ts
// OLD (inside a processing Panel)
const adj = useAdjustment(layerId, type);
const onChange = (key: string, value: number) =>
  useEditorStore.getState().updateAdjustmentParams(layerId, adj.id, { ...adj.params, [key]: value });

// NEW
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';

// The Panel now receives a Widget prop directly (not a Layer).
function Panel({ widget }: { widget: Widget }) {
  const sid = useBackendState((s) => s.sessionId);
  const revision = useBackendState((s) => s.snapshot?.revision ?? 0);
  const onChange = (paramKey: string, value: number) => {
    if (!sid) return;
    useBackendState.getState().applyOptimistic(widget.id, {
      bindings: [{ paramKey, value }],
      baseRevision: revision,
    });
    void backendTools.set_widget_param(sid, { widget_id: widget.id, param_key: paramKey, value });
  };
  // render bindings as sliders using onChange
}
```

For `*-tool.tsx` files (6 files): each currently has a `OptionsPanel` that reads/writes adjustment params via `useAdjustment` etc. Either:
- (a) Delete the tool file entirely if its only purpose was toolbar+options-panel (the ProcessingDefinition.Panel handles the widget UI now).
- (b) Keep as a thin `ToolDefinition` for the toolrail button registration, but drop the OptionsPanel.

Option (a) is cleaner — verify each tool file's exports; if only `XxxTool` is exported and consumed by `App.tsx`, replace `App.tsx`'s `ToolRegistry.register(XxxTool)` with an inline registration:

```ts
// In App.tsx
[
  { name: 'light', label: 'Light', processingId: 'light' /* ... */ },
  { name: 'color', label: 'Color', processingId: 'color' /* ... */ },
  // ...
].forEach((t) => ToolRegistry.register(t));
```

Then delete the 6 tool files.

This step is the largest single edit of the plan. Budget ~2 hours.

- [ ] **Step 5: Run check**

```bash
npm run check
```

Expected: PASS (after the sweep).

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```

- Open image, ensure analyze completes (backend status bar green).
- Click Curves toolrail button → drop on canvas → widget appears, slider drag re-renders pixels.
- Cmd+K → type "warmer skin" → AI widget appears in Suggestions panel.
- Disconnect backend (kill uvicorn) → toolrail buttons grey out, Cmd+K does nothing.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "feat(widgets): all three spawn paths route through backendTools.propose_widget"
```

---

### Task 24: Repoint readers of adjustmentStack to useLayerWidgets

**Files (verify the list with grep first):**
- Modify: `src/components/inspector/LayersSection.tsx`
- Modify: `src/components/inspector/ActiveSection.tsx`
- Modify: `src/components/inspector/SuggestionsSection.tsx`
- Modify: `src/components/inspector/InspectorWidgetRow.tsx`
- Modify: `src/components/inspector/LayerProperties.tsx`
- Modify: `src/components/widget/ToolWidgetCard.tsx`

- [ ] **Step 1: Find all readers**

```bash
grep -rln "adjustmentStack\|layer\\.adjustmentStack" src/
```

- [ ] **Step 2: Replace each reader**

For each file:

```ts
// OLD
const adjustments = layer.adjustmentStack.adjustments;

// NEW
import { useLayerWidgets } from '@/hooks/useLayerWidgets';
const widgets = useLayerWidgets(layer.id);
// Subsequent code that iterated `adjustments` now iterates `widgets`.
// Each widget has bindings, scope, origin — display these instead of raw Adjustment fields.
```

Specifically:
- `LayersSection`: render a row per widget on the layer instead of a row per Adjustment. Widget shows `intent`, `scope` icon, enable toggle.
- `ActiveSection`: filter `widgets` by `status === 'accepted'`.
- `SuggestionsSection`: filter by `status === 'proposed' && origin.kind !== 'tool_invoked'`.
- `InspectorWidgetRow`: display widget bindings instead of adjustment params.

The exact rendering changes depend on existing markup; preserve visual layout, swap the data source.

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Smoke test**

Verify in the browser that the inspector sections render widgets correctly after dropping one.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(inspector): readers use useLayerWidgets, not layer.adjustmentStack"
```

---

### Task 25: Delete materialize-adjustments.ts

**Files:**
- Delete: `src/lib/materialize-adjustments.ts`
- Delete: `src/lib/materialize-adjustments.test.ts`
- Modify: `src/store/backend-state-slice.ts` (remove the materialize call from `widget.accepted` handler)

- [ ] **Step 1: Update backend-state-slice.ts**

Edit `src/store/backend-state-slice.ts`. Replace the `case 'widget.accepted':` block with:

```ts
case 'widget.accepted': {
  const id = payload.widget_id as string;
  s.acceptedSuggestions.add(id);
  const widget = s.snapshot?.widgets.find((w) => w.id === id);
  if (widget) widget.status = 'accepted';
  break;
}
```

Remove the import of `materializeAdjustments` and the `useEditorStore.getState().addAdjustment(...)` loop.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/materialize-adjustments.ts src/lib/materialize-adjustments.test.ts
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Smoke test**

- Cmd+K → AI suggestion appears → accept it via the SuggestionsSection's Accept button (or cursor-bind drop).
- Expect: Accept button disappears, widget moves from Suggestions to Active section, pixels unchanged (it was already rendering before accept).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(backend-state): widget.accepted = status flip; delete materialize-adjustments"
```

---

### Task 26: Phase 3 end-to-end smoke

- [ ] **Step 1: Boot both ends**

```bash
# Terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8787

# Terminal 2
npm run dev
```

- [ ] **Step 2: Verify all three spawn paths**

1. **Cmd+K user prompt**: open image → backend analyzes → Cmd+K → type "warm skin" → widget appears with Anthropic-generated params.
2. **Autonomous**: after analyze completes, autonomous suggestions populate the SuggestionsSection.
3. **Toolrail**: click "Levels" → cursor-bind starts → drop on canvas → widget appears immediately (no LLM delay) with default params.

For each:
- Slider drag updates pixels in real-time.
- Accept flips status, no pixel snap.
- Delete unwinds pixels.

If any path is broken, debug before continuing to Phase 4.

---

## Phase 4 — Selection unification (1 day)

### Task 27: Write tests for selection-slice

**Files:**
- Create: `src/store/selection-slice.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './index';
import { GLOBAL_SCOPE } from '@/types/scope';

describe('selection-slice', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
  });

  it('default activeScope is global', () => {
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
  });

  it('setActiveScope updates activeScope', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    expect(useEditorStore.getState().activeScope).toEqual({ kind: 'mask', mask_id: 'm1' });
  });

  it('focusWidget sets focusedWidgetId', () => {
    useEditorStore.getState().focusWidget('w1');
    expect(useEditorStore.getState().focusedWidgetId).toBe('w1');
  });

  it('startToolBind sets pendingBind', () => {
    useEditorStore.getState().startToolBind('curves');
    expect(useEditorStore.getState().pendingBind).toEqual({ kind: 'tool', toolName: 'curves' });
  });

  it('cancelBind clears pendingBind', () => {
    useEditorStore.getState().startToolBind('curves');
    useEditorStore.getState().cancelBind();
    expect(useEditorStore.getState().pendingBind).toBeNull();
  });

  it('clickAt with empty candidates clears selection to global', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    useEditorStore.getState().clickAt(10, 10, []);
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/store/selection-slice.test.ts
```

Expected: FAIL.

---

### Task 28: Create selection-slice.ts

**Files:**
- Create: `src/store/selection-slice.ts`

- [ ] **Step 1: Implement the slice**

```ts
import type { StateCreator } from 'zustand';
import type { Scope } from '@/types/scope';
import { GLOBAL_SCOPE } from '@/types/scope';
import { maskStore } from '@/core/mask-store';

export interface CycleStack {
  originX: number;
  originY: number;
  candidates: string[];
  cursor: number;
}

export type PendingBind =
  | { kind: 'tool'; toolName: string }
  | { kind: 'suggestion'; widgetId: string };

export interface SelectionSlice {
  activeScope: Scope;
  hoveredScope: Scope | null;
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
  pendingBind: PendingBind | null;
  cursor: { x: number; y: number } | null;

  setActiveScope: (scope: Scope) => void;
  setHoveredScope: (scope: Scope | null) => void;
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  focusWidget: (id: string | null) => void;
  startToolBind: (toolName: string) => void;
  startSuggestionBind: (widgetId: string) => void;
  updateCursor: (x: number, y: number) => void;
  cancelBind: () => void;
  clearSelection: () => void;
}

const CYCLE_RADIUS_PX = 8;

function countSetPixels(data: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) n++;
  return n;
}

function sortByPixelCount(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ma = maskStore.get(a);
    const mb = maskStore.get(b);
    const pa = ma ? countSetPixels(ma.data) : Infinity;
    const pb = mb ? countSetPixels(mb.data) : Infinity;
    return pa - pb;
  });
}

export const createSelectionSlice: StateCreator<
  SelectionSlice,
  [['zustand/immer', never]],
  []
> = (set, get) => ({
  activeScope: GLOBAL_SCOPE,
  hoveredScope: null,
  cycleStack: null,
  focusedWidgetId: null,
  pendingBind: null,
  cursor: null,

  setActiveScope: (scope) => set((s) => { s.activeScope = scope; }),
  setHoveredScope: (scope) => set((s) => { s.hoveredScope = scope; }),
  focusWidget: (id) => set((s) => { s.focusedWidgetId = id; }),
  startToolBind: (toolName) => set((s) => { s.pendingBind = { kind: 'tool', toolName }; }),
  startSuggestionBind: (widgetId) => set((s) => { s.pendingBind = { kind: 'suggestion', widgetId }; }),
  updateCursor: (x, y) => set((s) => { s.cursor = { x, y }; }),
  cancelBind: () => set((s) => { s.pendingBind = null; s.cursor = null; }),
  clearSelection: () => set((s) => {
    s.activeScope = GLOBAL_SCOPE;
    s.hoveredScope = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
    s.pendingBind = null;
    s.cursor = null;
  }),

  clickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) {
      set((s) => { s.cycleStack = null; s.activeScope = GLOBAL_SCOPE; s.hoveredScope = null; });
      return;
    }
    const prev = get().cycleStack;
    const withinRadius = prev
      && Math.abs(prev.originX - imageX) <= CYCLE_RADIUS_PX
      && Math.abs(prev.originY - imageY) <= CYCLE_RADIUS_PX;
    if (withinRadius && prev) {
      const len = prev.candidates.length + 1;
      const nextCursor = (prev.cursor + 1) % len;
      const next: CycleStack = { ...prev, cursor: nextCursor };
      const selMask = nextCursor < prev.candidates.length ? prev.candidates[nextCursor] : null;
      set((s) => {
        s.cycleStack = next;
        s.activeScope = selMask ? { kind: 'mask', mask_id: selMask } : GLOBAL_SCOPE;
        s.hoveredScope = selMask ? { kind: 'mask', mask_id: selMask } : null;
      });
      return;
    }
    const sorted = sortByPixelCount(candidates);
    set((s) => {
      s.cycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
      s.activeScope = { kind: 'mask', mask_id: sorted[0] };
      s.hoveredScope = { kind: 'mask', mask_id: sorted[0] };
    });
  },
});
```

- [ ] **Step 2: Register in store/index.ts**

Edit `src/store/index.ts`:

```ts
import { type SelectionSlice, createSelectionSlice } from './selection-slice';

export type EditorState = LayerSlice & ViewportSlice & ToolSlice & DocumentSlice
  & SegmentationSlice & SelectionSlice;

export const useEditorStore = create<EditorState>()(
  devtools(
    immer((set, get, store) => ({
      ...createLayerSlice(set as never, get as never, store as never),
      ...createViewportSlice(set as never, get as never, store as never),
      ...createToolSlice(set as never, get as never, store as never),
      ...createDocumentSlice(set as never, get as never, store as never),
      ...createSegmentationSlice(set as never, get as never, store as never),
      ...createSelectionSlice(set as never, get as never, store as never),
    }))
  )
);
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx vitest run src/store/selection-slice.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "feat(selection-slice): unified selection state (replaces 4 stores)"
```

---

### Task 29: Migrate consumers from segment-selection-slice

**Files:**
- Modify: every importer of `useSegmentSelection`

- [ ] **Step 1: Find consumers**

```bash
grep -rln "useSegmentSelection\|from '@/store/segment-selection-slice'" src/
```

- [ ] **Step 2: Rewrite each consumer**

Replace patterns:

```ts
// OLD
import { useSegmentSelection } from '@/store/segment-selection-slice';
const selectedSegmentId = useSegmentSelection((s) => s.selectedSegmentId);
const hoveredSegmentId = useSegmentSelection((s) => s.hoveredSegmentId);
useSegmentSelection.getState().clickAt(x, y, candidates);

// NEW
import { useEditorStore } from '@/store';
const activeScope = useEditorStore((s) => s.activeScope);
const hoveredScope = useEditorStore((s) => s.hoveredScope);
const selectedSegmentId =
  activeScope.kind === 'mask' ? activeScope.mask_id : null;
const hoveredSegmentId =
  hoveredScope?.kind === 'mask' ? hoveredScope.mask_id : null;
useEditorStore.getState().clickAt(x, y, candidates);
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(selection): migrate useSegmentSelection callers to selection-slice"
```

---

### Task 30: Migrate consumers from focus-slice

**Files:**
- Modify: every importer of `useFocusedWidget`

- [ ] **Step 1: Find consumers**

```bash
grep -rln "useFocusedWidget" src/
```

- [ ] **Step 2: Rewrite each consumer**

```ts
// OLD
import { useFocusedWidget } from '@/store/focus-slice';
const focusedId = useFocusedWidget((s) => s.focusedId);
useFocusedWidget.getState().setFocused(id);

// NEW
import { useEditorStore } from '@/store';
const focusedId = useEditorStore((s) => s.focusedWidgetId);
useEditorStore.getState().focusWidget(id);
```

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add -u
git commit -m "refactor(selection): migrate useFocusedWidget callers to selection-slice"
```

---

### Task 31: Migrate consumers from cursor-bind-slice

**Files:**
- Modify: every importer of `useCursorBindStore`

- [ ] **Step 1: Find consumers**

```bash
grep -rln "useCursorBindStore" src/
```

- [ ] **Step 2: Rewrite each consumer**

```ts
// OLD
import { useCursorBindStore } from '@/store/cursor-bind-slice';
const pending = useCursorBindStore((s) => s.pending);
useCursorBindStore.getState().startTool(name, scope);
useCursorBindStore.getState().startSuggestion(id, scope);
useCursorBindStore.getState().cancel();

// NEW
import { useEditorStore } from '@/store';
const pending = useEditorStore((s) => s.pendingBind);
useEditorStore.getState().startToolBind(name);
useEditorStore.getState().startSuggestionBind(id);
useEditorStore.getState().cancelBind();
```

Note: `scope` is no longer passed — it's implicit (the current `activeScope` is used).

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add -u
git commit -m "refactor(selection): migrate useCursorBindStore callers to selection-slice"
```

---

### Task 32: Delete the three obsolete stores + shrink segmentation-slice

**Files:**
- Delete: `src/store/focus-slice.ts`, `src/store/focus-slice.test.ts`
- Delete: `src/store/segment-selection-slice.ts`, `src/store/segment-selection-slice.test.ts`
- Delete: `src/store/cursor-bind-slice.ts`, `src/store/cursor-bind-slice.test.ts`
- Modify: `src/store/segmentation-slice.ts` (keep only `encoderState`)

- [ ] **Step 1: Verify no remaining importers**

```bash
grep -rln "from '@/store/focus-slice'\|from '@/store/segment-selection-slice'\|from '@/store/cursor-bind-slice'" src/
```

Expected: no output.

- [ ] **Step 2: Delete the files**

```bash
rm src/store/focus-slice.ts src/store/focus-slice.test.ts \
   src/store/segment-selection-slice.ts src/store/segment-selection-slice.test.ts \
   src/store/cursor-bind-slice.ts src/store/cursor-bind-slice.test.ts
```

- [ ] **Step 3: Rewrite segmentation-slice.ts**

Replace contents with:

```ts
import type { StateCreator } from 'zustand';

export type EncoderState = 'idle' | 'loading-model' | 'encoding' | 'ready' | 'error';

export interface SegmentationSlice {
  encoderState: EncoderState;
  setEncoderState: (s: EncoderState) => void;
}

export const createSegmentationSlice: StateCreator<
  SegmentationSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  encoderState: 'idle',
  setEncoderState: (s) => set((state) => { state.encoderState = s; }),
});
```

- [ ] **Step 4: Run check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore(stores): delete obsolete stores; shrink segmentation-slice"
```

---

### Task 33: Phase 4 smoke verification

- [ ] **Step 1: Manual smoke**

- Click image region → mask outline appears (`clickAt` working).
- Click again at same spot → cycles to next-larger mask.
- Click an Active row → widget pulses (focus working).
- Click Curves toolrail button → cursor ghost follows, drop spawns widget (pendingBind working).

If any flow broken, debug.

---

## Phase 5 — Polish (0.5 day)

### Task 34: Rename ToolRegistry → CanvasToolRegistry

**Files:**
- Rename: `src/lib/tool-registry.ts` → `src/lib/canvas-tool-registry.ts`
- Modify: every importer

- [ ] **Step 1: Rename + update content**

```bash
git mv src/lib/tool-registry.ts src/lib/canvas-tool-registry.ts
```

Edit `src/lib/canvas-tool-registry.ts`: rename the class `ToolRegistryImpl` → `CanvasToolRegistryImpl`. Rename the export `ToolRegistry` → `CanvasToolRegistry`.

- [ ] **Step 2: Update importers**

```bash
grep -rln "from '@/lib/tool-registry'\|ToolRegistry" src/ --include="*.ts" --include="*.tsx"
```

For each, update the import and references.

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add -u
git commit -m "refactor(naming): ToolRegistry → CanvasToolRegistry"
```

---

### Task 35: Rename ToolManifestRegistry → LlmToolRegistry

**Files:**
- Rename: `src/lib/tool-manifest/registry.ts` → `src/lib/tool-manifest/llm-tool-registry.ts`
- Modify: every importer

- [ ] **Step 1: Rename + update content**

```bash
git mv src/lib/tool-manifest/registry.ts src/lib/tool-manifest/llm-tool-registry.ts
```

Edit the renamed file: `ToolManifestRegistryImpl` → `LlmToolRegistryImpl`, `ToolManifestRegistry` → `LlmToolRegistry`.

- [ ] **Step 2: Update importers**

```bash
grep -rln "ToolManifestRegistry\|from '@/lib/tool-manifest/registry'" src/
```

Update each.

- [ ] **Step 3: Run check + commit**

```bash
npm run check
git add -u
git commit -m "refactor(naming): ToolManifestRegistry → LlmToolRegistry"
```

---

### Task 36: Delete widget-projection.ts

**Files:**
- Delete: `src/lib/widget-projection.ts`, `src/lib/widget-projection.test.ts`
- Modify: any remaining caller

- [ ] **Step 1: Find callers**

```bash
grep -rln "from '@/lib/widget-projection'\|selectAllWidgets" src/
```

- [ ] **Step 2: Replace callers**

In each caller (mostly `CanvasWidgetLayer.tsx`):

```ts
// OLD
const allWidgets = selectAllWidgets();
const widgets = allWidgets.filter(/* … */);

// NEW
const snapshot = useBackendState((s) => s.snapshot);
const widgets = (snapshot?.widgets ?? []).filter((w) => w.status !== 'dismissed');
```

- [ ] **Step 3: Delete the files**

```bash
rm src/lib/widget-projection.ts src/lib/widget-projection.test.ts
```

- [ ] **Step 4: Run check + commit**

```bash
npm run check
git add -u
git commit -m "chore(strip): delete widget-projection (consumers read snapshot directly)"
```

---

### Task 37: ESLint warning sweep

- [ ] **Step 1: Run lint with no-warn-on-warn**

```bash
npx eslint src/ --max-warnings 0
```

Expected: any remaining warnings (likely react-refresh/only-export-components etc.).

- [ ] **Step 2: Fix each remaining warning**

For `react-refresh/only-export-components` warnings: move shared constants/utils to a separate file.

For any `react-hooks/immutability` violations in remaining files: refactor module-level variables to component state or refs.

- [ ] **Step 3: Verify clean**

```bash
npx eslint src/ --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(lint): zero warnings in src/"
```

---

### Task 38: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Project Structure**

Edit `CLAUDE.md`. Find the "Project Structure" section. Update to reflect the new layout:

- Remove references to `src/components/graph/`, `src/store/graph-store.ts`, `src/core/derived-graph.ts`.
- Remove references to `serializer.ts`, `session-storage.ts`, `history-tree.ts`, `transaction.ts`.
- Remove references to `crop-*.ts`, `crop-editing-slice.ts`, `CropOverlay.tsx`.
- Remove `text-tool.tsx`, `brush-tool.tsx`, `brush-mask-tool.tsx`, `select-box-tool.ts`, `crop-tool.tsx` from tools list.
- Update the "Store separation" section: replace mention of EditorStore + GraphStore with just EditorStore + BackendState.
- Update "Dual Registry pattern" to "Dual Registry pattern (renamed): CanvasToolRegistry + LlmToolRegistry".
- Add "Single Source of Truth" section reflecting the doctrine.

- [ ] **Step 2: Update Architecture Principles**

Modify the "Architecture Principles" bullet list:

- Add: "Backend snapshot is the single source of truth for adjustment data. All three widget spawn paths (Cmd+K, autonomous, toolrail) call `backendTools.propose_widget`."
- Remove: "Document facade (`editorDocument`) — single coordinator for store, pixel data, history, transactions, and serialization" (replace with simpler facade scope: init, openImage, undo/redo, pixelStore).
- Remove "Non-destructive editing by default — adjustments stored as metadata" (still true but now in backend, clarify).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update for SSoT reset architecture"
```

---

### Task 39: Final end-to-end smoke

- [ ] **Step 1: Full reset**

```bash
git status                       # should be clean
npm run check                    # should be clean (0 warnings)
```

- [ ] **Step 2: Boot both ends**

```bash
# Terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8787

# Terminal 2
npm run dev
```

- [ ] **Step 3: Full happy-path smoke**

1. Open image of a person → backend analyze runs → status bar shows green when ready.
2. Autonomous suggestions appear in right-panel Suggestions section.
3. Click a suggestion → cursor-bind ghost → drop on canvas → widget appears, pixels update.
4. Drag slider on a widget → pixels update in real-time (no jank).
5. Click Levels in toolrail → drop on canvas → widget appears immediately (no LLM delay).
6. Cmd+K → type "sharper details" → AI widget appears in Suggestions.
7. Accept the widget → moves from Suggestions to Active section, Accept button gone.
8. Click an Active row → canvas widget pulses, canvas pans to it.
9. Delete the widget → pixels unwind.
10. Undo → pixels redo to before delete.
11. File → Export as PNG → file downloads correctly.
12. Reload page → image gone, no errors.

If any step fails: debug, fix, commit, re-test.

- [ ] **Step 4: Final line count**

```bash
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -not -name "*.test.*" -exec wc -l {} + | tail -1
```

Expected: <12k lines (vs ~21k at start).

- [ ] **Step 5: Tag the milestone**

```bash
git tag -a engine-ssot-reset -m "Engine SSoT Reset complete: ~21k → <12k LOC, one Scope, one render path, three unified spawn paths"
```

- [ ] **Step 6: Optional summary commit**

If anything was tweaked during smoke, commit. Otherwise nothing.

---

## Done

When all 39 tasks are checked, the engine is on the new SSoT model. Success criteria from the spec §15:

1. ✅ `npm run check` clean
2. ✅ One `Scope` type, one selection store
3. ✅ WebGL pipeline reads from one source
4. ✅ Three spawn paths via `backendTools.propose_widget`
5. ✅ Widget-doesn't-show debug takes <1 hour
6. ✅ `npm run dev` boots <300ms, `src/` <12k lines
7. ✅ CLAUDE.md matches reality
