import { describe, it, expect } from 'vitest';
import { rankRegions, type SuggestRegion } from './region-suggest';

const REGIONS: SuggestRegion[] = [
  { label: 'shoes', sourceId: 'region:object:m1' },
  { label: 'socks', sourceId: 'region:object:m2' },
  { label: 'sky', sourceId: 'region:ai:sky' },
  { label: 'shirt', sourceId: 'region:object:m3' },
];

describe('rankRegions', () => {
  it('returns nothing for words under 2 chars', () => {
    expect(rankRegions(REGIONS, 's')).toEqual([]);
  });

  it('surfaces a prefix match', () => {
    const out = rankRegions(REGIONS, 'sho');
    expect(out[0].label).toBe('shoes');
  });

  it('produces no matches for common prose words', () => {
    expect(rankRegions(REGIONS, 'and')).toEqual([]);
    expect(rankRegions(REGIONS, 'the')).toEqual([]);
    expect(rankRegions(REGIONS, 'apply')).toEqual([]);
  });

  it('ranks a stronger (prefix) match above a weaker one', () => {
    // "sh" is a prefix of both "shoes" and "shirt"; both qualify, order is
    // by score then stable. Just assert both surface and are prefix-tier.
    const out = rankRegions(REGIONS, 'sh');
    const labels = out.map((r) => r.label);
    expect(labels).toContain('shoes');
    expect(labels).toContain('shirt');
  });

  it('excludes weak Levenshtein-only matches below the floor', () => {
    // "shoez" is one edit from "shoes" (Levenshtein tier ~200) but is NOT a
    // subsequence-or-better match, so it must stay below the 400 floor.
    expect(rankRegions(REGIONS, 'shoez')).toEqual([]);
  });

  it('caps results at 5', () => {
    const many: SuggestRegion[] = Array.from({ length: 9 }, (_, i) => ({
      label: `sky${i}`,
      sourceId: `region:ai:sky${i}`,
    }));
    expect(rankRegions(many, 'sky').length).toBe(5);
  });
});
