/**
 * Tests for autoAnalyseImageOnLoad — the fire-and-forget analyze that runs
 * after a user loads an image (openImage/addImage), gated on the first
 * snapshot: aiAccess (study baseline never burns Claude calls), SSE liveness,
 * and no pre-existing context (revived sessions skip).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare_image: vi.fn(),
  analyze_context: vi.fn(),
  precompute_regions: vi.fn(),
  suggest_widgets: vi.fn(),
}));

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    prepare_image: mocks.prepare_image,
    analyze_context: mocks.analyze_context,
    precompute_regions: mocks.precompute_regions,
    suggest_widgets: mocks.suggest_widgets,
  },
}));
// Real zustand store so autoAnalyse can subscribe for the first snapshot.
vi.mock('@/store/backend-state-slice', async () => {
  const { create } = await import('zustand');
  const useBackendState = create(() => ({
    snapshot: null as object | null,
    sseStatus: 'closed',
    sessionId: null as string | null,
    setSnapshot: vi.fn(),
    markAnalyzeComplete: vi.fn(),
  }));
  return { useBackendState };
});
vi.mock('@/lib/sam/sam-client', () => ({
  maskPngBase64ToBytes: vi.fn(async () => ({ data: new Uint8Array(4), width: 2, height: 2 })),
}));
vi.mock('@/core/pixel-store', () => ({
  pixelStore: { getSource: vi.fn(() => ({ width: 100, height: 100 })) },
}));
vi.mock('@/core/mask-store', () => ({
  maskStore: { get: vi.fn(() => null), register: vi.fn(() => 'mask-1') },
}));
vi.mock('@/store', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      activeImageNodeId: 'node-a',
      imageNodes: {
        'node-a': { id: 'node-a', layerIds: ['layer-1'], position: { x: 0, y: 0 }, size: { w: 600, h: 450 }, sourceSize: { w: 100, h: 75 } },
      },
      layers: [{ id: 'layer-1', name: 'photo.jpg', type: 'image' }],
      activeLayerId: 'layer-1',
      setActiveImageNode: vi.fn(),
    })),
  },
}));

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

import { useAiSession, autoAnalyseImageOnLoad } from './useImageContext';
import { useBackendState } from '@/store/backend-state-slice';

type MutableStore = { setState: (s: object) => void };
const backendState = useBackendState as unknown as MutableStore;

const CONTEXT_OUTPUT = {
  subjects: [], lighting: 'flat', dominantTones: [], mood: 'neutral',
  candidateRegions: [], modelName: 'test', modelVersion: '1',
  generatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAiSession.setState({
    sessionId: 'sid-1', context: null, status: 'idle', error: null, analysedImageNodeIds: [],
  });
  backendState.setState({ snapshot: null, sseStatus: 'closed', sessionId: null });
  mocks.prepare_image.mockResolvedValue({ ok: true, output: {} });
  mocks.analyze_context.mockResolvedValue({ ok: true, output: CONTEXT_OUTPUT });
  mocks.precompute_regions.mockResolvedValue({ ok: true, output: { maskIds: [] } });
});

describe('autoAnalyseImageOnLoad', () => {
  it('analyzes when the snapshot grants aiAccess, SSE is open, and no context exists', async () => {
    backendState.setState({
      snapshot: { aiAccess: true, imageContext: null },
      sseStatus: 'open',
    });
    await autoAnalyseImageOnLoad();
    expect(mocks.analyze_context).toHaveBeenCalledTimes(1);
    // Never suggests — analysis is suggestion-free by doctrine.
    expect(mocks.suggest_widgets).not.toHaveBeenCalled();
  });

  it('waits for a snapshot that arrives after the call', async () => {
    const p = autoAnalyseImageOnLoad();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.analyze_context).not.toHaveBeenCalled();
    backendState.setState({
      snapshot: { aiAccess: true, imageContext: null },
      sseStatus: 'open',
    });
    await p;
    expect(mocks.analyze_context).toHaveBeenCalledTimes(1);
  });

  it('skips in the study baseline condition (aiAccess false)', async () => {
    backendState.setState({
      snapshot: { aiAccess: false, imageContext: null },
      sseStatus: 'open',
    });
    await autoAnalyseImageOnLoad();
    expect(mocks.prepare_image).not.toHaveBeenCalled();
    expect(mocks.analyze_context).not.toHaveBeenCalled();
  });

  it('skips when the revived snapshot already carries context', async () => {
    backendState.setState({
      snapshot: { aiAccess: true, imageContext: { lighting: 'flat' } },
      sseStatus: 'open',
    });
    await autoAnalyseImageOnLoad();
    expect(mocks.analyze_context).not.toHaveBeenCalled();
  });

  it('skips when SSE is not open', async () => {
    backendState.setState({
      snapshot: { aiAccess: true, imageContext: null },
      sseStatus: 'closed',
    });
    await autoAnalyseImageOnLoad();
    expect(mocks.analyze_context).not.toHaveBeenCalled();
  });

  it('gives up quietly when no snapshot arrives within the timeout', async () => {
    await autoAnalyseImageOnLoad({ timeoutMs: 10 });
    expect(mocks.analyze_context).not.toHaveBeenCalled();
  });
});
