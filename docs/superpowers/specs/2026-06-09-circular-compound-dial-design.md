# Circular Compound Dial (Wheel Topology) — Design

**Status:** Draft
**Date:** 2026-06-09
**Author:** Anton (with Claude)
**Branch:** to be created off `feat/compound-widget-framework` (or `main` post-merge)

---

## 1. Problem

The Compound Widget Framework ships one dial topology: a linear horizontal slider (`PerceptualDialBody`) with anchor cards below. This works for directional progressions (Mood, Age, Weather) where the user moves from one end to the other.

But two compound widgets — **Time of Day** and **Season** — describe **cyclic** concepts. Day repeats; year repeats. A linear slider with night on one end and dawn on the other puts an unnatural seam in a cycle that has none. Users want to drag past night and have it become dawn smoothly.

The user mocked up a reference (an astronomical seasons diagram) showing the natural treatment: a colored pie wheel where each anchor owns a quadrant and the position indicator slides around the outer ring. This spec adds that wheel topology to the compound framework so any compound op can opt in via JSON.

## 2. Goals

1. **New `wheel` topology** as an alternative to `linear`, declared per op via JSON.
2. **Reusable `CircularDial` component** that any compound op can use — not hardcoded for TOD or Season.
3. **Colored pie wedges**, one per anchor, with the anchor's name inside.
4. **Click-and-drag interaction** — click any wedge to jump to its position; drag the indicator anywhere on the outer ring for smooth scrubbing.
5. **Cyclic wrap** at the 1.0/0.0 seam (dragging past night → dawn).
6. **Per-anchor wedge color** declared in the JSON (optional; auto-cycle if omitted).
7. **Linear topology is unchanged** — Weather/Mood/Age keep their current UI with zero edits.

## 3. Non-goals

