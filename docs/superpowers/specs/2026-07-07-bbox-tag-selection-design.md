# Box+point tag selection with a "Draw it myself" fallback

**Date:** 2026-07-07
**Branch:** `feat/magic-lasso`
**Status:** Approved — ready for implementation planning

## Problem

The command-palette "select by tag" flow feeds SAM only the region's
`representativePoint` — a single positive click. Every candidate region
returned by `/analyze` already carries a Claude-computed **`bbox`** that goes
completely unused at selection time. A single point produces looser, less
reliable masks than a box+point prompt, especially for objects the point lands
near an edge of.

Two gaps to close:

1. **Quality** — use the region's `bbox` (as SAM box corners) *together with*
   the `representativePoint` so SAM gets a bounded, anchored prompt.
2. **Recovery** — when the AI selection is still wrong, give the user a visible
   escape hatch to redo it by hand instead of being stuck with a bad mask.

## Goal

- Feed SAM **box + representative point** for tag selections (tighter masks).
- Add a **"Draw it myself"** control that discards the committed selection and
  arms the magic-lasso tool for a fresh manual draw.

## Non-goals (explicitly out of scope)

- No editable / draggable box-handle overlay. "Draw it myself" arms the existing
  magic-lasso tool for a *fresh* draw; it does **not** pre-render an editable box.
- No multimask "retry" cycling through SAM's alternate hypotheses.
- No separate "Retry" button — "Draw it myself" is the single fix-up path.
- No change to interactive-click or magic-lasso selection behavior.
- **No backend changes.** The tag flow runs entirely through the frontend ONNX
  decoder.

## Background — how tag selection works today

Traced paths (all frontend):

- **UI trigger:** `src/components/inspector/info/RegionsSection.tsx` — labeled
  regions render as rows; clicking dispatches `spawn-palette:open` so the region
  becomes a context chip in the command palette.
- **Submit → SAM:** `src/lib/palette-actions.agent.ts` → `resolveAttachedRegions()`
  routes a maskless region with a `representativePoint` to
  `segmentRegionFromPoint()`.
- **Decode + commit:** `src/lib/segmentation/segment-region.ts` →
  `segmentRegionFromPoint()` (line ~41). Today it calls
  `samDecode(emb, [{ x, y, label: 1 }])` — **single positive point only** — then
  **commits immediately** via `backendTools.propose_mask(...)` and injects into
  `maskStore` as a named object. There is no review moment.
- **Region type:** `src/types/image-context.ts` → `CandidateRegion` already
  carries `bbox?: [x, y, w, h]` (normalized 0–1) and
  `representativePoint?: [x, y]` (normalized 0–1). `bbox` is currently only used
  for the inspector thumbnail, not for segmentation.
- **Decoder capability:** `src/lib/segmentation/mobile-sam-client.ts` →
  `decode(embedding, points: SamPoint[])`. `SamPoint.label` is `0 | 1 | 2 | 3`
  where `2` = box top-left, `3` = box bottom-right. **The decoder already accepts
  a mixed point+box array** — no decoder change needed.
- **Box-prompt helper:** `src/lib/segmentation/magic-lasso.ts` → `boxPrompt(bbox)`
  emits `[{x0,y0,label:2}, {x1,y1,label:3}]` from a `Bbox {x0,y0,x1,y1}`.
  `isMaskAcceptable(mask, bbox)` rejects empty / >90%-frame / <2%-fill masks.

Interactive clicks and the magic-lasso tool use a **transient live candidate**
in `SegmentHitLayer` (review-before-commit). Tag selection does **not** — it
auto-commits. This design keeps that auto-commit pipeline intact
(commit-then-redo model) rather than rerouting tag selection through the
candidate UI.

## Design

### Change 1 — Box+point prompt (`segment-region.ts`)

Extend `segmentRegionFromPoint` to accept the region's bbox and build a combined
prompt.

- **Signature:** add an optional `bbox?: [number, number, number, number]`
  (normalized `[x, y, w, h]`) parameter.
- **Adapter:** convert the region's `[x, y, w, h]` to `boxPrompt`'s corner shape:
  `{ x0: x, y0: y, x1: x + w, y1: y + h }`. Extract as a small pure helper (e.g.
  `bboxTupleToCorners`) so it is unit-testable in isolation.
