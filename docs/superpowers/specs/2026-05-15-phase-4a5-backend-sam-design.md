# Phase 4 Plan A.5 — Backend SAM + Candidate-Region Refinement — Design

**Date:** 2026-05-15
**Status:** Approved (brainstorm); pending implementation plan
**Supersedes:** Plan A's SAM-in-browser decision (Q2 of `2026-05-15-phase-4-sam-segmentation-design.md`).
**Builds on:** Plan A frontend (`docs/superpowers/plans/2026-05-15-phase-4a-sam-segmentation.md`)

## Problem

Plan A landed in-browser SAM via ONNX Runtime Web (SlimSAM-77, lazy-fetched from Hugging Face, cached in IndexedDB). Smoke testing surfaced two bug clusters:

1. WASM runtime fragility — `application/wasm` MIME type errors, then `expected magic word` failures after CDN was configured.
2. ONNX tensor naming mismatch — the SlimSAM export uses `input_points` / `input_labels`, not the `point_coords` / `point_labels` we hardcoded.

These are tractable but each fix burns calendar time. Meanwhile:

- The editor already runs a FastAPI backend at `backend/` (Python 3.11, Pydantic 2.9, Anthropic SDK).
- Meta's official `segment-anything` (PyTorch) is `pip install`-able and ships standard tensor APIs — no export-name guessing.
- The candidate regions from `/api/analyze` are currently informational only; refining them into actual masks unlocks a much better palette experience and makes future agent tool-use cleaner.

This spec pivots SAM to the backend and folds in candidate-region refinement.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | SAM runs on the existing FastAPI backend, not the browser | Removes ONNX/WASM fragility; uses the official PyTorch API; predictable for thesis evaluation. |
| 2 | Library = Meta `segment-anything`; default model = ViT-B (`vit_b`); env-var opt-in for ViT-H | Mature, well-documented; ViT-B is ~375 MB and runs at ~1 s embed / ~50–100 ms decode on Apple Silicon MPS. |
| 3 | Two endpoints: `POST /api/segment/embed` and `POST /api/segment/decode`; embedding cached in session store | Embedding is the expensive step (~1 s); cached and reused for every click. Decode endpoint stays fast and stateless from the caller's perspective. |
| 4 | `embed` is idempotent — running it twice for the same session is a no-op | Lets the analyze flow and the first selection tool both trigger an embed without coordination. |
| 5 | Bundle region masks into `/api/analyze` response | Adds ~1–2 s to the already 3–5 s analyze call. Users get all candidate regions ready as masks immediately; no lag on first click of a region pill. |
| 6 | Masks transport = base64 PNG (single-channel grayscale, 8-bit alpha) in JSON | Same shape as the existing snapshot/inpaint paths. ~20–80 KB per mask after PNG compression. No multipart complexity. |
| 7 | Frontend Plan A work is preserved except three SAM files | `samClient.ts` is rewritten as an HTTP client; `model-loader.ts` and `sam.worker.ts` are deleted. Everything else (MaskStore, Layer.parentLayerId/layerMask, the four selection tools, MaskOverlay, SegmentActionsBar, mask compositing, derived-graph branches) is untouched. |

## Backend architecture

### New module: `backend/app/services/sam_client.py`

Wraps the Meta `segment-anything` package.

```python
class SamClient:
    def __init__(self, settings: Settings):
        # settings.sam_model_name (default 'vit_b'), settings.sam_checkpoint_path
        self._sam = sam_model_registry[settings.sam_model_name](
            checkpoint=settings.sam_checkpoint_path,
        ).to(_pick_device())          # 'mps' if available, else 'cpu'
        self._predictor = SamPredictor(self._sam)
        self._embedded_session: str | None = None

    def embed(self, session_id: str, image_rgb: np.ndarray) -> None:
        """Encode image. Cached per session_id. Idempotent."""
        if self._embedded_session == session_id:
            return
        self._predictor.set_image(image_rgb)
        self._embedded_session = session_id

    def decode_point(self, session_id: str, points: np.ndarray, labels: np.ndarray
                     ) -> np.ndarray:
        """Returns a single 2D bool mask at the image's resolution."""
        self._ensure_embedded(session_id)
        masks, scores, _ = self._predictor.predict(
            point_coords=points, point_labels=labels, multimask_output=True,
        )
        best = int(np.argmax(scores))
        return masks[best]                 # shape (H, W) bool

    def decode_box(self, session_id: str, box: np.ndarray) -> np.ndarray:
        self._ensure_embedded(session_id)
        masks, scores, _ = self._predictor.predict(
            box=box, multimask_output=True,
        )
        return masks[int(np.argmax(scores))]
```

**Singleton lifetime**: instantiated once on FastAPI startup (heavy: model load). Held in `app.state.sam_client`. The single `_predictor` instance serializes calls — one embed/decode at a time per process. For thesis n≈12 this is fine; production would shard.

**Session-keyed embedding cache** — only the last-embedded session is "warm". Embedding a different session invalidates the previous one. This works because typical user flow is one image at a time; a multi-session deployment would need a per-session embedding LRU.

