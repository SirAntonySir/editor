import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMobileSam, clearMobileSamCache, _resetMobileSamCacheForTests } from './useMobileSam';

vi.mock('@/lib/segmentation/sam-capability', () => ({
  detectSamCapability: vi.fn(),
}));

vi.mock('@/lib/segmentation/mobile-sam-client', () => ({
  encode: vi.fn(),
  decode: vi.fn(),
}));

vi.mock('@/lib/canvas-registry', () => ({
  CanvasRegistry: { getSource: vi.fn() },
}));

vi.mock('@/store', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      imageNodes: { 'in-1': { id: 'in-1', layerIds: ['l1'] } },
    })),
  },
}));

vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
  width: 1024, height: 1024, close: vi.fn(),
})));

import { detectSamCapability } from '@/lib/segmentation/sam-capability';
import { decode as samDecode, encode as samEncode } from '@/lib/segmentation/mobile-sam-client';
import { CanvasRegistry } from '@/lib/canvas-registry';

const fakeEmbedding = { imageWidth: 1024, imageHeight: 1024, embedding: {} };

beforeEach(() => {
  _resetMobileSamCacheForTests();
  vi.clearAllMocks();
  vi.mocked(CanvasRegistry.getSource).mockReturnValue({ width: 1024, height: 1024 } as never);
  vi.mocked(samEncode).mockResolvedValue(fakeEmbedding);
  vi.mocked(samDecode).mockResolvedValue({ data: new Uint8Array(4), width: 2, height: 2 });
});

describe('useMobileSam', () => {
  it('runs the encoder once and reports ready on the webgpu path', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('webgpu');
    const { result } = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    // Encoding is lazy — triggered by the first decode call, not on mount.
    expect(samEncode).toHaveBeenCalledTimes(0);
    await result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(samEncode).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('reuses the cached embedding for the same imageNodeId across remounts', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('webgpu');
    const a = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    // Prime the cache via decode.
    await a.result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    a.unmount();
    const b = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(b.result.current.ready).toBe(true));
    // Second decode reuses the cached embedding — encoder called only once total.
    await b.result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(samEncode).toHaveBeenCalledTimes(1);
  });

  it('on backend capability: ready=true and decode returns null', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('backend');
    const { result } = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const out = await result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(out).toBeNull();
    expect(samEncode).not.toHaveBeenCalled();
  });

  it('decode returns the decoder result on the webgpu path', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('webgpu');
    const { result } = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const mask = await result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(mask).not.toBeNull();
    expect(samDecode).toHaveBeenCalledWith(fakeEmbedding, [{ x: 0.5, y: 0.5, label: 1 }]);
  });

  it('clearMobileSamCache forces a re-encode on next mount', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('webgpu');
    const first = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    // Prime the cache via decode, then clear it.
    await first.result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(samEncode).toHaveBeenCalledTimes(1);
    first.unmount();
    clearMobileSamCache('in-1');
    const second = renderHook(() => useMobileSam('in-1'));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    // After cache clear, decode must re-encode.
    await second.result.current.decode([{ x: 0.5, y: 0.5, label: 1 }]);
    expect(samEncode).toHaveBeenCalledTimes(2);
  });

  it('null imageNodeId leaves ready=false and does not call encoder', async () => {
    vi.mocked(detectSamCapability).mockResolvedValue('webgpu');
    const { result } = renderHook(() => useMobileSam(null));
    // wait a tick to let any spurious effect run
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.ready).toBe(false);
    expect(samEncode).not.toHaveBeenCalled();
  });
});
