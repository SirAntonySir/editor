# Image Node — Architectural Drafting Restyle

**Status:** Design — pending implementation
**Date:** 2026-06-16
**Brainstorm:** `docs/superpowers/brainstorm/2026-06-16-image-node-restyle.md`
**Mockup:** `docs/mockups/image-node-restyle.html`

## Motivation

The current image-node chrome (24px header strip with seven affordances,
two-tab footer with "Layers · N / Objects · N", floating HTML object
labels) reads as Photoshop-pastiche and has three observed problems:

1. **Object label disconnect.** Labels float as HTML pills on top of the
   image with no visual link to the masked region they describe.
2. **Mode toggle conflates orthogonal axes.** Layers (Photoshop-style
   stack) and Objects (SAM segments) aren't alternatives — they're both
   relevant simultaneously, but the UI forces one or the other.
3. **Footer ambiguity.** "Objects · 0" reads as broken UI when the user
   hasn't segmented anything; "Layers · 1" carries no meaning when the
   source is a single image.

The brainstorm landed on **Direction A — Architectural Drafting**:
crop ticks instead of frames, marginalia for metadata, a tracing-paper
layer strip in the left margin, numbered object markers in the right
margin with leader lines into the image. The mockup at
`docs/mockups/image-node-restyle.html` is the visual target.

## Scope decisions

Captured from brainstorming:

- **Rollout:** Feature-flag in `usePreferencesStore` (`drafting`
  vs `classic`). Both surfaces ship in parallel; the user toggles.
  Default is `classic` until the new surface is feature-complete.
- **Header chrome:** Compare button stays visible (hold-based, painful
  to move into a menu). Eye / Split / Merge collapse into the existing
  `⋯` dropdown.
- **LayersPanel sidebar:** Stays as a detail view (opacity, blend mode,
  rename). The node's layer strip is the primary navigator; the sidebar
  is where you go to fine-tune.

## Aesthetic tokens

### Typography

Add **Fraunces** (variable serif) as the display family, used for:
- Image-node title (italic, 36px, tracking `-0.015em`)
- Layer ordinals (italic, 14px)
- Object names (italic, 16px)

Keep **Geist** for body UI (sliders, menu items, buttons).

Use **Geist Mono** more aggressively than today:
- All chrome labels: `text-[9px] uppercase tracking-[0.20em]` ("DIMENSIONS",
  "LAYERS", "OBJECTS")
- Numeric metadata: `text-[10px] tracking-[0.18em] tabular-nums`
- Marker numerals

Fraunces ships from Google Fonts. We import the italic 9..144 opsz range,
weights 400 + 500. Estimated bundle hit: ~24 KB woff2 (variable).

### Colour (drafting mode only)

| Token | Value | Use |
|---|---|---|
| `--paper` | `oklch(0.97 0.012 90)` | Canvas background |
| `--paper-dot` | `oklch(0.86 0.014 90)` | Dot-grid pattern |
| `--ink` | `oklch(0.22 0.012 280)` | Primary text |
| `--ink-mute` | `oklch(0.50 0.010 280)` | Chrome labels |
| `--hairline` | `oklch(0.84 0.014 280)` | All borders |
| `--ochre` | `oklch(0.55 0.20 30)` | Sole accent — active states, leader lines, object outlines |

These live in `src/index.css` under a `[data-theme="drafting"]` block so
the classic theme is unchanged.

### Motion

- Corner-tick → frame transition on select: 200ms `cubic-bezier(0.2,0,0,1)`
- Leader-line fade-in on hover: 150ms ease-out
- Layer-strip active-sheet fill swap: 180ms

## Component map

