/**
 * Mechanical (deterministic, non-AI) image stats computed from any
 * canvas-like source. Mirrors the cheap-pass fields the backend produces in
 * `backend/app/state/context_stats.py` so the Info tab can present the same
 * shape live as the user edits, rather than freezing on the upload-time
 * snapshot.
 *
 * Sampled at up to 256×256 pixels (downscaled inside `computeHistogramBins`)
 * so the cost is fixed regardless of source resolution — good enough for
 * inspector chrome that needs shape, not pixel-accurate counts.
 */

import type { ColorSwatchData } from '@/types/image-context';
import { computeHistogramBins, type HistogramBins } from './histogram-compute';

export interface MechanicalSnapshot {
  lumaHistogram: number[];
  rgbHistograms: { r: number[]; g: number[]; b: number[] };
  clippedShadowsPct: number;
  clippedHighlightsPct: number;
  medianLuma: number;
  contrastP10P90: number;
  colorPalette: ColorSwatchData[];
  castStrength: number;
  castDirection: [number, number];
}

const SHADOW_CLIP = 4;
const HIGHLIGHT_CLIP = 251;

/** Compute median, p10 and p90 from a 256-bin luma histogram via cumulative
 *  weights. Returns the smallest luma value whose cumulative count crosses
 *  the requested fraction of total. */
function percentilesFromBins(lum: Uint32Array, fractions: number[]): number[] {
  let total = 0;
  for (let i = 0; i < 256; i++) total += lum[i];
  if (total === 0) return fractions.map(() => 0);
  const targets = fractions.map((f) => f * total);
  const out: number[] = new Array(fractions.length).fill(0);
  const found = new Array(fractions.length).fill(false);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += lum[i];
    for (let k = 0; k < fractions.length; k++) {
      if (!found[k] && acc >= targets[k]) {
        out[k] = i;
        found[k] = true;
      }
    }
  }
  return out;
}

/** Cheap palette quantization: bucket pixels into a 4×4×4 RGB grid (64
 *  buckets), pick the top-N most populous, and report each bucket's RGB
 *  centroid + population weight. Lighter than k-means but produces a stable
 *  bar that updates smoothly between renders. */
function computePaletteFromImageData(data: Uint8ClampedArray, topN = 8): ColorSwatchData[] {
  const BUCKETS = 64; // 4 per channel
  const counts = new Uint32Array(BUCKETS);
  const sumR = new Float64Array(BUCKETS);
  const sumG = new Float64Array(BUCKETS);
  const sumB = new Float64Array(BUCKETS);

  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const idx = (r >> 6) * 16 + (g >> 6) * 4 + (b >> 6);
    counts[idx]++;
    sumR[idx] += r;
    sumG[idx] += g;
    sumB[idx] += b;
    total++;
  }
  if (total === 0) return [];

  // Sort bucket indices by population, descending.
  const indices: number[] = [];
  for (let i = 0; i < BUCKETS; i++) if (counts[i] > 0) indices.push(i);
  indices.sort((a, b) => counts[b] - counts[a]);

  const picked = indices.slice(0, topN);
  const swatches: ColorSwatchData[] = picked.map((i) => ({
    rgb: [
      Math.round(sumR[i] / counts[i]),
      Math.round(sumG[i] / counts[i]),
      Math.round(sumB[i] / counts[i]),
    ] as [number, number, number],
    weight: counts[i] / total,
  }));
  // Re-normalise weights so picked buckets sum to 1 — the bar visualises
  // relative dominance among shown swatches, not absolute coverage.
  const pickedTotal = swatches.reduce((s, x) => s + x.weight, 0);
  if (pickedTotal > 0) {
    for (const s of swatches) s.weight = s.weight / pickedTotal;
  }
  return swatches;
}

/** Approximate Lab a-star / b-star from a mean sRGB triple. Path: sRGB →
 *  linear sRGB → XYZ (D65) → Lab. Feeding the mean RGB rather than the
 *  per-pixel mean of Lab is close enough for a chromatic-cast indicator and
 *  ~10× cheaper. */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function labFromMeanRgb(r: number, g: number, b: number): { a: number; b: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  // sRGB D65 → XYZ.
  const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  // Reference white D65.
  const xn = X / 0.95047;
  const yn = Y / 1.00000;
  const zn = Z / 1.08883;
  const delta = 6 / 29;
  const f = (t: number) => (t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);
  return { a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Build a full mechanical snapshot from any canvas-like source. Returns
 *  null if the source has no pixels. */
export function computeMechanicalSnapshot(
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
): MechanicalSnapshot | null {
  const bins = computeHistogramBins(source);
  if (!bins) return null;

  // Re-sample the source one more time for palette + mean-RGB. Cheaper to
  // do here against the same 256×256 sample area than to thread an ImageData
  // out of `computeHistogramBins`.
  const w = 'width' in source ? source.width : 0;
  const h = 'height' in source ? source.height : 0;
  const sampleW = Math.min(w, 256);
  const sampleH = Math.min(h, 256);
  const sampleCanvas = new OffscreenCanvas(sampleW, sampleH);
  const sampleCtx = sampleCanvas.getContext('2d');
  if (!sampleCtx) return null;
  sampleCtx.drawImage(source as CanvasImageSource, 0, 0, sampleW, sampleH);
  const { data } = sampleCtx.getImageData(0, 0, sampleW, sampleH);

  return {
    lumaHistogram: Array.from(bins.lum),
    rgbHistograms: {
      r: Array.from(bins.r),
      g: Array.from(bins.g),
      b: Array.from(bins.b),
    },
    ...scalarsFromBins(bins),
    colorPalette: computePaletteFromImageData(data),
    ...castFromImageData(data),
  };
}

/** Exposed for unit tests + reuse from the hook. */
export function scalarsFromBins(bins: HistogramBins): {
  clippedShadowsPct: number;
  clippedHighlightsPct: number;
  medianLuma: number;
  contrastP10P90: number;
} {
  const lum = bins.lum;
  let total = 0;
  let shadows = 0;
  let highlights = 0;
  for (let i = 0; i < 256; i++) {
    total += lum[i];
    if (i <= SHADOW_CLIP) shadows += lum[i];
    if (i >= HIGHLIGHT_CLIP) highlights += lum[i];
  }
  const [p10, median, p90] = total > 0
    ? percentilesFromBins(lum, [0.1, 0.5, 0.9])
    : [0, 0, 0];
  return {
    clippedShadowsPct: total > 0 ? (shadows / total) * 100 : 0,
    clippedHighlightsPct: total > 0 ? (highlights / total) * 100 : 0,
    medianLuma: median,
    contrastP10P90: p90 - p10,
  };
}

function castFromImageData(data: Uint8ClampedArray): {
  castStrength: number;
  castDirection: [number, number];
} {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    count++;
  }
  if (count === 0) return { castStrength: 0, castDirection: [0, 0] };
  const { a, b } = labFromMeanRgb(sumR / count, sumG / count, sumB / count);
  // Matches the backend's normalisation in context_stats.py.
  const strength = Math.min(1, Math.sqrt(a * a + b * b) / 60);
  return { castStrength: strength, castDirection: [a, b] };
}
