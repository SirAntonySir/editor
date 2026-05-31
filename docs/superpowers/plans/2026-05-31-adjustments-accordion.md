# Adjustments Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Inspector "Adjustments" tab into a Lightroom-style accordion — AI suggestion sections pinned on top, then six fixed tool sections — every section a directly-editable *view over the canonical `(layer, op, param)` state* of the active layer.

**Architecture:** Sections read the canonical op_graph nodes (`canon:{layer}:{op}`) from `useBackendState().snapshot.operation_graph` and write them through the **widget-less `set_param`** backend tool (Phase 3 Slice 3). The canvas widget shells and the accordion are two views of one canonical value → free bidirectional sync. Section list comes from `ProcessingRegistry.getByCategory('adjust')` (6 ordered defs). Controls reuse the Phase-2a primitives (`SliderControl`, `CurveControl`). Editing a section does NOT spawn a widget; a per-section `↗` promotes to a canvas widget on demand.

**Tech Stack:** React 19 + TS strict, Zustand v5 + Immer, existing `backendTools` REST client, engine/ProcessingRegistry, Vitest + Testing Library.

---

## Background — what already exists (do not rebuild)

- **Backend canonical (DONE, Phase 3 Slices 1–3).** `set_param(layer_id, op, param, value)` writes canonical; op_graph projects one node per `(layer, op)` with id `canon:{layer}:{op}`. `set_param` REST tool ships at `POST /api/tools/set_param`. `delete_widget` resets a widget's owned canonical params (close ×); `accept_widget` keeps canonical (Apply).
- **op_graph on the FE.** `useBackendState((s) => s.snapshot)` → `snapshot.operation_graph.nodes: Node[]` (`src/types/operation-graph.ts`). `Node = { id, type, params: Record<string, number|string|boolean|CurvesValue>, layer_id?, ... }`. SSE swaps `operation_graph` in on every widget/canonical event (`backend-state-slice.ts:246`).
- **Optimistic store.** `applyOptimistic(nodeId, { bindings: [{paramKey, value}], baseRevision })`, keyed by the **op_graph node id** (`backend-state-slice.ts:31`). Since canon node ids ARE op_graph node ids, optimistic patches on `canon:{layer}:{op}` align with the renderer's node param read.
- **Controls.** `SliderControl` (`src/components/inspector/widget/primitives/SliderControl.tsx`) props `{ label, value, default, schema: SliderSchema, onChange }`. `CurveControl` (`.../CurveControl.tsx`) props `{ label, value: CurvesValue, onChange }`. `CurvesValue` + `IDENTITY_CURVES` in `src/types/curve.ts`.
- **ProcessingRegistry** (`src/lib/processing-registry.ts`) — `getByCategory('adjust')` returns the 6 `ProcessingDefinition`s in registration order: light, color, kelvin, curves, levels, filters. Each has `{ id, label, icon, adjustmentType, params: ParamDefinition[] }`. `adjustmentType` is the canonical op / node `type` (basic | kelvin | curves | levels | lut). `ParamDefinition = { key, label, min, max, default, step?, format? }`.
- **Active layer.** `useEditorStore((s) => s.activeLayerId)` (`src/store/layer-slice.ts`).
- **backendTools** (`src/lib/backend-tools.ts`) — `invokeTool(name, sessionId, input)` POSTs `{ session_id, input }` to `/api/tools/{name}`. `accept_widget`, `delete_widget`, `propose_widget`, `set_widget_param` already exist.
- **Session + offline gating.** `useBackendState((s) => s.sessionId)` and `sseStatus`. The canvas/toolrail disables when `sseStatus !== 'open'`; the accordion must gate writes the same way.

## Key decisions baked into this plan (reconciling the spec)

1. **Two `basic` sections share one canon node.** light + color both have `adjustmentType: 'basic'`, so both read/write `canon:{layer}:basic`, each filtered to its OWN `def.params` keys. No conflict — different param keys in one node.
2. **Sections come from ProcessingRegistry, not the 4-op engine registry.** ProcessingRegistry has all 6 with icons + params + adjustmentType.
3. **Canonical-direct writes, no auto-widget.** A section edit calls `set_param`; it never mints a widget. The `↗` button (Task 9) is the only path that spawns a canvas widget.
4. **Filters (lut) deferred.** Its body for the first cut is promote-only (`↗`), because LUT-over-canonical isn't defined yet. Header + collapsed "—" present; expand shows a single "Open on canvas" affordance. Logged as a known gap.
5. **AI sections** render from `snapshot.widgets` filtered to `status ∈ {active, accepted}` + `origin.kind === 'mcp_autonomous'`, ordered on top. They reuse the same canonical read/write hook (their bindings target canon nodes) plus Refine/Why/Apply via existing `backendTools`.

