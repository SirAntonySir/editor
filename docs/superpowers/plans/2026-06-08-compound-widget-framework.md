# Compound Widget Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Time-of-Day's anchor table from duplicated Python+TypeScript files into the SSoT JSON registry, build a generic 1D compound widget framework (schema + interpolation + UI), and retire the bespoke TOD code.

**Architecture:** Seven independent commits: (1) `compound` block on `RegistryOp` in Pydantic + Zod, (2) shared `interpolate1D` library in TS + Python with parity test, (3) author `shared/registry/ops/time-of-day.json`, (4) backend `set_widget_param` reads anchors from registry, (5) frontend anchors source switches to registry, (6) generic `CompoundWidgetBody` component + `ToolSection.tsx` dispatch, (7) delete 6 bespoke TOD files. Each commit is independently revertable.

**Tech Stack:** Pydantic v2 + Zod for schemas, Catmull-Rom 1D interpolation, React + zustand for UI.

**Reference:** `docs/superpowers/specs/2026-06-08-compound-widget-framework-design.md`

**Pytest env quirk:** tests need ANTHROPIC_API_KEY loaded. Use `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest <args>`.

---

## File Structure

### Created
- `shared/registry/lib/interpolate-1d.ts` — Catmull-Rom 1D interpolation (TS)
- `shared/registry/lib/__tests__/interpolate-1d.test.ts` — TS unit + parity tests
- `backend/app/registry/interpolate.py` — Catmull-Rom 1D (Python, byte-parity with TS)
- `backend/tests/registry/test_interpolate.py` — Python unit tests
- `backend/tests/registry/test_interpolate_parity.py` — TS↔Python parity assertions
- `shared/registry/ops/time-of-day.json` — TOD op JSON with full `compound` block
- `backend/app/registry/compound_resolver.py` — `resolve_compound(widget, op, driver_value)` helper
- `src/components/widget/CompoundWidgetBody.tsx` — generic compound widget UI
- `src/components/widget/compound/AnchorCard.tsx` — extracted anchor card primitive
- `src/components/widget/CompoundWidgetBody.test.tsx` — UI tests

### Modified
- `backend/app/registry/schema.py` — add `CompoundAnchor`, `OpCompoundConfig`, `compound` field on `RegistryOp`
- `shared/registry/schema.ts` — mirror in Zod
- `backend/app/tools/widgets/set_widget_param.py` — read anchors from registry, drop `app.tools.fused._time_of_day_data` import
- `src/components/inspector/adjustments/ToolSection.tsx` — dispatch to `CompoundWidgetBody` when `op.compound !== undefined`

### Deleted (Task 7)
- `backend/app/tools/fused/time_of_day.py`
- `backend/app/tools/fused/_time_of_day_data.py`
- `src/processing/time-of-day.tsx`
- `src/processing/anchors/time-of-day-anchors.ts` (if it exists — verify)
- `src/components/workspace/TimeOfDayWidgetBody.tsx`
- `src/lib/perceptual-dial/interpolate.ts` + its test

---

## Task 1: Schema additions (`compound` block on `RegistryOp`)

**Visible effect:** None — pure schema. `OpCompoundConfig` + `CompoundAnchor` validate but no op JSON uses them yet.

**Files:**
- Modify: `backend/app/registry/schema.py`
- Modify: `shared/registry/schema.ts`
- Test: `backend/tests/registry/test_schema.py` (extend)
- Test: `src/lib/registry/__tests__/schema.test.ts` (extend)

- [ ] **Step 1: Write failing backend schema tests**

Add to `backend/tests/registry/test_schema.py`:

```python
def test_compound_block_validates():
    op = RegistryOp.model_validate({
        "id": "tod", "display_name": "Time of Day",
        "category": "tone",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "position": {"type": "scalar", "range": [0, 1], "default": 0.3, "step": 0.001},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "position", "control_type": "slider", "label": "Time"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "position",
            "interpolation": "catmull_rom_1d",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound is not None
    assert op.compound.driver == "position"
    assert len(op.compound.anchors) == 2


def test_compound_rejects_unsorted_anchors():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "position": {"type": "scalar", "range": [0, 1], "default": 0.3},
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "position", "control_type": "slider", "label": "T"},
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "position", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.5, "name": "b", "values": {"k": 90}},
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                ],
            },
        })


def test_compound_rejects_driver_not_in_params():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "nonexistent", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                    {"position": 1.0, "name": "b", "values": {"k": 90}},
                ],
            },
        })


def test_compound_rejects_anchor_value_key_not_in_params():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "position": {"type": "scalar", "range": [0, 1], "default": 0.3},
            },
            "bindings": [
                {"param_key": "position", "control_type": "slider", "label": "T"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "position", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"unknown_key": 10}},
                    {"position": 1.0, "name": "b", "values": {"unknown_key": 90}},
                ],
            },
        })


def test_compound_optional():
    """Ops without a compound block still validate (no regression)."""
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "tone",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.compound is None
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py -v`
Expected: 5 new FAIL — `compound` unknown field / `OpCompoundConfig` not defined.

- [ ] **Step 3: Add Pydantic models**

In `backend/app/registry/schema.py`, add ABOVE `RegistryOp`:

```python
class CompoundAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float = Field(ge=0.0, le=1.0)
    name: str
    values: dict[str, float]


class OpCompoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver: str
    interpolation: Literal["catmull_rom_1d"] = "catmull_rom_1d"
    anchors: list[CompoundAnchor] = Field(min_length=2)

    @model_validator(mode="after")
    def _checks(self) -> OpCompoundConfig:
        positions = [a.position for a in self.anchors]
        if positions != sorted(positions) or len(set(positions)) != len(positions):
            raise ValueError("anchors must have strictly increasing positions")
        all_keys = {k for a in self.anchors for k in a.values.keys()}
        for a in self.anchors:
            missing = all_keys - set(a.values.keys())
            if missing:
                raise ValueError(f"anchor {a.name!r} missing keys {missing}")
        return self
```

