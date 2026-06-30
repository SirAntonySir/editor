import { it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { toast } from '@/components/ui/Toast';
import { pixelStore } from '@/core/pixel-store';

// The bake is WebGL/canvas — mock it out; we test the store orchestration only.
vi.mock('./image-node-renderer', () => ({ renderImageNodeComposite: vi.fn() }));

import { mergeVisibleLayersBody } from './merge-visible-layers';

function addLayer(id: string, visible = true) {
  useEditorStore.getState().addLayer({
    id, type: 'image', name: id, visible, opacity: 1, blendMode: 'normal', locked: false,
  });
}

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ layers: [], activeLayerId: null });
  // OffscreenCanvas 2d context is unavailable in jsdom — stub the bits the body uses.
  vi.stubGlobal('OffscreenCanvas', class {
    width: number; height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() { return { drawImage() {} }; }
  });
  vi.spyOn(pixelStore, 'register').mockImplementation(() => {});
});

it('no-ops with a toast when fewer than 2 layers are visible', () => {
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '' as never);
  addLayer('l1', true);
  addLayer('l2', false); // hidden
  const nodeId = useEditorStore.getState().addImageNode(['l1', 'l2'], { x: 0, y: 0 }, { w: 10, h: 10 });

  const merged = mergeVisibleLayersBody(nodeId);

  expect(merged).toBe(false);
  expect(info).toHaveBeenCalled();
  // No new layer, both originals intact.
  expect(useEditorStore.getState().layers.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
});

it('merges visible layers into one "Merged" layer and removes the originals', () => {
  addLayer('l1', true);
  addLayer('l2', true);
  const nodeId = useEditorStore.getState().addImageNode(['l1', 'l2'], { x: 0, y: 0 }, { w: 10, h: 10 });

  const merged = mergeVisibleLayersBody(nodeId);

  expect(merged).toBe(true);
  const s = useEditorStore.getState();
  // Originals gone; exactly one layer remains, named "Merged".
  expect(s.layers.some((l) => l.id === 'l1' || l.id === 'l2')).toBe(false);
  const mergedLayer = s.layers.find((l) => l.name === 'Merged');
  expect(mergedLayer).toBeDefined();
  // The node now points at just the merged layer.
  expect(s.imageNodes[nodeId].layerIds).toEqual([mergedLayer!.id]);
});

it('keeps a hidden layer when merging the visible ones', () => {
  addLayer('a', true);
  addLayer('h', false); // hidden, middle
  addLayer('b', true);
  const nodeId = useEditorStore.getState().addImageNode(['a', 'h', 'b'], { x: 0, y: 0 }, { w: 10, h: 10 });

  mergeVisibleLayersBody(nodeId);

  const s = useEditorStore.getState();
  expect(s.layers.some((l) => l.id === 'h')).toBe(true); // hidden survives
  const mergedLayer = s.layers.find((l) => l.name === 'Merged')!;
  // merged sits at the bottommost-visible slot, hidden stays in place
  expect(s.imageNodes[nodeId].layerIds).toEqual([mergedLayer.id, 'h']);
});
