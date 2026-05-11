import { useEditorStore } from '@/store';
import type { Adjustment } from '@/store/layer-slice';
import type { OperationGraph } from '@/types/operation-graph';

let counter = 0;

/**
 * Filter an OperationGraph node's params to the numeric-only shape that
 * the editor's `Adjustment.params` accepts. String/boolean values are dropped
 * — they would not feed the WebGL pipeline anyway. Phase 2 may widen this.
 */
function toNumericParams(
  params: Record<string, number | string | boolean>,
): Record<string, number | Float32Array> {
  const out: Record<string, number | Float32Array> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

/**
 * Materialise a generated `OperationGraph` as a new `ai-panel` layer.
 *
 * The layer carries the graph + panel bindings (so `AiPanelSection` can
 * render the user-facing controls) and an adjustment stack mirroring the
 * graph nodes — each adjustment tagged with `aiSource` provenance so the
 * inspector can surface reasoning badges and history can serialise origin.
 */
export function addAiPanelLayer(graph: OperationGraph): void {
  const id = `ai-panel-${Date.now()}-${++counter}`;
  const store = useEditorStore.getState();

  store.addLayer({
    id,
    type: 'ai-panel',
    name: graph.userGoal,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    operationGraph: graph,
    panelBindings: graph.panelBindings,
  });

  // Push each graph node as an adjustment with AI provenance.
  for (const node of graph.nodes) {
    const label =
      graph.panelBindings.find((b) => b.nodeId === node.id)?.label ?? node.type;
    const adjustment: Adjustment = {
      id: `${id}-${node.id}`,
      type: node.type,
      name: label,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: toNumericParams(node.params),
      aiSource: {
        graphId: graph.id,
        nodeId: node.id,
        label,
        reasoning: graph.reasoning,
        modelName: graph.metadata.model_name ?? '',
        modelVersion: graph.metadata.model_version ?? '',
        generatedAt: new Date().toISOString(),
      },
    };
    useEditorStore.getState().addAdjustment(id, adjustment);
  }
}
