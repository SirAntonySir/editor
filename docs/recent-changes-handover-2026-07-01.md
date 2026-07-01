# Recent Changes — Handover (2026-06-30 → 2026-07-01)

> **Purpose.** Delta handover covering everything that landed *after* the
> 2026-06-30 handover (`docs/recent-changes-handover-2026-06-30.md`, tip
> `f07be6d`). **18 commits on `main`, tip `5acee07`. Working tree is clean.**
>
> The dated handovers describe the *standing* architecture; this one is the
> **delta** — what changed, why, and where to look. Reading order is by
> importance; a chronological commit index closes the document.
>
> ⚠️ **Three temporary `console.warn` diagnostics are currently committed** and
> must be removed after triage — see §7.

---

## 1 · Direct manipulation on the canvas — drag to extract, drag to rejoin

The largest cluster. Objects/selections and extracted nodes are now
**manipulated by dragging on the canvas**, not only via menus. Provenance
(`sourceImageNodeId`) becomes a live, reversible gesture.

- **Pure drag-decision helpers** (`46bd6bb`) — threshold (press vs. drag),
  drop-outside detection, and rejoin-target resolution, split out as pure
  functions so the gesture logic is testable in isolation.
- **Extract by dragging** —
  - Drag an **object marker** off the image → extract that object to a new node
    at the drop point (`2fdb81c`).
  - **Press-and-drag a mask region** (the live selection *or* a committed object)
    off the image in objects mode → extract to a new node (`f8e382b`). A press
    that doesn't pass the threshold stays a click (SAM-pick / select).
- **Rejoin by dragging** — drag an extracted node **back onto its source** to
  rejoin it (`484028d`), with a **snap cue** while hovering the source
  (`725201a`); the cue rings the **image rectangle**, not the padded node box
  (`b9d6ddd`); and the hit-test is a **center-over-source** test to avoid
  edge false-positives (`c0c82d0`).

Entry points: `SegmentHitLayer.tsx` (region press-drag), `ObjectMarkers.tsx`
(marker drag), `CanvasWorkspace.tsx` (rejoin/snap), `useSegmentExtractDrag`,
and the new pure helpers. Ties back to the `rejoinSourceImage` /
`extractObjectToImageNode` verbs from prior batches.

---

## 2 · Object markers: hover-reveal + the "3 identical masks" fix

