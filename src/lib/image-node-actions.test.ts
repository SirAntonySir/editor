import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { rejoinSourceImage } from './image-node-actions';
import { useEditorStore } from '@/store';

// image-node-actions imports `toast` — stub it out so we don't need the DOM.
vi.mock('@/components/ui/Toast', () => ({
  toast: { info: vi.fn() },
}));

// image-node-actions also imports `lib/export` which instantiates a canvas at
// module load time. Stub the whole module so we don't need a browser context.
vi.mock('@/lib/export', () => ({
  exportImage: vi.fn().mockResolvedValue(null),
  saveAs: vi.fn().mockResolvedValue(undefined),
}));

// editorDocument.workspace.mergeImageNodes / deleteImageNode go through
// `recordSnapshot` which captures history via `store`. The store is already
// real here (Zustand); we just need document to be initialised.
import { editorDocument } from '@/core/document';

function seedState() {
  useEditorStore.setState({
    imageNodes: {
      src: {
        id: 'src',
        layerIds: ['L1'],
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        sourceSize: { w: 100, h: 100 },
      },
      ext: {
        id: 'ext',
        layerIds: ['L2'],
        position: { x: 200, y: 0 },
        size: { w: 50, h: 50 },
        sourceSize: { w: 50, h: 50 },
        sourceImageNodeId: 'src',
      },
    },
    activeImageNodeId: 'ext',
    layers: [
      {
        id: 'L1',
        type: 'image',
        name: 'photo.jpg',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        order: 0,
      },
      {
        id: 'L2',
        type: 'image',
        name: 'cutout',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        order: 1,
      },
    ],
    activeLayerId: 'L2',
  });
}

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.getState().revertAll();
  vi.clearAllMocks();
  // Wire the document facade to the real store so recordSnapshot works.
  editorDocument.init(useEditorStore as Parameters<typeof editorDocument.init>[0]);
});

describe('rejoinSourceImage', () => {
  it('re-attaches the extracted node\'s image layers to the source node, then deletes the extracted node', () => {
    seedState();

    const result = rejoinSourceImage('ext');

    expect(result).toBe(true);
    const state = useEditorStore.getState();
    // Extracted node is gone.
    expect(state.imageNodes['ext']).toBeUndefined();
    // Source node now carries both layers.
    expect(state.imageNodes['src'].layerIds).toContain('L1');
    expect(state.imageNodes['src'].layerIds).toContain('L2');
    // L2 still exists in the layers list — NOT dropped by lifecycle cleanup.
    expect(state.layers.some((l) => l.id === 'L2')).toBe(true);
    // Focus moved back to source.
    expect(state.activeImageNodeId).toBe('src');
  });

  it('returns false when the node has no sourceImageNodeId', () => {
    useEditorStore.setState({
      imageNodes: {
        src: {
          id: 'src',
          layerIds: ['L1'],
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
          sourceSize: { w: 100, h: 100 },
        },
      },
      layers: [
        {
          id: 'L1',
          type: 'image',
          name: 'photo.jpg',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
        },
      ],
      activeImageNodeId: 'src',
    });

    expect(rejoinSourceImage('src')).toBe(false);
    // Nothing changed — source node is still there.
    expect(useEditorStore.getState().imageNodes['src']).toBeTruthy();
  });

  it('falls back to deleteImageNode when the source node no longer exists', () => {
    // ext points at a source that has already been deleted.
    useEditorStore.setState({
      imageNodes: {
        ext: {
          id: 'ext',
          layerIds: ['L2'],
          position: { x: 200, y: 0 },
          size: { w: 50, h: 50 },
          sourceSize: { w: 50, h: 50 },
          sourceImageNodeId: 'src',
        },
      },
      activeImageNodeId: 'ext',
      layers: [
        {
          id: 'L2',
          type: 'image',
          name: 'cutout',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
        },
      ],
      activeLayerId: 'L2',
    });

    // Should not throw even though 'src' is missing; falls back to close-document
    // or remove-node behavior (only one node → closeDocument path).
    expect(() => rejoinSourceImage('ext')).not.toThrow();
  });

  it('does not duplicate layers already present on the source', () => {
    // Edge case: L2 is somehow already on the source node (shouldn't happen in
    // practice, but the dedup guard must prevent it being added twice).
    useEditorStore.setState({
      imageNodes: {
        src: {
          id: 'src',
          layerIds: ['L1', 'L2'],
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
          sourceSize: { w: 100, h: 100 },
        },
        ext: {
          id: 'ext',
          layerIds: ['L2'],
          position: { x: 200, y: 0 },
          size: { w: 50, h: 50 },
          sourceSize: { w: 50, h: 50 },
          sourceImageNodeId: 'src',
        },
      },
      activeImageNodeId: 'ext',
      layers: [
        {
          id: 'L1',
          type: 'image',
          name: 'photo.jpg',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
        },
        {
          id: 'L2',
          type: 'image',
          name: 'cutout',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 1,
        },
      ],
      activeLayerId: 'L2',
    });

    rejoinSourceImage('ext');
    const state = useEditorStore.getState();
    // L2 should appear exactly once on the source.
    const l2Count = state.imageNodes['src'].layerIds.filter((id) => id === 'L2').length;
    expect(l2Count).toBe(1);
  });
});
