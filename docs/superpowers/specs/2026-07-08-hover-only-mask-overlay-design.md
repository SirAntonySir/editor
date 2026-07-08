# Hover-Only Mask Overlay + Cursor Tooltip

**Date:** 2026-07-08
**Status:** Implemented (revised — see Revision below)

## Revision (same day, after first implementation)

Trying the "muted after use" gate in practice, the mask overlay was still too
present. The design was simplified to **hover-only always**:

- Masks (painted overlay pass AND the ImageNodeObjectsLayer accent canvas)
  paint ONLY while the object's pixels are hovered. No persistent
  committed/'selected' paints at all — the `maskOverlayMuted` render gate and
  its spawn choke-point became dead code and were removed.
- The in-progress draft (SAM preview / lasso) still always shows — it is
  gesture feedback, not chrome.
- The right-gutter numbered markers were removed entirely (not just their
  name text). `ObjectMarkers` survives only as the transient inline-rename
  input (context-menu Rename → `pendingObjectRenameId`), collapsing to
  nothing otherwise.
- Stacking fix: `ImageNodeObjectsLayer` dropped from z=6 to z=4 so the cursor
  tooltip (inside SegmentHitLayer's z=5 context) renders above the hover mask.
  The z=6 rationale (visible label chips catching right-clicks) applied only
  to the removed classic mode; drafting labels are headless and the object
  context menu opens via programmatic dispatch.

The sections below describe the original approved design and are kept for
context; where they conflict, the revision above wins.

## Problem

After a selection (object mask) is used to spawn an adjustment, its overlay
persists on the canvas — the committed-mask fill/outline AND the
`'selected'` segmentation overlay can paint the same region twice
(`image-node-renderer.ts` overlay pass). The tint obscures the very edit the
user just made. The gutter object markers also render the object name as
permanent text, adding chrome the photo doesn't need.

## Goals

- Once a selection has been **used** (a widget spawned from it), its overlay
  becomes hover-only. Making/changing a selection shows it persistently again.
- Remove the persistent name text from the right-gutter object markers —
  numbered dot only.
- Show the object name in a small cursor-following tooltip while hovering the
  mask pixels.

## Non-Goals

- No change to selection/edit-target *state semantics* — `activeObjectId`,
  `committedMaskRef`, toolrail Target, and the header selection popover keep
  working exactly as today.
- No change to ESC-to-discard, objects-mode hit-testing, marker click/rename/
  context-menu/drag-extract behaviours.

## Design

### 1. State: `maskOverlayMuted` render gate (selection slice)

A single boolean on the selection slice. It is a **render gate**, not a state
clear — the rejected alternative (clearing `activeObjectId` on spawn) would
reset the toolrail Target to "Whole image" and break spawning a second
adjustment on the same object.

- **Set true** at the one choke point all three spawn paths share:
  `backendTools.propose_widget` resolving successfully with a **mask/object-
  backed scope** (a scope that references a mask or named region — not
  `global`, not a plain `layer` scope, which has no overlay to mute).
  Toolrail, Cmd+K palette, and AI-accept therefore all mute the overlay
  identically.
- **Set false** whenever the selection changes: `setActiveObjectId` with a
  *new non-null* id, or a new mask ref committed. Re-selecting re-shows the
  overlay.

### 2. Renderer: gate persistent paints, keep hover

In the `image-node-renderer.ts` overlay pass, when muted:

- Skip the persistent committed-mask fill + outline.
- Skip the persistent `'selected'` segmentation overlay. (Together this also
  removes the double-paint of the same region.)
- Hover paint (`hoveredObjectId`) stays — with one tweak: the current code
  suppresses hover paint when the hovered object IS the active one; when
  muted, allow it (hover is then the only way to see the mask).

`useImageNodeRender` subscribes to the flag so the canvas repaints on flip.

### 3. Tooltip: cursor-following, name only

`SegmentHitLayer` already hit-tests mask pixels per pointermove and owns the
cursor coordinates. While `hoveredObjectId != null` it renders a small flat
chip — design tokens, `bg-surface/95`, hairline border, matching the flat
register — offset ~12 px below-right of the cursor, showing only the object
name. No Radix tooltip: position derives from the pointer, not an anchor.

### 4. Gutter markers: dot only

`ObjectMarker` drops the persistent name text. Kept: numbered dot, hover
leader line, click-to-select, context menu, drag-to-extract. The inline
rename input still mounts, but only while renaming (double-click or
context-menu Rename), then collapses back to the dot.

## Testing

- Selection-slice unit tests: mute set/cleared on the right transitions
  (new selection unmutes; spawn with mask/object-backed scope mutes;
  global- and plain-layer-scope spawns do not mute).
- Renderer unit tests: overlay pass skips persistent paints when muted;
  hover paint of the active object allowed when muted.
- `ObjectMarker` test update: no persistent name text; rename input appears
  during rename.
- Tooltip smoke test: chip renders with object label while a hover id is set.
