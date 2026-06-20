# Suggestions-UI Slice Split (H4 + Medium-bucket doctrine breach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close H4 ("two acceptance paths") by moving frontend-only suggestion-UI state (`pendingSuggestionIds`, `previewingSuggestionIds`, `acceptedSuggestions`) out of `backend-state-slice` (which is supposed to mirror the backend snapshot) into its own `useSuggestionsUi` slice, AND drop the SSE `widget.accepted` handler's redundant `acceptedSuggestions.add(id)` call. Also closes the related Medium-bucket finding "backend-state-slice stores frontend-only UI state".

**Architecture:** Research showed the "two acceptance paths" the audit flagged aren't truly equivalent — they represent different lifecycle stages: SSE `widget.accepted` is the backend's terminal confirmation (after `accept_widget` tool runs), while `addAcceptedSuggestion` is a frontend "already engaged" marker used by `useAutoTetherAiSuggestions` to ensure each suggestion is tethered onto the canvas exactly once. The SSE handler's `acceptedSuggestions.add(id)` line is dead/redundant — by the time the backend confirms acceptance, the FE has already added it via either `SuggestionChips.handleAllow` (user click) or `useAutoTetherAiSuggestions` (auto-tether on session resume). Removing that line ends the "two paths" framing without changing behaviour. Splitting the state into its own slice closes the doctrine breach.

**Tech Stack:** React + TypeScript (strict) + Zustand v5 + Immer + vitest. Frontend only.

---

## File Structure

**Create:**
- `src/store/suggestions-ui-slice.ts` — new Zustand store `useSuggestionsUi` holding the 3 sets + their actions.
- `src/store/suggestions-ui-slice.test.ts` — unit tests for the new slice.

**Modify:**
- `src/store/backend-state-slice.ts` — drop the 3 fields from `BackendState`, drop the 4 actions, drop `acceptedSuggestions.add` from the `widget.accepted` SSE handler, route the `widget.created` autonomous-pending marker through `useSuggestionsUi.getState()`, update `reset()` to no longer touch the moved fields. Also drop the dead `markPendingSuggestions` action (no production callers).
- `src/store/backend-state-slice.test.ts` — drop tests for the moved fields; keep tests verifying the SSE `widget.accepted` filter on `snapshot.widgets` still fires.
- `src/components/inspector/adjustments/AdjustmentsAccordion.tsx` — swap `useBackendState((s) => s.pendingSuggestionIds)` → `useSuggestionsUi((s) => s.pendingSuggestionIds)`.
- `src/components/ui/SuggestionChips.tsx` — same swap for `pendingSuggestionIds`, `previewingSuggestionIds`, `resolvePendingSuggestion`, `addAcceptedSuggestion`, `setPreviewSuggestion`.
- `src/hooks/useAutoTetherAiSuggestions.ts` — same swap for `pendingSuggestionIds`, `acceptedSuggestions`, `addAcceptedSuggestion`.
- `src/hooks/useImageNodeRender.ts` — same swap for `pendingSuggestionIds`, `previewingSuggestionIds`.
- `docs/audit-2026-06-15.md` — flip H4 to `[x]`; flip the related Medium-bucket entry; bump progress snapshot (26 High → 13 resolved).

**Not changed:**
- The on-wire shape of any SSE event.
- The behaviour observed by the user: chips still gate as pending, auto-tether still runs once per id, accept still removes the widget from the snapshot list.
- The 4 consumer call shapes (each `useBackendState((s) => s.<field>)` becomes `useSuggestionsUi((s) => s.<field>)` — identical selector, different store).

---

## Doctrine

> `useBackendState` mirrors the backend `SessionStateSnapshot` and the SSE event stream — its state should only be things the backend knows about. Frontend-only UI gates (pending, previewing, engaged) belong in dedicated UI slices. New code that needs to "remember which suggestions the user has dealt with" goes in `useSuggestionsUi`. The SSE handler may still bridge into the UI slice for one-shot syncs (e.g. marking a freshly-arrived autonomous widget as pending), but it does NOT track UI state itself.

