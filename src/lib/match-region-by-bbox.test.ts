import { describe, it, expect } from 'vitest';
import { matchRegionLabelByBbox } from './match-region-by-bbox';
import type { CandidateRegion } from '@/types/image-context';

/** Build a width×height mask filled with 255 inside [x..x+w, y..y+h]. */
function rectMask(
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(width * height);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      data[yy * width + xx] = 255;
    }
  }
  return { width, height, data };
}

const REGIONS: CandidateRegion[] = [
  // bbox = [x, y, w, h] in 0..1
  { label: 'sky', description: '', bbox: [0, 0, 1, 0.4] },
  { label: 'pasta dish', description: '', bbox: [0.3, 0.5, 0.4, 0.4] },
  { label: 'wine glass', description: '', bbox: [0.75, 0.4, 0.15, 0.55] },
];

describe('matchRegionLabelByBbox', () => {
  it('matches a mask whose bbox aligns with a region', () => {
    // Mask covers pixels (30,50) -> (70,90) in a 100×100 grid = normalised
    // (0.3, 0.5, 0.4, 0.4) — exactly the pasta dish region.
    const mask = rectMask(100, 100, 30, 50, 40, 40);
    expect(matchRegionLabelByBbox(mask, REGIONS)).toBe('pasta dish');
  });

  it('returns null when no region overlaps enough', () => {
    // Mask in the bottom-left corner — no overlap with any region.
    const mask = rectMask(100, 100, 0, 90, 10, 10);
    expect(matchRegionLabelByBbox(mask, REGIONS)).toBeNull();
  });

  it('returns null on an empty mask', () => {
    const mask = { width: 100, height: 100, data: new Uint8Array(10000) };
    expect(matchRegionLabelByBbox(mask, REGIONS)).toBeNull();
  });

  it('returns null when regions are missing or empty', () => {
    const mask = rectMask(100, 100, 30, 50, 40, 40);
    expect(matchRegionLabelByBbox(mask, undefined)).toBeNull();
    expect(matchRegionLabelByBbox(mask, [])).toBeNull();
  });

  it('skips regions that have no bbox', () => {
    const mask = rectMask(100, 100, 30, 50, 40, 40);
    const regions: CandidateRegion[] = [
      { label: 'no-bbox region', description: '' }, // bbox absent
      { label: 'pasta dish', description: '', bbox: [0.3, 0.5, 0.4, 0.4] },
    ];
    expect(matchRegionLabelByBbox(mask, regions)).toBe('pasta dish');
  });

  it('picks the region with the highest IoU when several overlap', () => {
    // Mask roughly covers the wine glass area, with a small tail into
    // the pasta dish. Wine glass should still win on IoU.
    const mask = rectMask(100, 100, 76, 42, 13, 50);
    expect(matchRegionLabelByBbox(mask, REGIONS)).toBe('wine glass');
  });
});
