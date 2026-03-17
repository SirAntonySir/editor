/**
 * Derived graph — computed from layers + stored positions.
 * Only active in Graph mode. Zero cost in develop/compose modes.
 */
import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import type {
  ProcessingGraph,
  ProcessingNodeType,
  NodePosition,
} from '@/types/graph';
import { LIGHT_PARAM_KEYS, COLOR_PARAM_KEYS, NODE_LABELS } from '@/types/graph';
import type { Layer, Adjustment } from '@/store/layer-slice';

// ─── Layout constants ────────────────────────────────────────────────
const X_STEP = 280;
const Y_STEP = 200;

// ─── Helpers ─────────────────────────────────────────────────────────

function adjustmentNodeTypes(adj: Adjustment): ProcessingNodeType[] {
  switch (adj.type) {
    case 'basic': {
      const keys = Object.keys(adj.params);
      const result: ProcessingNodeType[] = [];
      if (keys.some((k) => (LIGHT_PARAM_KEYS as readonly string[]).includes(k)))
        result.push('light');
      if (keys.some((k) => (COLOR_PARAM_KEYS as readonly string[]).includes(k)))
        result.push('color');
      return result.length > 0 ? result : ['light'];
    }
    case 'kelvin':
      return ['kelvin'];
    case 'curves':
      return ['curves'];
    case 'levels':
      return ['levels'];
    case 'lut':
      return ['filter'];
    default:
      return [];
  }
}

function filterParams(
  nodeType: ProcessingNodeType,
  params: Record<string, number | Float32Array>,
): Record<string, number | Float32Array> {
  if (nodeType === 'light') {
    return Object.fromEntries(
      Object.entries(params).filter(([k]) =>
        (LIGHT_PARAM_KEYS as readonly string[]).includes(k),
      ),
    );
  }
  if (nodeType === 'color') {
    return Object.fromEntries(
      Object.entries(params).filter(([k]) =>
        (COLOR_PARAM_KEYS as readonly string[]).includes(k),
      ),
    );
  }
  return { ...params };
}

function paramKeysForType(nodeType: ProcessingNodeType): string[] | undefined {
  if (nodeType === 'light') return [...LIGHT_PARAM_KEYS];
  if (nodeType === 'color') return [...COLOR_PARAM_KEYS];
  return undefined;
}

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
    const srcId = srcKey; // use stable key as ID
    graph.nodes.push({
      id: srcId,
      type: 'source',
      position: getPos(srcKey, { x, y }),
      data: { label: layer.name || 'Source', layerId: layer.id },
    });
    let chainTip = srcId;
    x += X_STEP;

    // Adjustment nodes
    for (const adj of layer.adjustmentStack.adjustments) {
      const nodeTypes = adjustmentNodeTypes(adj);
      for (const nt of nodeTypes) {
        const nodeKey = `${nt}:${adj.id}`;
        const nodeId = nodeKey;
        const pKeys = paramKeysForType(nt);

        graph.nodes.push({
          id: nodeId,
          type: nt,
          position: getPos(nodeKey, { x, y }),
          data: {
            label: NODE_LABELS[nt],
            layerId: layer.id,
            adjustmentId: adj.id,
            paramKeys: pKeys,
            params: filterParams(nt, adj.params),
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
        `${l.id}:${l.order}:${l.adjustmentStack.adjustments.map((a) => `${a.id}:${a.type}`).join(',')}`,
    )
    .join('|');
}

export function useDerivedGraph(): ProcessingGraph | null {
  const editorMode = useEditorStore((s) => s.editorMode);
  const layers = useEditorStore((s) => s.layers);
  const graphPositions = useEditorStore((s) => s.graphPositions);

  // Only rebuild graph when topology changes, not on every param tweak
  const structureKey = useMemo(() => computeStructureKey(layers), [layers]);

  return useMemo(() => {
    if (editorMode !== 'graph') return null;
    return buildGraphFromLayers(layers, graphPositions ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, structureKey, graphPositions]);
}