- **Prompt construction:**
  - `bbox` present → `points = [...boxPrompt(corners), { x, y, label: 1 }]`
    (box corners labels 2/3 **plus** the positive representative point).
  - `bbox` absent → `points = [{ x, y, label: 1 }]` (today's behavior — no
    regression for regions that lack a bbox).
- **Robustness / never-worse guarantee:** after decoding the combined prompt,
  validate with `isMaskAcceptable(mask, corners)`. If it fails (empty / >90%
  frame / <2% fill), retry with the point-only prompt, then apply the existing
  empty-mask check. Box+point can therefore never produce a *worse* accepted
  result than point-only does today.
- **Caller:** `resolveAttachedRegions()` in `palette-actions.agent.ts` passes
  `region.bbox` through to `segmentRegionFromPoint`.

Commit path (`propose_mask` → `maskStore.injectWithId`) is unchanged.

### Change 2 — "Draw it myself" fix-up (commit-then-redo)

After a tag selection commits, surface a small **canvas pill** so the user can
redo the selection by hand.

- **Placement:** a dismissible pill anchored to the freshly-committed selection
  on the canvas, styled with the existing `glass-overlay` hint-bar treatment for
  visual consistency with the interactive-selection hint bar. Content:
  **`'{label}' selected · [Draw it myself]`**. It clears on the next action
  (new selection, tool change, or explicit dismiss).
- **"Draw it myself" behavior:** on click —
  1. Delete the just-committed mask (remove from `maskStore` + backend if a
     committed id exists; discard so the bad mask does not linger).
  2. Switch the image node into **objects mode**.
  3. Set the active tool to **magic** (`useEditorStore.objectSelectTool = 'magic'`).
- The user then draws a loop, which decodes box+point through the **existing,
  untouched** `finishMagicLasso` path in `SegmentHitLayer`. No magic-lasso code
  changes.

No new box-handle overlay, no retry button, no changes to the magic-lasso tool.

### Component placement (per 3-tier rules)

- The pill is a small presentational unit. If it is reused by ≥2 topic folders
  it belongs in `src/components/ui/`; if it stays workspace-local, it lives in
  `src/components/workspace/`. It composes existing `glass-overlay` styling and
  reads no new store state beyond the active selection + label. Hoist to module
  scope (no inline-defined component).
- Style via design tokens only (no hardcoded hex/px). Chrome floating over photo
  content correctly uses the frosted `glass-overlay` (the flat-makeover
  exception for over-image chrome).

## Data flow

```
RegionRow click / palette chip
  → resolveAttachedRegions(region)               [palette-actions.agent.ts]
  → segmentRegionFromPoint(nodeId, point, label, bbox)   [segment-region.ts]
      corners = bboxTupleToCorners(bbox)
      points  = bbox ? [...boxPrompt(corners), {x,y,label:1}]
                     : [{x,y,label:1}]
      mask = samDecode(emb, points)              [mobile-sam-client.ts, unchanged]
      if !isMaskAcceptable(mask, corners): retry point-only
  → propose_mask + maskStore.injectWithId        [unchanged commit path]
  → show canvas pill: "'{label}' selected · [Draw it myself]"
        [Draw it myself]
          → delete committed mask
          → node objects mode + objectSelectTool = 'magic'
          → user draws loop → finishMagicLasso (existing box+point path)
```

## Testing

**Unit (`segment-region.test.ts`, `magic-lasso`-adjacent):**
- `bboxTupleToCorners([x,y,w,h])` → `{x0:x, y0:y, x1:x+w, y1:y+h}`.
- `segmentRegionFromPoint` builds a combined prompt (box corners + label-1 point)
  when `bbox` is provided.
- Builds point-only when `bbox` is absent.
- Falls back to point-only when the combined mask fails `isMaskAcceptable`.

**Component (canvas pill):**
- Renders with the region label after a tag commit.
- Its button discards the committed mask and sets the node to objects mode with
  `objectSelectTool === 'magic'`.
- Dismisses on the next action.

## Files touched

- `src/lib/segmentation/segment-region.ts` — bbox param, combined prompt,
  `isMaskAcceptable` fallback, `bboxTupleToCorners` helper.
- `src/lib/palette-actions.agent.ts` — pass `region.bbox` through.
- New canvas-pill component (workspace or `ui/`) + its wiring to the committed
  tag selection.
- Tests as above.

Unchanged: `mobile-sam-client.ts`, `magic-lasso.ts` (`boxPrompt`/`isMaskAcceptable`
reused as-is), `SegmentHitLayer.tsx` `finishMagicLasso`, all backend.
