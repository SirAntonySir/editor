# As-Shot White Balance for RAW — Design

**Date:** 2026-07-10
**Status:** Approved

## Problem

The White Balance widget always spawns at 6500K with 6500K as its hardcoded
no-op neutral point. Lightroom instead shows a RAW file's *as-shot* temperature
("As Shot: 3200K, +5") and corrects relative to it. Our RAW develop path bakes
the camera's as-shot WB into the PNG16 at demosaic time, so the information
exists — LibRaw exposes the camera WB multipliers — but it is discarded, and
the widget mislabels every RAW layer as 6500K.

For baked formats (TIFF/JPEG) no as-shot value exists (WB is baked into the
pixels, unrecorded); the existing per-widget **Auto** button
(`autoParamsForOp`) already provides the estimate there, matching Lightroom's
"Auto" (a different feature from "As Shot"). That behavior is unchanged.

## Decision summary

- As-shot Kelvin + tint are extracted at RAW develop time and flow
  backend-owned into the session, so **all three spawn paths** (toolrail,
  Cmd+K, autonomous) label kelvin widgets with the true as-shot temperature.
- The kelvin widget's neutral point becomes per-widget data
  (`neutral_kelvin` / `neutral_tint` params in the widget node), living in the
  backend `SessionStateSnapshot` per the Engine SSoT doctrine — persisted,
  undoable, and visible to the LLM.
- A kelvin widget on a RAW layer spawns at `kelvin = neutral_kelvin = as-shot`
  → a mathematically exact no-op that *displays* the as-shot temperature.
  Moving the slider corrects relative to as-shot, exactly Lightroom's UX.
- Explicitly out of scope: TIFF/JPEG auto-estimate on spawn (covered by the
  existing Auto button), Light-widget spawn-time auto (same), Kelvin range
  widening (as-shot values fit the existing 2000–10000 range), and RAW
  re-develop with `user_wb` (separate future feature for clipping recovery).

## 1. Develop-time extraction (backend)

`app/services/raw_decode.py` gains an as-shot computation alongside
`develop_raw_to_png16` / `develop_raw_to_jpeg`:

1. Read `camera_whitebalance` (RGBG multipliers) from the opened rawpy handle.
2. Camera-space neutral = 1 / multipliers (G channels averaged).
3. Map to XYZ via the RAW's color matrix (`rgb_xyz_matrix`, pseudo-inverted).
4. xy chromaticity → CCT via McCamy's approximation.
5. Tint = signed distance from the Planckian locus, scaled to the slider's
   −100..+100 (sign convention: positive = magenta, matching the shader).

`POST /api/raw/develop` returns the result as response headers:

- `X-As-Shot-Kelvin` — integer, clamped to the registry range [2000, 10000]
- `X-As-Shot-Tint` — integer, clamped to [−100, 100]

Best-effort: any failure (monochrome RAW, zeroed multipliers, missing matrix,
plain-TIFF fallback path) omits both headers. ±200K accuracy is acceptable —
this is a display label and starting position, not a colorimetric claim.

## 2. Session ingestion (backend-owned)

`POST /session` and `POST /session/{sid}/images` accept three **optional**
form fields alongside the image:

- `layer_id` — the frontend-minted layer id for this image (exists before the
  upload happens; see `document.ts` `openImage`/`addImage`)
- `as_shot_kelvin`, `as_shot_tint` — integers from the develop headers

`SessionDocument` stores them as `develop_meta: dict[layer_id, {kelvin, tint}]`,
included in the persisted session state (survives restart) and in the snapshot
model. Non-RAW uploads send no fields → no entry → defaults apply.

## 3. Neutral point as widget data

`shared/registry/ops/kelvin.json` gains two params **without bindings** (no
sliders render; nodes always carry all op params):

```json
"neutral_kelvin": { "type": "scalar", "range": [2000, 10000], "default": 6500 },
"neutral_tint":   { "type": "scalar", "range": [-100, 100],   "default": 0 }
```

