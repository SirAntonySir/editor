// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { editorDocument } from './document';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { pixelStore } from './pixel-store';
import * as history from './history';

function jpegFile(name = 'test.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: 'image/jpeg' });
}

describe('editorDocument.openImage over an existing image', () => {
  beforeEach(() => {
    editorDocument.init(useEditorStore);
    pixelStore.clear();
    history.clear();

    vi.stubGlobal('createImageBitmap', vi.fn(async () => (
      { width: 800, height: 600, close: () => {} } as unknown as ImageBitmap
    )));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return new Blob([], { type: 'image/jpeg' }); }
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    // Seed the "an image is already on the canvas" state: one layer + one node.
    useEditorStore.getState().resetWorkspace();
    useEditorStore.setState({
      layers: [{
        id: 'L1', type: 'image', name: 'first.jpg', visible: true,
        opacity: 1, blendMode: 'normal', locked: false, order: 0,
      }],
      activeLayerId: 'L1',
      documentMeta: { id: 'doc', name: 'first', createdAt: 0, modifiedAt: 0, width: 800, height: 600 },
      isDirty: false,
    } as never);
    useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 }, { w: 800, h: 600 });
    useBackendState.getState().setSessionId('sid-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useBackendState.getState().reset();
    useAiSession.getState().reset();
  });

  it('clears the stale workspace node so the auto-mount can spawn the new image', async () => {
    expect(Object.keys(useEditorStore.getState().imageNodes)).toHaveLength(1);

    await editorDocument.openImage(jpegFile('second.jpg'));

    const state = useEditorStore.getState();
    // The old node referenced 'L1'; openImage replaced the layer, so the stale
    // node MUST be cleared. CanvasWorkspace's auto-mount is gated on imageNodes
    // being empty, so leaving the old node behind blocks the new image from
    // ever spawning (and the old node renders nothing — its layer is gone).
    expect(Object.keys(state.imageNodes)).toHaveLength(0);

    // A single fresh layer replaced 'L1'.
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].id).not.toBe('L1');
    expect(state.layers[0].name).toBe('second.jpg');
  });

  it('resets the backend session so a stale analyzed snapshot cannot block auto-analyze', async () => {
    // Simulate the first image already analyzed: a snapshot carrying an
    // imageContext lingers in useBackendState. autoAnalyseImageOnLoad reads this
    // synchronously via awaitFirstSnapshot, and its `imageContext != null` gate
    // would skip the new image's analysis. openImage must tear the old session
    // down (like closeDocument) so the fresh session drives auto-analyze.
    useBackendState.setState({
      sessionId: 'old-sid',
      snapshot: { imageContext: { tones: [] } } as never,
    });

    await editorDocument.openImage(jpegFile('second.jpg'));

    expect(useBackendState.getState().snapshot).toBeNull();
    expect(useBackendState.getState().sessionId).toBeNull();
  });
});