---

### Task 1: Create `useSuggestionsUi` slice + unit tests

The new slice carries:
- `acceptedSuggestions: Set<string>` — widgets the user has engaged (clicked allow OR auto-tethered).
- `pendingSuggestionIds: Set<string>` — autonomous widgets awaiting user decision.
- `previewingSuggestionIds: Set<string>` — subset of pending whose effect the user is canvas-previewing via the chip eye icon.

Actions:
- `addAcceptedSuggestion(widgetId)` — mark engaged.
- `markPending(widgetIds)` — replace pending set (called from `backend-state-slice` on SSE `widget.created` for autonomous origin).
- `resolvePending(widgetId)` — drop one id from pending; also drop from previewing.
- `setPreview(widgetId, on)` — toggle a previewing id.
- `reset()` — clear all three sets.

**Files:**
- Create: `src/store/suggestions-ui-slice.ts`
- Create: `src/store/suggestions-ui-slice.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/suggestions-ui-slice.test.ts` with EXACTLY this content:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useSuggestionsUi } from './suggestions-ui-slice';

beforeEach(() => {
  useSuggestionsUi.getState().reset();
});

describe('useSuggestionsUi', () => {
  it('starts empty for all three sets', () => {
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.size).toBe(0);
    expect(s.pendingSuggestionIds.size).toBe(0);
    expect(s.previewingSuggestionIds.size).toBe(0);
  });

  it('addAcceptedSuggestion adds to acceptedSuggestions', () => {
    useSuggestionsUi.getState().addAcceptedSuggestion('w_1');
    useSuggestionsUi.getState().addAcceptedSuggestion('w_2');
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.has('w_1')).toBe(true);
    expect(s.acceptedSuggestions.has('w_2')).toBe(true);
    expect(s.acceptedSuggestions.size).toBe(2);
  });

  it('markPending replaces the pending set wholesale', () => {
    useSuggestionsUi.getState().markPending(['w_1', 'w_2']);
    expect(useSuggestionsUi.getState().pendingSuggestionIds.size).toBe(2);
    useSuggestionsUi.getState().markPending(['w_3']);
    const s = useSuggestionsUi.getState();
    expect(s.pendingSuggestionIds.size).toBe(1);
    expect(s.pendingSuggestionIds.has('w_3')).toBe(true);
    expect(s.pendingSuggestionIds.has('w_1')).toBe(false);
  });

  it('resolvePending removes from pending AND from previewing', () => {
    useSuggestionsUi.getState().markPending(['w_1', 'w_2']);
    useSuggestionsUi.getState().setPreview('w_1', true);
    useSuggestionsUi.getState().setPreview('w_2', true);
    useSuggestionsUi.getState().resolvePending('w_1');
    const s = useSuggestionsUi.getState();
    expect(s.pendingSuggestionIds.has('w_1')).toBe(false);
    expect(s.previewingSuggestionIds.has('w_1')).toBe(false);
    expect(s.pendingSuggestionIds.has('w_2')).toBe(true);
    expect(s.previewingSuggestionIds.has('w_2')).toBe(true);
  });

  it('setPreview on=true adds; on=false removes', () => {
    useSuggestionsUi.getState().setPreview('w_1', true);
    expect(useSuggestionsUi.getState().previewingSuggestionIds.has('w_1')).toBe(true);
    useSuggestionsUi.getState().setPreview('w_1', false);
    expect(useSuggestionsUi.getState().previewingSuggestionIds.has('w_1')).toBe(false);
  });

  it('reset clears all three sets', () => {
    useSuggestionsUi.getState().addAcceptedSuggestion('w_a');
    useSuggestionsUi.getState().markPending(['w_p']);
    useSuggestionsUi.getState().setPreview('w_pv', true);
    useSuggestionsUi.getState().reset();
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.size).toBe(0);
    expect(s.pendingSuggestionIds.size).toBe(0);
    expect(s.previewingSuggestionIds.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/store/suggestions-ui-slice.test.ts
```

Expected: import error (`Cannot find module './suggestions-ui-slice'`).

- [ ] **Step 3: Implement the slice**

Create `src/store/suggestions-ui-slice.ts` with EXACTLY this content:

```ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/** Frontend-only suggestion-UI state.
 *
 *  Kept OUT of `useBackendState` because that store mirrors the backend
 *  `SessionStateSnapshot` — these sets are pure UI gates the user drives
 *  via the SuggestionChips strip, the canvas preview eye, and the
 *  auto-tether hook.
 *
 *  - `acceptedSuggestions`: widgets the user has engaged at least once
 *    (clicked allow OR auto-tethered after session resume). Used by
 *    `useAutoTetherAiSuggestions` as a "tether-once" gate.
 *  - `pendingSuggestionIds`: autonomous widgets gated behind user
 *    Allow/Deny via chips. Populated reactively by `useBackendState`'s
 *    `widget.created` SSE handler (bridge call). Hides the widget from
 *    the inspector + canvas until resolved.
 *  - `previewingSuggestionIds`: subset of pending whose effect the user
 *    is canvas-previewing via the chip eye icon. */
export interface SuggestionsUiState {
  acceptedSuggestions: Set<string>;
  pendingSuggestionIds: Set<string>;
  previewingSuggestionIds: Set<string>;

  /** Mark a widget as engaged. Idempotent. */
  addAcceptedSuggestion: (widgetId: string) => void;
  /** Replace the pending set with `ids`. Called by the SSE handler when
   *  autonomous-origin widgets land in the snapshot. */
  markPending: (widgetIds: string[]) => void;
  /** Remove one id from pending; also clear its previewing flag. */
  resolvePending: (widgetId: string) => void;
  /** Toggle whether a pending suggestion's effect is shown on the canvas
   *  preview. `on=true` adds, `on=false` removes. */
  setPreview: (widgetId: string, on: boolean) => void;
  /** Drop all three sets — called by `useBackendState.reset()`. */
  reset: () => void;
}

export const useSuggestionsUi = create<SuggestionsUiState>()(
  immer((set) => ({
    acceptedSuggestions: new Set(),
    pendingSuggestionIds: new Set(),
    previewingSuggestionIds: new Set(),

    addAcceptedSuggestion: (widgetId) =>
      set((s) => {
        s.acceptedSuggestions.add(widgetId);
      }),

    markPending: (widgetIds) =>
      set((s) => {
        s.pendingSuggestionIds = new Set(widgetIds);
      }),

    resolvePending: (widgetId) =>
      set((s) => {
        s.pendingSuggestionIds.delete(widgetId);
        s.previewingSuggestionIds.delete(widgetId);
      }),

    setPreview: (widgetId, on) =>
      set((s) => {
        if (on) s.previewingSuggestionIds.add(widgetId);
        else s.previewingSuggestionIds.delete(widgetId);
      }),

    reset: () =>
      set((s) => {
        s.acceptedSuggestions = new Set();
        s.pendingSuggestionIds = new Set();
        s.previewingSuggestionIds = new Set();
      }),
  })),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/store/suggestions-ui-slice.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Run `npm run check`**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. Lint-warning count unchanged.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/store/suggestions-ui-slice.ts src/store/suggestions-ui-slice.test.ts
git commit -m "feat(store): add useSuggestionsUi for FE-only suggestion UI state"
```

---

### Task 2: Migrate the 4 consumer files to read from `useSuggestionsUi`

Each consumer currently does `useBackendState((s) => s.<field>)`. After Task 1 the new slice exists; before Task 3 strips the fields from `useBackendState`, both stores temporarily carry the same data. We migrate consumers first so Task 3's strip can land cleanly.

**Files:**
- Modify: `src/hooks/useImageNodeRender.ts` — `pendingSuggestionIds`, `previewingSuggestionIds`.
- Modify: `src/hooks/useAutoTetherAiSuggestions.ts` — `pendingSuggestionIds`, `acceptedSuggestions`, `addAcceptedSuggestion`.
- Modify: `src/components/ui/SuggestionChips.tsx` — `pendingSuggestionIds`, `previewingSuggestionIds`, `addAcceptedSuggestion`, `resolvePendingSuggestion` → `resolvePending`, `setPreviewSuggestion` → `setPreview`.
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.tsx` — `pendingSuggestionIds`.

The selector functions stay identical except for the source store. Method renames: `resolvePendingSuggestion` → `resolvePending`, `setPreviewSuggestion` → `setPreview` (the new slice uses the shorter names).

- [ ] **Step 1: Migrate `useImageNodeRender.ts`**

Open the file. Locate (around line 86-87):

```ts
  const pendingSuggestionIds = useBackendState((s) => s.pendingSuggestionIds);
  const previewingSuggestionIds = useBackendState((s) => s.previewingSuggestionIds);
```

Replace with:

```ts
  const pendingSuggestionIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
  const previewingSuggestionIds = useSuggestionsUi((s) => s.previewingSuggestionIds);
```

Add at the top of the file (or merge with the existing `@/store/...` imports):

```ts
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
```

- [ ] **Step 2: Migrate `useAutoTetherAiSuggestions.ts`**

Open the file. The `aiKey` selector reads `s.pendingSuggestionIds`; the effect body reads `bs.acceptedSuggestions` and `bs.pendingSuggestionIds` and calls `bs.addAcceptedSuggestion(id)`. Migrate ALL these to `useSuggestionsUi`.

Original (around lines 17-46):
```ts
export function useAutoTetherAiSuggestions(): void {
  const rf = useReactFlow();
  const aiKey = useBackendState((s) => {
    const widgets = s.snapshot?.widgets ?? [];
    return widgets
      .filter(
        (w) =>
          (w.status === 'active' || w.status === 'accepted')
          && w.origin.kind === 'mcp_autonomous'
          && !s.pendingSuggestionIds.has(w.id),
      )
      .map((w) => w.id)
      .join(',');
  });

  useEffect(() => {
    if (!aiKey) return;
    const bs = useBackendState.getState();
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    const viewport = { pan: { x, y }, zoom, screen };
    for (const id of aiKey.split(',')) {
      if (bs.acceptedSuggestions.has(id)) continue;
      if (bs.pendingSuggestionIds.has(id)) continue;
      const w = bs.snapshot?.widgets.find((x) => x.id === id);
      if (!w) continue;
      bs.addAcceptedSuggestion(id);
      tetherWorkspaceWidgetOnEngage(w, viewport);
    }
  }, [aiKey, rf]);
}
```

Replace with (the `aiKey` selector needs both stores — read pending from `useSuggestionsUi` via `.getState()` for the comparison; the snapshot read stays from `useBackendState`):

```ts
export function useAutoTetherAiSuggestions(): void {
  const rf = useReactFlow();
  // aiKey changes whenever the set of autonomous widget ids that aren't
  // pending changes. The pending lookup is read via getState() so the
  // selector only re-fires when the snapshot widgets list changes; the
  // pending set's churn is handled at engagement time below.
  const aiKey = useBackendState((s) => {
    const widgets = s.snapshot?.widgets ?? [];
    const pending = useSuggestionsUi.getState().pendingSuggestionIds;
    return widgets
      .filter(
        (w) =>
          (w.status === 'active' || w.status === 'accepted')
          && w.origin.kind === 'mcp_autonomous'
          && !pending.has(w.id),
      )
      .map((w) => w.id)
      .join(',');
  });

  useEffect(() => {
    if (!aiKey) return;
    const bs = useBackendState.getState();
    const ui = useSuggestionsUi.getState();
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    const viewport = { pan: { x, y }, zoom, screen };
    for (const id of aiKey.split(',')) {
      if (ui.acceptedSuggestions.has(id)) continue;
      if (ui.pendingSuggestionIds.has(id)) continue;
      const w = bs.snapshot?.widgets.find((x) => x.id === id);
      if (!w) continue;
      ui.addAcceptedSuggestion(id);
      tetherWorkspaceWidgetOnEngage(w, viewport);
    }
  }, [aiKey, rf]);
}
```

Add the import at the top:

```ts
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
```

- [ ] **Step 3: Migrate `src/components/ui/SuggestionChips.tsx`**

Open the file. Find the selectors (around lines 25, 57-60):

```ts
  const pendingIds = useBackendState((s) => s.pendingSuggestionIds);
// ...
  const resolve = useBackendState((s) => s.resolvePendingSuggestion);
  const addAccepted = useBackendState((s) => s.addAcceptedSuggestion);
  const previewingIds = useBackendState((s) => s.previewingSuggestionIds);
  const setPreview = useBackendState((s) => s.setPreviewSuggestion);
```

Replace with:

```ts
  const pendingIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
// ...
  const resolve = useSuggestionsUi((s) => s.resolvePending);
  const addAccepted = useSuggestionsUi((s) => s.addAcceptedSuggestion);
  const previewingIds = useSuggestionsUi((s) => s.previewingSuggestionIds);
  const setPreview = useSuggestionsUi((s) => s.setPreview);
```

Add the import at the top:

```ts
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
```

- [ ] **Step 4: Migrate `src/components/inspector/adjustments/AdjustmentsAccordion.tsx`**

Open the file. Find:

```ts
  const pendingIds = useBackendState((s) => s.pendingSuggestionIds);
```

Replace with:

```ts
  const pendingIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
```

Add the import at the top:

```ts
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
```

- [ ] **Step 5: Run `npm run check`**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors, lint warnings unchanged. The 4 consumer files now read from `useSuggestionsUi`; `useBackendState` still carries the data but no one reads it from there.

NOTE: Until Task 3 runs, the `widget.created` SSE handler in `backend-state-slice.ts` is still writing to its own `pendingSuggestionIds`, NOT to the new slice. So `useSuggestionsUi.getState().pendingSuggestionIds` starts empty and stays empty in this intermediate state — the chips won't appear. This is expected; Task 3 fixes the bridge.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/hooks/useImageNodeRender.ts src/hooks/useAutoTetherAiSuggestions.ts \
        src/components/ui/SuggestionChips.tsx \
        src/components/inspector/adjustments/AdjustmentsAccordion.tsx
git commit -m "refactor(suggestions): read suggestion UI state from useSuggestionsUi"
```

---

### Task 3: Strip moved fields from `backend-state-slice` + bridge SSE handler + drop redundant `widget.accepted` line

Now the consumer-facing migration is done. Remove the 3 fields + 4 actions from `useBackendState`; update the SSE handler at `widget.created` to bridge into `useSuggestionsUi.getState().markPending` for autonomous widgets; DROP the redundant `acceptedSuggestions.add(id)` line from the `widget.accepted` handler (the engagement set is FE-only and was already added by either `SuggestionChips.handleAllow` or `useAutoTetherAiSuggestions`); update `reset()` to also call `useSuggestionsUi.getState().reset()` so a fresh session clears everything.

Also drop the dead `markPendingSuggestions` action — production has no callers (verified via grep).

**Files:**
- Modify: `src/store/backend-state-slice.ts`
- Modify: `src/store/backend-state-slice.test.ts` — drop tests for moved fields; keep tests for the SSE snapshot filter.

- [ ] **Step 1: Strip the type fields**

In `src/store/backend-state-slice.ts`, locate the `BackendState` interface. Remove these field declarations (lines ~98, ~103-108, ~134-136, ~139, ~142, ~145):

```ts
  acceptedSuggestions: Set<string>;
  pendingSuggestionIds: Set<string>;
  previewingSuggestionIds: Set<string>;
  // ...
  addAcceptedSuggestion: (widgetId: WidgetId) => void;
  markPendingSuggestions: (ids: string[]) => void;
  resolvePendingSuggestion: (id: string) => void;
  setPreviewSuggestion: (id: string, on: boolean) => void;
```

Plus the surrounding JSDoc blocks for those fields. Keep all other fields/methods.

- [ ] **Step 2: Strip the initial-state lines**

In the `create(immer((set) => ({ ... })))` initializer, remove (around line 159-161):

```ts
    acceptedSuggestions: new Set(),
    pendingSuggestionIds: new Set(),
    previewingSuggestionIds: new Set(),
```

- [ ] **Step 3: Update the `widget.created` SSE handler to bridge into `useSuggestionsUi`**

In `applyEvent`, find the `widget.created` case (around lines 304-329). Replace the `s.pendingSuggestionIds.add(w.id);` line with a `useSuggestionsUi.getState().markPending(...)` call. The full updated block:

```ts
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            // Autonomous AI suggestions must wait for user Allow/Deny via
            // SuggestionChips before they reach the inspector or canvas, so
            // gate them as pending the moment they arrive — not on the rising
            // edge of mcpAnalyzeComplete (which races with widget.created).
            // Bridge into the FE-only suggestions UI slice; we additively
            // include the new id alongside whatever is already pending.
            if (w.origin.kind === 'mcp_autonomous') {
              const existing = useSuggestionsUi.getState().pendingSuggestionIds;
              useSuggestionsUi.getState().markPending([...existing, w.id]);
            }
            // Drain a matching per-slider Pin request (queued before the
            // backend roundtrip). When one is present, narrow the widget to
            // just those bindings via `pinnedWidgetParams` so it lands on the
            // canvas as a one-control shell rather than the full op widget.
            if (w.origin.kind === 'tool_invoked') {
              const firstNode = w.nodes[0];
              const layerId = firstNode?.layerId;
              const opType = firstNode?.type;
              if (layerId && opType) {
                const keys = useEditorStore.getState().consumePinRequest(layerId, opType);
                if (keys && keys.length > 0) {
                  useEditorStore.getState().setPinnedWidgetParams(w.id, keys);
                }
              }
            }
            tetherWorkspaceWidget(w);
            break;
          }
```

The cross-store call from inside an Immer producer is the same pattern already used for `consumePinRequest`/`setPinnedWidgetParams` — see audit finding C8 for the broader concern; this plan does not address C8.

Add the import at the top of `backend-state-slice.ts`:

```ts
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
```

- [ ] **Step 4: Drop the redundant line from `widget.accepted` handler**

Find the `widget.accepted` case (around lines 350-360):

```ts
          case 'widget.accepted': {
            const id = payload.widgetId as string;
            s.acceptedSuggestions.add(id);
            // Remove widget from snapshot — accept is a backend-confirmed terminal state.
            // Adjustment materialization now happens server-side; the backend will emit
            // updated operation_graph nodes that the pipeline picks up automatically.
            if (s.snapshot) {
              s.snapshot.widgets = s.snapshot.widgets.filter((w) => w.id !== id);
            }
            break;
          }
```

Replace with:

```ts
          case 'widget.accepted': {
            const id = payload.widgetId as string;
            // Remove widget from snapshot — accept is a backend-confirmed terminal state.
            // Adjustment materialization now happens server-side; the backend will emit
            // updated operation_graph nodes that the pipeline picks up automatically.
            // NOTE: we deliberately do NOT touch useSuggestionsUi here — by the time
            // accept arrives, the FE has already added the widget to
            // acceptedSuggestions via SuggestionChips.handleAllow (user click)
            // or useAutoTetherAiSuggestions (auto-tether on session resume).
            if (s.snapshot) {
              s.snapshot.widgets = s.snapshot.widgets.filter((w) => w.id !== id);
            }
            break;
          }
```

- [ ] **Step 5: Strip the moved actions from the initializer**

In the `create(immer(...))` initializer, remove:

```ts
    addAcceptedSuggestion: (widgetId) =>
      set((s) => {
        s.acceptedSuggestions.add(widgetId);
      }),

    markPendingSuggestions: (ids) =>
      set((s) => {
        s.pendingSuggestionIds = new Set(ids);
      }),

    resolvePendingSuggestion: (id) =>
      set((s) => {
        s.pendingSuggestionIds.delete(id);
        s.previewingSuggestionIds.delete(id);
      }),

    setPreviewSuggestion: (id, on) =>
      set((s) => {
        if (on) s.previewingSuggestionIds.add(id);
        else s.previewingSuggestionIds.delete(id);
      }),
```

- [ ] **Step 6: Update `reset()` to also clear the UI slice**

In the `reset` action body, remove the three lines that clear the moved sets and add a `useSuggestionsUi.getState().reset()` call. After:

```ts
    reset: () =>
      set((s) => {
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.acceptedSuggestions = new Set();           // ← remove
        s.pendingSuggestionIds = new Set();          // ← remove
        s.previewingSuggestionIds = new Set();       // ← remove
        // ... other resets
      }),
```

Replace with:

```ts
    reset: () => {
      set((s) => {
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        // ... other resets (preserve unchanged)
      });
      useSuggestionsUi.getState().reset();
    },
```

NOTE: the cross-store reset call lives OUTSIDE the immer producer (i.e. between `set((s) => {...})` and the closing brace of `reset:`). This matches how cross-store mutations should be done; the SSE handler keeps its existing in-producer cross-call pattern only because it's already established and C8 will sweep them together.

- [ ] **Step 7: Update `src/store/backend-state-slice.test.ts`**

Open the test file. Find tests that reference the moved fields:
- `reset clears snapshot, optimistic, and acceptedSuggestions` (line ~47)
- `applyEvent widget.accepted adds to acceptedSuggestions set` (line ~149)
- The assertion around line 188-189 (`Widget ID is in acceptedSuggestions`).

For each:
- The `reset` test should now assert that `useBackendState.getState()` no longer has `acceptedSuggestions` (the field is gone). Update by removing the `acceptedSuggestions: new Set(['w_x'])` seed and the `acceptedSuggestions.size).toBe(0)` assertion. Keep the snapshot + optimistic assertions.
- The `applyEvent widget.accepted` test should now assert that `s.snapshot.widgets` no longer contains the accepted id (the filter still fires). Remove the `acceptedSuggestions.has('w_1')).toBe(true)` line and replace with `expect(useBackendState.getState().snapshot?.widgets.find(w => w.id === 'w_1')).toBeUndefined()`.
- The line-188 assertion: same removal — replace with a snapshot-filter assertion.

If a test references `addAcceptedSuggestion` / `resolvePendingSuggestion` / `markPendingSuggestions` / `setPreviewSuggestion` actions on `useBackendState`, those calls need to be redirected to `useSuggestionsUi` OR the test deleted if it was testing the moved behaviour (which is now covered by Task 1's new test file).

- [ ] **Step 8: Run the full vitest + lint**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. Total test count: 785 + 6 (new useSuggestionsUi tests) − any redundant tests removed from `backend-state-slice.test.ts`.

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/store/backend-state-slice.ts src/store/backend-state-slice.test.ts
git commit -m "refactor(backend-state): move suggestion UI state to useSuggestionsUi"
```