### New endpoints: `backend/app/api/segment.py`

```python
class EmbedRequest(BaseModel):
    session_id: str

class EmbedResponse(BaseModel):
    ok: bool
    embedded_at: float   # unix timestamp

@router.post("/segment/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest, store: SessionStore = Depends(...), sam: SamClient = Depends(...)):
    rec = store.get(body.session_id)        # raises 404
    image = _decode_image_rgb(rec.image_bytes)
    sam.embed(body.session_id, image)
    return EmbedResponse(ok=True, embedded_at=time.time())


class SegmentPrompt(BaseModel):
    kind: Literal['point', 'box']
    data: list[float]                       # point: [x, y, label]; box: [x1, y1, x2, y2]

class DecodeRequest(BaseModel):
    session_id: str
    prompts: list[SegmentPrompt]

class DecodeResponse(BaseModel):
    mask_png_base64: str
    width: int
    height: int
    model: str

@router.post("/segment/decode", response_model=DecodeResponse)
async def decode(body: DecodeRequest, sam: SamClient = Depends(...)):
    points, labels, box = _prompts_to_arrays(body.prompts)
    if box is not None:
        mask = sam.decode_box(body.session_id, box)
    else:
        mask = sam.decode_point(body.session_id, points, labels)
    return DecodeResponse(
        mask_png_base64=_mask_to_png_base64(mask),
        width=mask.shape[1], height=mask.shape[0],
        model='sam-vit-b',
    )
```

### `/api/analyze` extension: bundle region masks

`ImageContext.candidateRegions[].mask` becomes optional in the schema. The analyze handler:

```python
@router.post("/analyze", response_model=ImageContext)
async def analyze(body: AnalyzeRequest, store, client, sam):
    record = store.get(body.session_id)
    if record.context is not None:
        return ImageContext.model_validate(record.context)

    context = client.analyze_image(record.image_bytes, record.mime_type, body.session_id)

    # NEW: embed the image (cached after first call) then refine regions.
    image_rgb = _decode_image_rgb(record.image_bytes)
    sam.embed(body.session_id, image_rgb)
    for region in context.candidate_regions:
        px = region.representative_point
        mask = sam.decode_point(
            body.session_id,
            points=np.array([[px[0], px[1]]], dtype=np.float32),
            labels=np.array([1], dtype=np.float32),
        )
        region.mask = RegionMask(
            png_base64=_mask_to_png_base64(mask),
            width=mask.shape[1],
            height=mask.shape[0],
        )

    store.set_context(body.session_id, context.model_dump(mode='json'))
    return context
```

### Schema additions: `backend/app/schemas/image_context.py`

```python
class RegionMask(BaseModel):
    png_base64: str
    width: int
    height: int

class CandidateRegion(BaseModel):
    label: str
    description: str
    bbox: tuple[float, float, float, float]
    representative_point: tuple[float, float]
    mask: RegionMask | None = None              # NEW
```

### Config: `backend/app/config.py`

```python
class Settings(BaseSettings):
    # ... existing fields
    sam_model_name: Literal['vit_b', 'vit_l', 'vit_h'] = 'vit_b'
    sam_checkpoint_path: str = './models/sam_vit_b_01ec64.pth'
```

### Checkpoint download script: `backend/scripts/download_sam.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p models
if [ ! -f models/sam_vit_b_01ec64.pth ]; then
  echo "Downloading SAM ViT-B checkpoint (~375 MB)..."
  curl -L -o models/sam_vit_b_01ec64.pth \
    https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
fi
```

Documented in `backend/README.md`. Run-once during dev setup.

### `requirements.txt` additions

```
torch>=2.1.0
torchvision>=0.16.0
git+https://github.com/facebookresearch/segment-anything.git
pillow>=10.0.0
numpy>=1.26.0
```

Note: `numpy` is already a transitive dep but worth pinning. On Apple Silicon, `torch` ships with MPS support out of the box.

## Frontend impact

### Files deleted

- `src/lib/sam/model-loader.ts`
- `src/workers/sam.worker.ts`
- `package.json` removes `onnxruntime-web` dep
- `vite.config.ts`'s `worker: { format: 'es' }` may stay (other workers exist)

### `src/lib/sam/sam-client.ts` rewritten

Same public API (`samClient.ensureEmbedding(layerId)` + `samClient.segment({ layerId, prompts, label? })`) but the body now POSTs to the new endpoints.

```ts
import { useEditorStore } from '@/store';
import { maskStore, type SamPrompt } from '@/core/mask-store';
import type { MaskRef } from '@/types/scope';

const API_BASE = '/api';

async function postJson<T>(path: string, body: unknown): Promise<T> { /* fetch helper */ }
async function pngBase64ToUint8(png: string, expectedLength: number): Promise<Uint8Array> {
  const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4]; // R channel = mask
  return out;
}

