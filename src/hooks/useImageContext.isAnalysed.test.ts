/**
 * Tests for the snapshot-aware analysed derivation:
 *  - isImageNodeAnalysed unions the local analysedImageNodeIds with
 *    session-context presence in the backend snapshot (reload case).
 *  - Extracted / added nodes inherit "analysed" once the session has context,
 *    because backend context is session-global (DEFAULT_IMAGE_NODE_ID).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real zustand store as the backend-state mock so both the predicate and the
// hook read through the same subscribable surface the app uses.
vi.mock('@/store/backend-state-slice', async () => {
  const { create } = await import('zustand');
  const useBackendState = create(() => ({
    snapshot: null as { imageContext: object | null } | null,
    sseStatus: 'closed',
    sessionId: null as string | null,
    setSnapshot: vi.fn(),
    markAnalyzeComplete: vi.fn(),
  }));
  return { useBackendState };
});

vi.mock('@/lib/backend-tools', () => ({ backendTools: {} }));
vi.mock('@/lib/sam/sam-client', () => ({ maskPngBase64ToBytes: vi.fn() }));
vi.mock('@/core/pixel-store', () => ({ pixelStore: { getSource: vi.fn(() => null) } }));
vi.mock('@/core/mask-store', () => ({ maskStore: { get: vi.fn(), register: vi.fn() } }));
vi.mock('@/store', () => ({
  useEditorStore: { getState: vi.fn(() => ({ layers: [], imageNodes: {}, activeImageNodeId: null, activeLayerId: null })) },
}));

import { useAiSession, isImageNodeAnalysed } from './useImageContext';
import { useBackendState } from '@/store/backend-state-slice';

function resetStores() {
  useAiSession.setState({
    sessionId: null,
    context: null,
    status: 'idle',
    error: null,
    analysedImageNodeIds: [],
  });
  (useBackendState as unknown as { setState: (s: object) => void }).setState({ snapshot: null });
}

describe('isImageNodeAnalysed', () => {
  beforeEach(resetStores);

  it('is false when the node is unmarked and the session has no context', () => {
    expect(isImageNodeAnalysed('node-1')).toBe(false);
  });

  it('is true when the node was locally marked analysed', () => {
    useAiSession.getState().markAnalysed('node-1');
    expect(isImageNodeAnalysed('node-1')).toBe(true);
  });

  it('is true after a reload: snapshot carries context, local marks are empty', () => {
    (useBackendState as unknown as { setState: (s: object) => void }).setState({
      snapshot: { imageContext: { lighting: 'flat' } },
    });
    expect(useAiSession.getState().analysedImageNodeIds).toEqual([]);
    expect(isImageNodeAnalysed('node-1')).toBe(true);
  });

  it('inherits for extracted/added nodes once the session has context', () => {
    useAiSession.getState().markAnalysed('node-source');
    (useBackendState as unknown as { setState: (s: object) => void }).setState({
      snapshot: { imageContext: { lighting: 'flat' } },
    });
    expect(isImageNodeAnalysed('node-extracted')).toBe(true);
  });

  it('stays false when snapshot exists but has no imageContext', () => {
    (useBackendState as unknown as { setState: (s: object) => void }).setState({
      snapshot: { imageContext: null },
    });
    expect(isImageNodeAnalysed('node-1')).toBe(false);
  });
});