Add the field to `RegistryOp`:

```python
class RegistryOp(BaseModel):
    # ... existing fields ...
    compound: OpCompoundConfig | None = None

    @model_validator(mode="after")
    def _bindings_reference_params(self) -> RegistryOp:
        for b in self.bindings:
            if b.param_key not in self.params:
                raise ValueError(f"binding param_key {b.param_key!r} not in params")
        # NEW: compound validation
        if self.compound:
            if self.compound.driver not in self.params:
                raise ValueError(
                    f"compound driver {self.compound.driver!r} not in params"
                )
            for a in self.compound.anchors:
                for k in a.values:
                    if k not in self.params:
                        raise ValueError(
                            f"anchor value key {k!r} not in op.params"
                        )
        return self
```

- [ ] **Step 4: Backend tests pass**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py -v`
Expected: all PASS (5 new + existing).

- [ ] **Step 5: Write failing Zod tests**

Add to `src/lib/registry/__tests__/schema.test.ts`:

```typescript
describe('RegistryOpSchema compound block', () => {
  const baseOp = {
    id: 'x', display_name: 'X', category: 'tone',
    llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
    params: {
      position: { type: 'scalar', range: [0, 1], default: 0.3 },
      k: { type: 'scalar', range: [0, 100], default: 50 },
    },
    bindings: [
      { param_key: 'position', control_type: 'slider', label: 'T' },
      { param_key: 'k', control_type: 'slider', label: 'K' },
    ],
    engine: { shader: 'compound', render_order: 5, node_type: 'compound' },
  };

  it('accepts a valid compound block', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'position', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.driver).toBe('position');
  });

  it('rejects unsorted anchors', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'position', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.5, name: 'b', values: { k: 90 } },
          { position: 0.0, name: 'a', values: { k: 10 } },
        ],
      },
    })).toThrow();
  });

  it('rejects driver not in params', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'bogus', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    })).toThrow();
  });

  it('treats compound as optional', () => {
    const parsed = RegistryOpSchema.parse(baseOp);
    expect(parsed.compound).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run Zod test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: 3 of 4 new tests FAIL (the optional-block test passes today since Zod ignores unknown fields when not strict — wait, it IS strict now). All 4 likely FAIL.

- [ ] **Step 7: Add Zod schemas**

In `shared/registry/schema.ts`, ABOVE `RegistryOpSchema`:

```typescript
export const CompoundAnchorSchema = z.object({
  position: z.number().min(0).max(1),
  name: z.string(),
  values: z.record(z.string(), z.number()),
}).strict();

export const OpCompoundConfigSchema = z.object({
  driver: z.string(),
  interpolation: z.literal('catmull_rom_1d').default('catmull_rom_1d'),
  anchors: z.array(CompoundAnchorSchema).min(2),
}).strict().superRefine((c, ctx) => {
  const positions = c.anchors.map(a => a.position);
  const sorted = [...positions].sort((a, b) => a - b);
  if (positions.some((p, i) => p !== sorted[i]) ||
      new Set(positions).size !== positions.length) {
    ctx.addIssue({ code: 'custom', message: 'anchors must have strictly increasing positions' });
  }
  const allKeys = new Set<string>();
  for (const a of c.anchors) for (const k of Object.keys(a.values)) allKeys.add(k);
  for (const a of c.anchors) {
    for (const k of allKeys) {
      if (!(k in a.values)) {
        ctx.addIssue({ code: 'custom', message: `anchor "${a.name}" missing key "${k}"` });
      }
    }
  }
});
```

Then update `RegistryOpSchema`:

```typescript
export const RegistryOpSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  category: z.string().optional(),
  llm: OpLlmMetadataSchema,
  params: z.record(z.string(), OpParamSchema),
  bindings: z.array(OpBindingSchema),
  engine: OpEngineConfigSchema,
  compound: OpCompoundConfigSchema.optional(),     // NEW
}).strict().superRefine((op, ctx) => {
  for (const b of op.bindings) {
    if (!(b.param_key in op.params)) {
      ctx.addIssue({
        code: 'custom',
        message: `binding param_key "${b.param_key}" not in params`,
      });
    }
  }
  // NEW: compound validation
  if (op.compound) {
    if (!(op.compound.driver in op.params)) {
      ctx.addIssue({
        code: 'custom',
        message: `compound driver "${op.compound.driver}" not in params`,
      });
    }
    for (const a of op.compound.anchors) {
      for (const k of Object.keys(a.values)) {
        if (!(k in op.params)) {
          ctx.addIssue({
            code: 'custom',
            message: `anchor value key "${k}" not in op.params`,
          });
        }
      }
    }
  }
});
```

Export the new types:

```typescript
export type CompoundAnchor = z.infer<typeof CompoundAnchorSchema>;
export type OpCompoundConfig = z.infer<typeof OpCompoundConfigSchema>;
```

- [ ] **Step 8: Frontend tests pass**

Run: `npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Run full vitest + tsc + pytest, no regressions**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5
```
Expected: all green; tsc clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/registry/schema.py backend/tests/registry/test_schema.py shared/registry/schema.ts src/lib/registry/__tests__/schema.test.ts
git commit -m "feat(registry): compound block schema (CompoundAnchor + OpCompoundConfig)"
```

---

## Task 2: Shared interpolation library (TS + Python with parity test)

**Visible effect:** None — new library; nothing reads from it yet.

**Files:**
- Create: `shared/registry/lib/interpolate-1d.ts`
- Create: `shared/registry/lib/__tests__/interpolate-1d.test.ts`
- Create: `backend/app/registry/interpolate.py`
- Create: `backend/tests/registry/test_interpolate.py`

- [ ] **Step 1: Write failing TS test**

Create `shared/registry/lib/__tests__/interpolate-1d.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { interpolate1D } from '../interpolate-1d';

describe('interpolate1D', () => {
  const anchors = [
    { position: 0.0, name: 'a', values: { x: 0 } },
    { position: 0.5, name: 'b', values: { x: 50 } },
    { position: 1.0, name: 'c', values: { x: 100 } },
  ];

  it('returns endpoint values when t is outside range', () => {
    expect(interpolate1D(anchors, -0.5)).toEqual({ x: 0 });
    expect(interpolate1D(anchors, 1.5)).toEqual({ x: 100 });
  });

  it('returns anchor values exactly at anchor positions', () => {
    expect(interpolate1D(anchors, 0.0).x).toBeCloseTo(0, 6);
    expect(interpolate1D(anchors, 0.5).x).toBeCloseTo(50, 6);
    expect(interpolate1D(anchors, 1.0).x).toBeCloseTo(100, 6);
  });

  it('interpolates smoothly between anchors', () => {
    // Catmull-Rom between 0 and 50 at u=0.5 — should be near 25 with some curve.
    const v = interpolate1D(anchors, 0.25).x;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(50);
  });

  it('throws on fewer than 2 anchors', () => {
    expect(() => interpolate1D([anchors[0]], 0.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run shared/registry/lib/__tests__/interpolate-1d.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the TS library**

Create `shared/registry/lib/interpolate-1d.ts`:

```typescript
import type { CompoundAnchor } from '../schema';

/** Centripetal Catmull-Rom 1D, tension 0.5. */
function catmullRom(v0: number, v1: number, v2: number, v3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    2 * v1 +
    (-v0 + v2) * u +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
    (-v0 + 3 * v1 - 3 * v2 + v3) * u3
  );
}

/** Interpolate the derived values at position `t` along an anchor table.
 *  Anchors must be sorted by position. Returns a fresh dict. */
export function interpolate1D(
  anchors: CompoundAnchor[],
  t: number,
): Record<string, number> {
  if (anchors.length < 2) throw new Error('need at least 2 anchors');
  if (t <= anchors[0].position) return { ...anchors[0].values };
  const last = anchors[anchors.length - 1];
  if (t >= last.position) return { ...last.values };

  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].position < t) i++;
  const p0 = anchors[Math.max(i - 1, 0)];
  const p1 = anchors[i];
  const p2 = anchors[i + 1];
  const p3 = anchors[Math.min(i + 2, anchors.length - 1)];

  const span = p2.position - p1.position;
  const u = span > 0 ? (t - p1.position) / span : 0;

  const keys = new Set<string>([
    ...Object.keys(p0.values),
    ...Object.keys(p1.values),
    ...Object.keys(p2.values),
    ...Object.keys(p3.values),
  ]);
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = catmullRom(
      p0.values[k] ?? 0,
      p1.values[k] ?? 0,
      p2.values[k] ?? 0,
      p3.values[k] ?? 0,
      u,
    );
  }
  return out;
}
```

- [ ] **Step 4: TS tests pass**

Run: `npx vitest run shared/registry/lib/__tests__/interpolate-1d.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing Python test**

Create `backend/tests/registry/test_interpolate.py`:

```python
import pytest

from app.registry.interpolate import interpolate_1d


_ANCHORS = [
    {"position": 0.0, "name": "a", "values": {"x": 0}},
    {"position": 0.5, "name": "b", "values": {"x": 50}},
    {"position": 1.0, "name": "c", "values": {"x": 100}},
]


def test_endpoint_values_when_outside_range():
    assert interpolate_1d(_ANCHORS, -0.5) == {"x": 0}
    assert interpolate_1d(_ANCHORS, 1.5) == {"x": 100}


def test_anchor_values_at_anchor_positions():
    assert interpolate_1d(_ANCHORS, 0.0)["x"] == pytest.approx(0.0, abs=1e-6)
    assert interpolate_1d(_ANCHORS, 0.5)["x"] == pytest.approx(50.0, abs=1e-6)
    assert interpolate_1d(_ANCHORS, 1.0)["x"] == pytest.approx(100.0, abs=1e-6)


def test_interpolates_smoothly_between_anchors():
    v = interpolate_1d(_ANCHORS, 0.25)["x"]
    assert 0 < v < 50


def test_raises_on_too_few_anchors():
    with pytest.raises(ValueError):
        interpolate_1d([_ANCHORS[0]], 0.5)
```

- [ ] **Step 6: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_interpolate.py -v`
Expected: FAIL — `app.registry.interpolate` module not found.

- [ ] **Step 7: Create the Python library**

Create `backend/app/registry/interpolate.py`:

```python
"""Centripetal Catmull-Rom 1D interpolation — byte-parity with
`shared/registry/lib/interpolate-1d.ts`. Used by compound-widget ops.
"""
from __future__ import annotations

from typing import Any


def _catmull_rom(v0: float, v1: float, v2: float, v3: float, u: float) -> float:
    u2 = u * u
    u3 = u2 * u
    return 0.5 * (
        2 * v1
        + (-v0 + v2) * u
        + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2
        + (-v0 + 3 * v1 - 3 * v2 + v3) * u3
    )


def interpolate_1d(anchors: list[Any], t: float) -> dict[str, float]:
    """Interpolate derived values at position `t` along an anchor table.

    `anchors` is a list of dicts (or Pydantic models) with `position` (float),
    `name` (str), and `values` (dict[str, float]). Must be sorted by position.

    Out-of-range `t` clamps to the nearest endpoint's values verbatim.
    """
    if len(anchors) < 2:
        raise ValueError("need at least 2 anchors")

    # Allow both dicts and Pydantic models.
    def _pos(a: Any) -> float:
        return a["position"] if isinstance(a, dict) else a.position

    def _vals(a: Any) -> dict[str, float]:
        return a["values"] if isinstance(a, dict) else a.values

    if t <= _pos(anchors[0]):
        return dict(_vals(anchors[0]))
    if t >= _pos(anchors[-1]):
        return dict(_vals(anchors[-1]))

    i = 0
    while i < len(anchors) - 1 and _pos(anchors[i + 1]) < t:
        i += 1
    p0 = anchors[max(i - 1, 0)]
    p1 = anchors[i]
    p2 = anchors[i + 1]
    p3 = anchors[min(i + 2, len(anchors) - 1)]

    span = _pos(p2) - _pos(p1)
    u = (t - _pos(p1)) / span if span > 0 else 0.0

    v0, v1, v2, v3 = _vals(p0), _vals(p1), _vals(p2), _vals(p3)
    keys = set(v0.keys()) | set(v1.keys()) | set(v2.keys()) | set(v3.keys())
    out: dict[str, float] = {}
    for k in keys:
        out[k] = _catmull_rom(
            v0.get(k, 0.0), v1.get(k, 0.0), v2.get(k, 0.0), v3.get(k, 0.0), u
        )
    return out
```

- [ ] **Step 8: Python tests pass**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_interpolate.py -v`
Expected: 4 PASS.

- [ ] **Step 9: Add parity test against existing TOD anchors**

Add to `backend/tests/registry/test_interpolate.py`:

```python
def test_parity_with_existing_tod_anchors():
    """Verify the new library produces identical output to the existing
    fused-tool interpolate_1d at sampled positions. After Task 4 the existing
    file is deleted — this test verifies the migration didn't change values."""
    from app.tools.fused._time_of_day_data import (
        TIME_OF_DAY_ANCHORS, interpolate_1d as old_interp,
    )

    # Convert legacy (position, values_dict) tuples to the new anchor shape.
    new_anchors = [
        {"position": pos, "name": f"a{i}", "values": vals}
        for i, (pos, vals) in enumerate(TIME_OF_DAY_ANCHORS)
    ]

    for t in (0.0, 0.05, 0.1, 0.25, 0.3, 0.55, 0.65, 0.8, 0.95, 1.0):
        old = old_interp(t)
        new = interpolate_1d(new_anchors, t)
        assert set(new.keys()) == set(old.keys()), f"key mismatch at t={t}"
        for k in old:
            assert new[k] == pytest.approx(old[k], abs=1e-9), (
                f"divergence at t={t}, key={k}: old={old[k]} new={new[k]}"
            )
```

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_interpolate.py -v`
Expected: 5 PASS (including parity).

- [ ] **Step 10: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/lib/ backend/app/registry/interpolate.py backend/tests/registry/test_interpolate.py
git commit -m "feat(registry): shared 1D Catmull-Rom interpolation (TS + Python)"
```

---

## Task 3: Author `time-of-day.json`

**Visible effect:** None — file is authored, loader picks it up, but no consumer reads `op.compound` yet.

**Files:**
- Create: `shared/registry/ops/time-of-day.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Author the JSON file**

Create `shared/registry/ops/time-of-day.json` with the exact content from the spec §5.2. Verbatim copy:

```json
{
  "id": "time-of-day",
  "display_name": "Time of Day",
  "category": "tone",
  "llm": {
    "description": "1-D dial that re-lights the image across the day arc — dawn, noon, golden hour, blue hour, night. Compiles to coordinated white balance, exposure, contrast, saturation, and vignette.",
    "typical_use": "User says 'make it night', 'golden hour', 'dawn light', 'blue hour', 'sunset'.",
    "semantic_tags": ["mood", "lighting", "atmosphere", "time"]
  },
  "params": {
    "position":                  { "type": "scalar", "range": [0, 1],         "default": 0.30, "step": 0.001 },
    "kelvin.kelvin":             { "type": "scalar", "range": [2000, 12000],  "default": 7500, "step": 50, "unit": "K" },
    "light.exposure":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.contrast":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.highlights":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.shadows":             { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.vibrance":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.orange_sat":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.blue_sat":              { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "filters.vignette_amount":   { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 }
  },
  "bindings": [
    { "param_key": "position",                "control_type": "slider", "label": "Time" },
    { "param_key": "kelvin.kelvin",           "control_type": "slider", "label": "WB" },
    { "param_key": "light.exposure",          "control_type": "slider", "label": "Exposure" },
    { "param_key": "light.contrast",          "control_type": "slider", "label": "Contrast" },
    { "param_key": "light.highlights",        "control_type": "slider", "label": "Highlights" },
    { "param_key": "light.shadows",           "control_type": "slider", "label": "Shadows" },
    { "param_key": "color.vibrance",          "control_type": "slider", "label": "Vibrance" },
    { "param_key": "hsl.orange_sat",          "control_type": "slider", "label": "Orange Sat" },
    { "param_key": "hsl.blue_sat",            "control_type": "slider", "label": "Blue Sat" },
    { "param_key": "filters.vignette_amount", "control_type": "slider", "label": "Vignette" }
  ],
  "engine": { "shader": "compound", "render_order": 5, "node_type": "compound" },
  "compound": {
    "driver": "position",
    "interpolation": "catmull_rom_1d",
    "anchors": [
      { "position": 0.10, "name": "dawn",   "values": { "kelvin.kelvin": 9800, "light.exposure": -30,  "light.contrast": -8, "light.highlights": -15, "light.shadows":  20, "color.vibrance":  5, "hsl.orange_sat":  10, "hsl.blue_sat":  15, "filters.vignette_amount": -10 } },
      { "position": 0.30, "name": "noon",   "values": { "kelvin.kelvin": 7500, "light.exposure":   0,  "light.contrast": 10, "light.highlights":   0, "light.shadows":   0, "color.vibrance":  0, "hsl.orange_sat":   0, "hsl.blue_sat":  15, "filters.vignette_amount":   0 } },
      { "position": 0.55, "name": "golden", "values": { "kelvin.kelvin": 9600, "light.exposure":  20,  "light.contrast":  5, "light.highlights": -20, "light.shadows":  10, "color.vibrance": 12, "hsl.orange_sat":  25, "hsl.blue_sat":  -5, "filters.vignette_amount":  -8 } },
      { "position": 0.80, "name": "blue",   "values": { "kelvin.kelvin": 4500, "light.exposure": -50,  "light.contrast": 15, "light.highlights": -10, "light.shadows":   5, "color.vibrance":  5, "hsl.orange_sat": -25, "hsl.blue_sat":  20, "filters.vignette_amount": -15 } },
      { "position": 1.00, "name": "night",  "values": { "kelvin.kelvin": 8800, "light.exposure": -120, "light.contrast": 25, "light.highlights": -40, "light.shadows": -10, "color.vibrance":  8, "hsl.orange_sat": -10, "hsl.blue_sat":  15, "filters.vignette_amount": -30 } }
    ]
  }
}
```

- [ ] **Step 2: Add a loader assertion that TOD is present + compound is wired**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_time_of_day_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("time-of-day")
    assert op is not None
    assert op.compound is not None
    assert op.compound.driver == "position"
    assert len(op.compound.anchors) == 5
    names = [a.name for a in op.compound.anchors]
    assert names == ["dawn", "noon", "golden", "blue", "night"]
```

- [ ] **Step 3: Run loader tests**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v`
Expected: PASS (existing + new TOD test).

- [ ] **Step 4: Verify the JSON also loads via Vite glob (frontend smoke test)**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts`
Expected: PASS — counts up by 1 op.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/time-of-day.json backend/tests/registry/test_loader.py
git commit -m "feat(registry): author time-of-day.json with full compound block"
```

---

## Task 4: Backend reads anchors from registry

**Visible effect:** None at the runtime UI level — TOD continues to work identically. Backend's `set_widget_param` now sources anchors from the registry instead of the hardcoded Python file.

**Files:**
- Create: `backend/app/registry/compound_resolver.py`
- Modify: `backend/app/tools/widgets/set_widget_param.py`
- Test: `backend/tests/registry/test_compound_resolver.py`

- [ ] **Step 1: Write failing tests for `resolve_compound`**

Create `backend/tests/registry/test_compound_resolver.py`:

```python
import pytest

from app.registry.compound_resolver import resolve_compound
from app.registry.loader import reload_registry


def test_resolve_compound_returns_derived_values_at_anchor():
    reg = reload_registry()
    op = reg.ops["time-of-day"]
    # Build a stub widget with no locked params.
    class StubWidget:
        locked_params: list[str] = []
    # At position 0.30 (noon anchor), should return noon's values for non-driver keys.
    result = resolve_compound(StubWidget(), op, 0.30)
    assert result["kelvin.kelvin"] == pytest.approx(7500, abs=1)
    assert "position" not in result   # driver excluded


def test_resolve_compound_skips_locked_keys():
    reg = reload_registry()
    op = reg.ops["time-of-day"]
    class StubWidget:
        locked_params: list[str] = ["light.exposure"]
    result = resolve_compound(StubWidget(), op, 0.30)
    assert "light.exposure" not in result
    assert "kelvin.kelvin" in result


def test_resolve_compound_returns_empty_for_non_compound_op():
    reg = reload_registry()
    op = reg.ops["grain"]   # no compound block
    class StubWidget:
        locked_params: list[str] = []
    assert resolve_compound(StubWidget(), op, 0.5) == {}
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_compound_resolver.py -v`
Expected: FAIL — `compound_resolver` module not found.

- [ ] **Step 3: Implement `resolve_compound`**

Create `backend/app/registry/compound_resolver.py`:

```python
"""Compound widget resolver — applies a driver-param change to derive new
values for the op's other params via interpolation, skipping any keys the
user has locked via implicit lock-on-edit.

Backend-only; the frontend's CompoundWidgetBody performs the same math
client-side for optimistic rendering.
"""
from __future__ import annotations

from typing import Any

from app.registry.interpolate import interpolate_1d
from app.registry.schema import RegistryOp


def resolve_compound(
    widget: Any, op: RegistryOp, driver_value: float,
) -> dict[str, float]:
    """Compute the derived param updates after a driver change.

    Returns a {param_key: new_value} dict for non-locked derived params.
    Returns {} for ops without a `compound` block.
    """
    if op.compound is None:
        return {}
    bundle = interpolate_1d(op.compound.anchors, driver_value)
    locked = set(getattr(widget, "locked_params", []) or [])
    driver = op.compound.driver
    return {
        k: v for k, v in bundle.items() if k != driver and k not in locked
    }
```

- [ ] **Step 4: Tests pass**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_compound_resolver.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Wire `set_widget_param.py` to use the new resolver**

In `backend/app/tools/widgets/set_widget_param.py`, find the existing `# Time-of-Day compound-bundle recompute` block (starts around line 59). Replace it with a registry-driven version:

```python
        # Compound widget driver-recompute / implicit lock.
        # - Driver param change: recompute the bundle via the registry's anchor
        #   table and write all non-locked derived keys back to the node + canon.
        # - Derived key edit: implicit lock-on-edit so a subsequent driver
        #   change won't overwrite the user's value.
        from app.registry.loader import get_registry
        from app.registry.compound_resolver import resolve_compound

        reg = get_registry()
        op = reg.ops.get(w.op_id) if w.op_id else None
        if op is not None and op.compound is not None:
            if input.param_key == op.compound.driver:
                derived = resolve_compound(w, op, float(input.value))
                compound_node = node    # driver's node — bundle lives on the same node
                for bkey, bvalue in derived.items():
                    if compound_node is not None:
                        compound_node.params[bkey] = bvalue
                        doc.set_param(
                            compound_node.layer_id, compound_node.type, bkey, bvalue,
                        )
                    bbind = next((b for b in w.bindings if b.param_key == bkey), None)
                    if bbind is not None:
                        bbind.value = bvalue
            else:
                # Derived key edit → implicit lock.
                if input.param_key not in w.locked_params:
                    w.locked_params.append(input.param_key)
```

Remove the old `from app.tools.fused._time_of_day_data import interpolate_1d` import and the hardcoded `if w.op_id == "time-of-day":` branch.

- [ ] **Step 6: Run existing TOD tests to confirm no regression**

```bash
cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/tools/ tests/registry/ -v 2>&1 | tail -30
```
Expected: all PASS — existing `test_time_of_day_lock.py` (or wherever TOD's locking is tested) still passes because anchor VALUES are identical.

- [ ] **Step 7: Run full backend suite**

```bash
cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/registry/compound_resolver.py backend/tests/registry/test_compound_resolver.py backend/app/tools/widgets/set_widget_param.py
git commit -m "feat(registry): backend reads compound anchors from registry, drops hardcoded TOD"
```

---

## Task 5: Frontend reads anchors from registry

**Visible effect:** None at runtime — TOD UI still uses the bespoke `TimeOfDayWidgetBody` but its interpolation now sources anchors from the registry.

**Files:**
- Modify: `src/lib/perceptual-dial/interpolate.ts` — re-implement to use registry anchors OR redirect calls to the new shared library
- Modify: `src/components/workspace/TimeOfDayWidgetBody.tsx` — read anchors from registry instead of `src/processing/anchors/time-of-day-anchors.ts`
- (If `src/processing/anchors/time-of-day-anchors.ts` is now unreferenced, leave it for Task 7 to delete.)

- [ ] **Step 1: Read the current files**

```bash
grep -n "import\|TIME_OF_DAY\|interpolate" /Users/anton/Dev/Projects/editor/src/lib/perceptual-dial/interpolate.ts
grep -n "anchors\|TIME_OF_DAY" /Users/anton/Dev/Projects/editor/src/components/workspace/TimeOfDayWidgetBody.tsx | head -10
```

Identify where TOD anchors are imported and consumed.

- [ ] **Step 2: Redirect `src/lib/perceptual-dial/interpolate.ts` to the shared library**

If the existing `interpolate.ts` exports a function like `interpolate1d(t)` that consumes anchors imported from `src/processing/anchors/time-of-day-anchors.ts`, change it to a thin wrapper that reads the registry's TOD anchors:

```typescript
// src/lib/perceptual-dial/interpolate.ts
import { interpolate1D } from '../../../shared/registry/lib/interpolate-1d';
import { loadRegistry } from '../registry/loader';

/** TOD-specific wrapper that reads anchors from the registry. Kept for
 *  back-compat with the bespoke TOD UI; new compound widgets use
 *  `interpolate1D` directly with their own op's anchors. */
export function interpolateTOD(t: number): Record<string, number> {
  const reg = loadRegistry();
  const tod = reg.ops['time-of-day'];
  if (!tod?.compound) throw new Error('time-of-day op has no compound block');
  return interpolate1D(tod.compound.anchors, t);
}
```

Update the existing `interpolate.test.ts` if needed — its tests should still pass against the shared library.

- [ ] **Step 3: Update `TimeOfDayWidgetBody.tsx` to read from the registry**

In `TimeOfDayWidgetBody.tsx`, replace any import of `TIME_OF_DAY_ANCHORS` from `src/processing/anchors/time-of-day-anchors.ts` with:

```typescript
import { loadRegistry } from '@/lib/registry/loader';

// Inside the component body:
const todOp = loadRegistry().ops['time-of-day'];
const anchors = todOp?.compound?.anchors ?? [];
```

Replace any in-component `interpolate1d(...)` calls with `interpolate1D(anchors, t)` from the shared library.

- [ ] **Step 4: Run vitest**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/lib/perceptual-dial/interpolate.ts src/components/workspace/TimeOfDayWidgetBody.tsx
git commit -m "feat(registry): frontend reads compound anchors from registry"
```

---

## Task 6: Generic `CompoundWidgetBody` + `ToolSection.tsx` dispatch

**Visible effect:** A second code path that can render TOD via the generic component. The bespoke `TimeOfDayWidgetBody` still wins via dispatch precedence; the generic path is exercised by tests only.

**Files:**
- Create: `src/components/widget/CompoundWidgetBody.tsx`
- Create: `src/components/widget/compound/AnchorCard.tsx` (extracted from existing TOD primitives)
- Create: `src/components/widget/CompoundWidgetBody.test.tsx`
- Modify: `src/components/inspector/adjustments/ToolSection.tsx` — add dispatch branch

- [ ] **Step 1: Write failing component test**

Create `src/components/widget/CompoundWidgetBody.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { CompoundWidgetBody } from './CompoundWidgetBody';
import type { Widget } from '../../types/widget';

function makeTodWidget(): Widget {
  return {
    id: 'w', intent: 'golden hour',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'golden hour', parent_widget_id: null },
    op_id: 'time-of-day',
    composed: false,
    nodes: [{
      id: 'n', type: 'compound', op_id: 'time-of-day',
      params: { position: 0.55, 'kelvin.kelvin': 9600 },
    }] as unknown as Widget['nodes'],
    bindings: [
      { param_key: 'position', label: 'Time', control_type: 'slider',
        target: { node_id: 'n', param_key: 'position' },
        value: 0.55, default: 0.30,
        control_schema: { control_type: 'slider', min: 0, max: 1, step: 0.001 } },
    ] as unknown as Widget['bindings'],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [], status: 'active', revision: 1,
    display_name: 'Time of Day', category: 'tone',
    locked_params: [],
  };
}

describe('CompoundWidgetBody', () => {
  it('renders the driver slider and 5 anchor cards for time-of-day', () => {
    const { getByText, container } = render(
      <ReactFlowProvider>
        <CompoundWidgetBody widget={makeTodWidget()} disabled={false} />
      </ReactFlowProvider>,
    );
    expect(getByText('Time')).toBeTruthy();          // driver label
    expect(getByText('dawn')).toBeTruthy();          // anchor name
    expect(getByText('night')).toBeTruthy();
    // 5 anchor cards
    expect(container.querySelectorAll('[data-anchor-card]').length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/components/widget/CompoundWidgetBody.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Extract AnchorCard primitive**

Open `src/components/workspace/TimeOfDayWidgetBody.tsx`. Find the anchor card rendering (the small per-anchor card UI). Extract it into `src/components/widget/compound/AnchorCard.tsx`:

```typescript
// src/components/widget/compound/AnchorCard.tsx
import type { CompoundAnchor } from '../../../../shared/registry/schema';

interface Props {
  anchor: CompoundAnchor;
  isActive: boolean;          // true when current position is near this anchor
  lockedKeys: Set<string>;    // shows lock indicator on those keys
  // Plus any onClick / per-key edit callbacks used by TOD today
}

export function AnchorCard(props: Props): JSX.Element {
  const { anchor, isActive, lockedKeys } = props;
  return (
    <div data-anchor-card className={isActive ? 'anchor-card active' : 'anchor-card'}>
      <div className="anchor-card-name">{anchor.name}</div>
      {/* Per-key value list with lock indicators — copy current TOD UI structure */}
      {Object.entries(anchor.values).map(([k, v]) => (
        <div key={k} className="anchor-card-value">
          <span>{k}</span>
          <span>{v}</span>
          {lockedKeys.has(k) && <span className="lock-icon">🔒</span>}
        </div>
      ))}
    </div>
  );
}
```

(Match the styling and behavior of the existing TOD anchor cards. Reuse design tokens.)

- [ ] **Step 4: Create CompoundWidgetBody**

Create `src/components/widget/CompoundWidgetBody.tsx`:

```typescript
import { loadRegistry } from '../../lib/registry/loader';
import { interpolate1D } from '../../../shared/registry/lib/interpolate-1d';
import { Slider } from '../registry-controls/Slider';
import { AnchorCard } from './compound/AnchorCard';
import type { Widget } from '../../types/widget';

interface Props {
  widget: Widget;
  disabled?: boolean;
}

export function CompoundWidgetBody({ widget, disabled }: Props): JSX.Element | null {
  const op = loadRegistry().ops[widget.op_id ?? ''];
  if (!op?.compound) return null;     // ToolSection should not have dispatched here

  const driverKey = op.compound.driver;
  const driverBinding = widget.bindings.find(b => b.param_key === driverKey);
  if (!driverBinding) return null;

  const position = driverBinding.value as number;
  const lockedKeys = new Set(widget.locked_params ?? []);

  // Find the nearest anchor (within snap threshold) to highlight as active.
  const SNAP = 0.02;
  const activeIdx = op.compound.anchors.findIndex(
    a => Math.abs(a.position - position) <= SNAP,
  );

  return (
    <div className="compound-widget-body">
      <Slider
        paramKey={driverKey}
        label={driverBinding.label}
        value={position}
        schema={op.params[driverKey]}
        onChange={(next) => {
          // Plumb through to set_widget_param via the existing dispatch the
          // bespoke TOD used. For now, expect the parent ToolSectionBody to
          // provide a setParam callback via context or props.
          // TODO during Task 7: wire to the store-connected dispatch.
        }}
        disabled={disabled}
      />
      <div className="anchor-card-row">
        {op.compound.anchors.map((a, i) => (
          <AnchorCard
            key={a.name}
            anchor={a}
            isActive={i === activeIdx}
            lockedKeys={lockedKeys}
          />
        ))}
      </div>
      {/* TOD-style per-key sliders for derived params (locked indicators) */}
      {/* Reuse the existing TOD per-key edit UI shape from TimeOfDayWidgetBody */}
    </div>
  );
}
```

(The `TODO` in the `onChange` callback is acceptable for Task 6 because the wire-up happens in Task 7 when the bespoke path retires. For now, the test only renders the body — it doesn't fire onChange.)

- [ ] **Step 5: Run component test**

Run: `npx vitest run src/components/widget/CompoundWidgetBody.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire `ToolSection.tsx` dispatch**

Find the section in `src/components/inspector/adjustments/ToolSection.tsx` where it decides which body component to render. Add a NEW branch that dispatches to `CompoundWidgetBody` when the registry op has a `compound` block, BUT only when `def.id` is NOT already handled by a bespoke branch (so existing TOD bespoke wins until Task 7):

```typescript
import { loadRegistry } from '../../../lib/registry/loader';
import { CompoundWidgetBody } from '../../widget/CompoundWidgetBody';

// In the dispatch logic, AFTER the existing bespoke branches (curves, hsl,
// levels, lut, time-of-day) but BEFORE RegistryDrivenSectionBody:

const op = loadRegistry().ops[def.id];
if (op?.compound) {
  return <CompoundWidgetBody widget={widget} disabled={disabled} />;
}
```

Because the bespoke time-of-day branch precedes this in the dispatch chain, real TOD widgets still go to `TimeOfDayWidgetBody`. The new dispatch only fires for future compound ops or in tests.

- [ ] **Step 7: Run all tests + tsc**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/CompoundWidgetBody.tsx src/components/widget/compound/ src/components/widget/CompoundWidgetBody.test.tsx src/components/inspector/adjustments/ToolSection.tsx
git commit -m "feat(widget): generic CompoundWidgetBody + ToolSection dispatch"
```

---

## Task 7: Retire bespoke TOD code

**Visible effect:** TOD widgets now render via `CompoundWidgetBody`. Identical UI for the user. ~600 lines of bespoke code retire.

**Files (deleted):**
- `backend/app/tools/fused/time_of_day.py`
- `backend/app/tools/fused/_time_of_day_data.py`
- `src/processing/time-of-day.tsx`
- `src/processing/anchors/time-of-day-anchors.ts` (if it exists)
- `src/components/workspace/TimeOfDayWidgetBody.tsx`
- `src/components/workspace/TimeOfDayWidgetBody.test.tsx`
- Possibly: `src/lib/perceptual-dial/interpolate.ts` and `interpolate.test.ts` IF no other consumer (verify with grep)

**Files modified:**
- `src/components/inspector/adjustments/ToolSection.tsx` — remove the `'time-of-day'` special-case branch
- `backend/app/tools/widgets/set_widget_param.py` — verify the hardcoded TOD branch is fully gone (should be — Task 4 removed it)
- `backend/app/tools/fused/__init__.py` — remove the import that re-exports `TimeOfDayTemplate` (if any)
- Wire the `onChange` callback in `CompoundWidgetBody` to dispatch through the store-connected path (the TODO from Task 6)

- [ ] **Step 1: Verify the bespoke TOD test exists and will be removed**

```bash
grep -l "TimeOfDay\|time-of-day" /Users/anton/Dev/Projects/editor/backend/tests/tools/ /Users/anton/Dev/Projects/editor/src/components/workspace/ 2>/dev/null
```

Inventory the tests that will be deleted or retargeted.

- [ ] **Step 2: Wire CompoundWidgetBody's onChange callback**

Open `src/components/widget/CompoundWidgetBody.tsx`. Replace the `// TODO` onChange handler with a working store-connected dispatch. Look at how `RegistryDrivenSectionBody.tsx` plumbs `onParamChange` through the store — mirror that approach. Pseudocode:

```typescript
import { useBackendState } from '../../store/backend-state-slice';
import { useShallow } from 'zustand/react/shallow';

// Inside CompoundWidgetBody:
const setParam = useBackendState((s) => s.setParam);   // or equivalent action
const onChange = (paramKey: string, value: unknown) => {
  setParam(widget.id, paramKey, value);   // adapt to actual action signature
};

// Pass onChange to <Slider> for the driver AND to per-key controls for the derived params.
```

(Match the existing `RegistryDrivenSectionBody` plumbing — same dispatch shape, same optimistic patch pattern.)

- [ ] **Step 3: Remove the bespoke `'time-of-day'` dispatch from ToolSection.tsx**

In `src/components/inspector/adjustments/ToolSection.tsx`, find the special-case branch that returns `<TimeOfDayWidgetBody>` for `def.id === 'time-of-day'` (or `adjustmentType === 'compound'` — whatever the current dispatch key is). Delete that branch. Now `loadRegistry().ops['time-of-day'].compound` triggers `CompoundWidgetBody`.

- [ ] **Step 4: Delete the bespoke files**

```bash
cd /Users/anton/Dev/Projects/editor && \
  git rm backend/app/tools/fused/time_of_day.py \
         backend/app/tools/fused/_time_of_day_data.py \
         src/processing/time-of-day.tsx \
         src/components/workspace/TimeOfDayWidgetBody.tsx \
         src/components/workspace/TimeOfDayWidgetBody.test.tsx
```

If `src/processing/anchors/time-of-day-anchors.ts` exists (verify with `ls`), delete it too.

Verify `src/lib/perceptual-dial/interpolate.ts` is still consumed:

```bash
grep -rn "interpolateTOD\|perceptual-dial/interpolate" /Users/anton/Dev/Projects/editor/src --include="*.ts" --include="*.tsx"
```

If the only consumer was `TimeOfDayWidgetBody` (now deleted), delete `interpolate.ts` and `interpolate.test.ts` too.

- [ ] **Step 5: Remove `TimeOfDayTemplate` from fused/__init__.py if still imported**

```bash
grep -n "time_of_day\|TimeOfDayTemplate" /Users/anton/Dev/Projects/editor/backend/app/tools/fused/__init__.py
```

If the file still imports `TimeOfDayTemplate`, remove the import + the `all_fused_templates` registration. The fused/ directory continues to exist (other tools still use it per earlier notes), just without TOD.

- [ ] **Step 6: Run all tests + tsc**

```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

If any backend test fails because it imported from `app.tools.fused.time_of_day` or `app.tools.fused._time_of_day_data`, update those tests to use the registry instead — those modules are gone.

- [ ] **Step 7: Manual smoke test (optional but recommended)**

If you can run the dev server:
1. Cmd+K → "make it golden hour"
2. Expect a TOD widget at position ~0.55 with the anchor cards visible
3. Drag the time slider — derived sliders should update via interpolation
4. Manually edit an exposure value — lock indicator appears
5. Drag the time slider again — exposure stays at the manually-set value (locked)

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add -A
git commit -m "$(cat <<'EOF'
refactor(widget): retire bespoke time-of-day code in favor of compound framework

TOD widgets now render via the generic CompoundWidgetBody. Same anchor
data (registry JSON), same Catmull-Rom math (shared library), same
lock-on-edit semantics. Deletes ~600 lines of bespoke code.

Future compound ops add a JSON file with a `compound` block — no
bespoke Python, no bespoke React component required.
EOF
)"
```

---

## Definition of Done

After Task 7:

- Time-of-Day widget renders via `CompoundWidgetBody`, reading anchors from `shared/registry/ops/time-of-day.json`.
- Cmd+K "make it golden hour" produces a TOD widget at position ~0.55.
- Dial drag interpolates derived params via Catmull-Rom; lock-on-edit still sticks.
- No file under `backend/app/tools/fused/time_of_day*` exists.
- No file under `src/processing/anchors/time-of-day*` exists.
- No `TimeOfDayWidgetBody` exists.
- Adding a new compound op = one JSON file with a `compound` block.
- Backend tests: ≥471 passing.
- Frontend tests: ≥575 passing.
- `npx tsc --noEmit` clean.
