# UI Makeover — Glass → Vercel/Radix Flat Minimal

- **Date:** 2026-05-29
- **Status:** Approved (design), pending spec review
- **Branch:** `feat/canvas-centric-ui`
- **Scope:** Frontend visual register only. No changes to backend, engine SSoT, store logic, or processing pipeline.

---

## 1. Goal

Replace the editor's translucent **glass-panel / Apple-HIG** aesthetic with a **minimal, flat Vercel/Radix register**: solid surfaces separated by 1px hairlines, no blur, no heavy shadows, tightened radii, restrained motion, and the **Geist** type family. The photograph is the visual center; all chrome (panels, widgets, icons) is purely operative and recedes.

This is a styling + cleanup pass. Behavior, layout topology (left toolrail · centered canvas · right inspector), and data flow are unchanged.

### Non-goals
- No relayout of the editor surface (toolrail/canvas/sidebar stay where they are).
- No renaming of already-clean semantic tokens (`surface`, `text-primary`, `separator`, `accent`) — only glass-specific tokens are removed. This avoids ~45 mechanical edits for no semantic gain.
- No new features. No backend/store/pipeline changes.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Default theme | **Light** (dark mode retained) |
| Typography | **Geist Sans** (UI) + **Geist Mono** (all numerals, tabular-nums) |
| Motion | **Restrained & crisp** — no springs, no scale-pop, no `layoutId` slide; opacity + 4px translate, 120–160ms ease |
| Cleanup | **Lean** — delete dead + redundant code |
| Token strategy | **Semantic rename (clean)** — remove glass tokens, introduce a single hairline `--color-separator`, add `--shadow-overlay`, `--color-border-strong`, `--font-mono` |
| History panel | **Remove** the dead-but-wired `LeftSidebar`/`HistoryPanel` feature |

---

## 3. Token system (`src/index.css` `@theme`)

### 3.1 Removed tokens
- `--color-glass-bg` (light + dark)
- `--color-glass-border` (light + dark)
- `--shadow-panel`

### 3.2 Re-valued tokens (names kept → zero utility churn)

| Token | Light (new) | Dark (new) | Notes |
|---|---|---|---|
| `--color-surface` | `#ffffff` | `#0a0a0a` | All panels/chrome/overlays |
| `--color-surface-secondary` | `#f4f4f5` | `#1a1a1a` | Recessed wells, kbd chips, hover targets |
| `--color-canvas-bg` | `#ededee` | `#000000` | App + canvas backdrop (body bg) |
| `--color-text-primary` | `#171717` | `#ededed` | Body |
| `--color-text-secondary` | `#737373` | `#a1a1a1` | Labels, hints |
| `--color-separator` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.10)` | **Canonical hairline** — dividers + panel/overlay edges + control borders |
| `--color-accent` | `#0071e3` | `#0071e3` | Unchanged (≈ Vercel blue) |
| `--color-accent-hover` | `#0077ed` | `#0077ed` | Unchanged |

### 3.3 Added tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-border-strong` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.20)` | Input/control borders, focused dividers |
| `--shadow-overlay` | `0 4px 14px rgba(0,0,0,0.10)` | `0 4px 14px rgba(0,0,0,0.50)` | **Floating overlays only** (menus, dropdowns, tooltips, dialogs, selection bar) |
| `--font-mono` | `'Geist Mono', ui-monospace, 'SF Mono', monospace` | — | All numerals |

### 3.4 Re-valued, names kept

- `--font-sans`: `'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif`
- `--radius-panel`: `12px → 8px`
- `--radius-button`: `8px → 6px`
- `--radius-sm`: `6px → 4px`
- `--duration-fast`: `150ms → 120ms`
- `--duration-normal`: `250ms → 160ms`
- `--ease-apple`: **name kept** (renaming would break the `ease-apple` Tailwind utility), value unchanged `cubic-bezier(0.2, 0, 0, 1)`. Only the spring **JS defaults** change — see §6.
- `--shadow-button`: grep shows no consumers — **remove** it (lean cleanup). If implementation finds a live use, re-value to `0 1px 2px rgba(0,0,0,0.06)` instead.

---

## 4. Surface treatment

Two surface kinds replace the single glass substrate:

- **Docked chrome** (menubar, toolrail, sidebars, status bar): `bg-surface` + 1px `--color-separator` edge. **No shadow, no blur.** Plain Tailwind utilities.
- **Floating overlays** (menus, dropdowns, context menus, tooltips, dialogs, the selection-actions bar): new `.overlay` utility class in `index.css`:

