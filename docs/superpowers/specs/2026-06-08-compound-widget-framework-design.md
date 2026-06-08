# Compound Widget Framework — Design

**Status:** Draft
**Date:** 2026-06-08
**Author:** Anton (with Claude)
**Branch:** to be created off `main`

---

## 1. Problem

Time-of-Day is the editor's first "creative" widget — a 1D dial that re-lights the image across the day arc (dawn → noon → golden → blue → night). It's structurally different from a scalar op (light, color, vignette): one **driver** parameter (the dial position) implies many **derived** parameters (kelvin, exposure, contrast, …) interpolated from an anchor table.

Today TOD is implemented as a tangled web outside the SSoT registry:

| File | Role |
|---|---|
| `backend/app/tools/fused/time_of_day.py` (192 LOC) | Fused-template definition; bindings, envelopes, position-as-LLM-output |
| `backend/app/tools/fused/_time_of_day_data.py` (118 LOC) | Anchor table + Catmull-Rom interpolation in Python |
| `src/processing/anchors/time-of-day-anchors.ts` | Anchor table in TypeScript (must mirror the Python copy by hand) |
| `src/lib/perceptual-dial/interpolate.ts` | Catmull-Rom interpolation in TypeScript |
| `src/processing/time-of-day.tsx` (15 LOC) | Processing-registry wiring for the bespoke Panel |
| `src/components/workspace/TimeOfDayWidgetBody.tsx` (169 LOC) | Bespoke per-anchor card UI with implicit lock-on-edit |

Two problems:
1. **Duplicated state-of-truth.** Anchor values live in TWO places (`.py` and `.ts`) and have to be edited in lockstep. The file comments explicitly say so ("If you change values here, update the JS copies in lockstep"). One missed edit → silent backend/frontend divergence.
2. **No framework for the next creative widget.** When the next compound concept arrives (weather, mood, season — any "1D dial driving N derived params"), it'd need its own bespoke files. The SSoT registry pattern that scalar ops use stops at the doorstep of compound widgets.

## 2. Goals

1. **One source of truth for anchor data.** Anchor tables live in `shared/registry/ops/<id>.json` alongside params and bindings. Backend and frontend read the same JSON.
2. **Generic 1D compound framework.** Adding a new compound op = author one JSON file. Schema, interpolation, and UI are all generic.
3. **Preserve all current TOD behavior:** dial-drag interpolation, per-key lock-on-edit, manual unlock-by-deletion (out of scope here), Cmd+K planner integration.
4. **No new code paths in `propose_stack`.** Compound ops are op_ids like any other; the planner returns `{op_id: "time-of-day", starting_params: {position: 0.55}}`.

## 3. Non-goals

- 2D compound widgets (e.g. time × weather as a 2D plot).
- Linear interpolation as an alternative to Catmull-Rom.
- Unlock UX (click × to unlock a manually-edited key).
- Multiple drivers per compound op.
- LUT / filter widgets — separate follow-up spec.
- Adding a `mood` category to the registry.
- Per-anchor LLM hooks (planner picking "golden" by name instead of position 0.55).

## 4. Architecture

Three orthogonal pieces of infrastructure plus the TOD port:

```
shared/registry/schema.ts         + CompoundAnchor, OpCompoundConfig types
backend/app/registry/schema.py    + same Pydantic models
  ↓
shared/registry/ops/time-of-day.json   ← single source of truth for anchors + params
  ↓
shared/registry/lib/interpolate-1d.ts  ← shared Catmull-Rom (TS)
backend/app/registry/interpolate.py    ← shared Catmull-Rom (Python, byte-parity)
  ↓
backend set_widget_param          → reads anchors from registry, applies lock semantics
frontend CompoundWidgetBody       ← new generic component, reads anchors + bindings from registry
  ↓ ToolSection.tsx dispatch
  →  compound op? → CompoundWidgetBody
  →  scalar op?   → RegistryDrivenSectionBody (existing)
```

