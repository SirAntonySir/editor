# Perceptual Widgets — Palette Harmony, Mood Pad, Time-of-Day — Design

**Date:** 2026-06-02
**Status:** Draft, pre-implementation
**Author:** Anton + Claude (brainstorming session)

## 1. Problem & Context

The existing widget set (`light`, `color`, `hsl`, `kelvin`, `curves`, `levels`, `filters`, `sharpen`, `blur`, `clarity`) gives a user precise *per-parameter* control. What's missing is **creative-intent control**: a way to say "make this warmer / dreamier / golden hour" without reaching for ten sliders. Mainstream editors solve this with static presets (Lightroom AI Presets) or one-off filters (Luminar Looks) — both are black-box, content-blind, and not editable after the fact.

This project's thesis USP is the opposite stance: **AI composes real, editable widgets from a block kit, wired into the shader pipeline**. That means a creative-intent widget here doesn't return a fixed LUT — it compiles down to a *bundle of existing widget values* the user can see and override.

This spec covers three new widgets that all sit on that compile-down principle:

- **Palette Harmony** (concept "G") — pick a color-theory rule (complementary / triadic / split-complementary / analogous); the image's palette is nudged toward that scheme. Reads from the existing info-tab color palette (`enriched_context.color_palette`, `dominant_swatches`).
- **Mood Pad** (concept "A") — a 2D pad whose position drives a bundle of shader values via four anchor recipes.
- **Time-of-Day Dial** (concept "B") — a 1D slider whose position drives the same bundle via five anchor recipes (dawn / noon / golden / blue / night).

Mood Pad and Time-of-Day are two topologies of the same machinery: **one perceptual input → trajectory through anchors in Oklab → bundle of existing widget values → compound node in the operation graph**. The first part of this spec is the shared framework. Sections 6–8 are the three widgets on top of it.

### Selected from prior brainstorming

The 8 conventional widgets (Color Grading Wheels, Tone EQ, Presence, Effects, Detail, B&W Mix, Range Mask, Orton/Glow) explored on 2026-06-02 are logged in [`docs/superpowers/widget-backlog.md`](../widget-backlog.md) as table-stakes work for later. This spec is for the three creative widgets the user picked.

### Existing context this builds on

- `ProcessingRegistry` and the `ProcessingDefinition` contract — one registration places a widget in the inspector and pipeline.
- `useCanonicalParam`/`useProcessingParam` — read/write a single shader param with optimistic patches and 300 ms debounce to `set_param`.
- Backend MCP `propose_widget` — three spawn paths (palette, autonomous, toolrail) already exist. New widgets get a fourth-equal entry on the toolrail.
- `enriched_context.color_palette: ColorSwatchData[]` and `enriched_context.dominant_swatches` already arrive on the snapshot mechanical delta. Palette Harmony reads from these.

## 2. Goals & Non-Goals

**Goals**

- Ship three new widgets that demonstrate the compose-from-block-kit USP: each one *compiles down to existing widget params* and the user can see and edit the compiled result.
- Build the **perceptual-dial framework** once, use it for both Mood Pad and Time-of-Day.
- Palette Harmony reads from the existing info-tab palette without duplicating extraction logic.
- Tier the AI work: ship the no-AI version of each widget first; layer vision-anchor and per-region modulation as follow-ups.
- Follow the strict 3-tier component architecture (`ui/` primitives → topic folder → scaffold).

**Non-Goals (explicitly deferred)**

- **Tier 2 / vision anchor.** Estimating "what time of day is this image currently?" via a vision call to set the slider's neutral point. Covered in §10 as follow-up.
- **Tier 3 / per-region modulation.** Using segmentation to apply different magnitudes to sky / skin / foreground. Covered in §10.
- **Engine or shader changes.** The compile target is *existing* shader params (`exposure`, `contrast`, `kelvin`, per-band `hsl`, `vignette_amount`, etc.). If a target param doesn't exist, the anchor doesn't use it.
- **Major `ProcessingDefinition` schema changes.** Each new widget is a normal `ProcessingDefinition` with a `compound` `adjustmentType`. One *optional* field is added to the schema (`compoundOrder?: string[]`, see §5); no existing field changes meaning. Existing widgets do not change.
- **A new operation-graph node type.** The compiled bundle materialises as the widget node's params; the renderer reads it through the existing per-layer pipeline.
- **Skin protection.** Naïve WB swings will look bad on faces. Acknowledged risk; tier-3 work.

## 3. Architecture Overview — the Perceptual-Dial Framework

The framework reduces to four units that each have one clear purpose:

