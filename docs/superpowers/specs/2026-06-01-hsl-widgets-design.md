# HSL Widgets — All-Bands & Single-Band, Spawnable From Tools — Design

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude (brainstorming session)

## 1. Problem & Context

We just shipped the colour-driven HSL **inspector panel** (`2026-05-31-hsl-panel-redesign-design.md`).
Now we want HSL as **on-canvas widgets**, in two forms, both creatable from the tools the
way Light/Color are:

1. **All-bands** — the full two-view HSL panel as a widget.
2. **Single-band** — a focused 3-slider widget for one colour (e.g. "Blue"), **locked at
   spawn** (chosen via a colour popover on a new "Colour band" tool; to target another
   colour, spawn another).

### Current architecture (verified live)

- **Widgets are backend-composed.** A toolrail/`tool_invoked` click calls
  [`propose_widget`](../../../backend/app/tools/widgets/propose_widget.py); for
  `origin: 'tool_invoked'` it builds the widget from
  [`TOOL_DEFAULTS[fused_tool_id]`](../../../backend/app/tools/tool_defaults.py)
  (`{nodes, bindings}`), validating that the id exists. `TOOL_DEFAULTS` is auto-generated
  from each op's `toolDefaults` array in
  [`shared/engine-registry.json`](../../../shared/engine-registry.json) via
  `_scalar_tool(op)` over `_SCALAR_OPS = ("light","color","kelvin","levels")`.
- **HSL is registered in the engine** (24 params `<band>_<channel>`) but `hsl.toolDefaults`
  is `[]` and `hsl` is **not** in `_SCALAR_OPS` → `TOOL_DEFAULTS['hsl']` does not exist, so
  the HSL section's existing "Open on canvas" ([`promote.ts`](../../../src/components/inspector/adjustments/promote.ts),
  `fused_tool_id: 'hsl'`) currently fails validation. **This is the only thing blocking the
  all-bands widget.**
- **`WidgetShell` renders a flat list.** [`WidgetShell`](../../../src/components/widget/WidgetShell.tsx)
  maps `widget.bindings` → [`BindingRow`](../../../src/components/inspector/widget/BindingRow.tsx),
  writing via `set_widget_param`. For an HSL widget that's a 24-row (or 3-row) wall — not
  the colour UI.
- **The inspector HSL panel is canonical-coupled.** `HslSectionBody`/`HslParamSlider` use
  `useCanonicalParam` → `set_param`. A widget must instead drive the SAME UI from
  `widget.bindings` → `set_widget_param`.
- **Tools list.** [`AdjustmentsAccordion`](../../../src/components/inspector/adjustments/AdjustmentsAccordion.tsx)
  renders `ProcessingRegistry` adjust+filter defs as `ToolSection`s. There is no separate
  left toolrail; "tools" = these rows (each with an "Open on canvas" arrow).

## 2. Goals & Non-Goals

**Goals**
- All-bands HSL widget rendering the two-view colour panel, spawned by the existing HSL
  "Open on canvas".
- Single-band HSL widget (locked colour) rendering 3 colour sliders, spawned by a new
  "Colour band" tool via a swatch popover.
- Both widgets reuse the inspector's colour UI verbatim, differing only in data source.

**Non-Goals**
- The targeted drag-on-image tool (still deferred).
- Per-widget isolation of HSL params (see §3.5 overlap caveat).
- LLM-composed HSL fused template (future; this is the `tool_invoked` path only).

## 3. Design

### 3.1 One presentational core, two data adapters

Lift the inspector panel's presentation + layout into a **source-agnostic core** and inject
the per-param data binding:

- **`HslPanelView`** (new, shared) — owns the UI state (view mode / active band / active
  channel) and renders the toggle + rail + colour-track sliders. It takes **injected
  accessors**, not hooks:
  - `renderSlider(param: string, label: string, trackGradient: string): ReactNode`
  - `bandEdited(bandKey: string): boolean` (for the rail dots)
  - `onReset(): void`
- **`HslSingleBandView`** (new, shared) — renders one locked band's 3 colour sliders via the
  same `renderSlider` + `onReset`.
