import type { Node } from '@/types/operation-graph';
import type { Adjustment } from '@/types/adjustment';
import { evaluateCubicSpline } from '@/lib/curves';
import type { CurvesValue } from '@/types/widget';

const CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;

/** Map a widget OperationGraph Node into an Adjustment for the WebGL pipeline.
 *  For curves nodes, evaluates each channel's control points into a 256-entry Float32Array LUT.
 *  For all other nodes, numeric params are copied verbatim; non-number params are dropped.
 *  Scope is inherited from the node. */
export function nodeToAdjustment(node: Node): Adjustment {
  const params: Record<string, number | Float32Array> = {};

  if (node.type === 'curves' && node.params.curves) {
    const curves = node.params.curves as unknown as CurvesValue;
    for (const ch of CURVE_CHANNELS) {
      params[ch] = evaluateCubicSpline(curves[ch] ?? []);
    }
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
