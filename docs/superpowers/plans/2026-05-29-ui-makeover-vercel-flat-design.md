# UI Makeover (Glass → Vercel/Radix Flat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's translucent glass-panel aesthetic with a flat, minimal Vercel/Radix register — light default theme, Geist typography, restrained motion, lean cleanup — without changing layout, behavior, or the engine.

**Architecture:** Pure frontend visual pass. Migrate design tokens in `src/index.css` (additive first, delete glass last so every commit builds), restyle ~25 className sites from glass → a new `.overlay` flat-surface class + plain utilities, retune Framer Motion from springs to fast tweens, delete dead/redundant components, and rewrite `design.md` + `CLAUDE.md`. Backstopped by `npm run check` after every task and a final grep gate.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4 (`@theme` tokens), Framer Motion, Radix UI, Fontsource Geist (variable).

**Source spec:** `docs/superpowers/specs/2026-05-29-ui-makeover-vercel-flat-design.md`

**Verification primitives used throughout:**
- `npm run check` → runs `tsc -b && eslint . && vitest run`. Must pass (green) after every task before committing.
- `npm run dev` → open http://localhost:5173, used for visual checks. Toggle theme via Preferences (⌘,) → Appearance.

---

## File-touch map

| File | Responsibility | Tasks |
|---|---|---|
| `package.json` | add Fontsource Geist deps | 1 |
| `src/main.tsx` | import font CSS | 1 |
| `src/index.css` | token system, `.overlay`/`.num` utilities, delete glass+graph CSS | 1, 2, 9 |
| `src/store/preferences-store.ts` | retune `RADIUS_VALUES.medium`; remove `leftSidebar*` | 2, 8 |
| 10 overlay sites (dialogs, menus, tooltips, context menus, selection bar) | glass-panel → `.overlay` | 3 |
| 12 token-utility / translucent / blur sites | glass utilities → separator/surface/shadow-overlay | 4 |
| `Toolbar.tsx`, `EditorDialog.tsx`, `PreferencesPage.tsx` | motion: springs → fades, drop scale/layoutId | 5 |
| numeric readouts (`App` zoom, sliders, histogram, opacity) | Geist Mono tabular | 6 |
| `GlassPanel.tsx`, `CommandPalette.tsx`, `SpawnPaletteWidget.tsx`(+test), `App.tsx` | delete dead components | 7 |
| `LeftSidebar.tsx`, `HistoryPanel.tsx`, `tool-slice.ts`, `preferences-store.ts`, `MenuBar.tsx`, `keyboard-shortcuts.ts`, `LayersPanel.tsx` | remove dead History feature | 8 |
| `src/index.css` | delete glass tokens, `.glass-panel`, graph/react-flow CSS | 9 |
| `design.md`, `CLAUDE.md` | doc rewrites | 10 |

---

## Task 1: Add Geist fonts (Fontsource)

`geist/font` is Next.js-only; for Vite use the framework-agnostic Fontsource variable packages.

**Files:**
- Modify: `package.json` (via npm)
- Modify: `src/main.tsx:1-4`
- Modify: `src/index.css:34-35` (font tokens)

- [ ] **Step 1: Install the font packages**

Run:
```bash
npm i @fontsource-variable/geist @fontsource-variable/geist-mono
```
Expected: both added to `dependencies`, no errors.

- [ ] **Step 2: Confirm the exact CSS family names**

Run:
```bash
grep -h "font-family:" node_modules/@fontsource-variable/geist/index.css node_modules/@fontsource-variable/geist-mono/index.css | head
```
Expected: lines like `font-family: 'Geist Variable';` and `font-family: 'Geist Mono Variable';`. **Use whatever names print here** in Step 4 if they differ.

- [ ] **Step 3: Import the font CSS in `src/main.tsx`**

Change the top of `src/main.tsx` from:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
```
to:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'
```

- [ ] **Step 4: Point the font tokens at Geist in `src/index.css`**

Replace line 35:
```css
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
```
with:
```css
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;
```

- [ ] **Step 5: Verify build + visual**

