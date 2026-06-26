import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initLayerLifecycle } from './layer-lifecycle';
import { useEditorStore } from '@/store';
import { maskStore } from './mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

function addLayer(id: string) {
  useEditorStore.getState().addLayer({
    id,
    type: 'raster',
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });
}

function registerMaskOnLayer(id: string, layerId: string) {
  maskStore.injectWithId({
    id,
    layerId,
    label: id,
    width: 1,
    height: 1,
    data: new Uint8Array([0]),
    source: 'sam-point',
    createdAt: 0,
  });
}

let stop: (() => void) | null = null;

describe('layer lifecycle — mask cleanup', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
    maskStore.clear();
    objectOwnership._resetForTests();
  });
  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('removes masks belonging to a layer when that layer is removed', () => {
    addLayer('l1');
    registerMaskOnLayer('m1', 'l1');
    objectOwnership.set('m1', 'node-1');
    stop = initLayerLifecycle();

    useEditorStore.getState().removeLayer('l1');

    expect(maskStore.get('m1')).toBeUndefined();
    expect(objectOwnership.get('m1')).toBeUndefined();
  });

  it('leaves masks on surviving layers untouched', () => {
    addLayer('l1');
    addLayer('l2');
    registerMaskOnLayer('m1', 'l1');
    registerMaskOnLayer('m2', 'l2');
    stop = initLayerLifecycle();

    useEditorStore.getState().removeLayer('l1');

    expect(maskStore.get('m1')).toBeUndefined();
    expect(maskStore.get('m2')).toBeDefined();
  });

  it('clears activeObjectId when the active object lived on the removed layer', () => {
    addLayer('l1');
    registerMaskOnLayer('m1', 'l1');
    useEditorStore.getState().setActiveObjectId('m1');
    stop = initLayerLifecycle();

    useEditorStore.getState().removeLayer('l1');

    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });
});
