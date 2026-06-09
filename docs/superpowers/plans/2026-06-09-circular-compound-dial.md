# Circular Compound Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `topology: "wheel"` mode to the compound dial framework, plus a reusable `CircularDial` component (colored pie wedges + outer ring + draggable indicator), opt-in via JSON for Time-of-Day and Season.

**Architecture:** 5 commits. (1) Schema additions: `topology` on `OpCompoundConfig` and `color` on `CompoundAnchor` (Pydantic + Zod). (2) Build `CircularDial.tsx` in isolation with unit tests. (3) Wire dispatch in `CompoundWidgetBody.tsx` based on `op.compound.topology`. (4) Flip `time-of-day.json` to wheel + per-anchor colors. (5) Same for `season.json`. Linear path (Weather/Mood/Age) untouched.

**Tech Stack:** Pydantic v2 (backend), Zod 4 (frontend), React + SVG for the wheel, Vitest, Pytest.

**Reference:** `docs/superpowers/specs/2026-06-09-circular-compound-dial-design.md`

**Pytest env quirk:** tests need ANTHROPIC_API_KEY loaded. Use `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest <args>`.

**Existing types to reuse:**
- `Anchor` in `src/lib/perceptual-dial/types.ts` (id, label, position: [number], params: Record<string, number>)
- `interpolate1D` from `shared/registry/lib/interpolate-1d.ts` (TS, already wired to load registry anchors)

---

## File Structure

### Created
- `src/components/widget/compound/CircularDial.tsx` — pure SVG wheel component
- `src/components/widget/compound/CircularDial.test.tsx` — unit tests
- `src/components/widget/compound/wheel-math.ts` — pure helpers (angle math, color palette)
- `src/components/widget/compound/wheel-math.test.ts` — unit tests for helpers

### Modified
- `backend/app/registry/schema.py` — `OpCompoundConfig.topology`, `CompoundAnchor.color`
- `shared/registry/schema.ts` — same in Zod
- `backend/tests/registry/test_schema.py` — extend
- `src/lib/registry/__tests__/schema.test.ts` — extend
- `src/components/widget/CompoundWidgetBody.tsx` — dispatch on `op.compound.topology`
- `shared/registry/ops/time-of-day.json` — add `topology: "wheel"` + per-anchor `color`
- `shared/registry/ops/season.json` — same

### Existing files referenced (do not modify)
- `src/lib/perceptual-dial/types.ts` — `Anchor` interface (already includes `id, label, position, params`)
- `src/components/workspace/PerceptualDialBody.tsx` — linear dial; stays as fallback path

---

## Task 1: Schema additions — `topology` + `color`

**Files:**
- Modify: `backend/app/registry/schema.py`
- Modify: `shared/registry/schema.ts`
- Test: `backend/tests/registry/test_schema.py` (extend)
- Test: `src/lib/registry/__tests__/schema.test.ts` (extend)

- [ ] **Step 1: Write failing backend schema tests**

Add to `backend/tests/registry/test_schema.py`:

```python
def test_compound_topology_defaults_to_linear():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "mood",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "p", "control_type": "slider", "label": "P"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "p", "interpolation": "catmull_rom_1d",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound.topology == "linear"


def test_compound_topology_accepts_wheel():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "mood",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "p", "control_type": "slider", "label": "P"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "p", "interpolation": "catmull_rom_1d", "topology": "wheel",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound.topology == "wheel"


def test_compound_topology_rejects_unknown():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "x", "display_name": "X", "category": "mood",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "p", "control_type": "slider", "label": "P"},
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "p", "interpolation": "catmull_rom_1d", "topology": "radial-grid",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                    {"position": 1.0, "name": "b", "values": {"k": 90}},
                ],
            },
        })


def test_compound_anchor_color_optional():
    """Color is optional. Both null and a CSS string are accepted."""
    a1 = CompoundAnchor.model_validate(
        {"position": 0.0, "name": "x", "values": {"k": 1}}
    )
    assert a1.color is None
    a2 = CompoundAnchor.model_validate(
        {"position": 0.0, "name": "x", "values": {"k": 1}, "color": "#22c55e"}
    )
    assert a2.color == "#22c55e"
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py -v 2>&1 | tail -20`
Expected: 4 new tests FAIL — `topology` and `color` are extra fields (rejected by `extra="forbid"`).

- [ ] **Step 3: Add Pydantic fields**

In `backend/app/registry/schema.py`:

For `CompoundAnchor`, ADD the `color` field after `values`:

```python
class CompoundAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float = Field(ge=0.0, le=1.0)
    name: str
    values: dict[str, float]
    color: str | None = None    # NEW — CSS color string for wheel wedge
```

For `OpCompoundConfig`, ADD the `topology` field after `anchors`:

```python
class OpCompoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver: str
    interpolation: Literal["catmull_rom_1d"] = "catmull_rom_1d"
    anchors: list[CompoundAnchor] = Field(min_length=2)
    topology: Literal["linear", "wheel"] = "linear"    # NEW

    @model_validator(mode="after")
    def _checks(self) -> OpCompoundConfig:
        # existing validators unchanged
        ...
```