Pieces 1–3 add infrastructure without changing behavior. Piece 4 (TOD port) is the cutover where bespoke code retires.

## 5. Component changes

### 5.1 Schema additions

`backend/app/registry/schema.py`:

```python
class CompoundAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float = Field(ge=0.0, le=1.0)
    name: str
    values: dict[str, float]

class OpCompoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver: str                                      # param key (e.g. "position")
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

class RegistryOp(BaseModel):
    # ... existing fields ...
    compound: OpCompoundConfig | None = None

    @model_validator(mode="after")
    def _bindings_reference_params(self) -> RegistryOp:
        # ... existing check ...
        if self.compound:
            if self.compound.driver not in self.params:
                raise ValueError(f"compound driver {self.compound.driver!r} not in params")
            for a in self.compound.anchors:
                for k in a.values:
                    if k not in self.params:
                        raise ValueError(f"anchor value key {k!r} not in op.params")
        return self
```

Zod mirror in `shared/registry/schema.ts`.

### 5.2 `shared/registry/ops/time-of-day.json`

```jsonc
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

Values copied verbatim from `_time_of_day_data.py::TIME_OF_DAY_ANCHORS`. After this commit the JSON is the canonical source.

### 5.3 Shared interpolation library

`shared/registry/lib/interpolate-1d.ts`:

```typescript
import type { CompoundAnchor } from '../schema';

function catmullRom(v0: number, v1: number, v2: number, v3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (
    2 * v1 +
    (-v0 + v2) * u +
    (2*v0 - 5*v1 + 4*v2 - v3) * u2 +
    (-v0 + 3*v1 - 3*v2 + v3) * u3
  );
}

