import { describe, it, expect } from 'vitest';
import { autoLight, autoContrast, autoTone, autoColor } from './auto-tune';
import type { MechanicalSnapshot } from '@/lib/mechanical-context';

function mech(overrides: Partial<MechanicalSnapshot> = {}): MechanicalSnapshot {
  return {
    luma_histogram: new Array(256).fill(0),
    rgb_histograms: { r: new Array(256).fill(0), g: new Array(256).fill(0), b: new Array(256).fill(0) },
    clipped_shadows_pct: 0,
    clipped_highlights_pct: 0,
    median_luma: 128,
    contrast_p10_p90: 160,
    color_palette: [],
    cast_strength: 0,
    cast_direction: [0, 0],
    ...overrides,
  };
}

describe('autoLight', () => {
  it('returns zero exposure when median already at 128', () => {
    expect(autoLight(mech({ median_luma: 128 })).params.exposure).toBe(0);
  });
  it('pushes exposure up for a dark image', () => {
    const { params } = autoLight(mech({ median_luma: 40, contrast_p10_p90: 200 }));
    expect(params.exposure).toBeGreaterThan(20);
  });
  it('pulls exposure down for a bright image', () => {
    const { params } = autoLight(mech({ median_luma: 220 }));
    expect(params.exposure).toBeLessThan(-20);
  });
  it('lifts contrast for a flat histogram', () => {
    const { params } = autoLight(mech({ contrast_p10_p90: 50 }));
    expect(params.contrast).toBeGreaterThan(20);
  });
});

describe('autoTone', () => {
  it('lowers highlights when highlights are clipped', () => {
    const { params } = autoTone(mech({ clipped_highlights_pct: 3 }));
    expect(params.highlights).toBeLessThan(0);
  });
  it('lifts shadows when shadows are crushed', () => {
    const { params } = autoTone(mech({ clipped_shadows_pct: 4 }));
    expect(params.shadows).toBeGreaterThan(0);
  });
  it('returns near-neutral when nothing is clipped', () => {
    const { params } = autoTone(mech({ clipped_shadows_pct: 0, clipped_highlights_pct: 0 }));
    expect(params.shadows).toBe(0);
    expect(params.highlights).toBe(0);
  });
});

describe('autoContrast', () => {
  it('lifts contrast for low p10-p90 spread', () => {
    expect(autoContrast(mech({ contrast_p10_p90: 60 })).params.contrast).toBeGreaterThan(30);
  });
  it('flattens contrast when spread is very wide', () => {
    expect(autoContrast(mech({ contrast_p10_p90: 230 })).params.contrast).toBeLessThan(0);
  });
});

describe('autoColor', () => {
  it('returns neutral 6500 K when there is no cast', () => {
    expect(autoColor(mech({ cast_direction: [0, 0] })).params.kelvin).toBe(6500);
  });
  it('cools (lowers kelvin) for a yellow cast (positive b*)', () => {
    expect(autoColor(mech({ cast_direction: [0, 20] })).params.kelvin).toBeLessThan(6500);
  });
  it('warms (raises kelvin) for a blue cast (negative b*)', () => {
    expect(autoColor(mech({ cast_direction: [0, -20] })).params.kelvin).toBeGreaterThan(6500);
  });
  it('clamps kelvin within the 2000-10000 range', () => {
    expect(autoColor(mech({ cast_direction: [50, 50] })).params.kelvin).toBeGreaterThanOrEqual(2000);
    expect(autoColor(mech({ cast_direction: [-50, -50] })).params.kelvin).toBeLessThanOrEqual(10000);
  });
});
