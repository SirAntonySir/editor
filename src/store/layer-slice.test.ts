// src/store/layer-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

function seedLayerWithAdjustments() {
  useEditorStore.getState().addLayer({
    id: 'L1',
    type: 'image',
    name: 'Portrait',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });
  for (const id of ['A', 'B', 'C']) {
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

describe('insertAdjustment', () => {
  it('inserts at the requested index, shifting subsequent adjustments', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'X',
      type: 'kelvin',
      name: 'X',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 1);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['A', 'X', 'B', 'C']);
  });

  it('appends when atIndex is past the end', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'Y',
      type: 'kelvin',
      name: 'Y',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 99);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['A', 'B', 'C', 'Y']);
  });

  it('prepends when atIndex is 0', () => {
    seedLayerWithAdjustments();
    useEditorStore.getState().insertAdjustment('L1', {
      id: 'Z',
      type: 'kelvin',
      name: 'Z',
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: {},
    }, 0);

    const ids = useEditorStore
      .getState()
      .layers[0]
      .adjustmentStack.adjustments.map((a) => a.id);
    expect(ids).toEqual(['Z', 'A', 'B', 'C']);
  });
});

describe('aiSteps map', () => {
  it('is undefined by default on new layers', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'X',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(useEditorStore.getState().layers[0].aiSteps).toBeUndefined();
  });
});

describe('Layer.parentLayerId + Layer.layerMask', () => {
  it('accepts new optional fields on addLayer', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'Branch',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
      layerMask: 'mask-1',
    });
    const layers = useEditorStore.getState().layers;
    const branch = layers.find((l) => l.id === 'L2')!;
    expect(branch.parentLayerId).toBe('L1');
    expect(branch.layerMask).toBe('mask-1');
  });

  it('rejects a layer whose parentLayerId would create a cycle', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'A',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'B',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
    });
    expect(() => {
      useEditorStore.getState().updateLayer('L1', { parentLayerId: 'L2' });
    }).toThrow(/cycle/i);
  });

  it('blocks removeLayer for a layer that has children', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'parent',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'L2', type: 'image', name: 'child',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
      parentLayerId: 'L1',
    });
    expect(() => useEditorStore.getState().removeLayer('L1')).toThrow(/has child/i);
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeDefined();
  });

  it('rejects addLayer with a non-existent parentLayerId', () => {
    expect(() => {
      useEditorStore.getState().addLayer({
        id: 'L3', type: 'image', name: 'orphan',
        visible: true, opacity: 1, blendMode: 'normal', locked: false,
        parentLayerId: 'never-existed',
      });
    }).toThrow(/does not exist/i);
  });
});
