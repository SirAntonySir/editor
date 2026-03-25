/**
 * Derived graph — computed from layers + stored positions.
 * Only active in Graph mode. Zero cost in develop/compose modes.
 *
 * Uses the ProcessingRegistry to map adjustments → node types,
 * so new processing types automatically appear as graph nodes.
 */
import { useMemo, useEffect } from 'react';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type {
  ProcessingGraph,
  NodePosition,
} from '@/types/graph';
import type { Layer } from '@/store/layer-slice';

// ─── Layout constants ────────────────────────────────────────────────
const X_STEP = 280;
const Y_STEP = 200;

// ─── Build graph from layers + positions ────────────────────────────

export function buildGraphFromLayers(
  layers: Layer[],
  positions: Record<string, NodePosition>,
): ProcessingGraph {
  const graph: ProcessingGraph = { nodes: [], edges: [] };
  const sorted = [...layers].sort((a, b) => a.order - b.order);

  const getPos = (key: string, fallback: NodePosition): NodePosition =>
    positions[key] ?? fallback;

  let prevChainEnd: string | null = null;
  let maxX = 0;

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i];
    const y = i * Y_STEP;
    let x = 0;

    // Source node
    const srcKey = `source:${layer.id}`;
    const srcId = srcKey;
    graph.nodes.push({
      id: srcId,
      type: 'source',
      position: getPos(srcKey, { x, y }),
      data: { label: layer.name || 'Source', layerId: layer.id },
    });
    let chainTip = srcId;
    x += X_STEP;

    // Adjustment nodes — resolved via ProcessingRegistry
    for (const adj of layer.adjustmentStack.adjustments) {
      const nodeTypeIds = ProcessingRegistry.getNodeTypesForAdjustment(adj);

      for (const defId of nodeTypeIds) {
        const def = ProcessingRegistry.get(defId);
        if (!def) continue;

        const nodeKey = `${defId}:${adj.id}`;
        const nodeId = nodeKey;

        graph.nodes.push({
          id: nodeId,
          type: defId,
          position: getPos(nodeKey, { x, y }),
          data: {
            label: def.label,
            layerId: layer.id,
            adjustmentId: adj.id,
            paramKeys: def.paramKeys,
            params: ProcessingRegistry.filterParamsForDef(defId, adj.params),
            enabled: adj.enabled,
            blendMode: adj.blendMode,
            opacity: adj.opacity,
          },
        });
        graph.edges.push({
          id: `${chainTip}->${nodeId}`,
          source: chainTip,
          target: nodeId,
        });
        chainTip = nodeId;
        x += X_STEP;
      }
    }

    // Crop node (always present — shows "No crop" when inactive)
    const cropKey = `crop:${layer.id}`;
    graph.nodes.push({
      id: cropKey,
      type: 'crop',
      position: getPos(cropKey, { x, y }),
      data: { label: 'Crop', layerId: layer.id },
    });
    graph.edges.push({
      id: `${chainTip}->${cropKey}`,
      source: chainTip,
      target: cropKey,
    });
    chainTip = cropKey;
    x += X_STEP;

    maxX = Math.max(maxX, x);

    // Blend chain
    if (i === 0) {
      prevChainEnd = chainTip;
    } else {
      const blendKey = `blend:${layer.id}`;
      const blendId = blendKey;
      const blendX = maxX;
      maxX += X_STEP;

      graph.nodes.push({
        id: blendId,
        type: 'blend',
        position: getPos(blendKey, { x: blendX, y: (i - 0.5) * Y_STEP }),
        data: {
          label: 'Blend',
          layerId: layer.id,
          blendMode: layer.blendMode,
          opacity: layer.opacity,
        },
      });

      graph.edges.push({
        id: `${prevChainEnd}->${blendId}:base`,
        source: prevChainEnd!,
        target: blendId,
        targetHandle: 'base',
      });
      graph.edges.push({
        id: `${chainTip}->${blendId}:overlay`,
        source: chainTip,
        target: blendId,
        targetHandle: 'overlay',
      });

      prevChainEnd = blendId;
    }
  }

  // Output node
  const outKey = 'output:_';
  const outY = sorted.length > 0 ? ((sorted.length - 1) * Y_STEP) / 2 : 0;
  graph.nodes.push({
    id: outKey,
    type: 'output',
    position: getPos(outKey, { x: maxX + X_STEP, y: outY }),
    data: { label: 'Output', layerId: sorted[sorted.length - 1]?.id },
  });

  if (prevChainEnd) {
    graph.edges.push({
      id: `${prevChainEnd}->${outKey}`,
      source: prevChainEnd,
      target: outKey,
    });
  }

  return graph;
}

// ─── React hook ─────────────────────────────────────────────────────

/**
 * Structural fingerprint — only changes when layers/adjustments are
 * added, removed, or reordered (not on param tweaks).
 */
function computeStructureKey(layers: Layer[]): string {
  return layers
    .map(
      (l) =>
        `${l.id}:${l.order}:${l.cropMeta ? 'crop' : ''}:${l.adjustmentStack.adjustments.map((a) => `${a.id}:${a.type}`).join(',')}`,
    )
    .join('|');
}

export function useDerivedGraph(): ProcessingGraph | null {
  const editorMode = useEditorStore((s) => s.editorMode);
  const layers = useEditorStore((s) => s.layers);
  const graphPositions = useGraphStore((s) => s.graphPositions);
  const pruneGraphPositions = useGraphStore((s) => s.pruneGraphPositions);

  // Only rebuild graph when topology changes, not on every param tweak
  const structureKey = useMemo(() => computeStructureKey(layers), [layers]);

  const graph = useMemo(() => {
    if (editorMode !== 'graph') return null;
    return buildGraphFromLayers(layers, graphPositions ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, structureKey]);

  // Prune stale graph positions when topology changes
  useEffect(() => {
    if (!graph) return;
    const validKeys = new Set(graph.nodes.map((n) => n.id));
    pruneGraphPositions(validKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  return graph;
}