```css
.overlay {
  background: var(--color-surface);
  border: 1px solid var(--color-separator);
  box-shadow: var(--shadow-overlay);
  border-radius: var(--radius-panel);
}
```

- **Dialog scrim**: solid `bg-black/40`, **no `backdrop-blur`**.
- `.glass-panel` class is **deleted**. Each site migrates to `.overlay` (floating) or plain flat utilities (non-floating). No `backdrop-filter` / `backdrop-blur` anywhere in the app.

---

## 5. Complete migration inventory

### 5.1 `.glass-panel` className sites → `.overlay` or flat utilities

| File:line | Surface | Replacement |
|---|---|---|
| `App.tsx:107` | Empty-state "Open Image" button | `bg-surface border border-separator rounded-[var(--radius-button)] hover:bg-surface-secondary` |
| `EditorDialog.tsx:30` | Dialog body | `.overlay` |
| `EditorDialog.tsx:21` | Scrim | drop `backdrop-blur-sm`, keep `bg-black/40` |
| `PreferencesPage.tsx:64` | Dialog body | `.overlay` |
| `PreferencesPage.tsx:159` | Settings sub-section card | `bg-surface-secondary border border-separator rounded-[var(--radius-panel)]` (no shadow) |
| `ReasoningBadge.tsx:29` | Tooltip | `.overlay` |
| `LayerProperties.tsx:56` | Blend-mode dropdown | `.overlay` |
| `LayersPanel.tsx:151` | Blend-mode dropdown | `.overlay` |
| `LayersPanel.tsx:312` | Layer context menu | `.overlay` |
| `Toolbar.tsx:118` | Tool tooltip | `.overlay` |
| `MenuBar.tsx:546/558/570` | Tooltips (×3) | `.overlay` |
| `SelectionActionsOverlay.tsx:40` | Floating action bar | `.overlay` |
| `CanvasContextMenu.tsx:20` | Canvas context menu | `.overlay` |

### 5.2 Token-name Tailwind utilities (break on glass-token removal)

| File:line | Current | Replacement |
|---|---|---|
| `MenuBar.tsx:25` (`menuContentClass`) | `bg-glass-bg/95 backdrop-blur-xl border border-glass-border shadow-panel` | `bg-surface border border-separator shadow-overlay` (drop blur) |
| `Toolbar.tsx:126` | `fill-glass-bg` (Tooltip.Arrow) | `fill-surface` |
| `ToolWidgetCard.tsx:30` | `bg-surface/95 border border-glass-border shadow-lg backdrop-blur-sm` | `bg-surface border border-separator shadow-overlay` (drop alpha + blur) |
| `CursorBindGhost.tsx:33-34` | `bg-surface/90 border border-glass-border shadow-lg backdrop-blur-sm` | `bg-surface border border-separator shadow-overlay` |
| `CanvasWidgetLayer.tsx:373` | `bg-surface/80 border border-dashed border-glass-border` | `bg-surface border border-dashed border-separator` |
| `AskAiInput.tsx:37` | `border border-glass-border` | `border border-separator` |
| `LifecycleActions.tsx:73` | `border border-glass-border` | `border border-separator` |
| `WidgetCard.tsx:45` | `border-glass-border` (tool variant) | `border-separator` (AI variant keeps `border-accent/60`) |
| `RegionPickerControl.tsx:24` | `bg-surface border border-glass-border` | `bg-surface border border-separator` |
| `ChoiceControl.tsx:22` | `bg-surface border border-glass-border` | `bg-surface border border-separator` |
| `App.tsx:119` | status bar `bg-surface/70 backdrop-blur-sm` | `bg-surface border-t border-l border-separator` (solid) |

### 5.3 Numerals → Geist Mono (`font-mono` + `tabular-nums`)
Apply mono/tabular to numeric readouts: canvas zoom % (`App.tsx` `ZoomDisplay`), slider value readouts (`AdjustmentSlider`, widget `SliderControl`/`BindingRow`), layer opacity %, kbd chips (`Kbd.tsx`), histogram axis labels (`Histogram.tsx`, `HistogramsSection`), levels/curves numeric fields. Audit during implementation; add a small `.num` helper class (`font-mono tabular-nums`) in `index.css`.

---

## 6. Motion changes

