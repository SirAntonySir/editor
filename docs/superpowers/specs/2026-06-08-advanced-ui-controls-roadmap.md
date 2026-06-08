# Advanced UI Controls Roadmap

**Status:** Brainstorm / planning
**Date:** 2026-06-08
**Context:** Post Tool SSoT Registry. The registry's `control_type` vocabulary now has 8 entries, all wired end-to-end. Several are v1 stubs. This document maps the path from v1 to "real" controls and proposes a slate of new control types worth adding.

---

## 1. Current state inventory

### Registry-driven controls (`src/components/registry-controls/`)
| Control | v1 quality | Backing primitive | Used by ops |
|---|---|---|---|
| `Slider` | Production | `inspector/AdjustmentSlider` | light, color, sharpen, blur, clarity, grain, vignette, splitTone, hsl (24×) |
| `Swatch` | Stub (lossy HSV↔hex via `<input type="color">`) | `ui/Swatch` + native picker | none in production yet |
| `HueWheel` | Stub (gradient slider standing in for a wheel) | `AdjustmentSlider` w/ gradient | color.hue, splitTone shadow/highlight hue |
| `CurveEditor` | Functional after Follow-up D (per-channel) | `inspector/widget/primitives/CurveEditor` | curves (4 channel bindings) |
| `PointList` | Debug JSON textarea | — | none |
| `EnumSelect` | Functional (native `<select>`) | — | none |
| `BoolToggle` | Functional (native checkbox) | — | none |
| `KelvinStrip` | Stub (slider w/ blackbody gradient) | `AdjustmentSlider` w/ gradient | kelvin.kelvin |

### Bespoke Panels preserved (`src/processing/`)
| Op | Why preserved |
|---|---|
| `curves.tsx` | Multi-channel curve UI with channel tabs (now also covered by registry CurveEditor; bespoke could be retired) |
| `hsl.tsx` | Color-band band wheel UI for 8 bands × 3 channels |
| `levels.tsx` | Live histogram with draggable black/white/gamma markers |
| `filters.tsx` | LUT picker — not modeled in registry |
| `time-of-day.tsx` | Compound widget with per-key cards — not modeled in registry |

---

## 2. v1 → production roadmap per existing control

### Slider — production-grade today
Nothing to do. Already wraps `AdjustmentSlider` which has double-click reset, keyboard nudge, hover tooltips, and the project's design tokens.

### Swatch / Color picker — needs real picker
**Today:** Round-trips through native `<input type="color">` (RGB hex only). Loses HSV precision, no alpha, no presets, no eyedropper.

**Desired:**
- HSV color picker popover (hue wheel + saturation/value rectangle + hex input)
- Optional alpha slider when `schema.show_alpha === true`
- Preset swatch row (from `schema.presets` field on the registry op)
- Eyedropper button on canvas (uses `EyeDropper` Web API where available)

**Effort:** ~3-5 hours. Build the popover as `src/components/ui/ColorPicker.tsx`; Swatch.tsx becomes a thin wrapper.

**Dependencies:** none structural. The op JSON's `color_hsv` param type is already in the schema.

### HueWheel — needs an actual wheel
**Today:** A horizontal slider with a hue gradient. Functional but not a wheel.

**Desired:**
- SVG circular wheel, drag-to-select hue
- Inner triangle/square for saturation+value when used as part of a full color picker
- Or, when used standalone (e.g. `splitTone.shadow_hue`), just the outer wheel ring
- Discrete tick marks at primary colors (R/G/B/CMY)

**Effort:** ~4-6 hours. The math is simple (atan2 → degrees); the styling and pointer events are the time sink.

**Recommendation:** Build this as part of the ColorPicker work above (shared SVG primitives). Standalone HueWheel becomes a degenerate case of the full picker.

### CurveEditor — functional after Follow-up D, room to grow
**Today:** Per-channel point-list editor. Drag points, double-click to add/delete, channel locking from `paramKey`. Backed by the bespoke `curves.tsx` primitive's drag logic.

