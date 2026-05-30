# design.md — Photo Editor Visual Register

Authoritative reference for the editor's visual language. Any new component must read this first.

The aesthetic is **minimal flat Vercel/Radix**: solid surfaces, 1px hairline borders, no blur, no backdrop-filter, image-centred, content over chrome. Light is the default theme; dark is retained via `data-theme="dark"` on the root element.

---

## 1. Tier Boundaries

Three tiers, mirroring `CLAUDE.md`. Visuals live mostly in tiers 1 and 2; page scaffolds compose them without restyling.

| Tier | Location | Examples | Allowed concerns |
|---|---|---|---|
| 1. Primitives | `src/components/ui/` | `Kbd`, `Empty`, `Swatch`, `PercentBar` | Tokens, layout, atomic interaction |
| 2. Level-2 | `inspector/`, `panels/`, `toolbar/`, `canvas/` | `InspectorPanel`, `LayersPanel`, `Toolbar` | Compose primitives, read stores |
| 3. Scaffolds | root of `src/components/` | `EditorDialog`, `PreferencesPage` | Wire tier-2 into surfaces |

A primitive must not import from a level-2 folder. A level-2 component must not import from a scaffold. Scaffolds never import each other.

---

## 2. Design Tokens

All tokens live in `src/index.css` under `@theme`. **Never hardcode hex, px, ms, or cubic-bezier values for design quantities.** Use the token; if a token is missing, propose adding it.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-surface` | #ffffff | #0a0a0a | Docked chrome backgrounds; overlay base |
| `--color-surface-secondary` | #f4f4f5 | #1a1a1a | Recessed panels, kbd chips, input fills |
| `--color-text-primary` | #171717 | #ededed | Body text |
| `--color-text-secondary` | #737373 | #a1a1a1 | Labels, hints, reasoning badges |
| `--color-separator` | rgba(0,0,0,0.08) | rgba(255,255,255,0.10) | Faint dividers — docked section borders, inset cards, input edges, dashed skeletons |
| `--color-border-strong` | rgba(0,0,0,0.15) | rgba(255,255,255,0.20) | Visible edge for floating/elevated surfaces (`.overlay` class, MenuBar menu, Choice/RegionPicker dropdowns, on-canvas widget cards) |
| `--color-accent` | #0071e3 | #0071e3 | Selection, focus rings, primary actions |
| `--color-accent-hover` | #0077ed | #0077ed | Hover state for accent elements |
| `--color-canvas-bg` | #ededee | #000000 | Editor backdrop (outside the image) |

**Separator vs border-strong rule:**
- `--color-separator` — use for dividers between **docked** UI sections (toolbar bottom edge, inspector section headers, input field borders, dashed placeholder skeletons). It is intentionally faint and structural. Input/field borders always use `--color-separator`, even when the input sits inside a floating `.overlay` surface — only the outer perimeter of a floating surface uses `--color-border-strong`.
- `--color-border-strong` — use for the visible perimeter edge of **floating / elevated** surfaces: the `.overlay` class, dropdown menus, context menus, tooltip bubbles, dialog edges, and widget cards that float over the canvas. It reads as a distinct boundary lift.

Dark mode is applied via `data-theme="dark"` on the root. Components must use tokens — never branch on theme in JSX.

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-panel` | 8px | Floating overlays, dialogs, widget cards |
| `--radius-button` | 6px | Buttons, toolbar slots |
| `--radius-sm` | 4px | Inline pills, badges, tags |

> Border radius is user-tunable via three Preferences presets (small/medium/large); the `medium` preset = 8 / 6 / 4. Always use the radius tokens so a preset change propagates — never hardcode px.

### Spacing

`--spacing: 8px`. Tailwind utilities (`p-2`, `gap-3`, etc.) map onto an 8-point grid. Use multiples of `--spacing`; never `7px` or `11px`.

### Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-overlay` | Light: `0 4px 14px rgba(0,0,0,0.10)` / Dark: `0 4px 14px rgba(0,0,0,0.50)` | Floating overlays only |

**Docked chrome has no shadow.** Only floating surfaces (`.overlay`) carry `--shadow-overlay`. Do not add shadow to the sidebar, toolbar, inspector rail, or any surface that is pinned to the layout.

### Motion

| Token | Value | Use |
|---|---|---|
| `--ease-apple` | cubic-bezier(0.2, 0, 0, 1) | Default easing for all CSS transitions |
| `--duration-fast` | 120ms | Hover states, focus rings, tooltip fades |
| `--duration-normal` | 160ms | Panel slide-in, overlay entrance, view switch |

Framer Motion entrances use **opacity + ~4px translate tweens** at `--duration-normal`, not spring physics:

```ts
// canonical entrance tween
{ opacity: [0, 1], y: [4, 0], duration: 0.16, ease: [0.2, 0, 0, 1] }
// ease mirrors --ease-apple (Framer Motion can't read CSS vars — this is the one allowed exception to "never hardcode cubic-beziers")
```

