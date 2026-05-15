import { useEditorStore } from '@/store';
import type { Adjustment, AiStepMeta } from '@/store/layer-slice';
import type { OperationGraph } from '@/types/operation-graph';
import type { TargetRef } from '@/types/ai-target';
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

// ---------------------------------------------------------------------------
// addAiStepNode / refineAiStepNode
// ---------------------------------------------------------------------------

let aiStepCounter = 0;

function pickHostLayerId(target: TargetRef): string | null {
  const editor = useEditorStore.getState();
  if (target.kind === 'layer' || target.kind === 'node') {
    return editor.layers.find((l) => l.id === target.layerId)?.id ?? null;
  }
  // composite → topmost layer
  return editor.layers.at(-1)?.id ?? null;
}

function insertionIndexFor(target: TargetRef, hostLayerId: string): number {
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === hostLayerId);
  if (!layer) return 0;
  if (target.kind === 'node') {
    const idx = layer.adjustmentStack.adjustments.findIndex((a) => a.id === target.adjustmentId);
    return idx >= 0 ? idx + 1 : layer.adjustmentStack.adjustments.length;
  }
  // layer or composite → append
  return layer.adjustmentStack.adjustments.length;
}

/**
 * Insert the nodes of an OperationGraph as adjustments at the target position
 * within the target's host layer. Each adjustment is tagged with `aiSource`
 * provenance and grouped by `graphId`. Step metadata is recorded on the layer
 * under `aiSteps[graph.id]`.
 */
export function addAiStepNode(target: TargetRef, graph: OperationGraph): void {
  console.log('[OperationGraph] addAiStepNode', target, graph);
  const hostLayerId = pickHostLayerId(target);
  if (!hostLayerId) {
    throw new Error('addAiStepNode: no host layer found for target');
  }

  // Record per-step metadata on the host layer using the existing updateLayer action.
  const layer = useEditorStore.getState().layers.find((l) => l.id === hostLayerId);
  if (!layer) {
    throw new Error(`addAiStepNode: host layer "${hostLayerId}" not found`);
  }
  const stepMeta: AiStepMeta = {
    graphId: graph.id,
    operationGraph: graph,
    panelBindings: graph.panelBindings,
    originTargetRef: target,
  };
  useEditorStore.getState().updateLayer(hostLayerId, {
    aiSteps: { ...(layer.aiSteps ?? {}), [graph.id]: stepMeta },
  });

  // Insert one adjustment per OperationGraph node at the target index.
  let cursor = insertionIndexFor(target, hostLayerId);
  for (const node of graph.nodes) {
    const firstBinding = graph.panelBindings.find((b) => b.nodeId === node.id);
    const label = firstBinding?.label ?? node.type;
    const adjustmentId = `ai-step-${graph.id}-${node.id}-${++aiStepCounter}`;
    const adjustment: Adjustment = {
      id: adjustmentId,
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
    useEditorStore.getState().insertAdjustment(hostLayerId, adjustment, cursor);
    cursor += 1;
  }
}

/**
 * Append a refined OperationGraph immediately downstream of the last adjustment
 * belonging to `priorGraphId` on `hostLayerId`. The prior step is untouched.
 *
 * Throws if `hostLayerId` or `priorGraphId` is not found.
 */
export function refineAiStepNode(
  hostLayerId: string,
  priorGraphId: string,
  graph: OperationGraph,
): void {
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === hostLayerId);
  if (!layer) {
    throw new Error(`refineAiStepNode: unknown hostLayerId "${hostLayerId}"`);
  }
  // Find the LAST adjustment in the prior step, then insert immediately after it.
  const adjustments = layer.adjustmentStack.adjustments;
  let lastIdx = -1;
  for (let i = adjustments.length - 1; i >= 0; i--) {
    if (adjustments[i].aiSource?.graphId === priorGraphId) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) {
    throw new Error(`refineAiStepNode: priorGraphId "${priorGraphId}" not found on layer`);
  }

  const anchorAdjustment = adjustments[lastIdx];
  addAiStepNode(
    { kind: 'node', layerId: hostLayerId, adjustmentId: anchorAdjustment.id },
    graph,
  );
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
