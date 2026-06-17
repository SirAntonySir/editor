// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { useAiSession } from '@/hooks/useImageContext';
import { selectNamedRegionTool } from './select-named-region';

const EMPTY_CONTEXT = {
  subjects: [], lighting: 'flat', dominantTones: [], mood: '',
  candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '',
};

beforeEach(() => {
  maskStore.clear();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({
    activeObjectId: null,
    activeMaskRef: null,
    committedMaskRef: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  useAiSession.setState({ context: null });
  vi.restoreAllMocks();
});

describe('select_named_region — Object preference branch', () => {
  it('sets activeObjectId when a committed Object with matching label exists', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const result = selectNamedRegionTool.handler({ label: 'Sky', commit: true });

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/sky/i);
    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
    // setActiveMask should NOT have been called — Object path is instant.
    expect(useEditorStore.getState().activeMaskRef).toBeNull();
  });

  it('matches Object labels case-insensitively', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const result = selectNamedRegionTool.handler({ label: 'sky', commit: true });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
  });
});

describe('select_named_region — AI-region fallback branch', () => {
  it('arms the AI region when no Object with the label exists', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [
          { label: 'Sky', description: 'blue sky', maskRef: 'mask-ref-sky' },
        ],
      } as unknown as never,
    });

    const result = selectNamedRegionTool.handler({ label: 'Sky', commit: true });

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/sky/i);
    // AI region path: setActiveMask then commitMask.
    const state = useEditorStore.getState();
    expect(state.committedMaskRef).toBe('mask-ref-sky');
    expect(state.activeObjectId).toBeNull();
  });

  it('matches AI region labels case-insensitively', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [
          { label: 'Sky', maskRef: 'mask-ref-sky' },
        ],
      } as unknown as never,
    });

    const result = selectNamedRegionTool.handler({ label: 'SKY', commit: true });
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().committedMaskRef).toBe('mask-ref-sky');
  });

  it('Object wins over AI region when labels conflict', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [
          { label: 'Sky', maskRef: 'ai-mask-ref' },
        ],
      } as unknown as never,
    });

    const result = selectNamedRegionTool.handler({ label: 'Sky', commit: true });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
    expect(useEditorStore.getState().activeMaskRef).toBeNull();
  });

  it('returns ok: false when neither Object nor AI region matches', () => {
    useAiSession.setState({ context: { ...EMPTY_CONTEXT } as unknown as never });

    const result = selectNamedRegionTool.handler({ label: 'nonexistent', commit: true });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/list_named_regions/);
  });

  it('returns ok: false when AI region has no maskRef', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Sky', maskRef: null }],
      } as unknown as never,
    });

    const result = selectNamedRegionTool.handler({ label: 'Sky', commit: true });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no mask/i);
  });

  it('respects commit: false — arms mask but does not commit', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Sky', maskRef: 'mask-ref-sky' }],
      } as unknown as never,
    });

    const result = selectNamedRegionTool.handler({ label: 'Sky', commit: false });
    expect(result.ok).toBe(true);
    const state = useEditorStore.getState();
    expect(state.activeMaskRef).toBe('mask-ref-sky');
    expect(state.committedMaskRef).toBeNull();
  });
});
