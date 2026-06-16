// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { editorDocument } from './document';
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
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const uploadCall = calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/session/sid-123/images'),
    );
    expect(uploadCall).toBeDefined();
    expect((uploadCall![1] as RequestInit).method).toBe('POST');
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
