import type { ProcessingGraph, NodePosition } from '@/types/graph';

const X_STEP = 280;
const Y_GAP = 80;

/** Estimated rendered heights per node type (for vertical centering) */
const NODE_HEIGHTS: Record<string, number> = {
  source: 68,
  output: 68,
  light: 64,
  color: 64,
  kelvin: 64,
  curves: 60,
  levels: 64,
  filter: 66,
  blend: 64,
};

function getNodeHeight(type: string): number {
  return NODE_HEIGHTS[type] ?? 64;
}

/**
 * Rank-based DAG auto-layout.
 *
 * 1. Topological sort (Kahn's algorithm)
 * 2. Assign ranks via longest-path from any root
 * 3. Group nodes by rank, space vertically with Y_GAP
 * 4. Post-pass: center blend/merge nodes between their inputs
 *
 * Preserves manually dragged positions (existingPositions).
 */
export function computeAutoLayout(
  graph: ProcessingGraph,
  existingPositions: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const result: Record<string, NodePosition> = { ...existingPositions };

  // Check if all nodes already have positions
  const needsPosition = graph.nodes.filter((n) => !(n.id in result));
  if (needsPosition.length === 0) return result;

  // ── Build adjacency maps ──────────────────────────────────────────
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

  // ── Topological sort (Kahn's) ─────────────────────────────────────
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

  // ── Assign ranks (longest path from any root) ─────────────────────
  const rank = new Map<string, number>();
  for (const id of topoOrder) {
    const preds = incoming.get(id) ?? [];
    if (preds.length === 0) {
      rank.set(id, 0);
    } else {
      let maxPredRank = 0;
      for (const pred of preds) {
        maxPredRank = Math.max(maxPredRank, (rank.get(pred) ?? 0) + 1);
      }
      rank.set(id, maxPredRank);
    }
  }

  // ── Group nodes by rank ───────────────────────────────────────────
  const rankGroups = new Map<number, string[]>();
  for (const [id, r] of rank) {
    const group = rankGroups.get(r) ?? [];
    group.push(id);
    rankGroups.set(r, group);
  }

  // ── Assign Y positions per rank ───────────────────────────────────
  const typeMap = new Map(graph.nodes.map((n) => [n.id, n.type]));

  for (const [r, ids] of rankGroups) {
    // Compute total height of this column
    const heights = ids.map((id) => getNodeHeight(typeMap.get(id) ?? ''));
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + (ids.length - 1) * Y_GAP;
    let y = -totalHeight / 2;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      // Skip nodes that already have manual positions
      if (id in existingPositions) continue;
      result[id] = { x: r * X_STEP, y };
      y += heights[i] + Y_GAP;
    }
  }

  // ── Post-pass: center merge nodes between their inputs ────────────
  // Blend nodes should sit at the Y midpoint of their input branches
  for (const id of topoOrder) {
    if (id in existingPositions) continue;
    const nodeType = typeMap.get(id);
    if (nodeType !== 'blend' && nodeType !== 'output') continue;

    const preds = incoming.get(id) ?? [];
    if (preds.length < 2) continue;

    let sumY = 0;
    let count = 0;
    for (const pred of preds) {
      const pos = result[pred];
      if (pos) {
        const h = getNodeHeight(typeMap.get(pred) ?? '');
        sumY += pos.y + h / 2; // use center of predecessor
        count++;
      }
    }
    if (count > 0) {
      const h = getNodeHeight(nodeType);
      result[id] = { x: result[id]?.x ?? (rank.get(id) ?? 0) * X_STEP, y: sumY / count - h / 2 };
    }
  }

  return result;
}

export { X_STEP, Y_GAP };
