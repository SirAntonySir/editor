import { describe, it, expect } from 'vitest';
import { maskIoU, maskContainment, findBestRegionMatch } from './mask-overlap';
import type { Mask } from '@/core/mask-store';

function makeMask(width: number, height: number, set: Array<[number, number, number, number]>): Mask {
  const data = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of set) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        data[y * width + x] = 255;
      }
    }
  }
  return { id: 'test', layerId: 'L1', width, height, data, source: 'sam-point', createdAt: 0 };
}

describe('maskIoU', () => {
  it('returns 1.0 for identical masks', () => {
    const a = makeMask(10, 10, [[2, 2, 6, 6]]);
    const b = makeMask(10, 10, [[2, 2, 6, 6]]);
    expect(maskIoU(a, b)).toBe(1);
  });

  it('returns 0 for disjoint masks', () => {
    const a = makeMask(10, 10, [[0, 0, 3, 3]]);
    const b = makeMask(10, 10, [[6, 6, 9, 9]]);
    expect(maskIoU(a, b)).toBe(0);
  });

  it('returns 0 when one mask is empty', () => {
    const a = makeMask(10, 10, [[0, 0, 3, 3]]);
    const b = makeMask(10, 10, []);
    expect(maskIoU(a, b)).toBe(0);
  });

  it('handles different resolutions via nearest resample', () => {
    const a = makeMask(10, 10, [[2, 2, 6, 6]]); // 16 px set
    const b = makeMask(5, 5, [[1, 1, 3, 3]]);   // same region downsampled
    const iou = maskIoU(a, b);
    expect(iou).toBeGreaterThan(0.8);
  });
});

describe('maskContainment', () => {
  it('returns 1.0 when a is a strict subset of b', () => {
    const a = makeMask(10, 10, [[3, 3, 5, 5]]);
    const b = makeMask(10, 10, [[2, 2, 7, 7]]);
    expect(maskContainment(a, b)).toBe(1);
  });

  it('returns 0 for disjoint masks', () => {
    const a = makeMask(10, 10, [[0, 0, 3, 3]]);
    const b = makeMask(10, 10, [[6, 6, 9, 9]]);
    expect(maskContainment(a, b)).toBe(0);
  });
});

describe('findBestRegionMatch', () => {
  it('returns null when no region passes thresholds', () => {
    const newMask = makeMask(10, 10, [[0, 0, 2, 2]]);
    const candidates = [
      { label: 'sky', mask: makeMask(10, 10, [[7, 7, 9, 9]]), maskRef: 'r1' },
    ];
    expect(findBestRegionMatch(newMask, candidates)).toBeNull();
  });

  it('matches by containment when SAM clicks a sub-part of a region', () => {
    const newMask = makeMask(10, 10, [[3, 3, 5, 5]]); // small click
    const candidates = [
      { label: 'subject', mask: makeMask(10, 10, [[2, 2, 8, 8]]), maskRef: 'r1' },
    ];
    const m = findBestRegionMatch(newMask, candidates);
    expect(m?.label).toBe('subject');
    expect(m?.matchedBy).toBe('containment');
  });

  it('picks the highest-IoU candidate when multiple pass', () => {
    const newMask = makeMask(10, 10, [[2, 2, 6, 6]]);
    const candidates = [
      { label: 'partial', mask: makeMask(10, 10, [[2, 2, 4, 6]]), maskRef: 'r1' },
      { label: 'exact', mask: makeMask(10, 10, [[2, 2, 6, 6]]), maskRef: 'r2' },
    ];
    const m = findBestRegionMatch(newMask, candidates);
    expect(m?.label).toBe('exact');
  });
});
