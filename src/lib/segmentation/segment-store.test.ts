import { describe, it, expect, beforeEach } from 'vitest';
import { segmentStore } from './segment-store';
import type { CandidateRegion } from '@/types/image-context';

const r = (id: string): CandidateRegion => ({
  label: id, description: '',
  paths: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  maskRef: id,
});

beforeEach(() => segmentStore.clearAll());

describe('segmentStore', () => {
  it('stores and retrieves regions for an ImageNode', () => {
    segmentStore.setRegions('in-1', [r('a'), r('b')]);
    expect(segmentStore.getRegions('in-1').map((x) => x.label)).toEqual(['a', 'b']);
  });

  it('clear by id removes only one node', () => {
    segmentStore.setRegions('in-1', [r('a')]);
    segmentStore.setRegions('in-2', [r('b')]);
    segmentStore.clear('in-1');
    expect(segmentStore.getRegions('in-1')).toEqual([]);
    expect(segmentStore.getRegions('in-2')).toHaveLength(1);
  });

  it('clearAll wipes every node', () => {
    segmentStore.setRegions('in-1', [r('a')]);
    segmentStore.clearAll();
    expect(segmentStore.getRegions('in-1')).toEqual([]);
  });
});
