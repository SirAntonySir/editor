# Phase 2a — Curve Editor Through the Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Curves tool spawn a real multi-channel curve editor whose points live in the backend op_graph and visibly drive the WebGL pipeline.

**Architecture:** Curve *points* (a small JSON object of `{x,y}` arrays per channel) are stored in the curves op_graph node param `curves`. A new `curve` control type renders the existing SVG spline editor bound to that param; edits flow through the normal `set_widget_param`/optimistic path. At render time the renderer evaluates the points → four 256-entry Float32Array LUTs (via the existing `evaluateCubicSpline`) and feeds the curves shader. The legacy `curve-points-store` is bypassed (its removal + the orphaned ProcessingDefinition panels are Phase 2b).

**Tech Stack:** TypeScript/React/Vite + Vitest; Python/FastAPI + pytest; WebGL.

**Key fact discovered:** Backend already allows structured control/param transport — `ControlValue = Union[float,int,str,bool,list,dict]`, `set_widget_param.value` accepts `list|dict`, and a `curve` `ControlSchema` exists. The blockers are: backend `ParamValue` is scalar-only; frontend `ControlValue`/`ParamValue` are scalar-only and have no `curve` control; the renderer drops non-numeric params (`nodeToAdjustment`). This plan closes exactly those.

---

## Curve value shape (used across all tasks)

```
CurvePoint  = { x: number; y: number }            // both 0..1
CurvesValue = { rgb: CurvePoint[]; red: CurvePoint[]; green: CurvePoint[]; blue: CurvePoint[] }
IDENTITY channel = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
```
The curves node holds `params.curves: CurvesValue`. One binding (`param_key: "curves"`, `control_type: "curve"`) edits all four channels.

---

## File Structure

- Modify: `src/types/widget.ts` — add `CurvePoint`/`CurvesValue`, extend `ControlValue`/`ParamValue`, add `'curve'` ControlType + `CurveSchema`.
- Modify: `backend/app/schemas/widget.py` — extend `ParamValue` to allow the curves dict.
- Modify: `backend/app/tools/tool_defaults.py` — curves tool → `curve` binding with identity points (replaces the `intensity` slider).
- Modify: `src/lib/node-to-adjustment.ts` — curves nodes: evaluate `params.curves` → `{rgb,red,green,blue}` Float32Array LUTs.
- Create: `src/components/inspector/widget/primitives/CurveEditor.tsx` — presentational SVG editor `{ value: CurvesValue, onChange }` (logic extracted from the existing `src/tools/curves-tool.tsx`).
- Create: `src/components/inspector/widget/primitives/CurveControl.tsx` — thin BindingRow adapter.
- Modify: `src/components/inspector/widget/BindingRow.tsx` — add `case 'curve'`.
- Tests: `src/types/widget.curve.test.ts`, `backend/tests/tools/test_tool_defaults_curve.py`, `src/lib/node-to-adjustment.test.ts` (extend), `src/components/inspector/widget/primitives/CurveControl.test.tsx`.

---

## Task 1: Frontend curve type model

**Files:**
- Modify: `src/types/widget.ts`
- Create: `src/types/widget.curve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/types/widget.curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { IDENTITY_CURVES, type CurvesValue } from './widget';

describe('curve value model', () => {
  it('IDENTITY_CURVES has identity points for all four channels', () => {
    const ch: (keyof CurvesValue)[] = ['rgb', 'red', 'green', 'blue'];
    for (const c of ch) {
      expect(IDENTITY_CURVES[c]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    }
  });

  it('IDENTITY_CURVES returns a fresh deep copy each call site is safe', () => {
    const a = IDENTITY_CURVES.rgb;
    expect(a).not.toBe(IDENTITY_CURVES.red); // distinct arrays per channel
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/types/widget.curve.test.ts`
Expected: FAIL — `IDENTITY_CURVES`/`CurvesValue` not exported.

