import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    prepare_image: vi.fn().mockResolvedValue({ ok: true }),
    analyze_context: vi
      .fn()
      .mockResolvedValue({ ok: true, output: { subjects: [], candidateRegions: [] } }),
    precompute_regions: vi.fn().mockResolvedValue({ ok: true }),
    suggest_widgets: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { useAiSession, suggestForImageNode } from './useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Seed one image node whose single layer is an image layer. */
function seedImageNode(): string {
  const nodeId = 'n1';
  useEditorStore.setState({
    imageNodes: {
      [nodeId]: {
        id: nodeId,
        layerIds: ['L1'],
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        sourceSize: { w: 10, h: 10 },
      },
    },
    layers: [
      { id: 'L1', type: 'image', name: 'p.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
    ],
    activeImageNodeId: nodeId,
  } as never);
  return nodeId;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no-net')));
  useBackendState.getState().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAiSession.getState().reset();
});

describe('suggestForImageNode', () => {
  it('when the image is already analyzed, only suggests — no re-analyze', async () => {
    const nodeId = seedImageNode();
    useAiSession.setState({ sessionId: 's1', context: { subjects: [] } as never, status: 'ready' });

    await suggestForImageNode(nodeId);
    await flush();

    expect(backendTools.suggest_widgets).toHaveBeenCalledWith('s1', { layerId: 'L1' });
    expect(backendTools.analyze_context).not.toHaveBeenCalled();
  });

  it('when not analyzed yet, analyzes first and then suggests', async () => {
    const nodeId = seedImageNode();
    useAiSession.setState({ sessionId: 's1', context: null, status: 'idle' });

    await suggestForImageNode(nodeId);
    await flush();

    expect(backendTools.analyze_context).toHaveBeenCalled();
    expect(backendTools.suggest_widgets).toHaveBeenCalled();
  });
});