In `propose_stack.py`, widget-node param resolution (`_build_widget` /
`_build_widget_multi`) consults `doc.develop_meta.get(layer_id)` when building
a **kelvin** op: if present, the *defaults* for `kelvin`, `tint`,
`neutral_kelvin`, `neutral_tint` come from the develop meta instead of the
registry. The existing precedence is untouched:

```
explicit params  >  existing canonical  >  develop-meta default  >  registry default
```

Consequences:

- Toolrail, Cmd+K, and autonomous spawns all produce as-shot-labeled widgets
  on RAW layers with zero pixel change at spawn.
- The LLM sees true temperatures in op params and can reason about them.
- Presets / fused tools set explicit kelvin values → unchanged on non-RAW
  layers; on RAW layers their explicit value now correctly means "correct to
  X" relative to the as-shot neutral.
- A widget broadcast across multiple layers (`layer_ids`) takes its neutral
  from the spawn layer (`layer_id`).

## 4. Shader

`src/shaders/kelvin.glsl.ts` gains `u_neutralKelvin` / `u_neutralTint`
uniforms, fed by the pipeline from node params (defaulting 6500 / 0 when the
params are absent — old sessions and non-kelvin callers keep working):

```glsl
vec3 multiplier = srgbToLinear(kelvinToRGB(u_neutralKelvin))
                / max(srgbToLinear(kelvinToRGB(u_kelvin)), vec3(1e-4));
color = linearToSrgb(srgbToLinear(color) * multiplier);
```

Tint applies as the delta `(u_tint − u_neutralTint)` with the existing
strength constant and gamma-domain subtract unchanged; `u_neutralTint` is
normalized to the shader's tint units the same way `u_tint` already is.

Slider at neutral ⇒ multiplier = 1.0 and tint delta = 0 ⇒ exact no-op.
(Builds on the linear-space multiply fix from 2026-07-10.)

## 5. Auto button offset

`autoParamsForOp('kelvin', …)` computes its cast-correction shift relative to
the widget's `neutral_kelvin` instead of hardcoded 6500. `WidgetAutoButton`
passes the current widget node's neutral params down. On non-RAW layers
neutral is 6500, so behavior is identical to today.

## Error handling

Every step degrades to current behavior when data is missing: no headers → no
form fields → no develop meta → registry defaults (6500/0 neutral) → today's
rendering, bit-for-bit. No hard failures are introduced anywhere in the open
path.

## Testing

- **CCT conversion unit tests** — the synthetic DNG fixture has a known
  camera WB; assert Kelvin/tint within tolerance, plus edge cases (zeroed
  multipliers → None, clamping at range edges).
- **Develop API** — headers present for the DNG fixture, absent for the
  plain-TIFF fallback.
- **Session** — form fields stored in `develop_meta`, persisted, and absent
  when not sent.
- **Widget build** — kelvin widget on a layer with develop meta spawns with
  all four params from the meta; without meta, registry defaults; explicit
  params still win.
- **Frontend** — pipeline uniform defaults (absent params → 6500/0), Auto
  offset math, and shader compile via `glslangValidator`.

## Files touched

| Area | File |
|---|---|
| Backend develop | `backend/app/services/raw_decode.py`, `backend/app/api/raw.py` |
| Backend session | `backend/app/api/session.py`, `backend/app/state/document.py` |
| Backend widgets | `backend/app/tools/widgets/propose_stack.py` |
| Registry | `shared/registry/ops/kelvin.json` |
| Frontend develop | `src/lib/raw-image.ts`, `src/core/document.ts` (thread headers → upload) |
| Frontend render | `src/shaders/kelvin.glsl.ts`, `src/shaders/pipeline.ts` |
| Frontend auto | `src/lib/auto-tune.ts`, `src/components/widget/WidgetAutoButton.tsx` |