---

### Task 4: Audit doc flip

Mark H4 and the related Medium-bucket entry as resolved.

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit H4**

Find:

```markdown
- [ ] **H4** — `src/store/backend-state-slice.ts:352, 357` vs. SSE `widget.accepted` — **two acceptance paths**: SSE removes the widget; frontend `addAcceptedSuggestion` keeps it. Double-render risk.
```

Replace with:

```markdown
- [x] **H4** — `src/store/backend-state-slice.ts:352, 357` vs. SSE `widget.accepted` — **two acceptance paths**: SSE removes the widget; frontend `addAcceptedSuggestion` keeps it. Double-render risk. **Fix landed:** the SSE handler's `acceptedSuggestions.add(id)` line was always redundant — by the time backend confirms acceptance, the FE has already added the widget via either `SuggestionChips.handleAllow` (user click) or `useAutoTetherAiSuggestions` (auto-tether on session resume). Dropped that line; the SSE handler now only filters the widget out of the snapshot. The two "paths" framing dissolves into one: FE marks engagement, backend confirms via snapshot mutation, and there's no overlap.
```

- [ ] **Step 2: Edit the Medium-bucket entry**

Find:

```markdown
- [ ] `src/store/backend-state-slice.ts` — stores frontend-only UI state (`pendingSuggestionIds`, `previewingSuggestionIds`) inside the slice that mirrors the backend snapshot. Doctrine breach.
```

