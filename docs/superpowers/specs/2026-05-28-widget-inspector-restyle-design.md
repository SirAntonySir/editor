# Widget + Inspector + Toolbar Restyle — Design

**Date:** 2026-05-28
**Status:** Approved for plan-writing
**Prerequisite:** `segment-first-canvas-widgets-complete` tag (current `dev` tip).
**Visual reference:** `.superpowers/brainstorm/2422-1779987232/content/final-composed.html`

## Goal

Tighten the editor's UI to match the user's mental model: tools on the left, image in the middle, a thin synced inspector on the right, and *minimal* floating widget cards on the canvas. The current widget cards waste vertical space with chevrons, separators, oversized buttons, and verbose body text. The inspector ships a redundant "Inspector" tab strip that consumes space. The toolbar is horizontal across the top, competing with the menu bar for visual weight.

After this lands:
- Toolbar moves from a horizontal top strip to a **44px vertical rail on the left**, matching the reference mockup.
- "Inspector" tab strip header is removed entirely from `RightSidebar` (it gated a single tab).
- `WidgetCard` becomes an **ultra-compact card** — header strip (AI badge · title · ×) + tight binding rows + one accent-filled Accept + a small refine icon. No chevron. No separator before lifecycle. The reasoning text moves out of the canvas card entirely.
- `InspectorPanel` reworks into a **dense table**: badge · name · scope chip · chevron in a 4-column grid; the focused row expands inline to show the description. Selection is a single row with a colored chip.
- `ToolWidgetCard` adopts the same compact shape with a grey border and an `×` close (no Accept/Refine — those don't apply to tool widgets).
- Tool widgets open via a **left-rail click**: if a segment is selected, the tool widget appears anchored to that segment with the segment as scope; if not, the tool widget appears top-right with global scope.

## Out of scope

- Reworking individual tool option panels (`processingDef.Panel`) — Curves spline editor, Levels histogram, etc. stay as they render inside `ToolWidgetCard`.
- Theme changes to the menubar / top status strip (those stay).
- Mobile / touch optimization.
- Adding new control-binding types (toggle / color / choice). The widget framework already supports them; populating fused tool templates with them is a separate follow-up.
- Inspector for `graph` mode (`GraphPropertiesPanelBody`) — keep as-is; it has its own structure.

## Architecture

No new components needed. All changes are restyles + position moves + a small interaction tweak (inline-expand on inspector rows).

### Module impact

| File | Change |
|---|---|
| `src/components/toolbar/Toolbar.tsx` | Reorient from horizontal (`h-7 ... px-2`) to vertical (`w-11 ... py-2`), `flex-col`, items 32×32 |
| `src/App.tsx` (layout root) | Re-slot Toolbar from "above canvas" to "left of canvas" |
| `src/components/panels/RightSidebar.tsx` | Drop the `<TabStrip>` element entirely; render `InspectorPanel` (or `GraphPropertiesPanelBody` in graph mode) directly |
| `src/components/inspector/InspectorPanel.tsx` | Redesigned: Selection one-row, Active + Suggestions in 4-column grid, focused row expands inline with description |
| `src/components/inspector/InspectorWidgetRow.tsx` | Rewritten as a grid row + inline-expand region |
| `src/components/inspector/widget/WidgetCard.tsx` | Drop chevron, drop separator above LifecycleActions, drop reasoning paragraph, drop the inline reasoning-on-expand logic, replace outer card with a header-strip layout |
| `src/components/inspector/widget/LifecycleActions.tsx` | Suggestion variant becomes `[✓ Accept (filled, flex-1)] [↻ icon]` + header `×` for dismiss; active variant becomes `[↻ Refine] [⟳ Repeat] [× Delete]` as icon buttons |
| `src/components/widget/ToolWidgetCard.tsx` | Match compact header style; only `×` action |
| `src/store/focus-slice.ts` | Already in place; used by inspector row expand-on-click |
| `src/components/widget/CanvasWidgetLayer.tsx` | No structural change; widget *width* drops from 200–320px to 200–230px |

No new state slices, no new types, no new libs.

## Layout: vertical left rail + no tab strip

### Toolbar (`Toolbar.tsx`)

Current: `<div className="flex-none h-7 flex items-center justify-center px-2 bg-surface border-b border-separator">` wrapping a horizontal `ToggleGroup.Root`.

New: `<div className="flex-none w-11 flex flex-col items-center py-2 bg-surface border-r border-separator gap-1">` wrapping a vertical `ToggleGroup.Root` (Radix supports `orientation="vertical"`).

Each tool button: 32×32 rounded-md with hover/active states. Category separators become a 1px-wide × 18px-tall horizontal divider between groups (was a vertical divider between groups in the horizontal layout).

Tooltips repositioned to fire on the right side of the button instead of below.

### App layout (`App.tsx`)

Currently the editor body has:
```
[menubar]
[toolbar — horizontal top strip]
[canvas | inspector]
```

New:
```
[menubar]
[toolbar | canvas | inspector]
```

The toolbar slots into a CSS grid column to the left of the canvas. The canvas grid column flexes; the inspector keeps its existing 280px fixed width.

### RightSidebar

The existing `TABS` array has only `inspector`. Drop `TabStrip` from the render path:

```tsx
// Before:
return (
  <SidebarShell>
    <TabStrip activeTab={tab} onSelect={setTab} />
    {tab === 'inspector' && (editorMode === 'graph' ? <GraphPropertiesPanelBody /> : <InspectorPanel />)}
  </SidebarShell>
);

// After:
return (
  <SidebarShell>
    {editorMode === 'graph' ? <GraphPropertiesPanelBody /> : <InspectorPanel />}
  </SidebarShell>
);
```

`TabStrip` component stays in the codebase (could be useful later); just unused now. The `RightSidebarTab` type stays for now too — graph plus-icons still set `rightSidebarTab: 'inspector'` post-Task 10; their semantics are unchanged.

## Canvas widget: ultra-compact form

`WidgetCard.tsx` becomes:

```
┌─────────────────────────────────┐
│ [AI]  Warm skin              ×  │ ← header strip, tinted accent/8
├─────────────────────────────────┤   (no visible separator)
│ Temperature           7100K     │
│ ████████░░░░░░░                  │   slider track, accent-filled
│                                 │
│ ┌─────────────┐ ┌──┐             │
│ │ ✓ Accept    │ │↻ │             │ ← Accept = flex-1, ↻ = icon button
│ └─────────────┘ └──┘             │
└─────────────────────────────────┘
```

Dimensions: `minWidth: 200, maxWidth: 230`. Padding: `p-2.5` outer; binding rows `gap-1.5`; lifecycle row `gap-1`. Border `1px solid var(--color-accent)/60`.

Removed elements:
- Chevron button + the `expanded` state (always-open in canvas mode).
- The inner `border-t` separator above LifecycleActions.
- The `<PreviewThumbnail>` (removed earlier).
- The reasoning `<p>` (moved to inspector inline expand).

Header strip details:
- `[AI]` badge: 14×16, `bg-accent text-white rounded-sm text-[8px] font-semibold`, content "AI".
- Title: `text-xs font-medium text-text-primary`, single-line with `truncate`. (Click the title text → toggles focus / no-op for now; future hook for inspector sync.)
- `×` close button: 14×14, `text-text-secondary hover:text-text-primary`. Behavior = same as Dismiss (calls `delete_widget` with `suppress_similar: true`).

Binding row (slider example):
- Label `text-[10px] text-text-secondary` left, value `text-[10px] text-text-primary` right (justify-between).
- Slider input — 3px-tall track, accent-colored thumb (already done in prior fix).
- 6px gap between bindings.

Lifecycle row (suggestion mode):
- `[✓ Accept]`: `flex-1, py-1, px-2, bg-accent text-white rounded text-[10px] font-medium`, hover deepens to `bg-accent-hover`.
- `[↻]` (Refine): `w-7, py-1, bg-surface-secondary text-text-secondary rounded text-[10px]`. Click toggles an inline 1-line text input below for the refinement prompt (replaces the larger refine form). Submit on Enter, dismiss on blur or Escape.

Lifecycle row (active mode — non-suggestion AI widgets):
- Two icon-only buttons: `[↻ Refine]` `[⟳ Repeat]`. Each `w-7 py-1, bg-surface-secondary text-text-secondary`. Tooltips on hover.

The header `×` is the single close affordance in both modes — no duplicate `× Delete` in the lifecycle row.
- On a suggestion widget: header `×` calls `delete_widget(widget_id, suppress_similar: true)` — dismiss + don't suggest this fused tool again.
- On an active widget: header `×` calls `delete_widget(widget_id, suppress_similar: false)` — just delete.

## Tool widget: matching compact form

`ToolWidgetCard.tsx` follows the same compact pattern:
- Header strip: `[icon]` (from `ProcessingRegistry.get(adj.type).icon`, e.g. ∿ for Curves) + name + scope chip + `×`.
- Border `1px solid var(--color-glass-border)` (grey, not accent).
- Body: the existing `processingDef.Panel` rendered as-is.
- No Accept/Refine/Repeat — tool widgets aren't suggestions; the `×` removes the scoped adjustment (existing behavior).

## Inspector: dense table

### Section structure (top to bottom)

1. **Selection** — one row, no card. Shows `[Sel] [chip] [stats]`.
   - When no selection: shows a one-line muted hint `"Click a segment to scope tools and prompts."`
2. **Active · N** — 4-column grid. Rows clickable; focused row expands inline.
3. **Suggestions · N** — same grid pattern. Rows clickable; focused row expands inline.
4. **Segments · N** — chip cloud (existing, unchanged).

No section gets a card background or border. Sections are separated by ~14px gap and a section label.

### Section label

```tsx
<div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1 pb-0.5 border-b border-separator">
  Active · {count}
</div>
```

`Sel` label uses the same style but is inline with the chip row, no border-b.

### Selection row

```tsx
<div className="flex items-center gap-2 px-1.5 py-1 mb-3.5 text-[10px]">
  <span className="text-[8px] uppercase tracking-wide text-text-secondary">Sel</span>
  <span className="bg-accent text-white px-1.5 py-px rounded-full text-[9px] font-semibold">
    {mask.label ?? 'segment'}
  </span>
  <span className="text-text-secondary text-[9px]">{pct}%</span>
</div>
```

### Widget row — 4-column grid

```
┌──┬─────────────┬───────┬──┐
│AI│ Warm skin   │ skin  │ ▸│
└──┴─────────────┴───────┴──┘
```

Grid template: `14px 1fr 50px 14px`, gap `6px`, padding `5px 0`, `border-b border-separator` between rows. Click anywhere on the row → `setFocused(id)`. Chevron icon rotates 90° when focused.

When `focusedId === uw.id`, render an inline expansion BELOW the row:

```
┌────────────────────────────────────┐
│ Lifts warmth on the face region.    │ ← reasoning, text-[9px] text-text-secondary, line-height 1.4
│ Skin tone protected.                │
└────────────────────────────────────┘
```

Expanded region: `bg-accent/5 px-2 py-1.5 border-b border-separator`. Only one row expanded at a time (focus is single-valued).

Icons:
- AI variant: blue square `[AI]` badge as in widget header.
- Tool variant: muted `∿` or whatever the processing's lucide icon is, in `text-text-secondary`.

Scope label: small text in the 50px column, right-aligned, `text-[9px] text-text-secondary`. Shows the segment label (e.g. "skin"), or "global" for global scope.

Chevron: 9px caret. `▸` when not focused, `▾` when focused. Rotates with a 120ms transition.

## Color / token specifics

The whole restyle pulls from existing tokens in `src/index.css`:
- `--color-accent` for AI badges, accept button, selected chip
- `--color-surface` for card backgrounds
- `--color-surface-secondary` for non-primary buttons
- `--color-glass-border` for tool widget borders
- `--color-text-primary` / `--color-text-secondary` / `--color-separator` for text + dividers

The accent color was changed by the user to a purple (`#7c5cff` in the mockup); the design uses whatever `--color-accent` currently is.

## Interaction behaviors

### Widget card

- Always rendered expanded (no collapse state on canvas).
- `×` in header = dismiss (suggestions) or delete (active).
- `✓ Accept` = `accept_widget` → `widget.accepted` event → materialized to adjustments.
- `↻ Refine` icon → toggles a one-line text input inline (replaces the larger refine form from before).
- Refine input submits on Enter, cancels on Escape or blur.
- Drag-to-move: pointer-down on header (NOT on buttons/inputs/sliders) initiates a drag offset (existing behavior).

### Inspector row

- Click row → `setFocused(uw.id)`. Same row clicked again with focus already on it → `setFocused(null)` (collapse).
- Hover row → `setHovered(uw.id)`, which the canvas widget can listen to for glow (already wired in earlier task).
- Chevron rotates on focus state change.

### Tool widget on rail click

- Click tool icon in left rail with a segment selected → tool widget appears anchored to that segment, with `activeScope` set so the resulting adjustment is scoped.
- Click tool icon with no segment selected → existing global-scope behavior.

(Both behaviors already exist via `setActiveScope` in the tool's `onActivate`; this section just confirms expected UX.)

## Component sizes — exact spec

| Element | Width × Height |
|---|---|
| Left tool rail | 44 × full |
| Tool icon button | 32 × 32, `rounded-md` |
| Canvas AI widget | minWidth 200, maxWidth 230 |
| Canvas tool widget | minWidth 200, maxWidth 280 (Curves needs the spline canvas room) |
| Widget header strip | full × 24 |
| Widget AI badge | 16 × 14 |
| Widget × close button | 14 × 14 |
| Widget binding slider track | full × 3 |
| Widget Accept button | flex-1 × 22 |
| Widget refine icon | 28 × 22 |
| Inspector row | full × 22 |
| Inspector expanded region | full × auto (3–6 lines reasoning) |
| Inspector chevron | 9 × 9 |
| Inspector segment chip | auto × 16, `rounded-full` |

## File-level plan

| File | Action |
|---|---|
| `src/components/toolbar/Toolbar.tsx` | Restyle layout: vertical, 44px wide, 32×32 buttons, horizontal separators between categories |
| `src/App.tsx` | Update editor layout grid: toolbar becomes a left column instead of a top row |
| `src/components/panels/RightSidebar.tsx` | Remove `<TabStrip>` element; render `InspectorPanel` or `GraphPropertiesPanelBody` directly |
| `src/components/inspector/InspectorPanel.tsx` | Rewrite section structure: no card backgrounds, dense grid for widget rows, one-row Selection |
| `src/components/inspector/InspectorWidgetRow.tsx` | Rewrite as a 4-column grid row + chevron + inline expansion when focused |
| `src/components/inspector/widget/WidgetCard.tsx` | Drop chevron + reasoning paragraph + outer separator. Replace with header-strip layout. Always-expanded in canvas mode |
| `src/components/inspector/widget/LifecycleActions.tsx` | Restyle: suggestion variant → `[✓ Accept (flex-1)] [↻]`; active variant → three icon buttons; refine becomes inline 1-line input |
| `src/components/widget/ToolWidgetCard.tsx` | Adopt compact header + `×` close, scope chip in header |
| `src/components/widget/CanvasWidgetLayer.tsx` | Reduce widget maxWidth from 260/320 to 230. No structural change beyond that |
| (no test file changes mandatory — existing tests assert behavior, not styles) | |

## Test plan

Existing tests don't pin specific class names or sizes; they assert behaviors (text content, click handlers, scope mappings). The restyle should not break:

- `widget-card.test.tsx` (4 tests) — still asserts intent renders, Accept button exists, slider drag fires set_widget_param. All pass through the restyle.
- `InspectorPanel.test.tsx` (3 tests) — Selection hint visible when empty, selection card renders when set, suggestions section renders. The text strings the tests look for ("Click a segment", "scope · {label}", section labels) stay.
- `widget-projection.test.ts`, `segment-selection-slice.test.ts`, etc. — no UI assertions, unaffected.

Manual verification (per the user's feedback loop): refresh, upload, observe:
1. Tools appear as a vertical rail on the left.
2. No "Inspector" header at the top of the right sidebar.
3. Widgets are compact (~220px wide), header strip with AI badge + title + ×, single slider row per binding, one Accept button + small refine icon.
4. Inspector rows are tight; click a row → row's chevron rotates, description appears inline below the row.
5. Selection is a one-row stripe at the top of the inspector, not a card.

## Open design decisions (locked-in defaults)

| Decision | Default |
|---|---|
| Header strip background | `bg-accent/8` (subtle tint) for AI; `bg-surface-secondary` for tool widgets |
| Refine inline input position | Below the bindings, above the lifecycle row, when toggled |
| Drag handle on widget | Entire header strip (excluding the `×` button) acts as the drag handle |
| Inspector row hover background | `bg-surface-secondary` |
| Inspector focused row background | `bg-accent/8` with `border-l-2 border-accent` (matches existing focused style) |
| Section heading divider | `border-b border-separator` 1px under the heading, 2px below it |

## Tech stack

No additions. The restyle uses only existing tokens, primitives (Radix toggle group, Radix tooltip), and components.
