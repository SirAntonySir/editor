// src/store/segment-actions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

// LayerCompositor's module-level singleton calls document.createElement on
// load; in this Node test environment there's no DOM, so stub the module.
vi.mock('@/lib/layer-compositor', () => ({
  LayerCompositor: {
    renderLayer: () => null,
    subscribe: () => () => {},
  },
}));

const { extractLayerFromMask, duplicateLayer } = await import('./segment-actions');

beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
    activeMaskRef: null,
    committedMaskRef: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  maskStore.clear();
});

// Happy-path extraction (and duplication) is exercised in browser-only flows
// because both rely on OffscreenCanvas, which is not available in the Node
// test environment. The tests below cover the metadata + error paths.

describe('extractLayerFromMask', () => {
  it('throws when the source layer is missing', () => {
    const maskRef = maskStore.register({
      layerId: 'missing',
      width: 4,
      height: 4,
      data: new Uint8Array(16).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });
    expect(() =>
      extractLayerFromMask({ sourceLayerId: 'missing', maskRef }),
    ).toThrow(/layer .* not found/);
  });

  it('throws when the mask is missing', () => {
    useEditorStore.getState().addLayer({
      id: 'L1',
      type: 'image',
      name: 'Source',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(() =>
      extractLayerFromMask({ sourceLayerId: 'L1', maskRef: 'nope' as never }),
    ).toThrow(/mask .* not found/);
  });
});

describe('duplicateLayer', () => {
  it('returns null when the source layer is missing', () => {
    expect(duplicateLayer('missing')).toBeNull();
  });
});
