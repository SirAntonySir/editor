import { describe, expect, it } from 'vitest';
import {
  lassoRasterSize,
  polygonAreaFrac,
  rasterizeLassoPath,
  shouldAppendPoint,
  type LassoPoint,
} from './lasso';

const SQUARE: LassoPoint[] = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.75, 0.75],
  [0.25, 0.75],
];

describe('shouldAppendPoint', () => {
  it('accepts the first point of a path', () => {
    expect(shouldAppendPoint([], [0.5, 0.5], 0.01)).toBe(true);
  });

  it('rejects points closer than the min distance and accepts farther ones', () => {
    const path: LassoPoint[] = [[0.5, 0.5]];
    expect(shouldAppendPoint(path, [0.5005, 0.5], 0.01)).toBe(false);
    expect(shouldAppendPoint(path, [0.52, 0.5], 0.01)).toBe(true);
  });
});

describe('polygonAreaFrac', () => {
  it('computes the shoelace area regardless of winding', () => {
    expect(polygonAreaFrac(SQUARE)).toBeCloseTo(0.25, 6);
    expect(polygonAreaFrac([...SQUARE].reverse())).toBeCloseTo(0.25, 6);
  });

  it('is zero for degenerate paths', () => {
    expect(polygonAreaFrac([])).toBe(0);
    expect(polygonAreaFrac([[0.1, 0.1], [0.9, 0.9]])).toBe(0);
  });
});

describe('rasterizeLassoPath', () => {
  it('fills the interior of a centered square and leaves the outside empty', () => {
    const mask = rasterizeLassoPath(SQUARE, 40, 40);
    expect(mask).not.toBeNull();
    const at = (x: number, y: number) => mask!.data[y * 40 + x];
    expect(at(20, 20)).toBe(255); // centre
    expect(at(12, 20)).toBe(255); // inside left edge (0.25*40=10)
    expect(at(5, 20)).toBe(0);    // outside left
    expect(at(20, 5)).toBe(0);    // outside top
    expect(at(35, 35)).toBe(0);   // outside corner
  });

  it('matches SAM mask shape: width/height/Uint8Array of 0 or 255', () => {
    const mask = rasterizeLassoPath(SQUARE, 16, 8)!;
    expect(mask.width).toBe(16);
    expect(mask.height).toBe(8);
    expect(mask.data).toBeInstanceOf(Uint8Array);
    expect(mask.data.length).toBe(16 * 8);
    expect([...new Set(mask.data)].sort()).toEqual([0, 255]);
  });

  it('fills a triangle only inside its edges', () => {
    const tri: LassoPoint[] = [[0.5, 0.1], [0.9, 0.9], [0.1, 0.9]];
    const mask = rasterizeLassoPath(tri, 50, 50)!;
    const at = (x: number, y: number) => mask.data[y * 50 + x];
    expect(at(25, 35)).toBe(255); // centroid-ish
    expect(at(5, 5)).toBe(0);     // above the apex
    expect(at(45, 10)).toBe(0);   // right of the apex
  });

  it('returns null for fewer than 3 points', () => {
    expect(rasterizeLassoPath([[0.1, 0.1], [0.2, 0.2]], 32, 32)).toBeNull();
  });

  it('returns null for an accidental-click-sized polygon', () => {
    const tiny: LassoPoint[] = [
      [0.5, 0.5], [0.501, 0.5], [0.501, 0.501], [0.5, 0.501],
    ];
    expect(rasterizeLassoPath(tiny, 64, 64)).toBeNull();
  });
});

describe('lassoRasterSize', () => {
  it('keeps small images at natural size', () => {
    expect(lassoRasterSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('caps the long edge and preserves aspect', () => {
    expect(lassoRasterSize(4096, 2048)).toEqual({ width: 1024, height: 512 });
    expect(lassoRasterSize(2048, 4096)).toEqual({ width: 512, height: 1024 });
  });
});
