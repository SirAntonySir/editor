# HSL Panel Redesign — Colour-Driven Two-View Inspector — Design

**Date:** 2026-05-31
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude (brainstorming session)

## 1. Problem & Context

The 8-band HSL **engine** is complete and shipping: the shader
([hsl.glsl.ts](../../../src/shaders/hsl.glsl.ts)) applies per-band hue rotation,
saturation scale, and luminance shift weighted by circular hue distance; the op is
registered with 24 contract-checked params; the pipeline binds per-band uniform arrays.
What is missing is the **UI**. The current panel
([HslSectionBody.tsx](../../../src/components/inspector/adjustments/HslSectionBody.tsx))
renders all 24 params as a flat vertical wall — 8 bands × 3 sliders — with text-only
labels:

- 24 identical rows; nothing distinguishes reds from blues at a glance.
- No colour cues — you read labels, you don't see colour.
- Taller than the inspector rail, so it scrolls.
- No "what have I touched?" overview — every band looks equally inert.
- Heavy `Hue / Sat / Lum` repetition (8×), low signal density.

Good HSL panels (Lightroom, Capture One, Photoshop) solve this with **colour**: coloured
tracks, swatch pickers, channel views. This spec redesigns the panel to do the same,
within the editor's minimal-flat register. **It is frontend-only — no engine, shader,
backend, or param-contract change.**

### Current architecture (verified live)

- **Param surface.** [hsl.tsx](../../../src/processing/hsl.tsx) defines
  `BANDS = [red, orange, yellow, green, aqua, blue, purple, magenta]` and
  `CHANNELS = [hue, sat, lum]`, producing 24 param keys of the form `${band}_${channel}`
  (e.g. `blue_sat`), each `min: -100, max: 100, default: 0`. `adjustmentType: 'hsl'`,
  `category: 'adjust'`.
- **Where it renders.** The adjustments accordion
  ([AdjustmentsAccordion.tsx](../../../src/components/inspector/adjustments/AdjustmentsAccordion.tsx))
  lists `ProcessingRegistry.getByCategory('adjust')`;
  [ToolSection.tsx](../../../src/components/inspector/adjustments/ToolSection.tsx)
  switches on `adjustmentType === 'hsl'` and renders
  `<HslSectionBody layerId={layerId}/>` when the section is expanded and a `layerId`
  exists. **This switch and prop contract are unchanged by this work.**
- **Read/write path.** Each param flows through
  [useCanonicalParam.ts](../../../src/hooks/useCanonicalParam.ts)`(layerId, 'hsl', key, 0)`
  → reads optimistic patch then `canon:<layer>:hsl` node params; writes apply an
  optimistic patch immediately (live canvas) then debounce 300 ms → `set_param`. Offline
  (`sseStatus !== 'open'`) is a no-op write.
- **Provenance + touch.** The scalar pattern
  ([ScalarSectionBody.tsx](../../../src/components/inspector/adjustments/ScalarSectionBody.tsx))
  wraps each slider with
  [useParamProvenance](../../../src/hooks/useParamProvenance.ts)`(layerId, op, key, value, default)`
  and calls `markParamTouched(touchKey(...))` on human change, so a hand-moved slider
  reads accent-blue, an AI-set one violet, untouched grey.
- **Slider primitive.**
  [AdjustmentSlider.tsx](../../../src/components/inspector/AdjustmentSlider.tsx) is a Radix
  slider with a **hidden thumb** and a **gradient fill from `min`**, drag-to-scrub numeric
  readout, click-to-type, double-click-to-reset. Fill colour is driven by `provenance`.
- **Visual register.** [design.md](../../../design.md) is authoritative: minimal flat,
  light default, Geist, 8-pt grid, tokens only (`--color-accent` #0071e3, `--color-ai`
  #7c5cff, `--color-text-secondary`, `--color-surface-secondary`, `--color-separator`,
  radius/motion tokens). No hardcoded hex/px for design quantities.
- **No shared segmented control.** Grep finds a hand-rolled segmented control only inside
  [InspectorPanel.tsx](../../../src/components/inspector/InspectorPanel.tsx); there is no
  reusable `ui/` primitive.

