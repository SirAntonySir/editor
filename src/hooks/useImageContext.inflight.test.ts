/**
 * Tests for the single-flight analyze guard + suggest dedup:
 *  - concurrent analyseImageLayer calls join one pipeline (one analyze_context)
 *  - suggestForImageNode during an in-flight analyze awaits it, then calls
 *    suggest_widgets directly — never a second analyze
 *  - suggestForImageNode after a reload falls back to the backend-state
 *    session + snapshot context instead of re-running the full pipeline
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare_image: vi.fn(),
  analyze_context: vi.fn(),
  precompute_regions: vi.fn(),
  suggest_widgets: vi.fn(),
  backendState: {
    sessionId: null as string | null,
    snapshot: null as { imageContext: object | null } | null,
    setSnapshot: vi.fn(),
    markAnalyzeComplete: vi.fn(),
  },
}));

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    prepare_image: mocks.prepare_image,
    analyze_context: mocks.analyze_context,
    precompute_regions: mocks.precompute_regions,
    suggest_widgets: mocks.suggest_widgets,
  },
}));
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => mocks.backendState },
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
const editorMock = vi.hoisted(() => {
  const base = () => ({
    activeImageNodeId: 'node-a',
    imageNodes: {
      'node-a': { id: 'node-a', layerIds: ['layer-1'], position: { x: 0, y: 0 }, size: { w: 600, h: 450 }, sourceSize: { w: 100, h: 75 } },
    } as Record<string, object>,
    layers: [{ id: 'layer-1', name: 'photo.jpg', type: 'image' }],
    activeLayerId: 'layer-1',
    setActiveImageNode: () => {},
  });
  const holder = { state: base() };
  return { holder, reset: () => { holder.state = base(); } };
});

vi.mock('@/store', () => ({
  useEditorStore: { getState: () => editorMock.holder.state },
}));

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

import { useAiSession, analyseImageLayer, suggestForImageNode } from './useImageContext';

const CONTEXT_OUTPUT = {
  subjects: [],
  lighting: 'flat',
  dominantTones: [],
  mood: 'neutral',
  candidateRegions: [],
  modelName: 'test',
  modelVersion: '1',
  generatedAt: '2026-01-01T00:00:00Z',
};

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  editorMock.reset();
  useAiSession.setState({
    sessionId: 'sid-1',
    context: null,
    status: 'idle',
    error: null,
    analysedImageNodeIds: [],
  });
  mocks.backendState.sessionId = null;
  mocks.backendState.snapshot = null;
  mocks.prepare_image.mockResolvedValue({ ok: true, output: {} });
  mocks.analyze_context.mockResolvedValue({ ok: true, output: CONTEXT_OUTPUT });
  mocks.precompute_regions.mockResolvedValue({ ok: true, output: { maskIds: [] } });
  mocks.suggest_widgets.mockResolvedValue({ ok: true, output: { widgetIds: [] } });
});

describe('single-flight analyse', () => {
  it('joins concurrent analyseImageLayer calls into one pipeline', async () => {
    let resolveAnalyze!: (v: unknown) => void;
    mocks.analyze_context.mockImplementationOnce(
      () => new Promise((res) => { resolveAnalyze = res; }),
    );

    const p1 = analyseImageLayer('node-a');
    await tick(); // let prepare_image resolve, analyze_context now pending
    const p2 = analyseImageLayer('node-a');

    resolveAnalyze({ ok: true, output: CONTEXT_OUTPUT });
    await Promise.all([p1, p2]);

    expect(mocks.prepare_image).toHaveBeenCalledTimes(1);
    expect(mocks.analyze_context).toHaveBeenCalledTimes(1);
  });
});

describe('suggestForImageNode during in-flight analyze', () => {
  it('awaits the running analyze, then calls suggest_widgets — no second analyze', async () => {
    let resolveAnalyze!: (v: unknown) => void;
    mocks.analyze_context.mockImplementationOnce(
      () => new Promise((res) => { resolveAnalyze = res; }),
    );

    const analyse = analyseImageLayer('node-a');
    await tick();
    const suggest = suggestForImageNode('node-a');
    await tick();
    // Analyze still pending — suggest must not have fired yet.
    expect(mocks.suggest_widgets).not.toHaveBeenCalled();

    resolveAnalyze({ ok: true, output: CONTEXT_OUTPUT });
    await Promise.all([analyse, suggest]);

    expect(mocks.analyze_context).toHaveBeenCalledTimes(1);
    expect(mocks.suggest_widgets).toHaveBeenCalledTimes(1);
  });
});

describe('suggestForImageNode on an extracted object node', () => {
  it('passes the object label so the backend scopes suggestions to the object', async () => {
    useAiSession.setState({ sessionId: 'sid-1', context: { lighting: 'flat' } as never });
    // Extracted cutout: provenance via sourceImageNodeId, named after its mask.
    editorMock.holder.state.imageNodes['node-cut'] = {
      id: 'node-cut', name: 'sports car', sourceImageNodeId: 'node-a',
      layerIds: ['layer-cut'], position: { x: 0, y: 0 },
      size: { w: 300, h: 200 }, sourceSize: { w: 60, h: 40 },
    };
    editorMock.holder.state.layers.push({ id: 'layer-cut', name: 'cut', type: 'image' });
    editorMock.holder.state.activeImageNodeId = 'node-cut';
    editorMock.holder.state.activeLayerId = 'layer-cut';

    await suggestForImageNode('node-cut');

    expect(mocks.suggest_widgets).toHaveBeenCalledWith('sid-1', {
      layerId: 'layer-cut',
      objectLabel: 'sports car',
    });
  });

  it('does not pass a label for ordinary (non-extracted) nodes', async () => {
    useAiSession.setState({ sessionId: 'sid-1', context: { lighting: 'flat' } as never });

    await suggestForImageNode('node-a');

    expect(mocks.suggest_widgets).toHaveBeenCalledWith('sid-1', { layerId: 'layer-1' });
  });
});

describe('suggestForImageNode after reload', () => {
  it('falls back to backend-state session + snapshot context instead of re-analyzing', async () => {
    useAiSession.setState({ sessionId: null, context: null });
    mocks.backendState.sessionId = 'sid-restored';
    mocks.backendState.snapshot = { imageContext: { lighting: 'flat' } };

    await suggestForImageNode('node-a');

    expect(mocks.prepare_image).not.toHaveBeenCalled();
    expect(mocks.analyze_context).not.toHaveBeenCalled();
    expect(mocks.suggest_widgets).toHaveBeenCalledTimes(1);
    expect(mocks.suggest_widgets).toHaveBeenCalledWith('sid-restored', { layerId: 'layer-1' });
  });
});
