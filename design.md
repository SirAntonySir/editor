# design.md — Photo Editor Visual Register

Authoritative reference for the editor's visual language. Any new component must read this first.

The aesthetic is **Apple HIG with a translucent glass register**: lightweight panels that float over the canvas, soft spring motion, generous negative space, content over chrome. The editor must feel like a native macOS app even though it runs in a browser.

---

## 1. Tier Boundaries

Three tiers, mirroring `CLAUDE.md`. Visuals live mostly in tiers 1 and 2; page scaffolds compose them without restyling.

| Tier | Location | Examples | Allowed concerns |
|---|---|---|---|
| 1. Primitives | `src/components/ui/`, `panels/GlassPanel.tsx` | `GlassPanel`, `Kbd`, `Empty` | Tokens, layout, atomic interaction |
| 2. Level-2 | `inspector/`, `panels/`, `graph/`, `toolbar/`, `canvas/` | `InspectorPanel`, `LayersPanel`, `Toolbar` | Compose primitives, read stores |
| 3. Scaffolds | root of `src/components/` | `EditorDialog`, `PreferencesPage` | Wire tier-2 into surfaces |

A primitive must not import from a level-2 folder. A level-2 component must not import from a scaffold. Scaffolds never import each other.

---

## 2. Design Tokens

All tokens live in `src/index.css` under `@theme`. **Never hardcode hex, px, ms, or cubic-bezier values for design quantities.** Use the token; if a token is missing, propose adding it.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-glass-bg` | rgba(255,255,255,0.72) | rgba(30,30,30,0.72) | Panel backgrounds |
| `--color-glass-border` | rgba(0,0,0,0.12) | rgba(255,255,255,0.12) | Panel hairlines |
| `--color-surface` | #ffffff | #1c1c1e | Solid surfaces (dialogs) |
| `--color-surface-secondary` | #f5f5f7 | #2c2c2e | Recessed panels, kbd chips |
| `--color-text-primary` | #1d1d1f | #f5f5f7 | Body text |
| `--color-text-secondary` | #6e6e73 | #98989d | Labels, hints, reasoning badges |
| `--color-accent` | #0071e3 | (same) | Selection, focus rings, primary actions |
| `--color-accent-hover` | #0077ed | (same) | Hover state for accent |
| `--color-separator` | rgba(0,0,0,0.1) | rgba(255,255,255,0.1) | Dividers |
| `--color-canvas-bg` | #e8e8ed | #1a1a1a | Editor backdrop |

Dark mode is set via `data-theme="dark"` on the root. Components must use tokens — never branch on theme in JSX.

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-panel` | 12px | Floating panels, dialogs |
| `--radius-button` | 8px | Buttons, toolbar slots |
| `--radius-sm` | 6px | Inline pills, badges |

### Spacing

`--spacing: 8px`. Tailwind utilities (`p-2`, `gap-3`, etc.) map onto an 8-point grid. Use multiples of `--spacing`; never `7px` or `11px`.

### Shadow

- `--shadow-panel` — three-layer Apple shadow for floating panels.
- `--shadow-button` — subtle elevation for interactive surfaces.

### Motion

| Token | Value | Use |
|---|---|---|
| `--ease-apple` | cubic-bezier(0.2, 0, 0, 1) | Default easing for CSS transitions |
| `--duration-fast` | 150ms | Hover, focus, tooltip |
| `--duration-normal` | 250ms | Panel slide-in, view switch |

Framer Motion defaults across the app:

```ts
{ type: 'spring', stiffness: 400, damping: 30 }
```

For content swaps inside a panel, use `AnimatePresence mode="wait"` with `{ opacity, y: 4 → 0 → -4, duration: 0.15 }`. See `InspectorPanel.tsx` for the canonical pattern.

### Typography

`--font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`.

