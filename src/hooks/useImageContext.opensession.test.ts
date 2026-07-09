/**
 * Tests for openSession's paint-friendly ordering:
 *  - status flips to 'uploading' SYNCHRONOUSLY (the multi-file-drop race
 *    guard: addImage's awaitSession only waits when a bootstrap is visible)
 *  - the O(source-pixels) downscale runs only AFTER a yield to the display,
 *    so it cannot compete with the freshly opened image's first paint
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  downscaleForUpload: vi.fn(),
  yieldToDisplay: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock('@/lib/downscale-for-upload', () => ({
  downscaleForUpload: mocks.downscaleForUpload,
  yieldToDisplay: mocks.yieldToDisplay,
}));
vi.mock('@/lib/ai-client', () => ({
  createSession: mocks.createSession,
  pushSessionContext: vi.fn(async () => {}),
}));
vi.mock('@/lib/backend-tools', () => ({ backendTools: {} }));
vi.mock('@/lib/sam/sam-client', () => ({ maskPngBase64ToBytes: vi.fn() }));
vi.mock('@/core/pixel-store', () => ({ pixelStore: { getSource: vi.fn(() => null) } }));
vi.mock('@/core/mask-store', () => ({ maskStore: { get: vi.fn(), register: vi.fn() } }));
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ setSnapshot: vi.fn(), markAnalyzeComplete: vi.fn() }) },
}));
vi.mock('@/store', () => ({
  useEditorStore: { getState: vi.fn(() => ({ layers: [], imageNodes: {}, activeImageNodeId: null, activeLayerId: null })) },
}));

import { useAiSession } from './useImageContext';

beforeEach(() => {
  vi.clearAllMocks();
  useAiSession.setState({ sessionId: null, context: null, status: 'idle', error: null, analysedImageNodeIds: [] });
  mocks.createSession.mockResolvedValue('sid-1');
  mocks.downscaleForUpload.mockResolvedValue(new Blob());
  mocks.yieldToDisplay.mockResolvedValue(undefined);
});

describe('openSession ordering', () => {
  it('marks uploading synchronously, yields to display, THEN downscales', async () => {
    const order: string[] = [];
    mocks.yieldToDisplay.mockImplementation(async () => { order.push('yield'); });
    mocks.downscaleForUpload.mockImplementation(async () => { order.push('downscale'); return new Blob(); });

    const p = useAiSession.getState().openSession({} as unknown as OffscreenCanvas);
    // Synchronous — before ANY await. addImage's awaitSession relies on this.
    expect(useAiSession.getState().status).toBe('uploading');

    await p;
    expect(order).toEqual(['yield', 'downscale']);
    expect(useAiSession.getState().sessionId).toBe('sid-1');
  });
});
