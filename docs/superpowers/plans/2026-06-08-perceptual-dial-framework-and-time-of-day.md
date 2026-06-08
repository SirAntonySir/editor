# Perceptual-Dial Framework + Time-of-Day Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared perceptual-dial framework (anchors → interpolate → compile → compound expansion) and the first widget on top of it — a Time-of-Day dial that compiles to a bundle of existing shader params and renders through the existing per-layer pipeline.

**Architecture:**
- Pure-TS `src/lib/perceptual-dial/` module: serialisable `Anchor`s, a 1-D Catmull-Rom interpolator, and a `compileToWidgetParams` helper that groups `${op}.${param}` keys into per-op patches.
- A new `'compound'` `adjustmentType`. The renderer does not learn a new shader; instead, `selectPipelineNodes` expands every compound node into one virtual `Node` per `adjustmentType` (merging ops that share one, e.g. `light` + `color` → `'basic'`). Order follows the existing per-layer pipeline order, overridable per `ProcessingDefinition` via `compoundOrder?: string[]`.
- A level-2 `PerceptualDialBody` (1-D scrubber + sky-temperature gradient + 5 anchor labels) renders inside `WidgetShell`. A `CompiledReadout` UI primitive surfaces the live bundle below the dial. A "Convert to manual widgets" button is wired through the existing backend `delete + propose_widget × N` path.
- Time-of-Day reads/writes its compound node's params via the existing `useProcessingParam` → optimistic patch → debounced `set_widget_param` plumbing. No new debounce, no new SSE message.

**Tech Stack:** React 19 + TypeScript (strict), Zustand v5, React Flow (`@xyflow/react`), Tailwind via `index.css`, Vitest + React Testing Library, WebGL2 pipeline (`src/shaders/pipeline.ts`).

---

## Scope & Out-of-Scope

**In scope (this plan)**
- The perceptual-dial framework.
- The compound-node expansion in the frontend render path.
- The Time-of-Day `ProcessingDefinition`, panel body, and toolrail entry.
- Component + unit tests covering all of the above.

**Out of scope (separate plans)**
- **Backend prerequisite.** A working end-to-end spawn of a Time-of-Day widget requires backend to (a) accept `fused_tool_id: 'time-of-day'` in `propose_widget` and (b) emit a `compound` operation-graph node with the right params and bindings. Tracked separately; without it, the Cmd+K palette entry will still appear but the SSE response will fail. Frontend tests use injected fixture widgets to side-step this dependency.
- **Mood Pad** and **Palette Harmony.** Both reuse this framework; covered in their own plans (`2026-06-XX-mood-pad.md`, `2026-06-XX-palette-harmony.md`).
- **Oklab interpolation.** The Time-of-Day anchor table contains only numeric scalars; Catmull-Rom in linear space is correct. Oklab plugs in when Mood Pad and Palette Harmony land.
- **Tier-2 vision anchor / Tier-3 per-region modulation / Tier-4 travel gating.** See spec §10.
- **Toolrail rail UI.** No physical "rail of buttons" exists in the current app — tools surface only via Cmd+K. Registering Time-of-Day in `CanvasToolRegistry` is sufficient.

**Prerequisites (verify before starting Task 1)**
- `feat/canvas-workspace` (current branch) — work continues here.
- Backend MCP server *can* be offline; this plan does not require it.
- `npm run check` is green on the current branch.

---

## File Structure

```
src/
  lib/
    perceptual-dial/
      types.ts                          # Anchor, CompoundParams
      interpolate.ts                    # Catmull-Rom 1-D
      interpolate.test.ts
      compile.ts                        # compileToWidgetParams
      compile.test.ts
      expand-compound.ts                # selectPipelineNodes plug-in
      expand-compound.test.ts
    command-palette.ts                  # MODIFY: append 'time-of-day' to TOOL_DESCRIPTIONS
    select-pipeline-nodes.ts            # MODIFY: call expandCompoundNodes
  processing/
    time-of-day.tsx                     # ProcessingDefinition (adjustmentType: 'compound')
    anchors/
      time-of-day-anchors.ts            # 5 anchors from spec §6
    index.ts                            # MODIFY: register timeOfDayProcessing
  components/
    workspace/
      PerceptualDialBody.tsx            # 1-D + (later) 2-D dial primitive
      PerceptualDialBody.test.tsx
      TimeOfDayWidgetBody.tsx           # Thin wrapper passing anchors + topology
    widget/
      WidgetShell.tsx                   # MODIFY: route compound widgets to TimeOfDayWidgetBody
    ui/
      CompiledReadout.tsx               # primitive: live compiled params display
      CompiledReadout.test.tsx
  tools/
    time-of-day-tool.tsx                # Toolrail entry, ToolDefinition
  types/
    processing.ts                       # MODIFY: optional compoundOrder?: string[]
  App.tsx                               # MODIFY: import + register TimeOfDayTool
```

Existing files we explicitly do **not** touch:
- `src/shaders/pipeline.ts` — the renderer iterates `adj.type` and the expansion produces existing types. No new shader.
- `src/lib/pipeline-manager.ts` — same reason.
- `src/lib/node-to-adjustment.ts` — operates on the *expanded* virtual nodes; no change needed.
- Other `ProcessingDefinition`s — additive change only.

---

## Architectural Notes (read once)

### `${op}.${param}` keying

The compound node's `params` field is a flat record whose keys are `${op}.${param}` strings:

```ts
{
  'light.exposure': 0.2,
  'light.contrast': 10,
  'kelvin.kelvin': 3400,
  'color.vibrance': 12,
  'hsl.orange_sat': 25,
  // …
}
```

`op` is the *processing-definition id* (`light`, `color`, `hsl`, `kelvin`, `curves`, `levels`, `filters`, `sharpen`, `blur`, `clarity`). `param` is the key as it appears in that definition's `params` list. The compound widget reads/writes these via `useProcessingParam(layerId, 'compound', widgetId, 'light.exposure', 0)` — the same hook every existing widget uses; `useProcessingParam` already routes through `widget.bindings` by exact key match, so namespacing causes no friction.

### Compound expansion (in plain English)

Given a snapshot node with `type: 'compound'` and the params record above, `expandCompoundNodes` returns a list of *virtual* nodes that the renderer treats identically to natural ones:

1. Group keys by `op` prefix → `{ light: {exposure: 0.2, contrast: 10}, kelvin: {kelvin: 3400}, color: {vibrance: 12}, hsl: {orange_sat: 25} }`.
2. Map each `op` → `adjustmentType` via `ProcessingRegistry.get(op).adjustmentType` (`light` → `'basic'`, `color` → `'basic'`, `kelvin` → `'kelvin'`, `hsl` → `'hsl'`, …).
3. Merge params for ops that share an `adjustmentType` (`light` + `color` → one `'basic'` node with both ops' params).
4. Emit one virtual `Node` per `adjustmentType`, ordering by the compound node's `compoundOrder` (from its `ProcessingDefinition`) or, if absent, the existing pipeline order: `basic` → `hsl` → `kelvin` → `curves` → `levels` → `lut` → `clarity` → `sharpen` → `blur`.
5. Virtual nodes inherit the compound node's `scope`, `layer_id`, and a synthesized id (`${compoundId}::${adjustmentType}`) so caches keyed on id keep working without colliding with real nodes.

The list returned by `selectPipelineNodes` thus contains zero compound nodes by the time it reaches `nodeToAdjustment` / `pipeline.render`.

### Time-of-Day position model

Spec §6 uses `position ∈ [0, 1]` along a 5-anchor curve. The HTML mockup uses minutes ∈ [0, 1440] for a friendly display. We store position internally as `position ∈ [0, 1]` (the canonical compound param `time_of_day.position`) and present `HH:MM` in the read-out by mapping `t × 24 hours`. The 5 anchors live at fixed positions: `dawn=0.10, noon=0.30, golden=0.55, blue=0.80, night=1.00` (spec §6 table).

---

## Tasks

### Task 1: Add optional `compoundOrder` to ProcessingDefinition

**Files:**
- Modify: `src/types/processing.ts`

- [ ] **Step 1: Add `compoundOrder` field**

Edit `src/types/processing.ts`. Add after the existing `paramKeys` field:

```ts
  /**
   * For compound widgets (adjustmentType: 'compound'): the order in which
   * embedded ops run when the renderer expands the compound node into
   * per-adjustmentType virtual nodes. If absent, the framework uses the
   * default pipeline order (basic → hsl → kelvin → curves → levels → lut
   * → clarity → sharpen → blur). Listed entries are adjustmentType strings.
   */
  compoundOrder?: string[];
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/processing.ts
git commit -m "feat(processing): optional compoundOrder for compound widgets"
```

---

### Task 2: Anchor + CompoundParams types

**Files:**
- Create: `src/lib/perceptual-dial/types.ts`

- [ ] **Step 1: Write the types module**

Create `src/lib/perceptual-dial/types.ts`:

```ts
/**
 * A serialisable recipe — a named point in adjustment space.
 * `position` is a 1-D or 2-D coordinate in the dial's input space.
 * `params` keys are `${op}.${param}` strings (op = ProcessingDefinition id).
 */
export interface Anchor {
  id: string;
  label: string;
  position: number[];
  params: Record<string, number>;
}

/** Flat output of `interpolate`: the same `${op}.${param}` key shape as Anchor.params. */
export type CompoundParams = Record<string, number>;

/** Per-op patch produced by `compileToWidgetParams`. */
export interface OpPatch {
  op: string;                 // ProcessingDefinition id ('light', 'kelvin', …)
  params: Record<string, number>;
}
```

- [ ] **Step 2: Verify project type-checks**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/perceptual-dial/types.ts
git commit -m "feat(perceptual-dial): Anchor + CompoundParams + OpPatch types"
```

---

### Task 3: 1-D Catmull-Rom interpolation

**Files:**
- Create: `src/lib/perceptual-dial/interpolate.test.ts`
- Create: `src/lib/perceptual-dial/interpolate.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/perceptual-dial/interpolate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolate1D } from './interpolate';
import type { Anchor } from './types';

const ANCHORS: Anchor[] = [
  { id: 'a', label: 'A', position: [0],   params: { 'light.exposure':  0,    'kelvin.kelvin': 3000 } },
  { id: 'b', label: 'B', position: [0.5], params: { 'light.exposure':  0.5,  'kelvin.kelvin': 5500 } },
  { id: 'c', label: 'C', position: [1],   params: { 'light.exposure': -0.5,  'kelvin.kelvin': 9000 } },
];