### 3.1 `Anchor`

A serialisable recipe: a named point in adjustment-space.

```ts
// src/lib/perceptual-dial/types.ts
export interface Anchor {
  id: string;                              // 'noon', 'golden', 'cool-calm', …
  label: string;                           // for UI / tooltips
  position: number[];                      // n-d coordinate in the dial's input space (1-D or 2-D)
  params: Record<string, number>;          // values for existing shader params:
                                           //   'light.exposure', 'kelvin.kelvin',
                                           //   'color.vibrance', 'hsl.orange_sat', …
                                           //   keys are `${op}.${param}` from ProcessingRegistry
}
```

The `params` keys are the existing canonical param keys, namespaced by `op`. This is a deliberate constraint: anchors only speak in the language of widgets we already ship. If a recipe wants something we don't have (e.g. dehaze), it omits it.

### 3.2 `interpolate(anchors, position) → params`

Pure function. Given a set of anchors and a position in the dial's input space, returns a `Record<string, number>` of compiled shader values.

- **For 1-D dials (Time-of-Day):** Catmull-Rom spline through anchors sorted by `position[0]`.
- **For 2-D dials (Mood Pad):** bilinear interpolation across the 4 corner anchors, weighted by distance in Oklab.
- **Color params interpolate in Oklab.** Anchors store RGB-equivalent shader values; interpolation converts to Oklab, lerps, converts back. Prevents the "muddy gray" mid-transition that plagues naïve RGB lerps.
- **Scalar params (exposure, contrast, vibrance, vignette amount) interpolate linearly.**
- The function knows which params are color-bearing vs scalar via a small lookup table.

### 3.3 `compileToWidgetParams(compiledParams) → WidgetPatch[]`

Takes the flat `{ 'light.exposure': 0.2, 'kelvin.kelvin': 3400, ... }` output of `interpolate` and groups by `op`, producing a list of `{ op, params }` patches to apply.

The compound widget materialises these as *its own node's params* — not as patches to sibling widgets. The shader for `adjustmentType: 'compound'` runs the per-op shader passes in turn, reading from its own param namespace. This keeps undo simple: one node, one undo entry.

### 3.4 `PerceptualDialBody` (level-2 component)

Generic UI primitive in `src/components/workspace/PerceptualDialBody.tsx` (level-2, lives next to `WidgetShell` siblings). Props:

```ts
interface PerceptualDialBodyProps {
  layerId: string;
  anchors: Anchor[];
  topology: '1d-slider' | '2d-pad';
  axisLabels?: { x: string; y?: string; ends?: [string, string] };
  compileTarget: 'mood' | 'time-of-day' | string; // the widget's op name
}
```

Both Mood Pad and Time-of-Day use this body — only the `topology`, `anchors`, and labels differ.

### 3.5 Live read-out of the compiled bundle

Below the dial, a small read-only summary lists the top 3–5 non-zero compiled params with their values: `WB 3400K · Exp +0.2 · Orange sat +25 · Vignette -8`. This is the thesis-USP moment — the widget is transparent, not magic. A "convert to manual widgets" button explodes the compound node into separate `kelvin`, `light`, `hsl`, `effects` nodes so the user can take over.

## 4. Component & File Plan

```
src/
  lib/
    perceptual-dial/
      types.ts                  # Anchor, DialTopology
      interpolate.ts            # interpolate(anchors, position) → params
      oklab.ts                  # RGB↔Oklab conversions (~30 LoC)
      compile.ts                # compileToWidgetParams
  processing/
    mood.tsx                    # ProcessingDefinition (adjustmentType: 'compound')
    time-of-day.tsx             # ProcessingDefinition (adjustmentType: 'compound')
    palette-harmony.tsx         # ProcessingDefinition (adjustmentType: 'compound')
    anchors/
      mood-anchors.ts           # 4 corner anchors for Mood Pad
      time-of-day-anchors.ts    # 5 anchors along the day curve
      harmony-rules.ts          # complementary / triadic / split / analogous
  components/
    workspace/
      PerceptualDialBody.tsx    # Generic dial body (1-D + 2-D)
      PerceptualDialBody.test.tsx
      MoodPadWidgetBody.tsx     # Thin wrapper passing topology + anchors
      TimeOfDayWidgetBody.tsx   # Thin wrapper
      PaletteHarmonyWidgetBody.tsx
      __fixtures__/
    ui/
      OklabSwatch.tsx           # If we end up needing a cross-domain swatch primitive
  tools/
    mood-tool.tsx               # Toolrail entry
    time-of-day-tool.tsx
    palette-harmony-tool.tsx
```