| File | Change |
|---|---|
| `src/index.css` | Add the drafting token block + Fraunces import + dot-grid pattern when `data-theme="drafting"` |
| `src/store/preferences-store.ts` | Add `theme: 'classic' \| 'drafting'` field + setter + persist |
| `src/components/workspace/ImageNode.tsx` | Branch on `theme`. Drafting variant renders new sub-components. Classic stays as today. |
| `src/components/workspace/drafting/ImageNodeDrafting.tsx` *(new)* | The new shell. Top marginalia, body with corner ticks / frame, bottom marginalia, left layer-strip, right object-markers. |
| `src/components/workspace/drafting/TopMarginalia.tsx` *(new)* | Overline (active layer) + italic title + dims-class meta on the right. |
| `src/components/workspace/drafting/BottomMarginalia.tsx` *(new)* | Geist Mono caps line. Replaces `ObjectModeFooter` for drafting mode. |
| `src/components/workspace/drafting/LayerStrip.tsx` *(new)* | Vertical column of skewed tracing-paper rectangles in the left margin. Active layer filled in ochre. Hover reveals name. Drag-to-reorder. |
| `src/components/workspace/drafting/ObjectMarker.tsx` *(new)* | Numbered circle marker rendered in the right margin. Right-click opens the existing Rename / Convert / Extract / Delete ContextMenu. |
| `src/components/workspace/drafting/LeaderLines.tsx` *(new)* | SVG layer between the image and the right margin. One dashed ochre line per object from centroid → marker. Hover highlights pair. |
| `src/components/workspace/ImageNodeObjectsLayer.tsx` | When `theme === 'drafting'`, render only the mask outlines (ochre, dashed); the labels move to `ObjectMarker` in the margin. Classic theme unchanged. |
| `src/components/workspace/SegmentMaskPreview.tsx` | Outline colour driven by `--ochre` when `data-theme="drafting"`. Stroke pattern unchanged. |
| `src/components/workspace/ObjectModeFooter.tsx` | Drafting mode hides this; it stays for classic. |
| `src/components/panels/LayersPanel.tsx` | Stays. Reads the same layer state the strip does (no fork). |
| `src/components/PreferencesPage.tsx` (or equivalent) | New "Visual style" toggle: Classic / Drafting. |

## Per-component contracts

### `ImageNodeDrafting`

Props identical to the current ImageNode (`id, data, selected`). Wraps
the React Flow node's existing draggable + connection interactions.
Internal layout:

```
.composition (display: grid)
  grid-template-columns: <left-margin> auto <right-margin>
  grid-template-rows: top-marginalia / image / bottom-marginalia

[ TopMarginalia spans cols 1..3 ]
[ LayerStrip   col 1 ] [ canvas + frame col 2 ] [ ObjectMarkers col 3 ]
                       [ LeaderLines absolute, spans the image and the right margin ]
[ BottomMarginalia col 2 ]
```

Margins are `120px` each. The React Flow node's draggable region stays
the image body (current `dragHandle`); margins do not initiate drag.

### `LayerStrip`

Reads `layers` from `useEditorStore`. One sheet per layer, ordered
top-to-bottom (newest first — column-reverse). Active sheet filled
ochre, inactive transparent with hairline border. Click sets
`activeLayerId`. Hover/focus reveals layer name + ordinal "01" in
Fraunces italic. Drag-to-reorder dispatches existing
`reorderLayers` action.

### `ObjectMarker` + `LeaderLines`

`ObjectMarker` consumes `useImageNodeObjects(imageNodeId)` (existing
hook). Each marker is a 22×22 circle with an ordinal numeral. The
existing right-click ContextMenu (Rename / Convert / Extract / Delete)
stays — only the trigger element moves from "label bubble on the image"
to "circle in the right margin".

`LeaderLines` is a thin SVG overlay positioned absolutely from the image
body across the right margin. One `<line>` per object: `(x1, y1) =
mask-centroid`, `(x2, y2) = marker-center`. Stroke is ochre, dashed
`stroke-dasharray="2 3"`, opacity 0.4 by default. On hover of either
end (centroid or marker), the matched pair lights to opacity 1.0 with
the same 150ms tween.

### `BottomMarginalia`

