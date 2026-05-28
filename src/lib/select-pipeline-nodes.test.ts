import { describe, it, expect } from 'vitest';
import { mergeOptimistic, toPipelineNode } from './select-pipeline-nodes';
import type { OperationGraph } from '@/types/operation-graph';

const baseGraph: OperationGraph = {
  id: 'g1',
  userGoal: 'warmer',
  reasoning: undefined,
  nodes: [
    { id: 'n1', type: 'kelvin', scope: { kind: 'global' }, params: { temperature: 6500 }, inputs: [] },
    { id: 'n2', type: 'basic', scope: { kind: 'global' }, params: { exposure: 0.5, contrast: 10 }, inputs: [] },
  ],
  panelBindings: [],
  metadata: {},
};

describe('toPipelineNode', () => {
  it('maps node shape verbatim', () => {
    const out = toPipelineNode(baseGraph.nodes[0]);
    expect(out.id).toBe('n1');
    expect(out.type).toBe('kelvin');
    expect(out.params).toEqual({ temperature: 6500 });
    expect(out.scope).toEqual({ kind: 'global' });
  });
});

describe('mergeOptimistic', () => {
  it('returns nodes unchanged when no optimistic patches', () => {
    const out = mergeOptimistic(baseGraph.nodes, new Map());
    expect(out).toEqual(baseGraph.nodes);
  });

  // mergeOptimistic in v1 is a stub — optimistic patches target binding
  // values per widget, but the projected graph is a flat node list. The
  // mapping from binding paramKey to a specific node param happens via
  // the binding's `target` (node_id + param_key); since the slider widget
  // owns this lookup directly, mergeOptimistic at the graph layer is a
  // pass-through for v1. Future work: rebuild the merger if optimistic
  // updates need to feed the WebGL pipeline through this path instead.
  it('is a pass-through in v1', () => {
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7000 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    expect(out).toEqual(baseGraph.nodes);
  });
});
