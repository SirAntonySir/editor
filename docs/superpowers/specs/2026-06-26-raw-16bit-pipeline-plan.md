# RAW: a high-bit-depth editing pipeline — Plan (NOT YET IMPLEMENTED)

**Date:** 2026-06-26
**Status:** Plan only — do not implement without an explicit go-ahead.
**Prereq shipped:** `feat(raw)` (commit `dc30018`) — RAW files open by being
developed server-side (`rawpy`/LibRaw) into a JPEG. See §1 for why that's a
"we can open RAW" feature, not a "we edit RAW" feature.

---

## 1. The problem this plan addresses

Today a camera RAW is decoded **once**, server-side, to an **8-bit JPEG**, and
everything downstream edits that JPEG. The RAW's actual value — 12–16-bit
highlight/shadow latitude, scene-referred linear light — never reaches the
shaders. Concretely, the bit depth is thrown away in **three independent
places** (all verified in code):

| # | Stage | Where | Why it's 8-bit |
|---|---|---|---|
| 1 | Develop | `backend/app/services/raw_decode.py` | `postprocess(output_bps=8)` → `Image.save(format="JPEG")` |
| 2 | Source pixels | `src/core/document.ts:205` | `createImageBitmap → OffscreenCanvas(2d) → drawImage` (canvas is 8-bit RGBA) |
| 3a | WebGL pipeline | `src/shaders/pipeline.ts:145,480` | every texture + ping-pong FBO is `gl.RGBA / UNSIGNED_BYTE` |
| 3b | Composite | `src/lib/image-node-renderer.ts:301-330` | per-layer WebGL output is composited through a **2D canvas** (8-bit) and re-uploaded |

Net effect: editing a RAW is, in practice, indistinguishable from editing the
camera JPEG. The current prototype's real value is narrow: the file *opens*,
and we *could* control development (we use camera-default WB and expose none of
it).

**Good news that de-risks the work:** the pipeline is already **WebGL2**
(`pipeline.ts:97` `getContext('webgl2')`), so `RGBA16F` / `HALF_FLOAT` textures
are first-class; rendering into float FBOs only needs the widely-supported
`EXT_color_buffer_float` extension.

---

## 2. Tiers (pick a target before any code)

This is deliberately tiered so the decision is "how far", not "all or nothing".

### Tier 0 — "Opens RAW" — **DONE** (`dc30018`)
8-bit develop → JPEG → normal open path. = editing a JPEG. No further work.

### Tier 0.5 — Develop controls (cheap, NO pipeline change)
Expose white-balance / exposure at *develop* time: re-run `postprocess` with
user-chosen params and return a fresh 8-bit JPEG. Delivers RAW's "you choose
the development, not the camera" benefit without touching the pipeline.
- Backend: params on `POST /api/raw/develop` (wb, exposure-shift, highlight
  mode). Re-develop on change.
- Frontend: a small "Develop" affordance on a RAW-sourced image node; on commit,
  re-fetch and replace the layer source.
- **Effort: ~half a day.** Still 8-bit. Good ROI if "RAW matters a little" is
  the goal.

### Tier 1 — 16-bit headroom, single-layer (the real target)
The first tier where the RAW genuinely matters: highlight/shadow recovery on a
single-photo edit. Float survives the adjustment chain; the 2D-canvas composite
is bypassed for the common single-layer case. **This is the plan's main body
(§3).**
- **Effort: ~3–5 focused days**, ~10–15 files, risk concentrated in the shader
  clamp audit and the source-storage refactor.

### Tier 2 — Full linear-light editor (out of scope for now)
Multi-layer float compositing (move the compositor off 2D canvas into WebGL
float), edit in linear light (re-tune every adjustment's math → changes the look
of *every existing tool*), develop controls re-developing from RAW, 16-bit
export. **Weeks**, with an editor-wide regression surface. A sub-project, not a
patch. Documented here only so Tier 1 is built without precluding it.

