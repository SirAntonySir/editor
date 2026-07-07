# Box+point tag selection with a "Draw it myself" fallback

**Date:** 2026-07-07
**Branch:** `feat/magic-lasso`
**Status:** Implemented (commits `fee7736`, `312d9c4`).

> **As-built note.** Change 2's attach point went through two iterations. A first
> pass put "Draw it myself" as a fourth choice in the region *approval gate* — but
> that gate fires *before* the auto-selection is visible and renders one chip per
> pending region, so the control appeared pre-emptively and multiplied across a
> suggestion stack. That was reverted. The shipped design puts a **single
> post-result "Draw it myself" action in the per-object right-click menu** (the
> one that already hosts Rename / Select Inverted / Delete). It exists only after
> the automatic selection is committed and visible, once per resulting object. See
> Change 2 below.

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
- Add a **"Draw it myself"** control that opts out of AI segmentation and arms
  the magic-lasso tool for a fresh manual draw. (As built: a choice in the region
  approval gate — see the as-built note above.)

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

### Change 2 — post-result "Draw it myself" in the per-object menu (as built)

A tag selection commits immediately: the segmented object renders on-canvas
(fill + outline) with a numbered marker (drafting mode) / label chip (layers
mode), each already carrying a per-object right-click menu (Rename · Select
Inverted · Copy to layer/node · Generative fill · Delete). "Draw it myself" is a
new item in that menu — so it appears **only after** the automatic selection is
visible, and **once per resulting object** (not before, not per pending region).

- **New action `redrawObject(maskId, imageNodeId)`**
  (`src/lib/segmentation/object-actions.ts`): arms the node for a manual draw —
  `setActiveImageNode` + `setImageNodeMode(node, 'objects')` +
  `setObjectSelectTool('magic')` — then `deleteObject(maskId)` to drop the bad
  selection. Reuses the existing `deleteObject` backend delete.
- **Menu item** added to all three per-object menus that already share the
  `object-actions` verbs: `ObjectMarkers.tsx` (drafting markers),
  `ImageNodeObjectsLayer.tsx` (layers-mode label chip), and
  `ImageNodeDrafting.tsx` (selected-object menu, with a Lasso icon). This covers
  the **Layer** extraction choice, where the result is an object mask on the
  source node.
- **Extracted-node case (the common one).** The **Node** extraction choice bakes
  the result into a *new* image node (with `sourceImageNodeId`), so the surface
  the user judges is that node — its right-click menu, not an object marker. A
  matching **"Draw it myself"** sits on the node menu next to "Rejoin source
  image" (`ImageNodeDrafting.tsx`, gated on `sourceImageNodeId`). New
  `redrawExtractedNode(imageNodeId)` (`src/lib/image-node-actions.ts`)
  **discards** the extracted node (its cutout + any AI edits — a clean "start
  over", *not* a rejoin) and arms the **source** node for a fresh magic-lasso
  draw. The source keeps its full original image.
- The user then draws a loop, which decodes **box+point** through the **existing,
  untouched** `finishMagicLasso` path in `SegmentHitLayer`. The redrawn selection
  carries its own object actions (copy to layer, generative fill, …). No
  magic-lasso code changes.

Rejected first pass (reverted): a `'draw'` choice in the `RegionExtractionApproval`
gate. That gate fires before the result is visible and renders one chip per
pending region, so it violated both "after, not before" and "once, not per
suggestion."

## Data flow (as built)

```
palette submit with @region chip / accept named_region suggestion
  → resolveAttachedRegions(region)               [palette-actions.agent.ts]
  → approval gate: [Node] [Layer] [Deny]         (unchanged — no draw here)
  → segmentRegionFromPoint(nodeId, point, label, bbox)   [segment-region.ts]
        corners = bboxFromTuple(bbox)                       [magic-lasso.ts]
        points  = bbox ? [...boxPrompt(corners), {x,y,label:1}]
                       : [{x,y,label:1}]
        mask = samDecode(emb, points)            [mobile-sam-client.ts, unchanged]
        if bbox && !isMaskAcceptable(mask, corners): retry point-only
  → propose_mask + extract to node/layer → agent turn
  → committed object renders (marker / label / outline)

  auto-selection looks wrong → right-click object → "Draw it myself"
    → redrawObject(maskId, nodeId)               [object-actions.ts]
        deleteObject(maskId) + arm objects mode + magic tool
    → user draws loop → finishMagicLasso (existing box+point path)
```

## Testing (as built)

**Unit — box+point prompt:**
- `bboxFromTuple([x,y,w,h])` → `{x0:x, y0:y, x1:x+w, y1:y+h}`
  (`magic-lasso.test.ts`).
- `buildRegionPrompt(point, bbox?)` builds box-corners + positive point with a
  bbox, point-only without (`segment-region.test.ts`).
- `planForcedExtractions` carries `region.bbox` onto the segmentable entry
  (`forced-extraction.test.ts`).
- Agent wiring passes `seg.bbox` to `segmentRegionFromPoint`
  (`palette-actions.agent.test.ts`).

**Unit — Draw it myself:**
- `redrawObject` deletes the mask (backend `delete_mask`) and arms the node
  (active node + objects mode + magic tool) — `object-actions.test.ts`.

## Files touched (as built)

Change 1 (box+point):
- `src/lib/segmentation/magic-lasso.ts` — `bboxFromTuple` helper.
- `src/lib/segmentation/segment-region.ts` — `buildRegionPrompt`, `bbox` param,
  box+point prompt, `isMaskAcceptable` fallback.
- `src/lib/segmentation/forced-extraction.ts` — thread `bbox` onto segmentable.
- `src/lib/palette-actions.agent.ts` — pass `seg.bbox` through.

Change 2 (Draw it myself):
- `src/lib/segmentation/object-actions.ts` — `redrawObject` action.
- `src/components/workspace/drafting/ObjectMarkers.tsx`,
  `src/components/workspace/ImageNodeObjectsLayer.tsx`,
  `src/components/workspace/drafting/ImageNodeDrafting.tsx` — menu item.

Unchanged: `mobile-sam-client.ts`, `magic-lasso.ts` `boxPrompt`/`isMaskAcceptable`
(reused as-is), `SegmentHitLayer.tsx` `finishMagicLasso`, the region approval gate,
all backend.
