/**
 * Bidirectional sync between the processing graph and the layer/adjustment system.
 *
 * Graph → Layer: `syncNodeToLayer()` pushes node param changes into the layer adjustment.
 * Layer → Graph: handled by `useDerivedGraph()` in `@/core/derived-graph.ts`.
 *
 * The old `rebuildGraphFromLayers()` (Layer → Graph direction within the store)
 * has been replaced by the derived graph approach. Graph is now computed lazily
 * only when Graph mode is active.
 */
import type {
  ProcessingGraph,
  ProcessingNode,
} from '@/types/graph';
import type { Layer, BlendMode } from '@/store/layer-slice';

// Re-export the pure build function from derived-graph for any callers
export { buildGraphFromLayers } from '@/core/derived-graph';

// ─── Shared interface for cross-slice access ─────────────────────────
export interface SyncableState {
  layers: Layer[];
  activeLayerId: string | null;
}

// ─── Graph → Layer sync ──────────────────────────────────────────────

/**
 * Push a graph node's param/meta changes into the corresponding layer adjustment.
 * Called from graph UI components when a user modifies a node in Graph mode.
 */
export function syncNodeToLayer(
  state: SyncableState,
  node: ProcessingNode,
): void {
  if (!node.data.adjustmentId) return;

  for (const layer of state.layers) {
    const adj = layer.adjustmentStack.adjustments.find(
      (a) => a.id === node.data.adjustmentId,
    );
    if (!adj) continue;

    // Update params — only the keys this node owns
    if (node.data.params) {
      const keys = node.data.paramKeys;
      if (keys) {
        for (const key of keys) {
          if (key in node.data.params) {
            adj.params[key] = node.data.params[key];
          }
        }
      } else {
        Object.assign(adj.params, node.data.params);
      }
    }

    // Update meta
    if (node.data.enabled !== undefined) adj.enabled = node.data.enabled;
    if (node.data.blendMode !== undefined) adj.blendMode = node.data.blendMode;
    if (node.data.opacity !== undefined) adj.opacity = node.data.opacity;
    break;
  }
}

/**
 * Sync a blend node's changes back to the corresponding layer.
 * Called when a user modifies a blend node in Graph mode.
 */
export function syncBlendNodeToLayer(
  state: SyncableState,
  node: ProcessingNode,
): void {
  if (node.type !== 'blend' || !node.data.layerId) return;

  const layer = state.layers.find((l) => l.id === node.data.layerId);
  if (!layer) return;

  if (node.data.blendMode !== undefined) layer.blendMode = node.data.blendMode as BlendMode;
  if (node.data.opacity !== undefined) layer.opacity = node.data.opacity;
}

// ─── Graph queries ───────────────────────────────────────────────────

/** Find the source node for a specific layer */
export function getSourceNodeForLayer(
  graph: ProcessingGraph,
  layerId: string,
): ProcessingNode | undefined {
  return graph.nodes.find((n) => n.type === 'source' && n.data.layerId === layerId);
}

/** Get the ordered processing chain for a layer (source → adjustments) */
export function getChainForLayer(
  graph: ProcessingGraph,
  layerId: string,
): ProcessingNode[] {
  const source = getSourceNodeForLayer(graph, layerId);
  if (!source) return [];

  const chain: ProcessingNode[] = [source];
  let currentId = source.id;

  while (true) {
    const outEdge = graph.edges.find((e) => e.source === currentId);
    if (!outEdge) break;
    const next = graph.nodes.find((n) => n.id === outEdge.target);
    if (!next || next.type === 'blend' || next.type === 'output') break;
    chain.push(next);
    currentId = next.id;
  }

  return chain;
}

/** Find the output node */
export function getOutputNode(graph: ProcessingGraph): ProcessingNode | undefined {
  return graph.nodes.find((n) => n.type === 'output');
}

/** Topological sort of graph nodes (for execution order) */
export function topologicalSort(graph: ProcessingGraph): ProcessingNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: ProcessingNode[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