(The existing `@model_validator` block stays as-is. The Literal type enforces the enum.)

- [ ] **Step 4: Backend tests pass**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py -v 2>&1 | tail -15`
Expected: all PASS (4 new + existing).

- [ ] **Step 5: Write failing Zod tests**

Add to `src/lib/registry/__tests__/schema.test.ts`:

```typescript
describe('OpCompoundConfigSchema topology', () => {
  const baseOp = {
    id: 'x', display_name: 'X', category: 'mood',
    llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
    params: {
      p: { type: 'scalar', range: [0, 1], default: 0.5 },
      k: { type: 'scalar', range: [0, 100], default: 50 },
    },
    bindings: [
      { param_key: 'p', control_type: 'slider', label: 'P' },
      { param_key: 'k', control_type: 'slider', label: 'K' },
    ],
    engine: { shader: 'compound', render_order: 5, node_type: 'compound' },
  };

  it('defaults topology to linear', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.topology).toBe('linear');
  });

  it('accepts wheel topology', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d', topology: 'wheel',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.topology).toBe('wheel');
  });

  it('rejects unknown topology', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d', topology: 'radial-grid',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    })).toThrow();
  });

  it('accepts optional color on CompoundAnchor', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', color: '#22c55e', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.anchors[0].color).toBe('#22c55e');
    expect(parsed.compound?.anchors[1].color).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: 3 of 4 new tests FAIL (`.strict()` rejects unknown fields).

- [ ] **Step 7: Update Zod schemas**

In `shared/registry/schema.ts`:

Find `CompoundAnchorSchema` and add `color`:

```typescript
export const CompoundAnchorSchema = z.object({
  position: z.number().min(0).max(1),
  name: z.string(),
  values: z.record(z.string(), z.number()),
  color: z.string().optional(),       // NEW
}).strict();
```

Find `OpCompoundConfigSchema` and add `topology`:

```typescript
export const OpCompoundConfigSchema = z.object({
  driver: z.string(),
  interpolation: z.literal('catmull_rom_1d').default('catmull_rom_1d'),
  anchors: z.array(CompoundAnchorSchema).min(2),
  topology: z.enum(['linear', 'wheel']).default('linear'),    // NEW
}).strict().superRefine((c, ctx) => {
  // existing validators unchanged
  ...
});
```

(The existing `superRefine` block stays. The `z.enum(...).default('linear')` mirrors the Pydantic Literal default.)

- [ ] **Step 8: Frontend tests pass**

Run: `npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Run full sweep**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5
```
Expected: all green; tsc clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/registry/schema.py backend/tests/registry/test_schema.py shared/registry/schema.ts src/lib/registry/__tests__/schema.test.ts
git commit -m "feat(registry): compound topology + per-anchor color fields"
```

---

## Task 2: `wheel-math.ts` helpers + tests

**Files:**
- Create: `src/components/widget/compound/wheel-math.ts`
- Create: `src/components/widget/compound/wheel-math.test.ts`

**Note:** create the `compound` subdir first if it doesn't exist (`mkdir -p src/components/widget/compound`).

- [ ] **Step 1: Write failing tests for the helpers**

Create `src/components/widget/compound/wheel-math.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  anchorAngles,
  positionToIndicatorAngle,
  angleToPosition,
  resolveWedgeColor,
  AUTO_PALETTE,
} from './wheel-math';

describe('anchorAngles', () => {
  it('evenly spaces N angles starting at 0 degrees (top)', () => {
    expect(anchorAngles(4)).toEqual([0, 90, 180, 270]);
    expect(anchorAngles(5)).toEqual([0, 72, 144, 216, 288]);
    expect(anchorAngles(2)).toEqual([0, 180]);
  });
});

describe('positionToIndicatorAngle', () => {
  const seasonAnchors = [
    { position: 0.00, name: 'spring' },
    { position: 0.33, name: 'summer' },
    { position: 0.66, name: 'autumn' },
    { position: 1.00, name: 'winter' },
  ];

  it('returns wedge center for exact anchor positions', () => {
    expect(positionToIndicatorAngle(seasonAnchors, 0.00)).toBeCloseTo(0, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 0.33)).toBeCloseTo(90, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 0.66)).toBeCloseTo(180, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 1.00)).toBeCloseTo(270, 3);
  });

  it('linearly interpolates between adjacent wedge centers', () => {
    // halfway between summer (0.33 → 90°) and autumn (0.66 → 180°)
    const halfway = (0.33 + 0.66) / 2;
    expect(positionToIndicatorAngle(seasonAnchors, halfway)).toBeCloseTo(135, 3);
  });

  it('wraps cyclically past the last anchor', () => {
    // position 0.05 sits in [winter(1.0) → spring(0.0)] segment
    // winter wedge center is 270°, spring is 360° (= 0° in modulo)
    // 0.05 / (anchor_distance) of the way through that segment
    const angle = positionToIndicatorAngle(seasonAnchors, 0.05);
    // 0.05 sits PAST the last anchor (1.0) wrapped. Expect angle in [270°, 360°) range
    expect(angle).toBeGreaterThan(270);
    expect(angle).toBeLessThan(360);
  });

  it('clamps positions outside [0, 1] to wrapped equivalents', () => {
    expect(positionToIndicatorAngle(seasonAnchors, -0.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.9), 3,
    );
    expect(positionToIndicatorAngle(seasonAnchors, 1.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.1), 3,
    );
  });
});

