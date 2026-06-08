import type { Node } from '@/types/operation-graph';
import type { Adjustment } from '@/types/adjustment';
import { evaluateCubicSpline, DEFAULT_CURVE_POINTS, type CurvePoint } from '@/lib/curves';
import type { CurvesValue } from '@/types/widget';

const CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;

/** Coerce a `points` value (flat `[[x, y], ...]` pairs in 0..1 space, as
 *  written by fused-tool bindings)
 *  into CurvePoint[]. Returns identity if the value is missing/malformed. */
function pointsToCurvePoints(v: unknown): CurvePoint[] {
  if (!Array.isArray(v) || v.length < 2) return [...DEFAULT_CURVE_POINTS];
  const pts: CurvePoint[] = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number') {
      pts.push({ x: p[0], y: p[1] });
    }
  }
  return pts.length >= 2 ? pts : [...DEFAULT_CURVE_POINTS];
}

/** Coerce a `points` value in **0–255 space** (as written by the registry
 *  CurveEditor adapter — `[[x, y], ...]` where x and y range 0..255) into
 *  CurvePoint[] (0..1 space). Returns identity if missing/malformed. */
function pointsToCurvePoints255(v: unknown): CurvePoint[] {
  if (!Array.isArray(v) || v.length < 2) return [...DEFAULT_CURVE_POINTS];
  const pts: CurvePoint[] = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number') {
      pts.push({ x: p[0] / 255, y: p[1] / 255 });
    }
  }
  return pts.length >= 2 ? pts : [...DEFAULT_CURVE_POINTS];
}

/** Returns true when all four registry channel keys are present in params. */
function hasRegistryChannels(params: Record<string, unknown>): boolean {
  return 'rgb' in params && 'red' in params && 'green' in params && 'blue' in params;
}

/** Map a widget OperationGraph Node into an Adjustment for the WebGL pipeline.
 *  For curves nodes, evaluates each channel's control points into a 256-entry Float32Array LUT.
 *  Supports two shapes: the legacy `params.curves: CurvesValue` (per-channel point arrays)
 *  and the newer `params.points: [[x, y], ...]` flat array (single master curve, used by
 *  the registry curve_points control and fused-tool bindings). When `points` is present
 *  it drives the RGB master; per-channel curves stay at identity.
 *  For all other nodes, numeric params are copied verbatim; non-number params are dropped.
 *  Scope is inherited from the node. */
export function nodeToAdjustment(node: Node): Adjustment {
  const params: Record<string, number | Float32Array> = {};

  if (node.type === 'curves' && node.params.curves) {
    const curves = node.params.curves as unknown as CurvesValue;
    for (const ch of CURVE_CHANNELS) {
      params[ch] = evaluateCubicSpline(curves[ch] ?? []);
    }
  } else if (node.type === 'curves' && hasRegistryChannels(node.params)) {
    // Registry 4-channel shape: params.rgb / red / green / blue each hold
    // a `[[x, y], ...]` array in 0–255 space (as stored by the registry
    // CurveEditor adapter).  Normalise each to 0–1 before evaluating.
    for (const ch of CURVE_CHANNELS) {
      params[ch] = evaluateCubicSpline(pointsToCurvePoints255(node.params[ch]));
    }
  } else if (node.type === 'curves' && 'points' in node.params) {
    const masterLut = evaluateCubicSpline(pointsToCurvePoints(node.params.points));
    const identityLut = evaluateCubicSpline(DEFAULT_CURVE_POINTS);
    params.rgb = masterLut;
    params.red = identityLut;
    params.green = identityLut;
    params.blue = identityLut;
  } else {
    for (const [k, v] of Object.entries(node.params)) {
      if (typeof v === 'number') params[k] = v;
    }
  }

  return {
    id: node.id,
    type: node.type,
    name: node.type,
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    params,
    scope: node.scope,
  };
}