```
1013 × 1350 PX  ·  JPEG  ·  4.2 MB  ·  04 LAYERS  ·  03 OBJECTS
```

Bullet separators are 4px circles. Numerals in `text-ink`, the rest in
`text-ink-mute`. Replaces both `ObjectModeFooter` AND the existing
dimensions row in drafting mode.

## Feature flag

`usePreferencesStore` gains:

```ts
theme: 'classic' | 'drafting';
setTheme: (theme: 'classic' | 'drafting') => void;
```

Persisted via the existing Zustand `persist` middleware. Default is
`classic`. On mount, `App.tsx` sets `document.documentElement.dataset.theme`
so the drafting token block in `index.css` activates.

`ImageNode.tsx` picks the variant:

```tsx
const theme = usePreferencesStore((s) => s.theme);
return theme === 'drafting'
  ? <ImageNodeDrafting {...props} />
  : <ImageNodeClassic {...props} />;
```

(Rename the current ImageNode body to ImageNodeClassic in a small prep
step. The wrapper that branches stays as `ImageNode` so React Flow
sees a stable type.)

## Phased build

Three commits, each shippable on its own:

### Phase 1 — Tokens + flag

- Add Fraunces import + drafting tokens to `index.css`.
- Extend `usePreferencesStore` with `theme`.
- Add the Preferences toggle.
- `ImageNode` branches but `ImageNodeDrafting` is a thin stub that just
  shows the existing UI in the drafting palette (paper bg, ochre accent
  on selected ticks). No layout changes yet.

This phase ships a "drafting-coloured classic" surface — useful to
validate the colour ramp + font load on real images before committing to
the layout refactor.

### Phase 2 — Marginalia + layer strip

- Replace the header strip with `TopMarginalia`.
- Replace `ObjectModeFooter` with `BottomMarginalia` in drafting mode.
- Add `LayerStrip` to the left margin.
- Add corner ticks; selection state animates them into the full frame.

After this phase the node looks like the mockup minus the object
markers / leader lines.

### Phase 3 — Object markers + leader lines

- Build `ObjectMarker` + `LeaderLines`.
- Suppress the existing HTML label pills from `ImageNodeObjectsLayer`
  in drafting mode.
- Wire the existing right-click ContextMenu onto the new markers.

After this phase the mockup is fully shipped.

## Tests

| Phase | Tests |
|---|---|
| 1 | `preferences-store` test: theme persists, default is `classic`. Snapshot test on `App` shows `data-theme` attribute applied. |
| 2 | `LayerStrip` mount with N layers renders N sheets; click sets active. `BottomMarginalia` shows the right counts. Selection toggles the frame. |
| 3 | `ObjectMarker` mounts one circle per object; right-click opens the menu (reuses the test from current `ImageNodeObjectsLayer`). `LeaderLines` computes correct endpoints from mask centroid. Hover-pair highlighting. |

## Verification

- `npm run check` green after each phase.
- Visual: toggle Preferences → drafting; image-node should look like the
  mockup (within reasonable fidelity).
- Performance: a 4K image with 10 objects keeps the leader-line overlay
  paint under 4ms per frame (verify with React DevTools profiler).
- Accessibility: numbered markers carry `aria-label` with the object name;
  leader lines are `aria-hidden`; classic surface untouched.

## Out of scope

- Multi-image-node tree view in the sidebar.
- Drag-and-drop image onto canvas (mentioned in App.tsx but separate).
- Animating the corner ticks on initial render of the node (only on
  selection state change).
- Touch-device interactions for the layer strip (drag-reorder).
- Custom Fraunces subset / self-hosting. Google Fonts CDN for now;
  self-host follow-up if perf matters.

## Open question (resolved at plan time)

Where the new `theme` toggle lives in the UI. Options:
- Existing Preferences modal (if there is one — confirm at plan time)
- A new entry in the View menu: View → Visual style → Classic / Drafting
- A small switcher in the BackendStatusBar's overflow

Will pick at plan time based on what's already there.
