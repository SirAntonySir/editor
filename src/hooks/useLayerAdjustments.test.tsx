import { renderHook } from '@testing-library/react';
import { it, expect, describe, beforeEach } from 'vitest';
import { registerAllProcessing } from '@/processing';
import { useBackendState } from '@/store/backend-state-slice';
import { useLayerAdjustments } from './useLayerAdjustments';

registerAllProcessing();

interface SeedArgs {
  nodes?: { id: string; type: string; layerId: string; params: Record<string, unknown> }[];
  widgets?: unknown[];
}

function seed({ nodes = [], widgets = [] }: SeedArgs) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      sessionId: 's1', imageContext: null, widgets: widgets as never, masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
      revision: 1,
    } as never,
    optimistic: new Map(),
  } as never);
}

function widget(id: string, over: Record<string, unknown> = {}): unknown {
  const { layerId, layerIds, ...rest } = over as {
    layerId?: string; layerIds?: string[];
  } & Record<string, unknown>;
  return {
    id,
    displayName: `Widget ${id}`,
    intent: 'test intent',
    status: 'active',
    category: 'color',
    // Target layers live on the widget's NODES (layerIds ?? [layerId]).
    nodes: [{ id: `${id}-n1`, type: 'basic', params: {}, layerId: layerId ?? 'L1', layerIds }],
    ...rest,
  };
}

beforeEach(() => {
  seed({});
});

describe('canonical entries', () => {
  it('lists a touched canonical op with its def label and id', () => {
    seed({ nodes: [{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 0.4 } }] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    const entry = result.current.find((e) => e.kind === 'canonical');
    expect(entry).toBeTruthy();
    expect(entry!.defId).toBe('light');
    expect(entry!.op).toBe('basic');
    expect(entry!.label).toBe('Light');
    expect(entry!.id).toBe('canon:L1:basic');
  });

  it('skips canonical nodes where every param is at its default', () => {
    seed({ nodes: [{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 0 } }] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current).toEqual([]);
  });

  it('ignores canonical nodes of other layers', () => {
    seed({ nodes: [{ id: 'canon:L2:basic', type: 'basic', layerId: 'L2', params: { exposure: 0.4 } }] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current).toEqual([]);
  });

  it('treats a non-identity curves channel as touched', () => {
    seed({
      nodes: [{
        id: 'canon:L1:curves', type: 'curves', layerId: 'L1',
        params: { rgb: [[0, 20], [255, 255]] },
      }],
    });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current.map((e) => e.defId)).toEqual(['curves']);
  });

  it('treats identity-ramp curves as untouched', () => {
    seed({
      nodes: [{
        id: 'canon:L1:curves', type: 'curves', layerId: 'L1',
        params: { rgb: [[0, 0], [255, 255]] },
      }],
    });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current).toEqual([]);
  });

  it('carries touched params with values and reset values for move/copy', () => {
    seed({ nodes: [{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 0.4, contrast: 0 } }] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    const entry = result.current[0];
    expect(entry.touchedParams).toEqual([{ key: 'exposure', value: 0.4, resetValue: 0 }]);
  });
});

describe('widget entries', () => {
  it('lists an active widget targeting this layer', () => {
    seed({ widgets: [widget('w1')] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      kind: 'widget', id: 'w1', label: 'Widget w1', targetLayerIds: ['L1'],
    });
  });

  it('resolves multi-layer targets via layerIds', () => {
    seed({ widgets: [widget('w1', { layerIds: ['L1', 'L2'] })] });
    const { result } = renderHook(() => useLayerAdjustments('L2'));
    expect(result.current[0]?.targetLayerIds).toEqual(['L1', 'L2']);
  });

  it('excludes widgets not targeting this layer and dismissed widgets', () => {
    seed({
      widgets: [
        widget('w1', { layerId: 'L2' }),
        widget('w2', { status: 'dismissed' }),
      ],
    });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current).toEqual([]);
  });

  it('includes accepted widgets — they still shape the layer', () => {
    seed({ widgets: [widget('w1', { status: 'accepted' })] });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current.map((e) => e.id)).toEqual(['w1']);
  });

  it('yields one entry per def when two defs share an adjustmentType', () => {
    // light + color both project to canon:<layer>:basic — each def only
    // reports its OWN touched params, and the entries stay distinguishable.
    seed({
      nodes: [{
        id: 'canon:L1:basic', type: 'basic', layerId: 'L1',
        params: { exposure: 0.4, saturation: -21 },
      }],
    });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current.map((e) => e.defId).sort()).toEqual(['color', 'light']);
    const light = result.current.find((e) => e.defId === 'light')!;
    const color = result.current.find((e) => e.defId === 'color')!;
    expect(light.touchedParams).toEqual([{ key: 'exposure', value: 0.4, resetValue: 0 }]);
    expect(color.touchedParams).toEqual([{ key: 'saturation', value: -21, resetValue: 0 }]);
  });

  it('orders canonical entries before widget entries', () => {
    seed({
      nodes: [{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 0.4 } }],
      widgets: [widget('w1')],
    });
    const { result } = renderHook(() => useLayerAdjustments('L1'));
    expect(result.current.map((e) => e.kind)).toEqual(['canonical', 'widget']);
  });
});