| Use | Size | Weight | Colour |
|---|---|---|---|
| Panel title | 12px (`text-xs`) | 500 (`font-medium`) | `text-text-secondary` |
| Body | 13–14px | 400 | `text-text-primary` |
| Hint / label | 10–11px | 400 | `text-text-secondary` |
| Kbd chip | 10px (`text-[10px]`) | 400 | `text-text-secondary` over `bg-surface-secondary/60` |

---

## 3. The Glass Panel Pattern

`.glass-panel` is the visual substrate for every floating UI surface. Don't reimplement it. Compose `<GlassPanel>` (which wraps it with spring motion) or apply the class directly when motion is handled elsewhere.

```tsx
import { GlassPanel } from '@/components/panels/GlassPanel';

<GlassPanel className="w-56">
  <PanelHeader title="Light" />
  <PanelBody>{…}</PanelBody>
</GlassPanel>
```

Visual properties (defined in `index.css`):
- `backdrop-filter: blur(20px) saturate(180%)`
- `border: 0.5px solid var(--color-glass-border)`
- `box-shadow: var(--shadow-panel)`
- `border-radius: var(--radius-panel)`

Glass panels float above the canvas with `position: absolute` and explicit z-index. Never nest a glass panel inside another glass panel — the blur compounds and the surface stops reading as glass.

---

## 4. Layout Conventions

- **Floating panels** anchor to `top-{N} right-{N}` or `top-{N} left-{N}` of the canvas viewport.
- **Inspector** lives at `top-12 right-2` (see `InspectorPanel.tsx`). Width `w-56` is the canonical inspector width.
- **Toolbar** is full-width across the top.
- **Layers / History** dock at `bottom-2 right-2` and `bottom-2 left-2` respectively.
- **Dialogs** (Preferences, Export) use Radix Dialog over a dimmed backdrop, sized to content.

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
- **Tooltips** — Radix Tooltip, content in `--color-surface-secondary`, 150ms delay.
- **Drag handles** — `cursor: grab` → `cursor: grabbing` on active.

---

## 7. AI-Specific Visual Rules (from the thesis)

The thesis commits to: *"AI affordances should remain subtle and optional."* New AI-driven UI follows the same glass-panel register as everything else, with one additional rule:

- **Reasoning badges** — small inline pill (radius `--radius-sm`, background `--color-surface-secondary/60`, text `text-text-secondary`), shows a Lucide `Sparkles` icon plus a one-word source ("AI"). Hover reveals a tooltip with the model's reasoning, model name, and timestamp.
- **AI panel layers** — render in the same `InspectorPanel` glass surface as standard tools. Section header `"AI Suggestion"` with the goal text as subtitle. Layer-level visibility toggle uses the same eye icon as regular layers.
- **Region overlays** — semi-transparent fill in `--color-accent` at 18% opacity, 1.5px stroke at full accent. Label uses the same kbd-style chip as `Kbd`, anchored to the centroid.
- **No new colour for "AI"** — do not introduce a "purple = AI" or similar visual code. AI content uses the same accent as user-initiated work; it's the iconography (Sparkles) and the badge that signals AI provenance.

---

## 8. Do / Don't

✅ **Do**
- Reuse `GlassPanel`, `Kbd`, `Empty` and the rest of `ui/`.
- Use tokens for every colour, radius, shadow, spacing, and motion value.
- Keep panel content terse — labels, not paragraphs.
- Animate panel entrances with the canonical spring (stiffness 400, damping 30).

❌ **Don't**
- Hardcode hex, px, or ms for design tokens. (Layout `px-3`, `gap-2` is fine; raw values for design properties are not.)
- Nest glass panels.
- Introduce a new colour outside the token set without proposing the token first.
- Animate with linear easing or sub-100ms durations for view-level transitions.
- Style by writing `style={{ ... }}` inline when a Tailwind utility or class exists.

---

## 9. Updating This File

When the visual language evolves:
1. Update `src/index.css` tokens first.
2. Update this file's token tables and examples.
3. Update `CLAUDE.md` if the tier rules change.
4. Run `npm run check` to verify nothing regressed.