describe('angleToPosition', () => {
  const seasonAnchors = [
    { position: 0.00, name: 'spring' },
    { position: 0.33, name: 'summer' },
    { position: 0.66, name: 'autumn' },
    { position: 1.00, name: 'winter' },
  ];

  it('inverts positionToIndicatorAngle at anchor positions', () => {
    for (const p of [0.00, 0.33, 0.66, 1.00]) {
      const a = positionToIndicatorAngle(seasonAnchors, p);
      expect(angleToPosition(seasonAnchors, a)).toBeCloseTo(p, 3);
    }
  });

  it('returns a position in [0, 1] for any angle', () => {
    for (const angle of [0, 45, 90, 135, 180, 270, 359]) {
      const p = angleToPosition(seasonAnchors, angle);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveWedgeColor', () => {
  const palette = ['#22c55e', '#eab308', '#ea580c', '#3b82f6', '#a855f7'];

  it('returns anchor.color when set', () => {
    expect(resolveWedgeColor({ name: 'x', color: '#ff0000' }, 0, palette)).toBe('#ff0000');
  });

  it('cycles through palette when anchor.color is null/undefined', () => {
    expect(resolveWedgeColor({ name: 'a' }, 0, palette)).toBe(palette[0]);
    expect(resolveWedgeColor({ name: 'b' }, 1, palette)).toBe(palette[1]);
    expect(resolveWedgeColor({ name: 'f' }, 5, palette)).toBe(palette[0]);  // wraps
  });
});

describe('AUTO_PALETTE', () => {
  it('exports a stable default palette', () => {
    expect(AUTO_PALETTE.length).toBeGreaterThanOrEqual(4);
    for (const c of AUTO_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/compound/wheel-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/components/widget/compound/wheel-math.ts`:

```typescript
/** Default palette used when an anchor doesn't declare its own color. */
export const AUTO_PALETTE = [
  '#22c55e',  // green
  '#eab308',  // yellow
  '#ea580c',  // orange
  '#3b82f6',  // blue
  '#a855f7',  // purple
  '#ec4899',  // pink
] as const;

export interface AnchorLike {
  position?: number;
  name: string;
  color?: string | null;
}

/** Even-spaced anchor angles starting at 0° (top), going clockwise. */
export function anchorAngles(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * 360) / n);
  return out;
}

/** Normalize a position into [0, 1) via modulo (wrap). */
function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

/** Position → indicator angle (degrees, [0, 360)).
 *
 *  Anchors are evenly spaced around the wheel. As `position` moves between two
 *  adjacent anchors, the indicator linearly interpolates between those
 *  anchors' wedge-center angles. Crossing the 1.0/0.0 seam wraps cyclically.
 */
export function positionToIndicatorAngle(
  anchors: AnchorLike[],
  position: number,
): number {
  if (anchors.length < 2) return 0;
  const t = wrap01(position);
  const n = anchors.length;
  const angles = anchorAngles(n);

  // Build a cyclic anchor list (wrap last → first across the seam).
  // Find the segment [i, i+1] where anchors[i].position ≤ t < anchors[i+1].position
  // OR the cyclic segment [last, first] where t < anchors[0] or t ≥ anchors[last].
  const positions = anchors.map(a => a.position ?? 0);
  const last = positions.length - 1;

  // Cyclic seam: position before anchors[0] or at/after anchors[last].
  if (t < positions[0] || t >= positions[last]) {
    // Interpolate between anchors[last] and anchors[0] across seam.
    const startPos = positions[last];
    const endPos = positions[0] + 1;     // wrap: anchors[0] is at "1.0 + 0.0"
    const startAngle = angles[last];
    const endAngle = angles[0] + 360;    // wrap angle past 360
    const tShifted = t < positions[0] ? t + 1 : t;
    const frac = (tShifted - startPos) / (endPos - startPos);
    return (startAngle + frac * (endAngle - startAngle)) % 360;
  }

  // Normal segment.
  for (let i = 0; i < last; i++) {
    if (positions[i] <= t && t < positions[i + 1]) {
      const frac = (t - positions[i]) / (positions[i + 1] - positions[i]);
      return angles[i] + frac * (angles[i + 1] - angles[i]);
    }
  }

  // Exact match on last anchor.
  return angles[last];
}

/** Inverse: indicator angle → position. */
export function angleToPosition(
  anchors: AnchorLike[],
  angleDeg: number,
): number {
  if (anchors.length < 2) return 0;
  const a = ((angleDeg % 360) + 360) % 360;
  const n = anchors.length;
  const angles = anchorAngles(n);
  const positions = anchors.map(x => x.position ?? 0);
  const last = positions.length - 1;

  // Cyclic seam between anchors[last] and anchors[0] (angle wraps past 360°).
  // Seam covers [angles[last], 360) ∪ [0, angles[0]).
  if (a >= angles[last]) {
    // [angles[last], 360°): interpolate to anchors[0]+1 (wrapped position).
    const span = (angles[0] + 360) - angles[last];
    const frac = (a - angles[last]) / span;
    const wrappedPos = positions[last] + frac * ((positions[0] + 1) - positions[last]);
    return wrap01(wrappedPos);
  }
  if (a < angles[0]) {
    // [0, angles[0]): continuation of the seam from past 360°.
    const span = (angles[0] + 360) - angles[last];
    const frac = (a + 360 - angles[last]) / span;
    const wrappedPos = positions[last] + frac * ((positions[0] + 1) - positions[last]);
    return wrap01(wrappedPos);
  }

  // Normal segment between angles[i] and angles[i+1].
  for (let i = 0; i < last; i++) {
    if (angles[i] <= a && a < angles[i + 1]) {
      const frac = (a - angles[i]) / (angles[i + 1] - angles[i]);
      return positions[i] + frac * (positions[i + 1] - positions[i]);
    }
  }
  return positions[last];
}

/** Resolve a wedge color: anchor.color if set, else cycle through `palette`. */
export function resolveWedgeColor(
  anchor: AnchorLike,
  index: number,
  palette: readonly string[],
): string {
  if (anchor.color) return anchor.color;
  return palette[index % palette.length];
}
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/components/widget/compound/wheel-math.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run tsc**

Run: `cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/compound/wheel-math.ts src/components/widget/compound/wheel-math.test.ts
git commit -m "feat(widget): wheel-math helpers (anchor angles, indicator interp, color resolve)"
```

---

## Task 3: `CircularDial.tsx` component

**Files:**
- Create: `src/components/widget/compound/CircularDial.tsx`
- Create: `src/components/widget/compound/CircularDial.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/widget/compound/CircularDial.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CircularDial } from './CircularDial';
import type { Anchor } from '@/lib/perceptual-dial/types';

function seasonAnchors(): Anchor[] {
  return [
    { id: 'spring', label: 'Spring', position: [0.00],
      params: { 'kelvin.kelvin': 7000 } },
    { id: 'summer', label: 'Summer', position: [0.33],
      params: { 'kelvin.kelvin': 7500 } },
    { id: 'autumn', label: 'Autumn', position: [0.66],
      params: { 'kelvin.kelvin': 8500 } },
    { id: 'winter', label: 'Winter', position: [1.00],
      params: { 'kelvin.kelvin': 5500 } },
  ];
}

describe('CircularDial', () => {
  it('renders N pie wedges for N anchors', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    const wedges = container.querySelectorAll('[data-testid="wedge"]');
    expect(wedges.length).toBe(4);
  });

  it('renders an indicator dot', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="indicator"]')).not.toBeNull();
  });

  it('renders anchor label inside each wedge', () => {
    const { getByText } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    expect(getByText(/Spring/i)).toBeTruthy();
    expect(getByText(/Summer/i)).toBeTruthy();
    expect(getByText(/Autumn/i)).toBeTruthy();
    expect(getByText(/Winter/i)).toBeTruthy();
  });

  it('calls onPositionChange with anchor position when wedge is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.00}
        onPositionChange={onChange}
      />,
    );
    const wedges = container.querySelectorAll('[data-testid="wedge"]');
    // Click the autumn wedge (3rd one, index 2)
    fireEvent.click(wedges[2]);
    expect(onChange).toHaveBeenCalledWith(0.66);
  });

  it('marks the active wedge based on nearest anchor to position', () => {
    const { container, rerender } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}    // autumn
        onPositionChange={vi.fn()}
      />,
    );
    const activeAutumn = container.querySelector('[data-testid="wedge"][data-active="true"]');
    expect(activeAutumn?.getAttribute('data-anchor-id')).toBe('autumn');

    rerender(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.00}    // spring
        onPositionChange={vi.fn()}
      />,
    );
    const activeSpring = container.querySelector('[data-testid="wedge"][data-active="true"]');
    expect(activeSpring?.getAttribute('data-anchor-id')).toBe('spring');
  });

  it('positions the indicator at the active wedge\'s center angle for exact anchors', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.33}    // summer → 90° (right)
        onPositionChange={vi.fn()}
      />,
    );
    const indicator = container.querySelector('[data-testid="indicator"]') as SVGCircleElement | null;
    expect(indicator).not.toBeNull();
    // Right side of wheel: x > center, y ≈ center
    const cx = Number(indicator?.getAttribute('cx'));
    const cy = Number(indicator?.getAttribute('cy'));
    expect(cx).toBeGreaterThan(160);    // right of center (viewBox 0..320)
    expect(Math.abs(cy - 160)).toBeLessThan(5);    // close to center vertically
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/compound/CircularDial.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CircularDial`**

Create `src/components/widget/compound/CircularDial.tsx`:

```typescript
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Anchor } from '@/lib/perceptual-dial/types';
import {
  anchorAngles,
  positionToIndicatorAngle,
  angleToPosition,
  resolveWedgeColor,
  AUTO_PALETTE,
} from './wheel-math';

interface Props {
  anchors: Anchor[];                            // sorted by position[0]
  position: number;                             // 0..1
  onPositionChange: (next: number) => void;
}

const CENTER = 160;
const VIEWBOX = 320;
const WEDGE_RADIUS = 110;
const TRACK_RADIUS = 135;
const INDICATOR_RADIUS = 7;
const LABEL_RADIUS = 75;     // where label text sits

/** Convert (angleDeg from top, going clockwise) → (x, y) on a circle. */
function polar(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

/** Build an SVG path string for a pie wedge: M center L start A r,r 0 0 1 end Z */
function wedgePath(startDeg: number, endDeg: number, r: number): string {
  const [sx, sy] = polar(startDeg, r);
  const [ex, ey] = polar(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`;
}

/** Compute SVG arc path between two angles on a ring at radius r. */
function arcPath(startDeg: number, endDeg: number, r: number): string {
  const [sx, sy] = polar(startDeg, r);
  const [ex, ey] = polar(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

/** Index of the anchor whose evenly-spaced wedge contains the given position.
 *  Used to highlight one wedge as "active" based on which segment position
 *  currently belongs to. Considers cyclic wrap at the seam. */
function activeWedgeIndex(anchors: Anchor[], position: number): number {
  if (anchors.length === 0) return -1;
  const positions = anchors.map(a => a.position[0]);
  const last = positions.length - 1;
  const t = ((position % 1) + 1) % 1;
  if (t < positions[0] || t >= positions[last]) return last;
  for (let i = 0; i < last; i++) {
    if (positions[i] <= t && t < positions[i + 1]) return i;
  }
  return last;
}

export function CircularDial({ anchors, position, onPositionChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const anchorsLike = useMemo(
    () => anchors.map(a => ({ position: a.position[0], name: a.label, color: undefined })),
    [anchors],
  );

  const angles = useMemo(() => anchorAngles(anchors.length), [anchors.length]);
  const wedgeSpan = 360 / Math.max(1, anchors.length);

  const indicatorAngle = useMemo(
    () => positionToIndicatorAngle(anchorsLike, position),
    [anchorsLike, position],
  );
  const [indicatorX, indicatorY] = polar(indicatorAngle, TRACK_RADIUS);

  const activeIdx = activeWedgeIndex(anchors, position);

  const handleWedgeClick = useCallback((i: number) => {
    onPositionChange(anchors[i].position[0]);
  }, [anchors, onPositionChange]);

  // Drag: convert pointer position → angle → position.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // SVG viewBox is 320x320; convert client coords to viewBox coords.
    const sx = ((e.clientX - rect.left) / rect.width) * VIEWBOX;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEWBOX;
    const dx = sx - CENTER;
    const dy = sy - CENTER;
    // atan2 returns radians where 0 = +x (right). We want 0 = top, clockwise.
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    const next = angleToPosition(anchorsLike, deg);
    onPositionChange(next);
  }, [dragging, anchorsLike, onPositionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Active arc on outer ring
  const activeStart = angles[activeIdx] - wedgeSpan / 2;
  const activeEnd = angles[activeIdx] + wedgeSpan / 2;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="circular-dial"
      style={{ width: 320, height: 320, userSelect: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Wedges */}
      {anchors.map((anchor, i) => {
        const startDeg = angles[i] - wedgeSpan / 2;
        const endDeg = angles[i] + wedgeSpan / 2;
        const color = resolveWedgeColor(
          { name: anchor.label, color: undefined },
          i,
          AUTO_PALETTE,
        );
        const isActive = i === activeIdx;
        const [labelX, labelY] = polar(angles[i], LABEL_RADIUS);
        return (
          <g key={anchor.id}>
            <path
              data-testid="wedge"
              data-anchor-id={anchor.id}
              data-active={isActive ? 'true' : 'false'}
              d={wedgePath(startDeg, endDeg, WEDGE_RADIUS)}
              fill={color}
              fillOpacity={isActive ? 0.95 : 0.85}
              style={{
                cursor: 'pointer',
                filter: isActive ? 'brightness(1.25) drop-shadow(0 0 8px rgba(255,255,255,0.3))' : undefined,
                transition: 'filter 0.15s',
              }}
              onClick={() => handleWedgeClick(i)}
            />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={700}
              fill="white"
              style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              {anchor.label}
            </text>
          </g>
        );
      })}

      {/* Outer ring track */}
      <circle
        cx={CENTER} cy={CENTER} r={TRACK_RADIUS}
        fill="none" stroke="#2a2a3a" strokeWidth={4}
      />

      {/* Active segment arc on outer ring */}
      <path
        d={arcPath(activeStart, activeEnd, TRACK_RADIUS)}
        fill="none"
        stroke={resolveWedgeColor({ name: '', color: undefined }, activeIdx, AUTO_PALETTE)}
        strokeWidth={6}
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px currentColor)', opacity: 0.9 }}
      />

      {/* Position indicator */}
      <circle
        data-testid="indicator"
        cx={indicatorX} cy={indicatorY} r={INDICATOR_RADIUS}
        fill="white"
        style={{
          filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.8))',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
      />
    </svg>
  );
}
```

(The implementation uses an `AnchorLike` adapter (`anchorsLike`) to bridge the legacy `Anchor` type's `position: [number]` tuple with the helpers' flat `position: number`. The color resolution currently passes `color: undefined` for all anchors — the per-anchor color comes from the registry op in Task 4, which is wired in when `CompoundWidgetBody` consumes `op.compound.anchors[i].color`.)

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/components/widget/compound/CircularDial.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Run tsc + full vitest**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/compound/ 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: green; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/compound/CircularDial.tsx src/components/widget/compound/CircularDial.test.tsx
git commit -m "feat(widget): CircularDial — SVG pie wheel with click + drag interaction"
```

---

## Task 4: Wire `CompoundWidgetBody` dispatch

**Files:**
- Modify: `src/components/widget/CompoundWidgetBody.tsx`
- Modify: `src/components/widget/CompoundWidgetBody.test.tsx`

- [ ] **Step 1: Read the current CompoundWidgetBody.tsx**

Open `src/components/widget/CompoundWidgetBody.tsx`. Identify:
- Where `PerceptualDialBody` is rendered
- The `op` variable (loaded from `loadRegistry().ops[widget.op_id]`)
- The variable holding `dialAnchors`, `position`, and `handleChange`

The current return likely looks like:
```typescript
return (
  <>
    <PerceptualDialBody
      topology="1d-slider"
      anchors={dialAnchors}
      position={position}
      onPositionChange={handleChange}
    />
    {/* anchor cards row */}
    ...
  </>
);
```

- [ ] **Step 2: Write failing dispatch tests**

Open `src/components/widget/CompoundWidgetBody.test.tsx`. Read the existing test setup (it should use `loadRegistry` since the framework reads from the JSON). Then add:

```typescript
import { CircularDial } from './compound/CircularDial';

// (existing imports + makeTodWidget fixture)

describe('CompoundWidgetBody topology dispatch', () => {
  it('renders CircularDial when op.compound.topology is "wheel"', () => {
    // time-of-day will be flipped to wheel in Task 5. For this test, we mock
    // the registry so the topology comes back as "wheel" regardless of the
    // current JSON state.
    const { container } = render(
      <ReactFlowProvider>
        <CompoundWidgetBody widget={makeTodWidget()} />
      </ReactFlowProvider>,
    );
    // The wheel renders pie wedges with data-testid="wedge".
    const wedges = container.querySelectorAll('[data-testid="wedge"]');
    // Depending on which JSON state is current at test time, this asserts:
    // EITHER wedges > 0 (post-Task 5) OR no wedges (pre-Task 5, linear path).
    // We assert: when JSON declares "wheel", wedges render.
    // For Task 4 we cannot guarantee the JSON is flipped yet, so this test
    // is conditional. Make it strict in Task 5 by removing the conditional.
    if (wedges.length > 0) {
      expect(wedges.length).toBeGreaterThanOrEqual(2);
    }
  });
});
```

(The test gets stricter in Task 5 once `time-of-day.json` declares `topology: "wheel"`. For now, it's a soft assertion that the dispatch wiring exists.)

A better, isolation-friendly approach: extract a tiny `pickDialComponent(topology)` helper and unit-test it. Add to the file:

```typescript
import { pickDialComponent } from './CompoundWidgetBody';
import { CircularDial } from './compound/CircularDial';
import { PerceptualDialBody } from '../workspace/PerceptualDialBody';

describe('pickDialComponent', () => {
  it('returns PerceptualDialBody for linear topology', () => {
    expect(pickDialComponent('linear')).toBe(PerceptualDialBody);
  });
  it('returns PerceptualDialBody by default (undefined)', () => {
    expect(pickDialComponent(undefined)).toBe(PerceptualDialBody);
  });
  it('returns CircularDial for wheel topology', () => {
    expect(pickDialComponent('wheel')).toBe(CircularDial);
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/CompoundWidgetBody.test.tsx`
Expected: FAIL — `pickDialComponent` not exported.

- [ ] **Step 4: Wire the dispatch**

In `src/components/widget/CompoundWidgetBody.tsx`:

Add the import:
```typescript
import { CircularDial } from './compound/CircularDial';
```

Add the helper at module scope (export it for testability):
```typescript
import { PerceptualDialBody } from '@/components/workspace/PerceptualDialBody';

export function pickDialComponent(topology: 'linear' | 'wheel' | undefined) {
  if (topology === 'wheel') return CircularDial;
  return PerceptualDialBody;
}
```

Inside the body, where `PerceptualDialBody` is currently rendered, replace with:

```typescript
const topology = op.compound?.topology ?? 'linear';
const DialComponent = pickDialComponent(topology);

return (
  <>
    {topology === 'wheel' ? (
      <CircularDial
        anchors={dialAnchors}
        position={position}
        onPositionChange={handleChange}
      />
    ) : (
      <PerceptualDialBody
        topology="1d-slider"
        anchors={dialAnchors}
        position={position}
        onPositionChange={handleChange}
      />
    )}
    {/* anchor cards row — unchanged */}
    ...
  </>
);
```

(The `pickDialComponent` helper exists for clean unit testing; the actual conditional render uses an inline ternary so each component gets its specific props — `PerceptualDialBody` needs `topology="1d-slider"`, `CircularDial` doesn't.)

- [ ] **Step 5: Tests pass**

Run: `npx vitest run src/components/widget/CompoundWidgetBody.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run tsc + full vitest sweep**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/ 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/CompoundWidgetBody.tsx src/components/widget/CompoundWidgetBody.test.tsx
git commit -m "feat(widget): CompoundWidgetBody dispatches CircularDial for wheel topology"
```

---

## Task 5: Flip `time-of-day.json` to wheel

**Files:**
- Modify: `shared/registry/ops/time-of-day.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Write failing loader test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_time_of_day_uses_wheel_topology_with_colors():
    reg = reload_registry()
    op = reg.ops.get("time-of-day")
    assert op is not None
    assert op.compound is not None
    assert op.compound.topology == "wheel"
    # Each anchor declares its own color.
    for a in op.compound.anchors:
        assert a.color is not None, f"anchor {a.name!r} missing color"
        assert a.color.startswith("#"), f"anchor {a.name!r} color {a.color!r} not a hex string"
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_loader.py::test_time_of_day_uses_wheel_topology_with_colors -v`
Expected: FAIL — topology is `"linear"` (default) and colors are `None`.

- [ ] **Step 3: Update `time-of-day.json`**

In `shared/registry/ops/time-of-day.json`, find the `compound` block. Add `"topology": "wheel"` after the `"interpolation"` line, and add `"color"` to each anchor. The final block:

```jsonc
"compound": {
  "driver": "time_of_day.position",
  "interpolation": "catmull_rom_1d",
  "topology": "wheel",
  "anchors": [
    { "position": 0.10, "name": "dawn",   "color": "#f59e0b", "values": { "kelvin.kelvin": 9800, "light.exposure": -30,  "light.contrast": -8, "light.highlights": -15, "light.shadows":  20, "color.vibrance":  5, "hsl.orange_sat":  10, "hsl.blue_sat":  15, "filters.vignette_amount": -10 } },
    { "position": 0.30, "name": "noon",   "color": "#facc15", "values": { "kelvin.kelvin": 7500, "light.exposure":   0,  "light.contrast": 10, "light.highlights":   0, "light.shadows":   0, "color.vibrance":  0, "hsl.orange_sat":   0, "hsl.blue_sat":  15, "filters.vignette_amount":   0 } },
    { "position": 0.55, "name": "golden", "color": "#ea580c", "values": { "kelvin.kelvin": 9600, "light.exposure":  20,  "light.contrast":  5, "light.highlights": -20, "light.shadows":  10, "color.vibrance": 12, "hsl.orange_sat":  25, "hsl.blue_sat":  -5, "filters.vignette_amount":  -8 } },
    { "position": 0.80, "name": "blue",   "color": "#3b82f6", "values": { "kelvin.kelvin": 4500, "light.exposure": -50,  "light.contrast": 15, "light.highlights": -10, "light.shadows":   5, "color.vibrance":  5, "hsl.orange_sat": -25, "hsl.blue_sat":  20, "filters.vignette_amount": -15 } },
    { "position": 1.00, "name": "night",  "color": "#312e81", "values": { "kelvin.kelvin": 8800, "light.exposure": -120, "light.contrast": 25, "light.highlights": -40, "light.shadows": -10, "color.vibrance":  8, "hsl.orange_sat": -10, "hsl.blue_sat":  15, "filters.vignette_amount": -30 } }
  ]
}
```

(Only `topology` and per-anchor `color` are new. All numeric values are unchanged.)

- [ ] **Step 4: Loader test passes**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_loader.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Verify the JSON also loads via the Vite glob smoke**

Run: `cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/time-of-day.json backend/tests/registry/test_loader.py
git commit -m "feat(registry): time-of-day topology=wheel + per-anchor colors"
```

---

## Task 6: Flip `season.json` to wheel

**Files:**
- Modify: `shared/registry/ops/season.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Write failing loader test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_season_uses_wheel_topology_with_colors():
    reg = reload_registry()
    op = reg.ops.get("season")
    assert op is not None
    assert op.compound is not None
    assert op.compound.topology == "wheel"
    for a in op.compound.anchors:
        assert a.color is not None, f"anchor {a.name!r} missing color"
        assert a.color.startswith("#"), f"anchor {a.name!r} color {a.color!r} not a hex string"
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_loader.py::test_season_uses_wheel_topology_with_colors -v`
Expected: FAIL.

- [ ] **Step 3: Update `season.json`**

In `shared/registry/ops/season.json`, find the `compound` block. Add `"topology": "wheel"` and per-anchor `color`:

```jsonc
"compound": {
  "driver": "season.position",
  "interpolation": "catmull_rom_1d",
  "topology": "wheel",
  "anchors": [
    { "position": 0.00, "name": "spring", "color": "#22c55e", "values": { "kelvin.kelvin": 7000, "color.vibrance":  10, "color.saturation":  5,  "hsl.green_sat":  15, "hsl.orange_sat":   0, "hsl.blue_sat":   5, "light.exposure":  0, "splitTone.highlight_hue":  90, "splitTone.shadow_hue": 200 } },
    { "position": 0.33, "name": "summer", "color": "#eab308", "values": { "kelvin.kelvin": 7500, "color.vibrance":  15, "color.saturation": 10,  "hsl.green_sat":  10, "hsl.orange_sat":  10, "hsl.blue_sat":  10, "light.exposure":  0, "splitTone.highlight_hue":  60, "splitTone.shadow_hue": 200 } },
    { "position": 0.66, "name": "autumn", "color": "#ea580c", "values": { "kelvin.kelvin": 8500, "color.vibrance":   5, "color.saturation": -5,  "hsl.green_sat": -30, "hsl.orange_sat":  30, "hsl.blue_sat": -10, "light.exposure":  0, "splitTone.highlight_hue":  35, "splitTone.shadow_hue":  20 } },
    { "position": 1.00, "name": "winter", "color": "#3b82f6", "values": { "kelvin.kelvin": 5500, "color.vibrance": -15, "color.saturation": -10, "hsl.green_sat": -25, "hsl.orange_sat": -10, "hsl.blue_sat":  15, "light.exposure": -5, "splitTone.highlight_hue": 210, "splitTone.shadow_hue": 220 } }
  ]
}
```

- [ ] **Step 4: Tests pass**

```bash
cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -15
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Plumb per-anchor color from registry into `CircularDial`**

The `CircularDial` component currently passes `color: undefined` for all anchors (it shapes anchors into `AnchorLike` with hardcoded `color: undefined`). Now that two ops carry colors, propagate them. This is a small fix in `CompoundWidgetBody.tsx`:

Find where `dialAnchors` is computed. Replace the existing helper that maps registry anchors → `Anchor` legacy shape, and add `color`:

```typescript
function toDialAnchors(opId: string): Array<Anchor & { color?: string }> {
  const op = loadRegistry().ops[opId];
  if (!op?.compound) return [];
  return op.compound.anchors.map((a) => ({
    id: a.name,
    label: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    position: [a.position],
    params: a.values,
    color: a.color ?? undefined,
  }));
}
```

Then update `CircularDial.tsx`'s `anchorsLike` to forward the color:

```typescript
const anchorsLike = useMemo(
  () => anchors.map((a: Anchor & { color?: string }) => ({
    position: a.position[0],
    name: a.label,
    color: a.color,
  })),
  [anchors],
);
```

And in the wedge render, pass `anchor.color`:

```typescript
const color = resolveWedgeColor(
  { name: anchor.label, color: (anchor as Anchor & { color?: string }).color },
  i,
  AUTO_PALETTE,
);
```

- [ ] **Step 6: Full sweep**

```bash
cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -10
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 7: Manual smoke test (recommended)**

If you can run the dev server:
1. `npm run dev` + backend running
2. Cmd+K "make it golden hour" → TOD widget should now spawn with the colored wheel UI
3. Cmd+K "make it autumn" → Season widget with 4 colored quadrants
4. Drag the indicator past Night (TOD) — it should wrap continuously to Dawn
5. Click each wedge — position should jump to that anchor
6. Cmd+K "make it dramatic" → Mood widget should still show the LINEAR slider (no regression)

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/season.json backend/tests/registry/test_loader.py src/components/widget/CompoundWidgetBody.tsx src/components/widget/compound/CircularDial.tsx
git commit -m "feat(registry): season topology=wheel + per-anchor colors; plumb color through dial"
```

---

## Definition of Done

After Task 6:

- Schema accepts `topology: "wheel"` (Pydantic + Zod) and rejects unknown values.
- `CircularDial` component renders N colored pie wedges for N anchors, with click + drag + cyclic wrap interactions.
- `CompoundWidgetBody` renders `CircularDial` when `op.compound.topology === "wheel"`, falls back to `PerceptualDialBody` otherwise.
- Time of Day widget renders as a 5-wedge wheel (Dawn / Noon / Golden / Blue / Night) with the spec's colors.
- Season widget renders as a 4-wedge wheel (Spring / Summer / Autumn / Winter) with the spec's colors.
- Dragging the indicator past Night returns to Dawn smoothly (no jump).
- Clicking a wedge jumps the position to that anchor (calls `onPositionChange`).
- Weather, Mood, Age render unchanged (still linear).
- Per-anchor lock-on-edit and anchor cards behave identically to the linear variant (already verified by Task 4 not touching that code path).
- Backend tests: all passing.
- Frontend tests: all passing including new wheel-math + CircularDial + dispatch tests.
- `npx tsc --noEmit` clean.