- 2D wheels (radial grid for 2D compound widgets) — separate spec.
- Animated transitions between anchors on click — polish task, OK to skip.
- Per-anchor SVG icons in the wedge — out of scope; could land later via `anchor.icon`.
- Customizable wheel start angle — always at top (12 o'clock).
- User-editable wedge colors via Inspector — backend supports the field but UI editor is deferred.
- Wheel topology for Weather/Mood/Age — concepts are directional; if desired later, just flip their JSON.

## 4. Architecture

Five orthogonal pieces, each independently revertable:

```
backend/app/registry/schema.py
shared/registry/schema.ts
  ADD optional `topology: "linear" | "wheel"` to OpCompoundConfig (default "linear")
  ADD optional `color: str | null` to CompoundAnchor

src/components/widget/compound/CircularDial.tsx        NEW — pure SVG wheel
src/components/widget/compound/CircularDial.test.tsx   NEW

src/components/widget/CompoundWidgetBody.tsx
  ADD dispatch on op.compound.topology
    'linear' → existing PerceptualDialBody (unchanged)
    'wheel'  → CircularDial

shared/registry/ops/time-of-day.json
shared/registry/ops/season.json
  ADD "topology": "wheel"
  ADD per-anchor "color" strings
```

The existing `PerceptualDialBody` path stays — anything declaring `topology: linear` (or no topology field at all) renders exactly as today. Zero regression risk for the 3 directional widgets.

## 5. Component changes

### 5.1 Schema additions

**`backend/app/registry/schema.py`:**

```python
class CompoundAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float = Field(ge=0.0, le=1.0)
    name: str
    values: dict[str, float]
    color: str | None = None    # NEW — CSS color string for wheel wedge


class OpCompoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver: str
    interpolation: Literal["catmull_rom_1d"] = "catmull_rom_1d"
    anchors: list[CompoundAnchor] = Field(min_length=2)
    topology: Literal["linear", "wheel"] = "linear"    # NEW
```

**`shared/registry/schema.ts`:**

```typescript
export const CompoundAnchorSchema = z.object({
  position: z.number().min(0).max(1),
  name: z.string(),
  values: z.record(z.string(), z.number()),
  color: z.string().optional(),       // NEW
}).strict();

export const OpCompoundConfigSchema = z.object({
  driver: z.string(),
  interpolation: z.literal('catmull_rom_1d').default('catmull_rom_1d'),
  anchors: z.array(CompoundAnchorSchema).min(2),
  topology: z.enum(['linear', 'wheel']).default('linear'),  // NEW
}).strict().superRefine(...)
```

The `topology` field defaults to `linear`. Existing JSONs (Weather, Mood, Age) need no edits — they implicitly stay linear.

The `color` field defaults to `null`. If null, `CircularDial` auto-assigns from a built-in palette (so legacy compound widgets switching to wheel topology don't need color edits).

### 5.2 `CircularDial.tsx`

Pure presentation component — no store wiring, no backend awareness. Mirrors `PerceptualDialBody`'s prop signature:

```typescript
import type { Anchor } from '@/lib/perceptual-dial/types';

interface CircularDialProps {
  anchors: Anchor[];                          // sorted by position
  position: number;                           // current 0..1
  onPositionChange: (next: number) => void;   // called on click + drag
}

export function CircularDial(props: CircularDialProps): JSX.Element;
```

**Internal logic:**

1. **Wedge geometry:** N anchors get N evenly-spaced wedges. Each wedge is centered at angle `(i / N) × 360°`, spans `(360 / N)°`. Wedge i covers angles `[anchorAngle[i] - span/2, anchorAngle[i] + span/2]`.

2. **Indicator angle:** find which segment the current `position` falls into (between `anchors[i].position` and `anchors[(i+1) % N].position`). Compute fraction through that segment, then interpolate between `anchorAngle[i]` and `anchorAngle[i+1]`. This decouples the JSON position values from the wheel angles — even if positions are uneven, the wheel renders evenly.

3. **Click handler:** clicking a wedge calls `onPositionChange(anchors[i].position)` — the indicator animates to that anchor.

4. **Drag handler:** mouse down on indicator → drag mode. During drag: compute angle from cursor relative to wheel center; convert angle back to position by inverse of the indicator-angle math above. Live `onPositionChange` fires on every move (throttled to ~60fps).

5. **Cyclic wrap:** during drag, when crossing the 1.0/0.0 seam, the indicator wraps continuously (so dragging clockwise past the last anchor lands on the first). The emitted `position` value stays in [0, 1].

6. **Color resolution:** wedge color = `anchor.color` if set, else from the built-in palette `['#22c55e', '#eab308', '#ea580c', '#3b82f6', '#a855f7']` cycling through anchors.

7. **Hover/active state:** wedge under cursor gets `filter: brightness(1.15)`. Wedge whose center angle is nearest to the current indicator angle gets `filter: brightness(1.3)` + drop-shadow.

**Visual structure (SVG):**

- Center disk at `(160, 160)` in a `320×320` viewBox
- Pie wedges as SVG `<path>` elements (radius 110)
- Outer ring track as a `<circle>` (radius 135, gray)
- Active-segment arc as a `<path>` highlighting the current wedge's outer arc (colored, with glow)
- Position indicator as a small `<circle>` (radius 7, white with drop-shadow)
- Wedge labels as `<text>` placed at the wedge centroid (computed from wedge center angle and a smaller radius)

No center icon (dropped during brainstorm). No outer titles (dropped during brainstorm — labels live inside wedges only).

### 5.3 `CompoundWidgetBody.tsx` dispatch

The existing component reads `op.compound.topology` and branches:

```typescript
import { CircularDial } from './compound/CircularDial';

// Inside CompoundWidgetBody:
const topology = op.compound.topology ?? 'linear';

const dialEl = topology === 'wheel'
  ? <CircularDial
      anchors={dialAnchors}
      position={position}
      onPositionChange={handleChange}
    />
  : <PerceptualDialBody
      anchors={dialAnchors}
      position={position}
      onPositionChange={handleChange}
      topology="1d-slider"
    />;

return (
  <div className="compound-widget-body">
    {dialEl}
    {/* anchor cards row below, unchanged */}
  </div>
);
```

Anchor cards (`EditableParamCard` row below the dial) are unchanged across topologies, per the brainstorm Q4.

### 5.4 `time-of-day.json` and `season.json` JSON updates

Both add `topology: "wheel"` to their `compound` block and per-anchor `color`:

**`time-of-day.json`:**
```jsonc
"compound": {
  "driver": "time_of_day.position",
  "interpolation": "catmull_rom_1d",
  "topology": "wheel",
  "anchors": [
    { "position": 0.10, "name": "dawn",   "color": "#f59e0b", "values": { ... } },
    { "position": 0.30, "name": "noon",   "color": "#facc15", "values": { ... } },
    { "position": 0.55, "name": "golden", "color": "#ea580c", "values": { ... } },
    { "position": 0.80, "name": "blue",   "color": "#3b82f6", "values": { ... } },
    { "position": 1.00, "name": "night",  "color": "#312e81", "values": { ... } }
  ]
}
```

**`season.json`:**
```jsonc
"compound": {
  "driver": "season.position",
  "interpolation": "catmull_rom_1d",
  "topology": "wheel",
  "anchors": [
    { "position": 0.00, "name": "spring", "color": "#22c55e", "values": { ... } },
    { "position": 0.33, "name": "summer", "color": "#eab308", "values": { ... } },
    { "position": 0.66, "name": "autumn", "color": "#ea580c", "values": { ... } },
    { "position": 1.00, "name": "winter", "color": "#3b82f6", "values": { ... } }
  ]
}
```

Values from §5.2 of the original Creative Compound Widgets spec are unchanged.

## 6. Data flow

```
User clicks "Autumn" wedge
  ↓ CircularDial onClick(wedge) → onPositionChange(0.66)
  ↓ CompoundWidgetBody's handleChange(0.66) → existing flow
    → useProcessingParam(0.66) → optimistic patch + debounced set_widget_param
  ↓ Backend: resolve_compound(widget, op, 0.66) → derived bundle
  ↓ SSE widget.updated → re-render
  ↓ CircularDial receives new position=0.66 → indicator angles to autumn wedge center
  ↓ Anchor cards below show interpolated values (autumn anchor values)

User drags indicator past 1.0
  ↓ During drag: cursor angle 358° → cyclic wrap → position 0.005 (dawn region)
  ↓ Continuous; no jump back to 0
  ↓ Live onChange fires every frame
  ↓ Existing optimistic patch + debounced backend dispatch
```

## 7. Failure handling

| Failure | Behavior |
|---|---|
| `topology` is some other string (e.g. `"radial-grid"`) | Pydantic + Zod reject at load (Literal/enum) |
| `anchor.color` is malformed CSS | SVG renders with that string; browser uses fallback. No crash. JSON author fixes. |
| Drag releases outside wheel bounds | Clamp cursor angle to its nearest valid angle; no off-canvas leaks |
| `position > 1` or `< 0` from external source | Clamp before computing indicator angle (`position = ((position % 1) + 1) % 1`) |
| Anchor count < 2 | Already rejected by schema (`min_length=2`) |
| Cyclic wrap at seam during drag | Indicator wraps continuously; emitted `position` stays in [0, 1] |
| Widget rendered before React Flow store ready (zoom unknown) | Inherits `useChromeScale` from `CompoundWidgetBody`'s wrapper — no special handling |
| `CircularDial` mounts inside a non–ReactFlowProvider context (test setup) | The component doesn't call `useReactFlow` directly; it inherits zoom-invariance from the parent. Safe under any test wrapper. |

## 8. Migration & rollout

No data migration. No feature flag. Five commits, each independently revertable:

1. **Schema additions** — `topology` + `color` fields on Pydantic + Zod + schema tests. No JSON uses them yet; linear path unchanged.
2. **`CircularDial.tsx` + tests** — component built and tested in isolation. Not yet wired to any widget.
3. **Dispatch in `CompoundWidgetBody`** — branch on `op.compound.topology`. Still no widget uses `wheel` yet.
4. **Update `time-of-day.json`** with `topology: "wheel"` and per-anchor colors. TOD renders as wheel in dev server.
5. **Update `season.json`** same. Season renders as wheel.

After commit 5: dev-server smoke — drag both wheels through all anchors, verify color story and cyclic wrap. Iterate on colors via JSON edits. Weather/Mood/Age stay linear (untouched).

## 9. Testing

| Tier | What | Where |
|---|---|---|
| Schema | `topology` accepts `'linear'` and `'wheel'`; rejects anything else | extend `test_schema.py` (Pydantic) + `schema.test.ts` (Zod) |
| Schema | `CompoundAnchor.color` accepts string or null | same |
| Component | `CircularDial` renders N `<path>` wedges for N anchors | `CircularDial.test.tsx` |
| Component | Indicator angle correctly reflects position (sample 5 positions, snapshot angle) | same |
| Component | Click on wedge → `onPositionChange` called with that anchor's position | same |
| Component | Drag indicator → `onPositionChange` called with computed position | same |
| Component | Cyclic wrap at seam keeps emitted position in [0, 1] | same |
| Integration | `CompoundWidgetBody` with `topology: "wheel"` renders `CircularDial`; with `topology: "linear"` (default) renders `PerceptualDialBody` | extend `CompoundWidgetBody.test.tsx` |
| Loader | Updated TOD and Season JSONs load; topology field present | extend `test_loader.py` |
| Visual smoke | Manual: drag through all anchors on both wheels in dev server; verify color story, lock-on-edit, cyclic wrap | not automated |

## 10. Definition of done

After commit 5:

- Schema accepts `topology: "wheel"` and rejects unknown values.
- `CircularDial` component exists, tested in isolation.
- `CompoundWidgetBody` dispatches to the wheel when `topology: "wheel"`.
- Time of Day widget renders as a colored 5-wedge wheel.
- Season widget renders as a colored 4-wedge wheel.
- Clicking a wedge jumps the position to that anchor.
- Dragging the indicator scrubs position smoothly.
- Cyclic wrap works at the 1.0/0.0 seam.
- Per-anchor lock-on-edit and anchor cards behave identically to the linear variant.
- Weather, Mood, Age render unchanged (still linear `PerceptualDialBody`).
- Backend tests pass.
- Frontend tests pass (existing + new `CircularDial` + dispatch tests).
- `npx tsc --noEmit` clean.
- Manual smoke pass complete; iterate any color values that feel off.

## 11. Open questions deferred

1. **Drag visual feedback during scrubbing.** A trailing dot/arc behind the indicator showing the drag path? Polish task.
2. **Animated transitions between wedges on click.** 200ms ease-out feels right but adds anim state. Defer.
3. **Per-anchor SVG icons** inside the wedge label (☀️ for noon, 🌙 for night, 🍂 for autumn). Visually richer; adds an `anchor.icon` field. Defer.
4. **Keyboard accessibility.** Tab focuses indicator; arrow keys nudge ±0.01. Should land as part of a global a11y pass, not this spec.
5. **2D wheel** for hypothetical 2D compound widgets (time × weather). Would need a major schema extension and is YAGNI today.
6. **User-editable wedge colors via Inspector.** Backend supports `color` field; UI editor for it is deferred to a "preset customization" spec.

## 12. Why these choices

**Why `topology` on the compound block rather than a new `control_type` in the registry-controls library?**
The registry-controls library is for per-param UI (sliders, swatches, hue wheels). The compound dial is a widget-body concept — it represents the driver param AND lays out the anchor buttons AND drives interpolation. It's higher-level than a per-param control, so it belongs on the compound config block, not the control vocabulary.

**Why default `topology` to `linear`?**
Zero-edit back-compat. The 3 existing compound widgets that DON'T want wheel UI (Weather, Mood, Age) need no changes. Only the two cyclic widgets (TOD, Season) get the `topology: "wheel"` line.

**Why evenly-spaced wedges instead of position-driven wedge sizes?**
Visual clarity. With TOD's anchor positions 0.1/0.3/0.55/0.8/1.0, position-driven wedges would be wildly uneven — dawn would be a tiny sliver, night would be huge. The reference image (the user's astronomical seasons diagram) shows even quadrants. Even wedges with interpolated indicator angles preserves the math (position drives interpolation as always) while giving the wheel visual balance.

**Why optional per-anchor color rather than a fixed palette?**
Authoring control. TOD's "night" looks right as dark indigo; Season's "autumn" wants orange. Hardcoded palettes constrain expression. With a null fallback to a built-in palette, legacy JSONs work; with explicit colors, authors get exactly the look they want.

**Why dispatch in `CompoundWidgetBody` instead of two separate body components in `ToolSection.tsx`?**
`CompoundWidgetBody` already encapsulates "this is a compound widget with anchor cards below a dial". The dial component (linear vs wheel) is an internal detail. Adding a second body type in `ToolSection` would duplicate the store-wiring + anchor-card layout. One dispatch point inside `CompoundWidgetBody` keeps the surface clean.

**Why no center icon (despite the reference showing one)?**
The user explicitly said no center during brainstorm. The reference image's center sun is illustrative of the cycle's cause (Earth's tilt around the sun). For the UI, the same information is conveyed by the wheel itself. Skipping it reduces visual noise and avoids the question of what icon belongs in each widget's center (TOD: sun/moon? Season: sun? Weather: cloud?). Cleaner without.
