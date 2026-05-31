# Shader Capabilities & Param-Binding Contract — Design

**Date:** 2026-05-31
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude (brainstorming session)

## 1. Problem & Context

Two things prompted this work:

1. **AI suggestions propose params that never touch pixels.** The fused tool
   [exposure_balance.py](../../../backend/app/tools/fused/exposure_balance.py)
   (and [sky_recovery.py](../../../backend/app/tools/fused/sky_recovery.py)) emit a
   `basic` node carrying `whites` and `blacks`. Neither exists in the shared param
   contract or the shader, so they are **silently dropped** — the slider moves, nothing
   happens.
2. **We want the editor to be more powerful.** HSL (targeted colour), sharpening, blur,
   and clarity are the high-value missing capabilities. Adding them is on-thesis: scoped
   to existing SAM masks, they become AI-composable fused tools ("soften background",
   "sharpen eyes"), not just sliders.

This spec covers both as one phased push, smallest/safest first.

### Current architecture (verified live)

- **Shared param contract (SSoT).** [shared/engine-registry.json](../../../shared/engine-registry.json)
  is imported by **both** the frontend ([engine/registry.ts](../../../src/engine/registry.ts)
  → `engineUniformValue`) and the backend ([engine/registry.py](../../../backend/app/engine/registry.py)).
  Each param → `{uniform, label, min, max, step, scale, default}`. The `light` op lists
  `exposure, contrast, highlights, shadows, brightness` — **no `whites`/`blacks`.**
- **Backend owns values.** `operation_graph.nodes` is projected purely from `doc.canonical`
  ([operations.py](../../../backend/app/state/operations.py) → [canonical.py](../../../backend/app/state/canonical.py)),
  one node per `(layer_id, op)`, id `canon:<layer>:<op>`. Widget nodes contribute
  `panel_bindings`, **not** render nodes. `add_widget` seeds canonical from a widget's
  node params ([document.py](../../../backend/app/state/document.py) `_seed_canonical_from_widget`),
  so AI suggestions project immediately. `analyze_image` stamps the real frontend
  `layer_id` ([analyze_image.py](../../../backend/app/tools/atomic/analyze_image.py)
  `_mint_autonomous_suggestions`), and the frontend passes it
  ([useBackendSession.ts](../../../src/hooks/useBackendSession.ts)).
- **Frontend renders.** [image-node-renderer.ts](../../../src/lib/image-node-renderer.ts)
  filters `op_graph.nodes` by `layer_id`, maps each node → `Adjustment`
  ([node-to-adjustment.ts](../../../src/lib/node-to-adjustment.ts)) → shader uniforms
  ([pipeline.ts](../../../src/shaders/pipeline.ts)), composites layers.
  `nodeToAdjustment` copies numeric params verbatim; a shader with no matching uniform
  **ignores them silently** — the silent-drop hole.
- **Shader pipeline.** Every shader is a **point operation**: one input texture
  (`u_texture`), sampled once at the pixel's own coord. Passes chain through ping-pong
  FBOs (`fboA`/`fboB`), with a separate two-input `blend` pass (`u_base`+`u_blend`, via
  `fboC`) and mask scoping (`u_mask`, R8 texture). **There is no `texelSize`/resolution
  uniform and no neighbour sampling anywhere.** The render loop assumes **1 adjustment =
  1 pass**.
- The `basic` shader ([basic-adjustments.glsl.ts](../../../src/shaders/basic-adjustments.glsl.ts))
  has uniforms `u_brightness, u_contrast, u_saturation, u_hue, u_temperature, u_exposure,
  u_highlights, u_shadows, u_vibrance`. `highlights`/`shadows` **are** fully wired
  (registry scale 100 → ±1 → ±0.5 tonal shift).

### Why highlights/shadows "feel dead" in AI suggestions

