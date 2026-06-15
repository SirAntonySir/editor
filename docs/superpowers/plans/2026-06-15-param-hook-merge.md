# Param-Hook Merge (H20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "four duplicated debounced param hooks" finding (H20) by deleting two dead hooks and consolidating the two live ones onto a single internal `useParam` core that they each become a thin wrapper for. Bug fixes in the debounce / optimistic / write-stale-guard logic then only need to land in one place.

**Architecture:** The audit listed four hooks but research shows two are dead code (`useGraphAdjustmentParam`, `useAdjustmentParam` — zero non-self call sites). The two live hooks have meaningfully different ergonomics: `useCanonicalParam(layerId, op, param, default)` keyed on the canonical op-graph node and routed through `backendTools.set_param`; `useProcessingParam(_layerId, _adjustmentType, adjustmentId, paramName, default)` keyed on a widget id and routed through `backendTools.set_widget_param`. Both share an identical debounce / optimistic / stale-write-guard core. We extract that core into a `useParam` hook (in `src/lib/use-param.ts`) parameterised by a discriminated-union `target`, then rewrite the two surviving public hooks as 3-line forwards. Call sites stay untouched; the bug surface shrinks to one file.

**Tech Stack:** React + TypeScript (strict) + Zustand v5 + Immer + vitest. Frontend only.

---

## File Structure

**Create:**
- `src/lib/use-param.ts` — the single configurable core. Reads via backend snapshot + optimistic patch; writes optimistic-then-debounced.
- `src/lib/use-param.test.ts` — unit tests for both target kinds (`canonical` + `widget`).

**Modify:**
- `src/hooks/useCanonicalParam.ts` — collapses to a 3-line forward into `useParam` with `target: { kind: 'canonical', ... }`.
- `src/lib/use-processing-param.ts` — collapses to a 3-line forward into `useParam` with `target: { kind: 'widget', ... }`.

**Delete:**
- `src/lib/use-graph-adjustment.ts` — dead code (zero call sites).
- `src/lib/use-adjustment.ts` — dead code (zero call sites).

**Not changed:**
- All call sites of `useCanonicalParam` (4 files in `src/components/inspector/adjustments/`) and `useProcessingParam` (`src/components/widget/CompoundWidgetBody.tsx`, `src/processing/levels.tsx`) — they continue to call the same named exports with the same signatures.
- The existing `src/hooks/useCanonicalParam.test.tsx` — confirms the wrapper preserves behaviour end-to-end (debounce, optimistic, stale-write guard).

---

## Doctrine — write this once, reference from each wrapper

> `useParam` is the single source of truth for debounced canonical/widget param writes. The two public wrappers exist for ergonomic call sites; both delegate to `useParam`. Any bug in the debounce, optimistic-patch, or post-revert stale-write guard MUST be fixed in `use-param.ts` — fixing it in a wrapper is a code smell.

---

### Task 1: Delete the two dead param hooks

`useGraphAdjustmentParam` and `useAdjustmentParam` have zero call sites in `src/` (verified: their only mentions are their own definitions). Delete them outright; this shrinks the merge surface before we touch live code.

**Files:**
- Delete: `src/lib/use-graph-adjustment.ts`
- Delete: `src/lib/use-adjustment.ts`

- [ ] **Step 1: Confirm zero call sites**

Run from the repo root:

```bash
grep -rnE "useGraphAdjustmentParam|useAdjustmentParam" src/ --include='*.ts' --include='*.tsx'
```

Expected: only the two `export function …` lines in the two doomed files. If there are any other hits, STOP and report — the plan's premise is wrong.

- [ ] **Step 2: Delete the files**

```bash
git rm src/lib/use-graph-adjustment.ts src/lib/use-adjustment.ts
```

- [ ] **Step 3: Run typecheck + lint to confirm nothing breaks**

```bash
npm run check
```

Expected: 0 errors. Any preexisting lint warnings stay where they were.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(hooks): delete unused useGraphAdjustmentParam + useAdjustmentParam"
```

---

### Task 2: Add the `useParam` core in `src/lib/use-param.ts` + unit tests

The new core encapsulates the shared logic both live hooks duplicate: read from optimistic patch → snapshot widgets (widget target only) → op-graph node, with type-safe defaulting; write via `applyOptimistic` immediately + a debounced backend-tool call gated by a stale-write guard. The discriminating axis is `target.kind` ('canonical' | 'widget').

**Files:**
- Create: `src/lib/use-param.ts`
- Create: `src/lib/use-param.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/use-param.test.ts` with EXACTLY this content:

```ts
import { renderHook, act } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { useParam } from './use-param';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_param: vi.fn().mockResolvedValue({ ok: true }),
    set_widget_param: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

