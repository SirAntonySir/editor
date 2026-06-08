import { describe, it, expect } from 'vitest';
import { interpolate1D } from './interpolate';
import type { Anchor } from './types';

const ANCHORS: Anchor[] = [
  { id: 'a', label: 'A', position: [0],   params: { 'light.exposure':  0,    'kelvin.kelvin': 3000 } },
  { id: 'b', label: 'B', position: [0.5], params: { 'light.exposure':  0.5,  'kelvin.kelvin': 5500 } },
  { id: 'c', label: 'C', position: [1],   params: { 'light.exposure': -0.5,  'kelvin.kelvin': 9000 } },
];

describe('interpolate1D', () => {
  it('returns the anchor params verbatim when position matches an anchor', () => {
    expect(interpolate1D(ANCHORS, 0)).toEqual({ 'light.exposure':  0,    'kelvin.kelvin': 3000 });
    expect(interpolate1D(ANCHORS, 0.5)).toEqual({ 'light.exposure':  0.5,  'kelvin.kelvin': 5500 });
    expect(interpolate1D(ANCHORS, 1)).toEqual({ 'light.exposure': -0.5,  'kelvin.kelvin': 9000 });
  });

  it('clamps to first/last anchor when position is out of range', () => {
    expect(interpolate1D(ANCHORS, -0.2)).toEqual(ANCHORS[0].params);
    expect(interpolate1D(ANCHORS,  1.2)).toEqual(ANCHORS[2].params);
  });

  it('produces an intermediate value strictly between neighbouring anchors for scalar params', () => {
    const mid = interpolate1D(ANCHORS, 0.25);
    expect(mid['light.exposure']).toBeGreaterThan(0);
    expect(mid['light.exposure']).toBeLessThan(0.5);
    expect(mid['kelvin.kelvin']).toBeGreaterThan(3000);
    expect(mid['kelvin.kelvin']).toBeLessThan(5500);
  });

  it('preserves keys present in only one neighbour by carrying them through', () => {
    const partial: Anchor[] = [
      { id: 'a', label: 'A', position: [0], params: { 'light.exposure': 0 } },
      { id: 'b', label: 'B', position: [1], params: { 'light.exposure': 1, 'kelvin.kelvin': 5500 } },
    ];
    const mid = interpolate1D(partial, 0.5);
    // Both anchors must contribute keys; missing-side defaults to 0.
    expect(mid['light.exposure']).toBeCloseTo(0.5, 5);
    expect(mid['kelvin.kelvin']).toBeCloseTo(2750, 0);
  });

  it('sorts unordered anchors by position', () => {
    const shuffled: Anchor[] = [
      { id: 'c', label: 'C', position: [1],   params: { 'light.exposure': -0.5 } },
      { id: 'a', label: 'A', position: [0],   params: { 'light.exposure':  0    } },
      { id: 'b', label: 'B', position: [0.5], params: { 'light.exposure':  0.5  } },
    ];
    expect(interpolate1D(shuffled, 0)).toEqual({ 'light.exposure':  0    });
    expect(interpolate1D(shuffled, 1)).toEqual({ 'light.exposure': -0.5 });
  });
});
