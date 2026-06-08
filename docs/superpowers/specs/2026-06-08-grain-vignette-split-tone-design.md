# Grain, Vignette, Split-Toning — Design

**Date:** 2026-06-08
**Branch:** `feat/canvas-workspace` (or follow-up branch)
**Status:** Approved design, pending implementation plan

## Goal

Add three new finishing-pass processings to the WebGL pipeline: **grain**, **vignette**, **splitTone**. Each appears in the toolrail (auto-enumerated from `CanvasToolRegistry`), the Cmd+K palette, and is reachable via `backendTools.propose_widget` like every other op. Parameter sets match the Lightroom-standard controls users expect.

## Non-goals

- No backend fused-template integration (`moods.py`, `portrait_glow.py`, `finishing.py`) — those can adopt the new ops later.
- No autonomous-analyze surfacing of these ops.
- No multi-pass shaders. All three are single-pass fragments.
- No LLM-tool manifest entries beyond what `propose_widget` derives from `TOOL_DEFAULTS`.
- No new unit tests for shader output — consistent with existing op test coverage (none of the 10 existing shaders have pixel tests).

## Architecture

Three ops slot into the existing pipeline identically to `sharpen`/`blur`/`clarity`. The shared `engine-registry.json` remains the SSoT for param keys, ranges, and scale; backend `TOOL_DEFAULTS` and the frontend `ProcessingDefinition` both derive from it.

### Touchpoints (per op × 3 ops)

| Layer | File | Change |
|---|---|---|
| Shared registry | `shared/engine-registry.json` | Add `grain`, `vignette`, `splitTone` op entries |
| GLSL | `src/shaders/grain.glsl.ts`, `src/shaders/vignette.glsl.ts`, `src/shaders/split-tone.glsl.ts` | New files, one fragment shader each, all reuse `maskSnippet` |
| Pipeline | `src/shaders/pipeline.ts` | Register three `ShaderPass` entries in `initShaders()` |
| Processing def | `src/processing/grain.tsx`, `vignette.tsx`, `split-tone.tsx` | `ProcessingDefinition` + `Panel` mirroring `color.tsx` shape |
| Processing index | `src/processing/index.ts` | `ProcessingRegistry.register(...)` three new defs |
| Tool def | `src/tools/grain-tool.tsx`, `vignette-tool.tsx`, `split-tone-tool.tsx` | `ToolDefinition` with icon + `processingId` |
| App wiring | `src/App.tsx` | Import + `CanvasToolRegistry.register(...)` |
| Backend defaults | `backend/app/tools/tool_defaults.py` | Extend `_SCALAR_OPS` tuple to include `"grain"`, `"vignette"`, `"splitTone"` |

Toolbar (`src/components/toolbar/MenuBar.tsx`) auto-enumerates `CanvasToolRegistry.getAll().filter(category === 'adjust')`, so no MenuBar code changes.

### Param tables

**grain** (`shaderBinding: "grain"`):

| key | min | max | default | scale | uniform |
|---|---|---|---|---|---|
| amount | 0 | 100 | 0 | 100 (÷100 → 0..1) | `u_amount` |
| size | 50 | 200 | 100 | 100 (÷100 → multiplier on a 1px-equivalent base) | `u_size` |
| roughness | 0 | 100 | 50 | 100 (÷100 → 0..1) | `u_roughness` |

toolDefaults: `["amount", "size", "roughness"]`

**vignette** (`shaderBinding: "vignette"`):

| key | min | max | default | scale | uniform |
|---|---|---|---|---|---|
| amount | -100 | 100 | 0 | 100 (÷100 → -1..1) | `u_amount` |
| midpoint | 0 | 100 | 50 | 100 | `u_midpoint` |
| feather | 0 | 100 | 50 | 100 | `u_feather` |
| roundness | -100 | 100 | 0 | 100 | `u_roundness` |

toolDefaults: `["amount", "midpoint", "feather", "roundness"]`

**splitTone** (`shaderBinding: "splitTone"`):

| key | min | max | default | scale | uniform |
|---|---|---|---|---|---|
| shadow_hue | 0 | 360 | 0 | `deg2rad` | `u_shadowHue` |
| shadow_sat | 0 | 100 | 0 | 100 | `u_shadowSat` |
| highlight_hue | 0 | 360 | 0 | `deg2rad` | `u_highlightHue` |
| highlight_sat | 0 | 100 | 0 | 100 | `u_highlightSat` |
| balance | -100 | 100 | 0 | 100 | `u_balance` |

toolDefaults: all 5 keys

### Shader sketches

All three shaders follow the existing template: `#version 300 es`, `precision highp float`, `maskSnippet`, sample `u_texture` at `v_texCoord`, compute the adjusted color, return `applyMask(texel, adjusted, v_texCoord)`.

**grain** — hash-noise added to luminance only:

```
hash11(seed)            // 1D hash, repeatable
n = hash11(dot(v_texCoord * size_factor, vec2(12.9898, 78.233)))
n2 = hash11(dot(v_texCoord * size_factor * 0.5, vec2(...)))  // coarser layer
noise = mix(n, n2, roughness) * 2.0 - 1.0   // -1..1
luma_offset = noise * amount * 0.5           // ±0.5 max
adjusted = c + vec3(luma_offset)             // monochrome grain
```

