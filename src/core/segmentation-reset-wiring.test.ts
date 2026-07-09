// @vitest-environment jsdom
/**
 * Wiring tests: closeDocument and openImage reset the client segmentation
 * state (SAM embedding caches, maskStore, objectOwnership). Without this,
 * `resetWorkspace()` restarting the node-id counter makes the next image's
 * `in-1` node inherit the PRIOR image's cached embedding and masks.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

const { mockReset } = vi.hoisted(() => ({ mockReset: vi.fn() }));

vi.mock('@/lib/segmentation/reset-client-state', () => ({
  resetSegmentationClientState: mockReset,
}));
vi.mock('@/lib/ai-client', () => ({
  createSession: vi.fn(async () => 'sid-1'),
  pushSessionContext: vi.fn(async () => {}),
}));

import { editorDocument } from './document';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { pixelStore } from './pixel-store';
import * as history from './history';

function jpegFile(name = 'test.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: 'image/jpeg',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  editorDocument.init(useEditorStore);
  pixelStore.clear();
  history.clear();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 600, close: () => {} } as unknown as ImageBitmap)),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return new Blob([], { type: 'image/jpeg' }); }
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  useEditorStore.getState().resetWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useBackendState.getState().reset();
  useAiSession.getState().reset();
});

describe('segmentation client-state reset', () => {
  it('closeDocument resets segmentation client state', () => {
    editorDocument.closeDocument();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('openImage resets segmentation client state before registering the new image', async () => {
    await editorDocument.openImage(jpegFile());
    expect(mockReset).toHaveBeenCalledTimes(1);
  });
});
