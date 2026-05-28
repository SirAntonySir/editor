import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLayerWidgets } from './useLayerWidgets';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w1',
    intent: 'Curves',
    scope: { kind: 'global' },
    origin: { kind: 'tool_invoked' },
    composed: false,
    bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [],
    status: 'accepted',
    revision: 1,
    created_at: '',
    updated_at: '',
    nodes: [{
      id: 'n1', type: 'curves', scope: { kind: 'global' },
      params: { intensity: 0.5 }, inputs: [],
      widget_id: 'w1', layer_id: 'L1',
    }],
    ...overrides,
  };
}

function setSnapshot(widgets: Widget[]): void {
  const nodes = widgets.flatMap((w) => w.nodes);
  useBackendState.getState().setSnapshot({
    session_id: 's',
    image_context: null,
    widgets,
    masks_index: [],
    operation_graph: {
      id: 'g',
      userGoal: '',
      nodes,
      panelBindings: [],
      metadata: {},
    },
    revision: 1,
  });
}

describe('useLayerWidgets', () => {
  beforeEach(() => {
    useBackendState.getState().reset();
  });

  it('returns widgets whose nodes target the given layer', () => {
    setSnapshot([makeWidget()]);
    const { result } = renderHook(() => useLayerWidgets('L1'));
    expect(result.current.map((w) => w.id)).toEqual(['w1']);
  });

  it('excludes widgets with no nodes on the layer', () => {
    setSnapshot([makeWidget()]);
    const { result } = renderHook(() => useLayerWidgets('OTHER'));
    expect(result.current).toEqual([]);
  });

  it('returns empty when snapshot is null', () => {
    useBackendState.getState().reset();
    const { result } = renderHook(() => useLayerWidgets('L1'));
    expect(result.current).toEqual([]);
  });

  it('returns empty when layerId is null', () => {
    setSnapshot([makeWidget()]);
    const { result } = renderHook(() => useLayerWidgets(null));
    expect(result.current).toEqual([]);
  });

  it('excludes dismissed widgets', () => {
    setSnapshot([makeWidget({ status: 'dismissed' })]);
    const { result } = renderHook(() => useLayerWidgets('L1'));
    expect(result.current).toEqual([]);
  });
});
