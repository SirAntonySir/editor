# AI-Authored Processing Nodes (parked research)

**Status:** Parked — not scheduled. Documented so it isn't re-litigated from scratch.
**Date:** 2026-05-31
**Related:** [shader-capabilities-and-param-binding-design](../superpowers/specs/2026-05-31-shader-capabilities-and-param-binding-design.md)

## The idea

Today the AI composes from a **fixed kit**: it picks a fused template and resolves the
*values* of params that we (the developers) have wired into shaders. "AI-authored
processing" is the more ambitious version — the backend would generate **new op types and
their GLSL** at runtime, so the AI could invent a processing operation that doesn't exist
yet (e.g. a bespoke duotone, a custom local-contrast curve, a novel blend) and have it
appear in the pipeline.

This came up while fixing the whites/blacks binding gap, where the user mused "AI needs to
create the shaders or something." It's a real option — but a different bet.

## Why it's parked

1. **It contradicts the current USP.** The thesis framing is *"AI composes working widgets
   from a fixed block kit, wired into the shader pipeline."* The power (and the safety) come
   from the kit being authored and verified. Runtime GLSL generation inverts that.
2. **Validation cost.** The whole point of the param-contract guard (engine-registry +
   CI test) is that *nothing* reaches the pipeline unbacked. Generated shaders would need a
   parallel trust pipeline: compile-check, uniform-contract extraction, range/units
   inference, numerical-stability and clamping guarantees.
3. **Performance.** New programs mean shader compilation at runtime (jank), more passes,
   and unknown per-pixel cost. The current pipeline is hand-tuned ping-pong.
4. **Safety / determinism.** Arbitrary GLSL from a model is an injection surface and a
   reproducibility problem (the same `.edp` project must render identically later).

## What revisiting it would require

- A **shader sandbox**: compile in an isolated context, reject on error, enforce a uniform
  whitelist, static-analyze for unbounded loops / texture-fetch counts.
- An **op manifest the AI must emit alongside GLSL**: declared uniforms, ranges, scale,
  whether it samples neighbours (needs `u_texel`), pass count — i.e. a generated
  `engine-registry` fragment that the existing contract guard can check.
- A **capabilities ceiling**: probably constrain generation to *composition* of existing
  primitives (kernels, blends, curves) rather than free-form GLSL — a DSL, not raw shader
  text. This keeps most of the safety of the fixed kit while adding expressivity.
- **Caching + provenance**: persist generated ops with the project so re-opens are
  deterministic; surface "AI-authored" provenance in the UI (we already have the
  `--color-ai` provenance treatment).

## Recommendation

If pursued, do it as a **DSL over the existing primitives** (Phase 3/4 convolution +
blend + curves become composable building blocks), not raw GLSL generation. That preserves
the contract guarantees this codebase is built around while letting the AI reach beyond the
hand-authored kit. Until then: extend the fixed kit (the active spec) — it covers the
known high-value gaps (HSL, sharpen, blur, clarity) at a fraction of the risk.
