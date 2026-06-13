# Objects-Mode: plain-click → SAM 2 ONNX

**Status:** Design — pending implementation
**Date:** 2026-06-13
**Branch:** `refactor/pipeline`
**Related:**
- `docs/superpowers/plans/2026-06-10-object-mode-segment-extraction.md` (worktree) — original Phase 4 plan that this spec executes the deferrable part of
- `2026-05-15-phase-4-sam-segmentation-design.md`
- `2026-05-15-phase-4a5-backend-sam-design.md`

## Motivation

Today's `SegmentHitLayer` in Objects-Mode only selects pre-computed `candidateRegions` (Claude analyze output via `analyze_context` → `precompute_regions`). After we removed auto-analyze on image upload (`src/lib/open-file.ts`, `src/core/document.ts`), no regions are populated by default and plain click in Objects-Mode does nothing — `polygonsAtPoint` returns `[]`, `clickAt` resets `activeScope` to global.

The user wants Objects-Mode to be a direct, browser-side SAM 2 click-to-segment tool, independent of Claude analyze. ONNX MobileSAM client code (`src/lib/segmentation/mobile-sam-client.ts`, `src/hooks/useMobileSam.ts`) already exists but is only invoked on shift/cmd-click, and the underlying ONNX model files (`public/models/mobile-sam/encoder.onnx`, `decoder.onnx`) are not vendored. This spec wires plain-click to MobileSAM, vendors the models via a download script, and removes the analyze-region dependency from `SegmentHitLayer`.

## Behavior

Objects-Mode becomes a pure click-to-segment surface:

- **Plain click** on the image runs MobileSAM with one positive point at the click coordinates. The decoded mask is drawn as a translucent overlay over the image-node (preview). Footer hint: `Enter to commit · Esc to cancel · Cmd-click to refine`.
- **Cmd-click** (or Ctrl-click on non-mac) while a candidate exists adds another point: positive if it falls outside the current mask, negative if inside. Re-runs decode against the cached encoder embedding.
- **Enter** commits the candidate: `maskToPngBase64(candidate.mask)` → `backendTools.propose_mask(sessionId, { imageNodeId, pngBase64, paths: [], origin: hasNegativePoint ? 'client_refinement' : 'client_new' })`. The backend persists into `masks_index` and emits `mask.proposed` SSE; the snapshot merge surfaces the new mask as a regular Layer-Mask.
- **Esc** discards the candidate.
- **Plain click without a candidate** starts a new segmentation. **Plain click while a candidate exists** discards the current candidate and starts a fresh one (one-click-restart, not silent merge).
- **Shift-click** is dropped — no special semantics. (The current `shift = new candidate` and `cmd = refine` design collapses now that plain click is the new-candidate path.)

`candidateRegions` from `useAiSession.context` are no longer read by `SegmentHitLayer`. The polygon overlay (`SegmentOverlay`) and hover-label are removed from the Objects-Mode surface. Other consumers of `candidateRegions` (e.g. `InfoTab`, LLM tool manifest) remain unchanged.

## Components & files

### Frontend

| File | Change |
|---|---|
| `src/components/workspace/SegmentHitLayer.tsx` | Drop `candidateRegions` / `polygonsAtPoint` / `hoveredScope` / `clickAt` reads. Drop `SegmentOverlay`. Plain-click handler invokes `samCapability.decode([{x, y, label: 1}])` and sets `candidate` state. Cmd-click appends to `candidate.points` (label depends on whether the click is inside the current mask). Enter commits via `propose_mask`. Esc clears. New click while candidate exists = discard + new. |
| `src/components/workspace/SegmentMaskPreview.tsx` *(new)* | Renders `DecodedMask` as a translucent overlay on the image-node. Uses a `<canvas ref>` painted from `mask.data` (Uint8Array, mask space) scaled to display size, with an `accent-tint` colorize pass. Pure presentational. |
| `src/components/workspace/SegmentOverlay.tsx` | Delete. No remaining consumers after `SegmentHitLayer` change. |
| `src/components/workspace/ImageNode.tsx` | Unchanged — already conditionally renders `<SegmentHitLayer>` when `currentMode === 'objects'`. |
| `src/hooks/useMobileSam.ts` | Unchanged. Existing lazy encoder + per-imageNodeId embedding cache is reused. |
| `src/lib/segmentation/mobile-sam-client.ts` | Unchanged. |
| `src/lib/segmentation/sam-capability.ts` | Unchanged. |
| `src/lib/segmentation/mask-utils.ts` | Keep `bboxOfPaths` (used elsewhere). Mark `polygonsAtPoint` + `pointInPolygon` as unused-by-SegmentHitLayer in a comment; leave for tests + potential future consumers. Do not delete in this spec. |

### Vendoring