They are wired (the manual Light panel moves them via
[useCanonicalParam.ts](../../../src/hooks/useCanonicalParam.ts) → `set_param` →
`canon:<layer>:basic`). But [AiSection.tsx](../../../src/components/inspector/adjustments/AiSection.tsx)
keys its optimistic preview on `binding.target.node_id` — the **widget** node id
(`n_xxxxxx`). The renderer's optimistic merge only matches `op_graph` node ids
(`canon:<layer>:basic`). They never match → **AI-suggestion drags produce no live canvas
feedback** until the backend round-trips. Combined with the genuinely-dead whites/blacks
in the same widget, the whole suggestion reads as "not connected". `applyOptimistic`
([backend-state-slice.ts](../../../src/store/backend-state-slice.ts)) also *replaces* the
patch per key rather than merging.

## 2. Goals / Non-Goals

**Goals**
- Make whites/blacks real, contract-checked shader params.
- Guarantee no fused tool can ever again emit a param with no shader binding (fail in CI).
- Make AI-suggestion sliders give instant canvas feedback.
- Add HSL (8-band targeted colour), sharpen, blur, and clarity as registered ops.
- Keep everything inside the "AI composes from a fixed kit" USP — we author the kit;
  the AI composes/values it.

**Non-Goals**
- Runtime AI-generated GLSL (parked — see §9 and `docs/research/ai-authored-processing.md`).
- Refining the existing crude tonal math beyond consistency.
- Changing `toolDefaults` / `TOOL_DEFAULTS` curation.
- Bloom / noise reduction (same convolution family; deferred).

## 3. Phase 0 — whites/blacks binding

The proof slice for the registry→shader path.

- **Shader** [basic-adjustments.glsl.ts](../../../src/shaders/basic-adjustments.glsl.ts):
  add `uniform float u_whites; uniform float u_blacks;` and extend the tone block in the
  same additive style as highlights/shadows, masks pushed to the extremes:
  ```glsl
  float whitesMask = smoothstep(0.6, 1.0, lum);        // brightest tones
  color += u_whites * whitesMask * 0.5;
  float blacksMask = 1.0 - smoothstep(0.0, 0.4, lum);  // darkest tones
  color += u_blacks * blacksMask * 0.5;
  ```
- **Pipeline** [pipeline.ts](../../../src/shaders/pipeline.ts): set `u_whites`/`u_blacks`
  in the `basic` pass via `engineUniformValue(...)`, and add the neutral `0` defaults to
  the passthrough block.
- **Registry** [engine-registry.json](../../../shared/engine-registry.json), `light.params`:
  ```json
  "whites": { "uniform": "u_whites", "label": "Whites", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
  "blacks": { "uniform": "u_blacks", "label": "Blacks", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 }
  ```
- **Light panel** [light.tsx](../../../src/processing/light.tsx): add `whites`/`blacks` to
  `lightProcessing.params` + `paramKeys` (drives the accordion `ScalarSectionBody`
  sliders), and matching sliders/reset/`isDefault` in `LightPanel`. Order: Exposure ·
  Contrast · Highlights · Shadows · Whites · Blacks.

**Test:** unit test that `nodeToAdjustment` of a `basic` node with `whites`/`blacks`
carries them through, and the registry resolves their uniforms.

## 4. Phase 1 — contract guard + live-preview fix

### 4.1 Contract guard (closes the silent-drop hole permanently)

New backend pytest (`backend/tests/tools/test_fused_params_in_registry.py`). Build a map
`shaderBinding → ⋃ param keys` from the registry (so `basic` = `light ∪ color` params,
now including whites/blacks). For every fused template
([all_fused_templates](../../../backend/app/tools/fused)), assert each
`NodeSkeleton.tunable_param_keys` entry and each `BindingSkeleton.target.param_key` exists
in that node-type's set. Fails CI the instant a fused tool references an unbacked param.

- Structured ops (`curves`, `lut`) are texture-based and exempt today; the test skips
  node types whose `shaderBinding` has no scalar registry op, with an explicit allow-list
  so the skip is intentional, not accidental.

*Optional hardening:* a frontend vitest asserting every registry `uniform` string literally
appears in its shader source (`basic-adjustments.glsl.ts` etc.) — catches a registry entry
whose uniform was never added to the shader.

### 4.2 Live-preview fix

