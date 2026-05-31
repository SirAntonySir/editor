/**
 * Shared engine registry accessor — the single source of truth for each op's
 * param keys, ranges, scale and shader-uniform binding (same JSON the backend
 * reads). Lets the WebGL pipeline and the backend defaults stay in lock-step.
 *
 * Phase 1 scope: the four scalar ops (light, color, kelvin, levels) only.
 * Deliberate omissions:
 * - `curves` and `lut`/filter are LUT/texture based (no scalar params) and get
 *   real controls in Phase 2 — they are intentionally not listed here yet.
 * - `temperature` is a legacy `u_temperature` uniform handled directly in
 *   `pipeline.ts`; it has no tool today, so it is intentionally absent.
 * - `toolDefaults` is a deliberate curated subset of `params` (e.g. `light`
 *   exposes Exposure/Contrast/Highlights/Shadows but not Brightness), so the
 *   existing tool UIs stay identical while the contract still covers every
 *   shader param.
 *
 * `engineUniformValue` returns unknown keys unchanged on purpose — that is the
 * pass-through path for legacy uniforms like `temperature`.
 */
import registryJson from '../../shared/engine-registry.json';

export type EngineScale = number | 'deg2rad';

export interface EngineParam {
  uniform: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: EngineScale;
  default: number;
}

export interface EngineOp {
  shaderBinding: string;
  /** Curated subset of param keys the default toolstore tool exposes. */
  toolDefaults: string[];
  params: Record<string, EngineParam>;
}

export const ENGINE_OPS: Record<string, EngineOp> = (registryJson as { ops: Record<string, EngineOp> }).ops;

/** Flat param-key → spec map. Scalar param keys are unique across the Phase 1 ops. */
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
