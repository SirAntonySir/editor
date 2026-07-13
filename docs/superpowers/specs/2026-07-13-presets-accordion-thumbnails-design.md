# Presets Accordion + Live Thumbnails — Design

**Date:** 2026-07-13
**Status:** Approved for planning

## Problem

The Presets area at the bottom of the Adjustments tab doesn't match the rest
of the tab. Tools (Light / Levels / Curves / …) are collapsible accordion rows
(`ToolSection`), while presets are a wrapped chip row where each category chip
opens a Radix popover. Presets also give no visual hint of what they do — the
user reads a text description instead of seeing the look.

## Goals

1. Preset categories become accordion rows, visually and behaviorally
   consistent with the tool sections.
2. Each preset shows a thumbnail of the image with that preset applied.

## Decisions (made with Anton)

| Question | Decision |
|---|---|
| Accordion structure | **One row per category** (Tone, Color, B&W, Film, Detail, Mood, Looks) — each a collapsible row like a tool section. Popovers removed. |
| Thumbnail base | **Original source pixels + preset only.** Current edits are excluded, so thumbnails are stable while editing (cheap caching). Trade-off accepted: the result of clicking can differ from the thumbnail when other edits exist. |
| Row layout | **List rows:** small thumbnail left, preset name + truncated description right. Closest to the current popover rows; descriptions stay visible. |
| Thumbnail pipeline | **Reuse the real WebGL pipeline** via `renderImageNodeComposite` + phantom canonical nodes (approach A). CPU approximation and atlas rendering were rejected (drift risk / needless complexity). |

## Design

### 1. Accordion structure

`src/components/inspector/adjustments/PresetsSection.tsx` is rewritten in
place to render one collapsible row per category:

- **Header pattern** matches `ToolSection`: chevron (`ChevronRight` /
  `ChevronDown`, 12px) in the leading `w-3` slot, then the existing 7px
  strand swatch (in place of a tool icon, keeping
  `data-strand-swatch={category}`), then the category label. Same paddings
  (`px-2.5 py-2`) and type sizes (`text-xs font-medium`) as tool rows.
- **Expanded state** lives in the existing `expandedSectionIds` store set via
  `toggleSectionExpanded`, with namespaced ids: `preset:tone`,
  `preset:color`, … These never collide with op ids and persist like tool
  sections.
- **`AdjustmentsAccordion` stays as-is**: "Presets" group label, top border,
  categories ordered by `PRESET_CATEGORY_ORDER` (unknown categories appended
  alphabetically, as today). `CategoryButton`, the `@radix-ui/react-popover`
  import, and the popover styling are deleted.

### 2. Expanded body — preset rows

Each expanded category lists one row per preset (alphabetical by
`display_name`, as today):

- **Thumbnail:** 48×36 CSS box, `rounded-[3px]`, `object-cover`, hairline
  inset ring (same idiom as `EditTargetPreview`). Shows the active layer's
  original source pixels with only this preset applied.
- **Text:** preset `display_name` (11px, text-primary) with the category
  strand swatch beside it, `description` truncated underneath (10px,
  text-secondary). Full description remains on `title`.
- **Click:** unchanged — `dispatchPreset(preset.id, preset.display_name)`,
  which routes to widget spawn (`aiAccess=true`) or direct canonical
  application (`aiAccess=false`). Never spawns directly from this component.
- **`PresetThumb`** is a new topic-local component in
  `inspector/adjustments/` (single-folder use → not a `ui/` primitive).

### 3. Thumbnail rendering and caching

New module `src/lib/preset-thumbs.ts`:

- `renderPresetThumb(presetId: string, layerId: string): ImageBitmap | null`
  1. Load the preset from `loadRegistry()`; build a synthetic optimistic map
     `Map<string, OptimisticPatch>` with one entry per preset op:
     key `canon:<layerId>:<node_type>` (mapping `op_id →
     reg.ops[op_id].engine.node_type`, exactly as `routePresetToInspector`
     does), bindings = the op's `params` entries. Ops with no registry
     `node_type` are skipped.
  2. Call `renderImageNodeComposite` with:
     - `opGraph: undefined` — original pixels; the phantom-canonical path
       (`image-node-renderer.ts` `phantomCanonicalNodes`) materialises the
       preset ops as op-graph nodes.
     - `imageNodeId: 'preset-thumb:<presetId>'` — namespaced so the preview
       gets its own internal/scratch cache canvases and cannot clobber the
       live composite (the bug class documented in `EditTargetPreview`).
     - `layerIds: [layerId]`, `bakePerLayerOnly: true`, `skipOverlays: true`.
     - `renderScale` sized so the long edge is ~96px (crisp at 48px CSS on
       2× displays).
  3. Return the result as an `ImageBitmap`; `PresetThumb` draws it into its
     own small `<canvas>` (bitmaps are cheap to hold and redraw, and avoid
     data-URL churn).
- **Cache:** module-level `Map<presetId, ImageBitmap>` plus the
  `(layerId, pixelVersion)` pair it was rendered for. When either changes,
  flush the whole cache. Because thumbnails are original-based they never
  invalidate during normal slider editing. ~30 presets × ~96px bitmaps is
  trivial memory; no LRU needed.
- **Laziness:** a category renders its thumbnails in an effect when first
  expanded, then serves from cache. Collapsed categories cost nothing.

### 4. Edge cases

- **No active layer / no source pixels:** rows render a placeholder
  (surface-secondary box + `Image` icon, `EditTargetPreview`'s undrawn
  idiom). Clicking already no-ops via `resolveSpawnContext`.
- **Pipeline render failure:** try/catch → placeholder. Never a broken row.
- **Offline:** unchanged from today; `dispatchPreset` paths handle it.

### 5. Testing

- **`PresetsSection.test.tsx` (updated):** categories render as accordion
  rows; expanding a category shows its preset rows; clicking a preset calls
  `dispatchPreset`; expanded state round-trips through
  `expandedSectionIds`.
- **`preset-thumbs` unit test (new):** optimistic map built correctly from a
  preset fixture (op_id → node_type mapping, one binding per param, unknown
  op skipped); cache flushes on `pixelVersion` / layer change. The
  `renderImageNodeComposite` call is mocked (jsdom has no WebGL), consistent
  with existing renderer tests.

## Out of scope

- Thumbnails reflecting current edits (explicitly decided against).
- Hover-to-preview on the main canvas.
- Preset favorites / reordering / search.
