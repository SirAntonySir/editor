// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { editorDocument, _resetImageAddBurst } from './document';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { pixelStore } from './pixel-store';
import * as history from './history';

function jpegFile(name = 'test.jpg'): File {
  // Minimal blob — content doesn't matter because we stub createImageBitmap.
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: 'image/jpeg',
  });
}

describe('editorDocument.addImage', () => {
  beforeEach(() => {
    editorDocument.init(useEditorStore);
    pixelStore.clear();
    history.clear();

    // Stub createImageBitmap + OffscreenCanvas (jsdom doesn't ship either).
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 800,
        height: 600,
        close: () => {},
      } as unknown as ImageBitmap)),
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number; height: number;
        constructor(w: number, h: number) { this.width = w; this.height = h; }
        getContext() { return { drawImage: () => {} }; }
        // The upload path (downscale-for-upload) calls convertToBlob; stub it
        // so this test is self-contained rather than depending on a global
        // polyfill happening to be installed by another test file first.
        async convertToBlob() { return new Blob([], { type: 'image/jpeg' }); }
      },
    );
    // Stub fetch so the best-effort backend POST doesn't hit the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    // Reset workspace so each test starts with a clean slate.
    useEditorStore.getState().resetWorkspace();

    // Seed: one existing layer + one existing image node, as if a user
    // had opened the first image and a session is alive.
    useEditorStore.setState({
      layers: [{
        id: 'L1', type: 'image', name: 'first.jpg', visible: true,
        opacity: 1, blendMode: 'normal', locked: false, order: 0,
      }],
      activeLayerId: 'L1',
      activeImageNodeId: null,
      documentMeta: {
        id: 'doc', name: 'first', createdAt: 0, modifiedAt: 0,
        width: 800, height: 600,
      },
      isDirty: false,
    } as never);
    useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 }, { w: 800, h: 600 });
    useBackendState.getState().setSessionId('sid-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useBackendState.getState().reset();
  });

  it('appends a new layer (no replacement) and sets it active', async () => {
    const before = useEditorStore.getState().layers.length;
    await editorDocument.addImage(jpegFile('second.jpg'));
    const state = useEditorStore.getState();
    expect(state.layers).toHaveLength(before + 1);
    const newLayer = state.layers[state.layers.length - 1];
    expect(newLayer.name).toBe('second.jpg');
    expect(newLayer.type).toBe('image');
    expect(newLayer.visible).toBe(true);
    expect(newLayer.opacity).toBe(1);
    expect(newLayer.blendMode).toBe('normal');
    expect(newLayer.locked).toBe(false);
    expect(newLayer.order).toBe(before);
    expect(state.activeLayerId).toBe(newLayer.id);
  });

  it('adds a new image node placed to the right of existing nodes', async () => {
    const beforeNodes = Object.keys(useEditorStore.getState().imageNodes).length;
    await editorDocument.addImage(jpegFile());
    const state = useEditorStore.getState();
    const nodes = Object.values(state.imageNodes);
    expect(nodes).toHaveLength(beforeNodes + 1);
    // First existing node was at x=0 width=800-derived; new one must sit at maxRight+80.
    // We don't know the derived display width, only that the new node's x > existing.x.
    const existingNode = nodes.find((n) => n.layerIds.includes('L1'))!;
    const newNode = nodes.find((n) => !n.layerIds.includes('L1'))!;
    expect(newNode.position.x).toBe(existingNode.position.x + existingNode.size.w + 80);
    expect(newNode.position.y).toBe(0);
  });

  it('registers the new layer with pixelStore', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    await editorDocument.addImage(jpegFile());
    expect(registerSpy).toHaveBeenCalledTimes(1);
    const newLayerId = useEditorStore.getState().activeLayerId!;
    expect(registerSpy.mock.calls[0][0]).toBe(newLayerId);
  });

  it('pushes a history snapshot and marks the document dirty', async () => {
    const pushSpy = vi.spyOn(history, 'push');
    await editorDocument.addImage(jpegFile());
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('fires a best-effort POST to /api/session/:sid/images', async () => {
    await editorDocument.addImage(jpegFile());
    // The upload is fire-and-forget (addImage does not await it), so poll the
    // mock until the /images POST lands rather than reading synchronously —
    // otherwise the assertion races the upload's await chain.
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const uploadCall = calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/session/sid-123/images'),
      );
      expect(uploadCall).toBeDefined();
      expect((uploadCall![1] as RequestInit).method).toBe('POST');
    });
  });

  it('still creates the workspace node when no backend session exists', async () => {
    useBackendState.getState().reset();
    await editorDocument.addImage(jpegFile());
    expect(useEditorStore.getState().layers).toHaveLength(2);
    // fetch should not have been called for an /images upload when sid is null.
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const uploadCall = calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/images'),
    );
    expect(uploadCall).toBeUndefined();
  });

  // ─── Selection-preservation tests (Task 2.1) ────────────────────────

  it('activates the new node when nothing was active', async () => {
    // beforeEach leaves activeImageNodeId as null.
    expect(useEditorStore.getState().activeImageNodeId).toBeNull();
    await editorDocument.addImage(jpegFile('a.png'));
    expect(useEditorStore.getState().activeImageNodeId).not.toBeNull();
  });

  it('keeps existing image-node selection when a node is already active', async () => {
    // Activate the existing node that beforeEach planted.
    const existingNodeId = Object.keys(useEditorStore.getState().imageNodes)[0];
    useEditorStore.getState().setActiveImageNode(existingNodeId);
    expect(useEditorStore.getState().activeImageNodeId).toBe(existingNodeId);

    // Add a second image — must NOT steal selection.
    await editorDocument.addImage(jpegFile('b.png'));
    expect(useEditorStore.getState().activeImageNodeId).toBe(existingNodeId);
  });

  it('keeps existing layer selection when a node is already active', async () => {
    // Activate the existing node.
    const existingNodeId = Object.keys(useEditorStore.getState().imageNodes)[0];
    useEditorStore.getState().setActiveImageNode(existingNodeId);

    // Add a second image.
    await editorDocument.addImage(jpegFile('c.png'));

    // activeLayerId should remain 'L1' (the layer belonging to the active node).
    expect(useEditorStore.getState().activeLayerId).toBe('L1');
  });
});