- The existing `HslBandRail` / `HslBandSliders` / `HslChannelRows` are generalised from
  canonical-coupled to **prop-driven** (`renderSlider` / `bandEdited`).

Two thin adapters supply the accessors:

- **Canonical adapter** = the rewritten `HslSectionBody` (inspector). `renderSlider` wraps a
  module-scope `CanonicalHslSlider` (today's `HslParamSlider`: `useCanonicalParam` +
  `useParamProvenance` + `markParamTouched`); `bandEdited` reads `canon:<layer>:hsl`;
  `onReset` zeroes all 24 via `set_param`. **Net behaviour unchanged from what shipped.**
- **Widget adapter** = `HslWidgetBody` (new, in `widget/`). `renderSlider` wraps a
  module-scope `WidgetHslSlider` driven by the matching `widget.bindings` entry →
  `set_widget_param`; provenance via `bindingProvenance`; `bandEdited` from the bindings;
  `onReset` sets each binding to its `default`. It picks **full vs single** view by counting
  distinct bands present in the bindings (1 band → `HslSingleBandView`, else `HslPanelView`).

`renderSlider` is a render callback returning a module-scope component — no inline component
definitions (satisfies `no-nested-component`).

### 3.2 `WidgetShell` routing

`WidgetShell` special-cases HSL widgets — when `fused_tool_id === 'hsl'` or starts with
`'hsl_'` (equivalently: the widget's single node has `type === 'hsl'`), it renders
`<HslWidgetBody widget=… />` instead of the `BindingRow` list. The header, footer (Reset /
Apply; tool-invoked → no Why/Refine), reasoning, hover, and optimistic plumbing are
unchanged.

### 3.3 Single-band create flow — the "Colour band" tool

A new standalone row in the inspector Tools list (`ColourBandToolRow`), rendered by
`AdjustmentsAccordion` alongside the `ToolSection`s. It shows a conic-swatch icon + "Colour
band"; clicking opens a Floating-UI popover of the 8 band swatches. Picking a band calls a
`promoteSingleBand(sessionId, band, layerId)` helper →
`propose_widget({ fused_tool_id: 'hsl_<band>', origin: 'tool_invoked', scope: {kind:'global'}, layer_id })`.
Gated like every tool: disabled when offline or no active layer/image node.

### 3.4 Widget appearance

- All-bands defaults to the compact **By band** view (rail + 3 sliders) so it stays small on
  canvas; the user can flip to By channel.
- Single-band shows the locked colour as a swatch + name in the widget header, then its 3
  colour sliders.

### 3.5 Backend

- Add `hsl` to `_SCALAR_OPS` and set `hsl.toolDefaults` in `engine-registry.json` to all 24
  keys → `TOOL_DEFAULTS['hsl']` (node `type: 'hsl'`, 24 params + 24 bindings).
- Generate `TOOL_DEFAULTS['hsl_<band>']` for the 8 bands with a small dedicated helper:
  node `type: 'hsl'` (NOT `hsl_<band>` — so it shares the one HSL pass / `canon:<layer>:hsl`
  node), `params` = that band's 3 keys at default, `bindings` = those 3 (slider schemas read
  from `ENGINE_OPS['hsl'].params`). The single-band node carries **only** its 3 params, so
  seeding canonical never clobbers other bands.
- **Overlap caveat (accepted):** because all HSL widgets project to `canon:<layer>:hsl`, an
  all-bands widget and a single-band "Blue" widget on the *same layer* edit the same blue
  params — they overlap, exactly as two Light widgets would. No per-widget isolation; this is
  the engine's "one node per (layer, op)" model.

## 4. Component Architecture (3-tier)

**New**
- `inspector/adjustments/HslPanelView.tsx` — shared two-view presentation (UI state +
  `renderSlider`/`bandEdited`/`onReset` props).
- `inspector/adjustments/HslSingleBandView.tsx` — one locked band's 3 sliders.
- `widget/HslWidgetBody.tsx` — widget adapter (bindings → `set_widget_param`); picks
  full/single.
