import { describe, it, expect } from 'vitest';
import { resolveRegionMaskId } from './region-resolve';
import type { CandidateRegion } from '@/types/image-context';

const REGIONS: CandidateRegion[] = [
  { label: 'Sky', description: '', maskRef: 'mask-sky' },
  { label: 'Person', description: '' },
];

describe('resolveRegionMaskId', () => {
  it('returns the mask id directly for a committed object source', () => {
    expect(resolveRegionMaskId('region:object:m1', [])).toBe('m1');
  });

  it('resolves an ai-region source to its candidate maskRef (case-insensitive)', () => {
    expect(resolveRegionMaskId('region:ai:sky', REGIONS)).toBe('mask-sky');
  });

  it('returns null for an ai-region with no mask', () => {
    expect(resolveRegionMaskId('region:ai:person', REGIONS)).toBeNull();
  });

  it('returns null for an unknown ai-region label', () => {
    expect(resolveRegionMaskId('region:ai:water', REGIONS)).toBeNull();
  });

  it('returns null for a non-region source', () => {
    expect(resolveRegionMaskId('imageNode:abc', REGIONS)).toBeNull();
  });
});
