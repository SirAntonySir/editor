// @vitest-environment jsdom
/**
 * Wiring tests: openImage and addImage fire autoAnalyseImageOnLoad after
 * their backend bootstrap/upload resolves — fire-and-forget, never blocking
 * the visible image-open path. Reloads don't run these paths at all, so
 * auto-analyze stays a user-load-only behavior by construction.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

const mockAutoAnalyse = vi.fn(async () => {});

vi.mock('@/hooks/useImageContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useImageContext')>();
  return {
    ...actual,
    autoAnalyseImageOnLoad: (...args: unknown[]) => mockAutoAnalyse(...args),
  };
});

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

describe('openImage → auto-analyze', () => {
  it('fires autoAnalyseImageOnLoad after the session bootstrap resolves', async () => {
    await editorDocument.openImage(jpegFile('first.jpg'));
    await vi.waitFor(() => {
      expect(mockAutoAnalyse).toHaveBeenCalledTimes(1);
    });
  });
});

describe('addImage → auto-analyze', () => {
  it('fires autoAnalyseImageOnLoad after the backend upload resolves', async () => {
    // Seed a live session like the add-image tests do.
    useEditorStore.setState({
      layers: [{
        id: 'L1', type: 'image', name: 'first.jpg', visible: true,
        opacity: 1, blendMode: 'normal', locked: false, order: 0,
      }],
      activeLayerId: 'L1',
      documentMeta: {
        id: 'doc', name: 'first', createdAt: 0, modifiedAt: 0,
        width: 800, height: 600,
      },
    } as never);
    useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 }, { w: 800, h: 600 });
    useBackendState.getState().setSessionId('sid-123');

    await editorDocument.addImage(jpegFile('second.jpg'));
    await vi.waitFor(() => {
      expect(mockAutoAnalyse).toHaveBeenCalledTimes(1);
    });
  });

  it('does not fire when no session is available (offline load)', async () => {
    useEditorStore.setState({
      layers: [{
        id: 'L1', type: 'image', name: 'first.jpg', visible: true,
        opacity: 1, blendMode: 'normal', locked: false, order: 0,
      }],
      activeLayerId: 'L1',
    } as never);
    // No session anywhere and none bootstrapping.
    await editorDocument.addImage(jpegFile('second.jpg'));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockAutoAnalyse).not.toHaveBeenCalled();
  });
});
