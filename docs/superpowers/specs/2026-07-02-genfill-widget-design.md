# Genfill Widget — Mask-Based Generative Fill via Replicate bria/genfill

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Full-stack — new `backend/app/services/replicate_client.py`, new `backend/app/tools/widgets/genfill.py`, widget schema extension, new `src/lib/genfill-spawn.ts`, `src/store/genfill-actions.ts`, `GenfillWidgetBody`, context-menu + Cmd+K entry points.

## Problem

The editor has object-aware segmentation (SAM masks, object layers, selections) but no generative editing: nothing can *add or replace* pixels inside a region. Replicate's `bria/genfill` model takes exactly what we already have — an image, a binary mask (white = fill region, black = preserved pixel-perfect), and a prompt — and returns a full image. We want this as a widget that:

- lands generated pixels on a **new layer, never mutating the original** (non-destructive doctrine),
- optionally **clips the output by the same mask used on the input** — user-controlled toggle, only offered when the output dimensions equal the input dimensions,
- keeps the Replicate API key server-side (`REPLICATE_API_TOKEN` in backend `.env`).

Bria genfill facts the design relies on (verified against the Replicate schema): inputs `image`, `mask`, `prompt`, `negative_prompt`, `seed`, `sync`; mask is a binary raster (255 = generate, 0 = untouched) with the same aspect ratio as the image; output is an array of full-image PNG URIs; everything outside the mask is preserved pixel-perfect. Trained on licensed data (commercially safe).

## Design

### Architecture (Approach A — backend generates, frontend composites)

The backend owns the Replicate call, result asset storage, and widget provenance in the `SessionStateSnapshot`. The frontend owns the preview, the clip toggle, and new-layer creation at Accept. Clipping happens client-side, so flipping the toggle before Accept costs nothing — both states derive from one stored asset.

```
right-click / Cmd+K ──► spawnGenfill({imageNodeId, maskId, prompt})
                              │  POST /api/tools/genfill_create
                              ▼
        backend: widget {status:'generating'} → SSE push
                 replicate_client.run_bria_genfill(image, mask_png, prompt, …)
                 write .sessions/<sid>/genfill-<widget_id>.png
                 widget {status:'ready', result:{asset_id,w,h,seed}} → SSE push
                              │
                              ▼
        frontend: GenfillWidgetBody preview (GET /api/session/:sid/assets/:asset_id)
                 clip toggle (default ON, enabled iff result dims == image dims)
                              │ Accept
                              ▼
        genfill-actions: fetch PNG → [destination-in clip by mask] →
                 pixelStore.register(newLayerId, canvas) → IDB persist →
                 editorDocument addLayer('Genfill: <prompt…>') above source layer →
                 backend accept_widget (asset retained for provenance)
```

### Backend

**`backend/app/services/replicate_client.py`** — thin async httpx client for Replicate's sync mode:

```python
@dataclass
class GenfillResult:
    ok: bool
    image_bytes: bytes | None
    seed: int
    error_kind: Literal['moderation', 'timeout', 'api_error', 'not_configured'] | None
    error_message: str | None

async def run_bria_genfill(
    image_bytes: bytes, image_mime: str, mask_png: bytes,
    prompt: str, negative_prompt: str | None, seed: int,
) -> GenfillResult: ...
```

- `POST https://api.replicate.com/v1/models/bria/genfill/predictions` with header `Prefer: wait` (long-poll, timeout 60 s). `image` and `mask` are sent as data URIs — no public URL hosting needed.
- Auth: `REPLICATE_API_TOKEN` from env (declared in `render.yaml` like `ANTHROPIC_API_KEY`; Anton adds the value to `.env`). Missing token → `error_kind='not_configured'`, never an exception.
- Retry: one retry on transport errors only. Model/moderation errors are not retried (each attempt is billed).
- Downloads the output URI and returns raw PNG bytes.

**`backend/app/tools/widgets/genfill.py`** — two endpoints on the existing tools router:

- `genfill_create` — input `{ image_node_id, mask_id, prompt, negative_prompt?, seed?, origin }`.
  Validates: mask exists in `doc.masks`, mask aspect ratio matches the image, prompt non-empty. Creates the genfill widget with `status: 'generating'` and full provenance, pushes SSE, and returns `{ widget_id }` immediately. Generation runs as an `asyncio` background task: it awaits the Replicate call, writes the asset, flips the widget to `ready` (or `error` with `error_kind` + message), and pushes SSE again. The HTTP response never blocks on Replicate.
- `genfill_regenerate` — input `{ widget_id, prompt?, negative_prompt?, seed? }`. Omitted seed → new random seed. Re-runs generation on the existing widget (`generating` → `ready`/`error`). One asset per widget: the new result overwrites `genfill-<widget_id>.png`.

Accept/Discard reuse existing `accept_widget` / `dismiss_widget`; dismissal deletes the asset, acceptance retains it as provenance.

**Asset route** — `GET /api/session/:sid/assets/:asset_id` serves the stored PNG from the session dir (`disk_session_io`). Asset ids are constrained to the `genfill-<widget_id>` pattern (no path traversal).

### Widget schema

Genfill widgets do **not** ride the operation graph — they produce pixels, not shader params. No `operation_graph` nodes are created; the WebGL pipeline never sees them. The `Widget` model (backend Pydantic + `shared/schemas/widget.schema.json` + regenerated `shared/types/generated.ts`) gains an optional block:

