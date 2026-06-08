import { describe, expect, it } from 'vitest';
import { interpolate1D } from '../interpolate-1d';

describe('interpolate1D', () => {
  const anchors = [
    { position: 0.0, name: 'a', values: { x: 0 } },
    { position: 0.5, name: 'b', values: { x: 50 } },
    { position: 1.0, name: 'c', values: { x: 100 } },
  ];

  it('returns endpoint values when t is outside range', () => {
    expect(interpolate1D(anchors, -0.5)).toEqual({ x: 0 });
    expect(interpolate1D(anchors, 1.5)).toEqual({ x: 100 });
  });

  it('returns anchor values exactly at anchor positions', () => {
    expect(interpolate1D(anchors, 0.0).x).toBeCloseTo(0, 6);
    expect(interpolate1D(anchors, 0.5).x).toBeCloseTo(50, 6);
    expect(interpolate1D(anchors, 1.0).x).toBeCloseTo(100, 6);
  });

  it('interpolates smoothly between anchors', () => {
    const v = interpolate1D(anchors, 0.25).x;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(50);
  });

  it('throws on fewer than 2 anchors', () => {
    expect(() => interpolate1D([anchors[0]], 0.5)).toThrow();
  });
});