Replace with:

```markdown
- [x] `src/store/backend-state-slice.ts` — stores frontend-only UI state (`pendingSuggestionIds`, `previewingSuggestionIds`) inside the slice that mirrors the backend snapshot. Doctrine breach. **Fix landed:** moved `pendingSuggestionIds`, `previewingSuggestionIds`, and `acceptedSuggestions` (plus their actions) into a new `useSuggestionsUi` slice. `useBackendState` now only carries snapshot-mirroring state. The `widget.created` SSE handler still bridges into `useSuggestionsUi.markPending` for autonomous-origin widgets (cross-store call; C8 sweeps these later).
```

- [ ] **Step 3: Bump the progress snapshot**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 12 resolved (14 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark H4 (acceptance paths) + Medium FE-state-in-backend-slice resolved"
```

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| H4 — two acceptance paths | Task 3 (drops the SSE handler's redundant `acceptedSuggestions.add`) + Task 4 (audit doc) |
| Medium — FE-only state in backend-state-slice | Task 1 (new slice) + Task 2 (consumer migration) + Task 3 (strip from backend-state-slice) + Task 4 (audit doc) |

Both findings close in the same cluster.

**Behavioural preservation:**
- Chip "Allow" still tethers + marks engaged + resolves pending.
- Chip "Deny" still deletes the widget backend-side + resolves pending.
- Auto-tether still runs exactly once per id across the editor lifetime.
- The SSE `widget.accepted` event still removes the widget from `snapshot.widgets`.
- `reset()` still clears all three sets (now via cross-store call instead of in-line).
- The hidden behavioural change: the dropped `acceptedSuggestions.add(id)` line in the SSE handler is a no-op for any case where the FE has already added the id (which is every realistic path). For edge cases where backend `accept_widget` ran without FE engagement first (rare/none), the widget gets removed from the snapshot but never marked engaged — but since there's only one consumer of `acceptedSuggestions` (the auto-tether hook), and the widget is now gone from the snapshot anyway, no consumer can act on the gap.

**Placeholder scan:** none.

**Type consistency:** `useSuggestionsUi` API (`addAcceptedSuggestion`, `markPending`, `resolvePending`, `setPreview`, `reset`) is defined in Task 1 and consumed in Tasks 2 + 3. Names shortened on the new slice (`resolvePending` not `resolvePendingSuggestion`); consumers updated in Task 2.

**Risk analysis:**
- Cross-store call in `widget.created` SSE handler: same pattern as existing `consumePinRequest`/`setPinnedWidgetParams` calls — flagged for C8 cleanup, not this cluster.
- The intermediate state between Task 2 and Task 3 has consumers reading from `useSuggestionsUi` (empty) while the SSE handler still writes to `useBackendState`. In that window the suggestion gating is broken. Task 2 and Task 3 should land in a single PR even if they're separate commits, to keep main green.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-suggestions-ui-slice.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