**Desired (in order of value):**
1. **Catmull-Rom spline interpolation** between control points (smoother visuals; currently piecewise cubic). Mostly a math change in `evaluateCubicSpline`.
2. **Histogram backdrop** showing the per-channel luminance distribution of the active image so the user knows where the data is.
3. **S-curve / contrast preset chips** (3-tap presets above the editor: "Linear", "Soft S", "Strong S", "Lift blacks", "Crush whites").
4. **Per-channel toggle row** for quickly comparing R/G/B against the master without leaving the panel (orthogonal to channel locking — show R+G+B overlaid for reference).
5. **Numeric input cells** for each anchor point (precision editing).

**Effort:** 1 = 2 hours; 2 = 3 hours; 3 = 1 hour; 4 = 2 hours; 5 = 3 hours. Pick 1 and 3 first — biggest perceptual upgrade for least time.

### PointList — keep as fallback, don't polish
Debug textarea is fine. Real users never see it. Skip.

### EnumSelect / BoolToggle — production-grade
`<select>` and `<input type="checkbox">` are fine. Could be styled, but the registry-controls layer doesn't currently use them in any op so cost-benefit is poor.

If/when used, consider styled radio chips for EnumSelect (3-4 options visible at once, no dropdown).

### KelvinStrip — needs the strip metaphor
**Today:** Slider with a warm→cool gradient track.

**Desired:**
- Wider strip (height ≥ 32px) with the blackbody color spectrum from 2000K (deep amber) → 10000K (cool blue)
- Draggable marker showing current value
- Optional "AWB" auto-button that asks the backend for an estimated white-balance from `image_context`
- Tint slider (already separate param) shown beneath in a green-magenta gradient

**Effort:** ~3 hours for the strip + marker, +2 hours if we wire the AWB call.

---

## 3. Bespoke Panel migration paths

These have rich UI not yet replicated by registry controls. Two paths each:

### `curves.tsx`
Now that registry CurveEditor exists and is multi-channel after Follow-up D, the bespoke Panel is mostly redundant. **Recommend retiring** after Follow-up D's CurveEditor gets the catmull-rom + histogram backdrop improvements (then registry version is strictly better).

### `hsl.tsx`
The 8-band wheel UI is genuinely hard to replicate with the current control vocabulary. Two options:
- **Option A**: Add a new `hsl_wheel` control_type that renders the full 8-band UI as one control, with `paramKey` indicating which band+channel to bind. The op JSON's 24 bindings collapse to 1 (or to 8 — one per band).
- **Option B**: Keep `hsl.tsx` bespoke indefinitely. HSL is a specialty enough case that the bespoke approach is sustainable.

**Recommend Option A** — adds a new control_type that's reusable conceptually (a "color-banded multi-slider").

### `levels.tsx`
Live histogram is the value. The black/white/gamma slider trio is the rest. Two options:
- **Option A**: Add a `levels_histogram` control_type that bundles all 3 markers + histogram in one control. The op JSON's 5 bindings (inBlack, inWhite, gamma, outBlack, outWhite) become 1 or 2 (Input strip + Output strip).
- **Option B**: Add a generic `histogram_backdrop` flag on `Slider` that draws a histogram behind the track. Less powerful but lower commitment.

**Recommend Option A** — the perceptual UX is what makes Levels useful; bundling the markers with the histogram is the point.

### `filters.tsx` (LUT)
Not in the registry. Two options:
- **Option A**: Add a `lut_browser` control_type. The op JSON declares `filter` as a registry op with one param `lut_id: enum`. The control renders LUT preview chips.
- **Option B**: Keep filters as a special case forever. LUTs are inherently asset-backed (load `.cube` files), which is a different concern from numeric params.

**Recommend Option A** — even though LUTs are assets, the *selection* is just an enum. The control can render previews from a separate asset pipeline.

### `time-of-day.tsx` (compound)
The compound widget concept is bigger than a single control. Three options:
- **Option A**: Add a `key_card_list` control_type that renders compound bundles as cards. Generalize to other compound ops if any emerge.
- **Option B**: Treat compound widgets as a *layout* concern, not a control concern. The widget's bindings list maps to multiple controls; the layout is bespoke.
- **Option C**: Keep `time-of-day.tsx` bespoke and never touch it.