- [ ] **Step 3: Extend the types**

In `src/types/widget.ts`:

1. Add the `'curve'` member to the `ControlType` union (the union starting at line 6). Append `| 'curve'`.

2. Add the curve point/value types and the identity constant near the `ControlValue` definition:

```ts
export interface CurvePoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface CurvesValue {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

/** A fresh identity-curve value (straight line) for all four channels. */
export const IDENTITY_CURVES: CurvesValue = {
  rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};
```

3. Extend the value/param unions:

```ts
export type ControlValue = number | string | boolean | CurvesValue;
```
```ts
export type ParamValue = number | string | boolean | CurvesValue;
```

4. Add a `CurveSchema` and include it in the `ControlSchema` union:

```ts
export interface CurveSchema {
  control_type: 'curve';
  min_points?: number;
  max_points?: number;
}
```
Add `| CurveSchema` to the `ControlSchema` union (the `export type ControlSchema = ...` at line 46).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/types/widget.curve.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: PASS. (If `nodeToAdjustment` or `use-processing-param` now error because `ParamValue` widened, that's expected to surface in Task 4 — if `tsc` errors here, note which files and continue; do NOT fix them in this task, just confirm the error is a widened-union narrowing issue, not a typo. If there are NO errors, even better.)

- [ ] **Step 6: Commit**

```bash
git add src/types/widget.ts src/types/widget.curve.test.ts
git commit -m "feat(curves): curve value type model (CurvesValue, curve control type)"
```

---

## Task 2: Backend — allow curve params + curves tool default

**Files:**
- Modify: `backend/app/schemas/widget.py` (the `ParamValue` alias, ~line 213)
- Modify: `backend/app/tools/tool_defaults.py` (the `curves` entry)
- Create: `backend/tests/tools/test_tool_defaults_curve.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/test_tool_defaults_curve.py`:

```python
from app.tools.tool_defaults import TOOL_DEFAULTS

IDENTITY = [{"x": 0, "y": 0}, {"x": 1, "y": 1}]


def test_curves_tool_uses_curve_control_with_identity_points():
    curves = TOOL_DEFAULTS["curves"]
    # node carries a structured `curves` param, not a scalar intensity
    node_params = curves["nodes"][0]["params"]
    assert node_params["curves"] == {
        "rgb": IDENTITY, "red": IDENTITY, "green": IDENTITY, "blue": IDENTITY,
    }
    assert curves["nodes"][0]["type"] == "curves"
    # single curve binding bound to the `curves` param
    b = curves["bindings"][0]
    assert b["param_key"] == "curves"
    assert b["control_type"] == "curve"
    assert b["control_schema"]["control_type"] == "curve"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_tool_defaults_curve.py -q`
Expected: FAIL — current curves default is an `intensity` slider.

- [ ] **Step 3: Allow structured params**

In `backend/app/schemas/widget.py`, change the `ParamValue` alias (currently `ParamValue = Union[float, int, str, bool]`) to:

```python
ParamValue = Union[float, int, str, bool, list, dict]
```

(`WidgetNode.params: dict[str, ParamValue]` then accepts the curves dict. `ControlValue` and `set_widget_param` already allow `list|dict`.)

**ALSO** check `backend/app/schemas/operation_graph.py` — the projected `Node.params` type. `project_to_graph` (`app/state/operations.py`) copies `wn.params` into the op_graph `Node`, and the renderer reads the curves dict from THERE. If `operation_graph.Node.params` is typed scalar-only (e.g. `dict[str, float]` or `dict[str, Union[float,int,str,bool]]`), widen it the same way to `dict[str, Union[float, int, str, bool, list, dict]]` (or whatever its existing alias is). Add a one-line assertion to the test below confirming a curves node survives projection. If it is already `dict[str, Any]`/permissive, no change needed — note that in your report.

Add to `backend/tests/tools/test_tool_defaults_curve.py`:

```python
def test_curves_node_survives_op_graph_projection():
    """A curves widget's structured `curves` param must survive project_to_graph
    (the renderer reads the points from the projected op_graph, not the widget)."""
    from app.state.document import SessionDocument
    from app.state.operations import project_to_graph
    from app.tools.tool_defaults import TOOL_DEFAULTS
    from app.schemas.widget import Widget, WidgetNode, ControlBinding, ControlSchema, NodeParamTarget, WidgetOrigin, WidgetPreview, Scope
    import uuid
    nd = TOOL_DEFAULTS["curves"]["nodes"][0]
    wid = "w_test"
    node = WidgetNode(
        id="n_curve", type="curves", params=nd["params"],
        scope=Scope.model_validate({"kind": "global"}), inputs=[], widget_id=wid,
        layer_id="layer_a",
    )
    widget = Widget(
        id=wid, intent="Curves", scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        fused_tool_id="curves", composed=False, nodes=[node], bindings=[],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )
    doc = SessionDocument(session_id="s1")
    doc.add_widget(widget)
    graph = project_to_graph(doc)
    proj = next(n for n in graph.nodes if n.id == "n_curve")
    assert proj.params["curves"]["rgb"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
```

> If the `Widget`/`WidgetNode` constructor signature in this test doesn't match the real schema (extra/missing required fields), adjust to the actual constructor — mirror how `backend/tests/state/test_operations.py` builds a `Widget` (it has a working `_widget(...)` factory you can copy the shape from).

- [ ] **Step 4: Replace the curves tool default**

In `backend/app/tools/tool_defaults.py`, replace the hand-written `TOOL_DEFAULTS["curves"] = {...}` block with:

```python
_IDENTITY_CURVE = [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
TOOL_DEFAULTS["curves"] = {
    "nodes": [{
        "type": "curves",
        "params": {"curves": {
            "rgb": list(_IDENTITY_CURVE), "red": list(_IDENTITY_CURVE),
            "green": list(_IDENTITY_CURVE), "blue": list(_IDENTITY_CURVE),
        }},
    }],
    "bindings": [{
        "param_key": "curves",
        "label": "Curves",
        "control_type": "curve",
        "control_schema": {"control_type": "curve", "min_points": 2, "max_points": 16},
        "value": {
            "rgb": list(_IDENTITY_CURVE), "red": list(_IDENTITY_CURVE),
            "green": list(_IDENTITY_CURVE), "blue": list(_IDENTITY_CURVE),
        },
        "default": {
            "rgb": list(_IDENTITY_CURVE), "red": list(_IDENTITY_CURVE),
            "green": list(_IDENTITY_CURVE), "blue": list(_IDENTITY_CURVE),
        },
    }],
}
```

- [ ] **Step 5: Run the curve test + the tool_invoked propose test**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_tool_defaults_curve.py tests/tools/widgets/test_propose_widget_layer_origin.py -q`
Expected: PASS. (Propose `curves` tool_invoked builds a widget; confirm the structured value survives Pydantic validation — `ControlValue`/`ParamValue` now permit dict.)

Then the full tools suite:
Run: `python -m pytest tests/tools/ tests/engine/ -q`
Expected: PASS (ignore the unrelated `test_panel_endpoint.py` ANTHROPIC_API_KEY failure if it appears in a broader run).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/widget.py backend/app/tools/tool_defaults.py backend/tests/tools/test_tool_defaults_curve.py
git commit -m "feat(curves): store curve points in op_graph; curve tool default"
```

---

## Task 3: Renderer — evaluate curve points → LUTs

**Files:**
- Modify: `src/lib/node-to-adjustment.ts`
- Modify: `src/lib/node-to-adjustment.test.ts`

**Context:** `src/lib/node-to-adjustment.ts` currently copies only numeric params into `Adjustment.params`, so a curves node's `curves` object is dropped. The curves shader (`src/shaders/pipeline.ts`, `this.shaders.set('curves', ...)`) reads `adj.params.rgb/red/green/blue` as `Float32Array` LUTs. This task makes a curves node produce those LUTs from its points via `evaluateCubicSpline` (`src/lib/curves.ts`, signature `evaluateCubicSpline(points: CurvePoint[]): Float32Array`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/node-to-adjustment.test.ts`:

```ts
import { IDENTITY_CURVES } from '@/types/widget';

it('evaluates a curves node into four Float32Array channel LUTs', () => {
  const node = {
    id: 'n_c', type: 'curves',
    params: { curves: {
      ...IDENTITY_CURVES,
      // brighten rgb: midpoint lifted
      rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
    } },
    scope: { kind: 'global' },
  } as unknown as Parameters<typeof nodeToAdjustment>[0];

  const adj = nodeToAdjustment(node);
  expect(adj.type).toBe('curves');
  for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
    expect(adj.params[ch]).toBeInstanceOf(Float32Array);
    expect((adj.params[ch] as Float32Array).length).toBe(256);
  }
  // rgb midpoint lifted above identity (0.5 -> >0.5)
  const rgb = adj.params.rgb as Float32Array;
  expect(rgb[128]).toBeGreaterThan(0.5);
});
```

(Use the file's existing import of `nodeToAdjustment`; if the test file imports types differently, match it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/node-to-adjustment.test.ts`
Expected: FAIL — `adj.params.rgb` is `undefined` (curves object dropped).

- [ ] **Step 3: Add the curves branch**

In `src/lib/node-to-adjustment.ts`, import the evaluator and special-case curves. Current body builds `numericParams` then returns the adjustment. Update to:

```ts
import type { Node } from '@/types/operation-graph';
import type { Adjustment } from '@/types/adjustment';
import { evaluateCubicSpline } from '@/lib/curves';
import type { CurvesValue } from '@/types/widget';

const CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;

export function nodeToAdjustment(node: Node): Adjustment {
  const params: Record<string, unknown> = {};

  if (node.type === 'curves' && node.params.curves) {
    const curves = node.params.curves as unknown as CurvesValue;
    for (const ch of CURVE_CHANNELS) {
      params[ch] = evaluateCubicSpline(curves[ch] ?? []);
    }
  } else {
    for (const [k, v] of Object.entries(node.params)) {
      if (typeof v === 'number') params[k] = v;
    }
  }

  return {
    id: node.id,
    type: node.type,
    name: node.type,
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    params: params as Adjustment['params'],
    scope: node.scope,
  };
}
```

If `Adjustment['params']` is typed `Record<string, number>` and now rejects `Float32Array`, widen it in `src/types/adjustment.ts` to `Record<string, number | Float32Array>` (the pipeline already reads `p[ch] as Float32Array`). Make that type change in this task if `tsc` requires it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/node-to-adjustment.test.ts`
Expected: PASS. Then `npx tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/node-to-adjustment.ts src/lib/node-to-adjustment.test.ts src/types/adjustment.ts
git commit -m "feat(curves): renderer evaluates curve points into channel LUTs"
```

---

## Task 4: CurveEditor primitive (extract from the working editor)

**Files:**
- Create: `src/components/inspector/widget/primitives/CurveEditor.tsx`
- Read for extraction: `src/tools/curves-tool.tsx` (the existing working SVG editor)

**Context:** `src/tools/curves-tool.tsx` (`CurvesPanel`) already contains a proven SVG spline editor with channel tabs, point drag/add, and `evaluateCubicSpline` preview. But it is coupled to the legacy `curve-points-store`. This task extracts the *presentational* editor — controlled purely by props — so it can be driven by a widget binding. Do NOT modify `curves-tool.tsx` (Phase 2b retires it).

- [ ] **Step 1: Write the failing test** — see Task 5 (the control adapter test exercises the editor). For this task, first create the component, then Task 5 tests it end-to-end. (No standalone test step here; the component is presentational and covered via CurveControl in Task 5.) Skip directly to Step 2.

- [ ] **Step 2: Create the presentational editor**

Create `src/components/inspector/widget/primitives/CurveEditor.tsx` with this exact interface, porting the SVG/drag internals from `CurvesPanel` in `src/tools/curves-tool.tsx` (channel tabs, `svgToPoint`, document-level mousemove drag, add-point on empty click, `evaluateCubicSpline` preview path). Replace every read/write of the `curve-points-store` with the `value`/`onChange` props:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { evaluateCubicSpline, type CurvePoint } from '@/lib/curves';
import type { CurvesValue } from '@/types/widget';

type Channel = keyof CurvesValue; // 'rgb' | 'red' | 'green' | 'blue'
const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];
const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: '#888', red: '#ff4444', green: '#44bb44', blue: '#4488ff',
};

interface CurveEditorProps {
  value: CurvesValue;
  onChange: (next: CurvesValue) => void;
}

export function CurveEditor({ value, onChange }: CurveEditorProps) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingIdx = useRef<number | null>(null);

  const points = value[channel];

  const svgToPoint = useCallback((cx: number, cy: number): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height)),
    };
  }, []);

  const setChannelPoints = useCallback((pts: CurvePoint[]) => {
    onChange({ ...value, [channel]: pts });
  }, [value, channel, onChange]);

  // ... PORT the drag/add/remove handlers and the document mousemove effect
  //     from CurvesPanel verbatim, but call setChannelPoints(...) instead of
  //     the curve-points-store. Render: channel tab buttons, the <svg> grid,
  //     the evaluated spline path (evaluateCubicSpline(points)), and the
  //     draggable point circles. Keep it presentational (no store imports).

  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {/* channel tabs + svg editor — see CurvesPanel for the proven markup */}
    </div>
  );
}
```

IMPORTANT: the `// ... PORT` region must be filled with the real handlers/markup copied and adapted from `CurvesPanel` (`src/tools/curves-tool.tsx`) — channel tabs, `handleMouseDown`, the `useEffect` document mousemove/up drag, point add on empty-area click, double-click-to-remove (if present), and the `<svg>` with grid + spline path + point circles. The ONLY behavioral change from the source is: state comes from `value`/`setChannelPoints`, not the store. Verify it renders a `role`-less `<svg>` plus channel buttons.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/inspector/widget/primitives/CurveEditor.tsx
git commit -m "feat(curves): presentational CurveEditor primitive (value/onChange)"
```

---

## Task 5: CurveControl adapter + BindingRow wiring

**Files:**
- Create: `src/components/inspector/widget/primitives/CurveControl.tsx`
- Modify: `src/components/inspector/widget/BindingRow.tsx`
- Create: `src/components/inspector/widget/primitives/CurveControl.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/inspector/widget/primitives/CurveControl.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CurveControl } from './CurveControl';
import { IDENTITY_CURVES } from '@/types/widget';

describe('CurveControl', () => {
  it('renders the four channel tabs and an svg editor', () => {
    const { container, getByText } = render(
      <CurveControl label="Curves" value={IDENTITY_CURVES} onChange={() => {}} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
    // channel tab labels (match whatever CurveEditor renders, e.g. RGB/R/G/B)
    expect(getByText(/rgb/i)).toBeTruthy();
  });

  it('emits an updated CurvesValue when a point is added on the svg', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CurveControl label="Curves" value={IDENTITY_CURVES} onChange={onChange} />,
    );
    const svg = container.querySelector('svg')!;
    // jsdom has no layout; stub the bounding rect so svgToPoint maps cleanly
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.rgb.length).toBeGreaterThan(2); // a point was added to rgb
  });
});
```

> If `CurveEditor`'s channel-tab text differs (e.g. "R"/"G"/"B" instead of "rgb"), adjust the `getByText` matcher to the actual rendered label. If add-on-empty-click is bound to a different element than the `<svg>`, fire on that element.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/inspector/widget/primitives/CurveControl.test.tsx`
Expected: FAIL — `Cannot find module './CurveControl'`.

