# Layers Tab — Adjustment↔Layer Control

**Date:** 2026-07-14
**Status:** Approved (brainstormed with visual companion; mockups in
`.superpowers/brainstorm/47379-1784021104/content/`)

## Problem

The Layers tab shows layer metadata (thumb, name, visibility, opacity,
blend) but nothing about which adjustments hit which layer. That mapping
already exists canonically in the backend snapshot — per-layer
`canon:<layerId>:<op>` nodes and widget target sets — so this is UI-only:
read the snapshot, mutate through existing backend tools.

## Decisions (made with Anton, via visual companion)

| Question | Decision |
|---|---|
| Scope | **Both kinds unified**: canonical tool edits AND widgets, one "what's hitting this layer" list. |
| Capability | **Reassign + toggle**: visibility eyes plus moving/copying between layers. |
| Layout | **A — nested list per layer** (over chips+popover and assignment matrix): collapsible "Adjustments · N" under each layer row, menu-driven reassignment. |
| Row anatomy | **Name only** (no param value summary). Multi-layer widgets get a "· N layers" hint. |
| Menus | Split per entry kind, as mocked (see Interactions). |

## Design

### 1. Data — `useLayerAdjustments(layerId)` (new hook)

Derives entries from `useBackendState.snapshot`; no new persistent state.

- **Canonical entry** per op-graph node `canon:<layerId>:<op>` with ≥1
  touched param. Touched-detection reuses `sectionSummary` plus the
  curves identity-ramp check from `ToolSection`, so both tabs agree on
  what counts as an edit. Label + strand color from the matching
  `ProcessingDefinition` (op category → strand token).
- **Widget entry** per active snapshot widget whose
  `widgetTargetLayerIds(w)` includes this layer. Rendered with a ◇ glyph
  and "· N layers" when it targets more than one.

### 2. Components

- **`LayerAdjustmentsList`** (new, topic-local in
  `src/components/inspector/layer/`) rendered inside `LayerRow` below the
  blend-mode row.
  - Hidden entirely when the layer has zero entries — no empty header.
  - Header `▸ Adjustments · N` in the accordion group-label style (9px
    uppercase); collapsed by default. Expansion state lives in the
    existing `expandedSectionIds` store set under `layeradj:<layerId>`
    ids (same namespacing pattern as `preset:<cat>`).
  - Entry row: strand swatch, name, eye button, ⋯ trigger (Radix
    DropdownMenu — the idiom `LayerRow`'s blend dropdown already uses).

### 3. Interactions

**Eye**
- Canonical: `toggleCanonNodeHidden('canon:<layerId>:<op>')` — the
  mechanism the Adjustments tab already uses.
- Widget: the existing widget-hide state (same toggle the canvas uses).

**⋯ menu — canonical entry**
- *Edit in Adjustments ↗* — activate the layer, switch to the
  Adjustments tab, expand + scroll to the op's section (existing
  `routeOpToInspector` helpers).
- *Hide on this layer* — same as the eye.
- *Move to layer ▸* — submenu of the image node's OTHER layers. For each
  touched param: `set_param(target, value)`, then `set_param(source,
  param.default)` — with optimistic writes, the same pattern as
  `ToolSection.handleReset`.
- *Copy to layer ▸* — the copy half of Move only.
- *Reset on this layer* — existing reset behavior (destructive styling).

**⋯ menu — widget entry**
- *Focus on canvas ↗* — existing selection/focus store action.
- *Hide widget* — same as the eye.
- **Applies to** — checklist of the image node's layers; check/uncheck →
  `update_widget_targets` `add` / `remove`. The widget's LAST checked
  layer is disabled (a widget needs ≥1 target).
- *Remove from this layer* — `update_widget_targets` `remove`; disabled
  when this is the last target.

**Gating** — every mutation disables when
`useBackendState.sseStatus !== 'open'`, consistent with the toolrail.

### 4. Edge cases

- Move/Copy targets are the same image node's other layers only;
  cross-image-node moves are out of scope.
- Widget target resolution goes through `widgetTargetLayerIds()` (handles
  the frozen singular `layerId` correctly).
- A canonical Move onto a layer that already has touched params for the
  same op overwrites only the params being moved (set_param semantics);
  that is accepted behavior, not a merge.

### 5. Testing

- **Hook**: fixture snapshot → canonical touched filtering (incl. curves
  identity), widget target filtering, ordering.
- **Component** (`LayerAdjustmentsList.test.tsx`): renders entries per
  layer; hidden at N=0; expansion round-trips through
  `expandedSectionIds`; eye toggles the right canon id; Copy issues
  `set_param(target, …)` per touched param; Move additionally resets the
  source; widget checklist calls `update_widget_targets` with add/remove;
  last-target uncheck disabled; all mutations disabled offline.

## Out of scope

- Param value summaries in rows (decided against — name only).
- Cross-image-node moves.
- Drag-and-drop reassignment (menu-driven only).
- Backend changes of any kind.
