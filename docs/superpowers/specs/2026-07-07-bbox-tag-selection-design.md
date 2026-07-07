# Box+point tag selection with a "Draw it myself" fallback

**Date:** 2026-07-07
**Branch:** `feat/magic-lasso`
**Status:** Implemented (commits `fee7736`, `312d9c4`).

> **As-built note.** Change 2's attach model changed during implementation. The
> tag-selection path turned out to be the *forced-extraction agent flow* (region
> chip → approval gate → extract to node/layer → agent turn), which has no
> "selection sits on the canvas awaiting keep/redo" moment. So the "canvas pill
> after commit" was replaced with a **fourth choice in the existing region
> approval gate** ("Draw it myself"). See Change 2 below for the shipped design.

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

### Change 2 — "Draw it myself" choice in the region approval gate (as built)

The tag flow pauses at the **region-extraction approval gate**
(`RegionExtractionApproval`), which already asks per region: **Node / Layer /
Deny**. A fourth choice — **"Draw it myself"** — is added there. It means "don't
use the AI's region; I'll select it by hand," so it opts out of AI segmentation
entirely rather than trying to redo a committed mask.

- **New choice:** `ExtractChoice` gains `'draw'`
  (`src/store/region-extraction-approval.ts`). The dialog renders a Lasso-icon
  button between Layer and Deny that resolves the region's promise with `'draw'`.
- **`resolveAttachedRegions` (`palette-actions.agent.ts`):** on `'draw'`, it calls
  `armManualDraw(activeNode)` — `setActiveImageNode` + `setImageNodeMode(node,
  'objects')` + `setObjectSelectTool('magic')` — and sets a returned
  `drawRequested` flag. The region is neither segmented nor extracted nor added to
  `attached_objects`.
- **Stand-down (no AI edit runs):** because the user is taking manual control, the
  AI edit must not fire.
  - `runAgentTurn`: when `drawRequested` and there is nothing else to act on
    (no `forced_targets`, no `attached_objects`), it returns without calling
    `backendTools.agentTurn`. A *mixed* selection (draw one region, extract
    another) still runs the turn for the extracted target.
  - `runAgentTurnForRegion` (autonomous-suggestion accept path): returns
    `drawRequested`; `SuggestionChips` sees it and dismisses the suggestion
    instead of falling through to its full-image materialisation.
- The user then draws a loop, which decodes **box+point** through the **existing,
  untouched** `finishMagicLasso` path in `SegmentHitLayer`. No magic-lasso code
  changes; the manual selection carries its own object actions (copy to layer,
  generative fill, …).

No new box-handle overlay, no retry button, no changes to the magic-lasso tool.
The AI's text intent is intentionally dropped on `'draw'` — the user has chosen
to select (and act) by hand.

## Data flow (as built)

```
palette submit with @region chip
  → resolveAttachedRegions(region)               [palette-actions.agent.ts]
  → approval gate: [Node] [Layer] [Draw it myself] [Deny]

  Node / Layer:
    → segmentRegionFromPoint(nodeId, point, label, bbox)   [segment-region.ts]
        corners = bboxFromTuple(bbox)                       [magic-lasso.ts]
        points  = bbox ? [...boxPrompt(corners), {x,y,label:1}]
                       : [{x,y,label:1}]
        mask = samDecode(emb, points)            [mobile-sam-client.ts, unchanged]
        if bbox && !isMaskAcceptable(mask, corners): retry point-only
    → propose_mask + extract to node/layer → agent turn

  Draw it myself:
    → armManualDraw: objects mode + magic tool on the active node
    → drawRequested = true → stand down (no agent turn / no full-image edit)
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
- `RegionExtractionApproval` resolves `'draw'` when the Draw button is clicked
  (`RegionExtractionApproval.test.tsx`).
- `runAgentTurnForRegion` with `'draw'`: no segmentation, `extracted:false`,
  `drawRequested:true`, no agent turn, node armed (objects + magic).
- `runAgentTurn` with `'draw'` as the only choice: no `agentTurn` fetch, node
  armed (`palette-actions.agent.test.ts`).

## Files touched (as built)

Change 1 (box+point):
- `src/lib/segmentation/magic-lasso.ts` — `bboxFromTuple` helper.
- `src/lib/segmentation/segment-region.ts` — `buildRegionPrompt`, `bbox` param,
  box+point prompt, `isMaskAcceptable` fallback.
- `src/lib/segmentation/forced-extraction.ts` — thread `bbox` onto segmentable.
- `src/lib/palette-actions.agent.ts` — pass `seg.bbox` through.

Change 2 (Draw it myself):
- `src/store/region-extraction-approval.ts` — `'draw'` choice.
- `src/components/ui/RegionExtractionApproval.tsx` — Draw button.
- `src/lib/palette-actions.agent.ts` — `armManualDraw`, `drawRequested`, turn
  stand-down.
- `src/components/ui/SuggestionChips.tsx` — stand down on `drawRequested`.

Unchanged: `mobile-sam-client.ts`, `magic-lasso.ts` `boxPrompt`/`isMaskAcceptable`
(reused as-is), `SegmentHitLayer.tsx` `finishMagicLasso`, all backend.