## 2. Goals & Non-Goals

**Goals**
- Replace the 24-slider wall with a colour-driven, two-view panel that fits the rail
  without scrolling and reads as *colour*.
- Reuse the existing canonical read/write, provenance, and touch machinery verbatim.
- Follow the strict 3-tier component architecture; extract genuinely cross-domain pieces
  to `ui/`, keep HSL-specific pieces topic-local.

**Non-Goals (explicitly deferred)**
- The **targeted drag-on-image tool** (grab a colour, drag to push its band). This needs
  new plumbing that does not exist yet — pointer-event dispatch from the image node to the
  active tool, image-space coordinate mapping, pixel hue-sampling, an on-canvas HUD
  overlay, and feather-across-bands gesture math. Captured in §10 as a future card.
- Any engine, shader, backend, param-contract, or `ProcessingDefinition` schema change.

## 3. UX Design

A `By band / By channel` **segmented toggle** sits at the top of the panel body, always
visible. Each view shows the selector for the dimension it holds fixed.

```
By band (default)                  By channel
┌───────────────────────────┐      ┌───────────────────────────┐
│ HSL                    ↗ ⌃ │      │ HSL                    ↗ ⌃ │
├───────────────────────────┤      ├───────────────────────────┤
│ [ By band | By channel ]  │      │ [ By band | By channel ]  │
│ ▣▣▣▣▣▣▣▣   ← swatch rail   │      │ [ Hue | Sat | Lum ]  tabs │
│ Editing Blue              │      │ ▣ ───●──────────  +34     │  (8 band rows:
│ Hue  ───────●────  +30    │      │ ▣ ──────●───────   −8     │   swatch + colour
│ Sat  ────●───────  −18    │      │ ▣ ────────●─────   ·      │   track + value)
│ Lum  ───────●────   0     │      │ … 8 rows total            │
└───────────────────────────┘      └───────────────────────────┘
```

- **By band** (default view, default active band = `red`): the **swatch rail** shows 8
  colour chips. Clicking one sets the active band; an **edited dot** (top-right of the
  chip) marks any band with ≥1 non-default param. Below: an `Editing <Band>` label and the
  active band's 3 colour-track sliders (Hue/Sat/Lum). Only 3 sliders on screen → compact.
- **By channel** (default active channel = `hue`): a `Hue / Sat / Lum` **tab strip**, then
  8 rows — one per band — each a small swatch + a colour-gradient track + numeric value.
  See all bands for one channel at once (e.g. "shift all the blues").
- Only the **visible** view's sliders mount, so at most 8 `useCanonicalParam`
  subscriptions are live at a time (vs 24 always today) — a net reduction.

### Track semantics — the track *is* the gradient of what the slider does

Unlike the global sliders (fill from `min`), HSL params are **bipolar** (−100…+100) and
**about colour**, so the track shows a colour gradient and a **visible thumb dot** marks
the value, with centre = 0. Per channel, for a band whose display colour is `C` and whose
hue-neighbours are `C₋` / `C₊`:

- **Hue:** `linear-gradient(90deg, C₋, C, C₊)` — rotating left/right previews the hue shift
  direction.
- **Saturation:** `linear-gradient(90deg, <grey>, C)` — desaturated → saturated.
- **Luminance:** `linear-gradient(90deg, <dark C>, C, <light C>)` — darken → lighten.

### Provenance moves to the thumb

Because the track is now colour, provenance can no longer be the fill. The **thumb dot's
border** carries it: hand = `--color-accent`, AI = `--color-ai`, default =
`--color-text-secondary` (the colour `AdjustmentSlider`'s `fillColorFor` already uses for
default provenance). The swatch-rail **edited dot** follows the strongest provenance among
that band's 3 params (hand > AI > none).

### Preserved interactions

Drag-the-number to scrub, click-to-type, double-click-to-reset a single param, offline
disables writes — all inherited from `AdjustmentSlider`, unchanged. A section **Reset**
(in the body footer) clears all 24 HSL params to 0 (mirrors the existing per-op reset
pattern, guarded by `sessionId && !offline`).

