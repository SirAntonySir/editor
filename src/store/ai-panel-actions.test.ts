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

import {
  addAiStepNode,
  refineAiStepNode,
} from './ai-panel-actions';
import type { TargetRef } from '@/types/ai-target';

function seedHostLayer() {
  useEditorStore.getState().addLayer({
    id: 'L1',
    type: 'image',
    name: 'Portrait',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });
  for (const id of ['existing-1', 'existing-2']) {
    useEditorStore.getState().addAdjustment('L1', {
      id,
      type: 'kelvin',
      name: id,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    });
  }
}

describe('addAiStepNode', () => {
  it('appends an ai-step to a layer target (end of chain)', () => {
    seedHostLayer();
    const target: TargetRef = { kind: 'layer', layerId: 'L1' };
    addAiStepNode(target, makeGraph({ id: 'g-1' }));

    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    expect(ids[0]).toBe('existing-1');
    expect(ids[1]).toBe('existing-2');
    // step adjustments come last; one per OperationGraph node
    expect(ids.length).toBe(3);
    const last = useEditorStore.getState().layers[0].adjustmentStack.adjustments.at(-1)!;
    expect(last.aiSource?.graphId).toBe('g-1');
  });

  it('inserts immediately after a node target', () => {
    seedHostLayer();
    const target: TargetRef = {
      kind: 'node',
      layerId: 'L1',
      adjustmentId: 'existing-1',
    };
    addAiStepNode(target, makeGraph({ id: 'g-1' }));

    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    // expected order: existing-1, <ai>, existing-2
    expect(ids[0]).toBe('existing-1');
    expect(ids[2]).toBe('existing-2');
    expect(ids.length).toBe(3);
  });

  it('records aiSteps metadata on the host layer keyed by graphId', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'layer', layerId: 'L1' }, makeGraph({ id: 'g-1' }));
    const layer = useEditorStore.getState().layers[0];
    expect(layer.aiSteps?.['g-1']).toBeDefined();
    expect(layer.aiSteps?.['g-1'].panelBindings[0].nodeId).toBe('n1');
    expect(layer.aiSteps?.['g-1'].originTargetRef).toEqual({ kind: 'layer', layerId: 'L1' });
  });

  it('appends to the topmost layer when target is composite', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'composite' }, makeGraph({ id: 'g-1' }));
    const ids = useEditorStore.getState().layers[0].adjustmentStack.adjustments.map((a) => a.id);
    expect(ids.length).toBe(3);
    expect(ids.at(-1)!.startsWith('ai-step-')).toBe(true);
  });
});

describe('refineAiStepNode', () => {
  it('appends the refined step downstream of the prior step', () => {
    seedHostLayer();
    addAiStepNode({ kind: 'layer', layerId: 'L1' }, makeGraph({ id: 'g-1' }));
    refineAiStepNode('L1', 'g-1', makeGraph({ id: 'g-2', userGoal: 'subtler' }));

    const adjustments = useEditorStore.getState().layers[0].adjustmentStack.adjustments;
    const g1Idx = adjustments.findIndex((a) => a.aiSource?.graphId === 'g-1');
    const g2Idx = adjustments.findIndex((a) => a.aiSource?.graphId === 'g-2');
    expect(g2Idx).toBeGreaterThan(g1Idx);
    expect(useEditorStore.getState().layers[0].aiSteps?.['g-2']).toBeDefined();
  });
});
