import type { Node } from '@/types/operation-graph';
import type { Adjustment } from '@/types/adjustment';

/** Map a widget OperationGraph Node into an Adjustment for the WebGL pipeline.
 *  Non-number params are dropped (Adjustment.params accepts only numeric values).
 *  Scope is inherited from the node. */
export function nodeToAdjustment(node: Node): Adjustment {
  const numericParams: Record<string, number> = {};
  for (const [k, v] of Object.entries(node.params)) {
    if (typeof v === 'number') numericParams[k] = v;
  }
  return {
    id: node.id,
    type: node.type,
    name: node.type,
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    params: numericParams,
    scope: node.scope,
  };
}
