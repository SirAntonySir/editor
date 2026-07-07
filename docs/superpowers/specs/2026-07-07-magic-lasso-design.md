# Magic Lasso — Design

**Date:** 2026-07-07
**Status:** Approved, ready for planning

## Summary

Add a third objects-mode selection tool, **Magic Lasso**, alongside the existing
**Point** and **Lasso** tools. The user draws a rough loop; instead of
rasterizing that freehand polygon, we compute its bounding box and feed it to the
already-cached MobileSAM decoder as a **box prompt**. SAM returns a clean mask of
the single dominant object inside the loop. If SAM is unavailable or returns a
low-confidence result, we silently fall back to the drawn polygon (the plain
Lasso result), so a stroke is never wasted.

## Decisions (from brainstorming)

- **Behavior:** Snap to the one main object inside the loop (box-prompt → SAM),
  not a multi-object union and not an edge-refine of the drawn shape.
- **UI surface:** A third explicit radio button — `Point / Lasso / Magic`. The
  plain freehand Lasso stays intact.
- **Fallback:** When magic can't find a confident object (or no in-browser SAM),
  silently fall back to the drawn polygon. Never leave the user empty-handed.
- **Refinement:** Magic-lasso results are shift-click refinable, reusing the
  existing point-tool candidate refinement flow (free — same `LiveSelection`).
- **Scope (v1):** Client-only. When the browser lacks WebGPU/WASM SAM, fall back
  to the drawn polygon. Defer the server-side box-prompt path (backend already
  accepts `paths`; a future version can also pass the bbox so the server can
  box-prompt SAM 2).

## How the SAM box prompt works

The MobileSAM decoder (`src/lib/segmentation/mobile-sam-client.ts`) is generic:
it takes `point_coords` (`[1, N, 2]`) and `point_labels` (`[1, N]`). SAM's
standard convention encodes a box as two points:

- Top-left corner with label **2**
- Bottom-right corner with label **3**

So a box prompt is just two entries in the existing `point_coords`/`point_labels`
tensors. No new model, no decoder changes — only the `SamPoint.label` type needs
to widen from `0 | 1` to `0 | 1 | 2 | 3`.

## Data flow

```
pointerdown / pointermove   (objectSelectTool === 'magic')
  → accumulate lasso path      (reuse existing lassoPathRef + shouldAppendPoint)

pointerup → finishMagicLasso():
  1. path too small? → existing MIN_LASSO_AREA_FRAC guard drops it (no-op)
  2. bbox = bboxOfPath(path)                          // new pure helper
  3. embedding ready?
       yes → decode(boxPrompt(bbox))                  // reuse useMobileSam.decode
       no  → rasterizeLassoPath(path)  (polygon fallback), done
  4. isMaskAcceptable(mask, bbox)?
       yes → candidate, origin 'client_magic_lasso'
       no  → rasterizeLassoPath(path)  (polygon fallback)
  5. show as live candidate (identical to point-tool candidate → shift-click
     refine works for free)

commit verb (extract-node / extract-layer / genfill)
  → materializeCandidate → propose_mask (origin 'client_lasso', paths still sent)
```

## Components / changes (small surface)

1. **`src/store/tool-slice.ts`** — widen `ObjectSelectTool` to
   `'point' | 'lasso' | 'magic'`.

2. **`src/lib/segmentation/mobile-sam-types.ts`** — widen `SamPoint.label` to
   `0 | 1 | 2 | 3` (adds box-corner labels). Point/refinement code unaffected;
   backend fallback path unaffected.

3. **`src/lib/segmentation/mobile-sam-client.ts`** — no logic change. It already
   copies `points[i].label` straight into the labels tensor; the widened type
   flows through. Confirm the comment block documents label 2/3 = box corners.

4. **New `src/lib/segmentation/magic-lasso.ts`** (sibling to `lasso.ts`) — pure,
   jsdom-testable helpers:
   - `bboxOfPath(path: number[][]): { x0, y0, x1, y1 }` — normalized bounds.
   - `boxPrompt(bbox): SamPoint[]` — `[{x:x0,y:y0,label:2}, {x:x1,y:y1,label:3}]`.
   - `isMaskAcceptable(mask: DecodedMask, bbox): boolean` — reject when the mask
     is empty, near-degenerate (tiny), or effectively full-frame (SAM "gave up"
     and selected the background). Threshold on mask area vs. bbox area.

5. **`src/components/workspace/SegmentHitLayer.tsx`** — add the `magic` branch:
   reuse the lasso path capture for pointer down/move; on pointer up run
   `finishMagicLasso()` (decode-or-fallback). Refinement (shift-click) routes
   through the existing point candidate flow unchanged.

6. **`src/components/workspace/drafting/TopMarginalia.tsx`** — third radio button
   with a Wand/Sparkles Lucide icon, wired to `onSelectObjectTool('magic')`.
   Only shown when `objectsActive`.

## Edge cases

- **Tiny or full-frame mask** → "not confident" → polygon fallback
  (`isMaskAcceptable` returns false). Unit-tested.
- **Empty / degenerate loop** (accidental click) → existing
  `MIN_LASSO_AREA_FRAC` guard drops it before we decode.
- **Embedding still encoding** → fall back to polygon immediately, no blocking
  spinner (matches the "never empty-handed" decision).
- **Decode throws** → caught, polygon fallback.

## Testing

- Pure helpers (`bboxOfPath`, `boxPrompt`, `isMaskAcceptable`) get jsdom unit
  tests mirroring the existing `lasso.ts` test style.
- `isMaskAcceptable` covered for: empty mask, tiny mask, full-frame mask, and a
  well-sized object mask.
- Manual smoke: draw a loop around an object → clean snap; loop over empty sky →
  polygon fallback; shift-click to refine a magic result.

## Out of scope (v1)

- Server-side box-prompt when no in-browser SAM (deferred; polygon fallback used).
- Multi-object union inside the loop.
- Edge-magnetic refinement of the drawn boundary.
