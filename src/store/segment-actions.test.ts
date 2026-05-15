// src/store/segment-actions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from './segment-actions';

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
    activeMaskRef: null,
    committedMaskRef: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  maskStore.clear();
});

describe('extractLayerFromMask', () => {
  it('creates a new layer with parentLayerId + layerMask set', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    const maskRef = maskStore.register({
      layerId: 'L1', width: 10, height: 10, data: new Uint8Array(100).fill(255),
      source: 'sam-point', createdAt: 0, label: 'subject',
    });
    const newId = extractLayerFromMask({ sourceLayerId: 'L1', maskRef });
    const layers = useEditorStore.getState().layers;
    const child = layers.find((l) => l.id === newId)!;
    expect(child.parentLayerId).toBe('L1');
    expect(child.layerMask).toBe(maskRef);
    expect(child.name).toContain('subject');
  });

  it('sets the new layer as active', () => {
    useEditorStore.getState().addLayer({
      id: 'L1', type: 'image', name: 'Source',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    const maskRef = maskStore.register({
      layerId: 'L1', width: 10, height: 10, data: new Uint8Array(100),
      source: 'sam-point', createdAt: 0,
    });
    const newId = extractLayerFromMask({ sourceLayerId: 'L1', maskRef });
    expect(useEditorStore.getState().activeLayerId).toBe(newId);
  });
});