## 4. Visual & Token Details

- **Band colours are derived, not hardcoded.** A new `HSL_BANDS` constant is the single
  source of band metadata: `{ key, label, centerHue }`, where `centerHue` mirrors the
  shader's `CENTERS` (`hsl.glsl.ts`): red 0.0, orange 0.0833, yellow 0.1667, green 0.3333,
  aqua 0.5, blue 0.6667, purple 0.75, magenta 0.8333. The display swatch/track colours are
  computed from `centerHue` via a small `bandDisplayColor(centerHue)` helper
  (`hsl(centerHue·360, ~90%, ~55%)` → RGB). This keeps every chip aligned with the hue it
  actually targets and avoids magic hex. *(Known minor duplication: the shader still
  hardcodes `CENTERS`; unifying that is out of scope here — noted in §10.)*
- **Theme/structural colours** (`accent`, `ai`, `text-secondary`, `surface-secondary`,
  `separator`, radii, motion) use design tokens per `design.md`. The only non-token colours
  are the **band hues**, which are *data* (fixed hue centres), exactly as the existing
  [Swatch.tsx](../../../src/components/ui/Swatch.tsx) primitive takes raw `rgb`.
- Sizes on the 8-pt grid: swatch chip 22 px (rail) / 13 px (row), track 3 px, thumb 8 px,
  label 10 px, numeric `.num` 9 px — consistent with the current panel.

## 5. Component Architecture

Per the strict 3-tier rules in [CLAUDE.md](../../../CLAUDE.md) / `design.md` — reuse before
invent, no inline-defined components, cross-domain → `ui/`, topic-local → topic folder.

**New `ui/` primitive (cross-domain):**
- `ui/Segmented.tsx` — generic controlled segmented control
  `Segmented<T>({ options: { value: T; label: string }[]; value: T; onChange })`. Extract
  the markup the inspector header hand-rolls in `InspectorPanel.tsx` and refactor that call
  site to consume the new primitive (kept identical visually). Tokens only.

**Extended `inspector/` component (backward-compatible):**
- `AdjustmentSlider.tsx` gains an additive, optional `trackGradient?: string`. When set:
  the track background = that gradient, the `Slider.Range` fill is omitted, the thumb
  becomes a **visible** dot whose border colour = the provenance colour. When unset,
  behaviour is byte-for-byte unchanged for all existing callers. Scrub/type/reset logic is
  untouched.

**New topic-local components (`inspector/adjustments/`):**
- `hsl-bands.ts` — `HSL_BANDS` metadata + `bandDisplayColor()` + track-gradient builders
  (`hueTrack(band)`, `satTrack(band)`, `lumTrack(band)`).
- `HslSectionBody.tsx` — **rewritten.** Same props `{ layerId: string }`. Owns view mode /
  active band / active channel as local `useState`. Renders the toggle + the active view.
- `HslBandRail.tsx` — the 8-chip rail; props: active band, per-band edited-provenance,
  `onSelect`.
- `HslBandSliders.tsx` — the 3 colour-track sliders for one band (composes
  `AdjustmentSlider` with `trackGradient`).
- `HslChannelRows.tsx` — the tab strip + 8 band rows for one channel.

No change to `ToolSection.tsx`, `AdjustmentsAccordion.tsx`, `hsl.tsx`, or any
type/registry — `HslSectionBody`'s signature is preserved.

## 6. State & Data Flow

- **Pixel-affecting params:** unchanged. Each visible slider uses
  `useCanonicalParam(layerId, 'hsl', '<band>_<channel>', 0)` + `useParamProvenance(...)` +
  `markParamTouched(touchKey(layerId, 'hsl', key))` on human change — identical to
  `ScalarSectionBody`. Writes are optimistic + debounced `set_param`.
- **Edited / provenance overview:** one selector reads the `canon:<layerId>:hsl` node's
  params (optimistic-merged, same precedence as `useCanonicalParam`) to compute, per band,
  whether any of its 3 params ≠ 0 and the strongest provenance — feeding the rail dots.
  This is a single read, not 24 hooks.
