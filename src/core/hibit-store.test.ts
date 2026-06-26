import { describe, expect, it, beforeEach } from 'vitest';
import { hiBitStore, downscaleHiBit } from './hibit-store';
import type { HiBitImage } from '@/lib/png16';

function img(width: number, height: number, fill: (i: number) => [number, number, number, number]): HiBitImage {
  const data = new Uint16Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b, a] = fill(i);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

describe('downscaleHiBit', () => {
  it('box-averages 2×2 → 1×1', () => {
    // R channel = 0,100,200,300 → avg 150; alpha all 65535.
    const src = img(2, 2, (i) => [i * 100, 0, 0, 65535]);
    const out = downscaleHiBit(src, 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBe(150);
    expect(out.data[3]).toBe(65535);
  });

  it('returns the source unchanged when target ≥ source', () => {
    const src = img(2, 2, () => [1, 2, 3, 4]);
    expect(downscaleHiBit(src, 4, 4)).toBe(src);
  });
});

describe('hiBitStore', () => {
  beforeEach(() => hiBitStore.clear());

  it('registers, gets, removes', () => {
    const src = img(2, 2, () => [1, 1, 1, 65535]);
    hiBitStore.register('L1', src);
    expect(hiBitStore.has('L1')).toBe(true);
    expect(hiBitStore.get('L1')).toBe(src);
    hiBitStore.remove('L1');
    expect(hiBitStore.has('L1')).toBe(false);
  });

  it('getDownscaled memoises per target size', () => {
    hiBitStore.register('L1', img(4, 4, () => [10, 20, 30, 65535]));
    const a = hiBitStore.getDownscaled('L1', 2, 2);
    const b = hiBitStore.getDownscaled('L1', 2, 2);
    expect(a).toBe(b); // cached
    expect(a?.width).toBe(2);
  });

  it('getDownscaled returns the source when target ≥ source', () => {
    const src = img(2, 2, () => [1, 1, 1, 1]);
    hiBitStore.register('L1', src);
    expect(hiBitStore.getDownscaled('L1', 8, 8)).toBe(src);
  });
});