---

## 3. Tier 1 design — 16-bit, single-layer

Goal: a RAW-sourced single-layer image is decoded to 16-bit, carried as float
through the WebGL adjustment chain, and only flattened to 8-bit at the final
display/export step — so highlight recovery, exposure pulls, etc. actually have
data to work with.

### 3.1 Develop → 16-bit container (backend)
`raw_decode.py`:
- Add a `bit_depth: Literal[8, 16] = 8` arg (or a separate `develop_raw_to_png16`).
- For 16-bit: `postprocess(output_bps=16, gamma=(1,1), no_auto_bright=True,
  output_color=rawpy.ColorSpace.sRGB)` → linear-ish 16-bit RGB →
  `Image.save(format="PNG")` (PNG-16) or TIFF. **Linear** output (`gamma=(1,1)`)
  is preferred so the frontend owns the linear→display encode; revisit if
  LibRaw's linear output proves awkward.
- Endpoint: `POST /api/raw/develop?depth=16` (or content negotiation). Keep the
  8-bit JPEG path as the default for non-RAW-aware callers.
- Note: PNG-16 of a 24MP frame is large (tens of MB). Acceptable for a local /
  Tailscale backend; flag for the public deploy.

### 3.2 Decode 16-bit on the frontend
`createImageBitmap` / `<img>` **cannot** yield >8-bit, so:
- Add a PNG-16 (or TIFF) decoder. Options: `UPNG.js` (tiny, decodes 16-bit PNG
  to a `Uint16Array`) in a Web Worker, or a small custom TIFF reader. New dep +
  worker.
- Output: a `Uint16Array` (or `Float32Array`) of RGBA + dimensions.

### 3.3 Source storage carries float (the pervasive part)
`pixelStore` / `CanvasRegistry` currently store an `OffscreenCanvas` per layer.
For a RAW layer we need a float/16-bit source instead. Plan:
- Introduce a `PixelSource` abstraction: either an `OffscreenCanvas` (8-bit, the
  status quo) **or** a `{ data: Float32Array|Uint16Array, width, height }`
  (high-bit). Most call sites only need "give me something I can upload to a
  texture" + dimensions.
- Audit every reader of the registry: the renderer (`image-node-renderer.ts`),
  LOD downscale (`getMemoisedScratchCanvas`), histogram/mechanical stats,
  export. Each must handle (or explicitly 8-bit-flatten) a float source.
- Keep 8-bit images on the exact current path — zero behaviour change for JPEG/
  PNG. Only RAW layers opt into the float source.

### 3.4 Float through the WebGL pipeline
`pipeline.ts` + `src/shaders/utils.ts`:
- `createTexture` / `createFramebuffer`: parameterise internal format. RAW path
  → `RGBA16F` + `HALF_FLOAT`; default stays `RGBA8` + `UNSIGNED_BYTE`.
- Enable `EXT_color_buffer_float` at context init; feature-detect and fall back
  to 8-bit (with a logged notice) when absent.
- `OES_texture_float_linear` for linear filtering on float textures (usually
  present; else nearest).
- Source upload: from the `Uint16Array`/`Float32Array` via
  `texImage2D(…, RGBA16F, …, HALF_FLOAT, data)` instead of the canvas overload.

### 3.5 Shader audit — the trickiest part
**12 of 17 shaders use `clamp(`** (`grep clamp src/shaders/*.glsl.ts`).
Clamping intermediates to `[0,1]` discards the very highlights Tier 1 exists to
recover. For each adjustment shader:
- Remove premature `clamp(…, 0.0, 1.0)` on intermediate values; allow >1.0
  through the chain.
- Audit gamma/sRGB assumptions: several ops are tuned for gamma-encoded 0..1.
  Decide per-shader whether it stays gamma-domain (simplest; 16-bit just adds
  precision/headroom) or moves to linear (correct, but changes its look).
