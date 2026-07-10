# Show-in-sidebar widget action + single-band HSL spawn — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

Two independent, small features bundled because they both touch widget UX:

1. A **"Show in sidebar"** item in a widget's right-click menu that jumps to the
   tool the widget holds, in the Adjustments sidebar.
2. HSL widgets **spawn showing one color** (all three tools: Hue / Saturation /
   Luminance) with a **"+"** to add other colors, instead of the full 8-band rail.

---

## Feature 1 — "Show in sidebar" widget context-menu item

### Behavior

Right-clicking a widget (`WidgetContextMenu`) gains a **"Show in sidebar"** row,
placed above the existing `Separator` (with Expand / Apply / Hide). Icon:
`PanelRight` (Lucide). Clicking it:

1. `usePreferencesStore.getState().showAdjustments()` — opens the right sidebar
   on the Adjustments tab (works even while the panel is unmounted).
2. `setActiveLayer(widgetTargetLayerIds(widget)[0])` — so the section reflects
   the widget's target layer. No-op when the widget has no resolvable target.
3. `expandSection(widget.opId)` then `scrollToSection(widget.opId)` — the
   `AdjustmentsAccordion` already listens to `sectionScrollTarget` and scrolls
   the `[data-section-id="<opId>"]` row into view on the next frame.

This reuses the exact `sectionScrollTarget` path the baseline command-palette
launcher uses; **no new store state**.

### Gating

The item is rendered only when `widget.opId` resolves to a registry op
(`loadRegistry().ops[widget.opId]`). Preset / genfill / compound widgets have no
single tool section → item hidden. If the op exists but happens not to be in the
accordion's `TOOL_GROUPS`, the sidebar still opens on Adjustments and the scroll
is a harmless no-op.

### Files

- `src/components/workspace/WidgetContextMenu.tsx` — add the item + handler.
- Reads: `usePreferencesStore.showAdjustments`, `useEditorStore.setActiveLayer /
  expandSection / scrollToSection`, `widgetTargetLayerIds`, `loadRegistry`.

### Test

- New `WidgetContextMenu.test.tsx`: rendering the menu for an op-backed widget
  shows the item; selecting it calls `showAdjustments`, `setActiveLayer(target)`,
  `expandSection(opId)`, `scrollToSection(opId)`. A preset/compound widget
  (no `opId`) does **not** render the item.

---

## Feature 2 — Single-band HSL spawn with "+ add color"

### Chosen approach — frontend reveal-state over full bindings

Every HSL widget carries **all 24 bindings** (8 bands × H/S/L) on the backend.
Which bands are *visible* is **frontend view-state**. This needs no new backend
tool: every band is already writable through its existing binding via
`set_widget_param`, so adding a color is instant.

Reads "whatever it would show currently" literally — the backend binding set is
unchanged for manual spawns and merely padded for AI ones; only the
*presentation* collapses to one band by default.

### Backend — normalize HSL widgets to full 24 bindings

- **Manual spawn** (toolrail-style promote / `propose_stack` forced op / Cmd+K
  `op:hsl`): already binds all 24, because `shared/registry/ops/hsl.json` has no
  curated `ln` subset. **No change.**
- **AI / fused / preset spawn**: paths that bind a subset (e.g. the
  complementary-grade preset binds orange + blue; `tone_red` binds the red
  triple) get **padded** to the full 24 — missing params added at their
  registry `default` (0), preserving band/group order. Centralize this in the
  HSL widget assembly in `backend/app/tools/widgets/propose_stack.py` (and any
  fused template output) as a single normalization step keyed on the `hsl`
  node type.

Rationale: revealing a band and dragging its slider must write *somewhere*;
`set_widget_param` targets an existing binding, so every band must be bound.

### Frontend — reveal-state + "+" affordance

- **`tool-slice`**: add ephemeral (non-persisted) view-state
  `hslRevealedBands: Record<widgetId, string[]>` with `revealHslBand(widgetId,
  band)`. Cleared when a widget is removed (via `layer-lifecycle` /
  widget-removal cleanup, mirroring existing per-widget UI maps).
- **`HslWidgetBody`**: compute `shownBands = editedBands ∪ revealedBands`; if
  empty, default to the **first band (`red`)** — matching the panel's current
  `bands[0]` landing. `editedBands` = bands with any non-default channel (reuses
  the existing `bandEdited` logic), so edited bands always show and nothing is
  ever hidden across a reload.
  - `shownBands.length === 1` → `HslSingleBandView` (Hue/Sat/Lum for that band).
  - `shownBands.length > 1` → `HslPanelView` with `availableBands={shownBands}`
    (existing band rail).
  - Both render the **"+"** control.
- **"+" control**: a small band-picker (Radix dropdown, matching
  `ChoiceControl`) listing the not-yet-shown bands (from the 8). Selecting one
  calls `revealHslBand(widget.id, band)`; its three sliders appear immediately
  and are editable (binding already exists). New shared primitive lives under
  `src/components/widget/hsl/` (e.g. `HslAddBandControl.tsx`).

No "remove color" affordance (YAGNI). A revealed-but-unedited band simply
collapses on the next session; edited bands persist because they're non-default.

### Scope

- Applies to the **canvas HSL widget** (`HslWidgetBody`) for **all spawn paths,
  including AI** (the 24-binding guarantee + "+" are universal; AI-edited bands
  auto-show, so a complementary grade still opens on its two bands).
- The **sidebar** `HslSectionBody` (Adjustments tab) is **out of scope** — it
  stays the full always-on HSL surface.

### Files

- `backend/app/tools/widgets/propose_stack.py` (+ fused template assembly) —
  pad HSL widget bindings to full 24.
- `src/store/tool-slice.ts` — `hslRevealedBands` + `revealHslBand`.
- `src/components/widget/HslWidgetBody.tsx` — shown-bands computation + wiring.
- `src/components/widget/hsl/HslAddBandControl.tsx` — new "+" picker primitive.
- `src/components/widget/hsl/HslPanelView.tsx` / `HslSingleBandView.tsx` — accept
  and render the "+" control.
- Widget-removal cleanup — clear `hslRevealedBands[widgetId]`.

### Tests

- Backend: an AI/fused HSL widget (subset bindings) is normalized to all 24
  bindings, missing params defaulted to 0, existing values preserved.
- Frontend `HslWidgetBody`: fresh widget (nothing edited/revealed) shows only
  `red`; `revealHslBand` adds a band and its three sliders render; a widget with
  two edited bands shows both without any reveal.
- Frontend `HslAddBandControl`: lists only not-yet-shown bands.

---

## Non-goals

- No new backend widget-mutation tool.
- No "remove color" from an HSL widget.
- No change to the sidebar HSL section.
- No change to which bands a manual spawn *binds* (still all 24); only which it
  *shows* by default.
