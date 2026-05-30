# Widget Shell — On-Canvas Right-Edge Dock

- **Date:** 2026-05-30
- **Status:** Approved (design), pending spec review
- **Branch:** `feat/canvas-centric-ui` (continuing after the Vercel/flat makeover)
- **Scope:** Frontend widget rendering only — the consistent on-canvas container ("shell") that every active widget renders into. No backend changes, no engine SSoT changes, no new `ControlSchema` types.

---

## 1. Goal

Replace the current dual-surface widget UI (inspector `Active` section + on-canvas tool-bind ghost) with a single **on-canvas widget shell** that hosts all active widgets in a calculated right-edge column. The shell is the consistent visual + structural container around the existing 6-block `ControlBinding` kit; widgets render collapsed by default and expand on click. This is the structural foundation the next project (the MCP `compose_widget` API) will compose into.

### Non-goals
- No new backend tools, no new `ControlSchema` types, no changes to `Widget`/`WidgetNode`/`OperationGraph` shapes.
- No changes to the shader pipeline, image_context generation, or the LLM tool manifest.
- No new spawn paths beyond the four that already exist (toolrail, ⌘K prompt, autonomous, sidebar suggestion).
- No drag-to-resize, multi-monitor positioning, or freeform free-form widget placement — position is calculated, with a per-session manual drag override.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Shell flavor | **Standard AI-aware**: header (grip · badge · intent · scope chip · ×) · one-line reasoning · preview slot · bindings region · footer (Refine · Why? · Reset · Apply) |
| 2 | Density | Inspector-tight: 11px intent, 8px AI chip, 9–10px secondary, mono numerals via `.num` |
| 3 | Placement | **Right-edge column on canvas**, calculated position |
| 4 | Anchor indicator | Small accent tick on the photo's right edge at the anchor centroid y; anchored widgets align their y to it |
| 5 | Lifecycle | **Live + Apply = bake**: bindings affect canvas via optimistic+`set_widget_param`; Apply calls `accept_widget` (active → accepted), widget vanishes from canvas, effect materialised into `operation_graph` |
| 6 | Default scope (tool-invoked) | Active selection → fallback Global |
| 7 | Refine UX | Inline text input expands above the footer; Enter sends `refine_widget` |
| 8 | Default state | Collapsed strip; click to expand |
| 9 | Multi-expand | Allowed (multiple widgets can be expanded simultaneously; per-widget chevron toggles individually) |
| 10 | Suggestions home | Stay in sidebar Suggestions section; column = active widgets only; baked widgets are pure `operation_graph` effects (no widget chrome) |
| 11 | Hover interaction | Bidirectional region ↔ widget highlight |
| 12 | Variant badge | AI badge for AI-composed; muted `·` chip for tool-invoked |
| 13 | AskAiInput | Stays in sidebar Suggestions section (unchanged) |
| 14 | Implementation strategy | **Refactor in place** — `WidgetShell` replaces `WidgetCard`'s rendering; sidebar `ActiveSection` is deleted |

---

## 3. Shell anatomy

### 3.1 Collapsed strip (default render state)

```
┌───────────────────────────────────────────────────┐
│ ⋮⋮  [AI]  Warm up shadows   •   [● Sky]      ›   │
└───────────────────────────────────────────────────┘
  grip badge intent             dirty? scope     chev
```