[AiSection.tsx](../../../src/components/inspector/adjustments/AiSection.tsx): re-key the
optimistic patch (and `effectiveOf`'s read) from the widget node id to the **canonical**
node id `canon:${node.layer_id}:${node.type}`, using `binding.target.param_key`. The
renderer then sees the override on the node it actually reads → instant feedback, matching
the manual panel.

[backend-state-slice.ts](../../../src/store/backend-state-slice.ts) `applyOptimistic`:
**merge** bindings by `paramKey` within a node's patch instead of replacing, so the four
bindings sharing one `canon:<layer>:basic` node (shadows/highlights/whites/blacks) don't
clobber each other mid-edit. Single-binding callers
([useCanonicalParam.ts](../../../src/hooks/useCanonicalParam.ts),
[ScalarSectionBody.tsx](../../../src/components/inspector/adjustments/ScalarSectionBody.tsx))
are unaffected.

**Tests:** `applyOptimistic` merge semantics; an `AiSection` test asserting the optimistic
patch lands on the canonical node id.

## 5. Phase 2 — HSL (8-band targeted colour)

A new point op. Highest value, no pipeline risk.

- **Model:** 8 bands `[red, orange, yellow, green, aqua, blue, purple, magenta]` ×
  `{hue, sat, lum}` = **24 flat-scalar params**, each contract-checked. The AI can propose
  precise single-band moves ("blue luminance −20"). Registry uniform strings use **GLSL
  array-element addressing** so the shader stays compact while the registry stays flat:
  - param key `blue_hue` → uniform `u_hslHue[5]`
  - param key `blue_sat` → uniform `u_hslSat[5]`
  - param key `blue_lum` → uniform `u_hslLum[5]`
- **Shader** `src/shaders/hsl.glsl.ts`: `uniform float u_hslHue[8]; u_hslSat[8]; u_hslLum[8];`
  Convert texel → HSL, compute each band's weight from hue distance (triangular falloff,
  bands centred at 0°/30°/60°/120°/180°/240°/270°/300° — tunable), accumulate weighted
  hue rotation, saturation scale, luminance shift, convert back. Lift the existing
  `rgb2hsl`/`hsl2rgb` helpers out of `basic-adjustments.glsl.ts` into
  [utils.ts](../../../src/shaders/utils.ts) and share them (don't duplicate).
  Mask-scoped via the shared `mask-snippet`.
- **Pipeline** [pipeline.ts](../../../src/shaders/pipeline.ts): register `hsl` shader;
  `setUniforms` loops the 24 params via `engineUniformValue`, addressing `u_hslHue[i]` etc.
- **Registry** `engine-registry.json`: new `hsl` op, `shaderBinding: "hsl"`, 24 params,
  each range `-100..100`, `scale: 100` (→ normalized ±1). The shader maps the normalized
  hue value to a max ±30° rotation, and sat/lum ±1 to a ±100% scale/shift — so all 24
  share one uniform path (`engineUniformValue`, no special-casing).
- **Panel** `src/processing/hsl.tsx` + a custom `HslSectionBody` (precedent: curves has its
  own body). Compact grid or 3-tab (Hue/Sat/Lum) layout, 8 rows. Wire into
  [ToolSection.tsx](../../../src/components/inspector/adjustments/ToolSection.tsx) like the
  `curves`/`lut` branches. Register in [processing/index.ts](../../../src/processing/index.ts).

**Test:** registry round-trip (24 keys → array uniforms); a shader-less unit test of the
band-weight function if extracted to TS.

## 6. Phase 3 — convolution pass extension + sharpen

The one architectural lift, isolated behind the simplest consumer.

- **texelSize uniform.** Add `u_texel` (`vec2 = 1/width, 1/height`) to the pipeline,
  set in `drawPass` for shaders that declare they need it. Point ops ignore it.
- **Multi-pass model.** Generalize `ShaderPass` so an op can run more than one internal
  pass. Proposed: an optional `renderPass(ctx)` hook receiving `(gl, inputTex, scratchFBOs,
  drawQuad, adj)` that executes its own sequence and returns the output texture; absent →
  today's single `drawPass`. The main `render()` loop calls `renderPass` when present.
  FBO budget: separable ops need a scratch beyond `fboA/B/C`; add `fboD` (and resize with
  the others) rather than overloading the blend intermediate.
- **Sharpen** (`sharpen` op): single extra pass, fixed small unsharp kernel (3×3 / 5×5)
  using `u_texel` to sample neighbours, `u_amount` (and optional `u_radius`) from the
  registry. New shader `src/shaders/sharpen.glsl.ts`, registry `sharpen` op, processing
  def `src/processing/sharpen.tsx`. Proves `u_texel` end-to-end without yet needing the
  multi-pass machinery.

**Test:** pipeline unit test that a `sharpen` adjustment produces output differing from a
flat blit (neighbour sampling is active); `u_texel` is set to `1/size`.

## 7. Phase 4 — blur + clarity

Built on Phase 3's machinery.

- **Gaussian blur** (`blur` op): separable — a horizontal then a vertical pass sharing one
  shader with a `u_direction` uniform, `u_radius`/`u_sigma` from the registry. First real
  `renderPass` consumer (2 internal passes, scratch = `fboC`/`fboD`).
- **Clarity / structure** (`clarity` op): large-radius unsharp — blur the input, then
  combine `original + amount * (original − blurred)`. The combine is a two-input pass; reuse
  the proven `blend` two-texture pattern. `renderPass` = blur sub-sequence + combine.
- **Mask synergy / fused tools (optional within this phase):** because scoping already
  exists, add fused templates that make these AI-composable — e.g. `soften_background`
  (blur on the inverse-subject mask) and `sharpen_subject`. Each is contract-checked by
  Phase 1. This is where blur/sharpen earn their keep vs. global sliders.

**Test:** blur output is symmetric/energy-preserving on a delta image; clarity with
`amount=0` is identity; the multi-pass op returns to the correct ping-pong slot.

## 8. Files touched (summary)

| Area | Files |
|---|---|
| Shaders | `basic-adjustments.glsl.ts` (+whites/blacks), new `hsl.glsl.ts`, `sharpen.glsl.ts`, `blur.glsl.ts`, `clarity.glsl.ts`, `utils.ts` (shared hsl helpers), `pipeline.ts` (register + texel + multi-pass) |
| Contract | `shared/engine-registry.json` (light +2, new `hsl`/`sharpen`/`blur`/`clarity` ops) |
| Frontend UI | `light.tsx`, new `hsl.tsx`+`HslSectionBody`, `sharpen.tsx`, `blur.tsx`, `clarity.tsx`, `processing/index.ts`, `ToolSection.tsx` |
| Live preview | `AiSection.tsx`, `backend-state-slice.ts` |
| Backend | new `tests/tools/test_fused_params_in_registry.py`; optional fused templates `soften_background`/`sharpen_subject` |
| Docs | this spec; `docs/research/ai-authored-processing.md` (parked) |

## 9. Risks & trade-offs

- **Multi-pass pipeline change (Phase 3)** is the highest-risk edit — it touches the core
  `render()` loop. Mitigation: land it behind sharpen (single extra pass) before blur/
  clarity depend on it; keep point-op path byte-identical.
- **FBO count / memory.** Adding `fboD` at full resolution costs one more framebuffer.
  Acceptable; resized alongside the others.
- **HSL registry verbosity.** 24 entries is a lot of JSON, but explicit and contract-checked
  — chosen over a structured param precisely to keep the silent-drop guard total.
- **Tonal math is crude.** whites/blacks/highlights/shadows are additive luma-masked
  shifts, not a real tone curve. Intentional (consistency now; refine later).

## 10. Parked — option 3 (AI-authored shaders)

Captured in `docs/research/ai-authored-processing.md`: runtime generation of new op types +
GLSL by the backend. Powerful but contradicts the fixed-kit USP and carries perf/safety/
validation cost. Not in scope; documented so it isn't re-litigated from scratch.

## 11. Verification

Per phase: `npm run check` (tsc + eslint + vitest) and backend `pytest`. Then load an image
and confirm, for each new op, that the manual panel **and** an AI suggestion move pixels
with live drag feedback. whites/blacks specifically verified against an `exposure_balance`
suggestion.