function seedSnapshot(nodes: { id: string; type: string; layerId: string; params: Record<string, unknown> }[], widgets: { id: string; bindings: { paramKey: string; value: unknown }[] }[] = []) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      sessionId: 's1', imageContext: null, widgets: widgets as never, masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
      revision: 1,
    } as never,
    optimistic: new Map(),
  } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useBackendState.getState().reset?.();
});

// ---- canonical target ----

it('canonical target reads the canonical op-graph node param', () => {
  seedSnapshot([{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 42 } }]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0));
  expect(result.current[0]).toBe(42);
});

it('canonical target falls back to default when no node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 7));
  expect(result.current[0]).toBe(7);
});

it('canonical setter applies optimistic immediately + debounces set_param', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](55); });
  expect(result.current[0]).toBe(55);
  expect(backendTools.set_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layerId: 'L1', op: 'basic', param: 'exposure', value: 55 });
});

it('canonical setter aborts when a history op cleared optimistic mid-debounce', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](77); });
  act(() => {
    useBackendState.setState((s) => ({ ...s, optimistic: new Map() } as never));
    vi.advanceTimersByTime(400);
  });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});

// ---- widget target ----

it('widget target prefers a widget binding over the op-graph node', () => {
  seedSnapshot(
    [{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 10 } }],
    [{ id: 'w1', bindings: [{ paramKey: 'exposure', value: 99 }] }],
  );
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0));
  expect(result.current[0]).toBe(99);
});

it('widget target falls back to op-graph node when no binding matches', () => {
  seedSnapshot([{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 33 } }]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0));
  expect(result.current[0]).toBe(33);
});

it('widget target falls back to default when neither binding nor node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 5));
  expect(result.current[0]).toBe(5);
});

it('widget setter debounces set_widget_param', () => {
  seedSnapshot([{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 0 } }]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0 as number));
  act(() => { result.current[1](44); });
  expect(result.current[0]).toBe(44);
  expect(backendTools.set_widget_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_widget_param).toHaveBeenCalledWith('s1', { widgetId: 'w1', paramKey: 'exposure', value: 44 });
});

it('cleanup on unmount cancels a pending debounced write', () => {
  seedSnapshot([]);
  const { result, unmount } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](88); });
  unmount();
  act(() => { vi.advanceTimersByTime(400); });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/use-param.test.ts
