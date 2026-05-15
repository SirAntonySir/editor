import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSmartTarget, humanLabelFor } from './target-ref';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  useGraphStore.setState({
    selectedNodeId: null,
  } as unknown as Parameters<typeof useGraphStore.setState>[0]);
});

describe('resolveSmartTarget', () => {
  it('returns composite when no selection and no layers', () => {
    expect(resolveSmartTarget()).toEqual({ kind: 'composite' });
  });

  it('returns the active layer when nothing is selected in the graph', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.setState({ activeLayerId: 'L1' } as never);

    expect(resolveSmartTarget()).toEqual({ kind: 'layer', layerId: 'L1' });
  });

  it('returns the node when a graph node is selected', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1',
      type: 'kelvin',
      name: 'White balance',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: { temperature: 5500 },
    });
    useGraphStore.setState({ selectedNodeId: 'A1' } as never);

    expect(resolveSmartTarget()).toEqual({
      kind: 'node',
      layerId: 'L1',
      adjustmentId: 'A1',
    });
  });

  it('falls back to composite when selectedNodeId does not match any adjustment', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useGraphStore.setState({ selectedNodeId: 'ghost' } as never);

    expect(resolveSmartTarget()).toEqual({ kind: 'layer', layerId: 'L1' });
  });
});

describe('humanLabelFor', () => {
  it('labels composite', () => {
    expect(humanLabelFor({ kind: 'composite' })).toBe('Whole composite');
  });

  it('labels a layer by its name', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(humanLabelFor({ kind: 'layer', layerId: 'L1' })).toBe('Portrait');
  });

  it('labels a node by adjustment name on its layer', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Portrait',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.getState().addAdjustment('L1', {
      id: 'A1',
      type: 'kelvin',
      name: 'White balance',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    });
    expect(humanLabelFor({ kind: 'node', layerId: 'L1', adjustmentId: 'A1' })).toBe(
      'Portrait · White balance',
    );
  });

  it('falls back to "Unknown target" when references go stale', () => {
    expect(humanLabelFor({ kind: 'layer', layerId: 'gone' })).toBe('Unknown target');
  });
});
