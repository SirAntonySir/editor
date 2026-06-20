# Object Mode + Segment Extraction — Design

**Date:** 2026-06-10
**Status:** For discussion (not yet plan-ready)
**Prerequisites:** `selection-slice` (activeScope), `masks_index` snapshot field, backend SAM 2 `/api/analyze` candidate-regions pass, `Scope = { kind: 'mask', mask_id }` plumbing — all already in place.

## Goal

Promote the ImageNode footer from **Layers 1/1** to **Objects N** — making the SAM-derived `CandidateRegion`s the primary unit of interaction on the canvas. From an Object the user can:

1. **Hover** to see the segment outline; **click** to set `selection.activeScope = { kind: 'mask', mask_id }`. All toolrail spawns (Light / Color / Curves / Levels / Filters) auto-target that scope. Cmd+K spawns also inherit it.
2. **Refine** a SAM auto-mask with a click or two more (positive / negative point prompts), or **add a new object** by clicking somewhere SAM missed.
3. **Drag the segment out of the ImageNode** — it becomes a new ImageNode on the canvas, RGBA-cropped to the mask, with a tether back to the source ImageNode + source `mask_id`.
4. **Drop the extracted node back over the source ImageNode** — it re-attaches as a **child layer** of the source via `parentLayerId`, alpha-masked by the original `sourceMaskPng` (set as `layerMask`), positioned by drop-offset. Existing adjustment widgets work on the child directly — no new render path.

This is the editor's USP-bearing move: the LLM's semantic understanding ("the dog", "the sky") becomes a directly manipulable element, not just a scope chip.

## Out of scope (v1)

- Multi-object selection (single-select; cycle-on-reclick reuses the existing `cycleStack` mechanism).
- Persisting extracted-node mask edits back to the source's `masks_index` (one-way: source mask → extracted node, no write-back).
- Touch / pen input.
- Vector polygon editing tool (we ship raster masks + auto-traced polygons; user-driven polygon tweaks come in a follow-up).
- Concept/text-prompt segmentation via SAM 3 (separate spec — see "Future" below).

---

## Architecture decision: hybrid backend + browser SAM

The interactive feel hinges on **click-to-segment latency**. Research (see `2026-06-10-segmentation-research.md` companion notes, transcript `wf_4bfeb1df-f26`) lands on a clear answer:

| Capability | Run on | Why |
|---|---|---|
| **Initial auto-mask pass** (all candidate regions on image load) | **Backend SAM 2** (already shipped) | Exhaustive; ~hundreds-of-ms is acceptable as it runs once during `/api/analyze`. |
| **Interactive click refinement** (positive/negative points to shape a mask) | **Browser MobileSAM** via ONNX Runtime Web + WebGPU | The SAM encoder is ~98.6% of cost; MobileSAM distills it to a 5M-param TinyViT (total pipeline 9.66M). ORT-Web + WebGPU gets 19× encoder / 3.8× decoder speedup over WASM (Microsoft benchmark, RTX 3060). With encoder cached once per image, per-click decoder is well under the 54 ms median perceptual threshold for mouse interaction. This is why the ONNX prototype felt better than the SSE path — not implementation quality, the round-trip simply cannot hit the threshold. |
| **Text / concept prompts** ("select the dog", "select the sky") | **Backend SAM 3** (future, gated) | SAM 3 is 848M params, weights gated on HF, custom Meta license — not shippable to the browser. Its USP over SAM 2 is open-vocabulary Promptable Concept Segmentation, which maps directly to the editor's typed-prompt UX. Wait for access approval; until then, route concept prompts through the existing Anthropic LLM → bbox → backend SAM 2 chain. |

