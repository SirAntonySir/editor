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

import { interpolateExtended, interpolateLinear1D } from './interpolate';

describe('interpolateExtended', () => {
  const anchors: Anchor[] = [
    { id: 'a0', label: 'as shot', position: [0], params: { 'n_a:exposure': 0, 'n_a:shadows': 10 } },
    { id: 'a1', label: 'proposed', position: [1], params: { 'n_a:exposure': -80, 'n_a:shadows': -50 } },
  ];

  it('matches interpolate1D at and below the last anchor (catmull_rom_1d mode)', () => {
    expect(interpolateExtended(anchors, 0)).toEqual({ 'n_a:exposure': 0, 'n_a:shadows': 10 });
    expect(interpolateExtended(anchors, 1)).toEqual({ 'n_a:exposure': -80, 'n_a:shadows': -50 });
    expect(interpolateExtended(anchors, 0.5)['n_a:exposure']).toBe(-40);
  });

  it('extrapolates linearly past the last anchor (back-compat 2-anchor)', () => {
    const out = interpolateExtended(anchors, 1.5);
    expect(out['n_a:exposure']).toBe(-120); // -80 + 0.5 * (-80 - 0)
    expect(out['n_a:shadows']).toBe(-80);   // -50 + 0.5 * (-50 - 10)
  });

  it('linear_1d mode dispatches to interpolateLinear1D in-range', () => {
    const threeAnchors: Anchor[] = [
      { id: 'a0', label: 'as shot',  position: [0],   params: { 'n_a:exposure': 0 } },
      { id: 'a1', label: 'proposed', position: [1],   params: { 'n_a:exposure': -80 } },
      { id: 'a2', label: 'max',      position: [1.5], params: { 'n_a:exposure': -100 } },
    ];
    // t=0.5: linear midpoint 0→-80 = -40
    expect(interpolateExtended(threeAnchors, 0.5, 'linear_1d')['n_a:exposure']).toBeCloseTo(-40);
    // t=1.0: exactly the proposal anchor
    expect(interpolateExtended(threeAnchors, 1.0, 'linear_1d')['n_a:exposure']).toBeCloseTo(-80);
    // t=1.5: exactly the max anchor (piecewise linear hits it exactly)
    expect(interpolateExtended(threeAnchors, 1.5, 'linear_1d')['n_a:exposure']).toBeCloseTo(-100);
  });
});

describe('interpolateLinear1D', () => {
  const threeAnchors: Anchor[] = [
    { id: 'a0', label: 'as shot',  position: [0],   params: { 'n_a:exposure': 0 } },
    { id: 'a1', label: 'proposed', position: [1],   params: { 'n_a:exposure': -80 } },
    { id: 'a2', label: 'max',      position: [1.5], params: { 'n_a:exposure': -100 } },
  ];

  it('clamps to endpoints outside range', () => {
    expect(interpolateLinear1D(threeAnchors, -0.5)['n_a:exposure']).toBe(0);
    expect(interpolateLinear1D(threeAnchors, 2.0)['n_a:exposure']).toBe(-100);
  });

  it('hits anchor values exactly at anchor positions', () => {
    expect(interpolateLinear1D(threeAnchors, 0.0)['n_a:exposure']).toBeCloseTo(0);
    expect(interpolateLinear1D(threeAnchors, 1.0)['n_a:exposure']).toBeCloseTo(-80);
    expect(interpolateLinear1D(threeAnchors, 1.5)['n_a:exposure']).toBeCloseTo(-100);
  });

  it('interpolates linearly: midpoint between anchors is exact', () => {
    // t=0.5: halfway 0 → -80 = -40
    expect(interpolateLinear1D(threeAnchors, 0.5)['n_a:exposure']).toBeCloseTo(-40);
    // t=1.25: halfway -80 → -100 = -90
    expect(interpolateLinear1D(threeAnchors, 1.25)['n_a:exposure']).toBeCloseTo(-90);
  });

  it('has no overshoot in the 0→1 segment (monotone)', () => {
    for (let t = 0; t <= 1.0; t += 0.1) {
      const v = interpolateLinear1D(threeAnchors, t)['n_a:exposure'] ?? 0;
      expect(v).toBeGreaterThanOrEqual(-80);
      expect(v).toBeLessThanOrEqual(0);
    }
  });
});
