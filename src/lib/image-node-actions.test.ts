import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
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

// ─── Mocks for new dependencies added for the un-crop logic ───────────────

// pixelStore: tracked fake so tests can inspect calls and provide fake canvases.
// Use vi.hoisted so the object is initialised before vi.mock factories run.
const pixelStoreMock = vi.hoisted(() => ({
  _store: new Map<string, { w: number; h: number }>(),
  get(id: string) {
    const entry = this._store.get(id);
    if (!entry) return undefined;
    // Return a minimal fake OffscreenCanvas-like object.
    return { width: entry.w, height: entry.h } as unknown as OffscreenCanvas;
  },
  replaceSource: vi.fn((_id: string, _canvas: unknown) => {}),
  remove(_id: string) {},
  clear() { this._store.clear(); },
  has(id: string) { return this._store.has(id); },
  reset() {
    this._store.clear();
    this.replaceSource.mockClear();
  },
}));
vi.mock('@/core/pixel-store', () => ({ pixelStore: pixelStoreMock }));

// pixel-source-store: fire-and-forget IDB write — no-op in tests.
vi.mock('@/core/pixel-source-store', () => ({ putSource: vi.fn() }));

// Session id stores — return a stable id so persistCanvasSource proceeds.
vi.mock('@/hooks/useImageContext', () => ({
  useAiSession: { getState: () => ({ sessionId: 'test-session', reset: vi.fn() }) },
}));
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ sessionId: 'test-session', reset: vi.fn() }) },
}));

// OffscreenCanvas is not available in Node. Provide a minimal stub so the
// `new OffscreenCanvas(w, h)` call inside rejoinSourceImage doesn't throw.
// The stub records the dimensions set at construction time and supports
// getContext('2d') with a no-op drawImage.
class OffscreenCanvasStub {
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext(_: string) {
    return {
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    };
  }
  convertToBlob() { return Promise.resolve(new Blob()); }
}
// @ts-expect-error — OffscreenCanvas not in Node typings
globalThis.OffscreenCanvas = OffscreenCanvasStub;

import { rejoinSourceImage } from './image-node-actions';

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

  it('rejoins the cutout at its sourceOrigin offset — expands canvas to source size and clears sourceOrigin', () => {
    // Seed a 100×100 source and a 20×20 cutout extracted from (30, 40).
    // The cutout layer carries sourceOrigin:{x:30, y:40} and has a fake 20×20
    // canvas registered in pixelStoreMock.
    pixelStoreMock.reset();
    pixelStoreMock._store.set('L2', { w: 20, h: 20 }); // 20×20 cutout canvas

    useEditorStore.setState({
      imageNodes: {
        src: {
          id: 'src',
          layerIds: ['L1'],
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
          // sourceSize drives the full-canvas dimensions the un-crop expands to.
          sourceSize: { w: 100, h: 100 },
        },
        ext: {
          id: 'ext',
          layerIds: ['L2'],
          position: { x: 200, y: 0 },
          size: { w: 20, h: 20 },
          sourceSize: { w: 20, h: 20 },
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
          // sourceOrigin recorded at extract time.
          sourceOrigin: { x: 30, y: 40 },
        },
      ],
      activeLayerId: 'L2',
    });

    const result = rejoinSourceImage('ext');

    expect(result).toBe(true);

    // pixelStore.replaceSource must have been called for L2 with a 100×100 canvas.
    expect(pixelStoreMock.replaceSource).toHaveBeenCalledOnce();
    const [calledId, replacedCanvas] = pixelStoreMock.replaceSource.mock.calls[0] as [string, OffscreenCanvas];
    expect(calledId).toBe('L2');
    // The new canvas matches the source's sourceSize (100×100), not the cutout size.
    expect(replacedCanvas.width).toBe(100);
    expect(replacedCanvas.height).toBe(100);

    // sourceOrigin must be cleared on the layer after rejoin.
    const state = useEditorStore.getState();
    const l2 = state.layers.find((l) => l.id === 'L2');
    expect(l2?.sourceOrigin).toBeUndefined();

    // Standard merge assertions: ext gone, src has both layers.
    expect(state.imageNodes['ext']).toBeUndefined();
    expect(state.imageNodes['src'].layerIds).toContain('L1');
    expect(state.imageNodes['src'].layerIds).toContain('L2');
  });

  it('skips un-crop for layers without sourceOrigin (normal layers pass through unchanged)', () => {
    // L2 has no sourceOrigin — replaceSource should NOT be called for it.
    pixelStoreMock.reset();
    pixelStoreMock._store.set('L2', { w: 50, h: 50 });

    seedState(); // uses the default seedState which has no sourceOrigin on L2

    rejoinSourceImage('ext');

    expect(pixelStoreMock.replaceSource).not.toHaveBeenCalled();
  });

  it('skips un-crop gracefully when pixelStore has no entry for the layer', () => {
    // L2 has sourceOrigin but no canvas registered — should not throw.
    pixelStoreMock.reset();
    // Do NOT register L2 in pixelStoreMock._store.

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
          size: { w: 20, h: 20 },
          sourceSize: { w: 20, h: 20 },
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
          sourceOrigin: { x: 10, y: 20 },
        },
      ],
      activeLayerId: 'L2',
    });

    // Must not throw even though pixelStore.get('L2') returns undefined.
    expect(() => rejoinSourceImage('ext')).not.toThrow();
    // replaceSource must not have been called (we skipped that layer).
    expect(pixelStoreMock.replaceSource).not.toHaveBeenCalled();
  });
});