export const samClient = {
  async ensureEmbedding(layerId: string): Promise<void> {
    const sessionId = useEditorStore.getState().sessionId;   // from useAiSession
    if (!sessionId) throw new Error('samClient: no session');
    useEditorStore.getState().setEncoderState('encoding');
    try {
      await postJson('/segment/embed', { session_id: sessionId });
      useEditorStore.getState().setEncoderState('ready');
    } catch (err) {
      useEditorStore.getState().setEncoderState('error');
      throw err;
    }
  },

  async segment(args: { layerId: string; prompts: SamPrompt[]; label?: string }): Promise<MaskRef> {
    const sessionId = useAiSession.getState().sessionId;
    if (!sessionId) throw new Error('samClient: no session');
    const res = await postJson<{ mask_png_base64: string; width: number; height: number }>(
      '/segment/decode',
      { session_id: sessionId, prompts: args.prompts },
    );
    const data = await pngBase64ToUint8(res.mask_png_base64, res.width * res.height);
    return maskStore.register({
      layerId: args.layerId,
      label: args.label,
      width: res.width,
      height: res.height,
      data,
      source: args.prompts.length > 1 ? 'sam-points' :
              args.prompts[0]?.kind === 'box' ? 'sam-box' : 'sam-point',
      prompts: args.prompts,
      createdAt: Date.now(),
    });
  },
};
```

`encoderState === 'loading-model'` is no longer used (kept in the union for compatibility but never assigned).

### `useImageContext.ts` extended to register region masks

After `/api/analyze` returns, walk `context.candidateRegions[]`:

```ts
// inside uploadAndAnalyse or wherever the analyze response is consumed:
const context = await analyzeImage(sessionId);
const activeLayerId = useEditorStore.getState().activeLayerId;
if (activeLayerId) {
  for (const region of context.candidateRegions) {
    if (!region.mask) continue;
    const data = await pngBase64ToUint8(region.mask.png_base64);
    const maskRef = maskStore.register({
      layerId: activeLayerId,
      label: region.label,
      width: region.mask.width,
      height: region.mask.height,
      data,
      source: 'ai-proposed',
      createdAt: Date.now(),
    });
    region.maskRef = maskRef;   // frontend-only field; stored on the region for click handlers
  }
}
```

`ImageContext.candidateRegions[]` gains a frontend-only `maskRef?: string` field — populated during ingest, not part of the wire schema.

### Bonus: AI palette region pills become clickable masks

`AiCommandPalette.tsx`'s region pills already exist. With this change, each pill now has a `maskRef`. Clicking a pill calls `setActiveMask(region.maskRef)` + `commitMask()` — instantly arming the SegmentActionsBar. No new UI needed beyond a wire-up.

## Migration / cleanup

- Delete `src/lib/sam/model-loader.ts`
- Delete `src/workers/sam.worker.ts`
- Delete `package.json` entry for `onnxruntime-web` and run `npm install` to update lock
- Rewrite `src/lib/sam/sam-client.ts` per above
- Update `useImageContext.ts` to register region masks

The four selection tools (`SelectPointTool` etc.) call `samClient.segment(...)` — no change needed.

## Out of scope (deferred)

- Streaming partial results from `/api/analyze` during region refinement
- Multiple mask candidates per click (we keep best-IoU only)
- ViT-H by default (env-var opt-in retained)
- ONNX export for production deployment (Python is fine for thesis)
- Per-session embedding LRU on the backend (single-active-session is fine for n≈12 evaluation)
- Mask refinement via "refine this region" prompt (out of scope; brush-mask-tool covers manual refinement)

## Success criteria

1. `backend/scripts/download_sam.sh` fetches the checkpoint once on dev setup.
2. `POST /api/segment/embed` with a valid session returns 200 in ~1 s on first call, ~10 ms on subsequent calls with the same session.
3. `POST /api/segment/decode` with a single positive point returns a mask in ~100 ms (post-embed).
4. `POST /api/analyze` returns an `ImageContext` where every `candidateRegion.mask` is populated.
5. In the frontend, after image open + analyze, `maskStore.size === candidateRegions.length` with `source: 'ai-proposed'`.
6. SelectPointTool: click image → mask appears within ~150 ms (network + decode) on dev localhost. SegmentActionsBar appears. Extract / Edit / Scope all work.
7. Clicking a region pill in the AI palette commits that region's pre-computed mask as the active selection.
8. `npm run check` (frontend) and `cd backend && pytest` (backend, if any tests exist) pass.

## Risks

| Risk | Mitigation |
|---|---|
| `torch` install is heavy (~2 GB) | Documented in README; CI may need adjustments later. Local dev is fine. |
| MPS support varies by PyTorch version | Pin `torch>=2.1.0`; fallback to CPU automatic via `_pick_device()`. |
| Single shared embedding cache contends on multi-user sessions | Out of scope. Document as a limitation; thesis evaluation is single-user. |
| Predictor not thread-safe across requests | FastAPI runs the route handlers on a thread pool. Add a lock in `SamClient.embed`/`decode` to serialize calls. |
| `multimask_output=True` returns 3 candidates — we discard 2 | Acceptable; future polish could expose 3-up selection. |
| Region refinement could produce empty masks for low-confidence regions | Skip region in the response if mask is empty (all-zeros); frontend gracefully ignores. |
