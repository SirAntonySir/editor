/**
 * Shared engine registry accessor — derived from shared/registry/ops/*.json
 * (the SSoT) at build time via the frontend registry loader.
 *
 * Shader-specific metadata (uniform name, scale factor) is stored in the
 * static SHADER_PARAM_META table below, since those are frontend/WebGL
 * concerns that don't belong in the backend-shared registry schema.
 *
 * `engineUniformValue` returns unknown keys unchanged on purpose — that is
 * the pass-through path for legacy uniforms like `temperature`.
 */
import { loadRegistry } from '@/lib/registry/loader';

export type EngineScale = number | 'deg2rad';

export interface EngineParam {
  uniform: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: EngineScale;
  default: number;
  /** Optional display hint shown on the control (e.g. kelvin → "K"). */
  unit?: string;
}

export interface EngineOp {
  shaderBinding: string;
  /** Curated subset of param keys the default toolstore tool exposes. */
  toolDefaults: string[];
  params: Record<string, EngineParam>;
}

/**
 * Per-param shader metadata: uniform name and scale factor.
 * scale is used to convert UI value → shader uniform:
 *   - number N: uniform = value / N
 *   - 'deg2rad': uniform = value * Math.PI / 180
 */
const SHADER_PARAM_META: Record<string, { uniform: string; scale: EngineScale }> = {
  // light / color (basic shader)
  exposure:   { uniform: 'u_exposure',   scale: 100 },
  contrast:   { uniform: 'u_contrast',   scale: 100 },
  highlights: { uniform: 'u_highlights', scale: 100 },
  shadows:    { uniform: 'u_shadows',    scale: 100 },
  whites:     { uniform: 'u_whites',     scale: 100 },
  blacks:     { uniform: 'u_blacks',     scale: 100 },
  brightness: { uniform: 'u_brightness', scale: 100 },
  saturation: { uniform: 'u_saturation', scale: 100 },
  vibrance:   { uniform: 'u_vibrance',   scale: 100 },
  hue:        { uniform: 'u_hue',        scale: 'deg2rad' },
  // kelvin
  kelvin:     { uniform: 'u_kelvin',     scale: 1 },
  tint:       { uniform: 'u_tint',       scale: 100 },
  // levels
  inBlack:    { uniform: 'u_inBlack',    scale: 255 },
  inWhite:    { uniform: 'u_inWhite',    scale: 255 },
  gamma:      { uniform: 'u_gamma',      scale: 1 },
  outBlack:   { uniform: 'u_outBlack',   scale: 255 },
  outWhite:   { uniform: 'u_outWhite',   scale: 255 },
  // hsl — array uniforms; engineUniformValue uses paramKey to look up scale only
  red_hue:       { uniform: 'u_hslHue[0]', scale: 100 },
  red_sat:       { uniform: 'u_hslSat[0]', scale: 100 },
  red_lum:       { uniform: 'u_hslLum[0]', scale: 100 },
  orange_hue:    { uniform: 'u_hslHue[1]', scale: 100 },
  orange_sat:    { uniform: 'u_hslSat[1]', scale: 100 },
  orange_lum:    { uniform: 'u_hslLum[1]', scale: 100 },
  yellow_hue:    { uniform: 'u_hslHue[2]', scale: 100 },
  yellow_sat:    { uniform: 'u_hslSat[2]', scale: 100 },
  yellow_lum:    { uniform: 'u_hslLum[2]', scale: 100 },
  green_hue:     { uniform: 'u_hslHue[3]', scale: 100 },
  green_sat:     { uniform: 'u_hslSat[3]', scale: 100 },
  green_lum:     { uniform: 'u_hslLum[3]', scale: 100 },
  aqua_hue:      { uniform: 'u_hslHue[4]', scale: 100 },
  aqua_sat:      { uniform: 'u_hslSat[4]', scale: 100 },
  aqua_lum:      { uniform: 'u_hslLum[4]', scale: 100 },
  blue_hue:      { uniform: 'u_hslHue[5]', scale: 100 },
  blue_sat:      { uniform: 'u_hslSat[5]', scale: 100 },
  blue_lum:      { uniform: 'u_hslLum[5]', scale: 100 },
  purple_hue:    { uniform: 'u_hslHue[6]', scale: 100 },
  purple_sat:    { uniform: 'u_hslSat[6]', scale: 100 },
  purple_lum:    { uniform: 'u_hslLum[6]', scale: 100 },
  magenta_hue:   { uniform: 'u_hslHue[7]', scale: 100 },
  magenta_sat:   { uniform: 'u_hslSat[7]', scale: 100 },
  magenta_lum:   { uniform: 'u_hslLum[7]', scale: 100 },
  // sharpen / blur / clarity
  amount:     { uniform: 'u_amount',     scale: 100 },
  radius:     { uniform: 'u_radius',     scale: 100 },
  // grain
  size:       { uniform: 'u_size',       scale: 100 },
  roughness:  { uniform: 'u_roughness',  scale: 100 },
  // vignette
  midpoint:   { uniform: 'u_midpoint',   scale: 100 },
  feather:    { uniform: 'u_feather',    scale: 100 },
  roundness:  { uniform: 'u_roundness',  scale: 100 },
  // split tone
  shadow_hue:      { uniform: 'u_shadowHue',      scale: 'deg2rad' },
  shadow_sat:      { uniform: 'u_shadowSat',       scale: 100 },
  highlight_hue:   { uniform: 'u_highlightHue',   scale: 'deg2rad' },
  highlight_sat:   { uniform: 'u_highlightSat',    scale: 100 },
  balance:         { uniform: 'u_balance',          scale: 100 },
};