- **UI-only state** (view mode, active band, active channel) is panel-local `useState` —
  not Zustand, not backend. This honours the Engine-SSoT doctrine: nothing here touches
  pixels. State resets naturally when the section unmounts; persistence across
  collapse/expand is not required.

## 7. Edge Cases & Error Handling

- **No layer / collapsed:** `ToolSection` already gates the body on `expanded && layerId`,
  so the panel only mounts with a real `layerId`.
- **Offline:** every write path already no-ops when `sseStatus !== 'open'`; the section
  Reset is disabled. Sliders remain visible showing last-known values.
- **Band with no edits:** no rail dot; sliders sit at centre (0).
- **AI-set params:** thumb/dot read violet via the existing provenance hook; switching
  views or bands never loses this (it derives from canonical, not local state).
- **Reduced motion / theme:** inherited from tokens; no theme branching in JSX.

## 8. Testing

- `Segmented` — renders options, calls `onChange`, reflects controlled `value`; the
  refactored `InspectorPanel` still switches sections.
- `AdjustmentSlider` — regression: without `trackGradient` the DOM/behaviour is unchanged
  (fill present, thumb hidden); with `trackGradient` the fill is absent and the thumb dot
  border reflects provenance.
- `HslSectionBody` — toggling views swaps rail↔tabs; selecting a band shows its 3 sliders;
  changing a slider calls `set_param` with the correct `<band>_<channel>` key and marks it
  hand-touched; the rail edited-dot appears for a non-zero band and clears on reset; the
  channel view shows 8 rows for the active tab; section Reset zeroes all params.
- `hsl-bands` — `bandDisplayColor` is deterministic; `centerHue` values match the shader
  `CENTERS`.

## 9. Files Touched

**New**
- `src/components/ui/Segmented.tsx`
- `src/components/inspector/adjustments/hsl-bands.ts`
- `src/components/inspector/adjustments/HslBandRail.tsx`
- `src/components/inspector/adjustments/HslBandSliders.tsx`
- `src/components/inspector/adjustments/HslChannelRows.tsx`
- tests alongside the above (`*.test.tsx`)

**Modified**
- `src/components/inspector/adjustments/HslSectionBody.tsx` (rewritten; same props)
- `src/components/inspector/AdjustmentSlider.tsx` (additive `trackGradient` prop)
- `src/components/inspector/InspectorPanel.tsx` (consume `Segmented`)

**Unchanged (intentionally):** `hsl.glsl.ts`, `hsl.tsx`, `ToolSection.tsx`,
`AdjustmentsAccordion.tsx`, the param contract, all backend.

## 10. Deferred / Future Work — Targeted Adjustment Tool

Captured so it isn't lost. A `hsl-target` `ToolDefinition`
([tool.ts](../../../src/types/tool.ts) already declares `onPointerDown/Move/Up`,
`processingId`, `CanvasOverlay`) that lets the user grab a colour on the image and drag to
push its band. Requires:

1. **Pointer dispatch** from the image node → active tool in image space (does not exist;
   `EditorProvider` only wires `onActivate/onDeactivate` today).
2. **Hue sampling** — `pixelStore.getSource(layerId)` → `getImageData(x,y,1,1)` → hue →
   nearest band(s).
3. **Feather across the 1–2 nearest bands** using the same triangular falloff as the
   shader, so no banding at colour boundaries (chosen behaviour).
4. **HUD overlay** near the cursor (`CanvasOverlay`) showing the grabbed swatch, band name,
   active channel, live value.
5. Picking up the tool flips the panel to **By channel** so the active channel is always
   the visible tab; writes reuse the canonical optimistic + `set_param` path.
6. Possibly unify the shader `CENTERS` with the new `HSL_BANDS` constant at that time.

## 11. Open Questions

None blocking. Minor, decide in implementation: exact saturation/lightness constants in
`bandDisplayColor`; whether to add a per-band "reset band" affordance in By-band view
(nice-to-have beyond the global Reset).