Use `AnimatePresence mode="wait"` for content swaps inside a panel with a matching exit tween (`y: [0, -4]`). **Do not use `type: 'spring'`, `layoutId`, or scale-pop animations.** Motion must be restrained and instrumental — it communicates state change, not delight.

### Typography

`--font-sans: 'Geist Variable', ui-sans-serif, system-ui, -apple-system, sans-serif`
`--font-mono: 'Geist Mono Variable', ui-monospace, 'SF Mono', monospace`

| Use | Size | Weight | Colour |
|---|---|---|---|
| Panel title | 12px (`text-xs`) | 500 (`font-medium`) | `text-text-secondary` |
| Body | 13–14px | 400 | `text-text-primary` |
| Hint / label | 10–11px | 400 | `text-text-secondary` |
| Kbd chip | 10px (`text-[10px]`) | 400 | `text-text-secondary` over `bg-surface-secondary/60` |
| Numeric readout (`.num`) | context-dependent (matches surrounding body/hint size) | 400 | via `.num` class (Geist Mono + tabular-nums) |

**Numeric readouts** (slider values, histogram counts, coordinates, percentages) use the `.num` utility class — this applies Geist Mono with `font-variant-numeric: tabular-nums` so digits are fixed-width and don't cause layout jitter as values update.

---

## 3. The Overlay Pattern

`.overlay` is the visual substrate for every **floating** UI surface. Don't reimplement it. Apply the class (or compose its tokens) whenever a surface needs to float above the canvas or docked chrome.

```css
/* Defined in src/index.css */
.overlay {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  box-shadow: var(--shadow-overlay);
  border-radius: var(--radius-panel);
}
```

Use `.overlay` for: dropdown menus, context menus, tooltip bubbles, floating dialogs, the selection-actions bar, and on-canvas widget cards.

**Docked chrome** (sidebar, toolbar, inspector rail, status bar) uses `background: var(--color-surface)` with `border-color: var(--color-separator)` on its exposed edge(s). No shadow, no blur, no `backdrop-filter`.

There is **no `backdrop-filter` anywhere in this codebase.** Do not introduce blur or backdrop-filter for any reason.

---

## 4. Layout Conventions

- **Inspector** is a docked right-rail panel. Width `w-56` is the canonical inspector width.
- **Toolbar / MenuBar** is full-width across the top — docked chrome.
- **Layers** panel docks to the left or bottom rail depending on the layout variant.
- **Dialogs** (Preferences, Export) use Radix Dialog over a dimmed backdrop, sized to content; the dialog surface uses `.overlay`.
- **Widget cards** that float over the canvas use `.overlay` and `position: absolute` with explicit z-index.
- **Status bar** — full-width (or bottom-right) docked chrome; `bg-surface` with a `border-separator` top/left edge, no shadow.

Headers inside panels use `px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator`.

---

## 5. Iconography

- **Lucide React only.** Named imports (`import { Sun } from 'lucide-react'`). Never star-import.
- Icon size 16px in toolbars, 14px inline with text, 12px for badges.
- Stroke width 1.5–2; default Lucide stroke is fine.

---

## 6. Interaction Affordances

- **Hover** — subtle background lift to `--color-surface-secondary`. No outline.
- **Active / pressed** — slightly darker than hover; no scale change on buttons.
- **Focus ring** — Radix default, recoloured to `--color-accent`.
- **Tooltips** — Radix Tooltip, content uses `.overlay`, 150ms delay. Tooltip bubbles may override `border-radius` to `--radius-sm` (4px), since `.overlay` defaults to `--radius-panel` (8px), which is too large for a small bubble.
- **Drag handles** — `cursor: grab` → `cursor: grabbing` on active.

---

## 7. AI-Specific Visual Rules (from the thesis)

The thesis commits to: *"AI affordances should remain subtle and optional."* New AI-driven UI follows the same flat-surface register as everything else, with one additional rule:

- **Reasoning badges** — small inline pill (radius `--radius-sm`, background `--color-surface-secondary/60`, text `text-text-secondary`), shows a Lucide `Sparkles` icon plus a one-word source ("AI"). Hover reveals a tooltip with the model's reasoning, model name, and timestamp.
- **AI panel layers** — render in the same `InspectorPanel` flat surface as standard tools. Section header `"AI Suggestion"` with the goal text as subtitle. Layer-level visibility toggle uses the same eye icon as regular layers.
- **Region overlays** — semi-transparent fill in `--color-accent` at 18% opacity, 1.5px stroke at full accent. Label uses the same kbd-style chip as `Kbd`, anchored to the centroid.
- **No new colour for "AI"** — do not introduce a "purple = AI" or similar visual code. AI content uses the same accent as user-initiated work; it's the iconography (Sparkles) and the badge that signals AI provenance.

---

## 8. Do / Don't

✅ **Do**
- Reuse `Kbd`, `Empty`, and the rest of `ui/`; apply `.overlay` for floating surfaces.
- Use tokens for every colour, radius, shadow, spacing, and motion value.
- Keep panel content terse — labels, not paragraphs.
- Animate panel entrances with opacity + 4px translate tweens (`--duration-normal`, `--ease-apple`).
- Use `.num` for all numeric readouts.

