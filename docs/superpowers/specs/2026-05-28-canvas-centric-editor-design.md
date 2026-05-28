# Canvas-centric editor UI — design spec

**Date:** 2026-05-28
**Branch:** `feat/canvas-centric-ui`
**Status:** Design locked, ready for implementation plan

## 1. Goal

Rebuild the editor's primary working surface around a **canvas-centric workflow** that mixes manual tools and AI assistance through one unified primitive (the widget) and one unified invocation gesture (cursor-bind drop). The user has stripped the app to `MenuBar + canvas + one right panel`. This spec defines how to make that frame usable.

**In scope:** the new layout, selection model, tool/suggestion invocation, right panel structure.
**Out of scope (for now):** saving/restoring projects, undo/redo plumbing reconfiguration, AI prompt-routing changes — to be revisited after the UI is solid.

## 2. Architectural anchors (already in place)

The existing codebase already provides the primitives this design rides on. Implementation should reuse, not parallel:

- **`Widget` schema** (`src/types/widget.ts`) — AI suggestions and tool-origin adjustments are the same primitive; `origin.kind` is the only distinguisher.
- **`selectAllWidgets()`** (`src/lib/widget-projection.ts`) — single source for "what widgets exist."
- **`CanvasWidgetLayer`** (`src/components/widget/CanvasWidgetLayer.tsx`) — absolute-positioned overlay, anchor positioning, drag support.
- **`WidgetCard` / `ToolWidgetCard`** — render any widget given its bindings + processing panel.
- **`ProcessingRegistry` / `ToolRegistry`** — feature registration; reuse.
- **`useSegmentInteraction`** — canvas pointer → segment selection. Cycle behavior is added on top.
- **`LayersPanel.tsx`** — already has the parent/expandable-children render pattern (`LayerRow` + nested `AdjustmentRow`); we swap the child type from `AdjustmentRow` to `SegmentRow`.
- **`backendTools`** — `propose_widget`, `accept_widget`, `refine_widget`, `repeat_widget`, `delete_widget`, `set_widget_param`, `preview_widget` all wired.

## 3. Layout

```
┌────────────────────────────────────────────────────┐
│ MenuBar (existing, ~24px)                          │
├──┬──────────────────────────────────────┬──────────┤
│  │                                      │ Suggestions│
│T │                                      │  [Ask AI…] │
│o │                                      │  · row     │
│o │           Fabric canvas              │  · row     │
│l │           + CanvasWidgetLayer        ├──────────┤
│  │                                      │ Active    │
│r │                                      │  · row    │
│a │                                      │  · row    │
│i │                                      ├──────────┤
│l │                                      │ Layers    │
│  │                                      │  blend/op │
│  │                                      │  ▾ layer  │
│  │                                      │    ◯ seg  │
│  │                                      │    ◯ seg  │
└──┴──────────────────────────────────────┴──────────┘
                                          status bar (bottom-right of canvas)
```

- **Left tool rail** (~36px). 8 buttons.
- **Center canvas** with widget overlay.
- **Right panel** (~210px, resizable via existing `SidebarShell`). Three sections: Suggestions → Active → Layers.
- **`BackendStatusBar`** stays mounted as the existing top strip beneath the MenuBar — it carries session state and analyze progress that the user needs to see. Visual restyle to match the rest of the new design is a follow-up; not scoped here.

## 4. Tool rail

Eight buttons, two groups separated by a thin divider.

**Widget tools** (cursor-bind → drop = spawn widget):
- Light · Color · Kelvin · Curves · Levels · Filters

**Special tools:**
- Text — widget tool variant (cursor-bind drops a text widget at the click point)
- Crop — mode tool, takes over canvas via existing `CropCanvasOverlay`

**Dropped** from the previous rail: `select`, `move`, `transform`, `brush`, `brush-mask`. Selection is now click-cycle; brush is rare enough in the AI-assisted flow to drop until proven needed.

Tool registration stays as-is; `App.tsx` is updated to only register and mount the kept tools.

## 5. Selection model — `activeScope`

One scope value in the store, set by canvas or right panel; consumed everywhere.

### 5.1 Canvas click-cycle

Implemented as an extension to `useSegmentInteraction`:

```
Click in image → cycle:
  smallest mask containing the cursor →
  next-larger mask containing the cursor →
  ... →
  full image (no mask) →
  wrap to smallest
Click off-image → set scope to full image (deselect)
ESC → set scope to full image
```

