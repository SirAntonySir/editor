import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSegmentInteraction } from './useSegmentInteraction';
import { useAiSession } from './useImageContext';
import { segmentStore } from '@/lib/segmentation/segment-store';
import type { ImageContext } from '@/types/image-context';

const ctx: ImageContext = {
  subjects: [],
  lighting: 'flat',
  dominantTones: [],
  mood: '',
  candidateRegions: [
    { label: 'dog', description: '',
      paths: [[[0, 0], [1, 0], [1, 1], [0, 1]]], maskRef: 'mask-a' },
  ],
  modelName: 'test',
  modelVersion: '1',
  generatedAt: '2026-06-10T00:00:00Z',
};

describe('useSegmentInteraction', () => {
  beforeEach(() => {
    segmentStore.clearAll();
    useAiSession.setState({ context: null, status: 'idle' });
  });

  it('writes the current AI context regions into segment-store keyed by imageNodeId', () => {
    useAiSession.setState({ context: ctx, status: 'ready' });
    renderHook(() => useSegmentInteraction('in-1'));
    expect(segmentStore.getRegions('in-1')).toHaveLength(1);
    expect(segmentStore.getRegions('in-1')[0].maskRef).toBe('mask-a');
  });

  it('clears the entry when context becomes null', () => {
    segmentStore.setRegions('in-1', ctx.candidateRegions);
    useAiSession.setState({ context: null, status: 'idle' });
    renderHook(() => useSegmentInteraction('in-1'));
    expect(segmentStore.getRegions('in-1')).toHaveLength(0);
  });
});
