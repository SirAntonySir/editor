/**
 * Tests for the memoized curve-LUT evaluation. During a curve drag, the
 * composite re-runs per frame and previously rebuilt all four channels'
 * 256-sample splines from scratch every time — the three untouched channels
 * were pure dead work. Same points → same cached Float32Array reference.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCubicSplineMemo, evaluateCubicSpline } from './curves';

const IDENTITY = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
const LIFTED = [{ x: 0, y: 24 }, { x: 128, y: 150 }, { x: 255, y: 255 }];

describe('evaluateCubicSplineMemo', () => {
  it('returns the SAME array reference for equal points (cache hit)', () => {
    const a = evaluateCubicSplineMemo(IDENTITY);
    const b = evaluateCubicSplineMemo([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(b).toBe(a);
  });

  it('returns a different LUT when the points change', () => {
    const a = evaluateCubicSplineMemo(IDENTITY);
    const b = evaluateCubicSplineMemo(LIFTED);
    expect(b).not.toBe(a);
    expect(Array.from(b)).not.toEqual(Array.from(a));
  });

  it('matches the unmemoized evaluation exactly', () => {
    const memo = evaluateCubicSplineMemo(LIFTED);
    const raw = evaluateCubicSpline(LIFTED);
    expect(Array.from(memo)).toEqual(Array.from(raw));
  });
});
