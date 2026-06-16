import type { Node } from '@/types/operation-graph';
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
 * Optimistic patches are keyed by CANONICAL op-graph node id
 * (`canon:<layer>:<op>` — see `WidgetShell.canonIdFor`). Each patch carries a
 * list of `{ paramKey, value }` entries that map directly onto that node's
 * `params`. We apply each matching patch in place; non-matching keys are
 * harmless leftovers that the renderer / export both ignore.
 *
 * Critical: the previous implementation looked up patches by widget id
 * (`snap.widgets.find(w => w.id === widgetId)`), which never matched the
 * canon-id key the writer actually uses. The export path silently produced
 * the pre-edit pixels because no patches ever merged.
 */
export function mergeOptimistic(
  nodes: Node[],
  optimistic: Map<string, OptimisticPatch>,
): Node[] {
  if (optimistic.size === 0) return nodes;
  return nodes.map((n) => {
    const patch = optimistic.get(n.id);
    if (!patch) return n;
    const params = { ...n.params };
    for (const b of patch.bindings) params[b.paramKey] = b.value;
    return { ...n, params };
  });
}

/**
 * Returns the projected OperationGraph nodes as PipelineNodes (with optimistic
 * overrides merged in). Consumed by layer-compositor and useNodePreview.
 */
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt = useBackendState.getState().optimistic;
  if (!snap) return [];
  return expandCompoundNodes(mergeOptimistic(snap.operationGraph.nodes, opt)).map(toPipelineNode);
}
