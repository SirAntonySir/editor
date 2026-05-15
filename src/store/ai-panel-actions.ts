import { useEditorStore } from '@/store';
import type { Adjustment } from '@/store/layer-slice';
import type { OperationGraph } from '@/types/operation-graph';
import { editorDocument } from '@/core/document';

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
  console.log('[OperationGraph]', graph);
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
    const firstBinding = graph.panelBindings.find((b) => b.nodeId === node.id);
    const label = firstBinding?.label ?? node.type;
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
        reasoning: firstBinding?.reasoning ?? graph.reasoning,
        modelName: graph.metadata.model_name ?? '',
        modelVersion: graph.metadata.model_version ?? '',
        generatedAt: graph.metadata.generated_at ?? new Date().toISOString(),
      },
    };
    useEditorStore.getState().addAdjustment(id, adjustment);
  }
}

/**
 * Materialise a refined OperationGraph as a NEW sibling ai-panel layer placed
 * immediately above the prior layer in the stack. The prior layer is untouched.
 *
 * Throws if `priorLayerId` is not in the store.
 */
export function addRefinedAiPanelLayer(priorLayerId: string, graph: OperationGraph): void {
  const priorIndex = useEditorStore.getState().layers.findIndex((l) => l.id === priorLayerId);
  if (priorIndex === -1) {
    throw new Error(`addRefinedAiPanelLayer: unknown priorLayerId "${priorLayerId}"`);
  }

  addAiPanelLayer(graph);

  // addAiPanelLayer appended the new layer at the end of `layers`; move it
  // to just above the prior layer (priorIndex + 1).
  const newIndex = useEditorStore.getState().layers.length - 1;
  const targetIndex = priorIndex + 1;
  if (newIndex !== targetIndex) {
    useEditorStore.getState().reorderLayers(newIndex, targetIndex);
  }
}

/**
 * Restore every AI-sourced adjustment on the given ai-panel layer to its
 * binding default. Non-AI adjustments and non-ai-panel layers are ignored.
 * Recorded as a single undoable action.
 */
export function resetPanelToSuggestion(layerId: string): void {
  const store = useEditorStore.getState();
  const layer = store.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return;

  const bindingsByNode = new Map<string, typeof layer.panelBindings>();
  for (const b of layer.panelBindings) {
    const arr = bindingsByNode.get(b.nodeId) ?? [];
    arr.push(b);
    bindingsByNode.set(b.nodeId, arr);
  }

  // Group all param updates into one recordAction so it's a single undo step.
  editorDocument.recordAction('Reset to suggestion', () => {
    for (const adj of layer.adjustmentStack.adjustments) {
      const nodeId = adj.aiSource?.nodeId;
      if (!nodeId) continue;
      const bindings = bindingsByNode.get(nodeId);
      if (!bindings) continue;
      const nextParams: Record<string, number | Float32Array> = { ...adj.params };
      for (const b of bindings) {
        if (typeof b.default === 'number') nextParams[b.paramKey] = b.default;
      }
      useEditorStore.getState().updateAdjustmentParams(layerId, adj.id, nextParams);
    }
  });
}
