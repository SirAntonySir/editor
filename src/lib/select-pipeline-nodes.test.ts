import { describe, it, expect, beforeEach } from 'vitest';
import { mergeOptimistic, toPipelineNode } from './select-pipeline-nodes';
import { useBackendState } from '@/store/backend-state-slice';
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
  beforeEach(() => {
    useBackendState.setState({
      snapshot: {
        session_id: 's1',
        image_context: null,
        widgets: [
          {
            id: 'w_1',
            intent: 'Warmer',
            scope: { kind: 'global' },
            origin: { kind: 'mcp_user_prompt', prompt: null },
            composed: false,
            nodes: [],
            status: 'active',
            revision: 1,
            bindings: [
              {
                param_key: 'temperature',
                label: 'Temperature',
                control_type: 'slider',
                target: { node_id: 'n1', param_key: 'temperature' },
                control_schema: { control_type: 'slider', min: 3000, max: 9000, step: 50 },
                value: 6500,
                default: 5500,
              },
            ],
            preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [],
            created_at: '2026-05-28T00:00:00Z',
            updated_at: '2026-05-28T00:00:00Z',
          },
        ],
        masks_index: [],
        operation_graph: {
          id: 'g1',
          userGoal: 'warmer',
          nodes: baseGraph.nodes,
          panelBindings: [],
          metadata: {},
        },
        revision: 1,
      },
    });
  });

  it('returns nodes unchanged when no optimistic patches', () => {
    const out = mergeOptimistic(baseGraph.nodes, new Map());
    expect(out).toEqual(baseGraph.nodes);
  });

  it('applies optimistic patches to the matching node params', () => {
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    const updated = out.find((n) => n.id === 'n1');
    expect(updated?.params.temperature).toBe(7800);
  });

  it('does not mutate unrelated nodes', () => {
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    const n2 = out.find((n) => n.id === 'n2');
    expect(n2?.params).toEqual({ exposure: 0.5, contrast: 10 });
  });

  it('returns nodes unchanged when no snapshot is present', () => {
    useBackendState.setState({ snapshot: null });
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    expect(out).toEqual(baseGraph.nodes);
  });
});