- `widget/WidgetHslSlider.tsx` — binding-driven leaf (wraps `AdjustmentSlider` w/
  `trackGradient`).
- `inspector/adjustments/ColourBandToolRow.tsx` — the Colour band tool row + swatch popover
  (lives with the other Tools-list rows it sits beside).
- `lib/colour-band-spawn.ts` — `promoteSingleBand()` helper (mirrors `promote.ts`).
- tests alongside each.

**Modified**
- `inspector/adjustments/HslSectionBody.tsx` — thin canonical adapter over `HslPanelView`.
- `inspector/adjustments/HslBandRail.tsx` / `HslBandSliders.tsx` / `HslChannelRows.tsx` —
  generalised to `renderSlider`/`bandEdited` props (drop direct canonical coupling).
- `inspector/adjustments/HslParamSlider.tsx` → becomes the canonical `renderSlider` leaf
  (rename to `CanonicalHslSlider` for symmetry with `WidgetHslSlider`).
- `widget/WidgetShell.tsx` — route HSL widgets to `HslWidgetBody`.
- `inspector/adjustments/AdjustmentsAccordion.tsx` — render `ColourBandToolRow`.
- Backend: `tool_defaults.py` (+ `hsl` in `_SCALAR_OPS`, band-variant generator);
  `engine-registry.json` (`hsl.toolDefaults`).

**Unchanged:** `hsl.glsl.ts`, `hsl.tsx`, the engine HSL op, `ToolSection`, `promote.ts`.

## 5. Data Flow

- **All-bands:** HSL section "Open on canvas" → `propose_widget('hsl')` → backend composes
  `type:'hsl'` node + 24 bindings → SSE `widget.created` → `WidgetShell` → `HslWidgetBody`
  (full view) → edits via `set_widget_param(<band>_<channel>)`, optimistic-patched on the
  widget node id.
- **Single-band:** Colour band tool → pick band → `propose_widget('hsl_<band>')` → backend
  composes `type:'hsl'` node + 3 bindings → `HslWidgetBody` (single view, locked band).
- **Inspector:** unchanged canonical path; now expressed through the shared `HslPanelView`.

## 6. Edge Cases & Error Handling

- **Offline / no layer:** Colour band tool disabled; widget writes no-op via the existing
  `set_widget_param` guards.
- **Unknown band in `fused_tool_id`:** backend validates against `TOOL_DEFAULTS`; an
  unrecognised `hsl_<x>` raises `_InvalidInput` (same as any bad id).
- **Single-band view detection:** by distinct-band count in bindings, so a malformed widget
  with mixed bands falls back to the full view rather than crashing.
- **Reset:** widget reset writes each binding's `default` (not canonical) — scoped to that
  widget's params.

## 7. Testing

**Backend**
- `TOOL_DEFAULTS['hsl']` has 24 bindings, node `type == 'hsl'`, params default 0.
- `TOOL_DEFAULTS['hsl_blue']` has exactly the 3 blue bindings, node `type == 'hsl'`, and
  carries only blue params.
- `propose_widget(fused_tool_id='hsl_blue', origin='tool_invoked')` produces a widget with 3
  bindings; `'hsl'` produces 24.

**Frontend**
- `HslWidgetBody` renders the full view for a 24-binding widget (toggle + 8-chip rail) and
  the single view for a 3-binding one (3 sliders, no toggle), and a slider change calls
  `set_widget_param` with the right `<band>_<channel>` key.
- `WidgetShell` routes an `hsl`/`hsl_<band>` widget to `HslWidgetBody`, not `BindingRow`s;
  non-HSL widgets still render `BindingRow`s.
- `ColourBandToolRow` opens the popover and a swatch pick calls `propose_widget` with
  `fused_tool_id: 'hsl_<band>'`; disabled when offline.
- Regression: `HslSectionBody` (canonical) still passes its existing suite after the
  `HslPanelView` extraction.

## 8. Open Decisions (resolved)
- Single-band band model: **locked at spawn**.
- Create flow: **pick on the tool** (swatch popover).
- All-bands default canvas view: **By band** (compact).
- Shared `canon:<layer>:hsl` node with the overlap caveat: **accepted**.
