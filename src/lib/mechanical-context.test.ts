import { describe, it, expect } from 'vitest';
import { scalarsFromBins, computeMechanicalSnapshot } from './mechanical-context';
import type { HistogramBins } from './histogram-compute';

function bins(luma: number[]): HistogramBins {
  const lum = new Uint32Array(256);
  for (let i = 0; i < 256; i++) lum[i] = luma[i] ?? 0;
  return { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), lum };
}

describe('scalarsFromBins', () => {
  it('reports clipped shadows and highlights from a synthetic histogram', () => {
    // 100 px in deep shadow (i=0), 100 px in deep highlight (i=255), 100 px midtones (i=128).
    const luma = new Array(256).fill(0);
    luma[0] = 100;
    luma[128] = 100;
    luma[255] = 100;
    const s = scalarsFromBins(bins(luma));
    expect(s.clippedShadowsPct).toBeCloseTo((100 / 300) * 100, 5);
    expect(s.clippedHighlightsPct).toBeCloseTo((100 / 300) * 100, 5);
  });

  it('returns zeroed stats for an empty histogram', () => {
    const s = scalarsFromBins(bins([]));
    expect(s).toEqual({
      clippedShadowsPct: 0,
      clippedHighlightsPct: 0,
      medianLuma: 0,
      contrastP10P90: 0,
    });
  });

  it('computes contrast as p90 - p10 from the luma cumulative', () => {
    // Uniform distribution across [0, 200] — p10 ~= 20, p90 ~= 180,
    // contrast ~= 160.
    const luma = new Array(256).fill(0);
    for (let i = 0; i <= 200; i++) luma[i] = 100;
    const s = scalarsFromBins(bins(luma));
    expect(s.contrastP10P90).toBeGreaterThan(140);
    expect(s.contrastP10P90).toBeLessThan(180);
  });
});

describe('computeMechanicalSnapshot', () => {
  it('returns a populated snapshot for a small uniform-grey canvas', () => {
    // OffscreenCanvas exists in jsdom-equivalent test envs we run here;
    // skip gracefully if not available so the suite doesn't false-fail.
    if (typeof OffscreenCanvas === 'undefined') return;
    const c = new OffscreenCanvas(8, 8);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(0, 0, 8, 8);
    const snap = computeMechanicalSnapshot(c);
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(snap.lumaHistogram.length).toBe(256);
    expect(snap.colorPalette.length).toBeGreaterThan(0);
    // Mid-grey RGB → near-neutral Lab → tiny cast.
    expect(snap.castStrength).toBeLessThan(0.05);
  });
});
