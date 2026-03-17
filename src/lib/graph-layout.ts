import type { ProcessingGraph, NodePosition } from '@/types/graph';

const X_STEP = 280;
const Y_STEP = 200;

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
 * Auto-layout for nodes without stored positions.
 * Preserves existing positions, only computes new ones.
 * Center-aligns nodes vertically within each row.
 */
export function computeAutoLayout(
  graph: ProcessingGraph,
  existingPositions: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const result: Record<string, NodePosition> = { ...existingPositions };

  // Build adjacency: target → sources
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }

  // Build adjacency: source → targets
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  // Find nodes that need positioning
  const needsPosition = graph.nodes.filter((n) => !(n.id in result));
  if (needsPosition.length === 0) return result;

  // For nodes without positions, compute based on their predecessors in the edge chain
  for (const node of needsPosition) {
    const sources = incoming.get(node.id);
    if (sources && sources.length > 0) {
      // Place to the right of the rightmost predecessor, centered vertically
      let maxPredX = -Infinity;
      let sumY = 0;
      let count = 0;
      for (const src of sources) {
        const pos = result[src] ?? graph.nodes.find((n) => n.id === src)?.position;
        if (pos) {
          maxPredX = Math.max(maxPredX, pos.x);
          sumY += pos.y;
          count++;
        }
      }
      if (count > 0) {
        result[node.id] = { x: maxPredX + X_STEP, y: sumY / count };
        continue;
      }
    }

    // Check if any target already has a position (place to its left)
    const targets = outgoing.get(node.id);
    if (targets && targets.length > 0) {
      const targetPos = result[targets[0]] ?? graph.nodes.find((n) => n.id === targets[0])?.position;
      if (targetPos) {
        result[node.id] = { x: targetPos.x - X_STEP, y: targetPos.y };
        continue;
      }
    }

    // Fallback: use the position from the derived graph (which already does layout)
    result[node.id] = { ...node.position };
  }

  // ── Vertical centering pass ────────────────────────────────────────
  // Group nodes by row (similar y position) and center within each row
  // so that node handles (at vertical center) align horizontally.
  return centerRows(graph, result, existingPositions);
}

/** Center-align newly positioned nodes within each row. */
function centerRows(
  graph: ProcessingGraph,
  positions: Record<string, NodePosition>,
  existingPositions: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const typeMap = new Map(graph.nodes.map((n) => [n.id, n.type]));

  // Group by approximate row (nodes within tolerance share a row)
  const ROW_TOLERANCE = Y_STEP / 2;
  const sorted = [...graph.nodes].sort(
    (a, b) => (positions[a.id]?.y ?? 0) - (positions[b.id]?.y ?? 0),
  );

  const rows: string[][] = [];
  for (const node of sorted) {
    const y = positions[node.id]?.y ?? 0;
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const lastY = positions[lastRow[0]]?.y ?? 0;
      if (Math.abs(y - lastY) < ROW_TOLERANCE) {
        lastRow.push(node.id);
        continue;
      }
    }
    rows.push([node.id]);
  }

  const result = { ...positions };

  for (const row of rows) {
    if (row.length <= 1) continue;

    const heights = row.map((id) => getNodeHeight(typeMap.get(id) ?? ''));
    const maxH = Math.max(...heights);
    const rowBaseY = Math.min(...row.map((id) => result[id]?.y ?? 0));
    const centerY = rowBaseY + maxH / 2;

    for (let i = 0; i < row.length; i++) {
      const id = row[i];
      // Only adjust nodes without stored positions (preserve manual positioning)
      if (id in existingPositions) continue;
      const pos = result[id];
      if (!pos) continue;
      result[id] = { x: pos.x, y: centerY - heights[i] / 2 };
    }
  }

  return result;
}

export { X_STEP, Y_STEP };