```ts
genfill?: {
  status: 'generating' | 'ready' | 'error';
  prompt: string;
  negative_prompt: string | null;
  seed: number;
  mask_id: string;
  image_node_id: string;
  result?: { asset_id: string; width: number; height: number };
  error?: { kind: 'moderation' | 'timeout' | 'api_error' | 'not_configured'; message: string };
}
```

### Frontend

**`src/lib/genfill-spawn.ts`** — single funnel `spawnGenfill({ imageNodeId, maskId, prompt, origin })`. Entry points resolve their source to a `mask_id`:

| Source | Mask resolution |
|---|---|
| Object mask (right-click) | mask id directly (already in `masksIndex`) |
| Object layer (LayerStrip right-click) | layer's `layerMask` if present; else rasterize the layer's alpha to a binary mask client-side and register it via the existing mask-registration path |
| Active selection | rasterize + register, same path |

Both entry points gate on `useBackendState.sseStatus === 'open'` (toolrail convention).

**Entry point A — right-click "Generative fill…"**: added to the object-mask context menus (`ObjectMarkers.tsx`, `ImageNodeObjectsLayer.tsx`) and the object-layer menu (`LayerStrip.tsx`). Spawns the widget immediately in a *compose* state (empty prompt, field focused); generation starts only when the user submits a prompt. Origin: `tool_invoked`.

**Entry point B — Cmd+K third section "Generative fill"**: choosing it switches the palette into a genfill view (same pattern as `CommandPaletteAskView`): prompt input + attached region chip. Submit requires a region — with no chip and no active selection/object mask, submit is disabled with the hint "Attach a region to fill". Submit calls `spawnGenfill` and closes the palette. Origin: `mcp_user_prompt`.

**`GenfillWidgetBody`** (bespoke body in `WidgetShell`'s body switch, like `CurvesWidgetBody`):

- Prompt field (compose state: focused, Generate button).
- Negative-prompt field, collapsed by default.
- Seed readout with pin toggle (pinned seed → Regenerate reuses it; unpinned → new random seed).
- Regenerate button (disabled while `generating`).
- Preview slot rendering the result asset; skeleton while `generating`.
- **Clip toggle** — "Clip to region", **default ON**, enabled only when `result.width === image node width && result.height === image node height`; otherwise disabled with a "dimensions differ" hint (no silent scaling) and the full image is placed.
- Footer: **Accept** / **Discard**. Error state shows the reason + Retry (same params).

**`src/store/genfill-actions.ts`** — `acceptGenfill(widgetId, { clip })`, mirroring `segment-actions.ts`:

1. Fetch result PNG from the asset route, decode via `createImageBitmap()`.
2. If `clip`: draw onto a full-dimension canvas, composite the mask with `destination-in` (reusing the clipping routine from `extractLayerFromMask`). No bbox crop in v1 — the layer keeps full image dimensions so positioning is trivial.
3. `pixelStore.register(newLayerId, canvas)`, persist to IDB (`putSource`) for reload recovery.
4. `editorDocument` `addLayer({ id, name: 'Genfill: <prompt truncated to ~32 chars>', type: 'genfill', visible: true, … })` above the source layer — goes through the linear undo stack.
5. `accept_widget` on the backend.

`discardGenfill(widgetId)` → `dismiss_widget`; backend deletes the asset.

The new layer is plain pixels: every existing adjustment, mask, and blend works on it unchanged.

### Edge cases

- **Backend disconnected**: entry points hidden/disabled (SSE gate), same as toolrail.
- **Dimension mismatch**: clip toggle disabled, full image placed. Never silently rescale the mask against a differently-sized output.
- **Moderation / API error / timeout**: widget `status:'error'` with kind + message, Retry re-runs with identical params. `not_configured` shows "Replicate not configured" and no Retry.
- **Concurrent generations**: multiple genfill widgets may generate at once (independent); Regenerate on a widget already `generating` is disabled.
- **Mask registration failure** (layer-alpha/selection path): toast, no widget spawned.
- **Undo after Accept**: removing the layer via undo does not un-accept the widget; the asset remains and the widget can be re-accepted from its preview. (Matches how extracted layers behave.)

## Explicitly deferred

- Result history per widget (keep N previous generations and step between them) — v1 keeps only the latest asset.
- Autonomous genfill suggestions (backend analyze proposing fills) — costs per generation; needs its own gating design.
- Bbox-cropped result layers with `sourceOrigin` (smaller canvases) — v1 uses full-dimension layers.
- Mask dilation/feather control before sending to Bria.

## Testing

**Backend**
- `test_replicate_client.py` (httpx mocked): payload shape (data-URI encoding, `Prefer: wait`, seed passed through), token-missing → `not_configured`, transport error retried once, model error not retried, output URI downloaded.
- `test_genfill_tool.py`: `genfill_create` validates mask existence + aspect ratio; widget lifecycle `generating → ready` with asset on disk; `generating → error` on client failure; `genfill_regenerate` overwrites asset and rerolls seed when unpinned; dismissal deletes the asset; asset route rejects non-`genfill-*` ids.

**Frontend**
- `genfill-actions` unit tests: clip ON produces alpha only inside the mask; clip OFF places full image; layer registered in pixelStore + added above source layer; undo removes the layer.
- Palette genfill view: submit disabled without a region; enabled with region chip; spawn called with resolved mask id.
- `GenfillWidgetBody`: renders compose / generating / ready / error states; clip toggle disabled on dimension mismatch.
