import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import {
  addAiPanelLayer,
  addRefinedAiPanelLayer,
  resetPanelToSuggestion,
} from './ai-panel-actions';
import type { OperationGraph } from '@/types/operation-graph';

function makeGraph(overrides: Partial<OperationGraph> = {}): OperationGraph {
  return {
    id: 'g-1',
    userGoal: 'make it warmer',
    reasoning: 'cool tones detected',
    nodes: [
      { id: 'n1', type: 'kelvin', scope: { kind: 'global' }, params: { temperature: 5800 }, inputs: [] },
    ],
    panelBindings: [
      {
        nodeId: 'n1',
        paramKey: 'temperature',
        label: 'warm cast',
        control: 'slider',
        min: 3000,
        max: 9000,
        default: 5800,
        step: 50,
        reasoning: 'binding-level reason',
      },
    ],
    metadata: {
      model_name: 'claude-opus-4-7',
      model_version: '2026-01',
      generated_at: '2026-05-15T00:00:00Z',
    },
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('addAiPanelLayer provenance', () => {
  it('attaches aiSource with per-binding reasoning + metadata timestamp', () => {
    addAiPanelLayer(makeGraph());
    const layer = useEditorStore.getState().layers[0];
    expect(layer.type).toBe('ai-panel');
    const adj = layer.adjustmentStack.adjustments[0];
    expect(adj.aiSource).toBeDefined();
    expect(adj.aiSource!.reasoning).toBe('binding-level reason');
    expect(adj.aiSource!.generatedAt).toBe('2026-05-15T00:00:00Z');
    expect(adj.aiSource!.modelName).toBe('claude-opus-4-7');
    expect(adj.aiSource!.modelVersion).toBe('2026-01');
    expect(adj.aiSource!.graphId).toBe('g-1');
    expect(adj.aiSource!.nodeId).toBe('n1');
    expect(adj.aiSource!.label).toBe('warm cast');
  });
});

describe('addRefinedAiPanelLayer', () => {
  it('inserts the new layer above the prior layer; prior untouched', () => {
    addAiPanelLayer(makeGraph({ id: 'g-1' }));
    const priorId = useEditorStore.getState().layers[0].id;

    addRefinedAiPanelLayer(priorId, makeGraph({ id: 'g-2', userGoal: 'subtler' }));

    const layers = useEditorStore.getState().layers;
    expect(layers).toHaveLength(2);
    const refined = layers.find((l) => l.operationGraph?.id === 'g-2')!;
    const prior = layers.find((l) => l.id === priorId)!;

    expect(refined.order).toBeGreaterThan(prior.order);
    expect(prior.operationGraph?.id).toBe('g-1');
    expect(prior.adjustmentStack.adjustments[0].aiSource?.graphId).toBe('g-1');
  });

  it('throws if priorLayerId is unknown', () => {
    expect(() => addRefinedAiPanelLayer('nope', makeGraph())).toThrow(/unknown/i);
  });
});

describe('resetPanelToSuggestion', () => {
  it('restores each adjustment param to its binding default', () => {
    addAiPanelLayer(makeGraph());
    const layerId = useEditorStore.getState().layers[0].id;
    const layer = useEditorStore.getState().layers[0];
    const adjId = layer.adjustmentStack.adjustments[0].id;

    useEditorStore.getState().updateAdjustmentParams(layerId, adjId, { temperature: 9000 });
    expect(
      useEditorStore.getState().layers[0].adjustmentStack.adjustments[0].params.temperature,
    ).toBe(9000);

    resetPanelToSuggestion(layerId);

    expect(
      useEditorStore.getState().layers[0].adjustmentStack.adjustments[0].params.temperature,
    ).toBe(5800);
  });

  it('is a no-op for non-ai-panel layers', () => {
    useEditorStore.getState().addLayer({
      id: 'plain',
      type: 'image',
      name: 'Plain',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(() => resetPanelToSuggestion('plain')).not.toThrow();
  });
});