- **Single final output pass**: a new terminal shader does linear→display
  (tone-map / sRGB encode) and the one legitimate clamp to `[0,1]` before the
  8-bit display canvas.

Recommendation for Tier 1: stay **gamma-domain** (don't re-tune every op for
linear). That keeps every adjustment's look identical to today while gaining
real headroom (values can exceed 1.0 and be pulled back). Full linear is Tier 2.

### 3.6 Bypass the 2D composite for single-layer
`image-node-renderer.ts` composites layers through an 8-bit 2D canvas — the
float-killing handoff. For a **single visible layer** (the typical RAW case):
- Skip the per-layer→2D-canvas→re-upload round-trip; render the float pipeline
  straight into the final display pass (§3.5) → 8-bit display canvas.
- Multi-layer RAW falls back to the current 8-bit composite (correctness over
  fidelity) until Tier 2. Log when this fallback happens.

### 3.7 Export (optional within Tier 1)
`canvas.toBlob()` is 8-bit. A 16-bit export (PNG-16/TIFF) is a separate, optional
addition — only worth it if the user needs to *export* the latitude, not just
edit with it. Default export stays 8-bit.

---

## 4. Files touched (Tier 1 estimate)

**Backend** (small): `app/services/raw_decode.py`, `app/api/raw.py`, deps.

**Frontend** (the bulk):
- New: a 16-bit decoder module + worker; a `PixelSource` type.
- `src/core/document.ts` — RAW branch in `openImage`/`addImage` (16-bit decode
  path vs `createImageBitmap`).
- `src/lib/raw-image.ts`, `src/lib/open-file.ts` — request depth=16 for RAW.
- `src/lib/canvas-registry.ts` (pixelStore) — `PixelSource` union.
- `src/lib/image-node-renderer.ts` — float source handling + single-layer bypass.
- `src/shaders/pipeline.ts`, `src/shaders/utils.ts` — float textures/FBOs +
  extension.
- `src/shaders/*.glsl.ts` — clamp/gamma audit across ~12 shaders + a new final
  output pass.
- Touch points: LOD scratch, histogram/mech stats, export (8-bit-flatten or
  adapt).

~10–15 files; concentrated risk in §3.3 (source storage) and §3.5 (shaders).

---

## 5. Risks & unknowns

- **Float-FBO browser support.** WebGL2 + `EXT_color_buffer_float` is broad but
  not universal; need a clean 8-bit fallback path (so RAW still opens, just
  without the headroom) and feature detection.
- **Shader audit is per-shader judgement.** Removing clamps can change output if
  a shader relied on the clamp for its look. Needs visual diffing against the
  current 8-bit result per tool.
- **Memory/perf.** 16-bit source + `RGBA16F` FBOs double VRAM; 24–60MP RAW is
  heavy. The LOD system mitigates but must be exercised at float.
- **Linear vs gamma decision (§3.5).** Tier 1 recommends staying gamma-domain to
  avoid an editor-wide look change; if a reviewer expects "proper" linear RAW,
  that's Tier 2 and a different cost.
- **PNG-16 payload size** over the develop endpoint on a public deploy.

---

## 6. Recommendation

The thesis contribution is AI-composed widgets and the interaction model — RAW
bit-depth fidelity is orthogonal. So:

1. **Default: stop at Tier 0** (shipped). Keep "opens RAW" and be honest in the
   write-up that it's an 8-bit develop, not RAW editing.
2. **If RAW must "do something": Tier 0.5** (develop controls, ~½ day) — cheapest
   demonstrable RAW benefit, no pipeline change.
3. **Only if highlight recovery will actually be demoed: Tier 1** (~3–5 days),
   gamma-domain, single-layer.
4. **Tier 2 is not justified** for this thesis (weeks + editor-wide regression).

Decision needed before any implementation: **which tier**, and whether Tier 1
stays gamma-domain (recommended) or commits to linear.