**Recommend Option B** — the existing layout-via-bespoke-Panel approach is fine for one-offs. Generalize only if a second compound op needs the same UI.

---

## 4. New control types worth adding

Ordered by user-visible impact:

### `range_slider` (dual-handle slider)
For params that are pairs (e.g. `levels` input range). Today represented as two separate Sliders; bundling them shows the range as a continuous band.

**Effort:** ~2 hours. Backed by a single `<input type="range">` is impossible (no native dual-handle); needs a custom SVG track + two thumbs.

### `gradient_picker`
A horizontal strip that lets the user define a gradient between two colors. For split-tone, the gradient between shadow and highlight tone is the natural visualization. Today: 4 separate hue/sat sliders.

**Effort:** ~6 hours. Combine the two-color piece with a balance slider inline.

### `vector_pad`
2D drag pad for params that have two coordinates (e.g. `vignette.center: [x, y]` — currently not in our schema but worth adding). Drag a dot inside a square.

**Effort:** ~3 hours.

### `wavelet_strip` / `frequency_bands`
Multi-band detail/clarity adjustment (e.g. 4 sliders for low/mid/high/very-high frequency bands). For advanced texture work.

**Effort:** ~4 hours UI + significant shader work to support frequency decomposition. Defer unless there's user demand.

### `point_3d` / `bezier_handle`
For curves that need tangent handles (full bezier control). Not currently needed but interesting if Catmull-Rom proves insufficient.

**Effort:** ~5 hours. Defer.

### `mask_brush`
For local adjustments — user paints a mask directly on the canvas, then a per-mask widget controls the local edit. Conceptually big (touches canvas interaction). Today the mask layer is backend-mediated (SAM).

**Effort:** ~12 hours. Worth doing as part of the "local adjustments" sprint, not this UI sweep.

### `time_position` (compound bundle pointer)
For time-of-day specifically: a horizontal strip with key icons (sunrise/noon/sunset/night) and a slider that interpolates between them. Today this is the bespoke compound bundle UI.

**Effort:** ~5 hours, but only valuable if compound bundles become common. Defer.

---

## 5. Recommended sequencing

If we're allocating ~2 weeks to "advanced UI inputs," I'd order:

| Week | Focus | Deliverables |
|---|---|---|
| Week 1 — Day 1-2 | **CurveEditor upgrades** | Catmull-Rom + preset chips + histogram backdrop. Retire bespoke `curves.tsx`. |
| Week 1 — Day 3-4 | **ColorPicker + HueWheel** | Real SVG picker. Swatch becomes a swatch. Wired to splitTone + color.hue. |
| Week 1 — Day 5 | **KelvinStrip + AWB hook** | Wider strip + AWB autobutton calling `image_context.suggested_kelvin`. |
| Week 2 — Day 1-2 | **`levels_histogram` control type** | New control with bundled histogram + input/output strips. Retire bespoke `levels.tsx`. |
| Week 2 — Day 3-4 | **`hsl_wheel` control type** | The 8-band wheel as a registry control. Retire bespoke `hsl.tsx`. |
| Week 2 — Day 5 | **`range_slider` + apply to levels Input** | Dual-handle slider for the `inBlack`/`inWhite` pair. |

After this, only `filters.tsx` and `time-of-day.tsx` would remain bespoke — both for sensible reasons (LUT assets + compound layout).

---

## 6. Out of scope here (own follow-up specs)

- **Save-preset UI** (writes to `~/.editor/presets/` via the multi-source loader)
- **`.edp` project-embedded presets**
- **AI-driven control-type hinting** (let the planner suggest *which* control_type best fits a param at spawn time, e.g. "use hue_wheel here because the param is angular")
- **Touch-friendly variants** of all controls (tablet support)
- **Accessibility** sweep (keyboard navigation, ARIA, focus rings) — should be its own pass once the control surface stabilizes