**Hover-reveal tagging** (`5acee07`, `ObjectMarkers.tsx`):
- Default surface is just **faint centroid dots** — no always-on leader lines
  over the photo (keeps Direction A's clean-photo intent).
- **On hover** the marker's leader line reveals boldly **and** the object's mask
  overlay paints on the image. It's **bidirectional and store-driven**: marker
  hover and canvas-pixel hover both set the shared `hoveredObjectId`
  (`SegmentHitLayer` now sets the specific hovered object's id), so hovering
  either end lights the other, reusing the existing `paintOverlays` machinery.

**"Extract-to-layer creates 3 masks" bug** (`5acee07`,
`backend-state-slice.ts` + `useImageNodeObjects.ts`, with a regression test):
- Root cause: the `mask.created` SSE handler pushed into `masksIndex` **without
  an idempotency guard**. The same mask reaching the handler more than once
  (SSE replay, or the `e9e0e5e` snapshot-refetch landing with the mask already
  present, then the queued push adding it again) created duplicate rows — and
  `useImageNodeObjects` had **no dedup**, so one mask rendered as N objects.
- Fix: the push is now **idempotent by id** (root cause), and
  `useImageNodeObjects` **dedups by id** (defense-in-depth). Test:
  applying `mask.created` twice for the same id leaves one `masksIndex` entry.

---

## 3 · Per-layer thumbnails + "Move to own image node"

- **`LayerThumb`** matured (`5acee07`, `b41a16f`) — the cover-cropped pixel
  thumbnail primitive now takes an `imageNodeId` (threaded through `LayerRow` /
  `LayerStrip`) so it resolves the right node's pixels.
- **"Move to own image node"** (`5defcc5`) — a layer action that **moves** a
  layer to its own image node (not a copy), distinct from extract-to-node.
  Touches `core/document.ts`.

---

## 4 · Resize handles — widgets + image nodes

- **Proportional resize for widgets** via the bottom-right corner (`07280e1`).
- Image-node resize handles **appear on hover** like widgets (`5b08583`), sit
  **above the segment hit-layer** so they're grabbable (`1edceb5`), and **no
  longer vanish mid-drag** — the fix preserves React Flow's node selection
  during the drag (`7a52d34`).

---

## 5 · Active-selection visuals

- **Violet, smoothed selection outline** (`d555f7a`) — the live SAM selection
  reads as an intentional, on-brand mark rather than a raw pixel edge.
- **AI shimmer drift on the active selection mask** (`f624e13`) — the selection
  fill gets the same restrained AI shimmer used elsewhere, marking it as
  "AI-touched / live".

---

## 6 · Command-palette polish

- **Removed the horizontal element strip** from the results (`6971cd3`) —
  elements are inserted via the inline `@` caret picker in the prompt, not
  browsed as a strip, so the strip was redundant chrome.
- **Clip menu / suggestion highlights to the rounded container** (`0782fd1`) —
  hover highlights no longer bleed past the overlay's rounded corners.

---

## 7 · Temporary diagnostics currently committed — REMOVE after triage

These three `console.warn` diagnostics are live on `main` and should be pulled
once their bugs are resolved:

1. **`src/lib/segmentation/object-actions.ts`** (`selectInverted` mask stats) —
   for the open **"Select Inverted selects only one point"** bug. Still awaiting
   a console capture: the inversion math is exact end-to-end, so the source
   mask's value distribution is the missing evidence.
2. **`src/components/workspace/SegmentHitLayer.tsx`** (`[extract-drag-diag]
   pointerDown`) — for a **"drag-to-extract doesn't arm on the object body"**
   investigation.
3. **`src/lib/widget-undo-diag.ts`** — a widget-undo diagnostic module.

---

## Verification status at handover

- `main` tip **`5acee07`**; **working tree clean** (all work committed).
- `npm run check` (tsc + eslint + no-nested-component + vitest) was green at the
  last run this session — **1122 tests** — before the final commits landed;
  re-run before relying on it, as the last few commits arrived via concurrent
  editing.
- Backend pytest not re-run for this handover. Pre-existing
  `test_prune_disk_removes_old_records` time/FS flake still stands.

### Open threads (not yet built)
- **Object tooltip + animated mask path** (hover shows a tooltip on the object
  with an animated selection path, visually distinct from the selected state) —
  brainstorm paused before a design was settled.
- **Grey extraction-footprint edge** — show a semi-transparent grey outline on
  the *source* image where an object was extracted (provenance cue). Feasible
  with existing data (`sourceImageNodeId` + the extracted layer's `layerMask`);
  not started.

---

## Commit index (chronological, 2026-06-30 → 2026-07-01, after `f07be6d`)

- `0782fd1` fix(ui): clip menu/suggestion highlights to the rounded container
- `6971cd3` refactor(palette): remove the horizontal element strip from the results
- `b41a16f` feat(layers): add imageNodeId prop to LayerRow and LayerStrip components
- `46bd6bb` feat(workspace): pure drag decision helpers (threshold, drop-outside, rejoin target)
- `484028d` feat(workspace): drag an extracted node onto its source to rejoin
- `725201a` feat(workspace): snap cue when dragging an extracted node over its source
- `b9d6ddd` fix(workspace): rejoin snap cue rings the image rectangle, not the padded node
- `2fdb81c` feat(workspace): drag an object marker off the image to extract it to a new node
- `c0c82d0` fix(workspace): tighten the rejoin hitbox to a center-over-source test
- `f8e382b` feat(workspace): press-and-drag a mask region to extract it (objects mode)
- `f624e13` feat(segment): AI shimmer drift on the active selection mask
- `d555f7a` feat(segment): violet, smoothed selection outline
- `07280e1` feat(workspace): proportional resize for widgets (bottom-right corner)
- `7a52d34` fix(workspace): resize handles no longer vanish mid-drag (preserve RF selection)
- `5b08583` fix(workspace): reveal image-node resize handles on hover, like widgets
- `1edceb5` fix(workspace): raise image-node resize handles above the hit-layer
- `5defcc5` feat(layers): 'Move to own image node' — moves a layer, not a copy
- `5acee07` fix(workspace): per-layer thumbnails + selectable object markers (object-markers hover-reveal + the 3-masks fix + LayerThumb)
