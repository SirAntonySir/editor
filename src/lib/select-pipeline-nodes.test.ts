import { describe, it, expect, beforeEach } from 'vitest';
import { mergeOptimistic, toPipelineNode, matchesLayer } from './select-pipeline-nodes';
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
        sessionId: 's1',
        imageContext: null,
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
                paramKey: 'temperature',
                label: 'Temperature',
                controlType: 'slider',
                target: { nodeId: 'n1', paramKey: 'temperature' },
                controlSchema: { controlType: 'slider', min: 3000, max: 9000, step: 50 },
                value: 6500,
                default: 5500,
              },
            ],
            preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [],
            locked_params: [],
            createdAt: '2026-05-28T00:00:00Z',
            updatedAt: '2026-05-28T00:00:00Z',
          },
        ],
        masksIndex: [],
        operationGraph: {
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

  it('applies optimistic patches keyed by canonical node id', () => {
    const optimistic = new Map();
    // WidgetShell.canonIdFor returns the canonical node id (matches n.id in the
    // op_graph). Patches arrive here keyed by that, NOT by widget id.
    optimistic.set('n1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    const updated = out.find((n) => n.id === 'n1');
    expect(updated?.params.temperature).toBe(7800);
  });

  it('does not mutate unrelated nodes', () => {
    const optimistic = new Map();
    optimistic.set('n1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    const n2 = out.find((n) => n.id === 'n2');
    expect(n2?.params).toEqual({ exposure: 0.5, contrast: 10 });
  });

  it('ignores patches whose key does not match any node id', () => {
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7800 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    expect(out).toEqual(baseGraph.nodes);
  });
});

describe('matchesLayer', () => {
  const makeNode = (id: string, layerId?: string, layerIds?: string[]) => ({
    id,
    type: 'basic',
    scope: { kind: 'global' as const },
    params: {},
    inputs: [],
    ...(layerId !== undefined ? { layerId } : {}),
    ...(layerIds !== undefined ? { layerIds } : {}),
  });

  it('matches a node when n.layerId equals the target layer (single-layer pinned)', () => {
    const n = makeNode('n1', 'L1');
    expect(matchesLayer(n, 'L1')).toBe(true);
    expect(matchesLayer(n, 'L2')).toBe(false);
  });

  it('matches a node when n.layerIds includes the target layer (broadcast)', () => {
    // n1: layerId = 'L1' (single-layer pinned)
    const n1 = makeNode('n1', 'L1');
    // n2: layerId = 'anchor', layerIds = ['L1', 'L2'] (broadcast to L1 and L2)
    const n2 = makeNode('n2', 'anchor', ['L1', 'L2']);
    // n3: layerId = 'L3' (single-layer pinned, different layer)
    const n3 = makeNode('n3', 'L3');

    const allNodes = [n1, n2, n3];

    // selectPipelineNodes for L1 should return n1 and n2
    const forL1 = allNodes.filter((n) => matchesLayer(n, 'L1'));
    expect(forL1.map((n) => n.id)).toEqual(['n1', 'n2']);

    // selectPipelineNodes for L2 should return n2 (broadcast only)
    const forL2 = allNodes.filter((n) => matchesLayer(n, 'L2'));
    expect(forL2.map((n) => n.id)).toEqual(['n2']);

    // selectPipelineNodes for L3 should return n3
    const forL3 = allNodes.filter((n) => matchesLayer(n, 'L3'));
    expect(forL3.map((n) => n.id)).toEqual(['n3']);
  });

  it('matches the anchor layerId independently of layerIds', () => {
    const n = makeNode('n1', 'anchor', ['L1', 'L2']);
    expect(matchesLayer(n, 'anchor')).toBe(true);
    expect(matchesLayer(n, 'L1')).toBe(true);
    expect(matchesLayer(n, 'L2')).toBe(true);
    expect(matchesLayer(n, 'L3')).toBe(false);
  });

  it('does not match a node with no layerId and no layerIds', () => {
    const n = makeNode('n1');
    expect(matchesLayer(n, 'L1')).toBe(false);
  });

  it('does not match a node whose layerIds is defined but does not include the target', () => {
    const n = makeNode('n1', 'anchor', ['L2', 'L3']);
    expect(matchesLayer(n, 'L1')).toBe(false);
  });
});