```

Expected: import error (`Cannot find module './use-param'`).

- [ ] **Step 3: Implement the core**

Create `src/lib/use-param.ts` with EXACTLY this content:

```ts
import { useCallback, useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { RUNTIME } from '@/config';
import type { ControlValue } from '@/types/widget';

/** Discriminated target for {@link useParam}.
 *
 *  Canonical: write directly to the (layer, op, param) triple via the
 *  `set_param` tool; optimistic patches are keyed on the canonical
 *  node id `canon:<layerId>:<op>` — which IS the op-graph node id.
 *
 *  Widget: write to a widget binding via `set_widget_param`; optimistic
 *  patches are keyed on the widget id (which is also the op-graph node
 *  id for the widget's underlying node). Reads prefer a widget binding
 *  value over the op-graph node param. */
export type ParamTarget =
  | { kind: 'canonical'; layerId: string | null; op: string; param: string }
  | { kind: 'widget'; widgetId: string | undefined; paramKey: string };

/** Single source of truth for debounced canonical/widget param writes.
 *
 *  Read path: optimistic patch → (widget bindings, widget target only) →
 *  op-graph node params → defaultValue.
 *
 *  Write path: applyOptimistic immediately for instant visual feedback;
 *  debounced backend-tool call (set_param or set_widget_param) at
 *  RUNTIME.sliderDebounceMs after the last keystroke.
 *
 *  Stale-write guard: if a backend history op (undo/redo/revert) clears
 *  s.optimistic between user input and the debounce firing, the
 *  scheduled tool call is suppressed so it can't push a new history
 *  entry that visually "undoes" the revert.
 *
 *  Both public wrappers (`useCanonicalParam`, `useProcessingParam`) are
 *  thin forwards to this. Bug fixes go here, not in the wrappers. */
export function useParam<T extends ControlValue = number>(
  target: ParamTarget,
  defaultValue: T,
): [T, (v: T) => void] {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  // Resolve the optimistic-map key + op-graph node id once per target.
  // Both are the same string for both target kinds: the canonical node
  // id (`canon:<layerId>:<op>`) for canonical, the widget id for widget.
  const optimisticKey =
    target.kind === 'canonical'
      ? target.layerId
        ? `canon:${target.layerId}:${target.op}`
        : ''
      : target.widgetId ?? '';
  const paramName = target.kind === 'canonical' ? target.param : target.paramKey;

  const value = useBackendState((s) => {
    if (!optimisticKey) return defaultValue;

    // 1. Optimistic patch — wins so slider drag feedback is instant.
    const patch = s.optimistic.get(optimisticKey);
    const opt = patch?.bindings.find((b) => b.paramKey === paramName);
    if (opt !== undefined) return opt.value as T;

    const snap = s.snapshot;
    if (!snap) return defaultValue;

    // 2. Widget binding (widget target only). A binding's value takes
    //    precedence over the node param because a widget can hold a
    //    different presentation value than the canonical param.
    if (target.kind === 'widget') {
      const widget = snap.widgets.find((w) => w.id === optimisticKey);
      const binding = widget?.bindings.find((b) => b.paramKey === paramName);
      if (binding !== undefined) return binding.value as T;
    }

    // 3. Op-graph node params.
    const node = snap.operationGraph.nodes.find((n) => n.id === optimisticKey);
    const p = node?.params?.[paramName];
    return p === undefined ? defaultValue : (p as T);
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending debounced write on unmount so a slider drag
  // interrupted by a panel close doesn't fire against a dead session.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const set = useCallback(
    (v: T) => {
      if (!optimisticKey || !sessionId || offline) return;
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      useBackendState.getState().applyOptimistic(optimisticKey, {
        bindings: [{ paramKey: paramName, value: v as ControlValue }],
        baseRevision,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // Stale-write guard: a history op (undo/redo/revert) between
        // the user input and now would have cleared s.optimistic. If
        // our intended patch is no longer present, suppress the write.
        const opt = useBackendState.getState().optimistic.get(optimisticKey);
        const stillIntended = opt?.bindings.some(
          (b) => b.paramKey === paramName && b.value === (v as ControlValue),
        );
        if (!stillIntended) return;
        if (target.kind === 'canonical') {
          void backendTools.set_param(sessionId, {
            layerId: target.layerId!,
            op: target.op,
            param: target.param,
            value: v as ControlValue,
          });
        } else {
          void backendTools.set_widget_param(sessionId, {
            widgetId: optimisticKey,
            paramKey: target.paramKey,
            value: v as ControlValue,
          });
        }
      }, RUNTIME.sliderDebounceMs);
    },
    // target is a fresh object each render; we destructure stable
    // primitives into the closure via the `target.kind` / `optimisticKey`
    // / `paramName` derivations above. Adding `target` itself to deps
    // would force the callback to recreate every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, offline, optimisticKey, paramName, target.kind],
  );

  return [value, set];
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/use-param.test.ts
```

Expected: 9 passed (the 8 above plus the unmount-cleanup test).

- [ ] **Step 5: Run the full check**

```bash
npm run check
```

Expected: 0 errors. Lint warning count must NOT increase (preexisting warnings are fine).

- [ ] **Step 6: Commit**

```bash
git add src/lib/use-param.ts src/lib/use-param.test.ts
git commit -m "feat(hooks): add useParam — single source of truth for debounced param writes"
```

---

### Task 3: Convert `useCanonicalParam` to a thin wrapper

After Task 2, `useParam` exists and is tested. Replace `useCanonicalParam`'s body with a 3-line forward. The existing test file (`src/hooks/useCanonicalParam.test.tsx`) is the regression net — it must keep passing without modification.

**Files:**
- Modify: `src/hooks/useCanonicalParam.ts`

- [ ] **Step 1: Replace the file content with the wrapper**

Replace the entire content of `src/hooks/useCanonicalParam.ts` with:

```ts
import { useParam } from '@/lib/use-param';
import type { ControlValue } from '@/types/widget';

/** Thin wrapper over {@link useParam} preserving the legacy positional
 *  signature for inspector adjustment panels. All real work lives in
 *  `useParam` — fix bugs there, not here. */
export function useCanonicalParam<T extends ControlValue = number>(
  layerId: string | null,
  op: string,
  param: string,
  defaultValue: T,
): [T, (v: T) => void] {
  return useParam<T>({ kind: 'canonical', layerId, op, param }, defaultValue);
}
```

- [ ] **Step 2: Run the existing test to confirm behaviour is preserved**

```bash
npx vitest run src/hooks/useCanonicalParam.test.tsx
```

Expected: 4 passed (the original test file, unchanged).

- [ ] **Step 3: Run the full check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCanonicalParam.ts
git commit -m "refactor(hooks): make useCanonicalParam a thin wrapper over useParam"
```

---

### Task 4: Convert `useProcessingParam` to a thin wrapper

Same pattern as Task 3, for the widget-target hook. The existing call sites (`src/components/widget/CompoundWidgetBody.tsx`, `src/processing/levels.tsx`) pass 5 positional args — the wrapper preserves that surface.

**Files:**
- Modify: `src/lib/use-processing-param.ts`

- [ ] **Step 1: Replace the file content with the wrapper**

Replace the entire content of `src/lib/use-processing-param.ts` with:

```ts
import { useParam } from '@/lib/use-param';

/** Thin wrapper over {@link useParam} preserving the legacy positional
 *  signature for widget bodies. All real work lives in `useParam`.
 *
 *  The first two positional arguments (`_layerId`, `_adjustmentType`)
 *  are kept for API compatibility with existing call sites; routing
 *  is via the widget id only. */
export function useProcessingParam(
  _layerId: string,
  _adjustmentType: string,
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  return useParam<number>({ kind: 'widget', widgetId: adjustmentId, paramKey: paramName }, defaultValue);
}
```

- [ ] **Step 2: Run the widget-side tests + the inspector-side suite**

```bash
npx vitest run src/components/widget src/processing src/lib/use-param.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run the full suite**

```bash
npm run check
```

Expected: 0 errors. Full vitest run as part of `npm run check` should pass at the same count as before plus the 9 new `use-param.test.ts` tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/use-processing-param.ts
git commit -m "refactor(hooks): make useProcessingParam a thin wrapper over useParam"
```

---

### Task 5: Update the audit doc

`docs/audit-2026-06-15.md` carries the H20 status. Flip it to resolved and link the commits.

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit the H20 entry**

In `docs/audit-2026-06-15.md`, find the H20 line under "### Duplication / Architecture":

```markdown
- [ ] **H20** — **Four duplicated param hooks** (`useCanonicalParam`, `use-processing-param`, `use-graph-adjustment`, `use-adjustment`) — same shape (derive node → read optimistic/widgets/op-graph → debounce write); only differ in routing target. Collapse to one configurable hook.
```

Replace with:

```markdown
- [x] **H20** — **Four duplicated param hooks** (`useCanonicalParam`, `use-processing-param`, `use-graph-adjustment`, `use-adjustment`) — same shape (derive node → read optimistic/widgets/op-graph → debounce write); only differ in routing target. **Fix landed:** `useGraphAdjustmentParam` + `useAdjustmentParam` were dead code and were deleted; `useCanonicalParam` + `useProcessingParam` now forward to a single `src/lib/use-param.ts` core. Debounce / optimistic / stale-write-guard logic exists in one file.
```

- [ ] **Step 2: Update the progress snapshot near the top**

Find the line that reads:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 8 resolved (18 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 9 resolved (17 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

- [ ] **Step 3: Commit**

```bash
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark H20 (param-hook merge) resolved"
```

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| H20 — four duplicated param hooks | Tasks 1 (delete 2 dead) + 2 (extract core) + 3 + 4 (wrap live) + 5 (audit doc) |

H20 is the only finding this plan targets.

**Placeholder scan:** none. Every step has full code; tests are runnable as written.

**Type consistency:** `useParam` defined in Task 2 is referenced by both wrappers in Tasks 3 and 4. `ParamTarget` discriminated union shape (`{ kind: 'canonical' | 'widget' }`) is consistent across the hook body and its tests. Existing call sites of `useCanonicalParam` / `useProcessingParam` are NOT touched — their signatures match the wrappers exactly.

**Risk analysis:**
- Behaviour-preserving wrapper approach minimises blast radius. If anything regresses, it manifests in `useCanonicalParam.test.tsx` (existing test file, unchanged) — caught by Task 3 Step 2.
- The widget-target read path is slightly different from `useProcessingParam`'s original: `useParam` consults the widget binding before the op-graph node, matching `useProcessingParam`'s original lookup order. Confirmed by the test in Task 2 (`widget target prefers a widget binding over the op-graph node`).
- The unused `_layerId` / `_adjustmentType` parameters in the `useProcessingParam` wrapper trigger no ESLint warnings (leading underscore exempts them per the existing config). Verify in Task 4 Step 3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-param-hook-merge.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