- **Framer Motion house default** changes from `{ type: 'spring', stiffness: 400, damping: 30 }` to a tween `{ duration: 0.16, ease: [0.2, 0, 0, 1] }`. Audit every `transition={{ type: 'spring' ... }}` and `whileHover`/`whileTap` scale.
- **Panel/overlay entrances**: `initial={{ opacity: 0, y: 4 }}` → `animate={{ opacity: 1, y: 0 }}`, no `scale`. (Was `scale: 0.96` pop.)
- **Toolbar active indicator** (`Toolbar.tsx`): remove the shared `layoutId` sliding spring; active state is a solid accent background applied instantly (or 120ms color fade).
- **Remove** `whileHover={{ scale: 1.05 }}` / `whileTap={{ scale: 0.95 }}` button bounce; replace with background/opacity transitions.
- Keep `AnimatePresence mode="wait"` content swaps but retune to the new fast tween.
- Reduced-motion block in `index.css` stays.

---

## 7. Typography / Geist integration

- Add the **`geist`** npm package (`npm i geist`). It ships Geist Sans + Geist Mono as self-hosted fonts (no network/CDN at runtime).
- Import the font CSS once (in `src/main.tsx` or top of `index.css` via the package's font files); set `--font-sans` / `--font-mono` to the Geist family names.
- Verify license/bundle: `geist` is MIT, fonts self-hosted through Vite — acceptable.

---

## 8. Deletions

| Target | Reason | Follow-up edits |
|---|---|---|
| `components/panels/GlassPanel.tsx` | Component imported by **nobody** (verified) | none |
| `components/ui/CommandPalette.tsx` | Unused; only a stale comment in `layer-compositor.ts:59` references the concept | fix that comment |
| `components/widget/SpawnPaletteWidget.tsx` + `SpawnPaletteWidget.test.tsx` | Returns `null`; superseded by inline `AskAiInput` | remove import + `<SpawnPaletteWidget />` render in `App.tsx`; **keep** the ⌘K `useEffect` (App.tsx:145) that dispatches `spawn-palette:open` — `AskAiInput` listens for it; fix stale comments at `App.tsx:143/197` and `useSegmentInteraction.ts:9` |
| `index.css` graph/react-flow CSS | Dead: no react-flow dep, no `graph/` folder | delete `.graph-node-gradient`, `.graph-editor-bg`, all `.react-flow__*` rules; check `.node-focused`/`node-focus-glow` and `widget-pulse`/`pulse` for live usage before removing |
| History feature: `panels/LeftSidebar.tsx`, `panels/HistoryPanel.tsx` | `LeftSidebar` never mounted (App renders only `RightSidebar`) | remove `showHistoryPanel`/`toggleHistoryPanel` from `tool-slice.ts`; remove `toggleLeftSidebar`/`setLeftSidebarWidth`/`leftSidebarWidth` from `preferences-store.ts`; remove View→History item in `MenuBar.tsx:344-370`; remove ⌘[ binding in `keyboard-shortcuts.ts:83-88`. Undo/redo (⌘Z) unaffected. |

---

## 9. Documentation rewrites

- **`design.md`** — full rewrite of the visual register: new flat aesthetic statement, token tables (§3), the `.overlay` pattern replacing §3 "Glass Panel Pattern", docked-vs-floating treatment, Geist typography, restrained-motion section, updated Do/Don't. Remove all glass/blur language and the `graph/` folder reference in the tier table.
- **`CLAUDE.md`** — update: remove `panels/GlassPanel.tsx` from the primitives line; replace "glass panels, spring animations, SF Pro" design-language phrasing with the flat/Geist register; remove `GlassPanel` from the component-architecture primitive examples.

---

## 10. Verification

- `npm run check` (tsc -b + eslint + `no-nested-component`) must pass.
- `npm run dev`: manually verify in the browser, **both** light (default) and dark themes:
  - Open File menu, blend-mode dropdown, layer context menu, canvas context menu, a tooltip, the Preferences dialog, the selection-actions bar → all read as flat panels with hairline + soft shadow, **no blur**.
  - Toolrail active state, slider drag, toggle → motion is quick, no bounce.
  - Numerals render in Geist Mono.
  - Empty state + "Open Image" button.
- Grep gate: zero matches for `glass-panel`, `glass-bg`, `glass-border`, `backdrop-filter`, `backdrop-blur`, `shadow-panel` across `src/`.

---

## 11. Risks / notes

- **Geist load**: confirm the `geist` package's Vite import path works under the project's Tailwind v4 setup; fall back to `@fontsource-variable/geist` if needed.
- **`node-focus-glow` / `pulse` / `widget-pulse`** keyframes: confirm live usage before deleting (the glow was likely graph-only; pulses may still drive widget feedback).
- **ToolWidgetCard / CursorBindGhost / CanvasWidgetLayer** are on-canvas widget overlays not caught by the first exploration — they're included in §5.2.
- Migration is largely mechanical find/replace; the risk is missing a site. The §10 grep gate is the backstop.
