# Fused Intent Widgets — Phase A (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every LLM-proposed widget (`mcp_user_prompt` / `mcp_autonomous`) ships a synthesized intent driver — one slider (0–150, tick + snap at 100, amber overshoot) that interpolates all its op params between "as shot" and the AI's resolved target — with the original op controls in collapsible sections underneath.

**Architecture:** The backend mechanically builds a widget-local `compound` block (anchor 0 = pre-widget baseline, anchor 1 = resolved targets) after phase-2 resolution; `set_widget_param('__driver')` interpolates/extrapolates it server-side, respecting `locked_params`. The frontend adds a `FusedWidgetBody` dispatch branch in `WidgetShell` that renders the driver via two new additive `AdjustmentSlider` props and per-op sections via the existing `RegistryDrivenPanel`. SSoT doctrine holds throughout: the snapshot owns all values; the frontend interpolates the same anchors only for optimistic preview.

**Tech Stack:** FastAPI + Pydantic backend, React 19 + TypeScript strict + Zustand frontend, Vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md`

## Global Constraints

- Work on a new branch `feat/fused-intent-widgets` **off `main`** — NOT off `dev` (`dev` is a stale pre-React-Flow tree whose pre-commit fails; all current development is on `main`).
- `npm run check` (gen:types:check + tsc + eslint + vitest) must pass before every commit — it runs via pre-commit and will block the commit otherwise.
- Backend tests: `cd backend && . .venv/bin/activate && python -m pytest tests/ -q`.
- TypeScript strict; no inline-defined components (custom `no-nested-component` lint rule); named Lucide imports only.
- Style only via design tokens in `src/index.css` — no hardcoded hex/oklch in components.
- Wire format is camelCase: every backend Pydantic model uses `camel_config`, so `driver_value` ↔ `driverValue`, `locked_params` ↔ `lockedParams`.
- Registry compound ops (`time-of-day`, `weather`, `mood`, `season`, `age`) must keep their existing `CompoundWidgetBody` behavior untouched.
- Driver scale convention: backend stores `t ∈ [0, 1.5]`; the UI renders `t × 100` (0–150, proposal at 100).
- Anchor `values` keys are node-qualified: `"{node_id}:{param_key}"` (bindings' bare `param_key` can collide across ops in a multi-op widget).

---

### Task 1: Backend extrapolating interpolation

**Files:**
- Modify: `backend/app/registry/interpolate.py`
- Test: `backend/tests/registry/test_interpolate.py`

**Interfaces:**
- Consumes: existing `interpolate_1d(anchors, t)` in the same file (clamps out-of-range `t` to endpoint values).
- Produces: `interpolate_extended(anchors: list[Any], t: float) -> dict[str, float]` — identical to `interpolate_1d` for `t` at or below the last anchor's position; linear extrapolation from the last segment's slope beyond it. Used by Task 7 (`set_widget_param`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/registry/test_interpolate.py`:

```python
from app.registry.interpolate import interpolate_extended


def _two_anchors():
    return [
        {"position": 0.0, "name": "as shot", "values": {"n_a:exposure": 0.0, "n_a:shadows": 10.0}},
        {"position": 1.0, "name": "proposed", "values": {"n_a:exposure": -80.0, "n_a:shadows": -50.0}},
    ]


def test_extended_matches_interpolate_1d_in_range():
    anchors = _two_anchors()
    assert interpolate_extended(anchors, 0.0) == {"n_a:exposure": 0.0, "n_a:shadows": 10.0}
    assert interpolate_extended(anchors, 1.0) == {"n_a:exposure": -80.0, "n_a:shadows": -50.0}
    mid = interpolate_extended(anchors, 0.5)
    assert mid["n_a:exposure"] == -40.0
    assert mid["n_a:shadows"] == -20.0


def test_extended_extrapolates_past_last_anchor():
    anchors = _two_anchors()
    out = interpolate_extended(anchors, 1.5)
    # slope exposure: (-80 - 0) / 1.0 = -80 per unit → -80 + 0.5 * -80 = -120
    assert out["n_a:exposure"] == -120.0
    # slope shadows: (-50 - 10) / 1.0 = -60 → -50 + 0.5 * -60 = -80
    assert out["n_a:shadows"] == -80.0


def test_extended_extrapolates_from_last_segment_of_many():
    anchors = [
        {"position": 0.0, "name": "a", "values": {"k": 0.0}},
        {"position": 0.5, "name": "b", "values": {"k": 10.0}},
        {"position": 1.0, "name": "c", "values": {"k": 40.0}},
    ]
    # last-segment slope: (40 - 10) / 0.5 = 60 per unit → 40 + 0.25 * 60 = 55
    assert interpolate_extended(anchors, 1.25) == {"k": 55.0}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/registry/test_interpolate.py -q`
Expected: FAIL with `ImportError: cannot import name 'interpolate_extended'`

- [ ] **Step 3: Implement**

Append to `backend/app/registry/interpolate.py`:

```python
def interpolate_extended(anchors: list[Any], t: float) -> dict[str, float]:
    """`interpolate_1d`, plus linear extrapolation past the LAST anchor.

    Used by fused intent widgets whose driver overshoots the proposal
    (t in (1.0, 1.5]): the value continues along the last segment's slope.
    Below the first anchor it clamps exactly like `interpolate_1d`.
    Per-param range clamping is the CALLER's job (the registry knows ranges,
    this module doesn't).
    """
    def _pos(a: Any) -> float:
        return a["position"] if isinstance(a, dict) else a.position

    def _vals(a: Any) -> dict[str, float]:
        return a["values"] if isinstance(a, dict) else a.values

    if len(anchors) < 2:
        raise ValueError("need at least 2 anchors")
    last_pos = _pos(anchors[-1])
    if t <= last_pos:
        return interpolate_1d(anchors, t)

    prev, last = anchors[-2], anchors[-1]
    span = last_pos - _pos(prev)
    if span <= 0:
        return dict(_vals(last))
    pv, lv = _vals(prev), _vals(last)
    keys = set(pv.keys()) | set(lv.keys())
    overshoot = t - last_pos
    return {
        k: lv.get(k, 0.0) + ((lv.get(k, 0.0) - pv.get(k, 0.0)) / span) * overshoot
        for k in keys
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/registry/test_interpolate.py -q`
Expected: PASS (all, including pre-existing tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/registry/interpolate.py backend/tests/registry/test_interpolate.py
git commit -m "feat(backend): interpolate_extended — linear extrapolation past last anchor"
```

---

### Task 2: Frontend extrapolating interpolation (mirror)

**Files:**
- Modify: `src/lib/perceptual-dial/interpolate.ts`
- Test: `src/lib/perceptual-dial/interpolate.test.ts`

**Interfaces:**
- Consumes: existing `interpolate1D(anchors: Anchor[], t: number): CompoundParams` and the `Anchor` type (`{ id, label, position: [number], params }`) from `./types`.
- Produces: `interpolateExtended(anchors: Anchor[], t: number): CompoundParams` — byte-parity with the backend `interpolate_extended`. Used by Task 11 (`FusedWidgetBody` optimistic preview).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/perceptual-dial/interpolate.test.ts` (match the existing test file's imports/style — it already imports from `./interpolate` and builds `Anchor` fixtures):

```ts
import { interpolateExtended } from './interpolate';

describe('interpolateExtended', () => {
  const anchors: Anchor[] = [
    { id: 'a0', label: 'as shot', position: [0], params: { 'n_a:exposure': 0, 'n_a:shadows': 10 } },
    { id: 'a1', label: 'proposed', position: [1], params: { 'n_a:exposure': -80, 'n_a:shadows': -50 } },
  ];

  it('matches interpolate1D at and below the last anchor', () => {
    expect(interpolateExtended(anchors, 0)).toEqual({ 'n_a:exposure': 0, 'n_a:shadows': 10 });
    expect(interpolateExtended(anchors, 1)).toEqual({ 'n_a:exposure': -80, 'n_a:shadows': -50 });
    expect(interpolateExtended(anchors, 0.5)['n_a:exposure']).toBe(-40);
  });

  it('extrapolates linearly past the last anchor', () => {
    const out = interpolateExtended(anchors, 1.5);
    expect(out['n_a:exposure']).toBe(-120); // -80 + 0.5 * (-80 - 0)
    expect(out['n_a:shadows']).toBe(-80);   // -50 + 0.5 * (-50 - 10)
  });
});
```

(If `Anchor` isn't already imported in the test file, add `import type { Anchor } from './types';`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/perceptual-dial/interpolate.test.ts`
Expected: FAIL — `interpolateExtended` is not exported

- [ ] **Step 3: Implement**

Append to `src/lib/perceptual-dial/interpolate.ts`:

```ts
/**
 * `interpolate1D` plus linear extrapolation past the LAST anchor — mirrors
 * backend `interpolate_extended` (app/registry/interpolate.py) so fused-widget
 * optimistic previews match what the server will compute. Per-param range
 * clamping is the caller's job.
 */
export function interpolateExtended(anchors: Anchor[], t: number): CompoundParams {
  if (anchors.length < 2) return interpolate1D(anchors, t);
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  const last = sorted[sorted.length - 1];
  if (t <= last.position[0]) return interpolate1D(anchors, t);

  const prev = sorted[sorted.length - 2];
  const span = last.position[0] - prev.position[0];
  if (span <= 0) return { ...last.params };
  const keys = new Set<string>([...Object.keys(prev.params), ...Object.keys(last.params)]);
  const overshoot = t - last.position[0];
  const out: CompoundParams = {};
  for (const k of keys) {
    const lv = last.params[k] ?? 0;
    const pv = prev.params[k] ?? 0;
    out[k] = lv + ((lv - pv) / span) * overshoot;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/perceptual-dial/interpolate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/perceptual-dial/interpolate.ts src/lib/perceptual-dial/interpolate.test.ts
git commit -m "feat(lib): interpolateExtended — frontend mirror of backend extrapolation"
```

---

### Task 3: Widget schema — `compound` + `driver_value` fields, both sides

**Files:**
- Modify: `backend/app/registry/schema.py` (add `label` to `OpCompoundConfig`)
- Modify: `backend/app/schemas/widget.py` (add fields to `Widget`)
- Modify: `src/types/widget.ts` (mirror types)
- Regenerate: `shared/types/generated.ts` (+ possibly `generated-config.ts`) via the gen script
- Test: `backend/tests/tools/widgets/test_fused_compound.py` (new — schema round-trip part)

**Interfaces:**
- Produces (backend): `Widget.compound: OpCompoundConfig | None = None`, `Widget.driver_value: float | None = None`, `OpCompoundConfig.label: str | None = None`. All optional with `None` defaults so persisted sessions and registry JSONs (which use `extra="forbid"` but only reject *unknown* fields) keep validating.
- Produces (frontend): `WidgetCompound` interface and `compound?: WidgetCompound | null; driverValue?: number | null` on `Widget` in `src/types/widget.ts`.
- Wire names (camelCase): `compound.anchors[].values`, `compound.label`, `driverValue`.

- [ ] **Step 1: Write the failing schema round-trip test**

Create `backend/tests/tools/widgets/test_fused_compound.py`:

```python
"""Fused intent widgets — schema + synthesis tests."""
from __future__ import annotations

from app.registry.schema import CompoundAnchor, OpCompoundConfig
from app.schemas.widget import Widget


def _minimal_widget_dict() -> dict:
    return {
        "id": "w_test1234",
        "intent": "make it black",
        "scope": {"root": {"kind": "global"}},
        "origin": {"kind": "mcp_user_prompt", "prompt": "make it black"},
    }


def test_widget_accepts_compound_and_driver_value():
    d = _minimal_widget_dict()
    d["compound"] = {
        "driver": "__driver",
        "label": "Blackness",
        "anchors": [
            {"position": 0.0, "name": "as shot", "values": {"n_a:exposure": 0.0}},
            {"position": 1.0, "name": "proposed", "values": {"n_a:exposure": -80.0}},
        ],
    }
    d["driverValue"] = 1.0
    w = Widget.model_validate(d)
    assert w.compound is not None
    assert w.compound.label == "Blackness"
    assert w.compound.driver == "__driver"
    assert w.driver_value == 1.0
    # Round-trips back to camelCase wire format.
    dumped = w.model_dump(mode="json", by_alias=True)
    assert dumped["driverValue"] == 1.0
    assert dumped["compound"]["label"] == "Blackness"


def test_widget_without_compound_defaults_to_none():
    w = Widget.model_validate(_minimal_widget_dict())
    assert w.compound is None
    assert w.driver_value is None


def test_op_compound_config_label_is_optional():
    cfg = OpCompoundConfig(
        driver="__driver",
        anchors=[
            CompoundAnchor(position=0.0, name="a", values={"k": 0.0}),
            CompoundAnchor(position=1.0, name="b", values={"k": 1.0}),
        ],
    )
    assert cfg.label is None
```

Note: if `Widget.model_validate(_minimal_widget_dict())` fails on missing required fields (`scope`/`origin` shapes), copy the minimal valid widget dict from an existing test in `backend/tests/tools/widgets/` (e.g. `test_delete_widget.py`) — the point of `_minimal_widget_dict` is only "a valid Widget without compound".

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py -q`
Expected: FAIL — `Widget` has no field `compound` (extra="forbid" rejects it) / `OpCompoundConfig` has no `label`

- [ ] **Step 3: Add the backend fields**

In `backend/app/registry/schema.py`, add `label` to `OpCompoundConfig` (after `driver: str`):

```python
class OpCompoundConfig(BaseModel):
    model_config = camel_config(extra="forbid")
    driver: str
    # Human label for the driver control. Registry compound ops leave this
    # None (their dial UI labels itself); fused intent widgets carry the
    # planner's driver_label here ("Blackness", "Warmth").
    label: str | None = None
    interpolation: Literal["catmull_rom_1d"] = "catmull_rom_1d"
    anchors: list[CompoundAnchor] = Field(min_length=2)
    topology: Literal["linear", "wheel"] = "linear"
```

In `backend/app/schemas/widget.py`, import at the top (with the other imports):

```python
from app.registry.schema import OpCompoundConfig
```

(If this import creates a circular-import error at test time, use a deferred `from __future__` style: move it into a `if TYPE_CHECKING:` block and annotate as `"OpCompoundConfig | None"` with `Widget.model_rebuild()` after the class — but try the direct import first; `app.registry.schema` only imports `app.schemas._camel`, so no cycle is expected.)

Then add two fields to `class Widget`, after `locked_params`:

```python
    # Widget-local compound block for FUSED INTENT WIDGETS: synthesized by
    # propose_stack after phase-2 resolution (anchor 0 = pre-widget baseline,
    # anchor 1 = resolved targets; values keyed "{node_id}:{param_key}").
    # None for tool_invoked widgets and registry compound ops (their block
    # lives in the registry). See 2026-07-11-fused-intent-widgets-design.md.
    compound: OpCompoundConfig | None = None
    # Driver position t in [0, 1.5]; UI renders ×100 (0–150, proposal = 100).
    driver_value: float | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py tests/registry/ -q`
Expected: PASS

- [ ] **Step 5: Regenerate shared types**

Run: `cd backend && . .venv/bin/activate && python ../scripts/gen-shared-types.py`
Then: `npm run gen:types:check`
Expected: "Generated files are up to date."

- [ ] **Step 6: Mirror the types in `src/types/widget.ts`**

Add near the other widget-related interfaces (before `export interface Widget`):

```ts
/** One anchor of a widget-local compound block (fused intent widgets).
 *  `values` keys are node-qualified: `"{nodeId}:{paramKey}"`. */
export interface WidgetCompoundAnchor {
  position: number;
  name: string;
  values: Record<string, number>;
  color?: string | null;
}

/** Widget-local compound block — same shape as the registry op `compound`
 *  block, synthesized per-widget by the backend for LLM-proposed widgets.
 *  See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md. */
export interface WidgetCompound {
  driver: string;
  label?: string | null;
  interpolation?: 'catmull_rom_1d';
  anchors: WidgetCompoundAnchor[];
  topology?: 'linear' | 'wheel';
}
```

And inside `export interface Widget` (after `lockedParams: string[];`):

```ts
  /** Fused intent widget block — present ⇒ WidgetShell renders FusedWidgetBody. */
  compound?: WidgetCompound | null;
  /** Driver position t in [0, 1.5]; UI renders ×100 (proposal = 100). */
  driverValue?: number | null;
```

- [ ] **Step 7: Full check + commit**

Run: `npm run check`
Expected: PASS (warnings allowed, no errors)

```bash
git add backend/app/registry/schema.py backend/app/schemas/widget.py src/types/widget.ts shared/types/ backend/tests/tools/widgets/test_fused_compound.py
git commit -m "feat(schema): widget-local compound block + driver_value on Widget"
```

---

### Task 4: `fused_compound.py` — synthesis + refine anchor update

**Files:**
- Create: `backend/app/tools/widgets/fused_compound.py`
- Test: `backend/tests/tools/widgets/test_fused_compound.py` (extend)

**Interfaces:**
- Consumes: `Widget` (Task 3 fields), `get_registry()`, `doc.canonical` (dict `layer_id → node_type → {param: value}` — same access pattern as `propose_stack._build_widget_multi` lines 240–248).
- Produces:
  - `synthesize_compound(widget: Widget, doc: SessionDocument, driver_label: str | None = None) -> OpCompoundConfig | None` — builds the 2-anchor block; `None` when nothing scalar changed or when the widget is a single-op registry dial.
  - `update_target_anchor(widget: Widget, resolved: dict) -> None` — refine hook (Task 8): rewrites anchor-1 values for unlocked resolved params.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/tools/widgets/test_fused_compound.py`:

```python
from app.tools.widgets.fused_compound import synthesize_compound, update_target_anchor
from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget, WidgetNode, WidgetOrigin,
)


class _FakeDoc:
    """Just enough of SessionDocument for synthesis: `.canonical`."""
    def __init__(self, canonical=None):
        self.canonical = canonical or {}


def _fused_candidate_widget() -> Widget:
    """A 1-op 'light' widget as _build_widget_multi would produce it, with the
    resolver having set exposure=-80 (registry default 0)."""
    w = Widget.model_validate(_minimal_widget_dict())
    w.nodes = [WidgetNode(
        id="n_a", type="basic", op_id="light",
        params={"exposure": -80.0},
        scope=w.scope, widget_id=w.id, layer_id="layer-1",
    )]
    w.bindings = [ControlBinding(
        param_key="exposure", label="Exposure", control_type="slider",
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": -100, "max": 100, "step": 1},
        ),
        value=-80.0, default=0.0,
        target=NodeParamTarget(node_id="n_a", param_key="exposure"),
    )]
    return w


def test_synthesize_builds_two_anchors_from_default_baseline():
    w = _fused_candidate_widget()
    block = synthesize_compound(w, _FakeDoc(), driver_label="Blackness")
    assert block is not None
    assert block.driver == "__driver"
    assert block.label == "Blackness"
    assert [a.position for a in block.anchors] == [0.0, 1.0]
    assert block.anchors[0].values["n_a:exposure"] == 0.0     # registry default
    assert block.anchors[1].values["n_a:exposure"] == -80.0   # resolved


def test_synthesize_baseline_prefers_canonical_over_default():
    w = _fused_candidate_widget()
    doc = _FakeDoc(canonical={"layer-1": {"basic": {"exposure": 15.0}}})
    block = synthesize_compound(w, doc)
    assert block is not None
    assert block.anchors[0].values["n_a:exposure"] == 15.0


def test_synthesize_returns_none_when_nothing_changed():
    w = _fused_candidate_widget()
    w.nodes[0].params["exposure"] = 0.0   # resolver landed on the default
    assert synthesize_compound(w, _FakeDoc()) is None


def test_synthesize_skips_registry_dial_single_op():
    w = _fused_candidate_widget()
    w.nodes[0].op_id = "time-of-day"
    w.nodes[0].type = "time_of_day"
    assert synthesize_compound(w, _FakeDoc()) is None


def test_update_target_anchor_rewrites_unlocked_only():
    w = _fused_candidate_widget()
    w.compound = synthesize_compound(w, _FakeDoc())
    assert w.compound is not None
    update_target_anchor(w, {"exposure": -40.0})
    assert w.compound.anchors[1].values["n_a:exposure"] == -40.0
    w.locked_params = ["exposure"]
    update_target_anchor(w, {"exposure": -10.0})
    assert w.compound.anchors[1].values["n_a:exposure"] == -40.0  # locked → kept
```

Note: `WidgetNode`'s exact required fields — if validation complains, mirror the node/binding construction from `backend/tests/tools/widgets/test_propose_seeds_canonical.py`. If the `light` op's node_type isn't `basic`, read it from `shared/registry/ops/light.json` (`engine.node_type`) and use that string for `type` and the canonical dict key.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py -q`
Expected: FAIL — `No module named 'app.tools.widgets.fused_compound'`

- [ ] **Step 3: Implement**

Create `backend/app/tools/widgets/fused_compound.py`:

```python
"""Fused intent widgets — mechanical compound-block synthesis.

After the phase-2 resolver lands, every LLM-proposed widget gets a
widget-local compound block: anchor 0 = the pre-widget baseline (canonical
value if the layer already had one, else the registry default), anchor 1 =
the resolved targets. `set_widget_param('__driver')` then interpolates
between them (and extrapolates up to t=1.5).

Anchor value keys are node-qualified ("{node_id}:{param_key}") because a
multi-op widget can expose the same bare param_key twice (e.g. `amount` on
clarity + sharpen).

See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md.
"""
from __future__ import annotations

from typing import Any

from app.registry.loader import get_registry
from app.registry.schema import CompoundAnchor, OpCompoundConfig

DRIVER_KEY = "__driver"
DRIVER_MAX = 1.5

# Resolver values within this distance of the baseline don't earn an anchor
# entry — driving them would just add float noise.
_EPSILON = 1e-9


def synthesize_compound(
    widget: Any, doc: Any, driver_label: str | None = None,
) -> OpCompoundConfig | None:
    """Build the widget-local compound block, or None when not applicable.

    Not applicable when: the widget is a single-op registry dial (its
    compound lives in the registry and CompoundWidgetBody owns the UI), or
    no scalar param actually differs from its baseline.
    """
    reg = get_registry()

    if len(widget.nodes) == 1:
        only_op = reg.ops.get(widget.nodes[0].op_id or "")
        if only_op is not None and only_op.compound is not None:
            return None

    baseline: dict[str, float] = {}
    target: dict[str, float] = {}
    for node in widget.nodes:
        op = reg.ops.get(node.op_id or "")
        if op is None:
            continue
        canonical = (doc.canonical.get(node.layer_id, {}) or {}).get(node.type, {}) or {}
        for key, param in op.params.items():
            if param.type != "scalar":
                continue  # curves / enums can't ride a 1-D interpolation
            resolved = node.params.get(key)
            if not isinstance(resolved, (int, float)) or isinstance(resolved, bool):
                continue
            base = canonical.get(key, param.default)
            if not isinstance(base, (int, float)) or isinstance(base, bool):
                continue
            if abs(float(resolved) - float(base)) < _EPSILON:
                continue
            qkey = f"{node.id}:{key}"
            baseline[qkey] = float(base)
            target[qkey] = float(resolved)

    if not target:
        return None

    return OpCompoundConfig(
        driver=DRIVER_KEY,
        label=driver_label,
        anchors=[
            CompoundAnchor(position=0.0, name="as shot", values=baseline),
            CompoundAnchor(position=1.0, name="proposed", values=target),
        ],
    )


def update_target_anchor(widget: Any, resolved: dict) -> None:
    """Refine hook: rewrite anchor-1 values for UNLOCKED resolved params.

    `resolved` is keyed by bare binding param_key (the resolver's namespace);
    we re-qualify through the binding's target. Baseline (anchor 0) is
    untouched — "as shot" doesn't change because the AI re-thought the target.
    """
    if widget.compound is None or not widget.compound.anchors:
        return
    target = widget.compound.anchors[-1]
    locked = set(widget.locked_params or [])
    for key, value in resolved.items():
        if key in locked:
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        binding = next((b for b in widget.bindings if b.param_key == key), None)
        if binding is None:
            continue
        qkey = f"{binding.target.node_id}:{binding.target.param_key}"
        if qkey in target.values:
            target.values[qkey] = float(value)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/fused_compound.py backend/tests/tools/widgets/test_fused_compound.py
git commit -m "feat(backend): fused compound synthesis + refine target-anchor update"
```

---

### Task 5: Planner `driver_label`

**Files:**
- Modify: `backend/app/services/anthropic_client.py` (`_PLANNER_SYSTEM_PROMPT` ~line 447, `_PLAN_TOOL` ~line 534)
- Modify: `backend/app/tools/widgets/propose_stack.py` (`_normalize_plan_entries`, line 105)
- Test: `backend/tests/tools/widgets/test_fused_compound.py` (extend — normalization)

**Interfaces:**
- Produces: plan entries may carry `driver_label: str | None`. Old-shape entries normalize to `driver_label: None`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/tools/widgets/test_fused_compound.py`:

```python
from app.tools.widgets.propose_stack import _normalize_plan_entries


def test_normalize_old_shape_adds_driver_label_none():
    out = _normalize_plan_entries([{"op_id": "light", "rationale": "darken"}])
    assert out[0]["driver_label"] is None


def test_normalize_new_shape_passes_driver_label_through():
    entry = {"widget_name": "Make it black", "driver_label": "Blackness",
             "ops": [{"op_id": "light"}]}
    out = _normalize_plan_entries([entry])
    assert out[0]["driver_label"] == "Blackness"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py -q`
Expected: FAIL — old-shape normalization emits no `driver_label` key (KeyError)

- [ ] **Step 3: Implement**

In `propose_stack.py`, `_normalize_plan_entries`, change the old-shape append to include the field:

```python
        normalized.append({
            "widget_name": None,
            "category": None,
            "driver_label": None,
            "ops": [{
                "op_id": entry.get("op_id"),
                "rationale": entry.get("rationale", ""),
                "starting_params": entry.get("starting_params"),
            }],
        })
```

(New-shape entries pass through unchanged — `entry.get("driver_label")` at the consumption site handles absence, but the test asserts presence for old shape, so also normalize new-shape entries defensively at the top of the loop:)

```python
        if "ops" in entry:
            entry.setdefault("driver_label", None)
            normalized.append(entry)
            continue
```

In `anthropic_client.py`:

1. `_PLAN_TOOL` — add to the per-entry `properties` (next to `widget_name`):

```python
                        "driver_label": {"type": "string"},
```

2. `_PLANNER_SYSTEM_PROMPT` — add one rule after the `widget_name` rule ("Give each widget a short, descriptive `widget_name` …"):

```
- Give each widget a `driver_label`: a 1–2 word noun naming the INTENT AXIS
  its strength slider will control ("Blackness", "Warmth", "Drama") — the
  quality the user asked for, not an op name. The frontend renders one
  slider with this label that scales the whole widget from "as shot" (0)
  to your resolved values (100).
```

3. Update the two worked examples in the prompt: add `"driver_label": "Faded blacks"` to the "Lifted blacks" entry, `"driver_label": "Warmth"` to "Warm fade", `"driver_label": "Grain"` to "Film grain" (the night-scene compound-dial example stays without one — dials label themselves).

- [ ] **Step 4: Run tests**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/ tests/services/ -q`
Expected: PASS (including pre-existing planner tests — if a planner test asserts the exact `_PLAN_TOOL` schema or prompt text, update that assertion to include `driver_label`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/app/tools/widgets/propose_stack.py backend/tests/tools/widgets/test_fused_compound.py
git commit -m "feat(planner): driver_label per plan entry for fused intent widgets"
```

---

### Task 6: Attach synthesis in `propose_stack`

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py` (`_handle_llm_path`, build loop ~line 588)
- Test: `backend/tests/tools/widgets/test_fused_compound.py` (extend)

**Interfaces:**
- Consumes: `synthesize_compound` (Task 4), `entry.get("driver_label")` (Task 5).
- Produces: LLM-path widgets carry `widget.compound` + `widget.driver_value = 1.0`. `tool_invoked` and preset paths remain compound-free.

- [ ] **Step 1: Write the failing test**

Testing `_handle_llm_path` end-to-end needs the Anthropic client mocked; instead test the attach helper directly. First add the helper signature to the test:

```python
from app.tools.widgets.propose_stack import _attach_fused_compound


def test_attach_fused_compound_sets_block_and_driver_value():
    w = _fused_candidate_widget()          # origin kind mcp_user_prompt
    _attach_fused_compound(w, _FakeDoc(), driver_label="Blackness")
    assert w.compound is not None
    assert w.driver_value == 1.0


def test_attach_fused_compound_noop_for_tool_invoked():
    w = _fused_candidate_widget()
    w.origin = WidgetOrigin(kind="tool_invoked")
    _attach_fused_compound(w, _FakeDoc(), driver_label=None)
    assert w.compound is None
    assert w.driver_value is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_compound.py -q`
Expected: FAIL — cannot import `_attach_fused_compound`

- [ ] **Step 3: Implement**

In `propose_stack.py` add (module level, near `_build_widget_multi`):

```python
def _attach_fused_compound(widget: Widget, doc: Any, driver_label: str | None) -> None:
    """Fused intent widgets: LLM-proposed widgets get a synthesized driver.
    tool_invoked / preset spawns don't — "I picked a tool" ships raw controls.
    Mutates the widget in place (no-op when synthesis declines)."""
    if widget.origin.kind not in ("mcp_user_prompt", "mcp_autonomous"):
        return
    from app.tools.widgets.fused_compound import synthesize_compound
    block = synthesize_compound(widget, doc, driver_label=driver_label)
    if block is None:
        return
    widget.compound = block
    widget.driver_value = 1.0
```

(Add `from typing import Any` if not already imported — it is, line 5.)

Then in `_handle_llm_path`, in the build loop, between `widget = _build_widget_multi(...)` and `doc.add_widget(widget)`:

```python
            _attach_fused_compound(widget, doc, entry.get("driver_label"))
            doc.add_widget(widget)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/ -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/propose_stack.py backend/tests/tools/widgets/test_fused_compound.py
git commit -m "feat(backend): attach synthesized compound to LLM-proposed widgets"
```

---

### Task 7: `set_widget_param` — `__driver` branch + fused implicit lock

**Files:**
- Modify: `backend/app/tools/widgets/set_widget_param.py`
- Test: `backend/tests/tools/widgets/test_fused_driver.py` (new)

**Interfaces:**
- Consumes: `interpolate_extended` (Task 1), `Widget.compound` / `driver_value` (Task 3), `DRIVER_KEY`/`DRIVER_MAX` (Task 4).
- Produces: `set_widget_param(widget_id, '__driver', t)` interpolates anchors, clamps per registry param range, writes unlocked params to nodes + canonical + bindings, stores `driver_value`. Derived-key edits on fused widgets implicit-lock (same rule registry compound widgets already have). This is the API Task 11's frontend calls.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/tools/widgets/test_fused_driver.py`. **Copy the SessionDocument/session fixture setup from `backend/tests/tools/widgets/test_canonical_bidirectional.py`** (it exercises `set_widget_param` today, so it has the doc + tool invocation pattern); then add a fused widget via the Task 4 test helpers:

```python
"""__driver handling on fused intent widgets."""
# Fixture setup: copy the doc/session/tool-call helpers from
# test_canonical_bidirectional.py in this directory, then:

import pytest

from app.registry.interpolate import interpolate_extended


def _make_fused_widget(doc):
    """Add a 1-op light widget with a synthesized compound to `doc`.
    Reuses _fused_candidate_widget from test_fused_compound."""
    from tests.tools.widgets.test_fused_compound import (
        _fused_candidate_widget, _FakeDoc,
    )
    from app.tools.widgets.fused_compound import synthesize_compound
    w = _fused_candidate_widget()
    w.compound = synthesize_compound(w, _FakeDoc(), driver_label="Blackness")
    w.driver_value = 1.0
    doc.add_widget(w)
    return w


@pytest.mark.anyio
async def test_driver_zero_returns_to_baseline(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    await call_set_widget_param(w.id, "__driver", 0.0)
    assert w.nodes[0].params["exposure"] == 0.0
    assert w.driver_value == 0.0


@pytest.mark.anyio
async def test_driver_one_lands_on_resolved(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    await call_set_widget_param(w.id, "__driver", 0.5)
    await call_set_widget_param(w.id, "__driver", 1.0)
    assert w.nodes[0].params["exposure"] == -80.0


@pytest.mark.anyio
async def test_driver_overshoot_extrapolates_and_clamps(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    await call_set_widget_param(w.id, "__driver", 1.5)
    # raw extrapolation −120 clamps to the light.exposure registry range floor (−100)
    assert w.nodes[0].params["exposure"] == -100.0
    assert w.driver_value == 1.5


@pytest.mark.anyio
async def test_driver_skips_locked_params(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    w.locked_params = ["exposure"]
    await call_set_widget_param(w.id, "__driver", 0.0)
    assert w.nodes[0].params["exposure"] == -80.0  # untouched


@pytest.mark.anyio
async def test_derived_edit_on_fused_widget_implicit_locks(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    await call_set_widget_param(w.id, "exposure", -55.0)
    assert "exposure" in w.locked_params


@pytest.mark.anyio
async def test_driver_updates_binding_values(doc, call_set_widget_param):
    w = _make_fused_widget(doc)
    await call_set_widget_param(w.id, "__driver", 0.5)
    exposure_binding = next(b for b in w.bindings if b.param_key == "exposure")
    assert exposure_binding.value == -40.0
```

(`doc` / `call_set_widget_param` are the fixtures you build from the copied setup — a `SessionDocument` plus an async helper that invokes `SetWidgetParamTool().handler(doc, _Input(widget_id=..., param_key=..., value=...))`. Check the exposure range in `shared/registry/ops/light.json` — if it isn't `[-100, 100]`, adjust the clamp assertion to the real floor.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/test_fused_driver.py -q`
Expected: FAIL — `_UnknownBinding: '__driver'` (no branch exists yet)

- [ ] **Step 3: Implement**

In `set_widget_param.py`, in `handler`, **after** the `_WidgetDismissed` guard and **before** the binding lookup (line 89), insert:

```python
        # Fused intent widget driver: '__driver' has no binding — it drives
        # the widget-local compound block. Interpolate/extrapolate the anchor
        # table, clamp per registry param range, and write every UNLOCKED
        # derived key to its node + canonical + binding. Locked params keep
        # the user's hand-set value.
        if w.compound is not None and input.param_key == w.compound.driver:
            from app.registry.interpolate import interpolate_extended
            from app.registry.loader import get_registry
            from app.tools.widgets.fused_compound import DRIVER_MAX

            reg = get_registry()
            t = max(0.0, min(DRIVER_MAX, float(input.value)))
            derived = interpolate_extended(w.compound.anchors, t)
            locked = set(w.locked_params)
            for qkey, raw_val in derived.items():
                node_id, _, pkey = qkey.partition(":")
                d_node = next((n for n in w.nodes if n.id == node_id), None)
                if d_node is None:
                    continue
                d_binding = next(
                    (b for b in w.bindings
                     if b.target.node_id == node_id and b.target.param_key == pkey),
                    None,
                )
                if d_binding is not None and d_binding.param_key in locked:
                    continue
                val = float(raw_val)
                d_op = reg.ops.get(d_node.op_id or "")
                d_param = d_op.params.get(pkey) if d_op is not None else None
                if d_param is not None and d_param.range is not None:
                    lo, hi = d_param.range
                    val = max(lo, min(hi, val))
                d_node.params[pkey] = val
                d_layers = (
                    d_node.layer_ids if d_node.layer_ids is not None
                    else [d_node.layer_id]
                )
                for layer in d_layers:
                    doc.set_param(layer, d_node.type, pkey, val)
                if d_binding is not None:
                    d_binding.value = val
            w.driver_value = t
            w.revision += 1
            doc.update_widget(w)
            return _Output(ok=True)
```

Then extend the existing implicit-lock block at the bottom (lines 108–134): the registry-compound `else` branch already locks derived edits; add the fused case. Replace the final registry-compound block's structure so BOTH kinds lock:

```python
        reg = get_registry()
        op = reg.ops.get(w.op_id) if w.op_id else None
        if op is not None and op.compound is not None:
            if input.param_key == op.compound.driver:
                derived = resolve_compound(w, op, float(input.value))
                # ... (existing recompute loop, unchanged)
            else:
                if input.param_key not in w.locked_params:
                    w.locked_params.append(input.param_key)
        elif w.compound is not None:
            # Fused intent widget: any derived-key edit implicit-locks so the
            # driver stops moving it. ('__driver' itself returned early above.)
            if input.param_key not in w.locked_params:
                w.locked_params.append(input.param_key)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/tools/widgets/ -q`
Expected: PASS (all — including the existing compound/canonical tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/set_widget_param.py backend/tests/tools/widgets/test_fused_driver.py
git commit -m "feat(backend): __driver interpolation + implicit lock on fused widgets"
```

---

### Task 8: Refine updates the target anchor

**Files:**
- Modify: `backend/app/tools/widgets/refine_widget.py` (generic re-resolve path, ~lines 148–175)
- Test: `backend/tests/tools/widgets/test_fused_compound.py` (already covers `update_target_anchor` semantics — this task wires the call site; add one integration-shaped test only if the file has an existing refine test fixture to copy, otherwise rely on the unit tests + manual verification in Task 12)

**Interfaces:**
- Consumes: `update_target_anchor(widget, resolved)` (Task 4).
- Produces: after refine, anchor 1 reflects the new resolved targets for unlocked params; `driver_value` untouched.

- [ ] **Step 1: Locate the write-back loop**

In `refine_widget.py`, find the generic param-resolution write-back (grep `resolve_widget_params`; the loop at ~line 167 reads `for key, value in resolved.items():` and writes each resolved param back to the widget).

- [ ] **Step 2: Add the anchor update after the loop**

Immediately **after** that loop completes (same indentation level as the `for`), add:

```python
        # Fused intent widget: refine re-aimed the proposal — rewrite the
        # target anchor (position 1.0) for unlocked params so the driver's
        # "100" now means the refined values. Baseline + driver_value stay.
        from app.tools.widgets.fused_compound import update_target_anchor
        update_target_anchor(w, resolved)
```

(The widget variable in that scope may be named `w` or `widget` — match what the surrounding code uses.)

- [ ] **Step 3: Run the backend suite**

Run: `cd backend && . .venv/bin/activate && python -m pytest tests/ -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/tools/widgets/refine_widget.py
git commit -m "feat(backend): refine rewrites fused target anchor for unlocked params"
```

---

### Task 9: `AdjustmentSlider` — `overshootFrom` + `snapTo` + overshoot token

**Files:**
- Modify: `src/components/ui/AdjustmentSlider.tsx`
- Modify: `src/index.css` (one token, both themes)
- Test: `src/components/ui/AdjustmentSlider.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: two optional props, both non-breaking:
  - `overshootFrom?: number` — fill past this value renders in `var(--color-overshoot)`; the value readout formats as `"100 +12"` and turns the same color.
  - `snapTo?: number` — track drags magnet-snap to this value within `(max−min)/60`.
  Task 11 uses: `<AdjustmentSlider min={0} max={150} defaultValue={100} neutralValue={100} overshootFrom={100} snapTo={100} provenance="ai" … />`.

- [ ] **Step 1: Add the design token**

In `src/index.css`, next to `--accent-extracted` (line ~25) in the light theme block:

```css
  --color-overshoot: oklch(0.72 0.15 70);  /* amber: driver past the AI proposal */
```

And in the dark theme block (after `--color-ai`, line ~67):

```css
  --color-overshoot: oklch(0.76 0.15 70);
```

- [ ] **Step 2: Write the failing tests**

Append to `src/components/ui/AdjustmentSlider.test.tsx` (match the file's existing render helpers/imports):

```tsx
describe('overshoot', () => {
  it('formats the value as "base +over" past overshootFrom', () => {
    render(
      <AdjustmentSlider
        label="Blackness" value={112} min={0} max={150}
        defaultValue={100} neutralValue={100} overshootFrom={100}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('100 +12')).toBeInTheDocument();
  });

  it('formats plainly at or below overshootFrom', () => {
    render(
      <AdjustmentSlider
        label="Blackness" value={87} min={0} max={150}
        defaultValue={100} neutralValue={100} overshootFrom={100}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('renders an overfill segment past overshootFrom', () => {
    const { container } = render(
      <AdjustmentSlider
        label="Blackness" value={120} min={0} max={150}
        overshootFrom={100} onChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-overshoot-fill]')).not.toBeNull();
  });

  it('renders no overfill segment below overshootFrom', () => {
    const { container } = render(
      <AdjustmentSlider
        label="Blackness" value={80} min={0} max={150}
        overshootFrom={100} onChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-overshoot-fill]')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/components/ui/AdjustmentSlider.test.tsx`
Expected: FAIL — unknown props ignored, `100 +12` not found

- [ ] **Step 4: Implement**

In `AdjustmentSlider.tsx`:

1. Props interface — add after `pinSlot`:

```ts
  /**
   * Fused-driver overshoot: fill past this value renders in
   * `--color-overshoot` and the readout formats as "100 +12". The tick at
   * `neutralValue` marks the same point. Omitted → unchanged.
   */
  overshootFrom?: number;
  /** Magnet-snap track drags to this value (threshold (max−min)/60). */
  snapTo?: number;
```

2. Destructure both in the component signature (after `pinSlot`): `overshootFrom, snapTo,`.

3. Display formatting — replace the `display` const (line 67):

```ts
  const over = overshootFrom != null && value > overshootFrom;
  const display = formatValue
    ? formatValue(value)
    : over
      ? `${Math.round(overshootFrom)} +${Math.round(value - overshootFrom)}`
      : String(Math.round(value));
```

4. Snap — replace `handleValueChange`:

```ts
  const applySnap = (v: number) =>
    snapTo != null && Math.abs(v - snapTo) < (max - min) / 60 ? snapTo : v;

  const handleValueChange = ([v]: number[]) => {
    onChange(applySnap(v));
  };
```

(Number-scrub stays snap-free on purpose — scrubbing is the precision gesture.)

5. Cap the provenance fill at `overshootFrom` — replace the `fillPct` const (line 144):

```ts
  const fillPct =
    ((Math.min(value, overshootFrom ?? value) - min) / (max - min || 1)) * 100;
```

6. Overfill segment — inside `<Slider.Track>`, after the existing `{!colorTrack && (<Slider.Range …/>)}` block:

```tsx
          {!colorTrack && over && (
            <span
              aria-hidden
              data-overshoot-fill
              className="absolute h-full"
              style={{
                left: `${((overshootFrom! - min) / (max - min || 1)) * 100}%`,
                width: `${((value - overshootFrom!) / (max - min || 1)) * 100}%`,
                background: 'var(--color-overshoot)',
              }}
            />
          )}
```

7. Overshoot value color — on the non-editing display `<span>` (line ~181), add:

```tsx
            style={over ? { color: 'var(--color-overshoot)' } : undefined}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/ui/AdjustmentSlider.test.tsx`
Expected: PASS (new + all pre-existing)

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/AdjustmentSlider.tsx src/components/ui/AdjustmentSlider.test.tsx src/index.css
git commit -m "feat(ui): AdjustmentSlider overshootFrom + snapTo props, --color-overshoot token"
```

---

### Task 10: Extract `sliceWidgetByOp` to a shared lib module

**Files:**
- Create: `src/lib/widget-slices.ts`
- Modify: `src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx` (import instead of local def)
- Test: `src/lib/widget-slices.test.ts` (new)

**Interfaces:**
- Produces: `export interface OpSlice { op: RegistryOp; bindings: ControlBinding[]; values: Record<string, unknown>; nodeId: string }` and `export function sliceWidgetByOp(widget: Widget): OpSlice[]`. Consumed by `RegistryDrivenSectionBody` (existing behavior) and `FusedWidgetBody` (Task 11).

- [ ] **Step 1: Create the module**

Create `src/lib/widget-slices.ts` — **move** (cut, don't copy) the `OpSlice` interface and `sliceWidgetByOp` function verbatim from `RegistryDrivenSectionBody.tsx` (lines ~52–79), with imports:

```ts
import { loadRegistry } from '@/lib/registry/loader';
import type { Widget, ControlBinding } from '@/types/widget';
import type { RegistryOp } from '../../shared/registry/schema';

export interface OpSlice {
  op: RegistryOp;
  bindings: ControlBinding[];
  values: Record<string, unknown>;
  nodeId: string;
}

export function sliceWidgetByOp(widget: Widget): OpSlice[] {
  // …verbatim body from RegistryDrivenSectionBody.tsx…
}
```

(Adjust the `RegistryOp` import path to match how other files under `src/lib/` import the shared registry schema — grep `from '.*shared/registry/schema'` in `src/lib/` and copy the working relative path.)

In `RegistryDrivenSectionBody.tsx`: delete the local `OpSlice` + `sliceWidgetByOp`, add `import { sliceWidgetByOp } from '@/lib/widget-slices';`.

- [ ] **Step 2: Write the test**

Create `src/lib/widget-slices.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sliceWidgetByOp } from './widget-slices';
import type { Widget } from '@/types/widget';

function fakeWidget(): Widget {
  return {
    id: 'w_1', intent: 'test', scope: { root: { kind: 'global' } },
    origin: { kind: 'mcp_user_prompt' },
    composed: false, status: 'active', revision: 1, lockedParams: [],
    preview: { kind: 'none', autoBeforeAfter: false },
    nodes: [
      { id: 'n_a', type: 'basic', opId: 'light', params: { exposure: -80 },
        scope: { root: { kind: 'global' } }, inputs: [], widgetId: 'w_1', layerId: 'layer-1' },
    ],
    bindings: [
      { paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: -80, default: 0, target: { nodeId: 'n_a', paramKey: 'exposure' } },
    ],
  } as unknown as Widget;
}

describe('sliceWidgetByOp', () => {
  it('produces one slice per node with its bindings and values', () => {
    const slices = sliceWidgetByOp(fakeWidget());
    expect(slices).toHaveLength(1);
    expect(slices[0].nodeId).toBe('n_a');
    expect(slices[0].op.id).toBe('light');
    expect(slices[0].values.exposure).toBe(-80);
  });
});
```

(If `loadRegistry()` needs explicit initialization in tests, copy the registry-loading setup from `src/components/widget/CompoundWidgetBody.test.tsx` — it already tests registry-dependent widget code.)

- [ ] **Step 3: Run tests + full check**

Run: `npx vitest run src/lib/widget-slices.test.ts src/components/inspector` then `npm run check`
Expected: PASS — behavior unchanged, imports resolve

- [ ] **Step 4: Commit**

```bash
git add src/lib/widget-slices.ts src/lib/widget-slices.test.ts src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx
git commit -m "refactor(lib): extract sliceWidgetByOp to src/lib/widget-slices"
```

---

### Task 11: `FusedWidgetBody` + `WidgetShell` dispatch

**Files:**
- Create: `src/components/widget/FusedWidgetBody.tsx`
- Modify: `src/components/widget/WidgetShell.tsx` (dispatch + predicates)
- Test: `src/components/widget/FusedWidgetBody.test.tsx` (new)

**Interfaces:**
- Consumes: `interpolateExtended` (Task 2), `Widget.compound`/`driverValue` (Task 3), `AdjustmentSlider` overshoot props (Task 9), `sliceWidgetByOp` (Task 10), `WidgetShell`'s existing `setParam(paramKey, value)` + `effectiveValue(binding)` (passed as props, mirroring `HslWidgetBody`).
- Produces: `FusedWidgetBody({ widget, setParam, effectiveValue })` — driver slider + collapsible per-op sections.

- [ ] **Step 1: Write the failing tests**

Create `src/components/widget/FusedWidgetBody.test.tsx` (copy the render/store setup from `src/components/widget/CompoundWidgetBody.test.tsx` — it already mocks `useBackendState` and the registry):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FusedWidgetBody } from './FusedWidgetBody';
import type { Widget } from '@/types/widget';

function fusedWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w_1', intent: 'make it black', scope: { root: { kind: 'global' } },
    origin: { kind: 'mcp_user_prompt' },
    composed: false, status: 'active', revision: 1, lockedParams: [],
    preview: { kind: 'none', autoBeforeAfter: false },
    displayName: 'Make it black',
    compound: {
      driver: '__driver', label: 'Blackness',
      anchors: [
        { position: 0, name: 'as shot', values: { 'n_a:exposure': 0 } },
        { position: 1, name: 'proposed', values: { 'n_a:exposure': -80 } },
      ],
    },
    driverValue: 1.0,
    nodes: [
      { id: 'n_a', type: 'basic', opId: 'light', params: { exposure: -80 },
        scope: { root: { kind: 'global' } }, inputs: [], widgetId: 'w_1', layerId: 'layer-1' },
    ],
    bindings: [
      { paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: -80, default: 0, target: { nodeId: 'n_a', paramKey: 'exposure' } },
    ],
    ...overrides,
  } as unknown as Widget;
}

describe('FusedWidgetBody', () => {
  it('renders the driver with the planner label at 100', () => {
    render(
      <FusedWidgetBody widget={fusedWidget()} setParam={() => {}} effectiveValue={(b) => b.value} />,
    );
    expect(screen.getByText('Blackness')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('falls back to "Intensity" when no label', () => {
    const w = fusedWidget();
    w.compound!.label = null;
    render(<FusedWidgetBody widget={w} setParam={() => {}} effectiveValue={(b) => b.value} />);
    expect(screen.getByText('Intensity')).toBeInTheDocument();
  });

  it('renders one collapsed section per op, expandable to the real panel', () => {
    render(
      <FusedWidgetBody widget={fusedWidget()} setParam={() => {}} effectiveValue={(b) => b.value} />,
    );
    const header = screen.getByRole('button', { name: /light/i });
    expect(header).toBeInTheDocument();
    // Collapsed: the section's Exposure slider row is not rendered yet.
    expect(screen.queryByText('Exposure')).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText('Exposure')).toBeInTheDocument();
  });

  it('shows a pinned count on sections with locked params', () => {
    const w = fusedWidget({ lockedParams: ['exposure'] });
    render(<FusedWidgetBody widget={w} setParam={() => {}} effectiveValue={(b) => b.value} />);
    expect(screen.getByTitle(/1 pinned/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/widget/FusedWidgetBody.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement the component**

Create `src/components/widget/FusedWidgetBody.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import type { Widget, ControlBinding } from '@/types/widget';
import type { Anchor } from '@/lib/perceptual-dial/types';
import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { RegistryDrivenPanel } from '@/components/inspector/RegistryDrivenPanel';
import { sliceWidgetByOp, type OpSlice } from '@/lib/widget-slices';
import { interpolateExtended } from '@/lib/perceptual-dial/interpolate';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

const DRIVER_DEBOUNCE_MS = 100;
/** Backend stores t ∈ [0, 1.5]; the UI shows ×100 with the proposal at 100. */
const DRIVER_UI_SCALE = 100;
const DRIVER_UI_MAX = 150;

/** Widget-local anchors → the legacy `Anchor[]` shape interpolateExtended eats. */
function toAnchors(widget: Widget): Anchor[] {
  return (widget.compound?.anchors ?? []).map((a) => ({
    id: a.name,
    label: a.name,
    position: [a.position],
    params: a.values,
  }));
}

interface FusedWidgetBodyProps {
  widget: Widget;
  /** WidgetShell's debounced optimistic setter — used by section panels. */
  setParam: (paramKey: string, value: ControlBinding['value']) => void;
  /** WidgetShell's optimistic-aware binding value reader. */
  effectiveValue: (b: ControlBinding) => ControlBinding['value'];
}

/** Body for fused intent widgets (widget-local `compound`): one intent-named
 *  driver slider (0–150, proposal at 100, amber overshoot) over collapsible
 *  per-op sections that render the ops' real RegistryDrivenPanel controls.
 *  See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md. */
export function FusedWidgetBody({ widget, setParam, effectiveValue }: FusedWidgetBodyProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  // Driver position: local while dragging, snapshot (driverValue) otherwise.
  const [localT, setLocalT] = useState<number | null>(null);
  const t = localT ?? widget.driverValue ?? 1.0;

  const anchors = useMemo(() => toAnchors(widget), [widget]);
  const lockedSet = useMemo(() => new Set(widget.lockedParams), [widget.lockedParams]);
  const slices = useMemo(() => sliceWidgetByOp(widget), [widget]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());

  // Drag: optimistic per-node compiled patch (canon key so WebGL previews
  // instantly — the CompoundWidgetBody pattern), debounced '__driver' POST.
  const handleDriver = useCallback((uiValue: number) => {
    const nextT = uiValue / DRIVER_UI_SCALE;
    setLocalT(nextT);
    const state = useBackendState.getState();
    if (!state.snapshot || !sessionId || offline) return;
    const baseRevision = state.snapshot.revision;
    const compiled = interpolateExtended(anchors, nextT);
    // Group derived values ("nodeId:paramKey") per node → one patch per canon id.
    const byNode = new Map<string, Array<{ paramKey: string; value: number }>>();
    for (const [qkey, value] of Object.entries(compiled)) {
      const sep = qkey.indexOf(':');
      const nodeId = qkey.slice(0, sep);
      const paramKey = qkey.slice(sep + 1);
      const binding = widget.bindings.find(
        (b) => b.target.nodeId === nodeId && b.target.paramKey === paramKey,
      );
      if (binding && lockedSet.has(binding.paramKey)) continue;
      if (!byNode.has(nodeId)) byNode.set(nodeId, []);
      byNode.get(nodeId)!.push({ paramKey, value });
    }
    for (const [nodeId, bindings] of byNode) {
      const node = widget.nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      const layerIds = node.layerIds ?? (node.layerId ? [node.layerId] : []);
      for (const layerId of layerIds) {
        state.applyOptimistic(`canon:${layerId}:${node.type}`, { bindings, baseRevision });
      }
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void backendTools.set_widget_param(sessionId, {
        widgetId: widget.id, paramKey: '__driver', value: nextT,
      });
    }, DRIVER_DEBOUNCE_MS);
  }, [anchors, lockedSet, offline, sessionId, widget]);

  const toggleOp = useCallback((opId: string) => {
    setExpandedOps((prev) => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  }, []);

  if (!widget.compound) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 pt-1">
        <AdjustmentSlider
          label={widget.compound.label ?? 'Intensity'}
          value={t * DRIVER_UI_SCALE}
          min={0}
          max={DRIVER_UI_MAX}
          step={1}
          defaultValue={100}
          neutralValue={100}
          overshootFrom={100}
          snapTo={100}
          provenance="ai"
          onChange={handleDriver}
        />
      </div>
      <div className="flex flex-col">
        {slices.map((s) => (
          <FusedOpSection
            key={s.nodeId}
            slice={s}
            expanded={expandedOps.has(s.nodeId)}
            pinnedCount={s.bindings.filter((b) => lockedSet.has(b.paramKey)).length}
            onToggle={() => toggleOp(s.nodeId)}
            setParam={setParam}
            effectiveValue={effectiveValue}
          />
        ))}
      </div>
    </div>
  );
}

interface FusedOpSectionProps {
  slice: OpSlice;
  expanded: boolean;
  pinnedCount: number;
  onToggle: () => void;
  setParam: (paramKey: string, value: ControlBinding['value']) => void;
  effectiveValue: (b: ControlBinding) => ControlBinding['value'];
}

/** One collapsible op section: header row (chevron · op name · live summary ·
 *  pin count) + the op's real RegistryDrivenPanel when expanded. */
function FusedOpSection({
  slice, expanded, pinnedCount, onToggle, setParam, effectiveValue,
}: FusedOpSectionProps) {
  // Live values (optimistic-aware) keyed by bare paramKey for the panel.
  const values: Record<string, unknown> = {};
  for (const b of slice.bindings) values[b.paramKey] = effectiveValue(b);

  // Collapsed summary: first two numeric bindings as "Label −58".
  const summary = slice.bindings
    .filter((b) => typeof values[b.paramKey] === 'number')
    .slice(0, 2)
    .map((b) => `${b.label} ${Math.round(values[b.paramKey] as number)}`)
    .join(' · ');

  return (
    <div className="border-t border-separator/60">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 text-[10px] text-text-secondary
          hover:text-text-primary hover:bg-surface-secondary/60 transition-colors"
      >
        {expanded
          ? <ChevronDown aria-hidden className="size-2.5 shrink-0" />
          : <ChevronRight aria-hidden className="size-2.5 shrink-0" />}
        <span className="font-medium text-text-primary">{slice.op.display_name}</span>
        {pinnedCount > 0 && (
          <span
            title={`${pinnedCount} pinned`}
            className="inline-flex items-center gap-0.5 text-accent"
          >
            <Pin aria-hidden className="size-2" />
            {pinnedCount}
          </span>
        )}
        <span className="flex-1" />
        <span className="tabular-nums truncate">{summary}</span>
      </button>
      {expanded && (
        <div className="px-1.5 pb-1">
          <RegistryDrivenPanel
            op={slice.op}
            values={values}
            onParamChange={(paramKey, value) => setParam(paramKey, value as number)}
            disabled={false}
          />
        </div>
      )}
    </div>
  );
}
```

Adjust to reality where the plan's assumptions diverge (check, don't assume): `RegistryDrivenPanel`'s exact prop names (`op/values/onParamChange/disabled` per `RegistryDrivenSectionBody` usage — verify against `src/components/inspector/RegistryDrivenPanel.tsx`), the `Anchor` import path, and `applyOptimistic`'s patch shape (`{ bindings, baseRevision }` per `CompoundWidgetBody.tsx:119–122`).

- [ ] **Step 4: Wire the dispatch in `WidgetShell.tsx`**

1. Import: `import { FusedWidgetBody } from './FusedWidgetBody';`
2. Add a predicate next to `usesFlatBody` (line ~97):

```ts
  // Fused intent widget: widget-local compound (synthesized driver).
  // Distinct from registry compound ops, which keep CompoundWidgetBody.
  const isFused = !!widget.compound;
```

3. Extend `usesFlatBody` to exclude fused widgets:

```ts
  const usesFlatBody =
    !isFused &&
    !loadRegistry().ops[widget.opId ?? '']?.compound &&
    !isHslWidget(widget) &&
    !isFullLevelsWidget(widget) &&
    !isCurvesWidget(widget);
```

4. In the body-dispatch JSX (lines ~371–398), add the fused branch FIRST and guard the others with `!isFused`:

```tsx
          {!pinnedParamKeys && isFused && (
            <div className="px-1.5 py-1">
              <FusedWidgetBody widget={widget} setParam={setParam} effectiveValue={effectiveValue} />
            </div>
          )}
          {!pinnedParamKeys && !isFused && loadRegistry().ops[widget.opId ?? '']?.compound && (
            …existing CompoundWidgetBody branch unchanged…
          )}
          {!pinnedParamKeys && !isFused && widget.bindings.length > 0 && isHslWidget(widget) && (
            …existing…
          )}
          {!pinnedParamKeys && !isFused && widget.bindings.length > 0 && isFullLevelsWidget(widget) && (
            …existing…
          )}
          {!pinnedParamKeys && !isFused && widget.bindings.length > 0 && isCurvesWidget(widget) && (
            …existing…
          )}
```

(The flat-body branch needs no extra guard — `usesFlatBody` already excludes fused. The pin-filter escape hatch stays: with `pinnedParamKeys` active a fused widget falls through to flat BindingRows, same as every rich body.)

- [ ] **Step 5: Run tests + full check**

Run: `npx vitest run src/components/widget/` then `npm run check`
Expected: PASS — including all existing WidgetShell/CompoundWidgetBody tests (registry dials still dispatch to `CompoundWidgetBody`)

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/FusedWidgetBody.tsx src/components/widget/FusedWidgetBody.test.tsx src/components/widget/WidgetShell.tsx
git commit -m "feat(widget): FusedWidgetBody — intent driver + collapsible op sections"
```

---

### Task 12: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suites**

Run: `npm run check` and `cd backend && . .venv/bin/activate && python -m pytest tests/ -q`
Expected: both PASS

- [ ] **Step 2: Manual dev-server pass**

Start backend + `npm run dev`, open an image, wait for analyze, then:

1. Cmd+K → "make this element black" (or "make it darker" on a plain image). Expect: one widget with a driver slider labeled by the planner (e.g. "Blackness") at **100**, tick visible, collapsed op sections with live summaries beneath.
2. Drag the driver to 0 → image returns to as-shot. To 150 → effect intensifies past the proposal; fill past 100 turns amber; value reads "100 +50". Cross 100 slowly → magnet snap. Double-click the value area → back to 100.
3. Expand a section → real sliders. Drag one → it pins (📌 count appears on the section header); drag the driver → the pinned param holds, others follow.
4. Refine ("a bit less harsh") → driver stays where it was; new proposal values land; pinned param survives.
5. Toolrail Light button → widget spawns **without** a driver (flat rows, unchanged).
6. Cmd+K → "make it night" → time-of-day dial widget, unchanged (`CompoundWidgetBody`).
7. Undo/redo across driver drags → single linear steps, no divergence.

- [ ] **Step 3: Merge/PR decision**

Use superpowers:finishing-a-development-branch.

---

## Deferred to Phase B/C plans (do NOT implement here)

- Braided `TetherEdge` variant + category tint tokens + strand separation (Phase B).
- Break-out `fused_slice` projection nodes, hub tethers, ⤢ affordance, `detach_widget_op`, ⋯ menu entry (Phase C).
- These get their own plan files once Phase A is merged.