- [ ] **Step 3: Create the adapter**

Create `src/components/inspector/widget/primitives/CurveControl.tsx`:

```tsx
import { CurveEditor } from './CurveEditor';
import type { CurvesValue } from '@/types/widget';

interface CurveControlProps {
  label: string;
  value: CurvesValue;
  onChange: (value: CurvesValue) => void;
}

export function CurveControl({ label, value, onChange }: CurveControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-text-secondary px-1.5">{label}</span>
      <CurveEditor value={value} onChange={onChange} />
    </div>
  );
}
```

- [ ] **Step 4: Wire it into BindingRow**

In `src/components/inspector/widget/BindingRow.tsx`, import `CurveControl` and add a `case 'curve'` to the `switch (s.control_type)`:

```tsx
    case 'curve':
      return <CurveControl label={binding.label} value={effectiveValue as CurvesValue} onChange={onChange} />;
```

Add the import: `import { CurveControl } from './primitives/CurveControl';` and `import type { CurvesValue } from '@/types/widget';`. (`onChange` is already typed `(value: ControlBinding['value']) => void`, and `ControlValue` now includes `CurvesValue`, so passing a `CurvesValue` is type-correct.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/inspector/widget/primitives/CurveControl.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Full check**

Run: `npm run check`
Expected: PASS (tsc + eslint + all vitest).

- [ ] **Step 7: Commit**

```bash
git add src/components/inspector/widget/primitives/CurveControl.tsx src/components/inspector/widget/primitives/CurveControl.test.tsx src/components/inspector/widget/BindingRow.tsx
git commit -m "feat(curves): curve control type in the widget binding row"
```

---

## Task 6: Verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suites**

Run: `npm run check` → expect green.
Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools tests/engine tests/schemas -q` → expect green (ignore the unrelated `test_panel_endpoint` ANTHROPIC_API_KEY failure).

- [ ] **Step 2: Live smoke (real curve drag moves the image)**

With the app + backend running and an image open + analyzed: select the ImageNode, click **Curves**. Confirm a real curve editor (channel tabs + draggable spline) spawns — NOT a single slider. Drag the rgb midpoint upward; confirm the image visibly brightens. Switch to the Red channel, pull it down; confirm a red shift. Confirm the curve widget (tool_invoked) shows no Refine/Why.

- [ ] **Step 3: Commit any verification fixups**

```bash
git add -A && git commit -m "chore(curves): phase 2a verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** "Curves spawns a real curve editor" (§4.C / Phase 2) → Tasks 2,4,5; curve data through the op_graph (§4.B canonical state) → Tasks 1,2,3; renderer consumes it → Task 3. The legacy `curve-points-store` and orphaned ProcessingDefinition panels are explicitly deferred to Phase 2b (not touched here) — logged, not silently dropped.
- **Type consistency:** `CurvesValue`/`CurvePoint`/`IDENTITY_CURVES` defined in Task 1 (`src/types/widget.ts`) are used identically in Tasks 3,4,5; backend `curves` param shape in Task 2 matches the FE `CurvesValue` keys (`rgb/red/green/blue`) and identity points; `evaluateCubicSpline(points)` signature (from `src/lib/curves.ts`) is used in Tasks 3,4.
- **No placeholders:** the one `// ... PORT` region in Task 4 is explicit reuse instruction (port the proven handlers from a named source file with a stated single behavioral change), not a vague TODO — the prop interface and the only-change-from-source are fully specified.
- **Known risk:** the curve editor SVG internals are the highest-uncertainty part; Task 4's extraction from working code + Task 5's interaction test + Task 6's live drag are the guard rails.
