import type { Node } from '@/types/operation-graph';
import type { CurvesValue } from '@/types/curve';
import type { OptimisticPatch } from '@/store/backend-state-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { expandCompoundNodes } from '@/lib/perceptual-dial/expand-compound';

/**
 * PipelineNode is whatever pipeline-manager.ts already consumes. We import
 * the existing Node type from OperationGraph and pass it through.
 */
export type PipelineNode = Node;

export function toPipelineNode(node: Node): PipelineNode {
  return { ...node };
}

/**
 * Applies in-flight optimistic patches to the projected node list so the
 * WebGL pipeline sees the correct param values during a slider drag — before
 * the server round-trip completes (typically 200-500 ms).
 *
 * For each (widgetId, patch) entry in `optimistic`:
 *   1. Locate the widget in the current snapshot.
 *   2. For each binding patch, find the matching binding by param_key.
 *   3. Use binding.target to identify the node + param to override.
 *   4. Return a shallow-cloned node array with those params overwritten.
 */
export function mergeOptimistic(
  nodes: Node[],
  optimistic: Map<string, OptimisticPatch>,
): Node[] {
  if (optimistic.size === 0) return nodes;
  const snap = useBackendState.getState().snapshot;
  if (!snap) return nodes;

  // Build a lookup: node_id -> { param_key -> value }
  const overrides = new Map<string, Record<string, number | string | boolean | CurvesValue>>();
  for (const [widgetId, patch] of optimistic) {
    const widget = snap.widgets.find((w) => w.id === widgetId);
    if (!widget) continue;
    for (const bp of patch.bindings) {
      const binding = widget.bindings.find((b) => b.paramKey === bp.paramKey);
      if (!binding) {
        // Compound-widget fallback: a compound node's optimistic patches use
        // `${op}.${param}` keys that won't match the (typically minimal) widget
        // bindings list. Route them directly into the compound node's params
        // bag so `expandCompoundNodes` (run downstream) picks them up.
        const compoundNode = widget.nodes.find((n) => n.type === 'compound');
        if (!compoundNode) continue;
        let entry = overrides.get(compoundNode.id);
        if (!entry) { entry = {}; overrides.set(compoundNode.id, entry); }
        entry[bp.paramKey] = bp.value;
        continue;
      }
      const nodeId = binding.target.nodeId;
      const paramKey = binding.target.paramKey;
      let entry = overrides.get(nodeId);
      if (!entry) {
        entry = {};
        overrides.set(nodeId, entry);
      }
      entry[paramKey] = bp.value;
    }
  }

  if (overrides.size === 0) return nodes;
  return nodes.map((n) => {
    const o = overrides.get(n.id);
    if (!o) return n;
    return { ...n, params: { ...n.params, ...o } };
  });
}

/**
 * Returns the projected OperationGraph nodes as PipelineNodes (with optimistic
 * overrides merged in). Consumed by layer-compositor, use-adjustment, and
 * useNodePreview.
 */
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt = useBackendState.getState().optimistic;
  if (!snap) return [];
  return expandCompoundNodes(mergeOptimistic(snap.operationGraph.nodes, opt)).map(toPipelineNode);
}