describe('interpolate1D', () => {
  it('returns the anchor params verbatim when position matches an anchor', () => {
    expect(interpolate1D(ANCHORS, 0)).toEqual({ 'light.exposure':  0,    'kelvin.kelvin': 3000 });
    expect(interpolate1D(ANCHORS, 0.5)).toEqual({ 'light.exposure':  0.5,  'kelvin.kelvin': 5500 });
    expect(interpolate1D(ANCHORS, 1)).toEqual({ 'light.exposure': -0.5,  'kelvin.kelvin': 9000 });
  });

  it('clamps to first/last anchor when position is out of range', () => {
    expect(interpolate1D(ANCHORS, -0.2)).toEqual(ANCHORS[0].params);
    expect(interpolate1D(ANCHORS,  1.2)).toEqual(ANCHORS[2].params);
  });

  it('produces an intermediate value strictly between neighbouring anchors for scalar params', () => {
    const mid = interpolate1D(ANCHORS, 0.25);
    expect(mid['light.exposure']).toBeGreaterThan(0);
    expect(mid['light.exposure']).toBeLessThan(0.5);
    expect(mid['kelvin.kelvin']).toBeGreaterThan(3000);
    expect(mid['kelvin.kelvin']).toBeLessThan(5500);
  });

  it('preserves keys present in only one neighbour by carrying them through', () => {
    const partial: Anchor[] = [
      { id: 'a', label: 'A', position: [0], params: { 'light.exposure': 0 } },
      { id: 'b', label: 'B', position: [1], params: { 'light.exposure': 1, 'kelvin.kelvin': 5500 } },
    ];
    const mid = interpolate1D(partial, 0.5);
    // Both anchors must contribute keys; missing-side defaults to 0.
    expect(mid['light.exposure']).toBeCloseTo(0.5, 5);
    expect(mid['kelvin.kelvin']).toBeCloseTo(2750, 0);
  });

  it('sorts unordered anchors by position', () => {
    const shuffled: Anchor[] = [
      { id: 'c', label: 'C', position: [1],   params: { 'light.exposure': -0.5 } },
      { id: 'a', label: 'A', position: [0],   params: { 'light.exposure':  0    } },
      { id: 'b', label: 'B', position: [0.5], params: { 'light.exposure':  0.5  } },
    ];
    expect(interpolate1D(shuffled, 0)).toEqual({ 'light.exposure':  0    });
    expect(interpolate1D(shuffled, 1)).toEqual({ 'light.exposure': -0.5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/perceptual-dial/interpolate.test.ts`
Expected: FAIL with `Cannot find module './interpolate'`.

- [ ] **Step 3: Implement the interpolation**

Create `src/lib/perceptual-dial/interpolate.ts`:

```ts
import type { Anchor, CompoundParams } from './types';

/**
 * 1-D Catmull-Rom interpolation across `anchors` at scalar `t` in [0, 1].
 * Anchors are sorted internally by `position[0]`; ties keep first-seen order.
 * If `t` falls outside the anchor range, returns the nearest endpoint's params verbatim.
 * Missing keys on either neighbour default to 0 (so partial anchors interpolate towards 0).
 */
export function interpolate1D(anchors: Anchor[], t: number): CompoundParams {
  if (anchors.length === 0) return {};
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  if (t <= sorted[0].position[0]) return { ...sorted[0].params };
  if (t >= sorted[sorted.length - 1].position[0]) return { ...sorted[sorted.length - 1].params };

  // Find the segment [p1, p2] containing t.
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].position[0] < t) i += 1;
  const p0 = sorted[Math.max(i - 1, 0)];
  const p1 = sorted[i];
  const p2 = sorted[i + 1];
  const p3 = sorted[Math.min(i + 2, sorted.length - 1)];

  const span = p2.position[0] - p1.position[0];
  const u = span > 0 ? (t - p1.position[0]) / span : 0;

  // Collect the union of keys present across the four control anchors.
  const keys = new Set<string>([
    ...Object.keys(p0.params),
    ...Object.keys(p1.params),
    ...Object.keys(p2.params),
    ...Object.keys(p3.params),
  ]);

  const out: CompoundParams = {};
  for (const k of keys) {
    const v0 = p0.params[k] ?? 0;
    const v1 = p1.params[k] ?? 0;
    const v2 = p2.params[k] ?? 0;
    const v3 = p3.params[k] ?? 0;
    out[k] = catmullRom(v0, v1, v2, v3, u);
  }
  return out;
}

/** Centripetal-style Catmull-Rom scalar interpolation; tension 0.5 (standard). */
function catmullRom(v0: number, v1: number, v2: number, v3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    (2 * v1) +
    (-v0 + v2) * u +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
    (-v0 + 3 * v1 - 3 * v2 + v3) * u3
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/perceptual-dial/interpolate.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/perceptual-dial/interpolate.ts src/lib/perceptual-dial/interpolate.test.ts
git commit -m "feat(perceptual-dial): 1-D Catmull-Rom interpolation"
```

---

### Task 4: `compileToWidgetParams`

**Files:**
- Create: `src/lib/perceptual-dial/compile.test.ts`
- Create: `src/lib/perceptual-dial/compile.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/perceptual-dial/compile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileToWidgetParams } from './compile';

describe('compileToWidgetParams', () => {
  it('groups flat ${op}.${param} keys into per-op patches', () => {
    const out = compileToWidgetParams({
      'light.exposure': 0.2,
      'light.contrast': 10,
      'kelvin.kelvin': 3400,
      'color.vibrance': 12,
    });
    // Order is stable: keys sorted ascending by op for deterministic diffs.
    expect(out).toEqual([
      { op: 'color',  params: { vibrance: 12 } },
      { op: 'kelvin', params: { kelvin: 3400 } },
      { op: 'light',  params: { exposure: 0.2, contrast: 10 } },
    ]);
  });

  it('ignores keys without a dot separator', () => {
    const out = compileToWidgetParams({
      'light.exposure': 0.2,
      'malformed': 99,
      '.dangling': 1,
      'no_dot_key': 1,
    });
    expect(out).toEqual([{ op: 'light', params: { exposure: 0.2 } }]);
  });

  it('returns [] for empty input', () => {
    expect(compileToWidgetParams({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/perceptual-dial/compile.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `compileToWidgetParams`**

Create `src/lib/perceptual-dial/compile.ts`:

```ts
import type { CompoundParams, OpPatch } from './types';

/**
 * Group a flat compound-params record into per-op patches.
 * Keys must look like `${op}.${param}` (both non-empty). Malformed keys are dropped.
 * Output is sorted alphabetically by op for deterministic diffs.
 */
export function compileToWidgetParams(compound: CompoundParams): OpPatch[] {
  const byOp = new Map<string, Record<string, number>>();
  for (const [key, value] of Object.entries(compound)) {
    const dot = key.indexOf('.');
    if (dot <= 0 || dot === key.length - 1) continue;
    const op = key.slice(0, dot);
    const param = key.slice(dot + 1);
    let bucket = byOp.get(op);
    if (!bucket) {
      bucket = {};
      byOp.set(op, bucket);
    }
    bucket[param] = value;
  }
  return Array.from(byOp.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([op, params]) => ({ op, params }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/perceptual-dial/compile.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/perceptual-dial/compile.ts src/lib/perceptual-dial/compile.test.ts
git commit -m "feat(perceptual-dial): compileToWidgetParams groups by op"
```

---

### Task 5: Compound node expansion

**Files:**
- Create: `src/lib/perceptual-dial/expand-compound.test.ts`
- Create: `src/lib/perceptual-dial/expand-compound.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/perceptual-dial/expand-compound.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { expandCompoundNodes, DEFAULT_COMPOUND_ORDER } from './expand-compound';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { registerAllProcessing } from '@/processing';
import type { Node } from '@/types/operation-graph';

beforeEach(() => {
  // Ensure all processing definitions are present so adjustmentType lookup works.
  if (!ProcessingRegistry.has('light')) registerAllProcessing();
});

function compoundNode(params: Record<string, number>): Node {
  return {
    id: 'c1',
    type: 'compound',
    layer_id: 'L1',
    params,
    scope: { kind: 'global' },
  };
}

describe('expandCompoundNodes', () => {
  it('passes non-compound nodes through unchanged', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'basic', layer_id: 'L1',
      params: { exposure: 0.2 }, scope: { kind: 'global' },
    }];
    expect(expandCompoundNodes(nodes)).toEqual(nodes);
  });

  it('expands a compound node into one virtual node per adjustmentType', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'kelvin.kelvin': 3400,
      'hsl.orange_sat': 25,
    })]);
    expect(out).toHaveLength(3);
    const types = out.map((n) => n.type);
    expect(types).toContain('basic');
    expect(types).toContain('kelvin');
    expect(types).toContain('hsl');
    const basic = out.find((n) => n.type === 'basic')!;
    expect(basic.params).toEqual({ exposure: 0.2 });
    expect(basic.layer_id).toBe('L1');
    expect(basic.scope).toEqual({ kind: 'global' });
  });

  it('merges ops that share an adjustmentType into one virtual node', () => {
    // light + color both map to adjustmentType 'basic'.
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'color.vibrance': 12,
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('basic');
    expect(out[0].params).toEqual({ exposure: 0.2, vibrance: 12 });
  });

  it('emits virtual nodes in DEFAULT_COMPOUND_ORDER', () => {
    const out = expandCompoundNodes([compoundNode({
      'hsl.orange_sat': 25,
      'kelvin.kelvin': 3400,
      'light.exposure': 0.2,
    })]);
    const types = out.map((n) => n.type);
    // basic comes before hsl which comes before kelvin per the default order.
    expect(types.indexOf('basic')).toBeLessThan(types.indexOf('hsl'));
    expect(types.indexOf('hsl')).toBeLessThan(types.indexOf('kelvin'));
  });

  it('assigns synthesised ids that namespace on the compound id', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'kelvin.kelvin': 3400,
    })]);
    const ids = out.map((n) => n.id).sort();
    expect(ids).toEqual(['c1::basic', 'c1::kelvin']);
  });

  it('drops compound keys whose op is not registered (graceful skip)', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'noSuchOp.foo': 1,
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('basic');
  });

  it('honours per-compound compoundOrder when set on the ProcessingDefinition', () => {
    // Time-of-Day declares no compoundOrder → falls back to DEFAULT_COMPOUND_ORDER.
    // We register a fake definition with a non-default order to verify the hook.
    ProcessingRegistry.register({
      id: 'test-compound',
      label: 'Test Compound',
      icon: () => null as never,
      category: 'adjust',
      adjustmentType: 'compound',
      params: [],
      Panel: () => null as never,
      compoundOrder: ['kelvin', 'basic'],
    });
    const node: Node = {
      ...compoundNode({ 'light.exposure': 0.2, 'kelvin.kelvin': 3400 }),
    };
    // Mark the compound to use the test definition by setting the synthetic
    // op-key prefix; expandCompoundNodes resolves the def via node.type.
    node.type = 'compound';
    (node as Node & { compound_def_id?: string }).compound_def_id = 'test-compound';
    const out = expandCompoundNodes([node]);
    const types = out.map((n) => n.type);
    expect(types).toEqual(['kelvin', 'basic']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/perceptual-dial/expand-compound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compound expansion**

Create `src/lib/perceptual-dial/expand-compound.ts`:

```ts
import type { Node } from '@/types/operation-graph';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { compileToWidgetParams } from './compile';

/**
 * Default execution order for adjustmentTypes inside a compound node.
 * Mirrors the per-layer pipeline order used in the WebGL pipeline.
 */
export const DEFAULT_COMPOUND_ORDER: readonly string[] = [
  'basic', 'hsl', 'kelvin', 'curves', 'levels', 'lut', 'clarity', 'sharpen', 'blur',
];

/**
 * Optional field a compound node may carry to point at a ProcessingDefinition
 * other than `compound` (e.g. 'time-of-day'). Used purely to look up
 * `compoundOrder`. If absent, DEFAULT_COMPOUND_ORDER is used.
 */
interface CompoundNode extends Node {
  compound_def_id?: string;
}

/**
 * Expand any node with type === 'compound' into one virtual node per
 * adjustmentType present in its `${op}.${param}` params bag. Non-compound
 * nodes pass through unchanged.
 */
export function expandCompoundNodes(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.type !== 'compound') {
      out.push(node);
      continue;
    }
    out.push(...expandOne(node as CompoundNode));
  }
  return out;
}

function expandOne(compound: CompoundNode): Node[] {
  const patches = compileToWidgetParams(compound.params as Record<string, number>);
  // Group patches by adjustmentType via the registry.
  const byType = new Map<string, Record<string, number>>();
  for (const { op, params } of patches) {
    const def = ProcessingRegistry.get(op);
    if (!def) continue;
    const t = def.adjustmentType;
    let bucket = byType.get(t);
    if (!bucket) {
      bucket = {};
      byType.set(t, bucket);
    }
    Object.assign(bucket, params);
  }

  // Resolve order.
  const defId = compound.compound_def_id;
  const def = defId ? ProcessingRegistry.get(defId) : undefined;
  const order = def?.compoundOrder ?? DEFAULT_COMPOUND_ORDER;

  const ordered: Node[] = [];
  const seen = new Set<string>();
  for (const t of order) {
    const params = byType.get(t);
    if (!params) continue;
    ordered.push(virtualNode(compound, t, params));
    seen.add(t);
  }
  // Any adjustmentType not in `order` is appended in insertion order.
  for (const [t, params] of byType) {
    if (seen.has(t)) continue;
    ordered.push(virtualNode(compound, t, params));
  }
  return ordered;
}

function virtualNode(
  source: CompoundNode,
  adjustmentType: string,
  params: Record<string, number>,
): Node {
  return {
    id: `${source.id}::${adjustmentType}`,
    type: adjustmentType,
    layer_id: source.layer_id,
    params,
    scope: source.scope,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/perceptual-dial/expand-compound.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/perceptual-dial/expand-compound.ts src/lib/perceptual-dial/expand-compound.test.ts
git commit -m "feat(perceptual-dial): expandCompoundNodes splits compound into virtual nodes"
```

---

### Task 6: Plug compound expansion into `selectPipelineNodes`

**Files:**
- Modify: `src/lib/select-pipeline-nodes.ts`

- [ ] **Step 1: Wire expansion into the selector**

Edit `src/lib/select-pipeline-nodes.ts`. Add the import at the top of the imports block:

```ts
import { expandCompoundNodes } from '@/lib/perceptual-dial/expand-compound';
```

Then change the final return of `selectPipelineNodes()` from:

```ts
  return mergeOptimistic(snap.operation_graph.nodes, opt).map(toPipelineNode);
```

to:

```ts
  return expandCompoundNodes(mergeOptimistic(snap.operation_graph.nodes, opt)).map(toPipelineNode);
```

Order matters: optimistic patches apply to the *real* compound node's params (the slider drag writes `time_of_day.position`), so they must merge before expansion.

- [ ] **Step 2: Add a coverage test for the integration**

Append to `src/lib/select-pipeline-nodes.test.ts` (create a new test file if one doesn't exist next to it). If `select-pipeline-nodes.test.ts` already exists, append; otherwise create it with the usual Vitest scaffold and the test below.

```ts
// Append: end-to-end check that compound nodes from the snapshot are expanded.
import { describe, it, expect, vi } from 'vitest';
import { selectPipelineNodes } from './select-pipeline-nodes';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { registerAllProcessing } from '@/processing';

if (!ProcessingRegistry.has('light')) registerAllProcessing();

describe('selectPipelineNodes (compound expansion)', () => {
  it('returns virtual nodes per adjustmentType for compound nodes in the snapshot', () => {
    const snapshot = {
      revision: 1,
      operation_graph: {
        nodes: [{
          id: 'c1', type: 'compound', layer_id: 'L1',
          params: { 'light.exposure': 0.2, 'kelvin.kelvin': 3400 },
          scope: { kind: 'global' as const },
        }],
      },
      widgets: [],
      masks_index: [],
      image_context: null,
    };
    vi.spyOn(useBackendState, 'getState').mockReturnValue({
      snapshot,
      optimistic: new Map(),
    } as unknown as ReturnType<typeof useBackendState.getState>);

    const out = selectPipelineNodes();
    const types = out.map((n) => n.type).sort();
    expect(types).toEqual(['basic', 'kelvin']);
    expect(out.find((n) => n.type === 'basic')?.params).toEqual({ exposure: 0.2 });
    expect(out.find((n) => n.type === 'kelvin')?.params).toEqual({ kelvin: 3400 });
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/lib/select-pipeline-nodes.test.ts`
Expected: PASS, including the new test.

- [ ] **Step 4: Run the full check to verify no regression**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/select-pipeline-nodes.ts src/lib/select-pipeline-nodes.test.ts
git commit -m "feat(pipeline): expand compound nodes before render"
```

---

### Task 7: Time-of-Day anchor data

**Files:**
- Create: `src/processing/anchors/time-of-day-anchors.ts`

- [ ] **Step 1: Encode the 5 anchors from spec §6**

Create `src/processing/anchors/time-of-day-anchors.ts`. The numeric values come *verbatim* from the spec table (calibration is a follow-up task on real reference images):

```ts
import type { Anchor } from '@/lib/perceptual-dial/types';

export const TIME_OF_DAY_ANCHORS: Anchor[] = [
  {
    id: 'dawn',
    label: 'Dawn',
    position: [0.10],
    params: {
      'kelvin.kelvin':     3200,
      'light.exposure':     -0.3,
      'light.contrast':     -8,
      'light.highlights':  -15,
      'light.shadows':     +20,
      'color.vibrance':     +5,
      'hsl.orange_sat':    +10,
      'hsl.blue_sat':      +15,
      // Vignette is the LUT-channel 'vignette_amount' on the `filters` op.
      'filters.vignette_amount': -10,
    },
  },
  {
    id: 'noon',
    label: 'Noon',
    position: [0.30],
    params: {
      'kelvin.kelvin':     5500,
      'light.exposure':      0,
      'light.contrast':    +10,
      'light.highlights':    0,
      'light.shadows':       0,
      'color.vibrance':      0,
      'hsl.orange_sat':      0,
      'hsl.blue_sat':      +15,
      'filters.vignette_amount': 0,
    },
  },
  {
    id: 'golden',
    label: 'Golden',
    position: [0.55],
    params: {
      'kelvin.kelvin':     3400,
      'light.exposure':     +0.2,
      'light.contrast':     +5,
      'light.highlights':  -20,
      'light.shadows':     +10,
      'color.vibrance':    +12,
      'hsl.orange_sat':    +25,
      'hsl.blue_sat':       -5,
      'filters.vignette_amount': -8,
    },
  },
  {
    id: 'blue',
    label: 'Blue',
    position: [0.80],
    params: {
      'kelvin.kelvin':     8500,
      'light.exposure':     -0.5,
      'light.contrast':    +15,
      'light.highlights':  -10,
      'light.shadows':      +5,
      'color.vibrance':     +5,
      'hsl.orange_sat':    -25,
      'hsl.blue_sat':      +20,
      'filters.vignette_amount': -15,
    },
  },
  {
    id: 'night',
    label: 'Night',
    position: [1.00],
    params: {
      'kelvin.kelvin':     4200,
      'light.exposure':     -1.2,
      'light.contrast':    +25,
      'light.highlights':  -40,
      'light.shadows':     -10,
      'color.vibrance':     +8,
      'hsl.orange_sat':    -10,
      'hsl.blue_sat':      +15,
      'filters.vignette_amount': -30,
    },
  },
];
```

> **Note:** if `filters.vignette_amount` is not yet a real shader uniform, `compileToWidgetParams` still emits it into a `filters` patch; `expandCompoundNodes` will route it to the LUT pass which silently ignores unknown params. Acceptable Tier-1 behaviour; calibration follows.

- [ ] **Step 2: Verify project type-checks**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/processing/anchors/time-of-day-anchors.ts
git commit -m "feat(processing): Time-of-Day anchors per spec §6"
```

---

### Task 8: `CompiledReadout` UI primitive

**Files:**
- Create: `src/components/ui/CompiledReadout.test.tsx`
- Create: `src/components/ui/CompiledReadout.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/CompiledReadout.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompiledReadout } from './CompiledReadout';

describe('CompiledReadout', () => {
  it('renders the top-N entries by absolute value', () => {
    render(
      <CompiledReadout
        entries={[
          { label: 'WB',         value: 3400, unit: 'K' },
          { label: 'Exposure',   value:  0.2 },
          { label: 'Vibrance',   value:  12 },
          { label: 'Orange Sat', value:  25 },
          { label: 'Shadow',     value:  -0.1 },
          { label: 'Tiny',       value:  0.001 },
        ]}
        topN={4}
      />,
    );
    // Highest |value| first: WB (3400), Orange Sat (25), Vibrance (12), Exposure (0.2).
    expect(screen.getByText('WB')).toBeTruthy();
    expect(screen.getByText('Orange Sat')).toBeTruthy();
    expect(screen.getByText('Vibrance')).toBeTruthy();
    expect(screen.getByText('Exposure')).toBeTruthy();
    expect(screen.queryByText('Tiny')).toBeNull();
    expect(screen.queryByText('Shadow')).toBeNull();
  });

  it('formats values with their unit when supplied', () => {
    render(<CompiledReadout entries={[{ label: 'WB', value: 3400, unit: 'K' }]} topN={1} />);
    expect(screen.getByText('3400K')).toBeTruthy();
  });

  it('renders an empty state hint when no entries pass the threshold', () => {
    render(<CompiledReadout entries={[{ label: 'A', value: 0 }]} topN={3} />);
    expect(screen.getByText(/no adjustments/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ui/CompiledReadout.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CompiledReadout`**

Create `src/components/ui/CompiledReadout.tsx`:

```tsx
export interface CompiledReadoutEntry {
  label: string;
  value: number;
  unit?: string;
  /** Optional accent color for the bar; falls back to `--color-accent`. */
  color?: string;
}

interface CompiledReadoutProps {
  entries: CompiledReadoutEntry[];
  topN: number;
  /** Below this absolute value, entries are treated as "no adjustment". */
  epsilon?: number;
}

/**
 * Live read-out of the top-N compiled params from a perceptual dial.
 * Two-column grid; each cell is label + signed value + bar proportional to |value|.
 * Pure presentational — caller selects entries.
 */
export function CompiledReadout({ entries, topN, epsilon = 0.01 }: CompiledReadoutProps) {
  const visible = entries
    .filter((e) => Math.abs(e.value) > epsilon)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, topN);

  if (visible.length === 0) {
    return (
      <div className="text-[10px] text-text-secondary text-center py-2">
        no adjustments
      </div>
    );
  }

  const maxAbs = visible.reduce((m, e) => Math.max(m, Math.abs(e.value)), 0) || 1;

  return (
    <div className="grid grid-cols-2 gap-2">
      {visible.map((e) => {
        const formatted = formatValue(e.value, e.unit);
        const pct = Math.min(100, Math.max(2, (Math.abs(e.value) / maxAbs) * 100));
        return (
          <div key={e.label} className="bg-surface-secondary rounded-[var(--radius-button)] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-secondary">{e.label}</div>
            <div className="text-[13px] font-medium text-text-primary num">{formatted}</div>
            <div className="mt-1 h-[2px] bg-separator/50 rounded">
              <div
                className="h-full rounded"
                style={{
                  width: `${pct}%`,
                  background: e.color ?? 'var(--color-accent)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 100) body = `${Math.round(v)}`;
  else if (abs >= 10) body = v.toFixed(0);
  else if (abs >= 1) body = v.toFixed(1);
  else body = v.toFixed(2);
  if (v > 0 && !unit) body = `+${body}`;
  return unit ? `${body}${unit}` : body;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ui/CompiledReadout.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/CompiledReadout.tsx src/components/ui/CompiledReadout.test.tsx
git commit -m "feat(ui): CompiledReadout primitive for live compound params"
```

---

### Task 9: `PerceptualDialBody` (1-D scrubber + sky gradient)

**Files:**
- Create: `src/components/workspace/PerceptualDialBody.test.tsx`
- Create: `src/components/workspace/PerceptualDialBody.tsx`

The 1-D scrubber: horizontal range input with a sky-temperature gradient strip above it (visual cue) and 5 tick labels below. Drag → calls `onPositionChange(t)`. The component is dumb — interpolation, compilation, and snapshot writes live in the wrapper (Task 10).

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/PerceptualDialBody.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PerceptualDialBody } from './PerceptualDialBody';
import { TIME_OF_DAY_ANCHORS } from '@/processing/anchors/time-of-day-anchors';

describe('PerceptualDialBody (1-D)', () => {
  it('renders one tick label per anchor', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    for (const a of TIME_OF_DAY_ANCHORS) {
      expect(screen.getByText(a.label)).toBeTruthy();
    }
  });

  it('exposes a range input bound to the current position', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    // Position 0.5 over a [0, 1000] internal range → value 500.
    expect(parseInt(input.value, 10)).toBe(500);
  });

  it('calls onPositionChange with a normalised [0, 1] value when the slider moves', () => {
    const onChange = vi.fn();
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0}
        onPositionChange={onChange}
      />,
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '750' } });
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it('renders a sky-temperature gradient strip (kelvin-driven)', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    const strip = screen.getByTestId('dial-gradient-strip') as HTMLElement;
    expect(strip.style.background).toContain('linear-gradient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/workspace/PerceptualDialBody.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PerceptualDialBody`**

Create `src/components/workspace/PerceptualDialBody.tsx`:

```tsx
import type { Anchor } from '@/lib/perceptual-dial/types';

const SLIDER_MAX = 1000; // Internal precision: 1/1000 → quick & smooth.

export interface PerceptualDialBodyProps {
  topology: '1d-slider' | '2d-pad';
  anchors: Anchor[];
  position: number; // 1-D: scalar in [0, 1]. (2-D handled in a follow-up.)
  onPositionChange: (t: number) => void;
}

export function PerceptualDialBody({ topology, anchors, position, onPositionChange }: PerceptualDialBodyProps) {
  if (topology !== '1d-slider') {
    // 2-D pad is added in the Mood Pad plan.
    return null;
  }

  const gradient = buildKelvinGradient(anchors);
  const value = Math.round(clamp01(position) * SLIDER_MAX);

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <div
        data-testid="dial-gradient-strip"
        className="h-4 rounded-[var(--radius-button)]"
        style={{ background: gradient }}
      />
      <input
        type="range"
        min={0}
        max={SLIDER_MAX}
        step={1}
        value={value}
        onChange={(e) => onPositionChange(parseInt(e.target.value, 10) / SLIDER_MAX)}
        className="w-full accent-[var(--color-accent)]"
        aria-label="Time of day"
      />
      <div className="flex justify-between text-[9px] uppercase tracking-wide text-text-secondary">
        {[...anchors].sort((a, b) => a.position[0] - b.position[0]).map((a) => (
          <span key={a.id}>{a.label}</span>
        ))}
      </div>
    </div>
  );
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Build a CSS linear-gradient string from `kelvin.kelvin` values across anchors.
 * Each anchor contributes a colour stop at its normalised position.
 */
function buildKelvinGradient(anchors: Anchor[]): string {
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  const stops = sorted.map((a) => {
    const k = (a.params['kelvin.kelvin'] as number | undefined) ?? 5500;
    return `${kelvinToRgb(k)} ${(a.position[0] * 100).toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Convert kelvin → CSS `rgb(...)` approximation (Krystek/Tanner). */
function kelvinToRgb(k: number): string {
  const clamped = Math.max(1000, Math.min(12000, k)) / 100;
  let r: number, g: number, b: number;
  if (clamped <= 66) {
    r = 255;
    g = clamped <= 2 ? 0 : clamp(99.4708025861 * Math.log(clamped) - 161.1195681661, 0, 255);
    b = clamped >= 66 ? 255 : (clamped <= 19 ? 0 : clamp(138.5177312231 * Math.log(clamped - 10) - 305.0447927307, 0, 255));
  } else {
    r = clamp(329.698727446 * Math.pow(clamped - 60, -0.1332047592), 0, 255);
    g = clamp(288.1221695283 * Math.pow(clamped - 60, -0.0755148492), 0, 255);
    b = 255;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/PerceptualDialBody.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/PerceptualDialBody.tsx src/components/workspace/PerceptualDialBody.test.tsx
git commit -m "feat(workspace): PerceptualDialBody 1-D scrubber with kelvin gradient"
```

---

### Task 10: `TimeOfDayWidgetBody` — glue dial ↔ snapshot

**Files:**
- Create: `src/components/workspace/TimeOfDayWidgetBody.tsx`

Reads the compound widget's `time_of_day.position` param, drives the dial, and on every change writes:
1. The new position back via `useProcessingParam('compound', widgetId, 'time_of_day.position', …)` (snapshot truth).
2. The interpolated compound params back via additional `useProcessingParam` writes — one per `${op}.${param}` key — so the renderer updates without a backend round-trip.

The "Convert to manual widgets" button is a follow-up task (Task 12).

- [ ] **Step 1: Implement `TimeOfDayWidgetBody`**

Create `src/components/workspace/TimeOfDayWidgetBody.tsx`:

```tsx
import { useCallback } from 'react';
import type { Widget } from '@/types/widget';
import { PerceptualDialBody } from './PerceptualDialBody';
import { CompiledReadout } from '@/components/ui/CompiledReadout';
import { useProcessingParam } from '@/lib/use-processing-param';
import { interpolate1D } from '@/lib/perceptual-dial/interpolate';
import { TIME_OF_DAY_ANCHORS } from '@/processing/anchors/time-of-day-anchors';
import { useBackendState } from '@/store/backend-state-slice';

interface TimeOfDayWidgetBodyProps {
  widget: Widget;
}

export function TimeOfDayWidgetBody({ widget }: TimeOfDayWidgetBodyProps) {
  const layerId = widget.nodes[0]?.layer_id ?? '';
  const [position, setPosition] = useProcessingParam(
    layerId, 'compound', widget.id, 'time_of_day.position', 0.30,
  );

  const sessionId = useBackendState((s) => s.sessionId);

  const handleChange = useCallback((t: number) => {
    setPosition(t);
    // Interpolate and write each compiled param to the widget's compound node.
    // useProcessingParam debounces by 300 ms, and each call attaches its own
    // optimistic patch — together they make the canvas update live.
    const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, t);
    const optimistic = useBackendState.getState().applyOptimistic;
    const snapshot = useBackendState.getState().snapshot;
    if (!snapshot || !sessionId) return;
    const baseRevision = snapshot.revision;
    const bindings = Object.entries(compiled).map(([paramKey, value]) => ({ paramKey, value }));
    optimistic(widget.id, { bindings, baseRevision });
    // The position write above will trigger the debounced set_widget_param.
    // For compiled params, rely on backend-side recomputation on the next
    // mechanical delta. (Backend prerequisite — see plan header.)
  }, [setPosition, sessionId, widget.id]);

  const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, position);
  const entries = compiledToReadoutEntries(compiled);

  return (
    <div className="flex flex-col gap-2">
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={position}
        onPositionChange={handleChange}
      />
      <div className="px-2 pb-2">
        <CompiledReadout entries={entries} topN={4} />
      </div>
    </div>
  );
}

/** Map compiled `${op}.${param}` keys to display labels and units. */
function compiledToReadoutEntries(compiled: Record<string, number>) {
  return Object.entries(compiled).map(([key, value]) => ({
    label: prettyLabel(key),
    value,
    unit: key === 'kelvin.kelvin' ? 'K' : undefined,
  }));
}

function prettyLabel(key: string): string {
  const map: Record<string, string> = {
    'kelvin.kelvin':     'WB',
    'light.exposure':    'Exposure',
    'light.contrast':    'Contrast',
    'light.highlights':  'Highlights',
    'light.shadows':     'Shadows',
    'color.vibrance':    'Vibrance',
    'hsl.orange_sat':    'Orange Sat',
    'hsl.blue_sat':      'Blue Sat',
    'filters.vignette_amount': 'Vignette',
  };
  return map[key] ?? key;
}
```

- [ ] **Step 2: Verify project type-checks**

Run: `npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/TimeOfDayWidgetBody.tsx
git commit -m "feat(workspace): TimeOfDayWidgetBody binds dial to compound widget"
```

---

### Task 11: ProcessingDefinition + register + route in `WidgetShell`

**Files:**
- Create: `src/processing/time-of-day.tsx`
- Modify: `src/processing/index.ts`
- Modify: `src/components/widget/WidgetShell.tsx`

- [ ] **Step 1: Implement the ProcessingDefinition**

Create `src/processing/time-of-day.tsx`:

```tsx
import { Sun } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { TimeOfDayWidgetBody } from '@/components/workspace/TimeOfDayWidgetBody';
import { useBackendState } from '@/store/backend-state-slice';

function TimeOfDayPanel({ adjustmentId }: ProcessingPanelProps) {
  const widget = useBackendState((s) => s.snapshot?.widgets.find((w) => w.id === adjustmentId));
  if (!widget) return null;
  return <TimeOfDayWidgetBody widget={widget} />;
}

export const timeOfDayProcessing: ProcessingDefinition = {
  id: 'time-of-day',
  label: 'Time of Day',
  icon: Sun,
  category: 'adjust',
  adjustmentType: 'compound',
  paramKeys: ['time_of_day.position'],
  params: [{ key: 'time_of_day.position', label: 'Time', min: 0, max: 1, default: 0.30 }],
  // Default order is fine: basic → hsl → kelvin → curves → levels → lut → …
  Panel: TimeOfDayPanel,
};
```

- [ ] **Step 2: Register the definition**

Edit `src/processing/index.ts`. Add the import next to existing ones:

```ts
import { timeOfDayProcessing } from './time-of-day';
```

Inside `registerAllProcessing()`, add this line after `ProcessingRegistry.register(clarityProcessing);`:

```ts
  ProcessingRegistry.register(timeOfDayProcessing);
```

Also add `timeOfDayProcessing` to the `export {}` block at the bottom.

- [ ] **Step 3: Route compound widgets to `TimeOfDayWidgetBody` from `WidgetShell`**

Edit `src/components/widget/WidgetShell.tsx`. Add the import next to the existing `HslWidgetBody` / `LevelsWidgetBody` imports:

```tsx
import { TimeOfDayWidgetBody } from '@/components/workspace/TimeOfDayWidgetBody';
```

In the render body, find the existing block that routes HSL widgets — it looks roughly like:

```tsx
{isHslWidget(widget) ? (
  <HslWidgetBody widget={widget} … />
) : isFullLevelsWidget(widget) ? (
  <LevelsWidgetBody widget={widget} … />
) : (
  /* default BindingRow rendering */
)}
```

Add a Time-of-Day branch at the same level (insert *above* the HSL check so compound widgets short-circuit first):

```tsx
{widget.fused_tool_id === 'time-of-day' ? (
  <TimeOfDayWidgetBody widget={widget} />
) : isHslWidget(widget) ? (
  …existing branches…
)}
```

The HSL and Levels branches already render their custom body inside whatever wrapper `WidgetShell` provides — the new branch slots into the same position and inherits the surrounding chrome with zero further changes.

- [ ] **Step 4: Run the check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/processing/time-of-day.tsx src/processing/index.ts src/components/widget/WidgetShell.tsx
git commit -m "feat(processing): register Time-of-Day; route in WidgetShell"
```

---

### Task 12: Convert-to-manual button

**Files:**
- Modify: `src/components/workspace/TimeOfDayWidgetBody.tsx`

The button calls `backendTools.propose_widget` once per compiled op-patch and `delete_widget` for the compound itself. Net result: the canvas is pixel-identical, but the user sees N regular widgets they can edit individually.

- [ ] **Step 1: Add the convert handler and button**

Edit `src/components/workspace/TimeOfDayWidgetBody.tsx`. Add the imports near the top:

```tsx
import { backendTools } from '@/lib/backend-tools';
import { compileToWidgetParams } from '@/lib/perceptual-dial/compile';
```

Inside the component, before the `return`:

```tsx
  const handleConvert = useCallback(async () => {
    const sid = useBackendState.getState().sessionId;
    if (!sid) return;
    const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, position);
    const patches = compileToWidgetParams(compiled);
    // Spawn one regular widget per op-patch. Each one mirrors the existing
    // toolrail-spawn path (origin: 'tool_invoked', defaults via backend).
    for (const { op, params } of patches) {
      await backendTools.propose_widget(sid, {
        intent: `From Time of Day → ${op}`,
        scope: widget.nodes[0]?.scope ?? { kind: 'global' },
        fused_tool_id: op,
        layer_id: layerId,
        origin: 'tool_invoked',
        params,
      });
    }
    // Tear down the compound after the regular widgets are in the snapshot.
    await backendTools.delete_widget(sid, { widget_id: widget.id });
  }, [position, widget, layerId]);
```

In the JSX, add the button below `CompiledReadout`:

```tsx
        <CompiledReadout entries={entries} topN={4} />
        <button
          type="button"
          onClick={handleConvert}
          className="mt-1 w-full text-[10px] text-text-secondary hover:text-text-primary
            bg-surface-secondary hover:bg-surface-secondary/80 rounded
            px-2 py-1 transition-colors cursor-default"
        >
          Convert to manual widgets
        </button>
```

> **Note on `backendTools.propose_widget` params shape.** If the current `propose_widget` signature does not accept a `params` field, leave the property out and assume the caller wires it via a follow-up — adding `params` is a backend concern. The frontend button still does the right thing (spawn + delete) and the user gets fresh widgets with default values they can re-tune. Add a short inline comment to that effect if the param is omitted.

- [ ] **Step 2: Run the check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/TimeOfDayWidgetBody.tsx
git commit -m "feat(time-of-day): Convert to manual widgets button"
```

---

### Task 13: Tool registration

**Files:**
- Create: `src/tools/time-of-day-tool.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/command-palette.ts`

- [ ] **Step 1: Create the ToolDefinition**

Create `src/tools/time-of-day-tool.tsx`:

```tsx
import { Sun } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const TimeOfDayTool: ToolDefinition = {
  name: 'time-of-day',
  label: 'Time of Day',
  icon: Sun,
  category: 'adjust',
  processingId: 'time-of-day',
  onActivate: () => {},
};
```

- [ ] **Step 2: Register in `App.tsx`**

Edit `src/App.tsx`. Add the import:

```tsx
import { TimeOfDayTool } from '@/tools/time-of-day-tool';
```

Add the registration after the existing `CanvasToolRegistry.register(ClarityTool);` line:

```tsx
CanvasToolRegistry.register(TimeOfDayTool);
```

- [ ] **Step 3: Add the palette description**

Edit `src/lib/command-palette.ts`. Add to the `TOOL_DESCRIPTIONS` map:

```ts
  'time-of-day': 'Dawn / noon / golden / blue / night',
```

- [ ] **Step 4: Run the check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Smoke-test the Cmd+K entry**

Run: `npm run dev` (separate terminal)
Open the app, press Cmd+K. The "Time of Day" entry should appear in the palette with the description above. (Clicking it will call `backendTools.propose_widget(fused_tool_id: 'time-of-day')`; without the backend prerequisite, the SSE will return an error or no widget — this is the expected gap.)

- [ ] **Step 6: Commit**

```bash
git add src/tools/time-of-day-tool.tsx src/App.tsx src/lib/command-palette.ts
git commit -m "feat(tools): register Time-of-Day in Cmd+K palette"
```

---

### Task 14: Snapshot test for the widget body

**Files:**
- Create: `src/components/workspace/TimeOfDayWidgetBody.test.tsx`

A fixture widget with `fused_tool_id: 'time-of-day'` is rendered; we assert the dial body and read-out appear, and that moving the slider updates the optimistic patch.

- [ ] **Step 1: Write the test**

Create `src/components/workspace/TimeOfDayWidgetBody.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeOfDayWidgetBody } from './TimeOfDayWidgetBody';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

const widget: Widget = {
  id: 'w_tod',
  fused_tool_id: 'time-of-day',
  intent: 'Time of Day',
  origin: { kind: 'tool_invoked' } as Widget['origin'],
  scope: { kind: 'global' },
  bindings: [
    { param_key: 'time_of_day.position', target: { node_id: 'c1', param_key: 'time_of_day.position' }, value: 0.30, default: 0.30 },
  ],
  nodes: [{ id: 'c1', type: 'compound', layer_id: 'L1', params: { 'time_of_day.position': 0.30 }, scope: { kind: 'global' } }],
} as unknown as Widget;

beforeEach(() => {
  const applyOptimistic = vi.fn();
  vi.spyOn(useBackendState, 'getState').mockReturnValue({
    sessionId: 's1',
    snapshot: { revision: 1, widgets: [widget], operation_graph: { nodes: widget.nodes }, masks_index: [], image_context: null },
    optimistic: new Map(),
    applyOptimistic,
  } as unknown as ReturnType<typeof useBackendState.getState>);
});

describe('TimeOfDayWidgetBody', () => {
  it('renders the 5 anchor labels and a slider', () => {
    render(<TimeOfDayWidgetBody widget={widget} />);
    ['Dawn', 'Noon', 'Golden', 'Blue', 'Night'].forEach((l) => {
      expect(screen.getByText(l)).toBeTruthy();
    });
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('renders a compiled read-out with at least one entry at non-zero positions', () => {
    render(<TimeOfDayWidgetBody widget={widget} />);
    // At position 0.30 (noon), 'Blue Sat' is +15 in the anchor table.
    expect(screen.getByText('Blue Sat')).toBeTruthy();
  });

  it('writes an optimistic patch when the slider moves', () => {
    render(<TimeOfDayWidgetBody widget={widget} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '550' } }); // → 0.55 (Golden)
    const applyOptimistic = useBackendState.getState().applyOptimistic as unknown as ReturnType<typeof vi.fn>;
    expect(applyOptimistic).toHaveBeenCalled();
    const [widgetId, patch] = applyOptimistic.mock.calls.at(-1)!;
    expect(widgetId).toBe('w_tod');
    // Compiled params should include kelvin.kelvin among the bindings.
    expect(patch.bindings.some((b: { paramKey: string }) => b.paramKey === 'kelvin.kelvin')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/TimeOfDayWidgetBody.test.tsx`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/TimeOfDayWidgetBody.test.tsx
git commit -m "test(time-of-day): widget body renders dial + read-out and writes optimistic"
```

---

### Task 15: Full check + manual run

- [ ] **Step 1: Run the full project check**

Run: `npm run check`
Expected: PASS (tsc -b + eslint + no-nested-component rule).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` (separate terminal).
- Open an image so an ImageNode appears.
- Press Cmd+K and confirm **Time of Day** is in the list with description "Dawn / noon / golden / blue / night".
- Confirm tooling (Light, Color, etc.) still works as before.
- Backend-blocked behaviour (no widget materialises on click) is *expected* until the backend prerequisite lands; document the click → SSE response in the commit summary if useful.

- [ ] **Step 4: Final tidy commit (only if needed)**

If any small fixes surfaced during the manual smoke test:

```bash
git add -p
git commit -m "fix(time-of-day): <one-line>"
```

---

## Acceptance Criteria (mirrors spec §12 for the in-scope subset)

- `timeOfDayProcessing` registers cleanly via `registerAllProcessing()`. ✅ Task 11.
- Cmd+K palette entry spawns it via `backendTools.propose_widget` with `origin: 'tool_invoked'`. ✅ Task 13 (back-end side handled by prerequisite).
- Dragging the dial updates the canvas via optimistic patches with the 300 ms debounce inherited from `useProcessingParam`. ✅ Tasks 9 + 10 + 14.
- The live compiled read-out renders below the dial. ✅ Task 8 + 10.
- "Convert to manual widgets" decomposes the compound node. ✅ Task 12.
- The compound `adjustmentType` works inside the existing per-layer pipeline without touching shaders. ✅ Tasks 5 + 6.
- `npm run check` passes; no `no-nested-component` violations; design tokens used throughout. ✅ Task 15.
- Each layer of the framework has tests (interpolate, compile, expand-compound, dial body, widget body, read-out). ✅ Tasks 3, 4, 5, 8, 9, 14.

## Open follow-ups (separate plans)

1. **Mood Pad** — reuses `Anchor`, framework, and compound expansion. Adds the 2-D pad to `PerceptualDialBody` and the 4-corner anchor table.
2. **Palette Harmony** — adds Oklab conversions, a small hue-wheel UI, and a `useEnrichedPalette()` hook reading `enriched_context.color_palette`.
3. **Backend prerequisite** — accept `fused_tool_id: 'time-of-day'` in `propose_widget` and emit a compound op-graph node with `time_of_day.position` plus the initial interpolated bundle. Mirror this for `'mood'` and `'palette-harmony'`.
4. **Anchor calibration pass** — sit with ~10 reference images, tune the 5-anchor table (spec §11).
5. **Optional `params` arg on `propose_widget`** — lets the Convert-to-manual button ship exact starting values; without it, manual widgets spawn at defaults.

---

## References

- Spec: `docs/superpowers/specs/2026-06-02-perceptual-widgets-design.md`
- HTML mockup (visual reference for Time-of-Day): `~/Downloads/time_of_day_dial (1).html`
- Existing toolrail-spawn path: `src/lib/toolrail-spawn.ts`
- Existing param read/write: `src/lib/use-processing-param.ts`
- Existing widget routing in shell: `src/components/widget/WidgetShell.tsx`