## File Structure

All new UI lives under `src/components/inspector/adjustments/`:

| File | Responsibility |
|---|---|
| `src/lib/backend-tools.ts` (modify) | add `set_param(sessionId, { layer_id, op, param, value })` |
| `src/hooks/useCanonicalParam.ts` (create) | read/write one canonical `(layer, op, param)` — optimistic + debounced `set_param`. Mirrors `useProcessingParam` but widget-less. |
| `src/components/inspector/adjustments/section-summary.ts` (create) | pure: given a def + canonical params, return `{ summary: string, dirty: boolean }` |
| `src/components/inspector/adjustments/ScalarSectionBody.tsx` (create) | render a def's scalar params as `SliderControl`s bound via `useCanonicalParam` + Reset |
| `src/components/inspector/adjustments/CurvesSectionBody.tsx` (create) | render `CurveControl` bound to `canon:{layer}:curves`.`curve` + Reset |
| `src/components/inspector/adjustments/PromoteOnlyBody.tsx` (create) | Filters interim body — single "Open on canvas" (`↗`) affordance |
| `src/components/inspector/adjustments/ToolSection.tsx` (create) | one tool section: header (icon, name, collapsed summary + dirty dot, chevron) + body switch by `adjustmentType` |
| `src/components/inspector/adjustments/AiSection.tsx` (create) | one AI widget section: header (AI badge, intent, scope chip) + reasoning + controls + footer (Refine/Why/Reset/Apply) |
| `src/components/inspector/adjustments/AdjustmentsAccordion.tsx` (create) | compose AI group + 6 tool sections; read active layer; own nothing but open/closed UI state |
| `src/store/tool-slice.ts` (modify) | add `expandedSectionIds: Set<string>` + `toggleSectionExpanded` |
| `src/components/inspector/InspectorPanel.tsx` (modify) | adjustments branch renders `<AdjustmentsAccordion />` (drop Suggestions + Layers) |

Tests sit beside each unit (`*.test.ts(x)`), matching the repo's existing colocated test convention.

---

### Task 1: `set_param` client + `useCanonicalParam` hook

**Files:**
- Modify: `src/lib/backend-tools.ts:69` (add method after `set_widget_param`)
- Create: `src/hooks/useCanonicalParam.ts`
- Test: `src/hooks/useCanonicalParam.test.ts`

- [ ] **Step 1: Add the client method.** In `src/lib/backend-tools.ts`, inside the `backendTools` object, after `set_widget_param` (line 71):

```ts
  set_param(sessionId: string, args: { layer_id: string; op: string; param: string; value: ControlValue }) {
    return invokeTool<{ ok: boolean }>('set_param', sessionId, args);
  },
```

- [ ] **Step 2: Write the failing hook test.** `src/hooks/useCanonicalParam.test.ts`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCanonicalParam } from './useCanonicalParam';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) },
}));

function seedSnapshot(nodes: { id: string; type: string; layer_id: string; params: Record<string, unknown> }[]) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
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

it('reads the canonical node param value', () => {
  seedSnapshot([{ id: 'canon:L1:basic', type: 'basic', layer_id: 'L1', params: { exposure: 42 } }]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 0));
  expect(result.current[0]).toBe(42);
});

it('falls back to the default when no canonical node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 7));
  expect(result.current[0]).toBe(7);
});

it('setter applies optimistic immediately and debounces set_param', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 0));
  act(() => { result.current[1](55); });
  // Optimistic read is instant:
  expect(result.current[0]).toBe(55);
  expect(backendTools.set_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 55 });
});
```

- [ ] **Step 3: Run it, confirm it fails.** Run: `npx vitest run src/hooks/useCanonicalParam.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement the hook.** `src/hooks/useCanonicalParam.ts`:

```ts
import { useCallback, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ControlValue } from '@/types/widget';

const DEBOUNCE_MS = 300;

/** Read/write one canonical (layer, op, param) value, widget-less.
 * op is the canonical node type (basic | kelvin | curves | levels | lut).
 * Mirrors useProcessingParam but routes through the set_param tool and keys
 * optimistic patches on the canon node id (which IS the op_graph node id). */
export function useCanonicalParam<T extends ControlValue = number>(
  layerId: string | null,
  op: string,
  param: string,
  defaultValue: T,
): [T, (v: T) => void] {
  const nodeId = layerId ? `canon:${layerId}:${op}` : '';
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  const value = useBackendState((s) => {
    const opt = s.optimistic.get(nodeId);
    const hit = opt?.bindings.find((b) => b.paramKey === param);
    if (hit) return hit.value as T;
    const node = s.snapshot?.operation_graph.nodes.find((n) => n.id === nodeId);
    const p = node?.params?.[param];
    return (p === undefined ? defaultValue : (p as T));
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((v: T) => {
    if (!layerId || !sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    useBackendState.getState().applyOptimistic(nodeId, {
      bindings: [{ paramKey: param, value: v as ControlValue }], baseRevision,
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void backendTools.set_param(sessionId, { layer_id: layerId, op, param, value: v as ControlValue });
    }, DEBOUNCE_MS);
  }, [layerId, sessionId, offline, nodeId, op, param]);

  return [value, set];
}
```

- [ ] **Step 5: Run the test, confirm it passes.** Run: `npx vitest run src/hooks/useCanonicalParam.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/backend-tools.ts src/hooks/useCanonicalParam.ts src/hooks/useCanonicalParam.test.ts
git commit -m "feat(accordion): set_param client + useCanonicalParam hook"
```

---

### Task 2: section value-summary helper (pure)

**Files:**
- Create: `src/components/inspector/adjustments/section-summary.ts`
- Test: `src/components/inspector/adjustments/section-summary.test.ts`

- [ ] **Step 1: Write the failing test.** `section-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sectionSummary } from './section-summary';
import type { ParamDefinition } from '@/types/processing';

const params: ParamDefinition[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
];

it('all-default → em-dash summary, not dirty', () => {
  expect(sectionSummary(params, { exposure: 0, contrast: 0 })).toEqual({ summary: '—', dirty: false });
});

it('empty canonical params → all-default', () => {
  expect(sectionSummary(params, {})).toEqual({ summary: '—', dirty: false });
});

it('one non-default → labelled summary + dirty', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: 0 })).toEqual({ summary: 'Exposure +12', dirty: true });
});

it('multiple non-default → comma-joined, signed', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: -10 })).toEqual({ summary: 'Exposure +12, Contrast −10', dirty: true });
});
```

- [ ] **Step 2: Run it, confirm it fails.** Run: `npx vitest run src/components/inspector/adjustments/section-summary.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `section-summary.ts`:

```ts
import type { ParamDefinition } from '@/types/processing';

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

/** Collapsed summary text + dirty flag for a scalar section, derived from the
 * canonical params of its (layer, op) node. Non-default params only. */
export function sectionSummary(
  params: ParamDefinition[],
  canonical: Record<string, unknown>,
): { summary: string; dirty: boolean } {
  const parts: string[] = [];
  for (const p of params) {
    const raw = canonical[p.key];
    const v = typeof raw === 'number' ? raw : p.default;
    if (v !== p.default) parts.push(`${p.label} ${signed(v)}`);
  }
  return parts.length === 0
    ? { summary: '—', dirty: false }
    : { summary: parts.join(', '), dirty: true };
}
```

- [ ] **Step 4: Run, confirm pass.** Run: `npx vitest run src/components/inspector/adjustments/section-summary.test.ts`. Expected: PASS (4).

- [ ] **Step 5: Commit.**

```bash
git add src/components/inspector/adjustments/section-summary.ts src/components/inspector/adjustments/section-summary.test.ts
git commit -m "feat(accordion): pure section value-summary helper"
```

---

### Task 3: `ScalarSectionBody` — sliders bound to canonical

**Files:**
- Create: `src/components/inspector/adjustments/ScalarSectionBody.tsx`
- Test: `src/components/inspector/adjustments/ScalarSectionBody.test.tsx`

- [ ] **Step 1: Write the failing test.** Renders one `SliderControl` per `def.params`; an edit calls `set_param` with the section's `adjustmentType` as `op`; Reset writes each param's default.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScalarSectionBody } from './ScalarSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ParamDefinition } from '@/types/processing';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) } }));

const params: ParamDefinition[] = [{ key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('renders a slider per param and writes canonical on edit', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '20' } });
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 20 });
});

it('Reset writes the default for every param', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  fireEvent.click(screen.getByText('Reset'));
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 0 });
});
```