The cycle remembers the cursor position so successive clicks at roughly the same spot advance through the same stack. Moving to a new pixel restarts the cycle at the smallest mask under that pixel.

### 5.2 Right-panel-driven selection

- Clicking a `LayerRow` in the Layers section sets `activeScope` to `{ layerId, mask: null }`.
- Clicking a nested `SegmentRow` sets `activeScope` to `{ layerId, mask: <maskId> }`.

Both paths converge on the same store action.

### 5.3 Outline & status

- Full image selected → 2px blue outline (`var(--color-accent)`) around the Fabric image bounds.
- Segment selected → existing `SegmentOverlay` outline in amber (`#ff9f0a`).
- Status bar at canvas bottom-right shows scope name: "image" or `<segment label>`.

## 6. Focus rule — opacity is the focus signal

Everything anchored to the current scope renders at **100% opacity**. Everything else renders at **10% opacity**. One rule, applied in two places:

- **Canvas widgets** (`CanvasWidgetLayer`): each widget already carries its scope; add an opacity calculation based on `activeScope`.
- **Right panel rows** (Suggestions + Active): same calculation, same opacity.

Dimmed rows/widgets remain clickable — clicking a dimmed row sets `activeScope` to that widget's scope (re-focuses).

Layers and segment rows in the Layers section do **not** dim — that panel is the structural index and stays fully visible.

## 7. Invocation gesture — cursor-bind drop

One gesture, two entry points:

1. **Click tool icon in rail** OR **click Suggestion row** in right panel.
2. A widget ghost (semi-transparent card) attaches to the cursor.
3. **Click on canvas** → ghost commits at that point as a real widget.
4. **ESC** → cancel, no widget created.

### Details

- Scope is captured at step 1, not step 3. Cursor movement does not change scope.
- Tool entry: widget spawns at **identity** params (no visual change yet); user drags sliders to act. Persisted via `addAdjustment` with the captured scope.
- Suggestion entry: widget spawns with **AI-chosen** params (immediate visual effect from drop). Drop fires `backendTools.accept_widget(widget.id)` so the backend transitions it from "autonomous-pending" to "accepted"; on the next snapshot it leaves the Suggestions slice of `selectAllWidgets()` and appears in Active.
- Drop commits on **mouse-up** of the drop click (not mouse-down), so a drag from a Suggestion row that lands on canvas behaves the same as click-row + click-canvas.

### Implementation note

A new `useCursorBind` hook holds the ghost state machine; `CanvasWidgetLayer` renders the ghost while bound, then commits the widget on canvas click.

## 8. Right panel — three sections

### 8.1 Suggestions

- Section header: `Suggestions · <count>`
- **"Ask AI…" inline input** at the top of the section. Submit → `proposeFromPalette(text, activeScope)` (existing). Same backend as ⌘K, surfaced visibly. ⌘K still works as a shortcut and focuses this input.
- Rows below: AI widgets from `selectAllWidgets()` with `origin.kind === 'mcp_autonomous'` or `mcp_user_prompt`, not yet accepted.
- Row layout: `[AI chip] [intent] [scope label] [× dismiss]`.
- **Click row** → cursor-bind that widget (§7).
- **× button** → `backendTools.delete_widget` (with `suppress_similar: true` for autonomous).
- Opacity-dimmed per §6.

### 8.2 Active

- Section header: `Active · <count>`
- Rows: union of dropped tool-origin widgets and accepted AI widgets, from `selectAllWidgets()`.
- Row layout: `[· tool chip OR AI chip] [intent] [scope label] [× remove]`.
- **Click row** → focus its widget on canvas: smoothly pan/scroll the Fabric viewport so the widget's anchor is centered, briefly pulse the widget card. Pure navigation; no state change.
- **× button** → `removeAdjustment` (tool) or `delete_widget` (AI).
- Opacity-dimmed per §6.

### 8.3 Layers (purely structural)

Reuse `LayersPanelBody` (`src/components/panels/LayersPanel.tsx`) with three changes:

1. **Drop nested `AdjustmentRow`.** Adjustments live in Active now. The current expand-arrow becomes the toggle for `SegmentRow` children instead.
2. **Add `SegmentRow`.** Indented under image layers when expanded:
   - Small (12×12) mask thumbnail (rendered from `maskStore.get(id)`).
   - Segment label (`MaskSummary.label`).
   - Visibility eye (optional — toggles whether the segment outline shows on canvas).
   - Click row → set `activeScope` to `{ layerId: <parent>, mask: <id> }`.
   - `.sel` style with amber accent when selected.