`mood.tsx`, `time-of-day.tsx`, `palette-harmony.tsx` are registered in `processing/index.ts`. Toolrail buttons added (the "Toolrail is 6 buttons" rule in CLAUDE.md is relaxed — three new buttons or moved to an overflow group; see §9).

## 5. Compound `adjustmentType`

We introduce one new `adjustmentType`: `'compound'`. The pipeline registers a single shader pass for `compound` nodes that loops through the node's params, dispatches each `${op}.${param}` to the *existing* per-op shader pass with that value, and writes the output to the ping-pong target.

This keeps the renderer change minimal: no new shaders, no new uniform layouts. The compound pass is a dispatcher, not a shader. It runs inside the per-layer pipeline after the basic adjustments and before the LUT.

**One open question:** order of operations across ops. The proposed default: replay the existing pipeline order (`light` → `color` → `hsl` → `kelvin` → `curves` → `levels` → `filters` → `clarity` → `sharpen` → `blur`). Compound widgets that need a different order list it in their `ProcessingDefinition.compoundOrder?: string[]`.

## 6. Widget: Time-of-Day Dial

**Topology:** 1-D slider, position ∈ [0, 1].

**Anchors:** 5 hand-tuned points along the day. Initial values (calibrated from cinematography Kelvin charts + landscape-photo conventions; tune empirically):

| id | position | kelvin | exp | contrast | high | shadow | vibrance | orange_sat | blue_sat | vignette |
|----|----------|--------|-----|----------|------|--------|----------|------------|----------|----------|
| dawn | 0.10 | 3200 | -0.3 | -8 | -15 | +20 | +5 | +10 | +15 | -10 |
| noon | 0.30 | 5500 | 0 | +10 | 0 | 0 | 0 | 0 | +15 | 0 |
| golden | 0.55 | 3400 | +0.2 | +5 | -20 | +10 | +12 | +25 | -5 | -8 |
| blue | 0.80 | 8500 | -0.5 | +15 | -10 | +5 | +5 | -25 | +20 | -15 |
| night | 1.00 | 4200 | -1.2 | +25 | -40 | -10 | +8 | -10 | +15 | -30 |

These are starting values, not gospel. Calibrated during implementation against ~10 reference images.

**UI:**
- A horizontal scrubber with 5 labelled tick marks (Dawn / Noon / Golden / Blue / Night).
- Background gradient hints at colour temperature along the scrubber.
- Below: the live compiled read-out (§3.5).

**Toolrail icon:** `Sun` (lucide-react).

## 7. Widget: Mood Pad

**Topology:** 2-D pad, position ∈ [0,1]².

**Anchors:** 4 corner recipes.

| id | position | feel | notable params |
|----|----------|------|----------------|
| warm-calm | (0, 0) | sun-drenched, gentle | kelvin 5200, exp +0.1, contrast -5, vibrance +5, vignette -10 |
| warm-dramatic | (1, 0) | golden, contrasty | kelvin 3600, exp +0.2, contrast +20, highlights -15, orange sat +20, vignette -25 |
| cool-calm | (0, 1) | overcast, soft | kelvin 6500, exp 0, contrast -8, vibrance -5, blue sat +5 |
| cool-dramatic | (1, 1) | moody, blue-hour | kelvin 8800, exp -0.4, contrast +18, shadows -20, blue sat +25, vignette -20 |

Bilinear interpolation across the 4 corners in Oklab.

**UI:**
- Square pad, ~140×140 px.
- Draggable puck.
- Corners labelled.
- Live compiled read-out below.

**Toolrail icon:** `Sparkles` (lucide-react).

## 8. Widget: Palette Harmony

Unlike A and B, this widget's input isn't a position on a dial — it's the *current image palette* plus a *chosen rule*.

**Inputs:**
1. The existing info-tab palette (`enriched_context.color_palette`).
2. A rule selection: `complementary` | `triadic` | `split-complementary` | `analogous`.
3. A "strength" slider (0–100).