Run: `npm run check` → Expected: PASS (green).
Run: `npm run dev`, open the app → Expected: all UI text renders in Geist (geometric grotesque, not SF/system).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/index.css
git commit -m "feat(ui): add Geist Sans + Mono via Fontsource"
```

---

## Task 2: New token values + `.overlay`/`.num` utilities (additive — keep glass for now)

Re-value the kept tokens to the flat light palette, add the new tokens/utilities, and tighten radii. **Do not** delete glass tokens or `.glass-panel` yet (sites still use them; removing now breaks the build). Glass is removed in Task 9.

**Files:**
- Modify: `src/index.css:4-48` (`@theme` + dark block) and add utility classes
- Modify: `src/store/preferences-store.ts:28` (`RADIUS_VALUES.medium`)

- [ ] **Step 1: Re-value + extend the light `@theme` block**

In `src/index.css`, replace the light-mode token lines — from the `/* Color tokens - light mode defaults */` comment through the `--font-mono` line (added in Task 1) — so the block reads (KEEP the two glass tokens and `--shadow-panel` — they're removed in Task 9; `--shadow-button` is dropped here since it has no consumers):
```css
  /* Color tokens — light defaults (Vercel/Radix flat) */
  --color-surface: #ffffff;
  --color-surface-secondary: #f4f4f5;
  --color-text-primary: #171717;
  --color-text-secondary: #737373;
  --color-separator: rgba(0, 0, 0, 0.08);
  --color-border-strong: rgba(0, 0, 0, 0.15);
  --color-accent: #0071e3;
  --color-accent-hover: #0077ed;
  --color-canvas-bg: #ededee;

  /* Transitional — removed in the glass-cleanup task */
  --color-glass-bg: rgba(255, 255, 255, 0.72);
  --color-glass-border: rgba(0, 0, 0, 0.12);

  /* Corner radius — tightened */
  --radius-panel: 8px;
  --radius-button: 6px;
  --radius-sm: 4px;

  /* Shadows */
  --shadow-overlay: 0 4px 14px rgba(0, 0, 0, 0.10);
  --shadow-panel: 0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.05);

  /* Animation — restrained */
  --ease-apple: cubic-bezier(0.2, 0, 0, 1);
  --duration-fast: 120ms;
  --duration-normal: 160ms;

  /* Fonts */
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;
```
(Leave `--spacing: 8px;` at the top of `@theme` unchanged. The old `--shadow-button` line is intentionally dropped now — it has no consumers; if `tsc`/eslint somehow flags a use, restore it.)

- [ ] **Step 2: Re-value the dark-mode block**

Replace the `[data-theme="dark"]` block (currently lines 39-48) with:
```css
[data-theme="dark"] {
  --color-surface: #0a0a0a;
  --color-surface-secondary: #1a1a1a;
  --color-text-primary: #ededed;
  --color-text-secondary: #a1a1a1;
  --color-separator: rgba(255, 255, 255, 0.10);
  --color-border-strong: rgba(255, 255, 255, 0.20);
  --color-canvas-bg: #000000;
  --shadow-overlay: 0 4px 14px rgba(0, 0, 0, 0.50);
  /* Transitional — removed in the glass-cleanup task */
  --color-glass-bg: rgba(30, 30, 30, 0.72);
  --color-glass-border: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 3: Add the `.overlay` and `.num` utility classes**

In `src/index.css`, immediately after the `.glass-panel { … }` rule (ends ~line 80), add:
```css
/* Flat floating-overlay surface — replaces glass for menus, dropdowns,
 * context menus, tooltips, dialogs, and the selection-actions bar. */
.overlay {
  background: var(--color-surface);
  border: 1px solid var(--color-separator);
  box-shadow: var(--shadow-overlay);
  border-radius: var(--radius-panel);
}

/* Tabular monospace numerals (Geist Mono) for numeric readouts. */
.num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Tighten the default radius preference**

In `src/store/preferences-store.ts`, the `medium` row of `RADIUS_VALUES` (line 28) currently overrides the CSS defaults at runtime. Change it from:
```ts
  medium: { panel: '12px', button: '8px', sm: '6px' },
```
to:
```ts
  medium: { panel: '8px', button: '6px', sm: '4px' },
```

- [ ] **Step 5: Verify build + visual (both themes)**

Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → Expected: backgrounds/text use the new flat palette and tighter radii. Panels still look glassy (expected — glass class removed in Task 9). Toggle dark mode in Preferences → near-black surfaces.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/store/preferences-store.ts
git commit -m "feat(ui): flat token palette, overlay/num utilities, tighter radii"
```

---

## Task 3: Migrate floating overlays `.glass-panel` → `.overlay`

Pure className swaps. Each: replace `glass-panel` with `overlay` in the listed className, leaving all other classes intact.

**Files (exact edits):**

- [ ] **Step 1: `src/components/ui/ReasoningBadge.tsx:29`**
  Old: `className="glass-panel max-w-[240px] px-2 py-1 text-[11px] text-text-primary"`
  New: `className="overlay max-w-[240px] px-2 py-1 text-[11px] text-text-primary"`

- [ ] **Step 2: `src/components/inspector/LayerProperties.tsx:56`**
  Old: `className="glass-panel p-1 min-w-[140px] z-50"` → New: `className="overlay p-1 min-w-[140px] z-50"`

- [ ] **Step 3: `src/components/panels/LayersPanel.tsx:151`**
  Old: `className="glass-panel p-1 min-w-[120px] z-50"` → New: `className="overlay p-1 min-w-[120px] z-50"`

- [ ] **Step 4: `src/components/panels/LayersPanel.tsx:312`**
  Old: `className="glass-panel p-1 min-w-[140px] z-50"` → New: `className="overlay p-1 min-w-[140px] z-50"`

- [ ] **Step 5: `src/components/toolbar/Toolbar.tsx:118`**
  Old: `className="glass-panel px-2 py-1 text-xs text-text-primary z-[60]"` → New: `className="overlay px-2 py-1 text-xs text-text-primary z-[60]"`

- [ ] **Step 6: `src/components/toolbar/MenuBar.tsx` lines 546, 558, 570 (three identical tooltip contents)**
  Old (each): `className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]"`
  New (each): `className="overlay px-1.5 py-0.5 text-[10px] text-text-primary z-[60]"`
  (Use Edit with `replace_all: true` on the string `glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]`.)

- [ ] **Step 7: `src/components/canvas/SelectionActionsOverlay.tsx:40`**
  Old: `className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 glass-panel px-2 py-1 text-[11px]"`
  New: `className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 overlay px-2 py-1 text-[11px]"`

- [ ] **Step 8: `src/components/canvas/CanvasContextMenu.tsx:20`**
  Old: `className="glass-panel p-1 min-w-[160px] z-50"` → New: `className="overlay p-1 min-w-[160px] z-50"`

- [ ] **Step 9: `src/components/EditorDialog.tsx:30`**
  Old: `className="fixed top-1/2 left-1/2 z-50 glass-panel w-[400px] max-h-[80vh] overflow-y-auto p-0"`
  New: `className="fixed top-1/2 left-1/2 z-50 overlay w-[400px] max-h-[80vh] overflow-y-auto p-0"`

- [ ] **Step 10: `src/components/PreferencesPage.tsx:64`**
  Old: `className="glass-panel w-[480px] max-h-[80vh] overflow-y-auto"`
  New: `className="overlay w-[480px] max-h-[80vh] overflow-y-auto"`

- [ ] **Step 11: Verify + commit**

Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → open a menu, a blend-mode dropdown, a tooltip, the Preferences dialog → Expected: flat white panels with hairline border + soft shadow, **no blur**.
```bash
git add -A && git commit -m "refactor(ui): migrate floating overlays from glass-panel to .overlay"
```

---

## Task 4: Migrate remaining glass utilities, translucency, and blur

These use token-name Tailwind utilities (`border-glass-border`, `bg-glass-bg`, `fill-glass-bg`, `shadow-panel`), translucent `bg-surface/NN`, `backdrop-blur`, or a non-overlay `.glass-panel`. Convert to solid flat utilities.

**Files (exact edits):**

- [ ] **Step 1: `src/App.tsx:107`** (empty-state button)
  Old: `className="glass-panel px-4 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors cursor-pointer"`
  New: `className="bg-surface border border-separator rounded-[var(--radius-button)] px-4 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors cursor-pointer"`

- [ ] **Step 2: `src/App.tsx:119`** (status bar — drop blur + translucency)
  Old: `px-2 py-0.5 text-xs text-text-secondary bg-surface/70 backdrop-blur-sm rounded-tl-sm">`
  New: `px-2 py-0.5 text-xs text-text-secondary bg-surface border-t border-l border-separator rounded-tl-sm">`

- [ ] **Step 3: `src/components/PreferencesPage.tsx:159`** (PreviewCard — non-overlay card)
  Old: `<div className="mt-2 glass-panel p-3 space-y-2">`
  New: `<div className="mt-2 bg-surface-secondary border border-separator rounded-[var(--radius-panel)] p-3 space-y-2">`

- [ ] **Step 4: `src/components/toolbar/MenuBar.tsx:25`** (`menuContentClass`)
  Old: `'z-50 min-w-[190px] rounded-[6px] bg-glass-bg/95 backdrop-blur-xl border border-glass-border shadow-panel p-[3px] text-[11px] text-text-primary';`
  New: `'z-50 min-w-[190px] rounded-[var(--radius-panel)] bg-surface border border-separator shadow-overlay p-[3px] text-[11px] text-text-primary';`

- [ ] **Step 5: `src/components/toolbar/Toolbar.tsx:126`** (tooltip arrow)
  Old: `<Tooltip.Arrow className="fill-glass-bg" />` → New: `<Tooltip.Arrow className="fill-surface" />`

- [ ] **Step 6: `src/components/widget/ToolWidgetCard.tsx:30`**
  Old: `className="rounded-md bg-surface/95 border border-glass-border flex flex-col overflow-hidden shadow-lg backdrop-blur-sm"`
  New: `className="rounded-md bg-surface border border-separator flex flex-col overflow-hidden shadow-overlay"`

- [ ] **Step 7: `src/components/widget/CursorBindGhost.tsx:33-34`**
  Old: `className="fixed pointer-events-none z-[100] rounded-md bg-surface/90 border border-glass-border` (line continues) `px-2.5 py-1.5 text-[10px] text-text-primary shadow-lg backdrop-blur-sm"`
  New: `className="fixed pointer-events-none z-[100] rounded-md bg-surface border border-separator px-2.5 py-1.5 text-[10px] text-text-primary shadow-overlay"`

- [ ] **Step 8: `src/components/widget/CanvasWidgetLayer.tsx:373`**
  Old: `className="absolute pointer-events-none rounded-lg p-2 bg-surface/80 border border-dashed border-glass-border"`
  New: `className="absolute pointer-events-none rounded-lg p-2 bg-surface border border-dashed border-separator"`

- [ ] **Step 9: `src/components/inspector/AskAiInput.tsx:37`**
  Replace `border border-glass-border` → `border border-separator` (leave the rest of the className unchanged).

- [ ] **Step 10: `src/components/inspector/widget/LifecycleActions.tsx:73`**
  Replace `border border-glass-border` → `border border-separator`.

- [ ] **Step 11: `src/components/inspector/widget/WidgetCard.tsx:45`**
  Old: `(variant === 'ai' ? 'border-accent/60' : 'border-glass-border')`
  New: `(variant === 'ai' ? 'border-accent/60' : 'border-separator')`

- [ ] **Step 12: `src/components/inspector/widget/primitives/RegionPickerControl.tsx:24` and `ChoiceControl.tsx:22`**
  Both: Old `className="bg-surface border border-glass-border rounded p-1"` → New `className="bg-surface border border-separator rounded p-1"`

- [ ] **Step 13: Verify + commit**

Run: `grep -rn "glass-bg\|glass-border" src --include="*.tsx"` → Expected: **no matches** (the `.glass-panel` *class* may still appear in GlassPanel.tsx/CommandPalette.tsx — those are deleted in Task 7).
Run: `npm run check` → Expected: PASS. Then visual check the toolrail tooltip, menu, on-canvas widget cards.
```bash
git add -A && git commit -m "refactor(ui): replace glass utilities/translucency/blur with flat surfaces"
```

---

## Task 5: Restrained motion — drop springs, scale-pop, and the toolbar layoutId

**Files:**
- Modify: `src/components/toolbar/Toolbar.tsx:89-113`
- Modify: `src/components/EditorDialog.tsx:21,29-34`
- Modify: `src/components/PreferencesPage.tsx:63-68`

- [ ] **Step 1: Toolbar — remove button scale + replace the layoutId spring indicator**

In `src/components/toolbar/Toolbar.tsx`, replace the `<motion.button>` block (lines 89-113) with a plain button and a static active indicator:
```tsx
          <button
            disabled={disabled}
            className={`
              relative flex items-center justify-center w-7 h-7
              transition-colors duration-150
              ${disabled
                ? 'text-text-secondary opacity-30 cursor-not-allowed'
                : isActive
                  ? 'text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }
            `}
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            {isActive && (
              <div className="absolute inset-0 bg-accent rounded-[var(--radius-button)]" />
            )}
            <span className="relative z-10"><Icon size={14} /></span>
          </button>
```
Then remove the now-unused import on line 2:
```tsx
import { motion } from 'framer-motion';
```
(Delete that line entirely — `motion` is no longer referenced in this file.)

- [ ] **Step 2: EditorDialog — drop scrim blur + scale-pop**

In `src/components/EditorDialog.tsx`:
- Line 21, change `className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"` → `className="fixed inset-0 bg-black/40 z-40"`
- Replace the content `motion.div` props (lines 31-34) from:
```tsx
                initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
```
to:
```tsx
                initial={{ opacity: 0, x: '-50%', y: 'calc(-50% + 4px)' }}
                animate={{ opacity: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, x: '-50%', y: 'calc(-50% + 4px)' }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
```

- [ ] **Step 3: PreferencesPage — drop scale-pop spring**

In `src/components/PreferencesPage.tsx`, replace the inner `motion.div` props (lines 65-68) from:
```tsx
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
```
to:
```tsx
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
```

- [ ] **Step 4: Verify + commit**

Run: `grep -rn "type: 'spring'" src --include="*.tsx" | grep -v "GlassPanel.tsx\|CommandPalette.tsx"` → Expected: no matches (GlassPanel/CommandPalette still have springs but are deleted in Task 7).
Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → toolrail active state snaps to accent (no slide/bounce), dialogs fade in (no pop), buttons don't scale on hover.
```bash
git add -A && git commit -m "refactor(ui): restrained motion — drop springs, scale-pop, toolbar layoutId"
```

---

## Task 6: Numeric readouts → Geist Mono tabular (`.num`)

Apply the `.num` class (defined in Task 2) to numeric value spans so figures use tabular Geist Mono.

**Files:** `src/App.tsx` (ZoomDisplay), `src/components/inspector/AdjustmentSlider.tsx`, `src/components/inspector/widget/primitives/SliderControl.tsx`, `src/components/ui/Histogram.tsx`, `src/components/panels/LayersPanel.tsx` (opacity).

- [ ] **Step 1: `src/App.tsx:208` — zoom readout**

Old:
```tsx
  return <span>{Math.round(zoom * 100)}%</span>;
```
New:
```tsx
  return <span className="num">{Math.round(zoom * 100)}%</span>;
```

- [ ] **Step 2: Slider value readouts**

Run to locate the numeric value spans:
```bash
grep -rn "format\|value" src/components/inspector/AdjustmentSlider.tsx src/components/inspector/widget/primitives/SliderControl.tsx
```
In each file, find the `<span>` (or element) that renders the numeric value/readout next to the slider label and add the `num` class to its `className` (create a `className="num"` if it has none). Do **not** change layout/spacing classes. There is exactly one numeric-readout element per file.

- [ ] **Step 3: Histogram + layer opacity readouts**

Run:
```bash
grep -rn "%\|toFixed\|Math.round" src/components/ui/Histogram.tsx src/components/panels/LayersPanel.tsx
```
Add `num` to the className of any element that renders an axis number, percentage, or opacity figure (e.g. the `NN%` opacity label in LayersPanel). Leave non-numeric text alone.

- [ ] **Step 4: Verify + commit**

Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → zoom %, slider values, and opacity render in monospace with aligned digits.
```bash
git add -A && git commit -m "feat(ui): numeric readouts in Geist Mono tabular"
```

---

## Task 7: Delete dead components (GlassPanel, CommandPalette, SpawnPaletteWidget)

**Files:**
- Delete: `src/components/panels/GlassPanel.tsx`
- Delete: `src/components/ui/CommandPalette.tsx`
- Delete: `src/components/widget/SpawnPaletteWidget.tsx`, `src/components/widget/SpawnPaletteWidget.test.tsx`
- Modify: `src/App.tsx` (remove import + render; keep ⌘K effect; fix comments)
- Modify: `src/lib/layer-compositor.ts:59` and `src/hooks/useSegmentInteraction.ts` (stale comments)

- [ ] **Step 1: Confirm GlassPanel + CommandPalette are unreferenced**

Run:
```bash
grep -rn "GlassPanel\|CommandPalette" src --include="*.tsx" --include="*.ts" | grep -vi "GlassPanel.tsx\|CommandPalette.tsx\|layer-compositor.ts"
```
Expected: no matches (confirms nothing imports them).

- [ ] **Step 2: Delete the three components + the test**

```bash
git rm src/components/panels/GlassPanel.tsx src/components/ui/CommandPalette.tsx src/components/widget/SpawnPaletteWidget.tsx src/components/widget/SpawnPaletteWidget.test.tsx
```

- [ ] **Step 3: Remove SpawnPaletteWidget from `src/App.tsx`**

- Delete the import (line 29): `import { SpawnPaletteWidget } from '@/components/widget/SpawnPaletteWidget';`
- Delete the render + its comment (lines 197-198):
```tsx
      {/* Floating spawn palette — opened via ⌘K */}
      <SpawnPaletteWidget />
```
- Update the ⌘K comment (line 143) from `// ⌘K opens the floating spawn palette (SpawnPaletteWidget).` to `// ⌘K focuses the inline AskAiInput via the 'spawn-palette:open' event.`
- **Keep** the `useEffect` (lines 145-156) that dispatches `'spawn-palette:open'` — `AskAiInput` listens for it.

- [ ] **Step 4: Fix stale comments**

- `src/lib/layer-compositor.ts:59`: change `* Use this from inside a listener (e.g. AiCommandPalette's paint) — calling` → `* Use this from inside a listener (e.g. a tool's paint callback) — calling`
- `src/hooks/useSegmentInteraction.ts`: in the header comment block, any phrase referencing "SpawnPaletteWidget" should read "the inline AskAiInput" (the `'spawn-palette:open'` dispatch stays; only the prose changes).

- [ ] **Step 5: Verify + commit**

Run: `npm run check` → Expected: PASS (vitest now runs one fewer test file; `--passWithNoTests` not needed).
Run: `npm run dev` → press ⌘K with backend connected → the AskAiInput in the Suggestions section focuses. Shift+click a segment still works.
```bash
git add -A && git commit -m "chore(ui): delete dead GlassPanel, CommandPalette, SpawnPaletteWidget"
```

---

## Task 8: Remove the dead History feature

`LeftSidebar` is never mounted, so `HistoryPanel` and the History toggle are dead. Remove them and the store fields only they used. `panels/LayersPanel.tsx` stays (live via `inspector/LayersSection.tsx`), but its `LayersPanelActions` export becomes orphaned.

**Files:**
- Delete: `src/components/panels/LeftSidebar.tsx`, `src/components/panels/HistoryPanel.tsx`
- Modify: `src/store/tool-slice.ts`, `src/store/preferences-store.ts`, `src/lib/keyboard-shortcuts.ts`, `src/components/toolbar/MenuBar.tsx`, `src/components/panels/LayersPanel.tsx`

- [ ] **Step 1: Delete LeftSidebar + HistoryPanel**

```bash
git rm src/components/panels/LeftSidebar.tsx src/components/panels/HistoryPanel.tsx
```

- [ ] **Step 2: `src/store/tool-slice.ts` — remove History + layersSection fields**

Remove from the `ToolSlice` interface (lines 9, 16): `showHistoryPanel: boolean;` and `toggleHistoryPanel: () => void;`. Also remove `layersSectionOpen: boolean;` (line 10) and `toggleLayersSection: () => void;` (line 17) — only the deleted LeftSidebar consumed them.
Remove from the creator: `showHistoryPanel: false,` (line 24), `layersSectionOpen: true,` (line 25), the `toggleHistoryPanel` block (lines 47-50), and the `toggleLayersSection` block (lines 52-55).

- [ ] **Step 3: `src/store/preferences-store.ts` — remove leftSidebar fields**

- Interface (lines 40, 42, 50, 52): remove `leftSidebarCollapsed: boolean;`, `leftSidebarWidth: number;`, `toggleLeftSidebar: () => void;`, `setLeftSidebarWidth: (w: number) => void;`
- Initial state (lines 71, 73): remove `leftSidebarCollapsed: false,` and `leftSidebarWidth: 248,`
- Actions (lines 81-82, 85-86): remove the `toggleLeftSidebar` and `setLeftSidebarWidth` definitions.
- `partialize` (lines 97, 99): remove `leftSidebarCollapsed: state.leftSidebarCollapsed,` and `leftSidebarWidth: state.leftSidebarWidth,`

- [ ] **Step 4: `src/lib/keyboard-shortcuts.ts` — remove the ⌘[ binding**

Delete the `shortcuts.push({ … 'Toggle Left Sidebar' })` block (lines 83-88):
```ts
  shortcuts.push({
    key: '[',
    ctrl: true,
    action: () => usePreferencesStore.getState().toggleLeftSidebar(),
    label: 'Toggle Left Sidebar',
  });
```

- [ ] **Step 5: `src/components/toolbar/MenuBar.tsx` — remove the History menu item**

- Remove the two store reads (lines 344-345): `const showHistoryPanel = …` and `const toggleHistoryPanel = …`
- Remove the History `CheckItem` block and its preceding `<Sep />` (around lines 360-366):
```tsx
          <Sep />
          <CheckItem
            checked={showHistoryPanel}
            onCheckedChange={() => toggleHistoryPanel()}
          >
            History
          </CheckItem>
```

- [ ] **Step 6: `src/components/panels/LayersPanel.tsx` — remove the orphaned `LayersPanelActions` export**

Read the file, then remove the exported `LayersPanelActions` function (only `LeftSidebar` used it; `inspector/LayersSection.tsx` uses only `LayersPanelBody`). Remove any helper/import that becomes unused solely because of its removal. Do **not** touch `LayersPanelBody` or `SegmentRow`.

- [ ] **Step 7: Verify + commit**

Run: `grep -rn "showHistoryPanel\|toggleHistoryPanel\|leftSidebar\|layersSectionOpen\|toggleLayersSection\|LayersPanelActions\|HistoryPanel\|LeftSidebar" src` → Expected: **no matches**.
Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → View menu no longer shows History; ⌘Z / ⌘⇧Z undo/redo still work; the right-sidebar Layers section is unaffected.
```bash
git add -A && git commit -m "chore(ui): remove dead History/LeftSidebar feature and orphaned store fields"
```

---

## Task 9: Delete glass tokens, `.glass-panel`, and dead graph/react-flow CSS

Now that no code references them, remove the transitional glass tokens and dead CSS from `src/index.css`.

**Files:** `src/index.css`

- [ ] **Step 1: Confirm nothing references glass or graph CSS**

Run:
```bash
grep -rn "glass-panel\|glass-bg\|glass-border\|shadow-panel\|graph-node-gradient\|graph-editor-bg\|react-flow" src --include="*.tsx" --include="*.ts"
```
Expected: **no matches** (all migrated/deleted in Tasks 3-8).

- [ ] **Step 2: Remove glass tokens**

In `src/index.css`, delete the two `--color-glass-bg` / `--color-glass-border` lines from the light `@theme` block, the `--shadow-panel` line, and the same three transitional lines from the `[data-theme="dark"]` block (all added/kept in Task 2).

- [ ] **Step 3: Remove the `.glass-panel` class**

Delete the entire `.glass-panel { … }` rule (the block that sets `backdrop-filter`, `--color-glass-bg` background, etc.).

- [ ] **Step 4: Remove dead graph/react-flow CSS**

Delete these rules: `.graph-node-gradient`, `.graph-editor-bg`, all `.react-flow__*` rules, and the `@keyframes node-focus-glow` + `.node-focused` rule.
Then verify the focus-glow keyframe isn't used elsewhere:
```bash
grep -rn "node-focused\|node-focus-glow" src
```
Expected: no matches. (Leave `@keyframes pulse`, `@keyframes widget-pulse`, and the `prefers-reduced-motion` block — verify they're still referenced: `grep -rn "widget-pulse\|animate-pulse\|\bpulse\b" src --include="*.tsx"`; keep any with matches, delete any with none.)

- [ ] **Step 5: Verify + commit**

Run: `grep -rn "backdrop-filter\|backdrop-blur\|glass" src` → Expected: **no matches**.
Run: `npm run check` → Expected: PASS.
Run: `npm run dev` → full app still styled (now fully flat) in both themes.
```bash
git add src/index.css && git commit -m "chore(ui): delete glass tokens, .glass-panel, and dead graph CSS"
```

---

## Task 10: Rewrite `design.md` and `CLAUDE.md`

**Files:** `design.md`, `CLAUDE.md`

- [ ] **Step 1: Rewrite `design.md`**

Replace the visual-register content to describe the flat Vercel/Radix system. Required changes:
- Opening statement: aesthetic is now "minimal flat Vercel/Radix — solid surfaces, hairline borders, no blur, image-centered, content over chrome."
- Tier table (§1): remove `panels/GlassPanel.tsx` from the primitives row; remove the `graph/` entry from the level-2 row.
- §2 Colour table: replace with the Task 2 token set (surface, surface-secondary, canvas-bg, text-primary/secondary, separator, border-strong, accent). Remove glass rows.
- §2 Radius: 8 / 6 / 4. §2 Shadow: only `--shadow-overlay` (overlays); docked chrome has none. §2 Motion: `--duration-fast 120ms`, `--duration-normal 160ms`, ease `cubic-bezier(0.2,0,0,1)`; **no springs**. §2 Typography: Geist Sans (UI) + Geist Mono `.num` (numerals).
- §3 "The Glass Panel Pattern" → rename to "The Overlay Pattern": document `.overlay` (bg-surface + 1px separator + shadow-overlay + radius-panel) for floating surfaces, and "docked chrome = bg-surface + hairline, no shadow/blur". Remove all blur/`backdrop-filter` language.
- §7 AI rules: keep the "no purple = AI" rule and Sparkles-badge convention; update any "glass surface" phrasing to "overlay/flat surface".
- §8 Do/Don't: remove "Nest glass panels"; add "No `backdrop-filter`/blur anywhere"; replace spring guidance with the fast-tween rule.

- [ ] **Step 2: Update `CLAUDE.md`**

- In the Component Architecture section, remove `panels/GlassPanel.tsx` from the primitives examples line.
- In Code Conventions, replace "Apple HIG design language (glass panels, spring animations, SF Pro font stack)" with "Flat Vercel/Radix register (hairline-bordered overlays, fast tween motion, Geist font stack)".
- Remove the `GlassPanel` mention from the primitives bullet in the strict component-architecture block.

- [ ] **Step 3: Commit**

```bash
git add design.md CLAUDE.md
git commit -m "docs(ui): rewrite design.md + CLAUDE.md for flat Vercel/Radix register"
```

---

## Task 11: Final verification gate

- [ ] **Step 1: Grep gate (must all be empty)**

```bash
grep -rn "glass-panel\|glass-bg\|glass-border\|shadow-panel\|backdrop-filter\|backdrop-blur\|type: 'spring'\|react-flow\|GlassPanel\|CommandPalette\|SpawnPaletteWidget\|HistoryPanel\|LeftSidebar" src design.md CLAUDE.md
```
Expected: **no matches.**

- [ ] **Step 2: Full check**

Run: `npm run check` → Expected: PASS (tsc + eslint + all vitest tests green).

- [ ] **Step 3: Manual browser pass, BOTH themes**

Run `npm run dev`. In **light** (default) then **dark** (Preferences → Appearance):
- Open File menu, a blend-mode dropdown, layer context menu, canvas right-click menu, a toolrail tooltip, the Preferences dialog, and trigger the selection-actions bar → each is a flat panel: solid bg, 1px hairline, soft shadow, **no blur**.
- Toolrail active state snaps to accent (no slide/bounce); hover doesn't scale.
- Numerals (zoom %, slider values, opacity) render in Geist Mono, digits aligned.
- Empty state + "Open Image" button render flat.
- ⌘K focuses the inline AskAiInput; ⌘Z/⌘⇧Z undo-redo work; View menu has no History entry.

- [ ] **Step 4: Final confirmation**

Report the grep-gate output and `npm run check` result as evidence. No commit needed (verification only) unless Step 3 surfaced a fix.

---

## Notes for the implementer

- **Keep every commit green.** The token deletions (Task 9) are deliberately last; doing them earlier breaks the build because Tailwind utilities resolve against `@theme` keys.
- **Don't restructure widgets.** A separate future project ("AI composes working widgets via MCP") will rework the widget primitives. This makeover only restyles them.
- **If a Fontsource family name differs** from `Geist Variable` / `Geist Mono Variable` (Task 1 Step 2), use the printed names in the tokens.
- **Engine/store/pipeline are out of scope.** No backend, no `operation_graph`, no shader changes.
