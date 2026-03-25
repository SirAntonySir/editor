import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import type { ProcessingGraph, NodePosition } from '@/types/graph';

/**
 * Estimated rendered dimensions per node type.
 * Source/output include thumbnail (100px) + label bar (30px).
 * Keep in sync with actual node component sizes.
 */
const NODE_SIZES: Record<string, { w: number; h: number }> = {
  source: { w: 160, h: 130 },
  output: { w: 160, h: 130 },
  light: { w: 160, h: 64 },
  color: { w: 160, h: 64 },
  kelvin: { w: 160, h: 64 },
  curves: { w: 160, h: 60 },
  levels: { w: 160, h: 64 },
  filter: { w: 160, h: 66 },
  crop: { w: 160, h: 90 }, // title + region + optional rotation/flip rows
  blend: { w: 160, h: 80 },
};

const DEFAULT_SIZE = { w: 160, h: 64 };
const GRID = 8; // 8-point spacing grid

function getNodeSize(type: string): { w: number; h: number } {
  return NODE_SIZES[type] ?? DEFAULT_SIZE;
}

function snapToGrid(n: number): number {
  return Math.round(n / GRID) * GRID;
}

// ─── ELK instance (reused) ────────────────────────────────────────

const elk = new ELK();

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.componentComponent': '60',
  'elk.edgeRouting': 'POLYLINE',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // NETWORK_SIMPLEX centers nodes vertically within each layer,
  // keeping simple chains on the same horizontal line.
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Fix port positions so edges connect at node center (matching React Flow handles)
  'elk.portConstraints': 'FIXED_SIDE',
};

// ─── Async ELK layout ────────────────────────────────────────────

/**
 * Run ELK layered layout on the full graph.
 *
 * Returns a position map for ALL nodes. Caller decides whether to
 * merge with existing manual positions.
 */
export async function computeElkLayout(
  graph: ProcessingGraph,
): Promise<Record<string, NodePosition>> {
  if (graph.nodes.length === 0) return {};

  const typeMap = new Map(graph.nodes.map((n) => [n.id, n.type]));

  const children: ElkNode[] = graph.nodes.map((n) => {
    const size = getNodeSize(n.type);
    return { id: n.id, width: size.w, height: size.h };
  });

  const edges: ElkExtendedEdge[] = graph.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const layouted = await elk.layout({
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children,
    edges,
  });

  const result: Record<string, NodePosition> = {};

  // Compute offset so the layout stays near origin
  let minX = Infinity;
  let minY = Infinity;
  for (const child of layouted.children ?? []) {
    if (child.x !== undefined && child.x < minX) minX = child.x;
    if (child.y !== undefined && child.y < minY) minY = child.y;
  }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;

  for (const child of layouted.children ?? []) {
    const x = (child.x ?? 0) - minX;
    const y = (child.y ?? 0) - minY;
    result[child.id] = { x: snapToGrid(x), y: snapToGrid(y) };
  }

  return result;
}

// ─── Synchronous fallback (used on first render before ELK resolves) ──

/**
 * Fast synchronous layout that places unpositioned nodes in a simple
 * left-to-right rank order. Used as initial positions before the async
 * ELK layout resolves, so the graph doesn't flash at (0,0).
 */
export function computeAutoLayout(
  graph: ProcessingGraph,
  existingPositions: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const result: Record<string, NodePosition> = { ...existingPositions };

  const needsPosition = graph.nodes.filter((n) => !(n.id in result));
  if (needsPosition.length === 0) return result;

  // Build adjacency
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    incoming.get(edge.target)!.push(edge.source);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, incoming.get(node.id)!.length);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topoOrder.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const deg = inDegree.get(target)! - 1;
      inDegree.set(target, deg);
      if (deg === 0) queue.push(target);
    }
  }

  // Longest-path rank assignment
  const rank = new Map<string, number>();
  for (const id of topoOrder) {
    const preds = incoming.get(id) ?? [];
    if (preds.length === 0) {
      rank.set(id, 0);
    } else {
      let maxRank = 0;
      for (const pred of preds) maxRank = Math.max(maxRank, (rank.get(pred) ?? 0) + 1);
      rank.set(id, maxRank);
    }
  }

  // Group by rank, assign Y positions
  const rankGroups = new Map<number, string[]>();
  for (const [id, r] of rank) {
    const group = rankGroups.get(r) ?? [];
    group.push(id);
    rankGroups.set(r, group);
  }

  const X_STEP = 240;
  const Y_GAP = 48;

  for (const [r, ids] of rankGroups) {
    const heights = ids.map((nodeId) => getNodeSize(graph.nodes.find((n) => n.id === nodeId)?.type ?? '').h);
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + (ids.length - 1) * Y_GAP;
    let y = -totalHeight / 2;

    for (let i = 0; i < ids.length; i++) {
      const nodeId = ids[i];
      if (nodeId in existingPositions) continue;
      result[nodeId] = { x: snapToGrid(r * X_STEP), y: snapToGrid(y) };
      y += heights[i] + Y_GAP;
    }
  }

  return result;
}
