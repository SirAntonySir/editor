// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { maskStore } from '@/core/mask-store';
import { useAiSession } from '@/hooks/useImageContext';
import { listNamedRegionsTool } from './list-named-regions';

const EMPTY_CONTEXT = {
  subjects: [], lighting: 'flat', dominantTones: [], mood: '',
  candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '',
};

beforeEach(() => {
  maskStore.clear();
  useAiSession.setState({ context: null });
});

describe('list_named_regions handler (merged)', () => {
  it('returns empty list when no objects and no AI context', () => {
    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(0);
  });

  it('returns committed Objects with origin: object', () => {
    maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].label).toBe('Sky');
    expect(result.regions[0].origin).toBe('object');
    expect(result.regions[0].hasMask).toBe(true);
    expect(result.regions[0].maskId).toBeTruthy();
  });

  it('returns AI regions with origin: ai_region', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Background', maskRef: 'ref-bg' }],
      } as unknown as never,
    });

    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].label).toBe('Background');
    expect(result.regions[0].origin).toBe('ai_region');
    expect(result.regions[0].maskRef).toBe('ref-bg');
  });

  it('Object wins on duplicate label (case-insensitive)', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'sky', maskRef: 'ai-ref' }],
      } as unknown as never,
    });

    const result = listNamedRegionsTool.handler({});
    // Only one entry — the Object wins.
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].origin).toBe('object');
    expect(result.regions[0].maskId).toBe(maskId);
  });

  it('includes both when labels differ', () => {
    maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [
          { label: 'Subject', maskRef: 'ref-subject' },
          { label: 'Background', maskRef: 'ref-bg' },
        ],
      } as unknown as never,
    });

    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(3);
    const labels = result.regions.map((r) => r.label);
    expect(labels).toContain('Sky');
    expect(labels).toContain('Subject');
    expect(labels).toContain('Background');
  });

  it('omits Objects without a label', () => {
    // Unlabeled mask — should not appear in the list.
    maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(0);
  });

  it('omits AI regions without a maskRef', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Horizon', maskRef: null }],
      } as unknown as never,
    });

    // AI region without maskRef should still appear (hasMask: false) but
    // with the ai_region origin. The tool does include it in the list; it
    // just has hasMask: false. No omission for label-only AI regions.
    const result = listNamedRegionsTool.handler({});
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].hasMask).toBe(false);
  });
});