| File | Change |
|---|---|
| `scripts/download_mobile_sam.sh` *(new)* | Bash script: `set -euo pipefail`. `mkdir -p public/models/mobile-sam`. Skips if both files already exist. `curl -L --fail -o … "$URL.partial"` then `mv .partial → final` (atomic). URLs come from env vars `MOBILE_SAM_ENCODER_URL` / `MOBILE_SAM_DECODER_URL` with HuggingFace defaults (resolved at script-write time — see "Open question" below). |
| `.gitignore` | Add `public/models/`. |
| `Makefile` | New target `download-sam` → `./scripts/download_mobile_sam.sh`. Add to `help` list. |
| `README.md` | Setup section: "Before first use of Objects-Mode: `make download-sam` (one-time, ~26 MB)". |

### Tests

| File | Change |
|---|---|
| `src/components/workspace/SegmentHitLayer.test.tsx` *(new)* | Mocks `useMobileSam` returning a fake `decode`. Plain click → `decode` called with `[{x, y, label: 1}]`; candidate state visible (preview rendered). Cmd-click appends point. Enter calls `backendTools.propose_mask` with correct `origin`. Esc clears candidate. New click while candidate exists = discard + fresh decode. |
| `src/components/workspace/SegmentMaskPreview.test.tsx` *(new)* | Renders a known `DecodedMask`, asserts the `<canvas>` is mounted at the right size. (No pixel-level diff — too brittle. Component is thin.) |
| `src/lib/segmentation/mobile-sam-client.test.ts` | Unchanged. |
| `src/lib/segmentation/mask-utils.test.ts` | Unchanged. |

## Data flow

```
User clicks (Objects mode)
   ↓
SegmentHitLayer.handleClick — plain
   ↓
useMobileSam.decode([{x: nx, y: ny, label: 1}])
   ├─ first decode for this imageNodeId:
   │    detectSamCapability() → 'webgpu' | 'wasm'
   │    CanvasRegistry.getSource(layerId) → ImageBitmap
   │    samEncode(bitmap)  ← ONNX encoder, ~600 ms one-time
   │    cache embedding per imageNodeId
   └─ samDecode(embedding, points) ← ONNX decoder, ~20 ms
   ↓
DecodedMask { data: Uint8Array, width, height }
   ↓
setCandidate({ points, mask })
   ↓
<SegmentMaskPreview /> overlays the image-node
   ↓
User: Enter
   ↓
maskToPngBase64(mask)
   ↓
backendTools.propose_mask(sessionId, { imageNodeId, pngBase64, paths: [], origin })
   ↓
Backend writes masks_index, emits SSE `mask.proposed`
   ↓
Snapshot merge → useBackendState.snapshot.masksIndex updated
   ↓
Mask appears as a committed Layer-Mask in the snapshot;
SegmentHitLayer drops the candidate on success.
```

## Error handling

| Failure | Behavior |
|---|---|
| ONNX file 404 (model not downloaded) | `loadSessions()` rejects. `useMobileSam` catches, sets `error`. SegmentHitLayer footer: "Model not installed — run `make download-sam`". No crash. |
| `detectSamCapability` returns `'backend'` (no WebGPU + no WASM, near-impossible in Electron 2026) | `decode` returns `null`. Footer: "This browser doesn't support SAM 2". |
| Encoder run throws (OOM on huge image) | Caught in `useMobileSam.decode`, `setError`, candidate not set. Footer surfaces the error message. |
| `propose_mask` returns `env.ok === false` | Candidate stays visible; user can retry Enter or Esc. No silent loss. |
| SSE not open (`sseStatus !== 'open'`) | Plain click is gated at the `<SegmentHitLayer>` mount level (Objects-Mode is already disabled when SSE is closed via `useBackendState.sseStatus !== 'open'` in toolrail/Cmd+K). No additional guard needed inside the handler. |

## Out of scope

- Touch / drag-box prompts. Click-only.
- Multi-mask output (SAM returns 3 masks; we pick index 0, matching existing decoder code).
- Backend fallback for the no-WebGPU-and-no-WASM case.
- Auto-traced polygons for hover-outline of the candidate. Bitmap overlay is sufficient feedback.
- Re-binding shift-click to a new behavior. Just dropped.
- Re-enabling auto-analyze. Separate decision.

## Open question

**ONNX model source URLs.** The HuggingFace location for MobileSAM ONNX exports (separate encoder + decoder, INT8 decoder) is not yet pinned in this spec. The download script accepts override env vars, so resolving the default URL is a script-write-time decision, not a design decision. Candidates to evaluate before writing the script:

- Mirror at `huggingface.co/<org>/mobile-sam-onnx` (if a stable community export exists)
- Fall back: instruct the user to export from `ChaoningZhang/MobileSAM` using their `scripts/export_onnx_model.py`

The plan stage will resolve this with a web check + a documented fallback path in the script.

## Verification

- `npm run check` (tsc + lint + 113 test files) stays green
- New test files for `SegmentHitLayer` + `SegmentMaskPreview` pass
- Manual: open image (no analyze run), enter Objects-Mode, click on a subject → preview overlay appears within ~1 s (first click ~600 ms encoder + 20 ms decoder), Enter commits → mask appears as a layer-mask in the snapshot
- Manual: without running `make download-sam`, first click shows the "Model not installed" footer instead of crashing