❌ **Don't**
- Hardcode hex, px, or ms for design tokens. (Layout `px-3`, `gap-2` is fine; raw values for design properties are not.)
- Use `backdrop-filter` or any form of blur anywhere.
- Introduce a new colour outside the token set without proposing the token first.
- Use spring animations (`type: 'spring'`), `layoutId`, or scale-pop effects.
- Animate with linear easing or sub-100ms durations for view-level transitions.
- Style by writing `style={{ ... }}` inline when a Tailwind utility or class exists.
- Add shadow to docked chrome (only `.overlay` floating surfaces get `--shadow-overlay`).

---

## 9. Updating This File

When the visual language evolves:
1. Update `src/index.css` tokens first.
2. Update this file's token tables and examples.
3. Update `CLAUDE.md` if the tier rules change.
4. Run `npm run check` to verify nothing regressed.

---

## 10. Canvas Workspace (React Flow)

The editor canvas is an infinite React Flow workspace (`src/components/workspace/CanvasWorkspace.tsx`). Two node types and one edge type carry all visible state.

**ImageNode** (`src/components/workspace/ImageNode.tsx`). A flat `.overlay` card with header (icon · name · `N LAYERS` badge) · body `<canvas>` driven by `useImageNodeRender` · footer (`{w} × {h}` · `Layer N`). When the node is selected, a stack strip appears below the body for multi-layer nodes and a circular split/menu affordance at the top-right opens a Radix DropdownMenu with **Split last layer** / **Delete**. Each node also acts as the trigger for an `ImageNodeSelectionPopover` anchored to its header, surfacing **Create layer** / **Discard** when a committed selection mask sits inside its layers.

**WidgetNode** (`src/components/workspace/WidgetNode.tsx`). A thin wrapper that renders the unchanged `WidgetShell` as its body. Cross-reference §11 for the WidgetShell anatomy.

**TetherEdge** (`src/components/workspace/TetherEdge.tsx`). A bezier curve in `--color-accent` with 3px accent endpoints. Solid stroke for layer-scope tethers (the widget edits a single layer); `stroke-dasharray="3 3"` for node-scope (the widget edits the whole composite). Tethers carry attribution only — they have no DAG semantics and never resolve to data flow.

**Soft auto-layout.** New widget and image nodes spawn via `nextSpawnPositionFor` (`src/components/workspace/workspace-layout.ts`): one slot to the right of the target with a 24px gap, shifting down to clear occupied slots. Once placed, users drag nodes freely; the layout helper only computes initial placement.

**Selection & keyboard.** React Flow owns transient multi-selection. `onSelectionChange` mirrors the single-image-node case into `activeImageNodeId` on the workspace slice (see `src/hooks/useWorkspaceSelection.ts`). A `WorkspaceKeyHandler` child of `<ReactFlow>` handles `Delete`/`Backspace` for selected image nodes (`removeImageNode`), widget nodes (`backendTools.delete_widget`), and edges (`unbindEdge`). Inputs/textareas/contenteditable early-out.

**Spawn paths.** Three origins → one backend call (`backendTools.propose_widget`). Toolrail clicks gate on a present `activeImageNodeId` and show a toast otherwise. SSE-time tether creation lives in `src/lib/workspace-tether.ts` and reads the new widget's `nodes[0].layer_id` to build a layer-scope or node-scope `TetherEdgeState`. Suggestions ↗ engages run the same tether builder synchronously.

**Sidebar.** Suggestions stay in the right panel; the canvas surfaces every active widget directly as a `WidgetNode`. There is no on-canvas dock.

**Composite-then-apply.** For node-scope adjustments (`operation_graph.nodes[].layer_ids` is set), `image-node-renderer.ts` runs the per-layer composite first, then pipes the canvas back through `PipelineManager` to apply the node-scope shader pass to the entire composite. Overlays (full-image outline, mask fills/outlines, segmentation chrome) render last so they stay on top.

---

## 11. Widget Shell (inside WidgetNode)

The WidgetShell anatomy from the canvas-centric UI project is unchanged; it lives as the body of every `WidgetNode`. The calculated right-edge dock and anchor tick layer are retired — the React Flow workspace is the host now, and node position is decided by `workspace-layout.ts` (auto) and React Flow drag (manual).

**States.** Widgets spawn collapsed (title strip with variant badge · intent · dirty dot · scope chip · chevron). Click the strip to expand the full card (reasoning · preview · bindings · footer with Refine · Why? · Reset · Apply).

**Variant badge.** AI badge for `mcp_*`/`refine`/`repeat` origins; muted `·` chip for `tool_invoked` / `fused_expansion`.

**Lifecycle (live + Apply = bake).** Slider edits flow through the existing optimistic + `set_widget_param` path. **Apply** calls `accept_widget` and bakes the effect into `operation_graph` (the widget vanishes from the canvas). **×** dismisses (effect undone). **Reset** reverts every binding to its default. **Refine** opens an inline text input that calls `refine_widget` with the typed instruction.