- [ ] **Step 2: Run, confirm fail.** Run: `npx vitest run src/components/inspector/adjustments/ScalarSectionBody.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** `ScalarSectionBody.tsx`. Each `SliderControl` is driven by its own `useCanonicalParam` call, so hoist a module-scope `ScalarRow` (one hook call per row — no hooks-in-loop, and module-scope satisfies the no-nested-component rule). `ResetRow` writes each param's default through the same optimistic + `set_param` path:

```tsx
import { SliderControl } from '@/components/inspector/widget/primitives/SliderControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ParamDefinition } from '@/types/processing';

interface ScalarRowProps { layerId: string; op: string; param: ParamDefinition; }

function ScalarRow({ layerId, op, param }: ScalarRowProps) {
  const [value, setValue] = useCanonicalParam<number>(layerId, op, param.key, param.default);
  return (
    <SliderControl
      label={param.label}
      value={value}
      default={param.default}
      schema={{ control_type: 'slider', min: param.min, max: param.max, step: param.step ?? 1 }}
      onChange={setValue}
    />
  );
}

interface ResetRowProps { layerId: string; op: string; params: ParamDefinition[]; }

function ResetRow({ layerId, op, params }: ResetRowProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  function reset() {
    if (!sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    for (const p of params) {
      useBackendState.getState().applyOptimistic(`canon:${layerId}:${op}`, {
        bindings: [{ paramKey: p.key, value: p.default }], baseRevision,
      });
      void backendTools.set_param(sessionId, { layer_id: layerId, op, param: p.key, value: p.default });
    }
  }
  return (
    <div className="flex justify-end pt-1">
      <button type="button" onClick={reset} className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5">Reset</button>
    </div>
  );
}

interface ScalarSectionBodyProps { layerId: string; op: string; params: ParamDefinition[]; }

export function ScalarSectionBody({ layerId, op, params }: ScalarSectionBodyProps) {
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {params.map((p) => <ScalarRow key={p.key} layerId={layerId} op={op} param={p} />)}
      <ResetRow layerId={layerId} op={op} params={params} />
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass.** Run: `npx vitest run src/components/inspector/adjustments/ScalarSectionBody.test.tsx`. Expected: PASS (2).

- [ ] **Step 5: `npm run check`** (tsc + eslint + no-nested-component). Fix any lint. Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/components/inspector/adjustments/ScalarSectionBody.tsx src/components/inspector/adjustments/ScalarSectionBody.test.tsx
git commit -m "feat(accordion): ScalarSectionBody — canonical-bound sliders + reset"
```

---

### Task 4: `CurvesSectionBody` — CurveControl bound to canonical

**Files:**
- Create: `src/components/inspector/adjustments/CurvesSectionBody.tsx`
- Test: `src/components/inspector/adjustments/CurvesSectionBody.test.tsx`
- Verify first: the canonical param key for curves.

- [ ] **Step 1: Confirm the curve param key.** Read `src/lib/node-to-adjustment.ts` (curves→LUT branch) and `backend/app/tools/tool_defaults.py` (curves default). Confirm the node param key holding the `CurvesValue` (expected: `curve`). If it differs, use the real key everywhere below.

- [ ] **Step 2: Write the failing test.** Reads `CurvesValue` from `canon:{layer}:curves`.`curve`, defaults to `IDENTITY_CURVES`; editing writes via `set_param` op `curves`.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurvesSectionBody } from './CurvesSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { IDENTITY_CURVES } from '@/types/curve';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) } }));
// Stub the heavy SVG editor: expose a button that emits a changed CurvesValue.
vi.mock('@/components/inspector/widget/primitives/CurveControl', () => ({
  CurveControl: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button onClick={() => onChange({ ...IDENTITY_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] })}>edit-curve</button>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('writes the canonical curve on edit', () => {
  render(<CurvesSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('edit-curve'));
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', expect.objectContaining({ layer_id: 'L1', op: 'curves', param: 'curve' }));
});
```

- [ ] **Step 3: Run, confirm fail.** Run: `npx vitest run src/components/inspector/adjustments/CurvesSectionBody.test.tsx`. Expected: FAIL.

- [ ] **Step 4: Implement.** `CurvesSectionBody.tsx` (use the confirmed key, shown as `'curve'`):

```tsx
import { CurveControl } from '@/components/inspector/widget/primitives/CurveControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { IDENTITY_CURVES, type CurvesValue } from '@/types/curve';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

interface CurvesSectionBodyProps { layerId: string; }

export function CurvesSectionBody({ layerId }: CurvesSectionBodyProps) {
  const [value, setValue] = useCanonicalParam<CurvesValue>(layerId, 'curves', 'curve', IDENTITY_CURVES);
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  function reset() {
    if (!sessionId || offline) return;
    setValue(IDENTITY_CURVES);
  }
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <CurveControl label="Curves" value={value} onChange={setValue} />
      <div className="flex justify-end">
        <button type="button" onClick={reset} className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5">Reset</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run, confirm pass.** Run: `npx vitest run src/components/inspector/adjustments/CurvesSectionBody.test.tsx`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/components/inspector/adjustments/CurvesSectionBody.tsx src/components/inspector/adjustments/CurvesSectionBody.test.tsx
git commit -m "feat(accordion): CurvesSectionBody — canonical-bound curve editor"
```

---

### Task 5: open/closed UI state in the tool slice

**Files:**
- Modify: `src/store/tool-slice.ts`
- Test: `src/store/tool-slice.test.ts` (add cases; create if absent)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { useEditorStore } from '@/store';

it('toggleSectionExpanded adds then removes a section id', () => {
  const { toggleSectionExpanded } = useEditorStore.getState();
  toggleSectionExpanded('light');
  expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
  toggleSectionExpanded('light');
  expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(false);
});
```

- [ ] **Step 2: Run, confirm fail.** Run: `npx vitest run src/store/tool-slice.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/store/tool-slice.ts`: add to the interface `expandedSectionIds: Set<string>;` and `toggleSectionExpanded: (sectionId: string) => void;`; init `expandedSectionIds: new Set<string>(),`; implement mirroring `toggleWidgetExpanded`:

```ts
  toggleSectionExpanded: (sectionId) =>
    set((state) => {
      if (state.expandedSectionIds.has(sectionId)) state.expandedSectionIds.delete(sectionId);
      else state.expandedSectionIds.add(sectionId);
    }),
```

- [ ] **Step 4: Run, confirm pass.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/store/tool-slice.ts src/store/tool-slice.test.ts
git commit -m "feat(accordion): expandedSectionIds UI state"
```

---

### Task 6: `ToolSection` — header + body switch

**Files:**
- Create: `src/components/inspector/adjustments/ToolSection.tsx`
- Create: `src/components/inspector/adjustments/PromoteOnlyBody.tsx`
- Test: `src/components/inspector/adjustments/ToolSection.test.tsx`

- [ ] **Step 1: Implement `PromoteOnlyBody`** (Filters interim). It spawns a canvas widget for the op via `propose_widget` (origin `tool_invoked`, the tool id = def.id):

```tsx
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

interface PromoteOnlyBodyProps { toolId: string; }

export function PromoteOnlyBody({ toolId }: PromoteOnlyBodyProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const layerId = useEditorStore((s) => s.activeLayerId);
  function open() {
    if (!sessionId || offline || !layerId) return;
    void backendTools.propose_widget(sessionId, {
      intent: toolId, scope: { kind: 'global' } as never, fused_tool_id: toolId,
      layer_id: layerId, origin: 'tool_invoked',
    });
  }
  return (
    <div className="px-2.5 py-2">
      <button type="button" onClick={open} disabled={offline || !layerId}
        className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-1 disabled:opacity-40">
        ↗ Open on canvas
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing `ToolSection` test.** Collapsed shows summary + dirty dot from canonical; clicking header toggles `expandedSectionIds`; expanded renders the right body by `adjustmentType` (basic→sliders, curves→curve, lut→promote).

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSection } from './ToolSection';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { Sun } from 'lucide-react';

const lightDef = { id: 'light', label: 'Light', icon: Sun, category: 'adjust', adjustmentType: 'basic',
  params: [{ key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 }], Panel: () => null } as unknown as ProcessingDefinition;

beforeEach(() => {
  useEditorStore.setState({ expandedSectionIds: new Set(), activeLayerId: 'L1' } as never);
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [{ id: 'canon:L1:basic', type: 'basic', layer_id: 'L1', params: { exposure: 12 } }], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('collapsed shows the canonical summary and a dirty dot', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  expect(screen.getByText('Exposure +12')).toBeTruthy();
  expect(screen.getByTestId('dirty-dot')).toBeTruthy();
});

it('clicking the header expands and renders the scalar body', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  fireEvent.click(screen.getByText('Light'));
  expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
  expect(screen.getByRole('slider')).toBeTruthy();
});
```

- [ ] **Step 3: Run, confirm fail.** Expected: FAIL.

- [ ] **Step 4: Implement `ToolSection`.** Reads the canonical params for `def.adjustmentType` on the active layer; computes summary via `sectionSummary`; header toggles `toggleSectionExpanded(def.id)`; body switch:

```tsx
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { sectionSummary } from './section-summary';
import { ScalarSectionBody } from './ScalarSectionBody';
import { CurvesSectionBody } from './CurvesSectionBody';
import { PromoteOnlyBody } from './PromoteOnlyBody';

interface ToolSectionProps { def: ProcessingDefinition; layerId: string | null; }

export function ToolSection({ def, layerId }: ToolSectionProps) {
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(def.id));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const canonical = useBackendState((s) => {
    const id = layerId ? `canon:${layerId}:${def.adjustmentType}` : '';
    return (s.snapshot?.operation_graph.nodes.find((n) => n.id === id)?.params ?? {}) as Record<string, unknown>;
  });
  const { summary, dirty } = sectionSummary(def.params, canonical);
  const Icon = def.icon;
  return (
    <div className="border-b border-border">
      <button type="button" onClick={() => toggle(def.id)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
        <Icon size={14} />
        <span className="flex-1 text-xs font-medium text-text-primary">{def.label}</span>
        {!expanded && <span className="text-[10px] text-text-secondary num">{summary}</span>}
        {!expanded && dirty && <span data-testid="dirty-dot" className="w-1.5 h-1.5 rounded-full bg-accent" />}
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && layerId && (
        def.adjustmentType === 'curves' ? <CurvesSectionBody layerId={layerId} />
        : def.adjustmentType === 'lut' ? <PromoteOnlyBody toolId={def.id} />
        : <ScalarSectionBody layerId={layerId} op={def.adjustmentType} params={def.params} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run, confirm pass + `npm run check`.** Expected: PASS (2) + clean.

- [ ] **Step 6: Commit.**

```bash
git add src/components/inspector/adjustments/ToolSection.tsx src/components/inspector/adjustments/PromoteOnlyBody.tsx src/components/inspector/adjustments/ToolSection.test.tsx
git commit -m "feat(accordion): ToolSection header + body switch + Filters promote-only"
```

---

### Task 7: `AiSection` — editable AI widget section

**Files:**
- Create: `src/components/inspector/adjustments/AiSection.tsx`
- Test: `src/components/inspector/adjustments/AiSection.test.tsx`

AI sections render a widget's bindings against canonical (their binding `target.node_id` IS a canon node id) + a footer. Reuse `BindingRow` for the controls (the widget owns real `ControlBinding`s), wiring each row's `onChange` to `useCanonicalParam(layerId, node.type, paramKey, default)` via the binding's target. Footer buttons: **Refine** (`refine_widget`), **Why** (toggles `binding.reasoning`), **Reset** (write defaults), **Apply** (`accept_widget`). Close (×) on the header → `delete_widget`.

- [ ] **Step 1: Write the failing test.** Renders intent + reasoning; Apply calls `accept_widget`; header × calls `delete_widget`.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiSection } from './AiSection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import type { Widget } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({ backendTools: {
  accept_widget: vi.fn().mockResolvedValue({ ok: true }),
  delete_widget: vi.fn().mockResolvedValue({ ok: true }),
} }));

const widget = {
  id: 'w1', intent: 'Warm the sky', status: 'active',
  origin: { kind: 'mcp_autonomous' }, scope: { root: { kind: 'global' } },
  nodes: [{ id: 'canon:L1:kelvin', type: 'kelvin', layer_id: 'L1', params: { kelvin: 6200 } }],
  bindings: [], preview: { kind: 'none' },
} as unknown as Widget;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ expandedSectionIds: new Set(['w1']), activeLayerId: 'L1' } as never);
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [widget], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: widget.nodes as never, panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('renders the intent and Apply commits the widget', () => {
  render(<AiSection widget={widget} />);
  expect(screen.getByText('Warm the sky')).toBeTruthy();
  fireEvent.click(screen.getByText('Apply'));
  expect(backendTools.accept_widget).toHaveBeenCalledWith('s1', { widget_id: 'w1' });
});

it('header × discards the widget', () => {
  render(<AiSection widget={widget} />);
  fireEvent.click(screen.getByLabelText('Close'));
  expect(backendTools.delete_widget).toHaveBeenCalledWith('s1', { widget_id: 'w1', suppress_similar: false });
});
```

- [ ] **Step 2: Run, confirm fail.** Expected: FAIL.

- [ ] **Step 3: Implement `AiSection`.** Header: AI badge + `widget.intent` + scope chip + chevron + a `×` (aria-label "Close"). Body (when expanded): reasoning row (from the first binding's `reasoning` or `widget` intent), the controls (map `widget.bindings` → `BindingRow`, `onChange` → a per-binding canonical setter), footer Refine/Why/Reset/Apply. Gate all writes on `sessionId && sseStatus==='open'`. Use `useEditorStore.expandedSectionIds` keyed by `widget.id`. (Refine opens the existing refine flow; if that UI is heavy, for this task wire Apply/Close/Reset and render bindings; Refine/Why can call the existing handlers used by `WidgetShell`.)

  Implementation detail for binding writes: for each binding `b`, the canonical slot is `(layerId = b.target via node, op = node.type, param = b.target.param_key)`. Resolve the node from `widget.nodes.find(n => n.id === b.target.node_id)` to get `layer_id` + `type`, then write with `backendTools.set_param`. Keep the control value read from the node param (optimistic-aware) like `ToolSection`.

- [ ] **Step 4: Run, confirm pass + `npm run check`.** Expected: PASS (2) + clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/inspector/adjustments/AiSection.tsx src/components/inspector/adjustments/AiSection.test.tsx
git commit -m "feat(accordion): AiSection — editable AI widget section with Apply/Close"
```

---

### Task 8: `AdjustmentsAccordion` — compose the two groups

**Files:**
- Create: `src/components/inspector/adjustments/AdjustmentsAccordion.tsx`
- Test: `src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx`

- [ ] **Step 1: Write the failing test.** AI sections render above the six tool sections; switching `activeLayerId` re-points the tool sections (summary changes).

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { AdjustmentsAccordion } from './AdjustmentsAccordion';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { registerAllProcessing } from '@/processing';

beforeEach(() => {
  registerAllProcessing();
  useEditorStore.setState({ expandedSectionIds: new Set(), activeLayerId: 'L1' } as never);
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('renders the six tool sections in registry order', () => {
  render(<AdjustmentsAccordion />);
  for (const label of ['Light', 'Color', 'Kelvin', 'Curves', 'Levels', 'Filters']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run, confirm fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** `AdjustmentsAccordion.tsx`:

```tsx
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ToolSection } from './ToolSection';
import { AiSection } from './AiSection';

export function AdjustmentsAccordion() {
  const layerId = useEditorStore((s) => s.activeLayerId);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? []);
  const aiWidgets = widgets.filter(
    (w) => (w.status === 'active' || w.status === 'accepted') && w.origin.kind === 'mcp_autonomous',
  );
  const tools = ProcessingRegistry.getByCategory('adjust');
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {aiWidgets.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">AI Suggestions</div>
          {aiWidgets.map((w) => <AiSection key={w.id} widget={w} />)}
        </>
      )}
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">Tools</div>
      {tools.map((def) => <ToolSection key={def.id} def={def} layerId={layerId} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass + `npm run check`.** Expected: PASS + clean. (If `getByText` collides because a label appears twice, scope with `getAllByText` — but registry labels are unique.)

- [ ] **Step 5: Commit.**

```bash
git add src/components/inspector/adjustments/AdjustmentsAccordion.tsx src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx
git commit -m "feat(accordion): AdjustmentsAccordion composition (AI group + 6 tools)"
```

---

### Task 9: migrate `InspectorPanel` to the accordion

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx:34-41`
- Test: `src/components/inspector/InspectorPanel.test.tsx` (add/adjust)

- [ ] **Step 1: Write/adjust the failing test.** The adjustments tab renders `AdjustmentsAccordion` and no longer renders the Layers heading.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { InspectorPanel } from './InspectorPanel';
import { registerAllProcessing } from '@/processing';
import { useBackendState } from '@/store/backend-state-slice';

beforeEach(() => {
  registerAllProcessing();
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

it('adjustments tab shows the accordion tools, not a Layers section', () => {
  render(<InspectorPanel />);
  expect(screen.getByText('Light')).toBeTruthy();
  expect(screen.queryByText('Layers')).toBeNull();
});
```

- [ ] **Step 2: Run, confirm fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** In `InspectorPanel.tsx` replace the adjustments branch body:

```tsx
{tab === 'adjustments' ? (
  <AdjustmentsAccordion />
) : (
  <InfoTab />
)}
```

  Add `import { AdjustmentsAccordion } from './adjustments/AdjustmentsAccordion';`. Remove the now-unused `SuggestionsSection` and `LayersSection` imports/usages from this file. Leave those component files in place (retired, not deleted — `SuggestionsSection` logic is superseded by `AiSection`).

- [ ] **Step 4: Run, confirm pass + `npm run check`.** Expected: PASS + clean. ESLint may flag unused imports — remove them.

- [ ] **Step 5: Commit.**

```bash
git add src/components/inspector/InspectorPanel.tsx src/components/inspector/InspectorPanel.test.tsx
git commit -m "feat(accordion): InspectorPanel adjustments tab → AdjustmentsAccordion"
```

---

### Task 10: tool-section `↗` promote + full verification + live smoke

**Files:**
- Modify: `src/components/inspector/adjustments/ToolSection.tsx` (add a header `↗` for scalar/curve sections too)

- [ ] **Step 1: Add `↗` to scalar/curve section headers.** A small button in the expanded body footer (or header) that calls `propose_widget(origin: 'tool_invoked', fused_tool_id: def.id, layer_id, scope global)` — same call as `PromoteOnlyBody.open`. Extract that call into a shared helper `src/components/inspector/adjustments/promote.ts` (`promoteToCanvas(sessionId, toolId, layerId)`) and reuse it in both `PromoteOnlyBody` and the new button. Add a test asserting the helper builds the right `propose_widget` args.

- [ ] **Step 2: Full check.** Run: `npm run check`. Expected: clean (tsc + eslint + no-nested-component).

- [ ] **Step 3: Full unit run.** Run: `npx vitest run src/components/inspector/adjustments src/hooks/useCanonicalParam.test.ts`. Expected: all PASS.

- [ ] **Step 4: Live smoke (manual, with backend running).**
  1. Start backend (`cd backend && .venv/bin/uvicorn app.main:app --port 8787`) + `npm run dev`.
  2. Open an image. In the Adjustments tab, expand **Light**, drag **Exposure** → the canvas updates (canonical.updated SSE). Collapse → summary shows "Exposure +N" + dirty dot.
  3. Spawn the same op as a canvas widget via `↗`; drag the widget slider → the accordion value moves too (bidirectional sync). Drag the accordion → the widget moves. Confirm one value.
  4. On an AI suggestion section: **Apply** → section value persists, canvas shell goes (accept keeps canonical). On another: **×** → value resets, shell goes (close resets canonical).
  5. **Curves**: expand, drag a point → canvas updates; Reset → identity.

- [ ] **Step 5: Commit.**

```bash
git add src/components/inspector/adjustments/
git commit -m "feat(accordion): ↗ promote helper + verification"
```

---

## Self-Review notes

- **Spec coverage:** D1 coexistence (shared canonical value) ✓ Tasks 1/6/10-smoke; D2 six sections always visible ✓ Task 8; D3 AI editable sections ✓ Task 7; D4 active-layer scope ✓ Tasks 6/8; D5 canonical data model ✓ Task 1; D6 Layers removed from tab ✓ Task 9.
- **Known interim gaps (logged):** Filters = promote-only until LUT-over-canonical exists (Task 6). AI **Refine/Why** wiring reuses existing `WidgetShell` handlers; if those are entangled, scope to Apply/Close/Reset + bindings and file a follow-up for Refine/Why. The curve param key must be confirmed against `node-to-adjustment.ts` + backend `tool_defaults.py` (Task 4 Step 1) before coding the curve body.
- **Type consistency:** `op`/`adjustmentType` (basic|kelvin|curves|levels|lut) is used identically across `useCanonicalParam`, `ToolSection`, `set_param`. The canonical node id `canon:{layer}:{op}` is the single key for both reads (op_graph node) and optimistic patches.
- **no-nested-component rule:** every per-row component (`ScalarRow`, `ResetRow`) is module-scope, never declared inside a parent body.