export function interpolate1D(anchors: CompoundAnchor[], t: number): Record<string, number> {
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
    ...Object.keys(p0.values), ...Object.keys(p1.values),
    ...Object.keys(p2.values), ...Object.keys(p3.values),
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

`backend/app/registry/interpolate.py` is a 30-line Python mirror with identical math (replaces `_time_of_day_data.py::interpolate_1d`).

A cross-platform parity test sampling 5 positions and asserting identical floats (with tight tolerance, e.g. `1e-9`) lives in `backend/tests/registry/test_interpolate.py` — Python reads expected values from JSON, TypeScript snapshots its output via vitest.

### 5.4 Backend lock semantics

Existing `backend/app/tools/widgets/set_widget_param.py` already implements lock-on-edit for TOD. The migration:

1. Extract the resolve-after-driver-change logic into a helper `backend/app/registry/compound_resolver.py`:
   ```python
   def resolve_compound(widget: Widget, op: RegistryOp, driver_value: float) -> dict[str, float]:
       """Apply driver change; return {param_key: new_value} for derived params,
       skipping any param in widget.locked_params."""
       if op.compound is None:
           return {}
       derived = interpolate_1d(op.compound.anchors, driver_value)
       locked = set(widget.locked_params)
       return {k: v for k, v in derived.items() if k not in locked and k != op.compound.driver}
   ```
2. `set_widget_param.py` calls this helper when the op has a `compound` block AND the param being set is the driver. When the param is a derived key, the existing implicit-lock logic stays (add the key to `widget.locked_params`).
3. Drop the `from app.tools.fused._time_of_day_data import interpolate_1d` import — use the shared `backend/app/registry/interpolate.py` instead.

No new lock semantics — just relocation behind the registry.

### 5.5 Frontend `CompoundWidgetBody`

`src/components/widget/CompoundWidgetBody.tsx` — generic component for any op with a `compound` block:

```typescript
interface Props {
  widget: Widget;
  disabled?: boolean;
}

export function CompoundWidgetBody({ widget, disabled }: Props): JSX.Element {
  const op = loadRegistry().ops[widget.op_id ?? ''];
  if (!op?.compound) return /* fallback to RegistryDrivenSectionBody */;

  const driverKey = op.compound.driver;
  const driverParam = op.params[driverKey];
  const driverBinding = op.bindings.find(b => b.param_key === driverKey)!;
  // Live position from widget; live derived bundle from interpolate1D(anchors, position).
  // Render: driver slider on top, anchor cards row, per-key controls below.
  ...
}
```

`src/components/inspector/adjustments/ToolSection.tsx` dispatch (Task 14 of the SSoT registry work): when `op.compound !== undefined`, render `CompoundWidgetBody`. Otherwise dispatch to `RegistryDrivenSectionBody` as today.

### 5.6 TOD bespoke retirement

After CompoundWidgetBody is wired, delete:
- `backend/app/tools/fused/time_of_day.py`
- `backend/app/tools/fused/_time_of_day_data.py`
- `src/processing/time-of-day.tsx`
- `src/processing/anchors/time-of-day-anchors.ts`
- `src/components/workspace/TimeOfDayWidgetBody.tsx`
- `src/lib/perceptual-dial/interpolate.ts` (or whichever file holds the TS Catmull-Rom)

Drop the special-case dispatch branch for `'time-of-day'` in `ToolSection.tsx`. Any test files for the bespoke code that no longer have a target — delete those too.

## 6. Data flow

```
Cmd+K: "make it golden hour"
  ↓ planner returns {op_id: "time-of-day", starting_params: {position: 0.55}}
  ↓ propose_stack builds widget with WidgetNode{type: "compound", op_id: "time-of-day", params: {position: 0.55, ...rest from registry defaults}}
  ↓ SSE: widget.created
  ↓ Inspector renders CompoundWidgetBody
    → reads registry: op.compound.anchors
    → interpolate1D(anchors, 0.55) → derived bundle
    → renders driver slider + 5 anchor cards (dawn/noon/golden/blue/night)
       golden highlighted as nearest

User drags Time slider to 0.30 (noon):
  ↓ set_widget_param(widget, "position", 0.30)
  ↓ backend: resolve_compound(widget, op, 0.30) → derived bundle for noon, skipping locked keys
  ↓ widget.nodes[0].params updated; locked_params unchanged
  ↓ SSE: widget.updated → CompoundWidgetBody re-renders

User edits "Exposure" slider to 25:
  ↓ set_widget_param(widget, "light.exposure", 25)
  ↓ backend: implicit lock → widget.locked_params += "light.exposure"
  ↓ widget.nodes[0].params["light.exposure"] = 25
  ↓ SSE: widget.updated → CompoundWidgetBody re-renders, exposure card shows lock icon

User drags Time slider to 0.80 (blue hour):
  ↓ set_widget_param(widget, "position", 0.80)
  ↓ resolve_compound(...) skips "light.exposure" (locked)
  ↓ all other derived keys update; exposure stays at 25
```

## 7. Failure handling

| Failure | Behavior |
|---|---|
| Op JSON has `compound` with `anchors.length < 2` | Schema validator rejects at load time. Loader throws; server doesn't start. |
| Anchor positions not strictly increasing OR not in [0, 1] | Schema validator rejects. |
| Two anchors have different `values` key sets | Schema validator rejects (catches typos). |
| Anchor `values` key not in `op.params` | Schema validator rejects. |
| `compound.driver` not in `op.params` | Schema validator rejects. |
| `set_widget_param` called with a key not in `op.params` | Reject with `_InvalidInput` (same as today). |
| `position` outside [0, 1] when interpolating | Clamp to endpoint (existing behavior; matches the test). |
| `widget.locked_params` references a key no longer in `op.params` (op JSON edited) | Filter to known keys, silently drop unknowns. |
| Frontend can't find `op.compound` for a widget with `type: "compound"` | Fall back to `RegistryDrivenSectionBody` (the widget still renders, just without anchor cards). |

## 8. Migration & rollout

No feature flag. 7 commits, each independently revertable:

1. **Schema additions** — Pydantic + Zod gain `compound` block. No JSON uses it yet.
2. **Shared interpolation library** — new TS + Python modules + parity test.
3. **Author `time-of-day.json`** — anchors copied from `_time_of_day_data.py`. Loader picks it up. No consumer reads `op.compound` yet.
4. **Backend wires registry-driven compound resolve** — `set_widget_param` and the compound resolver read from `get_registry().ops["time-of-day"].compound.anchors` instead of `TIME_OF_DAY_ANCHORS`. Behavior identical. Existing TOD test suite verifies parity.
5. **Frontend wires registry-driven anchors** — UI reads anchors from registry. Existing bespoke `TimeOfDayWidgetBody` stays.
6. **Create `CompoundWidgetBody`** + wire `ToolSection.tsx` dispatch. Both bespoke and generic paths coexist briefly; bespoke wins until step 7.
7. **Retire TOD bespoke code** — delete six files; remove the `'time-of-day'` special-case from `ToolSection.tsx`. Run full suite; no regression.

Each commit is verifiable in isolation. Step 7 is the cliff; if it surfaces an unforeseen dependency, revert just that commit — the framework still works for future compound ops, TOD just keeps its bespoke UI.

## 9. Definition of done

After commit 7:

- Time-of-Day widget renders via `CompoundWidgetBody`, reading anchors from `shared/registry/ops/time-of-day.json`.
- Cmd+K "make it golden hour" still produces a TOD widget at `position: 0.55`.
- Dial drag still interpolates derived params via Catmull-Rom; lock-on-edit still sticks.
- No file under `backend/app/tools/fused/time_of_day*` exists.
- No file under `src/processing/anchors/time-of-day*` exists.
- No `TimeOfDayWidgetBody` exists.
- Adding a new compound op (e.g. "weather") would mean: author one JSON file with a `compound` block. No bespoke Python, no bespoke React component.
- Backend tests: ≥471 passing (the TOD-specific tests get rewired but the count doesn't drop).
- Frontend tests: ≥575 passing.
- `npx tsc --noEmit` clean.

## 10. Open questions deferred

1. **2D compound widgets.** A future "weather + time" might want a 2D anchor table interpolated bilinearly. The schema's `interpolation` field can grow another enum value when needed.
2. **Mood category.** TOD lands as `category: "tone"` but compound widgets are conceptually different from tonal scalars. Adding `category: "mood"` would let the planner / category-grouping cluster them visually.
3. **Per-anchor LLM hooks.** Planner could return `{op_id: "time-of-day", anchor: "golden"}` instead of `{starting_params: {position: 0.55}}`. Resolver looks up anchor name → position. Nicer LLM ergonomics but adds an indirection.
4. **Unlock UX.** Today's TOD has no way to unlock a manually-edited key short of resetting the widget. A small "×" on each locked-key card would write `widget.locked_params -= [key]`. Cheap follow-up.
5. **Cross-tier parity testing.** The TS + Python interpolation libraries need byte-parity. Today we hand-pin expected values; a build-step that generates expected outputs from the JSON would be tighter.

## 11. Why these choices

**Why a `compound` block instead of a new op `type`?**
The `compound` block is additive — scalar ops are unchanged. If we made compound a new top-level `type`, every existing consumer of the registry would need a branch for "is this a compound op?" everywhere. The block lets consumers opt in: code that doesn't care about compounds keeps reading `op.params` and `op.bindings` flat.

**Why inline anchors in the op JSON instead of a sibling file?**
Two-file ops splinter the "one file to add an op" principle. Anchors aren't independently reusable across ops (they're tied to one op's param key-set). Inline is simpler.

**Why preserve lock-on-edit?**
The behavior was just landed in commit `aed83e9` after specific user feedback. The implicit-lock semantics are subtle but right for the dial UX — explicit toggles would be a step backward. The locked_params field already exists on Widget; reusing it is free.

**Why retire bespoke TOD in commit 7 rather than keep both paths?**
A dead code path that mirrors the live one rots fast — every TOD change has to touch both. The cutover is one commit and easily revertable. After it, future compound ops have one path to follow; before it, they have two.
