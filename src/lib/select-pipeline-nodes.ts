import type { Node } from '@/types/operation-graph';
import type { OptimisticPatch } from '@/store/backend-state-slice';
import { useBackendState } from '@/store/backend-state-slice';

/**
 * PipelineNode is whatever pipeline-manager.ts already consumes. We import
 * the existing Node type from OperationGraph and pass it through.
 */
export type PipelineNode = Node;

/**
 * Returns true when a pipeline node applies to the given layer.
 *
 * A node applies to a layer if:
 *  - Its `layerId` equals the target layer id (single-layer pinned node), OR
 *  - Its `layerIds` array includes the target layer id (broadcast node).
 *
 * Both conditions are checked independently so a node with both fields set is
 * matched for the `layerId` anchor AND for every id in `layerIds`.
 */
export function matchesLayer(node: Node, layerId: string): boolean {
  if (node.layerId === layerId) return true;
  if (Array.isArray(node.layerIds) && node.layerIds.includes(layerId)) return true;
  return false;
}

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
/** Parse a canonical optimistic key (`canon:<layerId>:<op>`) into its
 *  components. Returns null for keys that don't match — those reference
 *  widget nodes that already exist in the projection (the merge below
 *  just overlays them via `optimistic.get(n.id)`). */
function parseCanonKey(key: string): { layerId: string; op: string } | null {
  if (!key.startsWith('canon:')) return null;
  const rest = key.slice('canon:'.length);
  const i = rest.indexOf(':');
  if (i <= 0 || i === rest.length - 1) return null;
  return { layerId: rest.slice(0, i), op: rest.slice(i + 1) };
}

const PHANTOM_NODE_SCOPE = { kind: 'global' } as const;

export function mergeOptimistic(
  nodes: Node[],
  optimistic: Map<string, OptimisticPatch>,
): Node[] {
  if (optimistic.size === 0) return nodes;
  const existingIds = new Set(nodes.map((n) => n.id));
  const merged = nodes.map((n) => {
    const patch = optimistic.get(n.id);
    if (!patch) return n;
    const params = { ...n.params };
    for (const b of patch.bindings) params[b.paramKey] = b.value;
    return { ...n, params };
  });
  // Phantom canonical nodes: the first inspector edit of a (layer, op) lands
  // before the SSE roundtrip creates the canonical node. Without these, the
  // optimistic patch would have no node to overlay and the live preview
  // would be silent until the debounced backend write returns ~300 ms later.
  for (const [key, patch] of optimistic) {
    if (existingIds.has(key)) continue;
    const canon = parseCanonKey(key);
    if (!canon) continue;
    const params: Record<string, unknown> = {};
    for (const b of patch.bindings) params[b.paramKey] = b.value;
    merged.push({
      id: key,
      type: canon.op,
      scope: PHANTOM_NODE_SCOPE,
      params: params as Node['params'],
      inputs: [],
      layerId: canon.layerId,
    });
  }
  return merged;
}

/**
 * Returns the projected OperationGraph nodes as PipelineNodes (with optimistic
 * overrides merged in). Consumed by layer-compositor and useNodePreview.
 */
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt = useBackendState.getState().optimistic;
  if (!snap) return [];
  return mergeOptimistic(snap.operationGraph.nodes, opt).map(toPipelineNode);
}
