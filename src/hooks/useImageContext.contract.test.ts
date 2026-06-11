/**
 * Contract test: useAiSession.context shape after a successful runAnalyse.
 * Pins the camelCase frontend shape so later refactors (Phase 1 casing
 * unification, Phase 2 tool split) don't silently drop fields.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAiSession } from './useImageContext';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    analyze_image: vi.fn(async () => ({
      ok: true,
      output: {
        subjects: ['a person'],
        lighting: 'flat',
        dominantTones: ['midtones'],
        mood: 'test',
        candidateRegions: [
          {
            label: 'person',
            description: 'The subject.',
            bbox: [0.1, 0.1, 0.6, 0.8],
            representativePoint: [0.4, 0.5],
            paths: [[[0.1, 0.1], [0.6, 0.1], [0.6, 0.8], [0.1, 0.8]]],
            maskPngBase64: 'iVBORw0KGgoAAAA=',
          },
        ],
        modelName: 'test',
        modelVersion: '1',
        generatedAt: '2026-06-11T00:00:00Z',
      },
    })),
  },
}));

vi.mock('@/lib/sam/sam-client', () => ({
  maskPngBase64ToBytes: vi.fn(async () => ({
    data: new Uint8Array(16),
    width: 4,
    height: 4,
  })),
}));

vi.mock('@/core/pixel-store', () => ({
  pixelStore: {
    getSource: vi.fn(() => ({ width: 100, height: 100 })),
  },
}));

vi.mock('@/core/mask-store', () => ({
  maskStore: {
    get: vi.fn(() => null),
    register: vi.fn(() => 'mask-ref-1'),
  },
}));

vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ setSnapshot: vi.fn() }) },
}));

// Mock fetch so the belt-and-braces snapshot refetch stays offline.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

describe('useAiSession contract', () => {
  beforeEach(() => {
    useAiSession.setState({
      sessionId: 'sid-1',
      context: null,
      status: 'idle',
      error: null,
    });
  });

  afterEach(() => {
    useAiSession.getState().reset();
  });

  it('runAnalyse populates context with camelCase fields', async () => {
    await useAiSession.getState().runAnalyse();
    const ctx = useAiSession.getState().context;
    expect(ctx).not.toBeNull();
    expect(ctx).toEqual(
      expect.objectContaining({
        subjects: expect.any(Array),
        lighting: expect.any(String),
        dominantTones: expect.any(Array),
        mood: expect.any(String),
        candidateRegions: expect.any(Array),
        modelName: expect.any(String),
        modelVersion: expect.any(String),
        generatedAt: expect.any(String),
      }),
    );
    const region = ctx!.candidateRegions![0];
    expect(region).toEqual(
      expect.objectContaining({
        label: expect.any(String),
        description: expect.any(String),
        bbox: expect.any(Array),
        representativePoint: expect.any(Array),
        paths: expect.any(Array),
        maskPngBase64: expect.any(String),
      }),
    );
  });
});