function buildEngineOps(): Record<string, EngineOp> {
  const reg = loadRegistry();
  const result: Record<string, EngineOp> = {};

  for (const [id, op] of Object.entries(reg.ops)) {
    // Curated toolDefaults: explicit list from registry op, else all binding keys.
    const toolDefaults = op.tool_defaults ?? op.bindings.map((b) => b.param_key);

    const params: Record<string, EngineParam> = {};
    for (const [key, p] of Object.entries(op.params)) {
      if (p.type !== 'scalar') continue; // non-scalar params not in EngineParam
      const meta = SHADER_PARAM_META[key];
      if (!meta) continue; // curves/LUT params have no uniform mapping here
      const binding = op.bindings.find((b) => b.param_key === key);
      params[key] = {
        uniform: meta.uniform,
        label: binding?.label ?? key,
        min: (p.range as [number, number])[0],
        max: (p.range as [number, number])[1],
        step: p.step ?? 1,
        scale: meta.scale,
        default: p.default as number,
        ...(p.unit ? { unit: p.unit } : {}),
      };
    }

    result[id] = {
      shaderBinding: op.engine.shader,
      toolDefaults,
      params,
    };
  }

  return result;
}

export const ENGINE_OPS: Record<string, EngineOp> = buildEngineOps();

/** Flat param-key → spec map. Scalar param keys are unique across ops. */
const FLAT_PARAMS: Record<string, EngineParam> = Object.fromEntries(
  Object.values(ENGINE_OPS).flatMap((op) => Object.entries(op.params)),
);

export function engineParam(paramKey: string): EngineParam | undefined {
  return FLAT_PARAMS[paramKey];
}

/** Convert a canonical param value into the shader-uniform value using the registry scale. */
export function engineUniformValue(paramKey: string, raw: number): number {
  const p = FLAT_PARAMS[paramKey];
  if (!p) return raw;
  if (p.scale === 'deg2rad') return (raw * Math.PI) / 180;
  return raw / p.scale;
}

/** Engine-canonical neutral for a widget binding — the slider's at-rest
 *  point. Looks up the binding's target `param_key` in the shared registry;
 *  for legacy synthetic params (e.g. fused-template `temperature` delta)
 *  that aren't in the registry, falls back to a range heuristic: bipolar
 *  range → 0, unipolar → min. Returns `undefined` when nothing sensible
 *  can be inferred (non-slider control_schema). */
export function engineNeutralForBinding(binding: {
  target: { param_key: string };
  control_schema: { control_type: string; min?: number; max?: number };
}): number | undefined {
  const reg = engineParam(binding.target.param_key);
  if (reg) return reg.default;
  const s = binding.control_schema;
  if (s.control_type !== 'slider') return undefined;
  const min = s.min ?? 0;
  const max = s.max ?? 0;
  if (min < 0 && max > 0) return 0;
  return min;
}