3. **Selection state** mirrors `activeScope` instead of the old `setActiveLayer`-only path. The blend-mode + opacity header continues to drive the layer the active scope belongs to.

The Layers section keeps its existing context-menu (Duplicate / Lock / Delete) and `LayersPanelActions` (`+` and trash buttons), unchanged.

## 9. Mapping to existing files

| Concern | Reuse | Add | Remove |
|---|---|---|---|
| Tool rail | `Toolbar.tsx` registration loop, `ToolButton` | trimmed `CATEGORY_ORDER` (only the kept categories) | — |
| App layout | `MainLayout` shell in `App.tsx` | re-mount `Toolbar` | already-commented `LeftSidebar`/`GraphEditor` blocks |
| Selection | `useSegmentInteraction`, `useSegmentSelection`, `SegmentOverlay`, `activeScope` slice | click-cycle logic in `useSegmentInteraction`; off-image click handler | — |
| Focus opacity | `CanvasWidgetLayer`, `InspectorPanel` | scope-match → opacity calculation in both | — |
| Cursor-bind | `CanvasWidgetLayer` (drag plumbing as reference) | `useCursorBind` hook, ghost render branch in `CanvasWidgetLayer`, ESC handler | — |
| Suggestions section | `selectAllWidgets`, `InspectorWidgetRow` as a starting point | "Ask AI…" input, click-to-cursor-bind wiring, redesigned row | the old `InspectorPanel` body (replaced by new section components) |
| Active section | `selectAllWidgets`, `ToolWidgetCard` close logic | click-to-focus (Fabric viewport pan + pulse) | — |
| Layers section | `LayersPanelBody`, `LayerRow`, `LayerThumbnail`, blend-mode header, `LayersPanelActions` | `SegmentRow` (new component, sibling of `AdjustmentRow`); selection wired to `activeScope` | nested `AdjustmentRow` rendering |
| Ask-AI entry | `SpawnPaletteWidget`, `proposeFromPalette` | inline form in Suggestions section that calls the same `proposeFromPalette` | — |

## 10. Visual register

Reuse existing design tokens in `src/index.css`:

- Accent (`#0a84ff`) — full image scope, AI chip, primary highlights.
- Amber (`#ff9f0a`) — segment scope (outline + status bar).
- `bg-surface` / `bg-surface-secondary` / `glass-panel` — already aligned with the Apple HIG aesthetic the project uses.
- Opacity 100% / 10% — the only two states for the focus rule. No intermediate values.

Motion is restrained: pan-to-widget animation (Active row click) uses a spring (`stiffness: 500, damping: 35`, matching existing tooltip transitions); pulse is a 1.0 → 1.05 → 1.0 scale over 320ms. Cursor-bind ghost has no animation — opacity 0.7, no transition.

## 11. Acceptance criteria

The implementation is done when the following gestures all work end-to-end:

1. Load an image, click in it repeatedly — selection cycles smallest → larger → full → wraps. Clicking off-image deselects to full.
2. With full image selected, click `Curves` in the rail → ghost on cursor → click on canvas → Curves widget appears at that point, listed in Active.
3. Select a segment (canvas click or Layers panel row), click `Light` → ghost on cursor → click on canvas → Light widget appears, scope = that segment.
4. Switch selection to another segment — widgets scoped to the previous one fade to 10%; widgets scoped to the new one stay 100%. Suggestions and Active rows mirror the same fade.
5. Click an AI suggestion in the right panel — ghost on cursor → click on canvas → widget drops with its AI params, moves out of Suggestions into Active.
6. Click an Active row — canvas pans to that widget, widget card pulses briefly.
7. Layers section: expand an image layer, segment children appear with thumbnails; clicking one selects it (same as canvas click on that region).
8. Submit a prompt in the "Ask AI…" input — request reaches backend, resulting widget shows up as a new Suggestion row (not auto-dropped on canvas).
9. ⌘K still focuses the "Ask AI…" input.

## 12. Open implementation details (defer to plan)

- Precise click-cycle algorithm when masks overlap heavily (smallest-by-area sort, then containment? cache per cursor position?).
- Whether ⌘K opens a modal palette (current behavior) or just focuses the Suggestions input (preferred — simpler, no second surface).
- Cursor-bind ghost styling on retina displays.
- Animation cadence of pan-to-widget for very far-away widgets.

These do not block the design; they get nailed down in the implementation plan.