`needsTexel: true` so `size_factor = 1.0 / (u_texel * size)` gives stable px-scaled noise.

**vignette** — radial mask from center, aspect- and roundness-aware:

```
uv = v_texCoord - 0.5
aspect = u_texel.y / u_texel.x        // height/width via texel ratio
uv.x *= mix(aspect, 1.0, clamp(roundness, 0.0, 1.0))   // roundness>0 → circle
uv.y *= mix(1.0, 1.0/aspect, clamp(-roundness, 0.0, 1.0))  // roundness<0 → oval
d = length(uv) * sqrt(2.0)            // 0..~1 from center to corner
falloff = 1.0 - smoothstep(midpoint, midpoint + feather, d)
adjusted = c * mix(1.0, falloff, max(-amount, 0.0))   // darken
        + c * max(amount, 0.0) * (1.0 - falloff)      // brighten
```

`needsTexel: true` for aspect from texel ratio.

**splitTone** — luma-based two-tone tint:

```
luma = dot(c, vec3(0.299, 0.587, 0.114))
threshold = 0.5 + balance * 0.25      // -1..1 → 0.25..0.75
w_hi = smoothstep(threshold - 0.15, threshold + 0.15, luma)
w_lo = 1.0 - w_hi
shadow_tint = hsv2rgb(vec3(shadowHue / TWO_PI, shadowSat, 1.0))
hi_tint     = hsv2rgb(vec3(highlightHue / TWO_PI, highlightSat, 1.0))
// Soft-light style blend toward tint, weighted by shadow_sat / highlight_sat
adjusted = mix(c, c * shadow_tint, w_lo * shadowSat)
adjusted = mix(adjusted, adjusted * hi_tint, w_hi * highlightSat)
```

A `hsv2rgb` helper goes into `src/shaders/color-space.glsl.ts` if not already exported (it has color-space utils today).

### Default = no-op

Each op renders pass-through at default param values:
- `grain.amount = 0` → noise multiplied by zero
- `vignette.amount = 0` → falloff weight zero on both branches
- `splitTone.shadow_sat = 0 AND highlight_sat = 0` → mix factors zero

This matches existing tool behavior (light/color with default sliders is a visual no-op).

### Tool registration

Icons (Lucide named imports, tree-shaken):
- grain → `Sparkles`
- vignette → `Aperture`
- splitTone → `Droplets`

If any of these clash with an existing tool's icon, the implementation step picks the next-best Lucide alternative — this isn't a blocking decision.

Shortcuts: the implementation step audits existing `ToolDefinition.shortcut` values across the 10 current tools and picks three unused single keys (preferred candidates: `G`, `V`, `T`). If fewer than three single keys remain, the new tools ship without shortcuts (the toolrail click still works); shortcuts can be revisited later.

Each tool:
```ts
export const GrainTool: ToolDefinition = {
  name: 'grain',
  label: 'Grain',
  icon: Sparkles,
  category: 'adjust',
  shortcut: 'G',
  processingId: 'grain',
  onActivate: () => {},
};
```

### Backend

`backend/app/tools/tool_defaults.py`:

```python
_SCALAR_OPS = ("light", "color", "kelvin", "levels", "sharpen", "blur", "clarity",
               "grain", "vignette", "splitTone")
```

That's the only change — `_scalar_tool` reads from `ENGINE_OPS[op]["toolDefaults"]` and generates the slider bindings.

`propose_widget` already routes by `kind` matching keys in `TOOL_DEFAULTS`, so `kind: "grain"` etc. work for `origin: "tool_invoked"`, `mcp_user_prompt`, and `mcp_autonomous` automatically.

## Test plan

Manual smoke test in the running app:

1. Open an image, select the image node.
2. Click each new toolrail button in turn → widget spawns, sliders visible.
3. Drag each slider → canvas updates in real time.
4. Cmd+K → type "vignette", "grain", "split" → palette suggests the ops → spawning from palette works.
5. Stack two ops on one layer → both visible in inspector, render order matches list order.
6. Disable / re-enable each → toggles correctly.
7. Mask a layer → adjustment respects mask (verifies `applyMask` was wired).

No automated tests added (matches existing op coverage). `npm run check` must still pass (`tsc -b && eslint . && vitest run --passWithNoTests`).

## Risk / open questions

- **Shortcut collisions** — current toolrail uses B, C, K, V, L, F, H, S, U, T (approximate; needs verification). Three more single-letter shortcuts are tight; may need to drop shortcuts on the new ops or use modifier combos.
- **Icon collisions** — verify `Sparkles` / `Aperture` / `Contrast` aren't already used; substitute if so.
- **HSL is registered but the canonical SSoT is `engine-registry.json`** — confirmed both backend and frontend read from it, so the split-tone op uses the same path.

## Out of scope (future work)

- Fused templates (e.g., "Film Look" = grain + vignette + splitTone + light + clarity).
- Image-context-driven autonomous suggestions ("this image would benefit from vignette").
- Per-channel grain (color noise) — current design is luminance only.
- Animated grain (per-frame seed) — not needed for stills.