// ─── Burst-coalesce toast tests (Task 2.2) ─────────────────────────────────

import { toast } from '@/components/ui/Toast';

function pixelFile(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: 'image/png',
  });
}

describe('addImage — burst toast', () => {
  let toastInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset burst-coalesce state BEFORE switching to fake timers, so any
    // pending real timer from earlier tests (e.g. 'keeps existing selection')
    // is cancelled and imageAddFlush is null when fake timers take over.
    _resetImageAddBurst();
    vi.useFakeTimers();

    // Spy on the shared toast singleton — this intercepts calls from document.ts
    // without needing a module-level vi.mock.
    toastInfoSpy = vi.spyOn(toast, 'info').mockImplementation(() => {});

    editorDocument.init(useEditorStore);
    pixelStore.clear();
    history.clear();

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 800,
        height: 600,
        close: () => {},
      } as unknown as ImageBitmap)),
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number; height: number;
        constructor(w: number, h: number) { this.width = w; this.height = h; }
        getContext() { return { drawImage: () => {} }; }
        // The upload path (downscale-for-upload) calls convertToBlob; stub it
        // so this test is self-contained rather than depending on a global
        // polyfill happening to be installed by another test file first.
        async convertToBlob() { return new Blob([], { type: 'image/jpeg' }); }
      },
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    useEditorStore.getState().resetWorkspace();

    // Seed: one existing layer + one existing image node so the second add
    // doesn't steal selection.
    useEditorStore.setState({
      layers: [{
        id: 'L1', type: 'image', name: 'first.jpg', visible: true,
        opacity: 1, blendMode: 'normal', locked: false, order: 0,
      }],
      activeLayerId: 'L1',
      activeImageNodeId: null,
      documentMeta: {
        id: 'doc', name: 'first', createdAt: 0, modifiedAt: 0,
        width: 800, height: 600,
      },
      isDirty: false,
    } as never);
    useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 }, { w: 800, h: 600 });
    useBackendState.getState().setSessionId('sid-123');

    // Activate the existing node so subsequent adds don't steal selection.
    const existingNodeId = Object.keys(useEditorStore.getState().imageNodes)[0];
    useEditorStore.getState().setActiveImageNode(existingNodeId);
  });

  afterEach(() => {
    toastInfoSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useBackendState.getState().reset();
  });

  it('emits a toast on non-stealing add', async () => {
    await editorDocument.addImage(pixelFile('b.png'));
    // Allow the burst window to flush.
    vi.advanceTimersByTime(300);
    expect(toastInfoSpy).toHaveBeenCalledWith(expect.stringMatching(/Image added/i));
  });

  it('coalesces a burst into one toast message', async () => {
    await Promise.all([
      editorDocument.addImage(pixelFile('b.png')),
      editorDocument.addImage(pixelFile('c.png')),
    ]);
    vi.advanceTimersByTime(300);
    expect(toastInfoSpy).toHaveBeenCalledTimes(1);
    expect(toastInfoSpy).toHaveBeenCalledWith(expect.stringMatching(/2 images added/i));
  });

  it('does NOT emit a toast when the new image steals selection', async () => {
    // Nothing is active — the first add should activate (not toast).
    useEditorStore.getState().setActiveImageNode(null as unknown as string);
    await editorDocument.addImage(pixelFile('a.png'));
    vi.advanceTimersByTime(300);
    expect(toastInfoSpy).not.toHaveBeenCalled();
  });
});
