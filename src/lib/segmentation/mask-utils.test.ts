import { describe, it, expect } from 'vitest';
import { pointInPolygon, polygonsAtPoint, bboxOfPaths } from './mask-utils';
import type { RegionPolygon } from '@/types/image-context';

const square: RegionPolygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
const triangle: RegionPolygon = [[0, 0], [0.5, 0], [0.25, 0.5]];

describe('pointInPolygon', () => {
  it('returns true for a point strictly inside', () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
  });
  it('returns false for a point strictly outside', () => {
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
  });
  it('handles a triangle', () => {
    expect(pointInPolygon([0.25, 0.1], triangle)).toBe(true);
    expect(pointInPolygon([0.25, 0.6], triangle)).toBe(false);
  });
});

describe('polygonsAtPoint', () => {
  it('returns ids of regions whose paths contain the point', () => {
    const regions = [
      { id: 'a', paths: [square] },
      { id: 'b', paths: [triangle] },
    ];
    expect(polygonsAtPoint([0.25, 0.1], regions)).toEqual(['a', 'b']);
    expect(polygonsAtPoint([0.9, 0.9], regions)).toEqual(['a']);
  });
  it('returns [] when nothing matches', () => {
    expect(polygonsAtPoint([2, 2], [{ id: 'a', paths: [square] }])).toEqual([]);
  });
});

describe('bboxOfPaths', () => {
  it('returns [x, y, w, h] in normalised coords', () => {
    expect(bboxOfPaths([square])).toEqual([0, 0, 1, 1]);
    expect(bboxOfPaths([triangle])).toEqual([0, 0, 0.5, 0.5]);
  });
});