**Algorithm:**
1. Reduce `color_palette` to up to 3 dominant hues (by `weight`).
2. Pick a *anchor hue* — the highest-weight swatch.
3. For the chosen rule, compute the target hue positions on the wheel.
4. Diff current dominant hues from their nearest target → produce small hue rotations and saturation adjustments.
5. Map to existing `hsl` per-band params via the 8-band model already in the engine. (Each dominant hue's rotation is distributed across its 1–2 neighbouring bands by hue distance.)
6. Apply at `strength / 100` magnitude.

**UI:**
- Small colour wheel (~120×120 px) with the image's current dominant hues pinned on it.
- Four rule chips: Complementary · Triadic · Split · Analogous. Selected one is filled.
- Strength slider.
- Live compiled read-out below.

**Toolrail icon:** `Palette` (lucide-react).

**Cross-widget contract:** Palette Harmony *reads* `enriched_context.color_palette` via a new `useEnrichedPalette()` hook in `src/hooks/`. The hook returns `[]` if the context isn't ready, and the widget shows a "waiting for image analysis…" empty state. The info-tab's `ColorSection` is not modified; the data dependency is one-way (Harmony reads, info-tab also reads, neither writes).

## 9. Toolrail Real-Estate

CLAUDE.md states the toolrail is 6 buttons (Light / Color / White Balance / Curves / Levels / Filters). Three new toolrail entries would push it to 9. Two paths:

- **Path A (preferred):** Add a "Creative" toolrail group below the existing 6, separated by a hairline divider. New buttons: Mood / Time-of-Day / Palette Harmony.
- **Path B:** Hide behind a "More" expander.

Path A is more discoverable and matches the editor's design register. The CLAUDE.md sentence needs updating after merge: "**Toolrail is 6 adjust + 3 creative buttons**."

## 10. Tier Roadmap (Follow-ups)

This spec is **Tier 1** for all three widgets — no AI in the loop, hand-tuned anchors, global application.

**Tier 2 — Vision anchor (separate spec).**
- One vision call returns a single number in [0, 1] for "where on the dial does this image currently sit?"
- The dial's neutral position moves to that number. Drag distance becomes honest about how far from the source you've travelled.
- Mood Pad gets a 2-D version returning `(x, y)`.
- Palette Harmony already has its anchor from the image palette — no Tier 2 needed.

**Tier 3 — Per-region modulation (separate spec).**
- Use the existing segmentation pipeline (`sky`, `subject`, `foreground`, `background`) to scale per-region magnitudes.
- Sky takes the brunt of WB shifts; skin gets a protector.
- Compound node gains an optional `regionScaling: Record<string, number>` field.

**Tier 4 — Travel-gating (separate spec).**
- A naïve noon → night journey on a midday photo produces mud (the image doesn't contain the artificial lights that make real night look good).
- Detect when the dial is asking for something the image can't produce; gate the slider range with visible hard stops.
- Heuristic-first; learned ceiling later.

## 11. Risks & Open Questions

- **Compound order.** Default-replaying the existing pipeline order is plausible but untested. Open: do we need per-widget `compoundOrder`?
- **Oklab implementation.** Adding ~30 LoC of colour conversion. Reviewable, well-known transform.
- **Skin will look bad on big WB swings until Tier 3.** Accept and document.
- **Palette Harmony depends on enriched_context arriving.** If the image hasn't been analysed yet, the widget is empty. UX is "show a waiting state, don't block the widget from spawning."
- **Anchor calibration is an empirical exercise.** First values are a guess; expect 1–2 days of iteration with reference images. Plan for this in the implementation timeline.
- **Toolrail growth.** Adding three buttons. Decision pending — Path A in §9 is the recommendation, but needs Anton's call.

## 12. Acceptance Criteria

- All three widgets register cleanly via `registerAllProcessing()`.
- Toolrail buttons spawn them through `backendTools.propose_widget` with `origin: 'tool_invoked'`.
- Dragging the dial / pad / strength slider updates the canvas with the 300 ms debounce expected of other widgets.
- The live compiled read-out renders below the dial and updates in real time.
- The "convert to manual widgets" button decomposes the compound node into individual adjust widgets and leaves the canvas pixel-identical.
- Palette Harmony reads `enriched_context.color_palette` and shows an empty state when it isn't ready.
- The compound `adjustmentType` works inside the existing per-layer pipeline without touching other widgets' shaders.
- `npm run check` passes; no `no-nested-component` violations; design tokens used throughout.
- Each widget has a snapshot test for its body and an interpolation test for its anchors.

## 13. References

- Brainstorming transcript: this session, 2026-06-02.
- Backlog of conventional widgets (not in scope): [`docs/superpowers/widget-backlog.md`](../widget-backlog.md).
- Existing palette source: `src/types/enriched-context.ts` (`ColorSwatchData`, `color_palette`).
- Existing canonical param plumbing: `src/hooks/useCanonicalParam.ts`.
- Oklab colour space: Björn Ottosson, 2020 — well-documented public-domain transform.
- Cinematography Kelvin references: ASC Manual; Roger Deakins lighting notes (public talks).