**Sources** (load-bearing): MobileSAM 9.66M / ONNX export ([ChaoningZhang/MobileSAM](https://github.com/ChaoningZhang/MobileSAM)); 19×/3.8× WebGPU speedup ([Microsoft ORT-Web blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)); encoder dominates 98.6% of params ([arXiv 2410.04960](https://arxiv.org/html/2410.04960v1)); 54 ms perceptual threshold ([INTERACT 2017, Are 100 ms Fast Enough?](https://link.springer.com/chapter/10.1007/978-3-319-58475-1_4)); SAM 3 release + gated weights + 848M ([Meta AI blog](https://ai.meta.com/blog/segment-anything-model-3/), [facebookresearch/sam3](https://github.com/facebookresearch/sam3)).

**Why not "all browser"?** SAM 3's concept-prompt capability is the editor's killer feature for AI-driven workflows ("select all faces", "select the sky"). 848M params, weights manually gated. Don't ship it client-side; keep the LLM-driven path on the backend.

**Why not "all backend"?** Click latency. A round-trip over SSE — encoder run + decoder run + serialize PNG + parse — cannot beat ~150–300 ms even on a fast link. Local MobileSAM hits ~20–50 ms per click after warm-up. That's the difference between "thinking" and "instant" in user perception.

**Two unavoidable gotchas:**

1. **Mask-ID consistency.** Backend SAM 2 and browser MobileSAM use different encoders → identical click prompts yield slightly different masks. Therefore: **a browser refinement is a NEW mask**, not a continuation of the backend's. Backend mask IDs are frozen at `/api/analyze` time. Browser-side adds create `mask_id`s with a `client-` prefix and a synthesized `MaskSummary` posted back to the backend via a new `propose_mask` MCP tool (so undo/redo and `.edp` persist correctly).
2. **Double encoding cost.** Backend encodes for the auto-mask pass; browser re-encodes for clicks. Unavoidable unless we ship 4 MB of encoder features per image over SSE — not worth it. MobileSAM encoder is ~20–80 ms on WebGPU; one-time cost per image-load is acceptable.

---

## Data model changes

### `MaskSummary` extension (snapshot, already exists)

```ts
interface MaskSummary {
  id: string;                  // 'sam2-r0', 'sam2-r1', ... or 'client-{uuid}'
  label?: string;              // "dog", "sky" — set by backend or LLM-described
  source: 'sam2-auto' | 'sam2-prompt' | 'mobilesam-client' | 'sam3-concept';
  bbox: [number, number, number, number];   // normalised
  pngBase64?: string;          // raster mask; populated lazily
  paths?: RegionPolygon[];     // auto-traced polygons for outlines & drag-out edges
  origin?: { layer_id: string };
}
```

The existing `CandidateRegion.maskRef` already points into `maskStore`; we extend that store to also accept client-generated masks.

### New: `extracted-segment` ImageNode kind

`ImageNodeState` gains:

```ts
interface ImageNodeState {
  // existing...
  origin?:
    | { kind: 'file' }                                    // current default
    | { kind: 'extracted'; sourceImageNodeId: string;     // drag-out provenance
        sourceMaskId: string;
        sourceOffset: [number, number]; };                // normalised position in source
}
```

`origin.kind === 'extracted'` controls two behaviours:
- The tether edge to its source is **persistent** (not just attribution; carries re-merge semantics).
- On drop-over-source, we re-merge instead of just snapping position (see "Drag UX" below).

### Selection slice (existing)

No new state needed. `activeScope`, `hoveredScope`, `cycleStack` already model object selection. We just bind new pointer-event paths to them.

---

## Module layout

```
src/lib/segmentation/
  mobile-sam-client.ts          # ORT-Web session, encoder cache per image_node_id
  mobile-sam-types.ts           # Click[], EmbeddingTensor, DecoderOutput
  mask-utils.ts                 # PNG ↔ ImageData ↔ polygon (marching squares)
  segment-store.ts              # in-memory cache: image_node_id → { embedding, encoderShape }

src/components/workspace/
  ObjectModeFooter.tsx          # replaces "Layers 1/1" — shows "5 objects" + mode toggle
  SegmentHitLayer.tsx           # pointer-events sibling canvas: hover / click / cycle
  SegmentOverlay.tsx            # paints hover + selected mask outlines (already exists, extend)
  ExtractedNodeShell.tsx        # ImageNode with persistent tether + re-merge drop target

src/hooks/
  useMobileSam.ts               # lazy-load encoder once per ImageNode visible
  useSegmentExtraction.ts       # drag-out → spawn ImageNode pipeline

src/lib/workspace/
  segment-extraction.ts         # mask + source bitmap → cropped RGBA + bbox
  segment-remerge.ts            # extracted node + drop coordinates → node-scope Adjustment
```

ONNX assets live under `public/models/mobile-sam/`:
- `mobile_sam_encoder.onnx` (~10 MB)
- `mobile_sam_decoder.onnx` (~16 MB — INT8 quantized OK)

Lazy-loaded behind a dynamic `import()` so a user who never enters Object mode doesn't pay the bundle cost.

---

## UX flow

### Entering Object mode

The ImageNode footer currently reads `Layers 1/1`. Replace with a mode pill:

```
┌─────────────────────────────────────┐
│ [ Layers ] [ Objects · 5 ]          │   ← left: source-of-pixels view
└─────────────────────────────────────┘   ← right: SAM-derived objects view
```

Default mode = **Objects** when `candidateRegions.length > 0`. The toggle persists per-node in `useEditorStore.workspaceSlice` (UI-only, not snapshot).

Switching to Objects mode:
- A `SegmentHitLayer` is rendered as a sibling DOM `<canvas>` over the ImageNode at the same transform.
- Pointer-move → marching-squares hit-test against the topmost `CandidateRegion` polygon under the cursor → `selection.hoveredScope = { kind: 'mask', mask_id }`.
- Click → `selection.activeScope = same`. Cycle-on-reclick uses the existing `cycleStack` to walk overlapping regions (mirrors the segment-first-canvas-widgets pattern).
- A faint cyan outline draws the hovered region; a solid token-coloured outline draws the selected region. (Tokens: `--accent-selected`, `--accent-hover` — add to `src/index.css`.)

With a selection active:
- Toolrail spawns inherit `scope = activeScope` automatically (via `spawnRegistryOp` reading the slice — already wired).
- Cmd+K palette inherits the same.
- The scope chip in the inspector shows the mask label.

### Refining with MobileSAM (browser)

When the user enters Object mode for the first time on an ImageNode, `useMobileSam` lazy-loads the encoder + runs it once on the source bitmap (downscaled to 1024 max edge). The embedding lands in `segmentStore` keyed by `imageNodeId`. Status: ~200–800 ms one-time, shown as a thin progress sliver under the footer.

After warm-up:
- **Shift-click on empty area** → new positive-point prompt → decoder runs → new mask appears with cyan dashed outline. **Enter** commits as a new `MaskSummary` (source: `mobilesam-client`); **Esc** discards.
- **Cmd-click on a selected mask** → adds a positive/negative point → decoder re-runs → live preview of the refined mask.

Commits hit a new MCP tool `propose_mask({ image_node_id, png_base64, paths, label?, origin: 'client_refinement' })` so the backend can register the mask in `masks_index` and undo/redo work correctly.

### Drag-out: segment → standalone ImageNode

Trigger: **Alt-drag** on a selected object (or a dedicated "Extract" affordance in the chip's context menu).

Pipeline (`useSegmentExtraction`):
1. Read source bitmap from CanvasRegistry.
2. Crop to the mask's bbox; apply the mask as alpha → produces an `OffscreenCanvas` RGBA bitmap.
3. Spawn a new ImageNode at the drag-release coordinates via `editorDocument.workspace.spawnImageNode({ ... origin: { kind: 'extracted', sourceImageNodeId, sourceMaskId, sourceOffset: bbox.xy } })`.
4. Create a **persistent** tether edge (`TetherEdge` with `kind: 'extracted-from'`) — visually distinct from attribution tethers (dashed, with a small "from" badge).

During the drag, the cursor shows a ghost of the cropped bitmap. The source ImageNode keeps its pixels intact — extraction is non-destructive (no `composite-then-subtract` on the source).

### Drop-back: re-merge into source composition

When the user drags an `extracted` ImageNode back over its source ImageNode (hit-test on the source's bbox):

1. The source ImageNode shows a faint inset glow at the predicted drop position (computed from cursor offset minus the original `sourceOffset`).
2. On release with the hit valid, the extracted ImageNode is consumed and a **new child layer** is appended to the source ImageNode's layer stack:
   - `parentLayerId = sourceLayer.id`
   - `layerMask = sourceMaskPng` (preserves the SAM-derived alpha at re-merge)
   - `position = dropCoords - sourceOffset` (allows the user to re-merge slightly shifted)
   - Pixels = the extracted node's current bitmap (post any edits the user made while it was floating).
3. The render pipeline composites the child via the existing per-layer WebGL path + 2D blend mode pass — no new render code. The child's own adjustment stack is preserved, so a "warmed up dog" stays warmed up after re-merge.

If the user releases **off** the source, nothing happens — the extracted node stays where it landed. Re-merge is a deliberate gesture.

### Backend round-trip on commit

- `propose_mask` — new MCP tool. Body: `{ image_node_id, png_base64, paths, label?, origin }`. Returns: `{ mask_id, mask_summary }`. Snapshot mutation: `masks_index.push(mask_summary)`.
- `extract_segment` — optional MCP tool. Records the extraction event for AI context (so the LLM knows "user separated the dog from the photo") but doesn't drive frontend rendering. Frontend can ship this fire-and-forget.
- Re-merge is a local layer-graph mutation — no backend round-trip needed. The new child layer + its adjustments persist via the existing `.edp` document path.

---

## Phasing

A reasonable build order, each phase shippable and demoable on its own:

1. **Object-mode footer + click-select** — wire the footer toggle, `SegmentHitLayer`, hover/click against existing backend `CandidateRegion` polygons. No MobileSAM yet. Toolrail spawns inherit scope. **(1–2 days)**
2. **Drag-out → standalone ImageNode** — extraction pipeline, persistent tether edge, `origin.kind = 'extracted'`. No re-merge yet — just spawn and persist. **(2 days)**
3. **Drop-back → re-merge as child layer** — drop hit-test, `parentLayerId`/`layerMask` write, no new render code. **(1–2 days)**
4. **MobileSAM browser refinement** — lazy ONNX load, encoder cache, click refinement, `propose_mask` MCP tool. **(3–4 days, single biggest chunk)**
5. **Polish: cycle-on-reclick, escape-to-clear, drag-from-chip, keyboard nav.** **(1 day)**

Phases 1–3 deliver the demoable USP without the browser-SAM lift. Phase 4 is the latency win; punt if it's not ready by your thesis deadline — the backend SAM 2 path keeps working.

---

## Decisions made during review (2026-06-10)

1. **Re-merge model: child layer via `parentLayerId`.** Extracted nodes ARE pixels — when re-dropped onto the source they become child layers of the source with `layerMask = sourceMaskPng`, `position = dropCoords - sourceOffset`. Reuses existing layer compositing; no new `replace_region` Adjustment kind needed; adjustment widgets already work on the child because it's a normal layer. Multiple extractions of the same region stack as more child layers, which is structurally honest. **This supersedes the `replace_region` discussion in the data-model section above — strike `replace_region` from the spec body and treat re-merge as a `parentLayerId`/`layerMask` write.**

2. **Polygon and PNG both canonical, PNG is truth.** `MaskSummary.pngBase64` drives WebGL alpha compositing; `MaskSummary.paths` (auto-traced via marching squares on commit) drives outline rendering, hover hit-testing, and drag-cursor preview. Both already exist on the type. No new design.

3. **SAM 3 access: not blocking. Operational, not structural.** Until weights access is granted, "select the dog by name" routes through the existing `useImageContext` LLM analyze path → bbox → backend SAM 2 with bbox prompt. When SAM 3 access lands, the backend swaps the implementation behind the same MCP tool — frontend Scope plumbing is unchanged. Phases 1–5 ship independently of SAM 3 access.

4. **Bundle cost confirmed acceptable.** ~10 MB ORT-Web WASM + ~26 MB ONNX (gzipped ~9 + ~20), dynamic `import()` behind first Object-mode entry. Desktop-only — mobile already out of scope.

---

## Future (not this spec)

- **SAM 3 concept prompts** — once weights are accessible, add a `concept_prompt` field to `propose_mask`. SAM 3's PCS yields ALL instances ("every face") in one call, which maps to multi-mask selection in a way SAM 2 doesn't.
- **Vector polygon editor** — direct polygon-node manipulation on top of an existing mask, exporting back as a PNG. Pairs naturally with the drag-out flow.
- **Mask history per object** — undo the refinement clicks without undoing other state. Likely requires per-mask undo stack rather than the linear document undo.

---

## Citations

- SAM 3 release, weights gated, custom license: [Meta AI blog](https://ai.meta.com/blog/segment-anything-model-3/), [facebookresearch/sam3](https://github.com/facebookresearch/sam3), [Ultralytics SAM 3 docs](https://docs.ultralytics.com/models/sam-3)
- SAM 3 = 848M params, DETR + tracker + Perception Encoder: [arXiv 2511.16719](https://arxiv.org/abs/2511.16719)
- SAM encoder dominates 98.6% of params: [arXiv 2410.04960](https://arxiv.org/html/2410.04960v1)
- MobileSAM 9.66M / ONNX export / TinyViT 5M: [ChaoningZhang/MobileSAM](https://github.com/ChaoningZhang/MobileSAM), [MobileSAM-in-the-Browser](https://github.com/akbartus/MobileSAM-in-the-Browser)
- ONNX Runtime Web + WebGPU 19× / 3.8× SAM speedup: [Microsoft ORT-Web blog (Feb 2024)](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)
- 54 ms median perceptual latency threshold (mouse): [INTERACT 2017](https://link.springer.com/chapter/10.1007/978-3-319-58475-1_4), [UIST 2021 follow-up](https://dl.acm.org/doi/10.1145/3472749.3474783)
- EVF-SAM is "few seconds per image on T4" — backend-only: [hustvl/EVF-SAM](https://github.com/hustvl/EVF-SAM)