- **Width:** 226px (matches makeover-era inspector widget width).
- **Height:** 30px.
- **Container:** flat `bg-surface` + 1px `--color-border-strong` hairline + `--shadow-overlay` (it's a real floating overlay).
- **Strip contents (left → right):**
  - `Grip` (6-dot icon, 8px wide, opacity 0.55) — handle for the drag override.
  - `Variant badge` — `AI` chip (accent bg, white text) for `origin.kind` in `{ mcp_user_prompt, mcp_autonomous, refine, repeat }`; muted `·` chip (`bg-surface-secondary`, `text-text-secondary`) for `tool_invoked`/`fused_expansion`.
  - `Intent` — `widget.intent`, 11px font-medium, ellipsis on overflow.
  - `Dirty dot` — 5px accent dot, shown **only** when any binding value differs from its `default` (compares against `widget.bindings[].default`, including optimistic).
  - `Scope chip` — 9px label; colour swatch by `scope.kind`: orange for `mask`/`named_region`, gray for `global`. Text: scope label (`widget.scope.label` for named regions, `mask.label` for masks, "Global" for global).
  - `Chevron` — right-pointing `›` (collapsed) / down `⌄` (expanded).
- **Hover:** border colour shifts to `--color-accent`; if anchored, the matching photo region brightens (see §6).
- **Click anywhere on the strip** → toggles `expandedWidgetIds` for this widget (multi-expand allowed).

### 3.2 Expanded card

Same outer container; the strip becomes the **header row**, with additional sections below:

```
┌───────────────────────────────────────────────────┐
│ ⋮⋮  [AI]  Warm up shadows   [● Sky]    ⌄    ×    │ header
├───────────────────────────────────────────────────┤
│ ⓘ  Sky reads cool; gentle lift + warm shift…     │ reasoning
├───────────────────────────────────────────────────┤
│ Δ   ▁▃▅▇▆▄▃▂  (overlay solid = current,           │ preview
│                dashed = baseline)                  │   (slot)
├───────────────────────────────────────────────────┤
│ Exposure  ━━●━━━━━━━━━━━━━━━━━━━━━━━━   +0.40    │ bindings
│ Shadows   ━━━━━━━━━━━●━━━━━━━━━━━━━━━━   −8       │  (6-block kit)
│ Warmth    ━━━━━━━━━━━━●━━━━━━━━━━━━━━━   +120     │
├───────────────────────────────────────────────────┤
│ ↻ Refine   ? Why?            [Reset] [Apply]      │ footer
└───────────────────────────────────────────────────┘
```

- **Header:** same as the strip, with `×` close (right of chevron). Click the chevron or anywhere on the header → collapses back to strip.
- **Reasoning:** one-line `widget.reasoning`, `bg-surface-secondary`, 10px `text-text-secondary`, ellipsis on overflow. Click → expands to multi-line; the long form is also reachable from `Why?`. Hidden if `widget.reasoning` is empty/null.
- **Preview slot:** dispatches on `widget.preview.kind`:
  - `histogram_delta` — small inline histogram with the operation's predicted delta (use `EnrichedImageContext.luma_histogram` as baseline; dashed overlay = predicted shape).
  - `thumbnail` — small before/after thumbnail (sourced from backend-supplied preview blob).
  - `color_swatches` — row of small RGB swatches.
  - `none` — slot omitted entirely (saves vertical space).
- **Bindings region:** maps `widget.bindings[]` 1:1 through the existing `BindingRow` dispatch → the 6 primitives. Unchanged from today.
- **Footer (left → right):**
  - `Refine` (ghost) — opens `RefineInput` above the footer (see §4.4).
  - `Why?` (ghost) — opens `WhyPopover` (floating; `widget.reasoning` + `model_name` + `generated_at`).
  - `Reset` — reverts each binding to its `default` via `set_widget_param` calls.
  - `Apply` (primary) — calls `accept_widget`.
- All ghost-button motion uses the makeover's `--duration-fast: 120ms`; expansion/collapse uses `--duration-normal: 160ms` opacity + small translate. No springs, no scale-pop.

---

## 4. Calculated dock layout

### 4.1 The dock rule

The widget column lives on the canvas, between the photo's right edge and the right sidebar:

- **Column origin x:** `photo.right + 12px`.
- **Column y range:** `[canvas.top + 24, canvas.bottom − 24]` (24px top/bottom safe-area).
- **Column width:** 240px reserved; widgets are 226px (centered with 7px gutter on each side).

For each widget in render order (newest first):

```
positionFor(widget):
  if widget has manual override (in sessionDragOverrides Map):
    return that x,y
  if widget.origin.anchor.kind in { 'region_label', 'mask_id', 'image_point' }:
    centroid_y = centroidFor(anchor)  // in photo coordinates
    y = clamp(photo.top + centroid_y * photo.height − cardHeight/2, columnTop, columnBottom − cardHeight)
    isAnchored = true
  else:
    y = nextFreeSlotY(columnTop, gap = 5px)
    isAnchored = false
  return { x: column.x, y, isAnchored }
```

- Anchored widgets are positioned **first**; globals fill remaining slots top-down.
- If two anchored widgets target overlapping centroid y, the later widget pushes down by `cardHeight + gap` (no overlap).
- Card height = 30px (collapsed) or measured (expanded). Layout recomputes when any widget toggles state.

### 4.2 Centroid resolution by anchor kind

| `anchor.kind` | Centroid source |
|---|---|
| `region_label` | `EnrichedImageContext.candidate_regions[label].bbox` → centroid; fallback to `representative_point` |
| `mask_id` | `MaskSummary.bbox` from `snapshot.masks_index` |
| `image_point` | `{ x, y }` directly |
| `global` (none) | N/A — widget renders as global, fills next slot |

If the anchor's centroid can't be resolved (region not present in current `image_context`, mask deleted, layer changed): widget falls back to the "global" branch (next free slot), the tick on the photo edge is omitted, and the scope chip dot turns gray.

### 4.3 Manual drag override

- Grip drag updates `sessionDragOverrides: Map<widget_id, { x, y }>` in `tool-slice`.
- Override persists for the current document only — cleared when the document closes or layer changes.
- A small dashed "return to dock" affordance appears in the strip's hover state when an override is active; clicking it removes the override and snaps the widget back to its calculated position.

### 4.4 Refine input (inline)

- Clicking `Refine` in the footer mounts `RefineInput` above the footer (a 1-line text input + Send button, focused immediately).
- Enter → `backendTools.refine_widget(widget_id, { instruction: <text> })`. Spinner shows in the Send button until SSE returns updated bindings.
- Escape or clicking outside the input → collapses without sending.
- Multi-line is single-line for v1; the spec doesn't reserve space for a textarea.

### 4.5 Why? popover

- `Why?` opens `WhyPopover` as a `.overlay`-styled floating panel (uses Radix Popover for positioning + dismissal).
- Content: full `widget.reasoning`, `widget.origin.kind` chip, `widget.origin.prompt` (if present), `image_context.model_name`, `widget.created_at`.
- Dismissed on outside click or Escape.

---

## 5. Anchor tick + region highlight

### 5.1 Tick on photo's right edge (always-visible for anchored widgets)

- Tick is a 9×2px accent rectangle, positioned at `photo.right − 1px`, vertically at the anchor centroid (after the same clamp as the widget y).
- Outlined in 1.5px translucent white (`box-shadow: 0 0 0 1.5px rgba(255,255,255,0.7)`) so it reads on dark and light photos.
- Renders in `AnchorTickLayer.tsx`, mounted above the photo, below the widget column.

### 5.2 Region highlight (bidirectional hover)

Driven by `hoveredWidgetId: string | null` in `tool-slice`:

- Mouse enter on a strip/card → `hoveredWidgetId = widget.id`.
- Mouse enter on an image region (the SAM polygon, anchor-region overlay) → reverse-lookup matching widget by anchor → `hoveredWidgetId = widget.id`.
- `RegionHighlightLayer.tsx` reads `hoveredWidgetId` + matches its anchor to a SAM polygon/bbox → renders a stronger accent overlay (`bg-accent/16`, ring `--color-accent` 1.5px) over that region.
- `WidgetShell` reads `hoveredWidgetId === widget.id` → applies a subtle `--color-accent` border-colour bump.
- Pointer leave on either side → `hoveredWidgetId = null`.

---

## 6. File-touch map

| File | Responsibility | Action |
|---|---|---|
| `src/components/widget/WidgetShell.tsx` | The shell primitive (collapsed strip ↔ expanded card; variant ai\|tool) | **NEW** |
| `src/components/widget/WidgetShellHeader.tsx` | Header row (grip · badge · intent · scope · chevron · ×) | **NEW** |
| `src/components/widget/WidgetShellFooter.tsx` | Footer (Refine · Why · Reset · Apply) | **NEW** |
| `src/components/widget/RefineInput.tsx` | Inline text input above the footer | **NEW** |
| `src/components/widget/WhyPopover.tsx` | Radix Popover with reasoning + provenance | **NEW** |
| `src/components/widget/PreviewSlot.tsx` | Renders `widget.preview.kind` (histogram-Δ / thumbnail / swatches / none) | **NEW** |
| `src/components/widget/AnchorTickLayer.tsx` | Renders the accent ticks on the photo's right edge | **NEW** |
| `src/components/widget/RegionHighlightLayer.tsx` | Strong overlay on the hovered anchor region | **NEW** |
| `src/components/widget/CanvasWidgetLayer.tsx` | Uses `WidgetShell` + `useWidgetDockLayout` instead of `WidgetCard`/`ToolWidgetCard` | **UPDATED** |
| `src/components/widget/ToolWidgetCard.tsx` | Folded into `WidgetShell` (variant='tool') | **DELETED** |
| `src/components/widget/CursorBindGhost.tsx` | The cursor-bind UX is replaced by the auto-active-selection scope; keep if `useCursorBind` is still mounted for explicit region picking, otherwise delete | **VERIFY-THEN-DELETE** |
| `src/hooks/useWidgetDockLayout.ts` | Calculated positions per widget (anchor + photo bbox) | **NEW** |
| `src/hooks/useWidgetExpansion.ts` | Per-widget expanded/collapsed state | **NEW** |
| `src/hooks/useHoveredWidget.ts` | Bidirectional hover sync | **NEW** |
| `src/hooks/useCursorBind.ts` | Used by the old tool-bind flow; delete if no remaining consumers after `CanvasWidgetLayer` refactor | **VERIFY-THEN-DELETE** |
| `src/components/inspector/ActiveSection.tsx` | Active widgets now live on canvas | **DELETED** |
| `src/components/inspector/InspectorPanel.tsx` | Only renders `SuggestionsSection` + `LayersSection` | **UPDATED** |
| `src/components/inspector/SuggestionsSection.tsx` | Click ↗ on a suggestion → adds id to `acceptedSuggestions`; suggestion disappears from sidebar and appears as a collapsed strip in the column. **`AskAiInput` continues to live at the top of this section, unchanged** (⌘K still focuses it). | **UPDATED** |
| `src/components/inspector/widget/WidgetCard.tsx` | Replaced by `WidgetShell`; only consumer (`ActiveSection`) is being deleted | **DELETED** |
| `src/components/inspector/widget/LifecycleActions.tsx` | Folded into `WidgetShellFooter` | **DELETED** |
| `src/components/inspector/widget/BindingRow.tsx` | Unchanged dispatch into the 6 primitives | **KEPT** |
| `src/components/inspector/widget/primitives/*` | The 6 block components | **KEPT** |
| `src/store/tool-slice.ts` | Add `expandedWidgetIds: Set<string>`, `hoveredWidgetId: string \| null`, `sessionDragOverrides: Map<string, { x, y }>` + their toggles/setters | **UPDATED** |
| `src/lib/backend-tools.ts` | No new tools; just verifying `refine_widget` is wrapped (it already is) | **VERIFY** |
| `design.md` | Add a "Widget Shell" section documenting the dock rule, anatomy, and hover semantics | **UPDATED** |
| `CLAUDE.md` | One-line update to the Widget-driven panels rule (no more "panel renders per widget in inspector"; widgets render on canvas via `CanvasWidgetLayer`) | **UPDATED** |

---

## 7. Data flow + lifecycle

### 7.1 Spawn paths (all converge on collapsed strip in the column)

| Path | Trigger | Backend call | Initial state |
|---|---|---|---|
| Toolrail click | User clicks Light/Color/Kelvin/… | `propose_widget({ fused_tool_id, origin: 'tool_invoked', scope: <activeMask ?? activeRegion ?? Global> })` | Widget arrives via SSE → collapsed strip with variant='tool' |
| Sidebar suggestion ↗ | Click ↗ on a Suggestions row | None (frontend-only): add `widget.id` to `acceptedSuggestions` in `backend-state-slice` | Strip appears in column with variant='ai' |
| ⌘K prompt | User types in AskAiInput + Enter | `propose_widget({ origin: 'mcp_user_prompt', prompt })` | Strip with variant='ai' |
| Backend autonomous | Backend emits suggestion via SSE | None; appears only in sidebar Suggestions | Not in column until user clicks ↗ |

### 7.2 Two distinct accepts — keep them straight

- **Engage** (frontend, sidebar ↗): mutates `acceptedSuggestions` only. Reversible by clicking × on the column strip — the widget returns to the sidebar suggestion list.
- **Apply / Bake** (backend, footer Apply): `accept_widget(widget_id)` → backend materialises `Widget.nodes` into `operation_graph` and removes the widget from `snapshot.widgets`. The frontend reacts to the SSE removal by fading out the strip.

### 7.3 User actions on a column widget

| Action | Frontend | Backend |
|---|---|---|
| Click strip | Toggle `expandedWidgetIds.has(id)` | — |
| Drag binding (slider/color/etc.) | Optimistic patch in `useBackendState.optimistic` | Debounced `set_widget_param(widget_id, param_key, value)` |
| Click Refine + Enter | Mount `RefineInput`; show spinner | `refine_widget(widget_id, { instruction })` → SSE returns updated bindings → spinner clears |
| Click Why? | Mount `WhyPopover` | — |
| Click Reset | For each binding: optimistic-reset to `default` | One `set_widget_param` per binding (parallel) |
| Click Apply | Optimistic remove strip after request resolves | `accept_widget(widget_id)` |
| Click × | Optimistic remove strip; fade out | `delete_widget(widget_id, suppress_similar: false)` |
| Hover strip/card | Set `hoveredWidgetId = id` | — |
| Drag grip | Update `sessionDragOverrides.set(id, { x, y })` | — |

### 7.4 Edge cases

| Case | Behaviour |
|---|---|
| Anchored region not resolvable | Widget renders as global (next free slot); tick omitted; scope chip dot turns gray |
| `sseStatus !== 'open'` | Column freezes — last-rendered widgets stay visible; footer buttons + sliders disabled; a banner indicates offline |
| `accept_widget` HTTP error | Strip stays in column; toast surfaces the error |
| `refine_widget` HTTP error | Inline error in the `RefineInput` row; input stays open |
| `delete_widget` HTTP error | Strip un-fades; toast surfaces the error |
| Snapshot revision conflict on optimistic patch | Replace the optimistic value with the latest backend value silently; widget keeps its expanded/collapsed state |
| Layer switch | Widgets re-filter by new `activeLayerId`; current `expandedWidgetIds` / `sessionDragOverrides` carry across (keyed by widget id, which is layer-independent) |
| Document close | Clear `expandedWidgetIds` and `sessionDragOverrides` |

---

## 8. Visual register (matches the makeover's `design.md`)

- Shell uses the `.overlay` class (`bg-surface` + 1px `--color-border-strong` + `--shadow-overlay` + `--radius-panel`).
- Collapsed strip uses a slightly lighter shadow than the expanded card (`0 2px 6px rgba(0,0,0,0.06)` vs `--shadow-overlay`).
- Typography: 11px intent (Geist Sans medium), 8px AI chip (Geist Sans semibold), 9–10px secondary (Geist Sans), all numerals via `.num` (Geist Mono tabular).
- Motion: opacity + 4px translate, 120–160ms, ease `cubic-bezier(0.2, 0, 0, 1)`. No springs, no `layoutId`, no scale-pop.
- Scope-chip dot colours: `mask` / `named_region` → orange `#f97316`; `global` → gray `#a1a1a1`; if subject vs background semantic is available, override (green for subject, purple for foreground, etc. — only as data permits; never hardcoded per-region).

---

## 9. Testing

- **`WidgetShell.test.tsx`** — render with varied `Widget` fixtures:
  - Variant ai vs tool → correct badge.
  - All 4 `preview.kind` values → correct slot rendering / omission.
  - With and without `reasoning` → reasoning row present/absent.
  - Anchored (region_label / mask_id / image_point) vs global → scope chip text and dot colour correct.
  - Snapshot test on collapsed strip + expanded card.
- **`useWidgetDockLayout.test.ts`** — given a photo bbox and a list of widgets:
  - Anchored y aligns to centroid.
  - Globals fill the next slot top-down.
  - Clamping when centroid is near the top/bottom edge.
  - Falls back to global slot when anchor centroid can't be resolved.
  - Two overlapping anchors don't overlap visually (push-down rule).
- **`useWidgetExpansion.test.ts`** — toggle adds/removes from `expandedWidgetIds`; collapsing a widget that isn't expanded is a no-op.
- **`useHoveredWidget.test.ts`** — setting widget id sets the region-highlight target; clearing returns to null; reverse direction (region → widget id) symmetrical.
- **Interaction tests:**
  - Click strip → expanded (mock `set_widget_param`).
  - Click Apply → `accept_widget` called once with the right id.
  - Click × → `delete_widget` called with `suppress_similar: false`.
  - Refine flow: type → Enter → `refine_widget` called with the typed instruction.
  - Reset: each binding's `set_widget_param` called with its `default`.
- **`AnchorTickLayer.test.tsx`** — ticks render at the correct y for each anchored widget; omitted for globals.
- **Backend-offline path:** SSE closed → footer buttons disabled; sliders disabled; banner present.
- All tests use `Widget` fixtures placed under `src/components/widget/__fixtures__/` (extending the existing `inspector/info/__fixtures__/enriched-context.ts` convention).

---

## 10. Out of scope (explicitly)

- The MCP `compose_widget` API and any block-by-block AI composition — that's the next project.
- New `ControlSchema` types (e.g., `before_after_toggle`, `histogram_marker`, `curve_point`, `numeric_pair`) — the backend has these defined; the frontend doesn't dispatch them yet. Not added in this project.
- Backend changes — every behaviour relies on existing tools (`propose_widget`, `refine_widget`, `accept_widget`, `delete_widget`, `set_widget_param`).
- Live "before/after" canvas toggle, on-canvas annotations, region label re-editing — defer.
- A11y pass (keyboard navigation between strips, screen-reader semantics) — flagged for follow-up after the visual shell lands.

---

## 11. Risks + open items for spec review

- **Cursor-bind deletion** — `CursorBindGhost` and `useCursorBind` were the old toolrail UX. The new model defaults to "active selection → Global" so cursor-bind is not the default flow. Confirm whether to delete or keep for explicit region picking (e.g. shift-click). The file-touch map marks them VERIFY-THEN-DELETE.
- **Inspector `SuggestionsSection`** already exists — confirm clicking ↗ uses `acceptedSuggestions` (frontend-only engagement) and not `accept_widget` (backend bake). The current implementation may need a small change here.
- **Two anchored widgets at near-identical centroids** — the push-down rule is one option; an alternative is to "merge" them into a small cluster icon on the tick. Spec uses push-down; flag if you'd prefer cluster behaviour.
- **`region_label` centroid resolution** — needs `candidate_regions[label].bbox` to be present; if only `representative_point` is available, use that. If neither, fall back to global.
- **Drag override scope** — currently per-session, per-document. Persisting across sessions would require backend metadata storage (out of scope).
