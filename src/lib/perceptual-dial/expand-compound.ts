import type { Node } from '@/types/operation-graph';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { compileToWidgetParams } from './compile';

/**
 * Default execution order for adjustmentTypes inside a compound node.
 * Mirrors the per-layer pipeline order used in the WebGL pipeline.
 */
export const DEFAULT_COMPOUND_ORDER: readonly string[] = [
  'basic', 'hsl', 'kelvin', 'curves', 'levels', 'lut', 'clarity', 'sharpen', 'blur',
];

/**
 * Optional field a compound node may carry to point at a ProcessingDefinition
 * other than `compound` (e.g. 'time-of-day'). Used purely to look up
 * `compoundOrder`. If absent, DEFAULT_COMPOUND_ORDER is used.
 */
interface CompoundNode extends Node {
  compound_def_id?: string;
}

/**
 * Expand any node with type === 'compound' into one virtual node per
 * adjustmentType present in its `${op}.${param}` params bag. Non-compound
 * nodes pass through unchanged.
 */
export function expandCompoundNodes(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.type !== 'compound') {
      out.push(node);
      continue;
    }
    out.push(...expandOne(node as CompoundNode));
  }
  return out;
}

function expandOne(compound: CompoundNode): Node[] {
  const patches = compileToWidgetParams(compound.params as Record<string, number>);
  // Group patches by adjustmentType via the registry.
  const byType = new Map<string, Record<string, number>>();
  for (const { op, params } of patches) {
    const def = ProcessingRegistry.get(op);
    if (!def) continue;
    const t = def.adjustmentType;
    let bucket = byType.get(t);
    if (!bucket) {
      bucket = {};
      byType.set(t, bucket);
    }
    Object.assign(bucket, params);
  }

  // Resolve order.
  const defId = compound.compound_def_id;
  const def = defId ? ProcessingRegistry.get(defId) : undefined;
  const order = def?.compoundOrder ?? DEFAULT_COMPOUND_ORDER;

  const ordered: Node[] = [];
  const seen = new Set<string>();
  for (const t of order) {
    const params = byType.get(t);
    if (!params) continue;
    ordered.push(virtualNode(compound, t, params));
    seen.add(t);
  }
  // Any adjustmentType not in `order` is appended in insertion order.
  for (const [t, params] of byType) {
    if (seen.has(t)) continue;
    ordered.push(virtualNode(compound, t, params));
  }
  return ordered;
}

function virtualNode(
  source: CompoundNode,
  adjustmentType: string,
  params: Record<string, number>,
): Node {
  return {
    id: `${source.id}::${adjustmentType}`,
    type: adjustmentType,
    layerId: source.layerId,
    params,
    inputs: [],
    scope: source.scope,
  };
}
