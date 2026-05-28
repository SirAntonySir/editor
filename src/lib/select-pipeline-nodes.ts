import type { Node } from '@/types/operation-graph';
import type { OptimisticPatch } from '@/store/backend-state-slice';
import { useBackendState } from '@/store/backend-state-slice';

/**
 * PipelineNode is whatever pipeline-manager.ts already consumes. We import
 * the existing Node type from OperationGraph and pass it through.
 */
export type PipelineNode = Node;

export function toPipelineNode(node: Node): PipelineNode {
  return { ...node };
}

/**
 * v1 pass-through. Optimistic patches are applied at the binding-render
 * layer (the slider component holds its own value during drag), so the
 * graph projection doesn't need to merge them here. Future: if we move
 * the WebGL pipeline to read directly from the projected graph, this
 * function will need to rewrite node.params based on binding-target
 * mappings.
 */
export function mergeOptimistic(
  nodes: Node[],
  _optimistic: Map<string, OptimisticPatch>,
): Node[] {
  return nodes;
}

/**
 * Selector used by useAdjustmentPipeline. Returns the projected
 * OperationGraph nodes as PipelineNodes.
 */
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt = useBackendState.getState().optimistic;
  if (!snap) return [];
  return mergeOptimistic(snap.operation_graph.nodes, opt).map(toPipelineNode);
}
