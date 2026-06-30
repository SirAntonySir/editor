import { describe, it, expect } from 'vitest';
import { planForcedExtractions } from './forced-extraction';
import type { CandidateRegion } from '@/types/image-context';

const REGIONS = [
  { label: 'Sky', description: '', maskRef: 'mask-sky' },
  { label: 'Grass', description: '' }, // no maskRef → not extractable
] as unknown as CandidateRegion[];

describe('planForcedExtractions', () => {
  it('extracts committed objects and ai-regions with a backing mask', () => {
    const plan = planForcedExtractions(
      ['region:object:m1', 'region:ai:sky'],
      REGIONS,
      (id) => id === 'm1' || id === 'mask-sky',
    );
    expect(plan.extractable).toEqual([
      { sourceId: 'region:object:m1', maskId: 'm1' },
      { sourceId: 'region:ai:sky', maskId: 'mask-sky' },
    ]);
    expect(plan.fallbackIds).toEqual([]);
  });

  it('falls back when the mask is missing and there is nothing to segment from', () => {
    const plan = planForcedExtractions(
      ['region:object:gone', 'region:ai:grass'],
      REGIONS,
      () => false,
    );
    expect(plan.extractable).toEqual([]);
    expect(plan.segmentable).toEqual([]);
    // parsed object ids: committed → its mask id; ai → its label
    expect(plan.fallbackIds).toEqual(['gone', 'grass']);
  });

  it('routes a maskless ai-region with a representativePoint to segmentable', () => {
    const regions = [
      ...REGIONS,
      { label: 'Shoes', description: '', representativePoint: [0.5, 0.4] },
    ] as unknown as CandidateRegion[];
    // No mask exists yet (Render: server-side SAM precompute is off), but the
    // region carries a click point → segment it client-side, don't fall back.
    const plan = planForcedExtractions(['region:ai:shoes'], regions, () => false);
    expect(plan.extractable).toEqual([]);
    expect(plan.segmentable).toEqual([
      { sourceId: 'region:ai:shoes', label: 'Shoes', point: [0.5, 0.4] },
    ]);
    expect(plan.fallbackIds).toEqual([]);
  });
});
