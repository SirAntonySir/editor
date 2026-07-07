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

import { useAiSession } from './useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';

// The precompute → suggest chain is fire-and-forget; let its microtasks settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // Snapshot refetch isn't under test — make fetch reject so it's skipped.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no-net')));
  useAiSession.setState({ sessionId: 's1', context: null, status: 'idle' });
  useBackendState.getState().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runAnalyse — autonomous suggestion gating', () => {
  it('skips suggest_widgets when suggest:false (analysis-only)', async () => {
    await useAiSession.getState().runAnalyse({ suggest: false });
    await flush();
    expect(backendTools.analyze_context).toHaveBeenCalled();
    expect(backendTools.precompute_regions).toHaveBeenCalled();
    expect(backendTools.suggest_widgets).not.toHaveBeenCalled();
  });

  it('still reaches the analyze end state when suggest:false', async () => {
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(false);
    await useAiSession.getState().runAnalyse({ suggest: false });
    await flush();
    // No widget_mint phase fires on this path, so completion is synthesized.
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(true);
  });

  it('does NOT call suggest_widgets by default (analysis-only; suggestions are opt-in)', async () => {
    await useAiSession.getState().runAnalyse();
    await flush();
    expect(backendTools.analyze_context).toHaveBeenCalled();
    expect(backendTools.suggest_widgets).not.toHaveBeenCalled();
  });

  it('calls suggest_widgets only when explicitly opted in (suggest:true)', async () => {
    await useAiSession.getState().runAnalyse({ suggest: true });
    await flush();
    expect(backendTools.suggest_widgets).toHaveBeenCalled();
  });
});
