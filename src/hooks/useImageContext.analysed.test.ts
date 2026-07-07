/**
 * Tests for per-image analysed tracking added to useAiSession:
 *  - markAnalysed is idempotent
 *  - reset clears analysedImageNodeIds
 *  - analyseImageLayer calls markAnalysed on success
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAiSession, analyseImageLayer } from './useImageContext';

// ── Minimal mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    prepare_image: vi.fn(async () => ({ ok: true, output: {} })),
    analyze_context: vi.fn(async () => ({
      ok: true,
      output: {
        subjects: [],
        lighting: 'flat',
        dominantTones: [],
        mood: 'neutral',
        candidateRegions: [],
        modelName: 'test',
        modelVersion: '1',
        generatedAt: '2026-01-01T00:00:00Z',
      },
    })),
    precompute_regions: vi.fn(async () => ({ ok: true, output: { maskIds: [] } })),
    suggest_widgets: vi.fn(async () => ({ ok: true, output: { widgetIds: [] } })),
  },
}));

vi.mock('@/lib/sam/sam-client', () => ({
  maskPngBase64ToBytes: vi.fn(async () => ({ data: new Uint8Array(4), width: 2, height: 2 })),
}));

vi.mock('@/core/pixel-store', () => ({
  pixelStore: { getSource: vi.fn(() => ({ width: 100, height: 100 })) },
}));

vi.mock('@/core/mask-store', () => ({
  maskStore: { get: vi.fn(() => null), register: vi.fn(() => 'mask-1') },
}));

vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ setSnapshot: vi.fn(), markAnalyzeComplete: vi.fn() }) },
}));

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

// Mock useEditorStore so analyseImageLayer can resolve a layer id.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetSession() {
  useAiSession.setState({
    sessionId: null,
    context: null,
    status: 'idle',
    error: null,
    analysedImageNodeIds: [],
  });
}

// ── markAnalysed ──────────────────────────────────────────────────────────────

describe('markAnalysed', () => {
  beforeEach(resetSession);
  afterEach(() => useAiSession.getState().reset());

  it('adds an id to analysedImageNodeIds', () => {
    useAiSession.getState().markAnalysed('node-1');
    expect(useAiSession.getState().analysedImageNodeIds).toContain('node-1');
  });

  it('is idempotent — calling twice keeps only one entry', () => {
    useAiSession.getState().markAnalysed('node-1');
    useAiSession.getState().markAnalysed('node-1');
    const ids = useAiSession.getState().analysedImageNodeIds;
    expect(ids.filter((x) => x === 'node-1').length).toBe(1);
  });

  it('tracks multiple distinct ids', () => {
    useAiSession.getState().markAnalysed('node-1');
    useAiSession.getState().markAnalysed('node-2');
    expect(useAiSession.getState().analysedImageNodeIds).toEqual(['node-1', 'node-2']);
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  beforeEach(resetSession);

  it('clears analysedImageNodeIds', () => {
    useAiSession.getState().markAnalysed('node-1');
    useAiSession.getState().reset();
    expect(useAiSession.getState().analysedImageNodeIds).toEqual([]);
  });
});

// ── analyseImageLayer → markAnalysed on success ───────────────────────────────

describe('analyseImageLayer', () => {
  beforeEach(() => {
    resetSession();
    // Pre-seed a session so runAnalyse runs directly (not uploadAndAnalyse).
    useAiSession.setState({ sessionId: 'sid-1' });
  });
  afterEach(() => useAiSession.getState().reset());

  it('marks the node as analysed after a successful run', async () => {
    await analyseImageLayer('node-a');
    expect(useAiSession.getState().analysedImageNodeIds).toContain('node-a');
  });
});
