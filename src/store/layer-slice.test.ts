// src/store/layer-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
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
