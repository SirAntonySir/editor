import { describe, it, expect } from 'vitest';
import { largestInsetRect } from './largest-inset-rect';

describe('largestInsetRect', () => {
  it('at angle 0 returns the full source for matching aspect', () => {
    const r = largestInsetRect(800, 600, 0, 800 / 600);
    expect(r.w).toBeCloseTo(800);
    expect(r.h).toBeCloseTo(600);
  });

  it('at angle 0 with 1:1 aspect on landscape returns the height-bound square', () => {
    const r = largestInsetRect(800, 600, 0, 1);
    expect(r.w).toBeCloseTo(600);
    expect(r.h).toBeCloseTo(600);
  });

  it('at 90° on a 1:1 source returns the same 1:1 dims', () => {
    const r = largestInsetRect(600, 600, 90, 1);
    expect(r.w).toBeCloseTo(600);
    expect(r.h).toBeCloseTo(600);
  });

  it('at 45° on an 800×600 source with source-aspect ratio shrinks', () => {
    const r = largestInsetRect(800, 600, 45, 800 / 600);
    // Both dims smaller than source.
    expect(r.w).toBeLessThan(800);
    expect(r.h).toBeLessThan(600);
    // The result fits inside the source bounding-box constraints.
    const θ = Math.PI / 4;
    const c = Math.cos(θ);
    const s = Math.sin(θ);
    expect(r.w * c + r.h * s).toBeLessThanOrEqual(800 + 0.5);
    expect(r.w * s + r.h * c).toBeLessThanOrEqual(600 + 0.5);
  });

  it('is symmetric in sign of angle', () => {
    const a = largestInsetRect(800, 600, 30, 1.5);
    const b = largestInsetRect(800, 600, -30, 1.5);
    expect(a.w).toBeCloseTo(b.w);
    expect(a.h).toBeCloseTo(b.h);
  });

  it('preserves the requested aspect ratio', () => {
    const r = largestInsetRect(800, 600, 17, 3 / 2);
    expect(r.w / r.h).toBeCloseTo(3 / 2);
  });
});
